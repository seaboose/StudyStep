import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Flag,
  Map,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { Citation, Workspace } from "../lib/study";
import type { Deck, DeckState } from "../lib/review";
type Snapshot = { deck: Deck; state: DeckState; due: number; now: number };
export default function Flashcards({
  data,
  mode,
  locked,
  openCitation,
  onMaterials,
}: {
  data: Workspace;
  mode: "cards" | "trail";
  locked: boolean;
  openCitation: (citation: Citation) => void;
  onMaterials: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState("");
  const requestLock = useRef(false),
    mounted = useRef(true),
    sequence = useRef(0);
  const signature = JSON.stringify([data.guide, data.sources]);
  async function load(command?: unknown) {
    if (requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    const seq = ++sequence.current;
    try {
      const response = await fetch(
        "/api/review",
        command
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(command),
              signal: AbortSignal.timeout(10000),
            }
          : { signal: AbortSignal.timeout(10000) },
      );
      const value = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok)
        throw Error(value.error || "Could not save your review.");
      if (mounted.current && seq === sequence.current) {
        setSnapshot(value);
        setError("");
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      requestLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    setSnapshot(null);
    void load();
    return () => {
      mounted.current = false;
    };
  }, [signature]);
  const session = snapshot?.state.session;
  const item = session?.queue[session.index];
  const card = snapshot?.deck.cards.find((c) => c.id === item?.cardId);
  useEffect(() => {
    setDraft("");
  }, [session?.id, session?.index]);
  const disabled = busy || locked || !snapshot || !!error;
  const playing = session && !session.finished;
  const trail = playing ? session.mode === "trail" : mode === "trail";
  const uniqueCount = session
    ? session.queue.filter((i) => !i.retry).length
    : 0;
  function start(ahead = false) {
    if (snapshot)
      void load({
        type: "start",
        deckId: snapshot.deck.id,
        id: crypto.randomUUID(),
        mode,
        ahead,
      });
  }
  function command(type: "reveal" | "rate", rating?: string) {
    if (snapshot && session)
      void load({
        type,
        deckId: snapshot.deck.id,
        id: session.id,
        index: session.index,
        ...(rating ? { rating } : {}),
      });
  }
  const dates = Object.values(snapshot?.state.progress || {})
    .map((p) => p.due)
    .filter((t) => t > (snapshot?.now || 0));
  const nextDue = dates.length
    ? new Date(Math.min(...dates)).toLocaleString()
    : null;
  function exportProgress() {
    if (!snapshot) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { format: "studystep-review-export", version: 1, ...snapshot },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "studystep-flashcard-progress.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className={`recall-space ${trail ? "trail-mode" : ""}`}>
      <div className="content-heading">
        <div>
          <h1>{trail ? "Recall Trail" : "Flashcards"}</h1>
          <p>
            {trail
              ? "Review up to five cards to complete a path. Difficult cards return for a retry."
              : "Try an answer in your own words, compare it with the reference, and choose when to revisit it."}
          </p>
        </div>
        {trail ? <Map size={38} /> : <BookOpen size={38} />}
      </div>
      {error && (
        <div className="alert error" role="alert">
          <span>{error}</span>
          <button onClick={() => void load()} disabled={busy}>
            Reload review
          </button>
        </div>
      )}
      {!snapshot && !error && <p role="status">Opening your flashcards…</p>}
      {snapshot && !snapshot.deck.cards.length && (
        <div className="empty-learning">
          <BookOpen size={35} />
          <h2>No flashcards yet</h2>
          <p>
            Upload a file or search a topic, then generate and save a study set.
            Nothing is preloaded into the card pool.
          </p>
          <button className="primary" onClick={onMaterials}>
            Create a study set
            <ArrowRight size={17} />
          </button>
        </div>
      )}
      {snapshot && snapshot.deck.cards.length > 0 && (
        <>
          <div className="recall-deck-info">
            <strong>{snapshot.deck.title}</strong>
            <span>
              {snapshot.deck.cards.length} cards · {snapshot.due} due ·{" "}
              {snapshot.state.trails} trails completed
            </span>
          </div>
          {!playing && (
            <div className="recall-start">
              {session?.finished && (
                <div className="trail-finish" role="status">
                  <Flag size={30} />
                  <h2>
                    {session.mode === "trail"
                      ? "Trail complete"
                      : "Round saved"}
                  </h2>
                  <p>
                    {session.rated.length} cards reviewed · {session.recalled}{" "}
                    self-rated as recalled on the first try.
                  </p>
                  <p>
                    {session.missed.length
                      ? "Cards you wanted to revisit are scheduled in about ten minutes."
                      : "Your next review dates are saved."}{" "}
                    These ratings describe your experience, not verified
                    mastery.
                  </p>
                </div>
              )}
              {!session && (
                <>
                  <h2>{trail ? "Start a trail" : "Review cards"}</h2>
                  <p>
                    {trail
                      ? "Attempt each prompt before turning it over. Each reviewed card adds a stone; difficult cards return for one short retry."
                      : "Review up to twenty due cards in a round. You can leave and continue later."}
                  </p>
                </>
              )}
              <button
                className="primary"
                disabled={disabled}
                onClick={() => start(snapshot.due === 0)}
              >
                {trail ? <Map size={17} /> : <BookOpen size={17} />}
                {snapshot.due
                  ? trail
                    ? "Start trail"
                    : "Review due cards"
                  : "Practice ahead (optional)"}
              </button>
              {!snapshot.due && (
                <p className="small">
                  Nothing is due right now.
                  {nextDue && ` Next review: ${nextDue}.`} Extra practice does
                  not postpone a scheduled review.
                </p>
              )}
            </div>
          )}
          {playing && card && (
            <>
              {trail && (
                <div
                  className="trail-path"
                  role="img"
                  aria-label={`${session.rated.length} of ${uniqueCount} stepping stones built`}
                >
                  {Array.from({ length: uniqueCount }, (_, i) => (
                    <span
                      key={i}
                      className={i < session.rated.length ? "built" : ""}
                    >
                      {i < session.rated.length ? <Check size={21} /> : i + 1}
                    </span>
                  ))}
                  <Flag size={24} />
                </div>
              )}
              <article className="recall-card">
                <div className="unit-top">
                  <span className="pill">
                    {item?.retry
                      ? "RETRY"
                      : `CARD ${session.rated.length + 1} OF ${uniqueCount}`}
                  </span>
                  <span>Untimed · saved as you review</span>
                </div>
                <p className="recall-topic">{card.topic}</p>
                <h2>{card.front}</h2>
                {!session.revealed ? (
                  <>
                    <label htmlFor="recall-draft">
                      Try recalling it first{" "}
                      <small>
                        Optional · this response is not saved or automatically
                        graded
                      </small>
                    </label>
                    <textarea
                      id="recall-draft"
                      rows={3}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      maxLength={2000}
                      placeholder="Say it aloud, think it through, or write it here…"
                      disabled={disabled}
                    />
                    <button
                      className="primary"
                      disabled={disabled}
                      onClick={() => command("reveal")}
                    >
                      Reveal reference answer
                      <ArrowRight size={17} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="recall-answer">
                      <span className="eyebrow">REFERENCE ANSWER</span>
                      <p>{card.back}</p>
                      {card.detail !== card.back && (
                        <p className="small">{card.detail}</p>
                      )}
                      {draft && (
                        <details>
                          <summary>Your attempt</summary>
                          <p>{draft}</p>
                        </details>
                      )}
                      {card.citations.length ? (
                        <div className="citations">
                          {card.citations.map((c, i) => (
                            <button key={i} onClick={() => openCitation(c)}>
                              <BookOpen size={14} />
                              Check source {i + 1}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="small">
                          No linked source for this card. Review imported or
                          manually edited answers against your material.
                        </p>
                      )}
                    </div>
                    <h3>How did recall feel?</h3>
                    <p className="small">
                      Compare your attempt with the answer. Choose honestly;
                      every review builds the path.
                    </p>
                    <div className="recall-ratings">
                      <button
                        className="secondary"
                        disabled={disabled}
                        onClick={() => command("rate", "again")}
                      >
                        <RotateCcw size={17} />
                        <span>
                          Not yet<small>Retry, then about 10 minutes</small>
                        </span>
                      </button>
                      <button
                        className="secondary"
                        disabled={disabled}
                        onClick={() => command("rate", "hard")}
                      >
                        <BookOpen size={17} />
                        <span>
                          With effort
                          <small>
                            {item?.retry
                              ? "About 10 minutes"
                              : "Tomorrow, or the earlier due date"}
                          </small>
                        </span>
                      </button>
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() => command("rate", "good")}
                      >
                        <Sparkles size={17} />
                        <span>
                          Recalled it
                          <small>
                            {item?.retry
                              ? "Keep the short revisit"
                              : "Space the next review"}
                          </small>
                        </span>
                      </button>
                    </div>
                    {item?.retry && (
                      <p className="small">
                        This short retry is practice. The card remains due in
                        about ten minutes, even if it feels easier now.
                      </p>
                    )}
                  </>
                )}
              </article>
              <p className="small">
                You can leave this screen and resume the saved round.
                Unsubmitted writing stays only on this screen.
              </p>
            </>
          )}
          <details className="review-method">
            <summary>How this practice works</summary>
            <p>
              Attempting an answer before revealing it uses retrieval practice.
              Feedback lets you correct mistakes. Due dates spread later
              practice across time. Our simple schedule uses approximately 10
              minutes after a miss, tomorrow after effortful recall, and 1, 3,
              7, 14, then 30 days after due cards are recalled. These are
              practical defaults, not a personally validated optimal schedule.
            </p>
            <p>
              The trail rewards participation. It does not measure intelligence,
              attention, or mastery. This game has not been clinically evaluated
              for ADHD.
            </p>
            <p>
              Research:{" "}
              <a
                href="https://www.psychologicalscience.org/publications/journals/pspi/learning-techniques.html"
                target="_blank"
                rel="noreferrer"
              >
                Dunlosky and colleagues: learning techniques
              </a>
              ;{" "}
              <a
                href="https://doi.org/10.1007/s10648-019-09498-w"
                target="_blank"
                rel="noreferrer"
              >
                Sailer and Homner: gamification meta-analysis
              </a>
              .
            </p>
            <button className="text-button" onClick={exportProgress}>
              Export this deck’s review record
            </button>
            <p className="small">
              Review records are separate from the study-set backup. The export
              is for inspection; restoring all review history requires a copy of
              review.json with StudyStep closed.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
