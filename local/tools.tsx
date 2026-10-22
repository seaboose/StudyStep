import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Plus,
  Download,
  Upload,
  Pencil,
  Monitor,
  Trash2,
  X,
} from "lucide-react";
import {
  useDraftRecovery,
  draftRequest,
  type Recovery,
} from "./useDraftRecovery";
import CardReview from "./CardReview";
import type { Guide, Workspace } from "../lib/study";
import {
  editGuide,
  exportBackup,
  exportChatSet,
  newGuide,
  newUnit,
  parseStudyImport,
  readableError,
  validateLocalGuide,
} from "../lib/local-study";

function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="modal local-dialog"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Field({
  label,
  value,
  onChange,
  large = false,
  max = 1800,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  large?: boolean;
  max?: number;
}) {
  return (
    <label className="local-field">
      <span>{label}</span>
      {large ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          maxLength={max}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={max}
        />
      )}
    </label>
  );
}
function Editor({
  data,
  save,
  close,
  aiDraft,
  recovery,
  onStored,
}: {
  data: Workspace;
  save: (data: Workspace) => Promise<void>;
  close: () => void;
  recovery: Recovery;
  onStored: (r: Recovery) => void;
  aiDraft?: { guide: Guide; problems: string[] } | null;
}) {
  const recover = useDraftRecovery(
    structuredClone(
      recovery.draft?.guide || aiDraft?.guide || data.guide || newGuide(),
    ),
    recovery,
    recovery.draft?.problems || aiDraft?.problems || [],
    onStored,
  );
  const { draft, setDraft } = recover;
  const [index, setIndex] = useState(0),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [discard, setDiscard] = useState(false);

  const unit = draft.units[index];
  function patchUnit(patch: Partial<Guide["units"][number]>) {
    setDraft((d) => ({
      ...d,
      units: d.units.map((u, i) =>
        i === index ? { ...u, ...patch, citations: [] } : u,
      ),
    }));
  }
  function patchQuestion(
    id: string,
    patch: Partial<Guide["questions"][number]>,
  ) {
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q) =>
        q.id === id ? { ...q, ...patch, citations: [] } : q,
      ),
    }));
  }
  function requestClose() {
    if (saving) return;
    setSaving(true);
    void recover
      .flush()
      .then(close)
      .catch((e) => setError(readableError(e)))
      .finally(() => setSaving(false));
  }
  return (
    <Dialog
      title={
        aiDraft
          ? "Review your local AI draft"
          : data.guide
            ? "Edit study set"
            : "Create a study set"
      }
      close={requestClose}
    >
      <p className="draft-status" role="status">
        {recover.status}
      </p>
      {recover.error && (
        <p role="alert" className="local-error">
          {recover.error}{" "}
          <button
            className="secondary"
            onClick={() => void recover.flush().catch(() => {})}
          >
            Retry draft save
          </button>
        </p>
      )}
      <p className="small">
        Write in your own words. Questions are optional. Saving keeps practice
        results for unchanged questions; edited questions start fresh. Editing
        content removes its existing citations. Check the edited text against
        your material.
      </p>
      {aiDraft && (
        <div className="local-callout">
          <strong>Check this draft before saving</strong>
          <p>
            Source quotes were matched to your material. Model review can miss
            mistakes or flag correct content. Saving accepts the draft and
            replaces the current set.
          </p>
          {aiDraft.problems.length > 0 ? (
            <ul>
              {aiDraft.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : (
            <p>
              The model reported no specific problems. This is not a guarantee
              of accuracy.
            </p>
          )}
          <details>
            <summary>Read original material</summary>
            {data.sources.map((s) => (
              <section key={s.id}>
                <h3>{s.name}</h3>
                {s.passages.map((p) => (
                  <p key={p.id}>{p.text}</p>
                ))}
              </section>
            ))}
          </details>
        </div>
      )}
      {error && (
        <p role="alert" className="local-error">
          {error}
        </p>
      )}
      {discard ? (
        <div className="local-callout">
          <p>Discard your unsaved edits?</p>
          <button className="secondary" onClick={() => setDiscard(false)}>
            Keep editing
          </button>{" "}
          <button
            className="primary"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void recover
                .discard()
                .then(close)
                .catch((e) => setError(readableError(e)))
                .finally(() => setSaving(false));
            }}
          >
            Discard edits
          </button>
        </div>
      ) : null}
      <fieldset disabled={saving} className="local-editor-fields">
        <Field
          label="Study set title"
          value={draft.title}
          onChange={(title) => setDraft((d) => ({ ...d, title }))}
          max={300}
        />
        <div className="editor-layout">
          <nav className="editor-topics" aria-label="Edit topics">
            {draft.units.map((u, i) => (
              <button
                key={u.id}
                className={i === index ? "selected" : ""}
                onClick={() => setIndex(i)}
              >
                {i + 1}. {u.title || "Untitled topic"}
              </button>
            ))}
            <button
              disabled={draft.units.length >= 60}
              onClick={() => {
                setDraft((d) => ({ ...d, units: [...d.units, newUnit()] }));
                setIndex(draft.units.length);
              }}
            >
              <Plus size={15} />
              Add topic
            </button>
          </nav>
          <div className="editor-content">
            {unit.citations.length > 0 && (
              <details>
                <summary>Source quotes for this topic</summary>
                {unit.citations.map((c, i) => (
                  <blockquote key={i}>{c.quote}</blockquote>
                ))}
              </details>
            )}
            <Field
              label="Topic title"
              value={unit.title}
              onChange={(title) => patchUnit({ title })}
              max={300}
            />
            <Field
              label="Explanation"
              value={unit.explanation}
              onChange={(explanation) => patchUnit({ explanation })}
              large
            />
            <Field
              label="Learning objective (optional)"
              value={unit.objective}
              onChange={(objective) => patchUnit({ objective })}
              max={600}
            />
            <Field
              label="Key points (one per line, optional)"
              value={unit.keyPoints.join("\n")}
              onChange={(s) => patchUnit({ keyPoints: s.split("\n") })}
              large
              max={4000}
            />
            <details>
              <summary>More study details</summary>
              <Field
                label="Additional detail"
                value={unit.detail}
                onChange={(detail) => patchUnit({ detail })}
                large
                max={2400}
              />
              <Field
                label="Recall prompt"
                value={unit.recallPrompt}
                onChange={(recallPrompt) => patchUnit({ recallPrompt })}
                max={500}
              />
              <Field
                label="Reference answer"
                value={unit.recallAnswer}
                onChange={(recallAnswer) => patchUnit({ recallAnswer })}
                large
                max={1200}
              />
            </details>
            <h3 className="editor-section-title">Practice questions</h3>
            {draft.questions
              .filter((q) => q.unitId === unit.id)
              .map((q, qi) => (
                <section className="editor-question" key={q.id}>
                  <div className="local-row">
                    <strong>Question {qi + 1}</strong>
                    <button
                      className="icon-button"
                      aria-label={`Remove question ${qi + 1}`}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          questions: d.questions.filter((x) => x.id !== q.id),
                        }))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <Field
                    label={`Question ${qi + 1} prompt`}
                    value={q.prompt}
                    onChange={(prompt) => patchQuestion(q.id, { prompt })}
                    max={900}
                  />
                  {q.options.map((o, oi) => (
                    <div className="editor-option" key={oi}>
                      <Field
                        label={`Answer ${oi + 1}`}
                        value={o.text}
                        onChange={(text) =>
                          patchQuestion(q.id, {
                            options: q.options.map((v, i) =>
                              i === oi ? { ...v, text } : v,
                            ),
                          })
                        }
                        max={500}
                      />
                      <Field
                        label={`Explanation for answer ${oi + 1} (optional)`}
                        value={o.explanation}
                        onChange={(explanation) =>
                          patchQuestion(q.id, {
                            options: q.options.map((v, i) =>
                              i === oi ? { ...v, explanation } : v,
                            ),
                          })
                        }
                        max={1000}
                      />
                    </div>
                  ))}
                  <div className="local-row">
                    <button
                      className="text-button"
                      disabled={q.options.length >= 4}
                      onClick={() =>
                        patchQuestion(q.id, {
                          options: [
                            ...q.options,
                            { text: "", explanation: "" },
                          ],
                        })
                      }
                    >
                      Add answer choice
                    </button>
                    <button
                      className="text-button"
                      disabled={q.options.length <= 2}
                      onClick={() =>
                        patchQuestion(q.id, {
                          options: q.options.slice(0, -1),
                          correctIndex: Math.min(
                            q.correctIndex,
                            q.options.length - 2,
                          ),
                        })
                      }
                    >
                      Remove last choice
                    </button>
                  </div>
                  <label className="local-field">
                    <span>Correct answer</span>
                    <select
                      value={q.correctIndex}
                      onChange={(e) =>
                        patchQuestion(q.id, {
                          correctIndex: Number(e.target.value),
                        })
                      }
                    >
                      {q.options.map((_, i) => (
                        <option value={i} key={i}>
                          Answer {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label="Hint (optional)"
                    value={q.hint}
                    onChange={(hint) => patchQuestion(q.id, { hint })}
                    max={500}
                  />
                </section>
              ))}
            <button
              className="secondary"
              disabled={draft.questions.length >= 300}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  questions: [
                    ...d.questions,
                    {
                      id: crypto.randomUUID(),
                      unitId: unit.id,
                      prompt: "",
                      options: [
                        { text: "", explanation: "" },
                        { text: "", explanation: "" },
                        { text: "", explanation: "" },
                      ],
                      correctIndex: 0,
                      hint: "",
                      citations: [],
                    },
                  ],
                }))
              }
            >
              <Plus size={16} />
              Add practice question
            </button>
            <button
              className="text-button remove-topic"
              disabled={draft.units.length === 1}
              onClick={() => {
                setDraft((d) => ({
                  ...d,
                  units: d.units.filter((u) => u.id !== unit.id),
                  questions: d.questions.filter((q) => q.unitId !== unit.id),
                }));
                setIndex(Math.max(0, index - 1));
              }}
            >
              Remove this topic and its questions
            </button>
          </div>
        </div>
      </fieldset>
      <div className="editor-footer">
        <button className="secondary" disabled={saving} onClick={requestClose}>
          Keep draft & close
        </button>
        <button
          className="secondary"
          onClick={() =>
            downloadJson(
              { guide: draft, problems: recovery.draft?.problems || [] },
              "studystep-editor-draft.json",
            )
          }
        >
          Export draft
        </button>
        <button
          className="text-button"
          disabled={saving}
          onClick={() => setDiscard(true)}
        >
          Discard draft
        </button>
        <button
          className="primary"
          disabled={saving}
          onClick={() => {
            const cleaned = {
              ...draft,
              units: draft.units.map((u) => ({
                ...u,
                keyPoints: u.keyPoints.map((p) => p.trim()).filter(Boolean),
              })),
            };
            // Normalize blank lines before validation without changing saved content.
            try {
              validateLocalGuide(cleaned, data.sources);
              setSaving(true);
              recover
                .flush()
                .then(() => save(editGuide(data, cleaned)))
                .then(() => recover.discard())
                .then(close)
                .catch((e) => setError(readableError(e)))
                .finally(() => setSaving(false));
            } catch (e) {
              setError(readableError(e));
            }
          }}
        >
          {saving ? "Saving…" : "Save study set"}
        </button>
      </div>
    </Dialog>
  );
}

type ModelState = {
  connected: boolean;
  ready: boolean;
  model: string;
  models: { name: string; size: number }[];
};
function ModelSettings({
  close,
  onReady,
}: {
  close: () => void;
  onReady: (ready: boolean) => void;
}) {
  const [state, setState] = useState<ModelState | null>(null),
    [model, setModel] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/local-model");
      const value = (await r.json()) as ModelState & { error?: string };
      if (!r.ok) throw Error(value.error || "Could not connect to local AI.");
      setState(value);
      setModel(value.model || value.models[0]?.name || "");
      onReady(value.ready);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function choose() {
    setBusy(true);
    try {
      const r = await fetch("/api/local-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const value = (await r.json()) as ModelState & { error?: string };
      if (!r.ok) throw Error(value.error || "Could not connect to local AI.");
      setState(value);
      onReady(value.ready);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Local AI · optional" close={close}>
      <p>
        Generate study sets using a downloaded model on this computer. No API
        key, account, or paid credits are needed. Manual editing and importing
        always work.
      </p>
      <div className="local-callout">
        <strong>
          {state?.ready
            ? "Connected and ready"
            : state?.connected
              ? "Ollama is running"
              : "Ollama is not connected"}
        </strong>
        <p>
          StudyStep connects only to Ollama on this computer. Cloud models are
          excluded.
        </p>
      </div>
      {error && (
        <p role="alert" className="local-error">
          {error}
        </p>
      )}
      <label className="local-field">
        <span>Downloaded model</span>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Choose a model</option>
          {state?.models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} · {(m.size / 1e9).toFixed(1)} GB
            </option>
          ))}
        </select>
      </label>
      <div className="local-row">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh models
        </button>
        <button
          className="primary"
          disabled={busy || !model}
          onClick={() => void choose()}
        >
          Use this model
        </button>
      </div>
      {state?.ready && (
        <p role="status">
          Ready. Add source material, then choose “Generate study set”.
        </p>
      )}
      <details className="setup-details">
        <summary>Set up or add a model</summary>
        <ol>
          <li>
            Open <strong>Set up local AI.cmd</strong> in the study-app folder.
            It installs Ollama inside this project and downloads Qwen3 4B. The
            initial downloads need internet and several GB of disk space.
          </li>
          <li>
            Restart StudyStep, then refresh this list and select the model.
          </li>
          <li>
            To use an existing Ollama installation instead, start it and
            download a model there. StudyStep will list its installed local
            models.
          </li>
        </ol>
        <p>
          Use short excerpts (up to 12,000 characters) for local generation. It
          can take several minutes. Explanations use source excerpts. Questions
          must pass source checks and a separate model review before an editable
          draft opens. Your current set changes only when you save the draft.
        </p>
        <p>
          Model downloads are free; running them uses your computer’s memory,
          GPU, and electricity. Check model answers against your material.
        </p>
      </details>
    </Dialog>
  );
}

export default function LocalTools({
  data,
  locked,
  save,
  onReady,
  aiDraft,
  dismissDraft,
  compact = false,
}: {
  compact?: boolean;
  data: Workspace;
  locked: boolean;
  save: (data: Workspace) => Promise<void>;
  onReady: (ready: boolean) => void;
  aiDraft: { guide: Guide; problems: string[] } | null;
  dismissDraft: () => void;
}) {
  const [panel, setPanel] = useState<
      "review" | "edit" | "import" | "model" | null
    >(null),
    [raw, setRaw] = useState(""),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<ReturnType<
      typeof parseStudyImport
    > | null>(null),
    [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null),
    [recoveryError, setRecoveryError] = useState("");
  useEffect(() => {
    if (locked || panel) return;
    let active = true;
    setRecovery(null);
    void draftRequest()
      .then((r) => {
        if (active) {
          setRecovery(r);
          setRecoveryError("");
          if (aiDraft && r.draft && r.draft.baseKey === r.baseKey)
            setPanel("review");
        }
      })
      .catch((e) => {
        if (active) setRecoveryError(readableError(e));
      });
    return () => {
      active = false;
    };
  }, [locked, data.guide, data.sources, aiDraft]);
  const stale =
    !!recovery?.draft && recovery.draft.baseKey !== recovery.baseKey;
  const file = useRef<HTMLInputElement>(null);
  function parse() {
    try {
      setPreview(parseStudyImport(raw));
      setError("");
    } catch (e) {
      setPreview(null);
      setError(readableError(e));
    }
  }
  return (
    <>
      {recoveryError && (
        <p className="local-error" role="alert">
          {recoveryError}{" "}
          <button
            onClick={() =>
              void draftRequest()
                .then(setRecovery)
                .then(() => setRecoveryError(""))
                .catch((e) => setRecoveryError(readableError(e)))
            }
          >
            Reload draft
          </button>
        </p>
      )}
      {recovery?.draft && panel !== "edit" && panel !== "review" && (
        <div className="local-callout" role="status">
          <strong>
            {stale
              ? "A draft from earlier material is saved"
              : "You have a saved draft"}
          </strong>
          <p>
            {stale
              ? "The accepted set or its sources changed. Export this draft before discarding it; it cannot replace the current set directly."
              : "Continue editing where you left off. Your accepted study set is unchanged."}
          </p>
          <div className="local-row">
            {!stale && (
              <button
                className="primary"
                disabled={locked}
                onClick={() =>
                  setPanel(recovery?.draft || data.guide ? "review" : "edit")
                }
              >
                Resume draft
              </button>
            )}
            <button
              className="secondary"
              onClick={() =>
                downloadJson(recovery.draft, "studystep-editor-draft.json")
              }
            >
              Export draft
            </button>
            {stale && (
              <button
                className="secondary"
                disabled={locked}
                onClick={() => {
                  if (
                    window.confirm(
                      "Discard this earlier draft? Export it first if you want to keep it.",
                    )
                  )
                    void draftRequest("DELETE", { version: recovery.version })
                      .then(setRecovery)
                      .catch((e) => setRecoveryError(readableError(e)));
                }}
              >
                Discard earlier draft
              </button>
            )}
          </div>
        </div>
      )}
      <details className="study-utilities" open={compact ? undefined : true}>
        <summary>Study-set tools · local AI, editing & backups</summary>
        <div className="local-toolbar" aria-label="Study set tools">
          <div>
            <span className="eyebrow">ON YOUR COMPUTER</span>
            <p>Manage your saved set and local model.</p>
          </div>
          <div className="local-actions">
            <button
              className="primary"
              disabled={locked || !recovery || stale}
              onClick={() =>
                setPanel(recovery?.draft || data.guide ? "review" : "edit")
              }
            >
              <Pencil size={16} />
              {data.guide ? "Edit study set" : "Create study set"}
            </button>
            <button
              className="secondary"
              disabled={locked}
              onClick={() => {
                setPanel("import");
                setError("");
                setPreview(null);
              }}
            >
              <Upload size={16} />
              Import set
            </button>
            <button
              className="secondary"
              disabled={locked}
              onClick={() =>
                downloadJson(exportBackup(data), "studystep-backup.json")
              }
            >
              <Download size={16} />
              Back up
            </button>
            <button
              className="secondary"
              disabled={locked}
              onClick={() => setPanel("model")}
            >
              <Monitor size={16} />
              Local AI
            </button>
          </div>
        </div>
        {data.guide && (
          <div className="local-export">
            <button
              className="text-button"
              onClick={() =>
                downloadJson(exportChatSet(data.guide!), "studystep-set.json")
              }
            >
              Export shareable study set
            </button>
            <span>
              Backup includes sources and progress. Shareable sets include study
              content only.
            </span>
          </div>
        )}
      </details>
      {panel === "review" && recovery && !stale && (
        <CardReview
          data={data}
          save={save}
          recovery={recovery}
          onStored={setRecovery}
          advanced={() => setPanel("edit")}
          close={() => {
            setPanel(null);
            dismissDraft();
          }}
        />
      )}
      {panel === "edit" && recovery && !stale && (
        <Editor
          data={data}
          save={save}
          recovery={recovery}
          onStored={setRecovery}
          aiDraft={
            recovery.draft?.problems.length
              ? {
                  guide: recovery.draft.guide,
                  problems: recovery.draft.problems,
                }
              : aiDraft
          }
          close={() => {
            setPanel(null);
            dismissDraft();
          }}
        />
      )}
      {panel === "model" && (
        <ModelSettings close={() => setPanel(null)} onReady={onReady} />
      )}
      {panel === "import" && (
        <Dialog title="Import a study set" close={() => setPanel(null)}>
          <p>
            Choose a StudyStep JSON file, paste a study set, or restore a full
            backup. Preview it before replacing your current workspace.
          </p>
          <div className="local-row">
            <button className="secondary" onClick={() => file.current?.click()}>
              <Upload size={16} />
              Choose JSON file
            </button>
          </div>
          <input
            ref={file}
            hidden
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                if (f.size > 2_000_000)
                  throw Error("Use a file smaller than 2 MB.");
                const text = await f.text();
                setRaw(text);
                setPreview(parseStudyImport(text));
                setError("");
              } catch (err) {
                setError(readableError(err));
                setPreview(null);
              }
              e.target.value = "";
            }}
          />
          <Field
            label="Study set JSON"
            value={raw}
            onChange={(v) => {
              setRaw(v);
              setPreview(null);
            }}
            large
            max={2_000_000}
          />
          {error && (
            <p className="local-error" role="alert">
              {error}
            </p>
          )}
          <button className="secondary" disabled={!raw.trim()} onClick={parse}>
            Preview import
          </button>
          {preview && (
            <div className="import-preview">
              <span className="eyebrow">
                {preview.kind === "backup" ? "FULL BACKUP" : "STUDY SET"}
              </span>
              <h3>{preview.data.guide?.title || preview.data.title}</h3>
              <p>
                {preview.data.guide?.units.length || 0} topics ·{" "}
                {preview.data.guide?.questions.length || 0} questions ·{" "}
                {preview.data.attempts.length} saved attempts
              </p>
              <p>
                This replaces the current set, materials, and progress. Download
                a backup first if you want to keep them.
              </p>
              <div className="local-row">
                <button
                  className="secondary"
                  onClick={() =>
                    downloadJson(
                      exportBackup(data),
                      "studystep-before-import.json",
                    )
                  }
                >
                  Back up current workspace
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await save(preview.data);
                      setPanel(null);
                    } catch (e) {
                      setError(readableError(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Importing…" : "Replace workspace with this import"}
                </button>
              </div>
            </div>
          )}
          <details className="setup-details">
            <summary>Study-set format</summary>
            <p>
              Use examples/studystep-example.json as the format reference.
              Include explanations, questions, and numbered correct answers.
            </p>
            <p>
              Answers start at 1. Imported content is not automatically checked
              by AI; review it before practicing.
            </p>
          </details>
        </Dialog>
      )}
    </>
  );
}
