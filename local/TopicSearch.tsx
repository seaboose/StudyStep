import { useRef, useState } from "react";
import { Search, ArrowRight, Globe, Loader2 } from "lucide-react";
import type { Source } from "../lib/study";
type Result = {
  pageId: number;
  title: string;
  description: string;
  url: string;
};
export default function TopicSearch({
  locked,
  onUse,
}: {
  locked: boolean;
  onUse: (source: Source) => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Result[] | null>(null),
    [source, setSource] = useState<Source | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  async function request(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const data = (await response.json()) as {
      results: Result[];
      source: Source;
      error?: string;
    };
    if (!response.ok) throw Error(data.error || "Search could not finish.");
    return data;
  }
  async function search() {
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    setSource(null);
    setResults(null);
    try {
      const data = await request("/api/topics", { query });
      if (id === requestId.current) setResults(data.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function select(pageId: number) {
    setBusy(true);
    setSource(null);
    setError("");
    try {
      setSource((await request("/api/topics/source", { pageId })).source);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="topic-search" aria-label="Search for a topic">
      <div className="topic-search-heading">
        <Globe size={25} />
        <div>
          <h2>Find a topic</h2>
          <p>
            Search English Wikipedia, then choose an overview to use as source
            material.
          </p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label htmlFor="topic-query">Topic</label>
        <div className="topic-query-row">
          <input
            id="topic-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type any topic you want to study"
            minLength={2}
            maxLength={160}
            required
            disabled={busy || locked}
          />
          <button
            className="primary"
            disabled={busy || locked || query.trim().length < 2}
          >
            {busy ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <Search size={17} />
            )}
            Search
          </button>
        </div>
      </form>
      <p className="small">
        Search sends only your query to English Wikipedia. It needs internet.
        Your uploaded files and local study content are not sent. Results cover
        reference overviews, not a complete course or a general web search.
      </p>
      {error && (
        <p role="alert" className="local-error">
          {error}
        </p>
      )}
      {results && (
        <div className="topic-results" aria-live="polite">
          {!results.length ? (
            <p>
              No matching articles. Try a more specific topic, or upload a
              reading.
            </p>
          ) : (
            results.map((r) => (
              <button
                className="topic-result"
                key={r.pageId}
                disabled={busy || locked}
                onClick={() => void select(r.pageId)}
              >
                <strong>{r.title}</strong>
                <span>{r.description}</span>
                <small>
                  Preview overview <ArrowRight size={13} />
                </small>
              </button>
            ))
          )}
        </div>
      )}
      {source && (
        <article className="topic-preview">
          <span className="eyebrow">SOURCE PREVIEW</span>
          <h3>{source.name}</h3>
          <p className="small">
            {source.attribution} · Retrieved{" "}
            {new Date(source.addedAt).toLocaleDateString()}
          </p>
          <a href={source.originUrl} target="_blank" rel="noreferrer">
            Read original article
          </a>
          <div className="topic-excerpt">
            {source.passages.map((p) => (
              <p key={p.id}>{p.text}</p>
            ))}
          </div>
          <p className="small">{source.warnings[0]}</p>
          <button
            className="primary"
            disabled={busy || locked}
            onClick={() => onUse(source)}
          >
            Use this overview in a new set
            <ArrowRight size={16} />
          </button>
          <p className="small">
            You can review the material, then generate an editable set with
            local AI.
          </p>
        </article>
      )}
    </section>
  );
}
