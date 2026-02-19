import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlayerPublicState, PublicSessionState } from "@math-duel/shared";
import { DuelPage } from "./DuelPage";

function createState(overrides?: Partial<PublicSessionState>): PublicSessionState {
  return {
    sessionCode: "AB12C",
    phase: "playing",
    targetScore: 15,
    players: [
      {
        playerId: "p1",
        nickname: "Alice",
        score: 7,
        isConnected: true
      },
      {
        playerId: "p2",
        nickname: "Bob",
        score: 4,
        isConnected: true
      }
    ],
    currentQuestion: {
      roundId: "r1",
      left: 8,
      right: 7,
      prompt: "8 × 7"
    },
    countdownRemainingMs: null,
    disconnectGraceRemainingMs: null,
    winnerPlayerId: null,
    rematchRequestedBy: [],
    ...overrides
  };
}

function renderDuel(stateOverrides?: Partial<PublicSessionState>) {
  const state = createState(stateOverrides);
  const localPlayer = state.players[0] as PlayerPublicState;
  const opponent = state.players[1] as PlayerPublicState;
  const onAnswerSubmit = vi.fn();

  render(
    <DuelPage
      state={state}
      sessionCode={state.sessionCode}
      localPlayer={localPlayer}
      opponent={opponent}
      answer="56"
      onAnswerChange={vi.fn()}
      onAnswerSubmit={onAnswerSubmit}
      onRequestRematch={vi.fn()}
      onNewSession={vi.fn()}
      toasts={[]}
      isSocketConnected={true}
      answerUiState="idle"
      onLeave={vi.fn()}
      isSharePopupOpen={false}
      onCloseSharePopup={vi.fn()}
    />
  );

  return { onAnswerSubmit };
}

describe("DuelPage layout", () => {
  it("affiche la zone score en haut, calcul centré, input en bas et session discrète", () => {
    renderDuel();

    expect(screen.getByTestId("duel-scoreboard")).toBeInTheDocument();
    expect(screen.getByTestId("duel-center-zone")).toHaveTextContent("8 × 7");
    expect(screen.getByTestId("duel-input-zone")).toBeInTheDocument();
    expect(screen.getByLabelText("Session AB12C")).toBeInTheDocument();
    expect(screen.getByText("Adversaire: connecté")).toBeInTheDocument();
  });

  it("soumet la réponse avec la touche Entrée", () => {
    const { onAnswerSubmit } = renderDuel();

    fireEvent.submit(screen.getByTestId("duel-input-zone"));
    expect(onAnswerSubmit).toHaveBeenCalledTimes(1);
  });

  it("garde le focus sur le champ réponse après validation", () => {
    const { onAnswerSubmit } = renderDuel();
    const answerInput = screen.getByLabelText("Réponse");
    const submitButton = screen.getByRole("button", { name: "Valider" });

    answerInput.focus();
    fireEvent.pointerDown(submitButton);
    fireEvent.submit(screen.getByTestId("duel-input-zone"));

    expect(onAnswerSubmit).toHaveBeenCalledTimes(1);
    expect(answerInput).toHaveFocus();
  });

  it("met automatiquement le focus sur le champ réponse", async () => {
    renderDuel();
    await waitFor(() => {
      expect(screen.getByLabelText("Réponse")).toHaveFocus();
    });
  });

  it("garde le champ actif entre deux questions pendant la phase playing", () => {
    renderDuel({
      phase: "playing",
      currentQuestion: null
    });

    expect(screen.getByLabelText("Réponse")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Valider" })).toBeDisabled();
  });

  it("affiche un chrono avant le démarrage de la manche", () => {
    renderDuel({
      phase: "countdown",
      currentQuestion: null,
      countdownRemainingMs: 2_500
    });

    expect(screen.getByLabelText("Début de partie")).toHaveTextContent("Départ dans...");
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("affiche une attente de reconnexion de 60s max", () => {
    renderDuel({
      phase: "paused",
      currentQuestion: null,
      disconnectGraceRemainingMs: 60_000
    });

    expect(screen.getByLabelText("Reconnexion adversaire")).toHaveTextContent(
      "Adversaire déconnecté, reprise automatique si retour avant..."
    );
    expect(screen.getByText("60s")).toBeInTheDocument();
  });

  it("affiche la pop-up de partage avec le code pour le créateur", () => {
    const state = createState({ phase: "waiting", currentQuestion: null });
    const localPlayer = state.players[0] as PlayerPublicState;
    const opponent = state.players[1] as PlayerPublicState;

    render(
      <DuelPage
        state={state}
        sessionCode={state.sessionCode}
        localPlayer={localPlayer}
        opponent={opponent}
        answer=""
        onAnswerChange={vi.fn()}
        onAnswerSubmit={vi.fn()}
        onRequestRematch={vi.fn()}
        onNewSession={vi.fn()}
        toasts={[]}
        isSocketConnected={true}
        answerUiState="idle"
        onLeave={vi.fn()}
        isSharePopupOpen={true}
        onCloseSharePopup={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Partager la session")).toHaveTextContent(
      "Donne ce code à ton adversaire pour qu'il joue contre toi."
    );
    expect(screen.getByLabelText("Code à partager AB12C")).toHaveTextContent("AB12C");
  });
});

describe("DuelPage scores compacts", () => {
  it("affiche des scores discrets pour les 2 joueurs", () => {
    renderDuel();

    expect(screen.getByLabelText("Ton score 7 sur 15")).toHaveTextContent("Toi 7/15");
    expect(screen.getByLabelText("Score de Bob 4 sur 15")).toHaveTextContent("Bob 4/15");
  });

  it("gère les extrêmes 0/15 et 15/15", () => {
    renderDuel({
      players: [
        { playerId: "p1", nickname: "Alice", score: 0, isConnected: true },
        { playerId: "p2", nickname: "Bob", score: 15, isConnected: true }
      ]
    });

    expect(screen.getByLabelText("Ton score 0 sur 15")).toHaveTextContent("Toi 0/15");
    expect(screen.getByLabelText("Score de Bob 15 sur 15")).toHaveTextContent("Bob 15/15");
  });
});

describe("DuelPage fin de partie", () => {
  it("affiche l'overlay final avec score et actions, et bloque l'input", () => {
    renderDuel({
      phase: "finished",
      currentQuestion: null,
      winnerPlayerId: "p1",
      players: [
        { playerId: "p1", nickname: "Alice", score: 15, isConnected: true },
        { playerId: "p2", nickname: "Bob", score: 11, isConnected: true }
      ]
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Score final")).toHaveTextContent("15 - 11");
    expect(screen.getByRole("button", { name: "Revanche" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nouvelle session" })).toBeInTheDocument();
    expect(screen.getByLabelText("Réponse")).toBeDisabled();
  });
});

describe("DuelPage feedback immédiat", () => {
  it("affiche un message visuel selon l'état de réponse", () => {
    const state = createState();
    const localPlayer = state.players[0] as PlayerPublicState;
    const opponent = state.players[1] as PlayerPublicState;

    const { rerender } = render(
      <DuelPage
        state={state}
        sessionCode={state.sessionCode}
        localPlayer={localPlayer}
        opponent={opponent}
        answer="56"
        onAnswerChange={vi.fn()}
        onAnswerSubmit={vi.fn()}
        onRequestRematch={vi.fn()}
        onNewSession={vi.fn()}
        toasts={[]}
        isSocketConnected={true}
        answerUiState="pending"
        onLeave={vi.fn()}
        isSharePopupOpen={false}
        onCloseSharePopup={vi.fn()}
      />
    );

    expect(screen.getByText("Réponse envoyée...")).toBeInTheDocument();

    rerender(
      <DuelPage
        state={state}
        sessionCode={state.sessionCode}
        localPlayer={localPlayer}
        opponent={opponent}
        answer="56"
        onAnswerChange={vi.fn()}
        onAnswerSubmit={vi.fn()}
        onRequestRematch={vi.fn()}
        onNewSession={vi.fn()}
        toasts={[]}
        isSocketConnected={true}
        answerUiState="correct"
        onLeave={vi.fn()}
        isSharePopupOpen={false}
        onCloseSharePopup={vi.fn()}
      />
    );

    expect(screen.getByText("Bien joué, réponse valide.")).toBeInTheDocument();
  });
});
