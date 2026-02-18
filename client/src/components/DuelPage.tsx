import { useEffect, useRef } from "react";
import type { PlayerPublicState, PublicSessionState } from "@math-duel/shared";
import type { ToastItem } from "../lib/toasts";

export type AnswerUiState = "idle" | "pending" | "correct" | "incorrect";

interface DuelPageProps {
  state: PublicSessionState;
  sessionCode: string;
  localPlayer: PlayerPublicState;
  opponent: PlayerPublicState | null;
  answer: string;
  onAnswerChange: (value: string) => void;
  onAnswerSubmit: () => void;
  onRequestRematch: () => void;
  onNewSession: () => void;
  toasts: ToastItem[];
  isSocketConnected: boolean;
  answerUiState: AnswerUiState;
  onLeave: () => void;
  isSharePopupOpen: boolean;
  onCloseSharePopup: () => void;
}

export function DuelPage({
  state,
  sessionCode,
  localPlayer,
  opponent,
  answer,
  onAnswerChange,
  onAnswerSubmit,
  onRequestRematch,
  onNewSession,
  toasts,
  isSocketConnected,
  answerUiState,
  onLeave,
  isSharePopupOpen,
  onCloseSharePopup
}: DuelPageProps) {
  const targetScore = state.targetScore;
  const opponentScore = opponent?.score ?? 0;
  const question = state.currentQuestion;
  const canAnswer = state.phase === "playing" && Boolean(question);
  const winner = state.players.find((player) => player.playerId === state.winnerPlayerId);
  const localRematchRequested = state.rematchRequestedBy.includes(localPlayer.playerId);
  const opponentName = opponent?.nickname ?? "Adversaire";
  const answerInputRef = useRef<HTMLInputElement>(null);
  const countdownSeconds =
    state.phase === "countdown" && state.countdownRemainingMs !== null
      ? Math.max(1, Math.ceil(state.countdownRemainingMs / 1000))
      : null;
  const reconnectSeconds =
    state.phase === "paused" && state.disconnectGraceRemainingMs !== null
      ? Math.max(1, Math.ceil(state.disconnectGraceRemainingMs / 1000))
      : null;

  useEffect(() => {
    if (!canAnswer) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      answerInputRef.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [canAnswer, question?.roundId]);

  const immediateFeedbackText =
    answerUiState === "correct"
      ? "Bien joué, réponse valide."
      : answerUiState === "incorrect"
        ? "Réponse incorrecte."
        : answerUiState === "pending"
          ? "Réponse envoyée..."
          : "À toi de jouer.";

  return (
    <section className={`card duel-shell ui-${answerUiState}`}>
      <p className="session-code-discreet" aria-label={`Session ${sessionCode}`}>
        #{sessionCode}
      </p>

      <div className="duel-header duel-header-actions">
        <div className="status-pills">
          <p className={`status-pill ${isSocketConnected ? "status-online" : "status-offline"}`}>
            Toi: {isSocketConnected ? "connecté" : "hors ligne"}
          </p>
          <p
            className={`status-pill ${opponent?.isConnected ? "status-online" : "status-offline"}`}
            role="status"
            aria-live="polite"
          >
            Adversaire: {opponent?.isConnected ? "connecté" : "déconnecté"}
          </p>
        </div>
        <button type="button" onClick={onLeave} className="ghost-btn duel-quit">
          Quitter
        </button>
      </div>

      <div className="duel-scoreboard" data-testid="duel-scoreboard">
        <p className="score-chip score-chip-local" aria-label={`Ton score ${localPlayer.score} sur ${targetScore}`}>
          Toi <strong>{localPlayer.score}</strong>/{targetScore}
        </p>
        <p
          className="score-chip score-chip-opponent"
          aria-label={`Score de ${opponentName} ${opponentScore} sur ${targetScore}`}
        >
          {opponentName} <strong>{opponentScore}</strong>/{targetScore}
        </p>
      </div>

      <div className="duel-center-zone" data-testid="duel-center-zone">
        {state.phase === "waiting" ? (
          <p className="waiting-text">Partage le code pour lancer le duel à 2 joueurs.</p>
        ) : state.phase === "paused" ? (
          <div className="countdown-zone" aria-live="polite" aria-label="Reconnexion adversaire">
            <p className="countdown-label">Adversaire déconnecté, reprise automatique si retour avant...</p>
            <p className="duel-countdown" key={`reconnect-${reconnectSeconds}`}>
              {reconnectSeconds}s
            </p>
          </div>
        ) : state.phase === "countdown" ? (
          <div className="countdown-zone" aria-live="polite" aria-label="Début de partie">
            <p className="countdown-label">Départ dans...</p>
            <p className="duel-countdown" key={`countdown-${countdownSeconds}`}>
              {countdownSeconds}
            </p>
          </div>
        ) : (
          <p className="duel-question" key={question?.roundId ?? "waiting"}>
            {question ? question.prompt : "Question suivante..."}
          </p>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAnswerSubmit();
          requestAnimationFrame(() => {
            if (!canAnswer) {
              return;
            }
            answerInputRef.current?.focus({ preventScroll: true });
          });
        }}
        className={`duel-input-zone input-${answerUiState}`}
        data-testid="duel-input-zone"
      >
        <input
          ref={answerInputRef}
          type="number"
          inputMode="numeric"
          value={answer}
          onChange={(event) => onAnswerChange(event.target.value)}
          placeholder="Ta réponse"
          disabled={!canAnswer}
          aria-label="Réponse"
        />
        <button
          type="submit"
          className="primary-btn"
          disabled={!canAnswer}
          onPointerDown={(event) => event.preventDefault()}
        >
          Valider
        </button>
      </form>
      <p className={`answer-immediate-feedback feedback-${answerUiState}`} role="status" aria-live="polite">
        {immediateFeedbackText}
      </p>

      <aside className="toast-stack" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <p key={toast.id} className={`toast toast-${toast.kind}`}>
            {toast.message}
          </p>
        ))}
      </aside>

      {isSharePopupOpen ? (
        <div className="session-share-overlay" role="dialog" aria-modal="true" aria-label="Partager la session">
          <article className="session-share-card">
            <h3>Invite ton adversaire</h3>
            <p className="subtitle">Donne ce code à ton adversaire pour qu&apos;il joue contre toi.</p>
            <p className="share-session-code" aria-label={`Code à partager ${sessionCode}`}>
              {sessionCode}
            </p>
            <button type="button" className="primary-btn" onClick={onCloseSharePopup}>
              J&apos;ai compris
            </button>
          </article>
        </div>
      ) : null}

      {state.phase === "finished" ? (
        <div className="match-overlay" role="dialog" aria-modal="true">
          <article className="match-overlay-card">
            <h2>Fin de partie</h2>
            <p className="subtitle">
              {winner?.playerId === localPlayer.playerId ? "Tu as gagné !" : `${winner?.nickname} gagne.`}
            </p>
            <p className="final-score" aria-label="Score final">
              {localPlayer.score} - {opponentScore}
            </p>
            <div className="overlay-actions">
              <button
                type="button"
                onClick={onRequestRematch}
                className="primary-btn"
                disabled={localRematchRequested}
              >
                {localRematchRequested ? "Revanche demandée" : "Revanche"}
              </button>
              <button type="button" onClick={onNewSession} className="secondary-btn">
                Nouvelle session
              </button>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
