"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  FolderOpen,
  Focus,
  Layers3,
  Lightbulb,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  Download,
  ExternalLink,
  CircleHelp,
  RotateCcw,
} from "lucide-react";
import {
  emptyWorkspace,
  totalText,
  splitPassages,
  validateSources,
  independentCorrect,
  type Guide,
  type Workspace,
  type Source,
  type Citation,
  type Attempt,
} from "../lib/study";
import { extractFile } from "../lib/extract";
import TopicSearch from "../local/TopicSearch";
import Flashcards from "../local/Flashcards";
import "../local/learning.css";
import SectionPicker from "../local/SectionPicker";
import { selectPassages, GENERATION_LIMIT } from "../lib/selection";
import LocalTools from "../local/tools";

type Tab = "materials" | "guide" | "practice" | "cards" | "trail";
async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = (await response.json()) as {
    error?: string;
    data: Workspace;
    revision: number;
    aiReady: boolean;
    status?: string;
    stage?: string;
    draft?: Guide;
    reviewProblems?: string[];
  } | null;
  if (!response.ok) throw new Error(body?.error || "Please try again.");
  return body!;
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function StudyApp({ local = false }: { local?: boolean }) {
  const [data, setData] = useState<Workspace>(emptyWorkspace),
    [tab, setTab] = useState<Tab>("materials");
  const [loaded, setLoaded] = useState(false),
    [loadFailed, setLoadFailed] = useState(false),
    [aiReady, setAiReady] = useState(false),
    [saving, setSaving] = useState("Loading workspace…");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [generation, setGeneration] = useState(false);
  const [generationStage, setGenerationStage] = useState("Writing draft…");
  const [entry, setEntry] = useState<"upload" | "topic">("upload");
  const [localDraft, setLocalDraft] = useState<{
    guide: Guide;
    problems: string[];
  } | null>(null);
  const [focus, setFocus] = useState(false),
    [dragging, setDragging] = useState(false),
    [notes, setNotes] = useState(false),
    [noteName, setNoteName] = useState(""),
    [noteText, setNoteText] = useState("");
  const [sourceView, setSourceView] = useState<{
    source: Source;
    passageId?: string;
    quote?: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    text: string;
    run: () => void;
  } | null>(null);
  const [hinted, setHinted] = useState(false),
    [selected, setSelected] = useState<number | null>(null),
    [showRecall, setShowRecall] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null),
    stateRef = useRef(data),
    revision = useRef(0),
    saved = useRef(""),
    savePromise = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    conflict = useRef(false);
  const activeRef = useRef(true);
  const guide = data.guide,
    unit = guide?.units[data.currentUnit] || guide?.units[0],
    question = guide?.questions[data.currentQuestion] || guide?.questions[0];
  const attempt = question
    ? [...data.attempts].reverse().find((a) => a.questionId === question.id)
    : undefined;
  const selection =
    data.selectedPassageIds ??
    data.sources.flatMap((s) => s.passages.map((p) => p.id));
  function setPassageIds(ids: string[] | null) {
    update((d) => ({ ...d, selectedPassageIds: ids }));
  }
  const selectionSize = data.sources
    .flatMap((s) => s.passages)
    .filter((p) => selection.includes(p.id))
    .reduce((n, p) => n + p.text.length, 0);
  const selectionValid =
    selectionSize >= 50 &&
    selectionSize <= GENERATION_LIMIT &&
    data.sources.some(
      (s) =>
        s.role === "material" &&
        s.passages.some((p) => selection.includes(p.id)),
    );
  const locked =
    Boolean(busy) || generation || !loaded || loadFailed || conflict.current;
  function adopt(next: Workspace, version: number) {
    stateRef.current = next;
    revision.current = version;
    saved.current = JSON.stringify(next);
    setData(next);
    setSaving("All changes saved");
  }
  async function saveLocalSet(next: Workspace) {
    setBusy("Saving study set…");
    try {
      if (timer.current) clearTimeout(timer.current);
      await persist();
      const r = await api("/api/workspace", {
        method: "PUT",
        body: JSON.stringify({ data: next, revision: revision.current }),
      });
      adopt(r.data, r.revision);
      setLocalDraft(null);
      setTab(next.guide ? "cards" : "materials");
      setError("");
      setNotice("Study set saved on this computer.");
    } finally {
      setBusy("");
    }
  }
  async function reload() {
    try {
      setLoadFailed(false);
      const r = await api("/api/workspace");
      adopt(r.data, r.revision);
      setAiReady(r.aiReady);
      conflict.current = false;
      setLoaded(true);
      const job = await api("/api/generate");
      if (job?.status === "running") setGeneration(true);
      if (
        local &&
        job?.status === "draft" &&
        job.draft &&
        job.revision === r.revision
      )
        setLocalDraft({ guide: job.draft, problems: job.reviewProblems || [] });
    } catch (e) {
      setError((e as Error).message);
      setLoadFailed(true);
      setLoaded(true);
      setSaving("Could not load workspace");
    }
  }
  useEffect(() => {
    activeRef.current = true;
    void reload();
    return () => {
      activeRef.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!local || !loaded || aiReady) return;
    let cancelled = false,
      tries = 0;
    const retry = setInterval(async () => {
      if (++tries >= 10) clearInterval(retry);
      try {
        const response = await fetch("/api/local-model", {
          signal: AbortSignal.timeout(2500),
        });
        const model = (await response.json()) as { ready?: boolean };
        if (response.ok && model.ready && !cancelled) setAiReady(true);
      } catch {
        /* Keep the manual connection control available. */
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(retry);
    };
  }, [local, loaded, aiReady]);
  async function persist() {
    if (conflict.current)
      throw new Error("Reload your workspace before making more changes.");
    if (savePromise.current) {
      await savePromise.current;
      if (saved.current === JSON.stringify(stateRef.current)) return;
    }
    const work = async () => {
      while (saved.current !== JSON.stringify(stateRef.current)) {
        const snapshot = stateRef.current,
          encoded = JSON.stringify(snapshot);
        setSaving("Saving…");
        const r = await api("/api/workspace", {
          method: "PUT",
          body: JSON.stringify({ data: snapshot, revision: revision.current }),
        });
        revision.current = r.revision;
        saved.current = encoded;
      }
      setSaving("All changes saved");
    };
    const promise = work();
    savePromise.current = promise;
    try {
      await promise;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("another tab")) conflict.current = true;
      setSaving("Changes not saved");
      setError(msg);
      throw e;
    } finally {
      if (savePromise.current === promise) savePromise.current = null;
    }
  }
  function update(fn: (current: Workspace) => Workspace) {
    const next = fn(stateRef.current);
    if (next.selectedPassageIds)
      next.selectedPassageIds = next.selectedPassageIds.filter((id) =>
        next.sources.some((s) => s.passages.some((p) => p.id === id)),
      );
    stateRef.current = next;
    setData(next);
    setSaving("Unsaved changes");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist().catch(() => {});
    }, 400);
  }
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (saved.current !== JSON.stringify(stateRef.current))
        e.preventDefault();
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  useEffect(() => {
    setHinted(false);
    setSelected(null);
    setShowRecall(false);
  }, [
    data.currentQuestion,
    data.currentUnit,
    data.generatedAt,
    data.attempts.length === 0,
  ]);
  useEffect(() => {
    if (!generation) return;
    const poll = setInterval(async () => {
      try {
        const job = await api("/api/generate");
        if (job?.stage) setGenerationStage(job.stage);
        if (job && job.status !== "running") {
          const r = await api("/api/workspace");
          if (!activeRef.current) return;
          adopt(r.data, r.revision);
          setAiReady(r.aiReady);
          setGeneration(false);
          if (
            local &&
            job.status === "draft" &&
            job.draft &&
            job.revision === r.revision
          )
            setLocalDraft({
              guide: job.draft,
              problems: job.reviewProblems || [],
            });
          if (job.status === "succeeded") {
            setTab("guide");
            setNotice("Your guide and practice questions are ready.");
          } else if (job.error) setError(job.error);
        }
      } catch {
        /* Keep saved work through a transient connection failure. */
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [generation]);
  async function importFiles(files: FileList | File[]) {
    if (locked) return;
    setError("");
    setNotice("");
    setBusy("Reading your material…");
    const accepted: Source[] = [],
      errors: string[] = [];
    try {
      for (const file of Array.from(files)) {
        if (stateRef.current.sources.length + accepted.length >= 10) {
          errors.push("You can add up to 10 sources.");
          break;
        }
        try {
          const s = await extractFile(file, setBusy);
          if (
            [...stateRef.current.sources, ...accepted].some(
              (x) => x.fingerprint === s.fingerprint,
            )
          ) {
            errors.push(`${file.name} is already in your materials.`);
            continue;
          }
          validateSources(
            [...stateRef.current.sources, ...accepted, s].map((x) => ({
              ...x,
              role: "material",
            })),
          );
          accepted.push(s);
        } catch (e) {
          errors.push(`${file.name}: ${(e as Error).message}`);
        }
      }
      if (accepted.length) {
        update((d) => ({
          ...(local ? d : emptyWorkspace()),
          title: d.title,
          sources: [...d.sources, ...accepted],
        }));
        setNotice(
          `${accepted.length} source${accepted.length === 1 ? "" : "s"} added. Check the extracted text before generating.`,
        );
      }
      if (errors.length) setError(errors.join(" "));
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  function addText(text: string, name: string) {
    try {
      const id = crypto.randomUUID();
      if (text.trim().length < 50)
        throw new Error("Add at least 50 characters of notes.");
      const s: Source = {
        id,
        name: name.trim() || "Pasted notes",
        type: "notes",
        role: "material",
        passages: splitPassages(text, id, "Notes"),
        pageCount: 0,
        warnings: [],
        addedAt: new Date().toISOString(),
        fingerprint: id,
      };
      validateSources(
        [...data.sources, s].map((x) => ({ ...x, role: "material" })),
      );
      if (s.passages.length > 300) throw new Error("Use a shorter excerpt.");
      update((d) => ({
        ...(local ? d : emptyWorkspace()),
        title: d.title,
        sources: [...d.sources, s],
      }));
      setNotes(false);
      setNoteText("");
      setNoteName("");
      setError("");
      setNotice("Notes added. Open the source to check the text.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function withSourceChange(run: () => void) {
    if (data.guide && !local)
      setConfirm({
        text: "Changing materials clears the current guide and practice progress so old citations cannot be mistaken for current ones. Continue?",
        run,
      });
    else run();
  }
  async function generate() {
    if (locked) return;
    const run = async () => {
      setError("");
      setNotice("");
      setBusy("Saving your material…");
      try {
        validateSources(stateRef.current.sources);
        if (local) selectPassages(stateRef.current.sources, selection);
        await persist();
        setBusy("");
        setGenerationStage("Writing draft…");
        setGeneration(true);
        const r = await api("/api/generate", {
          method: "POST",
          body: JSON.stringify({
            jobId: crypto.randomUUID(),
            revision: revision.current,
            ...(local ? { passageIds: selection } : {}),
          }),
        });
        if (!activeRef.current) return;
        if (local && r.draft) {
          setLocalDraft({ guide: r.draft, problems: r.reviewProblems || [] });
          setNotice(
            "Your local draft is ready to review. Your saved set has not changed.",
          );
        } else {
          adopt(r.data, r.revision);
          setTab("guide");
          setNotice(
            "Your guide and questions are ready. Check the sources as you study.",
          );
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy("");
        setGeneration(false);
      }
    };
    if (data.guide && !local)
      setConfirm({
        text: "Generate a fresh guide? This replaces the current guide and resets its practice progress. Your sources stay saved.",
        run: () => {
          void run();
        },
      });
    else await run();
  }
  function useTopic(source: Source) {
    const run = async () => {
      try {
        await saveLocalSet({
          ...emptyWorkspace(),
          title: source.name.slice(0, 100),
          sources: [source],
        });
        setPassageIds(null);
        setEntry("upload");
        setNotice(
          "Reference overview added. Check the text, then create your study points and flashcards.",
        );
      } catch (e) {
        setError((e as Error).message);
      }
    };
    if (data.sources.length || data.guide)
      setConfirm({
        text: "Start a new study set from this overview? This replaces the current materials and study set. Download a backup first if you want to keep them. Existing flashcard review records remain archived separately.",
        run: () => void run(),
      });
    else void run();
  }
  function openCitation(c: Citation) {
    const source = data.sources.find((s) =>
      s.passages.some((p) => p.id === c.passageId),
    );
    if (source)
      setSourceView({ source, passageId: c.passageId, quote: c.quote });
  }
  function citations(items: Citation[]) {
    return (
      <div className="citations">
        {items.map((c, i) => {
          const s = data.sources.find((s) =>
              s.passages.some((p) => p.id === c.passageId),
            ),
            p = s?.passages.find((p) => p.id === c.passageId);
          return (
            <button
              key={`${c.passageId}-${i}`}
              onClick={() => openCitation(c)}
              title={s?.name}
            >
              <FileText size={13} />
              {p?.label || "View source"}
              <ExternalLink size={11} />
            </button>
          );
        })}
      </div>
    );
  }
  function answer(reveal = false) {
    if (!question || attempt || (!reveal && selected === null)) return;
    const a: Attempt = {
      questionId: question.id,
      selected: reveal ? null : selected,
      hinted: hinted || data.hintUsed.includes(question.id),
      revealed: reveal,
      at: new Date().toISOString(),
    };
    update((d) => ({ ...d, attempts: [...d.attempts, a] }));
  }
  function download() {
    if (!guide) return;
    const lines = [
      `# ${guide.title}`,
      "",
      `Generated ${new Date(data.generatedAt).toLocaleDateString()}. Study material; check against your sources.`,
      "",
    ];
    const refs = (items: Citation[]) => {
      for (const c of items) {
        const s = data.sources.find((s) =>
            s.passages.some((p) => p.id === c.passageId),
          ),
          p = s?.passages.find((p) => p.id === c.passageId);
        lines.push(`Source: ${s?.name} — ${p?.label}`, `> ${c.quote}`, "");
      }
    };
    for (const u of guide.units) {
      lines.push(
        `## ${u.title}`,
        u.objective,
        "",
        u.explanation,
        "",
        u.detail,
        "",
        ...u.keyPoints.map((p) => `- ${p}`),
        "",
        u.example,
        u.misconception,
        "",
        `Recall: ${u.recallPrompt}`,
        `Reference answer: ${u.recallAnswer}`,
        "",
      );
      refs(u.citations);
    }
    lines.push("## Practice", "");
    for (const q of guide.questions) {
      lines.push(
        q.prompt,
        ...q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`),
        `Answer: ${String.fromCharCode(65 + q.correctIndex)}`,
        ...q.options.map((o) => o.explanation),
        "",
      );
      refs(q.citations);
    }
    if (guide.gaps.length)
      lines.push("## Material gaps", ...guide.gaps.map((g) => `- ${g}`));
    const url = URL.createObjectURL(
        new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "studystep-guide.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  useEffect(() => {
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [tab]);
  useEffect(() => {
    if (tab === "practice")
      document
        .querySelector(".question-card h2")
        ?.setAttribute("tabindex", "-1");
    if (tab === "practice")
      document.querySelector<HTMLElement>(".question-card h2")?.focus();
  }, [tab, data.currentQuestion]);
  const answered = new Set(data.attempts.map((a) => a.questionId)).size,
    correct = guide
      ? data.attempts.filter((a) => independentCorrect(a, guide)).length
      : 0;
  return (
    <div className={`app-shell ${focus ? "is-focused" : ""}`}>
      <a href="#main" className="skip-link">
        Skip to study workspace
      </a>
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          StudyStep<span className="beta">{local ? "LOCAL" : "BETA"}</span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <button className="project" onClick={() => setTab("materials")}>
          <BookOpen size={22} />
          <span>
            <strong>Study set</strong>
            <small>
              {data.sources.length} source{data.sources.length === 1 ? "" : "s"}{" "}
              · {local ? "on this computer" : "private"}
            </small>
          </span>
        </button>
        <nav aria-label="Workspace navigation">
          {(
            [
              {
                id: "materials",
                label: local ? "Create a set" : "Materials",
                icon: FolderOpen,
              },
              { id: "guide", label: "Study guide", icon: BookOpen },
              { id: "practice", label: "Practice", icon: CircleHelp },
              ...(local
                ? [
                    {
                      id: "cards" as const,
                      label: "Flashcards",
                      icon: Layers3,
                    },
                    {
                      id: "trail" as const,
                      label: "Recall Trail",
                      icon: Sparkles,
                    },
                  ]
                : []),
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? "nav-item selected" : "nav-item"}
              onClick={() => setTab(n.id)}
              aria-current={tab === n.id ? "page" : undefined}
            >
              <n.icon size={19} />
              {n.label}
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy">
            <ShieldCheck size={16} />
            <span>
              {local
                ? "Saved on this computer"
                : "Only you can access this space"}
            </span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Study set</span>
            <ChevronRight size={13} />
            <strong>
              {tab === "materials"
                ? local
                  ? "Create a set"
                  : "Materials"
                : tab === "guide"
                  ? "Study guide"
                  : tab === "cards"
                    ? "Flashcards"
                    : tab === "trail"
                      ? "Recall Trail"
                      : "Practice"}
            </strong>
          </div>
          <div className="top-actions">
            <span className="save-status" role="status">
              {saving === "All changes saved" ? (
                <Check size={13} />
              ) : saving === "Saving…" ? (
                <Loader2 size={13} className="spin" />
              ) : null}
              {saving}
            </span>
            <button
              className={`quiet-button ${focus ? "toggled" : ""}`}
              onClick={() => setFocus(!focus)}
              aria-pressed={focus}
            >
              <Focus size={16} />
              {focus ? "Show sidebar" : "Hide sidebar"}
            </button>
          </div>
        </header>
        <main id="main" className="main" tabIndex={-1}>
          {local && (
            <LocalTools
              data={data}
              locked={locked}
              compact
              save={saveLocalSet}
              onReady={setAiReady}
              aiDraft={localDraft}
              dismissDraft={() => {
                setLocalDraft(null);
                void api("/api/generate", {
                  method: "DELETE",
                  body: "{}",
                }).catch(() => {});
              }}
            />
          )}
          {error && (
            <div className="alert error" role="alert">
              <span>{error}</span>
              <div>
                {(loadFailed || conflict.current) && (
                  <button
                    onClick={() => {
                      setError("");
                      void reload();
                    }}
                  >
                    Reload workspace
                  </button>
                )}
                {saving === "Changes not saved" && !conflict.current && (
                  <button
                    onClick={() => {
                      setError("");
                      void persist().catch(() => {});
                    }}
                  >
                    Retry save
                  </button>
                )}
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  <X size={16} />
                </button>
              </div>
            </div>
          )}
          {notice && (
            <div className="alert notice" role="status">
              <span>{notice}</span>
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {generation && (
            <div className="generation-progress" role="status">
              <Loader2 className="spin" size={21} />
              <div>
                <strong>
                  {local
                    ? generationStage
                    : "Building your guide and checking its sources"}
                </strong>
                <p>
                  This can take a few minutes. Your materials are saved; you can
                  return to this page.
                  {local && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void api("/api/generate", {
                          method: "DELETE",
                          body: "{}",
                        })
                      }
                    >
                      Cancel generation
                    </button>
                  )}
                </p>
              </div>
            </div>
          )}
          {tab === "materials" && (
            <>
              <section className="page-intro">
                <div>
                  <h1>Create a study set</h1>
                  <p>
                    Add a file or search a topic, then generate and review your
                    cards.
                  </p>
                </div>
              </section>
              {local && (
                <div
                  className="learning-entry"
                  aria-label="Choose how to create a study set"
                >
                  <button
                    className={entry === "upload" ? "selected" : ""}
                    aria-pressed={entry === "upload"}
                    onClick={() => setEntry("upload")}
                  >
                    <Upload size={23} />
                    <strong>Upload a file</strong>
                    <span>PDF, DOCX, TXT or MD</span>
                  </button>
                  <button
                    className={entry === "topic" ? "selected" : ""}
                    aria-pressed={entry === "topic"}
                    onClick={() => setEntry("topic")}
                  >
                    <Sparkles size={23} />
                    <strong>Search a topic</strong>
                    <span>Find a Wikipedia overview</span>
                  </button>
                </div>
              )}
              {local && entry === "topic" && (
                <TopicSearch locked={locked} onUse={useTopic} />
              )}
              <div
                className="materials-layout"
                hidden={local && entry === "topic"}
              >
                <section>
                  <div
                    className={`upload-zone ${dragging ? "dragging" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!locked) setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      if (!locked) {
                        const files = Array.from(e.dataTransfer.files);
                        withSourceChange(() => void importFiles(files));
                      }
                    }}
                  >
                    <span className="upload-icon">
                      {busy ? (
                        <Loader2 size={27} className="spin" />
                      ) : (
                        <Upload size={27} />
                      )}
                    </span>
                    <h2>{busy || "Add files"}</h2>
                    <p>Drop files here, or choose them from your device.</p>
                    <button
                      className="primary"
                      disabled={locked}
                      onClick={() =>
                        withSourceChange(() => fileRef.current?.click())
                      }
                    >
                      <Plus size={17} />
                      Choose files
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".pdf,.docx,.txt,.md"
                      multiple
                      hidden
                      onChange={(e) => {
                        if (e.target.files) void importFiles(e.target.files);
                      }}
                    />
                    <small>
                      PDF, DOCX, TXT, MD · up to 20 MB each · text-based files
                    </small>
                  </div>
                  <div className="import-options">
                    <button
                      className="text-button"
                      onClick={() => withSourceChange(() => setNotes(true))}
                      disabled={locked}
                    >
                      <FileText size={16} />
                      Paste notes instead
                    </button>
                  </div>
                  <div className="section-heading">
                    <h2>
                      Your materials{" "}
                      <span className="count">{data.sources.length}</span>
                    </h2>
                    <span>
                      {totalText(data.sources).toLocaleString()} / 80,000
                      characters
                    </span>
                  </div>
                  {!data.sources.length ? (
                    <div className="source-empty">
                      <FolderOpen size={23} />
                      <p>
                        Your sources will appear here.
                        <small>
                          Start with a chapter, class notes, or a reading.
                        </small>
                      </p>
                    </div>
                  ) : (
                    <div className="source-list">
                      {data.sources.map((s) => (
                        <div className="source-row" key={s.id}>
                          <span className={`file-icon ${s.type}`}>
                            {s.type.toUpperCase()}
                          </span>
                          <div className="source-info">
                            <button
                              className="source-name"
                              onClick={() => setSourceView({ source: s })}
                            >
                              {s.name}
                            </button>
                            <small>
                              {s.pageCount ? `${s.pageCount} pages · ` : ""}
                              {s.passages.length} passages
                              {s.warnings.length
                                ? " · check extraction"
                                : " · ready"}
                            </small>
                            <label className="source-role">
                              <input
                                type="checkbox"
                                checked={s.role === "assignment"}
                                disabled={locked}
                                onChange={() =>
                                  withSourceChange(() =>
                                    update((d) => ({
                                      ...(local ? d : emptyWorkspace()),
                                      title: d.title,
                                      sources: d.sources.map((x) =>
                                        x.id === s.id
                                          ? {
                                              ...x,
                                              role:
                                                x.role === "assignment"
                                                  ? "material"
                                                  : "assignment",
                                            }
                                          : x,
                                      ),
                                    })),
                                  )
                                }
                              />
                              Assigned study guide
                            </label>
                          </div>
                          <button
                            className="icon-button"
                            aria-label={`Preview ${s.name}`}
                            onClick={() => setSourceView({ source: s })}
                          >
                            <ExternalLink size={17} />
                          </button>
                          <button
                            className="icon-button delete"
                            disabled={locked}
                            aria-label={`Remove ${s.name}`}
                            onClick={() =>
                              setConfirm({
                                text: local
                                  ? `Remove “${s.name}”? Source links to this material will be removed. Your study content and practice progress will stay.`
                                  : `Remove “${s.name}”? Any existing guide and practice progress will also be cleared.`,
                                run: () =>
                                  update((d) => {
                                    const removed = new Set(
                                      s.passages.map((p) => p.id),
                                    );
                                    return local
                                      ? {
                                          ...d,
                                          sources: d.sources.filter(
                                            (x) => x.id !== s.id,
                                          ),
                                          guide: d.guide
                                            ? {
                                                ...d.guide,
                                                units: d.guide.units.map(
                                                  (u) => ({
                                                    ...u,
                                                    citations:
                                                      u.citations.filter(
                                                        (c) =>
                                                          !removed.has(
                                                            c.passageId,
                                                          ),
                                                      ),
                                                  }),
                                                ),
                                                questions:
                                                  d.guide.questions.map(
                                                    (q) => ({
                                                      ...q,
                                                      citations:
                                                        q.citations.filter(
                                                          (c) =>
                                                            !removed.has(
                                                              c.passageId,
                                                            ),
                                                        ),
                                                    }),
                                                  ),
                                              }
                                            : null,
                                        }
                                      : {
                                          ...emptyWorkspace(),
                                          title: d.title,
                                          sources: d.sources.filter(
                                            (x) => x.id !== s.id,
                                          ),
                                        };
                                  }),
                              })
                            }
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {local && data.sources.length > 0 && (
                    <SectionPicker
                      sources={data.sources}
                      selected={selection}
                      onChange={setPassageIds}
                      disabled={locked}
                    />
                  )}
                  <p className="storage-note">
                    <ShieldCheck size={14} />
                    {local
                      ? "Materials and progress are saved in this app’s local data folder. Optional AI generation stays on this computer."
                      : "Extracted text is saved in your private workspace. Original files stay on your device. Optional generation uses your local model."}
                  </p>
                </section>
                <aside className="right-rail">
                  <div className="next-step">
                    <h2>Generate a draft</h2>
                    <p className="draft-help">
                      Check your materials first. You can review and edit the
                      draft before saving.
                    </p>
                    <button
                      className="primary full"
                      disabled={
                        locked ||
                        !data.sources.length ||
                        !aiReady ||
                        (local && !selectionValid)
                      }
                      onClick={() => void generate()}
                    >
                      <Sparkles size={17} />
                      {local
                        ? "Generate study set"
                        : data.guide
                          ? "Generate a new guide"
                          : "Create my study guide"}
                      <ArrowRight size={17} />
                    </button>
                    {local && data.sources.length > 0 && !selectionValid && (
                      <p role="status" className="local-error">
                        Choose 50–12,000 characters in “Choose sections”,
                        including supporting material.
                      </p>
                    )}
                    <p className="generation-note">
                      {local
                        ? !aiReady
                          ? "Local AI is not connected. Open Local AI in Study-set tools to choose a downloaded model."
                          : "Uses the selected sections, up to 12,000 characters. Your full materials stay saved."
                        : !aiReady
                          ? "AI connection pending. Uploads and source previews work now."
                          : "Creates up to 6 topics and 12 questions. No timer, no pressure."}
                    </p>
                    {!aiReady && (
                      <button
                        className="text-button"
                        disabled={locked}
                        onClick={async () => {
                          try {
                            await persist();
                            const r = await api("/api/workspace");
                            setAiReady(r.aiReady);
                            setNotice(
                              r.aiReady
                                ? "AI is connected. You can generate your guide."
                                : local
                                  ? "Choose a model in Local AI. You can create and import sets without it."
                                  : "API setup is not complete yet. Your materials are saved.",
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Check AI connection
                        <RotateCcw size={13} />
                      </button>
                    )}
                  </div>
                  <div className="tip">
                    <Lightbulb size={20} />
                    <div>
                      <strong>Have an assigned study guide?</strong>
                      <p>
                        Add it alongside your reading and mark it below. We’ll
                        use it to focus the guide and flag missing material.
                      </p>
                    </div>
                  </div>
                </aside>
              </div>
            </>
          )}
          {tab === "guide" && (
            <>
              <div className="content-heading">
                <div>
                  <span className="eyebrow">STUDY GUIDE</span>
                  <h1>{guide?.title || "Your study guide"}</h1>
                  <p>
                    {guide
                      ? local
                        ? `${guide.units.length} topic${guide.units.length === 1 ? "" : "s"} · ${guide.questions.length} practice question${guide.questions.length === 1 ? "" : "s"}. Edit this set at any time.`
                        : `${guide.units.length} small topics. Open any source to see where an idea comes from.`
                      : "Create a set to view its study guide."}
                  </p>
                </div>
                {guide && (
                  <button className="secondary" onClick={download}>
                    <Download size={16} />
                    Export guide
                  </button>
                )}
              </div>
              {!guide ? (
                <div className="empty-learning">
                  <BookOpen size={36} />
                  <h2>No study guide yet</h2>
                  <p>
                    {local
                      ? "Use Create study set or Import set above. Add source material only if you want to use local AI."
                      : "Add your reading or notes, then create a guide with clear explanations and source references."}
                  </p>
                  <button
                    className="primary"
                    onClick={() => setTab("materials")}
                  >
                    Go to materials
                    <ArrowRight size={17} />
                  </button>
                </div>
              ) : (
                <>
                  {guide.gaps.length > 0 && (
                    <details className="gaps">
                      <summary>
                        {guide.gaps.length} material gaps to keep in mind
                      </summary>
                      <ul>
                        {guide.gaps.map((g, i) => (
                          <li key={i}>{g}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="learning-layout">
                    <nav className="topic-nav" aria-label="Study topics">
                      <span className="eyebrow">IN THIS GUIDE</span>
                      {guide.units.map((u, i) => (
                        <button
                          key={u.id}
                          disabled={locked}
                          className={data.currentUnit === i ? "current" : ""}
                          onClick={() =>
                            update((d) => ({ ...d, currentUnit: i }))
                          }
                        >
                          <span>
                            {data.studied.includes(u.id) ? (
                              <Check size={14} />
                            ) : (
                              String(i + 1).padStart(2, "0")
                            )}
                          </span>
                          <strong>{u.title}</strong>
                        </button>
                      ))}
                      <p>
                        Reading progress is separate from what your answers
                        demonstrate.
                      </p>
                    </nav>
                    {unit && (
                      <article className="study-card">
                        <div className="unit-top">
                          <span className="pill">
                            TOPIC {data.currentUnit + 1} OF {guide.units.length}
                          </span>
                        </div>
                        <h2>{unit.title}</h2>
                        <p className="objective">{unit.objective}</p>
                        <p className="explanation">{unit.explanation}</p>
                        {unit.keyPoints.length > 0 && (
                          <div className="key-points">
                            <h3>Key points</h3>
                            <ul>
                              {unit.keyPoints.map((p, i) => (
                                <li key={i}>{p}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {(unit.detail ||
                          unit.example ||
                          unit.misconception) && (
                          <details className="detail">
                            <summary>Details and examples</summary>
                            <p>{unit.detail}</p>
                            {unit.example && (
                              <>
                                <h3>An illustrative example</h3>
                                <p>{unit.example}</p>
                              </>
                            )}
                            {unit.misconception && (
                              <>
                                <h3>A common mix-up</h3>
                                <p>{unit.misconception}</p>
                              </>
                            )}
                          </details>
                        )}
                        {unit.citations.length > 0 && (
                          <>
                            <div className="source-label">
                              FROM YOUR MATERIAL
                            </div>
                            {citations(unit.citations)}
                          </>
                        )}
                        {unit.recallPrompt && (
                          <div className="recall">
                            <span className="eyebrow">RECALL QUESTION</span>
                            <h3>{unit.recallPrompt}</h3>
                            <p>
                              Try answering in your own words before checking.
                            </p>
                            <button
                              className="text-button"
                              onClick={() => setShowRecall(!showRecall)}
                              aria-expanded={showRecall}
                            >
                              {showRecall ? "Hide" : "Show"} reference answer
                              <ChevronRight size={15} />
                            </button>
                            {showRecall && (
                              <p className="reference-answer">
                                {unit.recallAnswer}
                              </p>
                            )}
                          </div>
                        )}
                        <div className="card-footer">
                          <button
                            className="secondary"
                            disabled={locked}
                            onClick={() =>
                              update((d) => ({
                                ...d,
                                studied: d.studied.includes(unit.id)
                                  ? d.studied.filter((x) => x !== unit.id)
                                  : [...d.studied, unit.id],
                              }))
                            }
                          >
                            <Check size={16} />
                            {data.studied.includes(unit.id)
                              ? "Read"
                              : "Mark as read"}
                          </button>
                          <button
                            className="primary"
                            disabled={locked}
                            onClick={() => {
                              update((d) => ({
                                ...d,
                                currentQuestion: Math.max(
                                  0,
                                  guide.questions.findIndex(
                                    (q) => q.unitId === unit.id,
                                  ),
                                ),
                              }));
                              setTab("practice");
                            }}
                          >
                            Practice this topic
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      </article>
                    )}
                  </div>
                  <p className="ai-footnote">
                    {local
                      ? "Review your study set against your materials. Imported and manually edited content is not automatically verified. Local AI checks can also miss mistakes."
                      : "AI-generated study support. Quotes are checked against sources, and a second AI pass checks content. These checks do not guarantee accuracy or full exam coverage."}
                  </p>
                </>
              )}
            </>
          )}
          {tab === "practice" && (
            <>
              <div className="content-heading">
                <div>
                  <h1>Practice questions</h1>
                  <p>Choose an answer, then check the explanation.</p>
                </div>
                {guide && (
                  <span className="practice-count">
                    {answered} / {guide.questions.length} attempted
                  </span>
                )}
              </div>
              {!guide || !question ? (
                <div className="empty-learning">
                  <CircleHelp size={36} />
                  <h2>
                    {guide
                      ? "Add a question to start practicing."
                      : "Your practice starts with a study set."}
                  </h2>
                  <p>
                    {local
                      ? "Use the study-set editor above to add questions, or import a study set."
                      : "Create a study guide first. Each question will connect back to the material you added."}
                  </p>
                  <button
                    className="primary"
                    onClick={() => setTab("materials")}
                  >
                    Go to materials
                    <ArrowRight size={17} />
                  </button>
                </div>
              ) : (
                <div className="practice-layout">
                  <section className="question-card">
                    <div className="unit-top">
                      <span className="pill">
                        QUESTION {data.currentQuestion + 1} OF{" "}
                        {guide.questions.length}
                      </span>
                      <span>No time limit</span>
                    </div>
                    <progress
                      aria-label="Questions attempted"
                      value={answered}
                      max={guide.questions.length}
                    />
                    <h2>{question.prompt}</h2>
                    <fieldset disabled={Boolean(attempt) || locked}>
                      <legend className="sr-only">Choose one answer</legend>
                      {question.options.map((o, i) => (
                        <label
                          key={i}
                          className={`answer-option ${selected === i ? "selected" : ""} ${attempt && (i === question.correctIndex ? "correct" : attempt.selected === i ? "incorrect" : "")}`}
                        >
                          <input
                            type="radio"
                            name={question.id}
                            checked={selected === i || attempt?.selected === i}
                            onChange={() => setSelected(i)}
                          />
                          <span className="option-letter">
                            {String.fromCharCode(65 + i)}
                          </span>
                          <span>{o.text}</span>
                          {attempt && i === question.correctIndex && (
                            <CheckCircle2 size={19} />
                          )}
                        </label>
                      ))}
                    </fieldset>
                    {!attempt ? (
                      <>
                        <div className="question-actions">
                          <button
                            className="text-button"
                            disabled={locked || !question.hint}
                            onClick={() => {
                              setHinted(true);
                              update((d) => ({
                                ...d,
                                hintUsed: d.hintUsed.includes(question.id)
                                  ? d.hintUsed
                                  : [...d.hintUsed, question.id],
                              }));
                            }}
                          >
                            <Lightbulb size={16} />
                            Show hint
                          </button>
                          <button
                            className="primary"
                            disabled={selected === null || locked}
                            onClick={() => answer()}
                          >
                            Check my answer
                            <ArrowRight size={16} />
                          </button>
                        </div>
                        {(hinted || data.hintUsed.includes(question.id)) && (
                          <p className="hint">{question.hint}</p>
                        )}
                        <button
                          className="reveal-button"
                          disabled={locked}
                          onClick={() => answer(true)}
                        >
                          I’m not sure — show the explanation
                        </button>
                      </>
                    ) : (
                      <div className="feedback" role="status">
                        <h3>
                          {attempt.revealed
                            ? "Here’s how to think about it"
                            : attempt.selected === question.correctIndex
                              ? "Correct"
                              : "Review the explanation"}
                        </h3>
                        {attempt.hinted && !attempt.revealed && (
                          <p className="small">
                            You used a hint. This is recorded as supported
                            practice.
                          </p>
                        )}
                        {question.options.map((o, i) => (
                          <div className="option-explanation" key={i}>
                            <strong>
                              {String.fromCharCode(65 + i)} ·{" "}
                              {i === question.correctIndex
                                ? "Correct answer"
                                : "Why this doesn’t fit"}
                            </strong>
                            <p>
                              {o.explanation ||
                                "No explanation was added for this choice."}
                            </p>
                          </div>
                        ))}
                        {question.citations.length > 0 && (
                          <>
                            <span className="source-label">
                              CHECK THE SOURCE
                            </span>
                            {citations(question.citations)}
                          </>
                        )}
                      </div>
                    )}
                    <div className="question-navigation">
                      <button
                        className="secondary"
                        disabled={locked || data.currentQuestion === 0}
                        onClick={() =>
                          update((d) => ({
                            ...d,
                            currentQuestion: d.currentQuestion - 1,
                          }))
                        }
                      >
                        <ArrowLeft size={16} />
                        Previous
                      </button>
                      {data.currentQuestion < guide.questions.length - 1 ? (
                        <button
                          className="secondary"
                          disabled={locked}
                          onClick={() =>
                            update((d) => ({
                              ...d,
                              currentQuestion: d.currentQuestion + 1,
                            }))
                          }
                        >
                          Next question
                          <ArrowRight size={16} />
                        </button>
                      ) : (
                        <button
                          className="secondary"
                          onClick={() => setTab("guide")}
                        >
                          Return to guide
                          <BookOpen size={16} />
                        </button>
                      )}
                    </div>
                  </section>
                  <aside className="practice-aside">
                    <div className="practice-summary">
                      <span className="eyebrow">YOUR PRACTICE SO FAR</span>
                      <strong className="big-number">
                        {correct}
                        <span> / {guide.questions.length}</span>
                      </strong>
                      <p>
                        Answered correctly
                        <br />
                        without a hint or reveal
                      </p>
                      <div className="question-dots">
                        {guide.questions.map((q, i) => {
                          const a = data.attempts.find(
                            (a) => a.questionId === q.id,
                          );
                          return (
                            <button
                              key={q.id}
                              disabled={locked}
                              aria-label={`Go to question ${i + 1}${a ? ", attempted" : ""}`}
                              aria-current={
                                i === data.currentQuestion ? "step" : undefined
                              }
                              className={`${i === data.currentQuestion ? "active" : ""} ${a ? "attempted" : ""}`}
                              onClick={() =>
                                update((d) => ({ ...d, currentQuestion: i }))
                              }
                            >
                              {i + 1}
                            </button>
                          );
                        })}
                      </div>
                      <p className="small">
                        One session is a starting point, not a mastery score.
                        Come back later and try recalling the ideas again.
                      </p>
                      {answered > 0 && (
                        <button
                          className="text-button"
                          disabled={locked}
                          onClick={() =>
                            setConfirm({
                              text: "Start a fresh practice round? This clears attempts for these same questions. Repeating them is practice, not proof of long-term recall.",
                              run: () =>
                                update((d) => ({
                                  ...d,
                                  attempts: [],
                                  hintUsed: [],
                                  currentQuestion: 0,
                                })),
                            })
                          }
                        >
                          <RotateCcw size={14} />
                          Start another round
                        </button>
                      )}
                    </div>
                    <div className="tip">
                      <Lightbulb size={20} />
                      <p>
                        Getting something wrong gives you a useful place to
                        focus your next review.
                      </p>
                    </div>
                  </aside>
                </div>
              )}
            </>
          )}
          {local && (tab === "cards" || tab === "trail") && (
            <Flashcards
              key={JSON.stringify([data.guide, data.sources])}
              data={data}
              mode={tab === "trail" ? "trail" : "cards"}
              locked={locked || saving !== "All changes saved"}
              openCitation={openCitation}
              onMaterials={() => setTab("materials")}
            />
          )}
          <footer className="page-footer">
            <span>StudyStep</span>
            <button
              className="text-button"
              disabled={locked || (!data.sources.length && !data.guide)}
              onClick={() =>
                setConfirm({
                  text: "Delete all materials, guides, and practice progress? This cannot be undone.",
                  run: async () => {
                    try {
                      if (timer.current) clearTimeout(timer.current);
                      if (savePromise.current) await savePromise.current;
                      const r = await api("/api/workspace", {
                        method: "DELETE",
                        body: JSON.stringify({ revision: revision.current }),
                      });
                      adopt(r.data, r.revision);
                      setTab("materials");
                      setNotice("Your workspace has been cleared.");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  },
                })
              }
            >
              Clear workspace
            </button>
          </footer>
        </main>
      </div>
      {notes && (
        <Modal title="Add your notes" onClose={() => setNotes(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addText(noteText, noteName);
            }}
          >
            <label className="field-label" htmlFor="note-title">
              Source title
            </label>
            <input
              id="note-title"
              value={noteName}
              onChange={(e) => setNoteName(e.target.value)}
              maxLength={180}
              placeholder="e.g. Chapter 2 lecture notes"
            />
            <label className="field-label" htmlFor="note-body">
              Study material
            </label>
            <textarea
              id="note-body"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              maxLength={80000}
              rows={12}
              placeholder="Paste the text you want to study…"
              required
              minLength={50}
            />
            <p className="small">
              {noteText.length.toLocaleString()} characters · 50 minimum
            </p>
            <button className="primary" type="submit">
              Add notes
              <Plus size={17} />
            </button>
          </form>
        </Modal>
      )}
      {sourceView && (
        <Modal
          title={sourceView.source.name}
          wide
          onClose={() => setSourceView(null)}
        >
          <div className="source-preview-meta">
            <span className="pill">EXTRACTED SOURCE TEXT</span>
            <span>
              {sourceView.source.type.toUpperCase()} ·{" "}
              {sourceView.source.passages.length} passages
            </span>
          </div>
          {sourceView.quote && (
            <blockquote className="quoted-evidence">
              <span className="eyebrow">CITED EXCERPT</span>
              <p>“{sourceView.quote}”</p>
            </blockquote>
          )}
          {sourceView.source.originUrl && (
            <p>
              <a
                href={sourceView.source.originUrl}
                target="_blank"
                rel="noreferrer"
              >
                Original reference article
              </a>
              <br />
              <span className="small">
                {sourceView.source.attribution} · Retrieved{" "}
                {new Date(sourceView.source.addedAt).toLocaleDateString()}
              </span>
            </p>
          )}
          {sourceView.source.warnings.map((w, i) => (
            <p className="extraction-warning" key={i}>
              {w}
            </p>
          ))}
          <div className="passage-list">
            {(sourceView.passageId
              ? sourceView.source.passages.filter(
                  (p) => p.id === sourceView.passageId,
                )
              : sourceView.source.passages
            ).map((p) => (
              <section key={p.id}>
                <h3>{p.label}</h3>
                <p>{p.text}</p>
              </section>
            ))}
          </div>
          {sourceView.passageId && (
            <button
              className="secondary"
              onClick={() => setSourceView({ source: sourceView.source })}
            >
              View all extracted text
            </button>
          )}
        </Modal>
      )}
      {confirm && (
        <Modal title="Before you continue" onClose={() => setConfirm(null)}>
          <p className="confirmation-copy">{confirm.text}</p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => {
                const action = confirm.run;
                setConfirm(null);
                action();
              }}
            >
              Continue
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
