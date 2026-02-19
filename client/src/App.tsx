import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  AnswerFeedback,
  JoinSessionResponse,
  PublicSessionState,
  RoundResolvedPayload,
  ServerMessage
} from "@math-duel/shared";
import { DuelPage, type AnswerUiState } from "./components/DuelPage";
import { HomePage } from "./components/HomePage";
import { LobbyPage } from "./components/LobbyPage";
import { toastFromAnswerFeedback, toastFromRoundResolved } from "./lib/toasts";
import { useToastQueue } from "./lib/useToastQueue";
import { socket } from "./lib/socket";

const STORAGE_KEY = "math-duel:session";
const NICKNAME_KEY = "math-duel:nickname";

interface StoredSession {
  sessionCode: string;
  playerToken: string;
  playerId: string;
}

function App() {
  const initialNickname = localStorage.getItem(NICKNAME_KEY) ?? "";
  const [nickname, setNickname] = useState(initialNickname);
  const [isNicknameConfirmed, setIsNicknameConfirmed] = useState(initialNickname.trim().length > 0);
  const [joinCode, setJoinCode] = useState("");
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [session, setSession] = useState<StoredSession | null>(null);
  const [state, setState] = useState<PublicSessionState | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const [isBooting, setIsBooting] = useState(true);
  const [needsRebind, setNeedsRebind] = useState(true);
  const [answerUiState, setAnswerUiState] = useState<AnswerUiState>("idle");
  const [isSharePopupOpen, setIsSharePopupOpen] = useState(false);
  const { toasts, pushToast, clearToasts } = useToastQueue(2000, 3);
  const activeRoundId = state?.currentQuestion?.roundId ?? null;
  const isPlaying = state?.phase === "playing";
  const previousRoundIdRef = useRef<string | null>(null);

  const applyJoinResult = useCallback(
    (response: Extract<JoinSessionResponse, { ok: true }>) => {
      const stored: StoredSession = {
        sessionCode: response.sessionCode,
        playerId: response.playerId,
        playerToken: response.playerToken
      };

      setSession(stored);
      setState(response.state);
      setAnswer("");
      setAnswerUiState("idle");
      setNeedsRebind(false);
      clearToasts();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    },
    [clearToasts]
  );

  const clearSession = useCallback(() => {
    setSession(null);
    setState(null);
    setJoinCode("");
    setAnswer("");
    setFeedback("");
    setAnswerUiState("idle");
    setNeedsRebind(true);
    setIsSharePopupOpen(false);
    clearToasts();
    localStorage.removeItem(STORAGE_KEY);

    // Force socket room cleanup on server before joining another duel.
    socket.disconnect();
    socket.connect();
  }, [clearToasts]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      setIsBooting(false);
      return;
    }

    try {
      const parsed = JSON.parse(stored) as StoredSession;
      setSession(parsed);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }

    setIsBooting(false);
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setIsSocketConnected(true);
    };

    const onDisconnect = () => {
      setIsSocketConnected(false);
      setNeedsRebind(true);
    };

    const onSessionState = (nextState: PublicSessionState) => {
      setState(nextState);
    };

    const onAnswerFeedback = (payload: AnswerFeedback) => {
      const toast = toastFromAnswerFeedback(payload);
      if (toast) {
        pushToast(toast);
      }

      if (payload.accepted && payload.isCorrect) {
        setAnswerUiState("correct");
      } else if (payload.accepted && !payload.isCorrect) {
        setAnswerUiState("incorrect");
      } else {
        setAnswerUiState("incorrect");
      }

      if (payload.accepted && payload.isCorrect) {
        setAnswer("");
      }
    };

    const onRoundResolved = (payload: RoundResolvedPayload) => {
      const toast = toastFromRoundResolved(payload, session?.playerId);
      if (toast) {
        pushToast(toast);
      }
    };

    const onErrorMessage = (payload: ServerMessage) => {
      if (session) {
        pushToast({
          kind: "error",
          message: payload.message
        });
        return;
      }

      setFeedback(payload.message);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("sessionState", onSessionState);
    socket.on("answerFeedback", onAnswerFeedback);
    socket.on("roundResolved", onRoundResolved);
    socket.on("errorMessage", onErrorMessage);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("sessionState", onSessionState);
      socket.off("answerFeedback", onAnswerFeedback);
      socket.off("roundResolved", onRoundResolved);
      socket.off("errorMessage", onErrorMessage);
    };
  }, [pushToast, session, session?.playerId]);

  useEffect(() => {
    if (!isPlaying) {
      previousRoundIdRef.current = activeRoundId;
      setAnswer("");
      setAnswerUiState("idle");
      return;
    }

    if (previousRoundIdRef.current !== activeRoundId) {
      setAnswer("");
      setAnswerUiState("idle");
    }

    previousRoundIdRef.current = activeRoundId;
  }, [activeRoundId, isPlaying]);

  useEffect(() => {
    if (answerUiState !== "correct" && answerUiState !== "incorrect") {
      return;
    }

    const timer = setTimeout(() => {
      setAnswerUiState("idle");
    }, 900);

    return () => {
      clearTimeout(timer);
    };
  }, [answerUiState]);

  useEffect(() => {
    if (!isSharePopupOpen || !state) {
      return;
    }

    if (state.players.length >= 2 || state.phase !== "waiting") {
      setIsSharePopupOpen(false);
    }
  }, [isSharePopupOpen, state]);

  useEffect(() => {
    if (!session || !isSocketConnected || !needsRebind) {
      return;
    }

    socket.emit(
      "reconnectPlayer",
      {
        sessionCode: session.sessionCode,
        playerToken: session.playerToken
      },
      (response: JoinSessionResponse) => {
        if (!response.ok) {
          clearSession();
          return;
        }
        applyJoinResult(response);
      }
    );
  }, [applyJoinResult, clearSession, isSocketConnected, needsRebind, session]);

  const localPlayer = useMemo(() => {
    if (!state || !session) {
      return null;
    }

    return state.players.find((player) => player.playerId === session.playerId) ?? null;
  }, [session, state]);

  const opponent = useMemo(() => {
    if (!state || !session) {
      return null;
    }

    return state.players.find((player) => player.playerId !== session.playerId) ?? null;
  }, [session, state]);

  const duelBackgroundSplit = useMemo(() => {
    if (!state || !localPlayer) {
      return 50;
    }

    if (state.phase === "finished" && state.winnerPlayerId) {
      return state.winnerPlayerId === localPlayer.playerId ? 100 : 0;
    }

    const target = Math.max(1, state.targetScore);
    const localProgress = localPlayer.score / target;
    const opponentProgress = (opponent?.score ?? 0) / target;
    const split = 50 + (localProgress - opponentProgress) * 50;
    return Math.max(0, Math.min(100, split));
  }, [localPlayer, opponent?.score, state]);

  const isDuelPage = Boolean(session && state && localPlayer);
  const pageClassName = isDuelPage ? "page duel-page" : "page";
  const pageStyle = isDuelPage
    ? ({ ["--duel-split" as string]: `${duelBackgroundSplit}%` } as CSSProperties)
    : undefined;

  const handleNicknameSubmit = () => {
    const trimmed = nickname.trim().slice(0, 20);
    if (!trimmed) {
      setFeedback("Choisis un pseudo.");
      return;
    }

    localStorage.setItem(NICKNAME_KEY, trimmed);
    setNickname(trimmed);
    setIsNicknameConfirmed(true);
    setFeedback("");
  };

  const handleCreateSession = () => {
    if (!nickname.trim()) {
      setFeedback("Pseudo requis.");
      return;
    }

    socket.emit("createSession", { nickname }, (response: JoinSessionResponse) => {
      if (!response.ok) {
        setFeedback(response.error);
        return;
      }
      applyJoinResult(response);
      setIsSharePopupOpen(true);
      setFeedback("");
    });
  };

  const handleJoinSession = () => {
    if (!nickname.trim()) {
      setFeedback("Pseudo requis.");
      return;
    }

    const normalizedCode = joinCode.trim().toUpperCase();
    if (normalizedCode.length !== 5) {
      setFeedback("Le code doit contenir 5 caractères.");
      return;
    }

    socket.emit(
      "joinSession",
      { nickname, sessionCode: normalizedCode },
      (response: JoinSessionResponse) => {
        if (!response.ok) {
          setFeedback(response.error);
          return;
        }
        applyJoinResult(response);
        setIsSharePopupOpen(false);
        setFeedback("");
      }
    );
  };

  const handleAnswerSubmit = () => {
    if (!session || !state?.currentQuestion || state.phase !== "playing") {
      return;
    }

    const answerNumber = Number(answer);
    if (Number.isNaN(answerNumber)) {
      setFeedback("Entre un nombre valide.");
      setAnswerUiState("incorrect");
      return;
    }

    setAnswerUiState("pending");

    socket.emit("submitAnswer", {
      sessionCode: session.sessionCode,
      roundId: state.currentQuestion.roundId,
      answer: answerNumber
    });
  };

  const handleRequestRematch = () => {
    if (!session) {
      return;
    }

    socket.emit("requestRematch", { sessionCode: session.sessionCode });
  };

  if (isBooting) {
    return (
      <main className={pageClassName} style={pageStyle}>
        <section className="card card-sm">
          <p className="subtitle">Chargement…</p>
        </section>
      </main>
    );
  }

  return (
    <main className={pageClassName} style={pageStyle}>
      {!isNicknameConfirmed ? (
        <HomePage
          nickname={nickname}
          onNicknameChange={setNickname}
          onSubmit={handleNicknameSubmit}
        />
      ) : !session || !state || !localPlayer ? (
        <LobbyPage
          nickname={nickname}
          joinCode={joinCode}
          onJoinCodeChange={setJoinCode}
          onCreateSession={handleCreateSession}
          onJoinSession={handleJoinSession}
          feedback={feedback}
        />
      ) : (
        <DuelPage
          state={state}
          sessionCode={session.sessionCode}
          localPlayer={localPlayer}
          opponent={opponent}
          answer={answer}
          onAnswerChange={setAnswer}
          onAnswerSubmit={handleAnswerSubmit}
          onRequestRematch={handleRequestRematch}
          onNewSession={clearSession}
          toasts={toasts}
          isSocketConnected={isSocketConnected}
          answerUiState={answerUiState}
          onLeave={clearSession}
          isSharePopupOpen={isSharePopupOpen}
          onCloseSharePopup={() => setIsSharePopupOpen(false)}
        />
      )}
    </main>
  );
}

export default App;
