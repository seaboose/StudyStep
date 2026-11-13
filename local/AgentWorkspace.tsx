import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type {
  AgentBrief,
  AgentSnapshot,
  AgentTaskView,
  LearningLevel,
} from "../lib/agent-workflow";
import type { Citation, Source } from "../lib/study";
import "./agents.css";

const levels: Record<LearningLevel, string> = {
  foundation: "Build foundations",
  explain: "Explain and connect ideas",
  apply: "Apply what I know",
};
const statuses: Record<AgentTaskView["status"], string> = {
  queued: "Queued",
  researching: "Researching",
  writing: "Creating material",
  reviewing: "Checking answers",
  ready: "Ready for your review",
  accepted: "Added to your study set",
  failed: "Needs attention",
  cancelled: "Stopped",
};
const running = new Set(["queued", "researching", "writing", "reviewing"]);
const initialBrief: AgentBrief = {
  topic: "",
  goal: "",
  level: "foundation",
  sourceMode: "research",
  personalize: true,
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    signal: options?.signal || AbortSignal.timeout(20000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.error || "This action could not finish. Please try again.",
    );
  return value as T;
}

function Evidence({
  citations,
  sources,
}: {
  citations: Citation[];
  sources: Source[];
}) {
  return (
    <details className="agent-evidence">
      <summary>
        Read supporting passages <span>{citations.length}</span>
      </summary>
      {citations.map((citation, index) => {
        const source = sources.find((s) =>
          s.passages.some((p) => p.id === citation.passageId),
        );
        const passage = source?.passages.find(
          (p) => p.id === citation.passageId,
        );
        return (
          <figure key={`${citation.passageId}-${index}`}>
            <blockquote>{citation.quote}</blockquote>
            <figcaption>
              {source?.name || "Included source"}
              {passage?.label ? ` · ${passage.label}` : ""}
              {source?.originUrl && (
                <a href={source.originUrl} target="_blank" rel="noreferrer">
                  Open source <ExternalLink size={13} />
                </a>
              )}
            </figcaption>
          </figure>
        );
      })}
    </details>
  );
}

export default function AgentWorkspace({
  active,
  onStudy,
}: {
  active: boolean;
  onStudy: () => void;
}) {
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [brief, setBrief] = useState<AgentBrief>(initialBrief);
  const [selectedId, setSelectedId] = useState("");
  const [nextLevel, setNextLevel] = useState<"auto" | LearningLevel>("auto");
  const [modelName, setModelName] = useState("");
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  const refreshing = useRef(false);
  const refreshPending = useRef(false);
  const mutation = useRef(false);
  const sequence = useRef(0);
  const selected =
    snapshot?.tasks.find((task) => task.id === selectedId) ||
    snapshot?.tasks[0];

  function adopt(value: AgentSnapshot) {
    setSnapshot(value);
    setModelName((current) =>
      value.model.models.some((m) => m.name === current)
        ? current
        : value.model.model || value.model.models[0]?.name || "",
    );
    setSelectedId((current) =>
      value.tasks.some((task) => task.id === current)
        ? current
        : [...value.tasks].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          )[0]?.id || "",
    );
  }
  async function refresh() {
    if (refreshing.current || mutation.current) {
      refreshPending.current = true;
      return;
    }
    refreshing.current = true;
    const seq = ++sequence.current;
    setLoading(true);
    try {
      const value = await request<AgentSnapshot>("/api/agents");
      if (mounted.current && seq === sequence.current) {
        adopt(value);
        setLoadError("");
      }
    } catch (error) {
      if (mounted.current && seq === sequence.current)
        setLoadError((error as Error).message);
    } finally {
      refreshing.current = false;
      if (mounted.current) setLoading(false);
      if (mounted.current && refreshPending.current && !mutation.current) {
        refreshPending.current = false;
        void refresh();
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    window.addEventListener("studystep:workspace-changed", focus);
    window.addEventListener("studystep:progress-saved", focus);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("studystep:workspace-changed", focus);
      window.removeEventListener("studystep:progress-saved", focus);
    };
  }, [active]);
  useEffect(() => {
    if (!active || !snapshot?.active) return;
    const timer = setInterval(() => void refresh(), 1200);
    return () => clearInterval(timer);
  }, [active, snapshot?.active]);
  useEffect(() => {
    setNextLevel("auto");
  }, [selected?.id]);

  async function command(
    payload: Record<string, unknown>,
    label: string,
    selectId?: string,
  ) {
    if (mutation.current) return;
    mutation.current = true;
    sequence.current++;
    setBusy(label);
    setActionError("");
    setNotice("");
    try {
      const value = await request<AgentSnapshot>("/api/agents", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!mounted.current) return;
      adopt(value);
      setLoadError("");
      if (selectId) setSelectedId(selectId);
      if (payload.action === "accept") {
        window.dispatchEvent(new Event("studystep:workspace-changed"));
        setNotice("The reviewed cards and quiz were added to your study set.");
      }
      if (payload.action === "create" || payload.action === "continue")
        setNotice("Task saved. You can keep studying while the agents work.");
    } catch (error) {
      if (mounted.current) setActionError((error as Error).message);
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy("");
      if (mounted.current && refreshPending.current) {
        refreshPending.current = false;
        void refresh();
      }
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = crypto.randomUUID();
    void command({ action: "create", id, brief }, "Assigning task…", id);
  }
  async function saveModel() {
    if (mutation.current) return;
    mutation.current = true;
    sequence.current++;
    setBusy("Selecting model…");
    setActionError("");
    try {
      await request("/api/local-model", {
        method: "PUT",
        body: JSON.stringify({ model: modelName }),
      });
      const value = await request<AgentSnapshot>("/api/agents");
      if (mounted.current) {
        adopt(value);
        setLoadError("");
        setNotice("Local model selected.");
      }
    } catch (error) {
      if (mounted.current) setActionError((error as Error).message);
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy("");
      if (mounted.current && refreshPending.current) {
        refreshPending.current = false;
        void refresh();
      }
    }
  }
  const unavailable = !snapshot?.model.ready;
  const selectedRunning = !!selected && running.has(selected.status);
  const disabled = !!busy || !snapshot || !!loadError;
  const setField = <K extends keyof AgentBrief>(key: K, value: AgentBrief[K]) =>
    setBrief((current) => ({ ...current, [key]: value }));

  return (
    <div className="agent-workspace">
      <section className="agent-intro">
        <div>
          <span className="eyebrow">YOUR CURIOSITY, WITH A LITTLE HELP</span>
          <h1>Learning agents</h1>
          <p>
            Give a topic a goal. Get sourced cards and a short quiz, then choose
            what to learn next.
          </p>
        </div>
        <span className="agent-edition">DEV · LOCAL AI</span>
      </section>
      {(actionError || loadError) && (
        <div className="agent-alert agent-error" role="alert">
          <span>{actionError || loadError}</span>
          <button onClick={() => void refresh()} disabled={!!busy || loading}>
            <RefreshCw size={15} /> Refresh tasks
          </button>
        </div>
      )}
      {notice && (
        <div className="agent-alert agent-notice" role="status">
          <span>{notice}</span>
          <button
            aria-label="Dismiss agent message"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {!snapshot && !loadError && (
        <p className="agent-loading" role="status">
          <Loader2 size={18} className="spin" /> Loading your learning tasks…
        </p>
      )}
      <div className="agent-layout">
        <aside className="agent-sidebar">
          <section className="agent-panel">
            <div className="agent-panel-heading">
              <Sparkles size={20} />
              <h2>Assign a learning task</h2>
            </div>
            <form onSubmit={submit} className="agent-form">
              <label htmlFor="agent-topic">
                Topic
                <input
                  id="agent-topic"
                  value={brief.topic}
                  onChange={(e) => setField("topic", e.target.value)}
                  required
                  minLength={2}
                  maxLength={160}
                  placeholder="Conditional probability, French, art history…"
                />
              </label>
              <label htmlFor="agent-goal">
                What do you want to understand?
                <textarea
                  id="agent-goal"
                  value={brief.goal}
                  onChange={(e) => setField("goal", e.target.value)}
                  required
                  minLength={10}
                  maxLength={1200}
                  rows={4}
                  placeholder="Help me explain the idea clearly and answer a few questions about it."
                />
              </label>
              <label htmlFor="agent-level">
                Starting challenge
                <select
                  id="agent-level"
                  aria-label="Starting challenge"
                  value={brief.level}
                  onChange={(e) =>
                    setField("level", e.target.value as LearningLevel)
                  }
                >
                  {Object.entries(levels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="agent-sources">
                Research from
                <select
                  id="agent-sources"
                  aria-label="Research from"
                  value={brief.sourceMode}
                  onChange={(e) =>
                    setField(
                      "sourceMode",
                      e.target.value as AgentBrief["sourceMode"],
                    )
                  }
                >
                  <option value="research">Find Wikipedia overviews</option>
                  <option value="workspace">My selected study material</option>
                </select>
              </label>
              <p className="agent-help">
                {brief.sourceMode === "research"
                  ? "This first version researches Wikipedia introductions. Your topic and research queries go to Wikipedia. Review coverage and sources before accepting the material."
                  : "Uses the selected passages already in your study workspace. Choose source sections from Create a set before assigning this task."}
              </p>
              <label className="agent-checkbox">
                <input
                  type="checkbox"
                  checked={brief.personalize}
                  onChange={(e) => setField("personalize", e.target.checked)}
                />
                <span>Use my quiz progress to suggest the next challenge</span>
              </label>
              <button
                className="primary agent-submit"
                type="submit"
                disabled={disabled || unavailable}
              >
                {busy === "Assigning task…" ? (
                  <Loader2 size={17} className="spin" />
                ) : (
                  <ArrowRight size={17} />
                )}
                Assign task
              </button>
              <p className="agent-help">
                One task at a time on your local model. New material waits for
                your review before joining your study set.
              </p>
            </form>
          </section>
          <section className="agent-panel agent-model">
            <div className="agent-panel-heading">
              <h2>Local model</h2>
              <span className={unavailable ? "agent-offline" : "agent-online"}>
                {snapshot?.model.ready
                  ? "Ready"
                  : snapshot?.model.connected
                    ? "Choose a model"
                    : "Not connected"}
              </span>
            </div>
            {snapshot?.model.models.length ? (
              <>
                <label htmlFor="agent-model">
                  Installed model
                  <select
                    id="agent-model"
                    aria-label="Installed model"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                  >
                    {snapshot.model.models.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => void saveModel()}
                  disabled={
                    disabled || !modelName || modelName === snapshot.model.model
                  }
                >
                  Use this model
                </button>
              </>
            ) : (
              <p className="agent-help">
                Start the local Ollama runtime and install a model, then
                refresh. Your existing manual study tools remain available.
              </p>
            )}
            <button
              className="agent-text-button"
              onClick={() => void refresh()}
              disabled={!!busy || loading}
            >
              <RefreshCw size={15} />
              {loading ? "Checking…" : "Refresh connection"}
            </button>
          </section>
        </aside>
        <section className="agent-results" aria-label="Learning tasks">
          <div className="agent-results-heading">
            <h2>Your learning tasks</h2>
            <span>{snapshot?.tasks.length || 0} saved</span>
          </div>
          {!snapshot?.tasks.length ? (
            <div className="agent-empty agent-panel">
              <Search size={32} />
              <h3>A question is a good place to start</h3>
              <p>
                Choose something you want to understand. Your agents will
                research it, draft study material, and check their answers
                before you review it.
              </p>
              <div className="agent-role-list">
                <span>Researcher</span>
                <ChevronRight size={14} />
                <span>Card author</span>
                <ChevronRight size={14} />
                <span>Reviewer</span>
              </div>
            </div>
          ) : (
            <>
              <nav
                className="agent-task-list"
                aria-label="Saved learning tasks"
              >
                {[...snapshot.tasks]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((task) => (
                    <button
                      key={task.id}
                      aria-current={
                        task.id === selected?.id ? "page" : undefined
                      }
                      onClick={() => {
                        setSelectedId(task.id);
                        setActionError("");
                      }}
                    >
                      <strong>{task.brief.topic}</strong>
                      <span className={`agent-status is-${task.status}`}>
                        {statuses[task.status]}
                      </span>
                    </button>
                  ))}
              </nav>
              {selected && (
                <article
                  className="agent-task-detail"
                  aria-label={`Learning task: ${selected.brief.topic}`}
                >
                  <section className="agent-panel">
                    <div className="agent-task-heading">
                      <div>
                        <span className={`agent-status is-${selected.status}`}>
                          {statuses[selected.status]}
                        </span>
                        <h2>{selected.brief.topic}</h2>
                      </div>
                      {selectedRunning && (
                        <Loader2
                          className="spin"
                          size={22}
                          aria-label="Agents are working"
                        />
                      )}
                    </div>
                    <p className="agent-goal">{selected.brief.goal}</p>
                    <div className="agent-task-meta">
                      <span>{levels[selected.brief.level]}</span>
                      <span>
                        {selected.brief.sourceMode === "research"
                          ? "Wikipedia research"
                          : "Your selected material"}
                      </span>
                      <span>
                        {selected.brief.personalize
                          ? "Progress suggestions on"
                          : "Your chosen level"}
                      </span>
                    </div>
                    {selected.adaptation && (
                      <p className="agent-adaptation">{selected.adaptation}</p>
                    )}
                    {selected.error && (
                      <p className="agent-alert agent-error" role="alert">
                        {selected.error}
                      </p>
                    )}
                    <div className="agent-actions">
                      {(selectedRunning || selected.status === "ready") && (
                        <button
                          disabled={disabled}
                          onClick={() =>
                            void command(
                              { action: "cancel", id: selected.id },
                              "Stopping task…",
                            )
                          }
                        >
                          <X size={15} />
                          {selected.status === "ready"
                            ? "Discard proposal"
                            : "Stop task"}
                        </button>
                      )}
                      {(selected.status === "failed" ||
                        selected.status === "cancelled") && (
                        <button
                          disabled={disabled || unavailable}
                          onClick={() =>
                            void command(
                              { action: "retry", id: selected.id },
                              "Retrying task…",
                            )
                          }
                        >
                          <RefreshCw size={15} />
                          Retry task
                        </button>
                      )}
                      {selected.status === "accepted" && (
                        <button className="primary" onClick={onStudy}>
                          <BookOpen size={16} />
                          Open study set
                        </button>
                      )}
                    </div>
                    {!!selected.events.length && (
                      <details
                        className="agent-activity"
                        open={selectedRunning}
                      >
                        <summary>Agent activity</summary>
                        <ol>
                          {selected.events.map((event, index) => (
                            <li key={`${event.at}-${index}`}>
                              <span>{event.role}</span>
                              <p>{event.message}</p>
                              <time dateTime={event.at}>
                                {new Date(event.at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </section>
                  {!!selected.sources.length && (
                    <section className="agent-panel agent-sources">
                      <h3>Sources used</h3>
                      <ul>
                        {selected.sources.map((source) => (
                          <li key={source.id}>
                            <div>
                              {source.originUrl ? (
                                <a
                                  href={source.originUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {source.name}
                                  <ExternalLink size={14} />
                                </a>
                              ) : (
                                <strong>{source.name}</strong>
                              )}
                              <small>
                                {source.attribution ||
                                  "From your study material"}
                              </small>
                            </div>
                            {source.warnings.map((warning, index) => (
                              <p key={index}>{warning}</p>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {selected.status === "accepted" && (
                    <section className="agent-panel agent-next-step">
                      <div className="agent-panel-heading">
                        <Sparkles size={20} />
                        <h3>Your next step</h3>
                      </div>
                      <p>
                        Based on unchanged quiz questions from this topic’s
                        accepted tasks. Hints and revealed answers stay separate
                        from unaided results.
                      </p>
                      <dl className="agent-progress">
                        <div>
                          <dt>Answered</dt>
                          <dd>
                            {selected.progress.attempted}
                            <small> / {selected.progress.total}</small>
                          </dd>
                        </div>
                        <div>
                          <dt>Correct unaided</dt>
                          <dd>{selected.progress.independentCorrect}</dd>
                        </div>
                        <div>
                          <dt>With help</dt>
                          <dd>{selected.progress.assisted}</dd>
                        </div>
                        <div>
                          <dt>Needs review</dt>
                          <dd>{selected.progress.incorrect}</dd>
                        </div>
                      </dl>
                      <p className="agent-recommendation">
                        {selected.progress.reason}
                      </p>
                      <label htmlFor="agent-next-level">
                        Next challenge
                        <select
                          id="agent-next-level"
                          aria-label="Next challenge"
                          value={nextLevel}
                          onChange={(e) =>
                            setNextLevel(e.target.value as typeof nextLevel)
                          }
                        >
                          <option value="auto">
                            Use suggestion · {levels[selected.progress.level]}
                          </option>
                          {Object.entries(levels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {nextLevel !== "auto" && (
                        <p className="agent-help">
                          This is your chosen challenge, not a claim that you
                          have mastered the previous level.
                        </p>
                      )}
                      <button
                        className="primary"
                        disabled={disabled || unavailable}
                        onClick={() => {
                          const newId = crypto.randomUUID();
                          void command(
                            {
                              action: "continue",
                              id: selected.id,
                              newId,
                              level: nextLevel,
                            },
                            "Building next step…",
                            newId,
                          );
                        }}
                      >
                        <ArrowRight size={16} />
                        Build next step
                      </button>
                    </section>
                  )}
                  {selected.proposal &&
                    (selected.status === "ready" ||
                      selected.status === "accepted") && (
                      <section className="agent-panel agent-proposal">
                        <div className="agent-proposal-heading">
                          <div>
                            <span className="eyebrow">
                              {selected.status === "accepted"
                                ? "ACCEPTED MATERIAL"
                                : "YOUR REVIEW"}
                            </span>
                            <h3>{selected.proposal.title}</h3>
                          </div>
                          <span>
                            {selected.proposal.units.length}{" "}
                            {selected.proposal.units.length === 1
                              ? "card"
                              : "cards"}{" "}
                            · {selected.proposal.questions.length} quiz{" "}
                            {selected.proposal.questions.length === 1
                              ? "question"
                              : "questions"}
                          </span>
                        </div>
                        <p>
                          Read the answers and their sources. Automated review
                          can miss errors.
                        </p>
                        <div className="agent-preview-cards">
                          {selected.proposal.units.map((unit, index) => (
                            <article
                              className="agent-preview-card"
                              key={unit.id}
                            >
                              <span className="agent-card-label">
                                CARD {index + 1}
                              </span>
                              <h4>{unit.recallPrompt}</h4>
                              <p className="agent-preview-answer">
                                {unit.recallAnswer}
                              </p>
                              <p>{unit.explanation}</p>
                              <Evidence
                                citations={unit.citations}
                                sources={selected.sources}
                              />
                            </article>
                          ))}
                        </div>
                        <details className="agent-quiz-preview">
                          <summary>
                            Review quiz questions (
                            {selected.proposal.questions.length})
                          </summary>
                          {selected.proposal.questions.map(
                            (question, index) => (
                              <article key={question.id}>
                                <h4>
                                  {index + 1}. {question.prompt}
                                </h4>
                                <ol type="A">
                                  {question.options.map(
                                    (option, optionIndex) => (
                                      <li
                                        key={optionIndex}
                                        className={
                                          optionIndex === question.correctIndex
                                            ? "agent-correct-option"
                                            : undefined
                                        }
                                      >
                                        <span>{option.text}</span>
                                        {optionIndex ===
                                          question.correctIndex && (
                                          <strong>
                                            <Check size={14} />
                                            Correct answer
                                          </strong>
                                        )}
                                        <small>{option.explanation}</small>
                                      </li>
                                    ),
                                  )}
                                </ol>
                                <Evidence
                                  citations={question.citations}
                                  sources={selected.sources}
                                />
                              </article>
                            ),
                          )}
                        </details>
                        {!!selected.proposal.gaps.length && (
                          <div className="agent-gaps">
                            <h4>Coverage and limitations</h4>
                            <ul>
                              {selected.proposal.gaps.map((gap, index) => (
                                <li key={index}>{gap}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {selected.status === "ready" && (
                          <div className="agent-accept">
                            <p>
                              Adds the reviewed material to your current study
                              set. Existing cards stay in place.
                            </p>
                            <button
                              className="primary"
                              disabled={disabled}
                              onClick={() =>
                                void command(
                                  {
                                    action: "accept",
                                    id: selected.id,
                                    proposalHash: selected.proposalHash,
                                    revision: snapshot.revision,
                                  },
                                  "Adding reviewed material…",
                                )
                              }
                            >
                              <Check size={17} />
                              Add cards and quiz to study set
                            </button>
                          </div>
                        )}
                      </section>
                    )}
                </article>
              )}
            </>
          )}
        </section>
      </div>
      {busy && (
        <p className="agent-busy" role="status">
          <Loader2 size={16} className="spin" />
          {busy}
        </p>
      )}
    </div>
  );
}
