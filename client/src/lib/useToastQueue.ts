import { useCallback, useEffect, useRef, useState } from "react";
import { nextToastQueue, type ToastInput, type ToastItem } from "./toasts";

export function useToastQueue(durationMs: number = 2000, maxToasts: number = 3) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (incoming: ToastInput) => {
      idRef.current += 1;
      const nextToast: ToastItem = {
        id: idRef.current,
        ...incoming
      };

      setToasts((previous) => {
        const nextQueue = nextToastQueue(previous, nextToast, maxToasts);
        const dropped = previous.filter(
          (toast) => !nextQueue.some((candidate) => candidate.id === toast.id)
        );

        dropped.forEach((toast) => {
          const timer = timersRef.current.get(toast.id);
          if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(toast.id);
          }
        });

        return nextQueue;
      });

      const timer = setTimeout(() => {
        removeToast(nextToast.id);
      }, durationMs);
      timersRef.current.set(nextToast.id, timer);
    },
    [durationMs, maxToasts, removeToast]
  );

  const clearToasts = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return {
    toasts,
    pushToast,
    removeToast,
    clearToasts
  };
}
