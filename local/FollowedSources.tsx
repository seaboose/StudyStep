import { useEffect, useRef, useState } from "react";
type Follow = {
  pageId: number;
  title: string;
  cadence: string;
  checked: number;
  error: string;
  pending: null | { token: string; added: string[]; removed: string[] };
};
export async function followRequest(
  command?: Record<string, unknown>,
): Promise<Follow[]> {
  const response = await fetch(
    "/api/topic-follows",
    command
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        }
      : undefined,
  );
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error || "Could not load followed sources.");
  return data;
}
export const frequencies = (
  <>
    <option value="daily">Every day</option>
    <option value="weekly">Every week</option>
    <option value="monthly">Every 30 days</option>
  </>
);
export default function FollowedSources() {
  const [rows, setRows] = useState<Follow[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const version = useRef(0);
  async function refresh(cmd?: Record<string, unknown>) {
    const id = ++version.current;
    if (cmd) setBusy(true);
    try {
      const result = await followRequest(cmd);
      if (id === version.current) {
        setRows(result);
        setError("");
      }
    } catch (e) {
      if (id === version.current) setError((e as Error).message);
    } finally {
      if (cmd) setBusy(false);
    }
  }
  useEffect(() => {
    const reload = () => {
      void refresh();
    };
    reload();
    const timer = setInterval(reload, 60000);
    window.addEventListener("topic-follow-changed", reload);
    return () => {
      version.current++;
      clearInterval(timer);
      window.removeEventListener("topic-follow-changed", reload);
    };
  }, []);
  if (!rows.length && !error) return null;
  return (
    <section className="topic-search" aria-label="Followed sources">
      <h2>Followed sources</h2>
      <p className="small">
        StudyStep checks while open and catches up when you return.
      </p>
      {error && <p role="alert">{error}</p>}
      {rows.map((r) => (
        <article className="topic-preview" key={r.pageId}>
          <h3>
            <a
              href={`https://en.wikipedia.org/?curid=${r.pageId}`}
              target="_blank"
              rel="noreferrer"
            >
              {r.title}
            </a>
          </h3>
          <label>
            Check frequency{" "}
            <select
              disabled={busy}
              value={r.cadence}
              onChange={(e) =>
                void refresh({
                  action: "cadence",
                  pageId: r.pageId,
                  cadence: e.target.value,
                })
              }
            >
              {frequencies}
            </select>
          </label>
          <button
            disabled={busy}
            className="secondary"
            onClick={() => void refresh({ action: "check", pageId: r.pageId })}
          >
            Check now
          </button>
          <button
            disabled={busy}
            className="text-button"
            onClick={() =>
              void refresh({ action: "unfollow", pageId: r.pageId })
            }
          >
            Stop following
          </button>
          {r.error && <p role="status">{r.error}</p>}
          {r.pending && (
            <details key={r.pending.token}>
              <summary>Review source update</summary>
              {r.pending.removed.length > 0 && (
                <>
                  <h4>Previous wording</h4>
                  <ul>
                    {r.pending.removed.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
              {r.pending.added.length > 0 && (
                <>
                  <h4>New wording</h4>
                  <ul>
                    {r.pending.added.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void refresh({
                    action: "review",
                    pageId: r.pageId,
                    token: r.pending!.token,
                  })
                }
              >
                Mark reviewed
              </button>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
