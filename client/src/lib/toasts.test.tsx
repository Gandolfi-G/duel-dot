import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnswerFeedback, RoundResolvedPayload } from "@math-duel/shared";
import { toastFromAnswerFeedback, toastFromRoundResolved } from "./toasts";
import { useToastQueue } from "./useToastQueue";

describe("toast mapping", () => {
  it("mappe un point gagné vers ✅ +1 point", () => {
    const feedback: AnswerFeedback = {
      roundId: "r1",
      accepted: true,
      isCorrect: true,
      message: "Bravo"
    };

    expect(toastFromAnswerFeedback(feedback)).toEqual({
      kind: "success",
      message: "✅ +1 point"
    });
  });

  it("mappe une mauvaise réponse locale vers ❌", () => {
    const feedback: AnswerFeedback = {
      roundId: "r2",
      accepted: true,
      isCorrect: false,
      message: "Incorrect"
    };

    expect(toastFromAnswerFeedback(feedback)).toEqual({
      kind: "error",
      message: "❌ Mauvaise réponse"
    });
  });

  it("mappe un point adverse vers ⚠️", () => {
    const resolved: RoundResolvedPayload = {
      roundId: "r3",
      winnerPlayerId: "p2",
      winnerScore: 3,
      correctAnswer: 72
    };

    expect(toastFromRoundResolved(resolved, "p1")).toEqual({
      kind: "warning",
      message: "⚠️ L'adversaire marque"
    });
  });

  it("ne crée pas de toast roundResolved pour le joueur local gagnant", () => {
    const resolved: RoundResolvedPayload = {
      roundId: "r4",
      winnerPlayerId: "p1",
      winnerScore: 5,
      correctAnswer: 18
    };

    expect(toastFromRoundResolved(resolved, "p1")).toBeNull();
    expect(toastFromRoundResolved(resolved, undefined)).toBeNull();
  });

  it("retourne null pour un feedback sans erreur exploitable", () => {
    const feedback: AnswerFeedback = {
      roundId: "r5",
      accepted: false,
      isCorrect: true,
      message: "Ignoré"
    };

    expect(toastFromAnswerFeedback(feedback)).toBeNull();
  });
});

describe("useToastQueue", () => {
  it("limite à 3 toasts simultanés", () => {
    const { result } = renderHook(() => useToastQueue(2000, 3));

    act(() => {
      result.current.pushToast({ kind: "success", message: "1" });
      result.current.pushToast({ kind: "success", message: "2" });
      result.current.pushToast({ kind: "warning", message: "3" });
      result.current.pushToast({ kind: "error", message: "4" });
    });

    expect(result.current.toasts).toHaveLength(3);
    expect(result.current.toasts.map((toast) => toast.message)).toEqual(["2", "3", "4"]);
  });

  it("fait disparaître automatiquement les toasts", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToastQueue(1800, 3));

    act(() => {
      result.current.pushToast({ kind: "success", message: "temp" });
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1801);
    });

    expect(result.current.toasts).toHaveLength(0);
    vi.useRealTimers();
  });
});
