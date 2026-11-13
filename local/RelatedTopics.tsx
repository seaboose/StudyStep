import { useState } from "react";
import type { Workspace } from "../lib/study";

type Decision = NonNullable<Workspace["relatedTopics"]>[number];
type Suggestion = Omit<Decision, "status">;
type Result = { pageId: number; title: string; description: string };
const generic = new Set(
  "what why when which how does introduction overview basics notes study guide chapter about into from with this that these those example topic material".split(
    " ",
  ),
);
const words = (text: string) =>
  (text.toLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? []).filter(
    (w) => w.length > 2 && !generic.has(w),
  );

export default function RelatedTopics({
  data,
  locked,
  onDecision,
}: {
  data: Workspace;
  locked: boolean;
  onDecision: (item: Decision) => void;
}) {
  const units = data.guide?.units ?? [];
  const contexts = units.length
    ? units.map((u) => ({
        title: u.title,
        text: u.keyPoints.join(" "),
        prerequisite: u.keyPoints[0],
      }))
    : data.sources.map((s) => ({
        title: s.name.replace(/\.(pdf|docx?|md|txt)$/i, ""),
        text: s.passages[0]?.text ?? "",
        prerequisite: "Be able to summarize the main idea in " + s.name + ".",
      }));
  const [index, setIndex] = useState(0),
    [results, setResults] = useState<Suggestion[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const context = contexts[index] ?? contexts[0];
  const query = (
    words(context.title).join(" ") ||
    words(context.text).slice(0, 3).join(" ") ||
    context.title
  ).slice(0, 160);
  const decisions = data.relatedTopics ?? [];
  const visible =
    results?.filter((r) => !decisions.some((d) => d.pageId === r.pageId)) ?? [];
  async function discover() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || "Topic search failed.");
      const vocabulary = new Set(words(context.title + " " + context.text));
      const already = new Set([
        ...contexts.map((c) => c.title.toLowerCase()),
        ...data.sources.map((s) => s.name.toLowerCase()),
      ]);
      const matches = (body.results as Result[])
        .flatMap((r) => {
          const overlap = [
            ...new Set(
              words(r.title + " " + r.description).filter((w) =>
                vocabulary.has(w),
              ),
            ),
          ];
          if (
            !overlap.length ||
            !r.description ||
            already.has(r.title.toLowerCase()) ||
            /may refer to|disambiguation/i.test(r.description + " " + r.title)
          )
            return [];
          return [
            {
              score: overlap.length,
              item: {
                pageId: r.pageId,
                title: r.title,
                reason:
                  `Your topic “${context.title}” and this article cover ${overlap.slice(0, 3).join(", ")}. ${r.description}`.slice(
                    0,
                    2400,
                  ),
                prerequisite: context.prerequisite,
              },
            },
          ];
        })
        .sort((a, b) => b.score - a.score);
      setResults(matches.map((m) => m.item));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="topic-search" aria-label="Related topics">
      <h2>Related topics</h2>
      {contexts.length > 1 && (
        <label>
          Study topic{" "}
          <select
            disabled={busy}
            value={index}
            onChange={(e) => {
              setIndex(Number(e.target.value));
              setResults(null);
              setError("");
            }}
          >
            {contexts.map((c, i) => (
              <option key={i} value={i}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <p>
        Find related Wikipedia readings for “{context.title}”. Search terms:{" "}
        {query}.
      </p>
      <button
        disabled={busy || locked}
        className="secondary"
        onClick={() => void discover()}
      >
        {busy ? "Finding related topics…" : "Suggest related topics"}
      </button>
      {error && <p role="alert">{error}</p>}
      {results && !visible.length && <p>No further matches for this topic.</p>}
      {visible.slice(0, 3).map((s) => (
        <article className="topic-preview" key={s.pageId}>
          <h3>{s.title}</h3>
          <p>
            <strong>Why it fits</strong> · {s.reason}
          </p>
          <p>
            <strong>Know first</strong> · {s.prerequisite}
          </p>
          <button
            className="primary"
            disabled={locked || decisions.length >= 500}
            onClick={() => onDecision({ ...s, status: "accepted" })}
          >
            Accept topic
          </button>
          <button
            className="secondary"
            disabled={locked || decisions.length >= 500}
            onClick={() => onDecision({ ...s, status: "dismissed" })}
          >
            Dismiss
          </button>
        </article>
      ))}
      {decisions.some((d) => d.status === "accepted") && (
        <div>
          <h3>Reading list</h3>
          {decisions
            .filter((d) => d.status === "accepted")
            .map((d) => (
              <details key={d.pageId}>
                <summary>{d.title}</summary>
                <p>{d.reason}</p>
                <p>
                  <strong>Know first</strong> · {d.prerequisite}
                </p>
                <a
                  href={`https://en.wikipedia.org/?curid=${d.pageId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Read article
                </a>
              </details>
            ))}
        </div>
      )}
    </section>
  );
}
