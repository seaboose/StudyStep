import { useEffect, useRef, useState } from "react";
import type { Guide, Workspace } from "../lib/study";
import {
  editGuide,
  validateLocalGuide,
  readableError,
} from "../lib/local-study";
import { removeCard } from "../lib/card-review";
import { useDraftRecovery, type Recovery } from "./useDraftRecovery";

type Props = {
  data: Workspace;
  recovery: Recovery;
  onStored: (r: Recovery) => void;
  save: (data: Workspace) => Promise<void>;
  close: () => void;
  advanced: () => void;
};
export default function CardReview({
  data,
  recovery,
  onStored,
  save,
  close,
  advanced,
}: Props) {
  const initial = recovery.draft?.guide || data.guide!;
  const recover = useDraftRecovery(
    structuredClone(initial),
    recovery,
    recovery.draft?.problems || [],
    onStored,
  );
  const { draft, setDraft, reviewedIds, setReviewedIds } = recover;
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      initial.units.findIndex(
        (u) => !recovery.draft?.reviewedIds?.includes(u.id),
      ),
    ),
  );
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [removed, setRemoved] = useState<{
    guide: Guide;
    reviewedIds: string[];
    index: number;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const unit = draft.units[Math.min(index, draft.units.length - 1)];
  const questions = draft.questions.filter((q) => q.unitId === unit.id);
  const citations = [
    ...unit.citations,
    ...questions.flatMap((q) => q.citations),
  ].filter(
    (c, i, a) =>
      a.findIndex((x) => x.passageId === c.passageId && x.quote === c.quote) ===
      i,
  );
  const allKept = draft.units.every((u) => reviewedIds.includes(u.id));
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [unit.id]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  const leave = () =>
    void run(async () => {
      await recover.flush();
      close();
    });
  function exportDraft() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ guide: draft, reviewedIds }, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "studystep-editor-draft.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function patchUnit(patch: Partial<Guide["units"][number]>) {
    setDraft((d) => ({
      ...d,
      units: d.units.map((u) => (u.id === unit.id ? { ...u, ...patch } : u)),
      questions: d.questions.map((q) => {
        if (
          q.unitId !== unit.id ||
          q.prompt !== unit.recallPrompt ||
          q.options[q.correctIndex].text !== unit.recallAnswer
        )
          return q;
        return {
          ...q,
          prompt: patch.recallPrompt ?? q.prompt,
          options: q.options.map((o, i) => ({
            ...o,
            text:
              i === q.correctIndex ? (patch.recallAnswer ?? o.text) : o.text,
            explanation: "",
          })),
        };
      }),
    }));
  }
  function patchQuestion(
    id: string,
    patch: Partial<Guide["questions"][number]>,
  ) {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q) =>
        q.id === id
          ? {
              ...q,
              ...patch,
              options: (patch.options || q.options).map((o) => ({
                ...o,
                explanation: "",
              })),
            }
          : q,
      ),
    }));
  }
  function keep() {
    try {
      if (!unit.recallPrompt.trim() || !unit.recallAnswer.trim())
        throw Error(
          "Add a question and reference answer before keeping this card.",
        );
      validateLocalGuide({ ...draft, units: [unit], questions }, data.sources);
      const ids = [...new Set([...reviewedIds, unit.id])];
      setReviewedIds(ids);
      setEditing(false);
      setError("");
      const next = draft.units.findIndex(
        (u, i) => i > index && !ids.includes(u.id),
      );
      const earlier = draft.units.findIndex((u) => !ids.includes(u.id));
      if (next >= 0) setIndex(next);
      else if (earlier >= 0) setIndex(earlier);
    } catch (e) {
      setError(readableError(e));
      setEditing(true);
    }
  }
  const field = (
    label: string,
    value: string,
    change: (s: string) => void,
    max = 500,
  ) => (
    <label className="local-field">
      <span>{label}</span>
      <textarea
        rows={2}
        value={value}
        maxLength={max}
        onChange={(e) => change(e.target.value)}
      />
    </label>
  );
  return (
    <dialog
      ref={dialog}
      className="modal local-dialog card-review-dialog"
      aria-label="Review cards"
      onCancel={(e) => {
        e.preventDefault();
        leave();
      }}
    >
      <div className="modal-heading">
        <h2>Review cards</h2>
        <button
          className="icon-button"
          aria-label="Keep draft and close"
          disabled={busy}
          onClick={leave}
        >
          ×
        </button>
      </div>
      <div className="review-summary">
        <p role="status">
          {reviewedIds.length} of {draft.units.length} kept · {recover.status}
        </p>
        <p>
          Compare each answer with its source. Keeping a card records your
          review; it is not an accuracy guarantee.
        </p>
      </div>
      {(error || recover.error) && (
        <p className="local-error" role="alert">
          {error || recover.error}
          {recover.error && (
            <>
              <button onClick={() => void run(recover.flush)}>
                Retry draft save
              </button>
              <button onClick={exportDraft}>Export draft</button>
            </>
          )}
        </p>
      )}
      {draft.gaps.length > 0 && (
        <details className="review-coverage">
          <summary>Coverage notes ({draft.gaps.length})</summary>
          <ul>
            {draft.gaps.map((gap, i) => (
              <li key={i}>{gap}</li>
            ))}
          </ul>
        </details>
      )}
      {removed && (
        <p role="status">
          Card removed.{" "}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setDraft(removed.guide);
              setReviewedIds(removed.reviewedIds);
              setIndex(removed.index);
              setRemoved(null);
              setEditing(false);
            }}
          >
            Undo removal
          </button>
        </p>
      )}
      <fieldset disabled={busy} className="local-editor-fields">
        <div className="review-pair">
          <section aria-label="Card to review" className="review-card">
            <p className="review-position">
              Card {index + 1} of {draft.units.length}
              {reviewedIds.includes(unit.id) ? " · Kept" : ""}
            </p>
            <h3 ref={heading} tabIndex={-1}>
              {unit.title || "Untitled card"}
            </h3>
            {editing ? (
              <>
                {field("Card question", unit.recallPrompt, (value) =>
                  patchUnit({ recallPrompt: value }),
                )}
                {field(
                  "Reference answer",
                  unit.recallAnswer,
                  (value) => patchUnit({ recallAnswer: value }),
                  1200,
                )}
                <p className="small">
                  Edits are not automatically checked. Source excerpts remain
                  here for comparison.
                </p>
              </>
            ) : (
              <>
                <p className="review-prompt">
                  {unit.recallPrompt || "Add a question to this card."}
                </p>
                <div className="review-answer">
                  <strong>Reference answer</strong>
                  <p>{unit.recallAnswer || "Add a reference answer."}</p>
                </div>
              </>
            )}
            {questions.length > 0 && (
              <details className="review-choices">
                <summary>Practice choices ({questions.length})</summary>
                {questions.map((q, i) => (
                  <section key={q.id}>
                    {editing ? (
                      <>
                        {field(
                          `Practice question ${i + 1}`,
                          q.prompt,
                          (value) => patchQuestion(q.id, { prompt: value }),
                          900,
                        )}
                        {q.options.map((option, j) => (
                          <div key={j}>
                            {field(`Choice ${j + 1}`, option.text, (value) =>
                              patchQuestion(q.id, {
                                options: q.options.map((o, k) =>
                                  k === j ? { ...o, text: value } : o,
                                ),
                              }),
                            )}
                          </div>
                        ))}
                        <label className="local-field">
                          <span>Correct choice for question {i + 1}</span>
                          <select
                            value={q.correctIndex}
                            onChange={(e) =>
                              patchQuestion(q.id, {
                                correctIndex: Number(e.target.value),
                              })
                            }
                          >
                            {q.options.map((_, j) => (
                              <option key={j} value={j}>
                                Choice {j + 1}
                              </option>
                            ))}
                          </select>
                        </label>
                        {field(`Hint ${i + 1}`, q.hint, (value) =>
                          patchQuestion(q.id, { hint: value }),
                        )}
                      </>
                    ) : (
                      <>
                        <p>
                          <strong>{q.prompt}</strong>
                        </p>
                        <ol type="A">
                          {q.options.map((o, j) => (
                            <li key={j}>
                              {o.text}
                              {j === q.correctIndex ? (
                                <strong> — Answer key</strong>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                        {q.hint && <p className="small">Hint: {q.hint}</p>}
                      </>
                    )}
                  </section>
                ))}
              </details>
            )}
            <div className="review-actions">
              <button className="primary" onClick={keep}>
                Keep & next
              </button>
              <button
                className="secondary"
                aria-pressed={editing}
                onClick={() => setEditing(!editing)}
              >
                {editing ? "Show card" : "Edit"}
              </button>
              <button
                className="text-button"
                disabled={draft.units.length === 1}
                onClick={() => {
                  setRemoved({
                    guide: structuredClone(draft),
                    reviewedIds: [...reviewedIds],
                    index,
                  });
                  setDraft(removeCard(draft, unit.id));
                  setIndex(Math.min(index, draft.units.length - 2));
                  setEditing(false);
                }}
              >
                Remove card
              </button>
            </div>
          </section>
          <aside className="review-evidence" aria-label="Source beside card">
            <h3>Source</h3>
            {citations.length ? (
              citations.map((c, i) => {
                const source = data.sources.find((s) =>
                  s.passages.some((p) => p.id === c.passageId),
                );
                const passage = source?.passages.find(
                  (p) => p.id === c.passageId,
                );
                return (
                  <section key={`${c.passageId}-${i}`}>
                    <p className="review-source-name">
                      <strong>{source?.name || "Source unavailable"}</strong>
                      <br />
                      {passage?.label}
                    </p>
                    <blockquote>{c.quote}</blockquote>
                    {passage && (
                      <details>
                        <summary>Read full section</summary>
                        <p className="source-context">{passage.text}</p>
                      </details>
                    )}
                    {source?.originUrl && (
                      <a
                        href={source.originUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Original article
                      </a>
                    )}
                  </section>
                );
              })
            ) : (
              <>
                <p>
                  This card has no linked source. Check it against your
                  materials before keeping it.
                </p>
                {data.sources.map((s) => (
                  <details key={s.id}>
                    <summary>{s.name}</summary>
                    {s.passages.map((p) => (
                      <section key={p.id}>
                        <strong>{p.label}</strong>
                        <p className="source-context">{p.text}</p>
                      </section>
                    ))}
                  </details>
                ))}
              </>
            )}
          </aside>
        </div>
        <nav
          className="review-navigation"
          aria-label="Move between review cards"
        >
          <button
            className="secondary"
            disabled={index === 0}
            onClick={() => {
              setIndex(index - 1);
              setEditing(false);
            }}
          >
            Previous card
          </button>
          <button
            className="secondary"
            disabled={index === draft.units.length - 1}
            onClick={() => {
              setIndex(index + 1);
              setEditing(false);
            }}
          >
            Next card
          </button>
          <button
            className="text-button"
            onClick={() =>
              void run(async () => {
                await recover.flush();
                advanced();
              })
            }
          >
            More editing options
          </button>
        </nav>
      </fieldset>
      <div className="editor-footer">
        <button className="secondary" disabled={busy} onClick={leave}>
          Keep draft & close
        </button>
        <span className="small">
          {allKept
            ? "All cards reviewed. Saving replaces the current set."
            : "Keep each card before saving the set."}
        </span>
        <button
          className="primary"
          disabled={busy || !allKept}
          onClick={() =>
            void run(async () => {
              validateLocalGuide(draft, data.sources);
              await recover.flush();
              await save(editGuide(data, draft));
              await recover.discard();
              close();
            })
          }
        >
          {busy ? "Saving…" : "Save study set"}
        </button>
      </div>
    </dialog>
  );
}
