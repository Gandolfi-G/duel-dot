import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  type ClientToServerEvents,
  type InterServerEvents,
  type JoinSessionResponse,
  type PlayerId,
  type PlayerToken,
  type PublicSessionState,
  type ServerToClientEvents,
  type SocketData,
  TARGET_SCORE
} from "@math-duel/shared";
import {
  applyRematchRequest,
  awardPoint,
  createScores,
  evaluateAnswer,
  finalizeRound,
  generateRound,
  LATENCY_TIE_THRESHOLD_MS,
  resolveRoundTimeout,
  type InternalRound
} from "./game/engine.js";

interface PlayerState {
  playerId: PlayerId;
  playerToken: PlayerToken;
  nickname: string;
  socketId: string | null;
  isConnected: boolean;
}

interface SessionState {
  sessionCode: string;
  phase: "waiting" | "countdown" | "playing" | "paused" | "finished";
  players: PlayerState[];
  scores: Record<string, number>;
  currentRound: InternalRound | null;
  countdownEndsAt: number | null;
  winnerPlayerId: string | null;
  rematchRequestedBy: Set<string>;
  resumePhase: "countdown" | "playing" | null;
  disconnectDeadlineAt: number | null;
  disconnectGraceTimer: NodeJS.Timeout | null;
  nextRoundTimer: NodeJS.Timeout | null;
  roundTimeoutTimer: NodeJS.Timeout | null;
  roundResolutionTimer: NodeJS.Timeout | null;
  startCountdownTimer: NodeJS.Timeout | null;
  countdownTickTimer: NodeJS.Timeout | null;
}

const SESSION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SESSION_CODE_LENGTH = 5;
const NEXT_ROUND_DELAY_MS = 900;
const START_COUNTDOWN_MS = 3_000;
const COUNTDOWN_TICK_MS = 200;
const ROUND_TIMEOUT_MS = 10_000;
const DISCONNECT_GRACE_MS = 60_000;
const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  {
    cors: {
      origin: CLIENT_ORIGIN
    }
  }
);

const sessions = new Map<string, SessionState>();

io.on("connection", (socket) => {
  socket.on("createSession", (payload, callback) => {
    const nickname = sanitizeNickname(payload.nickname);
    if (!nickname) {
      callback({ ok: false, error: "Pseudo invalide." });
      return;
    }

    const sessionCode = generateSessionCode();
    const player = createPlayer(socket.id, nickname);

    const session: SessionState = {
      sessionCode,
      phase: "waiting",
      players: [player],
      scores: createScores([player.playerId]),
      currentRound: null,
      countdownEndsAt: null,
      winnerPlayerId: null,
      rematchRequestedBy: new Set<string>(),
      resumePhase: null,
      disconnectDeadlineAt: null,
      disconnectGraceTimer: null,
      nextRoundTimer: null,
      roundTimeoutTimer: null,
      roundResolutionTimer: null,
      startCountdownTimer: null,
      countdownTickTimer: null
    };

    sessions.set(sessionCode, session);
    bindPlayerToSocket(socket.id, sessionCode, player.playerId);
    socket.join(sessionCode);

    const response: JoinSessionResponse = {
      ok: true,
      sessionCode,
      playerId: player.playerId,
      playerToken: player.playerToken,
      state: toPublicState(session)
    };

    callback(response);
    broadcastSessionState(sessionCode);
  });

  socket.on("joinSession", (payload, callback) => {
    const sessionCode = payload.sessionCode.trim().toUpperCase();
    const nickname = sanitizeNickname(payload.nickname);
    const session = sessions.get(sessionCode);

    if (!nickname) {
      callback({ ok: false, error: "Pseudo invalide." });
      return;
    }

    if (!session) {
      callback({ ok: false, error: "Code session introuvable." });
      return;
    }

    if (session.players.length >= 2) {
      callback({ ok: false, error: "Session déjà complète." });
      return;
    }

    const player = createPlayer(socket.id, nickname);
    session.players.push(player);
    session.scores[player.playerId] = 0;
    session.rematchRequestedBy.clear();

    bindPlayerToSocket(socket.id, sessionCode, player.playerId);
    socket.join(sessionCode);

    if (session.players.every((candidate) => candidate.isConnected)) {
      clearDisconnectGraceTimer(session);
      if (session.phase === "paused") {
        resumePausedSession(session);
      } else {
        maybeStartGame(session);
      }
    }

    callback({
      ok: true,
      sessionCode,
      playerId: player.playerId,
      playerToken: player.playerToken,
      state: toPublicState(session)
    });

    broadcastSessionState(sessionCode);
  });

  socket.on("reconnectPlayer", (payload, callback) => {
    const sessionCode = payload.sessionCode.trim().toUpperCase();
    const session = sessions.get(sessionCode);

    if (!session) {
      callback({ ok: false, error: "Session introuvable." });
      return;
    }

    const player = session.players.find((candidate) => candidate.playerToken === payload.playerToken);
    if (!player) {
      callback({ ok: false, error: "Reconnexion refusée." });
      return;
    }

    if (player.socketId && player.socketId !== socket.id) {
      playerBySocket.delete(player.socketId);
    }

    player.socketId = socket.id;
    player.isConnected = true;

    bindPlayerToSocket(socket.id, sessionCode, player.playerId);
    socket.join(sessionCode);

    if (session.players.every((candidate) => candidate.isConnected)) {
      clearDisconnectGraceTimer(session);
      if (session.phase === "paused") {
        resumePausedSession(session);
      } else {
        maybeStartGame(session);
      }
    }

    callback({
      ok: true,
      sessionCode,
      playerId: player.playerId,
      playerToken: player.playerToken,
      state: toPublicState(session)
    });

    broadcastSessionState(sessionCode);
  });

  socket.on("submitAnswer", (payload) => {
    const session = sessions.get(payload.sessionCode.trim().toUpperCase());
    const playerBinding = getPlayerFromSocket(socket.id);

    if (!session || !playerBinding || playerBinding.sessionCode !== session.sessionCode) {
      return;
    }

    if (session.phase !== "playing" || !session.currentRound) {
      socket.emit("answerFeedback", {
        roundId: payload.roundId,
        accepted: false,
        isCorrect: false,
        message: "Aucune question active."
      });
      return;
    }

    if (payload.roundId !== session.currentRound.roundId) {
      socket.emit("answerFeedback", {
        roundId: payload.roundId,
        accepted: false,
        isCorrect: false,
        message: "Question expirée."
      });
      return;
    }

    if (!Number.isFinite(payload.answer)) {
      socket.emit("answerFeedback", {
        roundId: payload.roundId,
        accepted: false,
        isCorrect: false,
        message: "Réponse invalide."
      });
      return;
    }

    const evaluated = evaluateAnswer(
      session.currentRound,
      playerBinding.playerId,
      payload.answer,
      Date.now()
    );

    if (evaluated.outcome === "ignored") {
      socket.emit("answerFeedback", {
        roundId: payload.roundId,
        accepted: false,
        isCorrect: false,
        message:
          evaluated.reason === "duplicate-submission"
            ? "Réponse déjà envoyée pour cette manche."
            : "Point déjà attribué pour cette question."
      });
      return;
    }

    if (evaluated.outcome === "incorrect") {
      socket.emit("answerFeedback", {
        roundId: payload.roundId,
        accepted: true,
        isCorrect: false,
        message: "Incorrect, attends la question suivante."
      });
      return;
    }

    session.currentRound = evaluated.round;
    clearRoundTimeoutTimer(session);
    scheduleRoundResolution(session, payload.roundId);

    socket.emit("answerFeedback", {
      roundId: payload.roundId,
      accepted: true,
      isCorrect: true,
      message: "Bonne réponse reçue, validation en cours."
    });
  });

  socket.on("requestRematch", (payload) => {
    const session = sessions.get(payload.sessionCode.trim().toUpperCase());
    const playerBinding = getPlayerFromSocket(socket.id);

    if (
      !session ||
      !playerBinding ||
      playerBinding.sessionCode !== session.sessionCode ||
      session.phase !== "finished"
    ) {
      return;
    }

    clearDisconnectGraceTimer(session);
    clearCountdownTimers(session);
    clearNextRoundTimer(session);
    clearRoundTimeoutTimer(session);
    clearRoundResolutionTimer(session);
    const rematchResult = applyRematchRequest(session, playerBinding.playerId, generateRound);
    if (rematchResult.started) {
      session.countdownEndsAt = null;
      scheduleRoundTimeout(session);
    }

    broadcastSessionState(session.sessionCode);
  });

  socket.on("disconnect", () => {
    const playerBinding = getPlayerFromSocket(socket.id);
    playerBySocket.delete(socket.id);

    if (!playerBinding) {
      return;
    }

    const session = sessions.get(playerBinding.sessionCode);
    if (!session) {
      return;
    }

    const player = session.players.find((candidate) => candidate.playerId === playerBinding.playerId);
    if (!player) {
      return;
    }

    player.socketId = null;
    player.isConnected = false;

    if (session.phase === "countdown" || session.phase === "playing") {
      pauseSessionForDisconnect(session);
      scheduleDisconnectGraceTimer(session);
    }

    broadcastSessionState(session.sessionCode);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

function createPlayer(socketId: string, nickname: string): PlayerState {
  return {
    playerId: createOpaqueId(),
    playerToken: createOpaqueId(),
    nickname,
    socketId,
    isConnected: true
  };
}

function sanitizeNickname(raw: string): string {
  return raw.trim().slice(0, 20);
}

function generateSessionCode(): string {
  let code = "";
  do {
    code = Array.from({ length: SESSION_CODE_LENGTH }, () => {
      const index = Math.floor(Math.random() * SESSION_CODE_ALPHABET.length);
      return SESSION_CODE_ALPHABET[index];
    }).join("");
  } while (sessions.has(code));

  return code;
}

function createOpaqueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function maybeStartGame(session: SessionState): void {
  if (session.phase !== "waiting") {
    return;
  }

  if (session.players.length !== 2) {
    return;
  }

  if (session.players.some((player) => !player.isConnected)) {
    return;
  }

  startGameCountdown(session);
}

function startGameCountdown(
  session: SessionState,
  options: {
    resetScores?: boolean;
  } = {}
): void {
  const resetScores = options.resetScores ?? true;

  clearDisconnectGraceTimer(session);
  clearCountdownTimers(session);
  clearNextRoundTimer(session);
  clearRoundTimeoutTimer(session);
  clearRoundResolutionTimer(session);

  session.phase = "countdown";
  session.resumePhase = null;
  session.winnerPlayerId = null;
  session.currentRound = null;
  session.rematchRequestedBy.clear();
  if (resetScores) {
    session.scores = createScores(session.players.map((player) => player.playerId));
  }
  session.countdownEndsAt = Date.now() + START_COUNTDOWN_MS;

  session.countdownTickTimer = setInterval(() => {
    if (session.phase !== "countdown") {
      clearCountdownTickTimer(session);
      return;
    }
    broadcastSessionState(session.sessionCode);
  }, COUNTDOWN_TICK_MS);

  session.startCountdownTimer = setTimeout(() => {
    session.startCountdownTimer = null;
    if (session.phase !== "countdown") {
      return;
    }

    clearCountdownTickTimer(session);
    session.phase = "playing";
    session.countdownEndsAt = null;
    startNewRound(session);
    broadcastSessionState(session.sessionCode);
  }, START_COUNTDOWN_MS);
}

function pauseSessionForDisconnect(session: SessionState): void {
  if (session.phase !== "countdown" && session.phase !== "playing") {
    return;
  }

  clearCountdownTimers(session);
  clearNextRoundTimer(session);
  clearRoundTimeoutTimer(session);
  clearRoundResolutionTimer(session);
  session.resumePhase = session.phase;
  session.phase = "paused";
  session.countdownEndsAt = null;
  session.currentRound = null;
}

function resumePausedSession(session: SessionState): void {
  if (session.phase !== "paused") {
    return;
  }

  const canResume = session.players.length === 2 && session.players.every((player) => player.isConnected);
  if (!canResume) {
    return;
  }

  startGameCountdown(session, { resetScores: false });
}

function clearStartCountdownTimer(session: SessionState): void {
  if (!session.startCountdownTimer) {
    return;
  }
  clearTimeout(session.startCountdownTimer);
  session.startCountdownTimer = null;
}

function clearCountdownTickTimer(session: SessionState): void {
  if (!session.countdownTickTimer) {
    return;
  }
  clearInterval(session.countdownTickTimer);
  session.countdownTickTimer = null;
}

function clearCountdownTimers(session: SessionState): void {
  clearStartCountdownTimer(session);
  clearCountdownTickTimer(session);
}

function clearNextRoundTimer(session: SessionState): void {
  if (!session.nextRoundTimer) {
    return;
  }
  clearTimeout(session.nextRoundTimer);
  session.nextRoundTimer = null;
}

function clearRoundTimeoutTimer(session: SessionState): void {
  if (!session.roundTimeoutTimer) {
    return;
  }
  clearTimeout(session.roundTimeoutTimer);
  session.roundTimeoutTimer = null;
}

function clearRoundResolutionTimer(session: SessionState): void {
  if (!session.roundResolutionTimer) {
    return;
  }
  clearTimeout(session.roundResolutionTimer);
  session.roundResolutionTimer = null;
}

function clearDisconnectGraceTimer(session: SessionState): void {
  if (!session.disconnectGraceTimer) {
    session.disconnectDeadlineAt = null;
    return;
  }

  clearTimeout(session.disconnectGraceTimer);
  session.disconnectGraceTimer = null;
  session.disconnectDeadlineAt = null;
}

function scheduleDisconnectGraceTimer(session: SessionState): void {
  clearDisconnectGraceTimer(session);
  session.disconnectDeadlineAt = Date.now() + DISCONNECT_GRACE_MS;
  session.disconnectGraceTimer = setTimeout(() => {
    session.disconnectGraceTimer = null;
    session.disconnectDeadlineAt = null;

    const connectedPlayers = session.players.filter((player) => player.isConnected);
    const disconnectedPlayers = session.players.length - connectedPlayers.length;
    if (disconnectedPlayers === 0) {
      return;
    }

    if (connectedPlayers.length === 0) {
      sessions.delete(session.sessionCode);
      return;
    }

    clearCountdownTimers(session);
    clearNextRoundTimer(session);
    clearRoundTimeoutTimer(session);
    clearRoundResolutionTimer(session);
    session.phase = "finished";
    session.resumePhase = null;
    session.currentRound = null;
    session.winnerPlayerId = connectedPlayers[0].playerId;
    session.rematchRequestedBy.clear();
    broadcastSessionState(session.sessionCode);
  }, DISCONNECT_GRACE_MS);
}

function startNewRound(session: SessionState): void {
  session.countdownEndsAt = null;
  clearRoundResolutionTimer(session);
  clearRoundTimeoutTimer(session);
  session.currentRound = generateRound();
  scheduleRoundTimeout(session);
}

function scheduleRoundTimeout(session: SessionState): void {
  if (!session.currentRound) {
    return;
  }

  clearRoundTimeoutTimer(session);
  const roundId = session.currentRound.roundId;
  session.roundTimeoutTimer = setTimeout(() => {
    session.roundTimeoutTimer = null;
    if (session.phase !== "playing" || !session.currentRound) {
      return;
    }

    if (session.currentRound.roundId !== roundId) {
      return;
    }

    const timeoutResolution = resolveRoundTimeout(
      session.currentRound,
      Date.now(),
      ROUND_TIMEOUT_MS,
      generateRound
    );
    if (!timeoutResolution.timedOut) {
      return;
    }

    clearRoundResolutionTimer(session);
    session.currentRound = timeoutResolution.round;
    scheduleRoundTimeout(session);
    broadcastSessionState(session.sessionCode);
  }, ROUND_TIMEOUT_MS);
}

function scheduleRoundResolution(session: SessionState, roundId: string): void {
  if (session.roundResolutionTimer) {
    return;
  }

  session.roundResolutionTimer = setTimeout(() => {
    session.roundResolutionTimer = null;
    if (session.phase !== "playing" || !session.currentRound) {
      return;
    }

    if (session.currentRound.roundId !== roundId) {
      return;
    }

    const finalizedRound = finalizeRound(session.currentRound);
    if (!finalizedRound.winnerPlayerId) {
      return;
    }

    session.currentRound = finalizedRound;
    resolveRoundWithWinner(session);
  }, LATENCY_TIE_THRESHOLD_MS);
}

function scheduleNextRound(session: SessionState): void {
  clearNextRoundTimer(session);
  session.nextRoundTimer = setTimeout(() => {
    session.nextRoundTimer = null;
    if (session.phase !== "playing" || session.currentRound) {
      return;
    }

    startNewRound(session);
    broadcastSessionState(session.sessionCode);
  }, NEXT_ROUND_DELAY_MS);
}

function resolveRoundWithWinner(session: SessionState): void {
  if (!session.currentRound?.winnerPlayerId) {
    return;
  }

  clearDisconnectGraceTimer(session);
  clearRoundTimeoutTimer(session);
  clearRoundResolutionTimer(session);

  const winnerPlayerId = session.currentRound.winnerPlayerId;
  const pointResult = awardPoint(session.scores, winnerPlayerId, TARGET_SCORE);
  session.scores = pointResult.scores;

  io.to(session.sessionCode).emit("roundResolved", {
    roundId: session.currentRound.roundId,
    winnerPlayerId,
    winnerScore: pointResult.playerScore,
    correctAnswer: session.currentRound.expected
  });

  if (pointResult.winnerPlayerId) {
    clearNextRoundTimer(session);
    session.phase = "finished";
    session.winnerPlayerId = pointResult.winnerPlayerId;
    session.currentRound = null;
    session.rematchRequestedBy.clear();
    broadcastSessionState(session.sessionCode);
    return;
  }

  session.currentRound = null;
  broadcastSessionState(session.sessionCode);
  scheduleNextRound(session);
}

function toPublicState(session: SessionState): PublicSessionState {
  const countdownRemainingMs =
    session.phase === "countdown" && session.countdownEndsAt
      ? Math.max(0, session.countdownEndsAt - Date.now())
      : null;
  const disconnectGraceRemainingMs =
    session.phase === "paused" && session.disconnectDeadlineAt
      ? Math.max(0, session.disconnectDeadlineAt - Date.now())
      : null;

  return {
    sessionCode: session.sessionCode,
    phase: session.phase,
    targetScore: TARGET_SCORE,
    players: session.players.map((player) => ({
      playerId: player.playerId,
      nickname: player.nickname,
      score: session.scores[player.playerId] ?? 0,
      isConnected: player.isConnected
    })),
    currentQuestion: session.currentRound
      ? {
          roundId: session.currentRound.roundId,
          left: session.currentRound.left,
          right: session.currentRound.right,
          prompt: `${session.currentRound.left} × ${session.currentRound.right}`
        }
      : null,
    countdownRemainingMs,
    disconnectGraceRemainingMs,
    winnerPlayerId: session.winnerPlayerId,
    rematchRequestedBy: Array.from(session.rematchRequestedBy)
  };
}

function broadcastSessionState(sessionCode: string): void {
  const session = sessions.get(sessionCode);
  if (!session) {
    return;
  }

  io.to(sessionCode).emit("sessionState", toPublicState(session));
}

interface PlayerBinding {
  sessionCode: string;
  playerId: string;
}

const playerBySocket = new Map<string, PlayerBinding>();

function bindPlayerToSocket(socketId: string, sessionCode: string, playerId: string): void {
  playerBySocket.set(socketId, { sessionCode, playerId });
}

function getPlayerFromSocket(socketId: string): PlayerBinding | null {
  return playerBySocket.get(socketId) ?? null;
}
