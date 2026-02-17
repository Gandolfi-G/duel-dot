import type { AnswerFeedback, RoundResolvedPayload } from "@math-duel/shared";

export type ToastKind = "success" | "warning" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastInput {
  kind: ToastKind;
  message: string;
}

export function nextToastQueue(
  previous: ToastItem[],
  incoming: ToastItem,
  maxToasts: number = 3
): ToastItem[] {
  return [...previous, incoming].slice(-maxToasts);
}

export function toastFromAnswerFeedback(payload: AnswerFeedback): ToastInput | null {
  if (payload.accepted && payload.isCorrect) {
    return {
      kind: "success",
      message: "✅ +1 point"
    };
  }

  if (!payload.isCorrect) {
    return {
      kind: "error",
      message: "❌ Mauvaise réponse"
    };
  }

  return null;
}

export function toastFromRoundResolved(
  payload: RoundResolvedPayload,
  localPlayerId: string | undefined
): ToastInput | null {
  if (!localPlayerId) {
    return null;
  }

  if (payload.winnerPlayerId === localPlayerId) {
    return null;
  }

  return {
    kind: "warning",
    message: "⚠️ L'adversaire marque"
  };
}
