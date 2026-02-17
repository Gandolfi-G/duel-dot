export const TARGET_SCORE = 15;

export type SessionCode = string;
export type PlayerId = string;
export type PlayerToken = string;

export type GamePhase = "waiting" | "countdown" | "playing" | "paused" | "finished";

export interface PlayerPublicState {
  playerId: PlayerId;
  nickname: string;
  score: number;
  isConnected: boolean;
}

export interface QuestionPublicState {
  roundId: string;
  left: number;
  right: number;
  prompt: string;
}

export interface PublicSessionState {
  sessionCode: SessionCode;
  phase: GamePhase;
  targetScore: number;
  players: PlayerPublicState[];
  currentQuestion: QuestionPublicState | null;
  countdownRemainingMs: number | null;
  disconnectGraceRemainingMs: number | null;
  winnerPlayerId: PlayerId | null;
  rematchRequestedBy: PlayerId[];
}

export interface CreateSessionPayload {
  nickname: string;
}

export interface JoinSessionPayload {
  sessionCode: string;
  nickname: string;
}

export interface ReconnectPlayerPayload {
  sessionCode: string;
  playerToken: string;
}

export interface SubmitAnswerPayload {
  sessionCode: string;
  roundId: string;
  answer: number;
}

export interface RequestRematchPayload {
  sessionCode: string;
}

export interface JoinResultOk {
  ok: true;
  sessionCode: SessionCode;
  playerId: PlayerId;
  playerToken: PlayerToken;
  state: PublicSessionState;
}

export interface JoinResultError {
  ok: false;
  error: string;
}

export type JoinSessionResponse = JoinResultOk | JoinResultError;

export interface AnswerFeedback {
  roundId: string;
  accepted: boolean;
  isCorrect: boolean;
  message: string;
}

export interface RoundResolvedPayload {
  roundId: string;
  winnerPlayerId: PlayerId;
  winnerScore: number;
  correctAnswer: number;
}

export interface ServerMessage {
  message: string;
}

export interface ServerToClientEvents {
  sessionState: (state: PublicSessionState) => void;
  answerFeedback: (payload: AnswerFeedback) => void;
  roundResolved: (payload: RoundResolvedPayload) => void;
  errorMessage: (payload: ServerMessage) => void;
}

export interface ClientToServerEvents {
  createSession: (
    payload: CreateSessionPayload,
    callback: (response: JoinSessionResponse) => void
  ) => void;
  joinSession: (
    payload: JoinSessionPayload,
    callback: (response: JoinSessionResponse) => void
  ) => void;
  reconnectPlayer: (
    payload: ReconnectPlayerPayload,
    callback: (response: JoinSessionResponse) => void
  ) => void;
  submitAnswer: (payload: SubmitAnswerPayload) => void;
  requestRematch: (payload: RequestRematchPayload) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  sessionCode?: SessionCode;
  playerId?: PlayerId;
}
