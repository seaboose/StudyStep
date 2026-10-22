import { useEffect, useRef, useState, type SetStateAction } from "react";
import type { Guide } from "../lib/study";
import { retainReviewed } from "../lib/card-review";
export type Recovery = {
  version: number;
  baseKey: string;
  draft: {
    guide: Guide;
    reviewedIds: string[];
    problems: string[];
    baseKey: string;
    savedAt: string;
  } | null;
};
export async function draftRequest(
  method = "GET",
  body?: unknown,
): Promise<Recovery> {
  const r = await fetch("/api/editor-draft", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const value = (await r.json()) as Recovery & { error?: string };
  if (!r.ok)
    throw Error(
      value.error ||
        "Draft could not be saved. Keep this window open and try again.",
    );
  return value;
}
export function useDraftRecovery(
  initial: Guide,
  recovery: Recovery,
  problems: string[],
  onStored: (value: Recovery) => void,
) {
  const initialReview = recovery.draft?.reviewedIds || [];
  const [draft, setValue] = useState(initial),
    [reviewedIds, setReviewedValue] = useState(initialReview),
    [status, setStatus] = useState("Saving draft…"),
    [error, setError] = useState("");
  const latest = useRef({ guide: initial, reviewedIds: initialReview }),
    saved = useRef(
      recovery.draft
        ? JSON.stringify({
            guide: recovery.draft.guide,
            reviewedIds: initialReview,
          })
        : "",
    ),
    version = useRef(recovery.version),
    pending = useRef<Promise<void> | null>(null),
    closed = useRef(false);
  const baseKey = recovery.baseKey;
  function setDraft(value: SetStateAction<Guide>) {
    const next =
      typeof value === "function" ? value(latest.current.guide) : value;
    const reviewed = retainReviewed(
      latest.current.guide,
      next,
      latest.current.reviewedIds,
    );
    latest.current = { guide: next, reviewedIds: reviewed };
    setValue(next);
    setReviewedValue(reviewed);
    setStatus("Saving draft…");
  }
  function setReviewedIds(ids: string[]) {
    latest.current = { ...latest.current, reviewedIds: ids };
    setReviewedValue(ids);
    setStatus("Saving draft…");
  }
  async function flush() {
    if (pending.current) {
      await pending.current;
      return flush();
    }
    const work = async () => {
      while (
        !closed.current &&
        saved.current !== JSON.stringify(latest.current)
      ) {
        const snapshot = latest.current,
          encoded = JSON.stringify(snapshot);
        const result = await draftRequest("PUT", {
          version: version.current,
          baseKey,
          ...snapshot,
          problems,
        });
        version.current = result.version;
        saved.current = encoded;
        onStored(result);
      }
      setStatus("Draft saved on this computer");
      setError("");
    };
    const promise = work();
    pending.current = promise;
    try {
      await promise;
    } catch (e) {
      setStatus("Draft not saved");
      setError((e as Error).message);
      throw e;
    } finally {
      if (pending.current === promise) pending.current = null;
    }
  }
  async function discard() {
    await flush();
    const result = await draftRequest("DELETE", { version: version.current });
    closed.current = true;
    saved.current = JSON.stringify(latest.current);
    onStored(result);
  }
  useEffect(() => {
    const timer = setTimeout(() => void flush().catch(() => {}), 350);
    return () => clearTimeout(timer);
  }, [draft, reviewedIds]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (!closed.current && saved.current !== JSON.stringify(latest.current)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  return {
    draft,
    setDraft,
    reviewedIds,
    setReviewedIds,
    status,
    error,
    flush,
    discard,
  };
}
