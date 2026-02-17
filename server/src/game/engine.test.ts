import { describe, expect, it } from "vitest";
import {
  applyRematchRequest,
  awardPoint,
  createScores,
  evaluateAnswer,
  finalizeRound,
  generateRound,
  hasRoundTimedOut,
  resolveRoundTimeout
} from "./engine";

describe("generateRound", () => {
  it("génère des facteurs entre 2 et 12", () => {
    const round = generateRound(() => "round-0", () => 0.9999);

    expect(round.left).toBeGreaterThanOrEqual(2);
    expect(round.left).toBeLessThanOrEqual(12);
    expect(round.right).toBeGreaterThanOrEqual(2);
    expect(round.right).toBeLessThanOrEqual(12);
    expect(round.expected).toBe(round.left * round.right);
  });
});

describe("createScores", () => {
  it("initialise les scores des joueurs à 0", () => {
    const scores = createScores(["p1", "p2"]);
    expect(scores).toEqual({ p1: 0, p2: 0 });
  });
});

describe("awardPoint", () => {
  it("n'annonce pas de gagnant avant le score cible", () => {
    const baseScores = { p1: 7, p2: 9 };
    const result = awardPoint(baseScores, "p1", 15);

    expect(result.scores.p1).toBe(8);
    expect(result.winnerPlayerId).toBeNull();
  });

  it("ajoute le point et détecte la victoire à 15", () => {
    const baseScores = { p1: 14, p2: 8 };
    const result = awardPoint(baseScores, "p1", 15);

    expect(result.scores.p1).toBe(15);
    expect(result.winnerPlayerId).toBe("p1");
  });

  it("retourne un nouvel objet scoreboard (immutabilité)", () => {
    const baseScores = { p1: 2, p2: 2 };
    const result = awardPoint(baseScores, "p1", 15);

    expect(result.scores).not.toBe(baseScores);
    expect(baseScores.p1).toBe(2);
    expect(result.scores.p1).toBe(3);
  });
});

describe("evaluateAnswer", () => {
  it("départage une quasi-égalité de latence (<20ms) au timestamp serveur", () => {
    const round = generateRound(() => "round-1", () => 0);
    const correctAnswer = round.expected;

    const firstAnswer = evaluateAnswer(round, "p1", correctAnswer, round.startedAt + 100);
    const secondAnswer = evaluateAnswer(
      firstAnswer.round,
      "p2",
      correctAnswer,
      round.startedAt + 115
    );
    const finalizedRound = finalizeRound(secondAnswer.round);

    expect(firstAnswer.outcome).toBe("correct-pending");
    expect(secondAnswer.outcome).toBe("correct-pending");
    expect(finalizedRound.winnerPlayerId).toBe("p1");
    expect(finalizedRound.resolvedAt).toBe(round.startedAt + 100);
  });

  it("accepte une bonne réponse après une mauvaise", () => {
    const round = generateRound(() => "round-2", () => 0.1);

    const wrong = evaluateAnswer(round, "p1", 999, 1);
    const correct = evaluateAnswer(wrong.round, "p2", round.expected, 2);
    const finalizedRound = finalizeRound(correct.round);

    expect(wrong.outcome).toBe("incorrect");
    expect(correct.outcome).toBe("correct-pending");
    expect(finalizedRound.winnerPlayerId).toBe("p2");
  });

  it("bloque une double soumission du même joueur", () => {
    const round = generateRound(() => "round-3", () => 0.2);
    const first = evaluateAnswer(round, "p1", round.expected + 1, 10);
    const duplicate = evaluateAnswer(first.round, "p1", round.expected, 11);

    expect(first.outcome).toBe("incorrect");
    expect(duplicate.outcome).toBe("ignored");
    expect(duplicate.reason).toBe("duplicate-submission");
  });

  it("ignore toute soumission après finalisation de manche", () => {
    const round = generateRound(() => "round-4", () => 0.5);
    const first = evaluateAnswer(round, "p1", round.expected, 100);
    const finalizedRound = finalizeRound(first.round);
    const afterLock = evaluateAnswer(finalizedRound, "p2", round.expected, 101);

    expect(afterLock.outcome).toBe("ignored");
    expect(afterLock.reason).toBe("round-already-resolved");
  });
});

describe("hasRoundTimedOut", () => {
  it("retourne true au-delà du délai de manche", () => {
    const round = generateRound(() => "round-timeout", () => 0.3, 1_000);

    expect(hasRoundTimedOut(round, 11_000, 10_000)).toBe(true);
  });

  it("retourne false pour une manche déjà résolue", () => {
    const round = generateRound(() => "round-finished", () => 0.7, 2_000);
    const resolved = finalizeRound(evaluateAnswer(round, "p1", round.expected, 2_050).round);

    expect(hasRoundTimedOut(resolved, 20_000, 10_000)).toBe(false);
  });
});

describe("resolveRoundTimeout", () => {
  it("génère une nouvelle question quand la manche expire", () => {
    const timedOutRound = generateRound(() => "r-old", () => 0.1, 100);
    const result = resolveRoundTimeout(timedOutRound, 10_200, 10_000, () =>
      generateRound(() => "r-next", () => 0.4, 10_200)
    );

    expect(result.timedOut).toBe(true);
    expect(result.round.roundId).toBe("r-next");
    expect(result.round.startedAt).toBe(10_200);
  });
});

describe("applyRematchRequest", () => {
  it("redémarre une partie propre après accord des 2 joueurs", () => {
    const session = {
      phase: "finished" as const,
      players: [{ playerId: "p1" }, { playerId: "p2" }],
      scores: { p1: 15, p2: 10 },
      currentRound: null,
      winnerPlayerId: "p1",
      rematchRequestedBy: new Set<string>()
    };

    const firstVote = applyRematchRequest(session, "p1", () => generateRound(() => "r1", () => 0));
    expect(firstVote.started).toBe(false);
    expect(session.phase).toBe("finished");
    expect(session.rematchRequestedBy.has("p1")).toBe(true);

    const secondVote = applyRematchRequest(session, "p2", () => generateRound(() => "r2", () => 0.4));
    expect(secondVote.started).toBe(true);
    expect(session.phase).toBe("playing");
    expect(session.winnerPlayerId).toBeNull();
    expect(session.scores).toEqual({ p1: 0, p2: 0 });
    expect(session.currentRound?.roundId).toBe("r2");
    expect(session.rematchRequestedBy.size).toBe(0);
  });

  it("ignore la revanche si la partie n'est pas terminée", () => {
    const session = {
      phase: "playing" as const,
      players: [{ playerId: "p1" }, { playerId: "p2" }],
      scores: { p1: 7, p2: 6 },
      currentRound: generateRound(() => "r-live", () => 0.1),
      winnerPlayerId: null,
      rematchRequestedBy: new Set<string>()
    };

    const result = applyRematchRequest(session, "p1", () => generateRound(() => "r-new", () => 0.9));
    expect(result.started).toBe(false);
    expect(session.phase).toBe("playing");
    expect(session.currentRound?.roundId).toBe("r-live");
    expect(session.scores).toEqual({ p1: 7, p2: 6 });
  });

  it("ignore la revanche si le joueur n'appartient pas à la session", () => {
    const session = {
      phase: "finished" as const,
      players: [{ playerId: "p1" }, { playerId: "p2" }],
      scores: { p1: 15, p2: 14 },
      currentRound: null,
      winnerPlayerId: "p1",
      rematchRequestedBy: new Set<string>()
    };

    const result = applyRematchRequest(session, "intrus", () => generateRound(() => "r-new", () => 0.2));
    expect(result.started).toBe(false);
    expect(session.phase).toBe("finished");
    expect(session.rematchRequestedBy.size).toBe(0);
  });
});
