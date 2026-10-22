import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusState } from "../../lib/focus";

export function useFocus() {
  const [state, setState] = useState<FocusState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const received = useRef(0),
    lock = useRef(false),
    mounted = useRef(true);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const request = useCallback(async (command?: unknown) => {
    if (lock.current && !command) return;
    if (command) setBusy(true);
    const work = async () => {
      lock.current = true;
      try {
        const response = await fetch(
          "/api/focus",
          command
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(command),
                signal: AbortSignal.timeout(10000),
              }
            : { signal: AbortSignal.timeout(10000) },
        );
        const body = (await response.json()) as {
          state: FocusState;
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            body.error || "Your focus journal could not be loaded.",
          );
        if (mounted.current) {
          received.current = performance.now();
          setState(body.state);
          setError("");
        }
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
      } finally {
        lock.current = false;
        if (mounted.current) setBusy(false);
      }
    };
    const next = queue.current.then(work, work);
    queue.current = next;
    return next;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void request();
    const poll = setInterval(() => void request(), 4000);
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      clearInterval(timer);
    };
  }, [request]);
  const elapsed = state?.active
    ? Math.min(
        state.active.targetMinutes * 60000,
        state.active.elapsedMs +
          (state.active.status === "running" && !error
            ? Math.min(20000, performance.now() - received.current)
            : 0),
      )
    : 0;
  return {
    state,
    error,
    busy,
    tick,
    elapsed,
    command: request,
    reload: () => request(),
  };
}
