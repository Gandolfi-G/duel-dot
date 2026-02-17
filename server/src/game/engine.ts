export interface InternalRound {
  roundId: string;
  left: number;
  right: number;
  expected: number;
  startedAt: number;
  submittedPlayerIds: Set<string>;
  bestCorrectSubmission: CorrectSubmission | null;
  winnerPlayerId: string | null;
  resolvedAt: number | null;
}

export interface CorrectSubmission {
  playerId: string;
  latencyMs: number;
  receivedAt: number;
}

export interface AnswerEvaluation {
  round: InternalRound;
  outcome: "ignored" | "incorrect" | "correct-pending";
  reason?: "round-already-resolved" | "duplicate-submission";
}

export type ScoreBoard = Record<string, number>;

export interface AwardPointResult {
  scores: ScoreBoard;
  playerScore: number;
  winnerPlayerId: string | null;
}

export interface RematchParticipant {
  playerId: string;
}

export interface RematchSessionState {
  phase: "waiting" | "countdown" | "playing" | "paused" | "finished";
  players: RematchParticipant[];
  scores: ScoreBoard;
  currentRound: InternalRound | null;
  winnerPlayerId: string | null;
  rematchRequestedBy: Set<string>;
}

export interface RematchResult {
  started: boolean;
}

export interface RoundTimeoutResolution {
  timedOut: boolean;
  round: InternalRound;
}

export const LATENCY_TIE_THRESHOLD_MS = 20;

export function generateRound(
  idFactory: () => string = createRoundId,
  random: () => number = Math.random,
  now: number = Date.now()
): InternalRound {
  const left = 2 + Math.floor(random() * 11);
  const right = 2 + Math.floor(random() * 11);

  return {
    roundId: idFactory(),
    left,
    right,
    expected: left * right,
    startedAt: now,
    submittedPlayerIds: new Set<string>(),
    bestCorrectSubmission: null,
    winnerPlayerId: null,
    resolvedAt: null
  };
}

export function evaluateAnswer(
  round: InternalRound,
  playerId: string,
  answer: number,
  now: number = Date.now()
): AnswerEvaluation {
  if (round.winnerPlayerId) {
    return {
      round,
      outcome: "ignored",
      reason: "round-already-resolved"
    };
  }

  if (round.submittedPlayerIds.has(playerId)) {
    return {
      round,
      outcome: "ignored",
      reason: "duplicate-submission"
    };
  }

  const nextSubmittedPlayerIds = new Set(round.submittedPlayerIds);
  nextSubmittedPlayerIds.add(playerId);

  if (answer !== round.expected) {
    return {
      round: {
        ...round,
        submittedPlayerIds: nextSubmittedPlayerIds
      },
      outcome: "incorrect"
    };
  }

  const nextSubmission: CorrectSubmission = {
    playerId,
    latencyMs: Math.max(0, now - round.startedAt),
    receivedAt: now
  };

  return {
    round: {
      ...round,
      submittedPlayerIds: nextSubmittedPlayerIds,
      bestCorrectSubmission: pickPreferredSubmission(
        round.bestCorrectSubmission,
        nextSubmission
      )
    },
    outcome: "correct-pending"
  };
}

export function pickPreferredSubmission(
  current: CorrectSubmission | null,
  candidate: CorrectSubmission,
  tieThresholdMs: number = LATENCY_TIE_THRESHOLD_MS
): CorrectSubmission {
  if (!current) {
    return candidate;
  }

  const latencyGap = Math.abs(candidate.latencyMs - current.latencyMs);
  if (latencyGap >= tieThresholdMs) {
    return candidate.latencyMs < current.latencyMs ? candidate : current;
  }

  if (candidate.receivedAt !== current.receivedAt) {
    return candidate.receivedAt < current.receivedAt ? candidate : current;
  }

  return candidate.playerId < current.playerId ? candidate : current;
}

export function finalizeRound(round: InternalRound): InternalRound {
  if (round.winnerPlayerId || !round.bestCorrectSubmission) {
    return round;
  }

  return {
    ...round,
    winnerPlayerId: round.bestCorrectSubmission.playerId,
    resolvedAt: round.bestCorrectSubmission.receivedAt
  };
}

export function hasRoundTimedOut(
  round: InternalRound,
  now: number,
  timeoutMs: number
): boolean {
  if (round.winnerPlayerId) {
    return false;
  }

  return now - round.startedAt >= timeoutMs;
}

export function resolveRoundTimeout(
  round: InternalRound,
  now: number,
  timeoutMs: number,
  nextRoundFactory: () => InternalRound
): RoundTimeoutResolution {
  if (!hasRoundTimedOut(round, now, timeoutMs)) {
    return {
      timedOut: false,
      round
    };
  }

  return {
    timedOut: true,
    round: nextRoundFactory()
  };
}

export function createScores(playerIds: string[]): ScoreBoard {
  return playerIds.reduce<ScoreBoard>((accumulator, playerId) => {
    accumulator[playerId] = 0;
    return accumulator;
  }, {});
}

export function awardPoint(
  scores: ScoreBoard,
  playerId: string,
  targetScore: number
): AwardPointResult {
  const nextScores: ScoreBoard = {
    ...scores,
    [playerId]: (scores[playerId] ?? 0) + 1
  };

  const playerScore = nextScores[playerId];
  return {
    scores: nextScores,
    playerScore,
    winnerPlayerId: playerScore >= targetScore ? playerId : null
  };
}

export function applyRematchRequest(
  session: RematchSessionState,
  playerId: string,
  nextRoundFactory: () => InternalRound
): RematchResult {
  if (session.phase !== "finished") {
    return { started: false };
  }

  if (!session.players.some((player) => player.playerId === playerId)) {
    return { started: false };
  }

  session.rematchRequestedBy.add(playerId);

  if (session.players.length !== 2 || session.rematchRequestedBy.size !== session.players.length) {
    return { started: false };
  }

  session.phase = "playing";
  session.winnerPlayerId = null;
  session.scores = createScores(session.players.map((player) => player.playerId));
  session.currentRound = nextRoundFactory();
  session.rematchRequestedBy.clear();

  return { started: true };
}

function createRoundId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
