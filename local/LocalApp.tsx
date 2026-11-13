import SectionNavigation from "./SectionNavigation";
import { downloadJson } from "../lib/download";
import { useEffect, useLayoutEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Coffee,
  Download,
  Zap,
  Pause,
  Play,
  Layers3,
  Timer,
  Sparkles,
  History,
} from "lucide-react";
import StudyApp from "../app/study-app";
import { SPECIES } from "../lib/focus";
import { useFocus } from "./focus/useFocus";
import LearningPattern from "./focus/Tree";
import AgentWorkspace from "./AgentWorkspace";
import "./focus/focus.css";

type Page = "today" | "study" | "garden" | "journal" | "agents";
const minutes = (ms: number) => Math.floor(ms / 60000);
const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const dayKey = (time: number) => new Date(time).toLocaleDateString();

export default function LocalApp() {
  const [page, setPage] = useState<Page>("study");
  const [agentsEnabled, setAgentsEnabled] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/features", { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : { agents: false })
      .then((features: { agents?: boolean }) => setAgentsEnabled(features.agents === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [page]);
  const [duration, setDuration] = useState(25),
    [task, setTask] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const focus = useFocus();
  const { state, busy, elapsed } = focus;
  const active = state?.active;
  const history = state?.history || [];
  const today = history.filter(
    (h) => h.kind === "focus" && dayKey(h.endedAt) === dayKey(Date.now()),
  );
  const todayMinutes = minutes(today.reduce((n, h) => n + h.elapsedMs, 0));
  const sessions = history.filter(
    (h) => h.kind === "focus" && h.elapsedMs >= 60000,
  );
  const last = history[history.length - 1];
  const disabled = busy || !state || !!focus.error;
  const remaining = active
    ? active.targetMinutes * 60000 - elapsed
    : duration * 60000;
  const nav = [
    { id: "study", label: "Study", icon: BookOpen },
    ...(agentsEnabled ? [{ id: "agents" as const, label: "Learning agents", icon: Sparkles }] : []),
    { id: "today", label: "Focus timer", icon: Timer },
    { id: "garden", label: "Focus collection", icon: Sparkles },
    { id: "journal", label: "Study journal", icon: History },
  ] as const;
  function start(kind: "focus" | "break", value = duration) {
    setConfirmEnd(false);
    setPage("today");
    void focus.command({
      type: "start",
      id: crypto.randomUUID(),
      minutes: value,
      task: kind === "break" ? "Break" : task.trim(),
      kind,
    });
  }
  function exportFocus() {
    if (!state) return;
    downloadJson({ format: "studystep-focus-backup", exportedAt: new Date().toISOString(), state }, "studystep-focus-backup.json");
  }
  return (
    <div className={`desktop-app ${state?.reducedMotion ? "still" : ""}`}>
      <a
        className="skip-link"
        href={page === "study" ? "#main" : "#desktop-main"}
      >
        Skip to workspace
      </a>
      <header className="desktop-header desktop-shell-bar">
        <button className="desktop-brand" onClick={() => setPage("study")}>
          <span>
            <Layers3 size={24} />
          </span>
          <span className="brand-copy"><strong>StudyStep</strong><small>A personal learning workspace</small></span>
        </button>
        <SectionNavigation label="App navigation" sections={nav} current={page} onChange={setPage} />
        <span
          className="leaf-wallet focus-wallet"
          aria-label={`${state?.coins || 0} focus credits earned and available`}
        >
          <Zap size={17} />
          {state?.coins || 0}
          <span>credits</span>
        </span>
      </header>
      {focus.error && (
        <div className="focus-error" role="alert">
          {focus.error}{" "}
          <button onClick={() => void focus.reload()}>Try again</button>
        </div>
      )}
      {page !== "today" && active && (
        <aside className="session-ribbon" aria-label="Current focus session">
          <span className="live-dot" />
          <strong>
            {active.status === "paused"
              ? "Paused"
              : active.kind === "break"
                ? "Taking a break"
                : "Focus session"}
          </strong>
          <span aria-live="off">{clock(remaining)}</span>
          <button
            disabled={disabled}
            onClick={() =>
              void focus.command({
                type: active.status === "running" ? "pause" : "resume",
                id: active.id,
              })
            }
          >
            {active.status === "running" ? "Pause" : "Resume"}
          </button>
          <button onClick={() => setPage("today")}>
            Back to session
            <ArrowRight size={15} />
          </button>
        </aside>
      )}
      <div hidden={page !== "study"} className="retained-study">
        <StudyApp local />
      </div>
      {agentsEnabled && <main id={page === "agents" ? "desktop-main" : undefined} hidden={page !== "agents"} tabIndex={-1}><AgentWorkspace active={page === "agents"} onStudy={() => setPage("study")} /></main>}
      {page !== "study" && page !== "agents" && (
        <main id="desktop-main" className="focus-main" tabIndex={-1}>
          {page === "today" && (
            <>
              <section className="focus-intro">
                <div>
                  <h1>
                    {active?.kind === "break" ? "Break timer" : "Focus timer"}
                  </h1>
                  <p>
                    {active
                      ? "Stay on your objective. Pause whenever you need; your work is saved locally."
                      : "Make a little room for what you want to learn. Choose a duration and begin."}
                  </p>
                </div>
                <span className="local-badge">
                  <span />
                  Saved on this computer
                </span>
              </section>
              <div className="today-grid">
                <section
                  className="plant-card station-card"
                  aria-label="Focus session"
                >
                  <div className="plant-meta station-meta">
                    <span>
                      {active
                        ? active.kind === "break"
                          ? "BREAK"
                          : active.status === "paused"
                            ? "PAUSED"
                            : "FOCUS SESSION"
                        : "FOCUS SESSION"}
                    </span>
                    <span>
                      {SPECIES.find(
                        (s) => s.id === (active?.species || state?.selected),
                      )?.name || "Spark"}
                    </span>
                  </div>
                  <div
                    className={`tree-scene station-scene ${active?.status === "running" ? "growing" : ""}`}
                  >
                    <div className="scene-halo" />
                    <LearningPattern
                      species={active?.species || state?.selected}
                      progress={
                        active
                          ? Math.max(
                              0.06,
                              elapsed / (active.targetMinutes * 60000),
                            )
                          : 0.2
                      }
                    />
                    <span className="scene-note">
                      {active
                        ? active.status === "paused"
                          ? "Session paused."
                          : active.kind === "break"
                            ? "Break in progress."
                            : "Session in progress."
                        : "Each saved session adds a pattern to your collection."}
                    </span>
                  </div>
                  <div
                    className="timer-readout"
                    role="timer"
                    aria-label={
                      active
                        ? `${active.status === "paused" ? "Paused" : "Remaining time"}`
                        : "Selected duration"
                    }
                    aria-live="off"
                  >
                    {clock(remaining)}
                  </div>
                  {active ? (
                    <>
                      <p className="session-task">
                        {active.task || "Focus session"}
                      </p>
                      <progress
                        className="focus-progress"
                        value={elapsed}
                        max={active.targetMinutes * 60000}
                        aria-label="Session time elapsed"
                      />
                      <p className="session-help">
                        {active.status === "paused"
                          ? "Paused. Reopening after a long interruption also pauses your session."
                          : "Switching to a book or another app is okay. Long interruptions pause automatically."}
                      </p>
                      <div className="session-buttons">
                        <button
                          className="focus-primary"
                          disabled={disabled}
                          onClick={() =>
                            void focus.command({
                              type:
                                active.status === "running"
                                  ? "pause"
                                  : "resume",
                              id: active.id,
                            })
                          }
                        >
                          {active.status === "running" ? (
                            <Pause size={18} />
                          ) : (
                            <Play size={18} />
                          )}
                          {active.status === "running" ? "Pause" : "Resume"}
                        </button>
                        <button
                          className="focus-secondary"
                          disabled={disabled}
                          onClick={() => setConfirmEnd(true)}
                        >
                          Finish session
                        </button>
                      </div>
                      {confirmEnd && (
                        <div
                          className="finish-panel"
                          role="group"
                          aria-label="Finish session"
                        >
                          <strong>Save elapsed time?</strong>
                          <p>
                            {minutes(elapsed)} whole minute
                            {minutes(elapsed) === 1 ? "" : "s"} so far. Ending
                            early is okay.
                          </p>
                          <button
                            className="focus-primary"
                            disabled={disabled}
                            onClick={() => {
                              setConfirmEnd(false);
                              void focus.command({
                                type: "finish",
                                id: active.id,
                              });
                            }}
                          >
                            Save this session
                          </button>
                          <button
                            className="focus-text"
                            onClick={() => setConfirmEnd(false)}
                          >
                            Keep going
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <label
                        className="duration-label"
                        htmlFor="focus-duration"
                      >
                        <span>Duration</span>
                        <strong>{duration} minutes</strong>
                      </label>
                      <input
                        id="focus-duration"
                        className="duration-range"
                        type="range"
                        min="5"
                        max="120"
                        step="5"
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                      />
                      <div className="quick-durations">
                        {[5, 15, 25, 45].map((n) => (
                          <button
                            key={n}
                            aria-pressed={duration === n}
                            onClick={() => setDuration(n)}
                          >
                            {n} min
                          </button>
                        ))}
                      </div>
                      <label className="task-label" htmlFor="focus-task">
                        Task <span>Optional</span>
                      </label>
                      <input
                        id="focus-task"
                        className="task-input"
                        value={task}
                        maxLength={120}
                        onChange={(e) => setTask(e.target.value)}
                        placeholder="Explore an idea, read a chapter, or practice a question…"
                      />
                      <button
                        className="focus-primary plant-start"
                        disabled={disabled}
                        onClick={() => start("focus")}
                      >
                        <Play size={20} />
                        Start timer
                        <ArrowRight size={18} />
                      </button>
                      <p className="no-pressure">
                        You can pause or finish early.
                      </p>
                    </>
                  )}
                </section>
                <aside className="today-aside">
                  <section className="next-action">
                    <BookOpen size={27} />
                    <h2>Study materials</h2>
                    <p>
                      Return to your notes, guide, and practice. A timer is
                      always optional.
                    </p>
                    <button
                      className="focus-secondary"
                      onClick={() => setPage("study")}
                    >
                      Return to study
                      <ArrowRight size={17} />
                    </button>
                  </section>
                  <section className="effort-card">
                    <h2>Focus totals</h2>
                    <div className="effort-numbers">
                      <strong>
                        {todayMinutes}
                        <small>minutes today</small>
                      </strong>
                      <strong>
                        {sessions.length}
                        <small>
                          {sessions.length === 1
                            ? "session logged"
                            : "sessions logged"}
                        </small>
                      </strong>
                    </div>
                    <p>Time spent is effort, not a test of what you know.</p>
                  </section>
                  <section className="break-card">
                    <Coffee size={24} />
                    <div>
                      <h3>Take a break</h3>
                      <p>Stretch, get water, or simply stop for a moment.</p>
                      {!active && (
                        <button
                          className="focus-text"
                          disabled={disabled}
                          onClick={() => start("break", 5)}
                        >
                          Take five minutes
                          <ArrowRight size={15} />
                        </button>
                      )}
                    </div>
                  </section>
                  {!active && last && (
                    <section className="last-session" role="status">
                      <Check size={19} />
                      <div>
                        <strong>
                          {last.kind === "break"
                            ? "Your break is saved."
                            : "Session saved."}
                        </strong>
                        <p>
                          {minutes(last.elapsedMs)} minutes saved
                          {last.coins ? ` · ${last.coins} credits earned` : ""}.
                        </p>
                      </div>
                    </section>
                  )}
                </aside>
              </div>
            </>
          )}
          {page === "garden" && (
            <>
              <section className="focus-intro">
                <div>
                  <h1>Focus collection</h1>
                  <p>
                    A little reminder of the time you make for learning. Each
                    pattern marks a saved focus session of at least one minute.
                  </p>
                </div>
              </section>
              <section className="garden-panel focus-collection-panel">
                {sessions.length ? (
                  <div className="forest-grid station-grid">
                    {sessions.slice(-60).map((h) => (
                      <div
                        className="forest-plot station-record"
                        key={h.id}
                        title={`${h.task || "Focus"} · ${minutes(h.elapsedMs)} minutes`}
                      >
                        <LearningPattern
                          species={h.species}
                          progress={h.outcome === "completed" ? 1 : 0.35}
                          small
                        />
                        <strong>{minutes(h.elapsedMs)} min</strong>
                        <small>
                          {new Date(h.endedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-garden empty-collection">
                    <LearningPattern progress={0.25} />
                    <h2>No focus sessions yet</h2>
                    <p>
                      Save at least one minute of focus to add your first
                      pattern. Choose any subject that interests you.
                    </p>
                    <button
                      className="focus-primary"
                      onClick={() => setPage("today")}
                    >
                      Open focus timer
                      <ArrowRight size={17} />
                    </button>
                  </div>
                )}
                {sessions.length > 60 && (
                  <p className="garden-limit">
                    Showing your latest 60 patterns. All sessions remain in
                    Study journal.
                  </p>
                )}
              </section>
              <h2 className="section-title">Choose a design</h2>
              {active && <p className="no-pressure">Finish the current session before changing designs.</p>}
              <div className="species-grid station-options">
                {SPECIES.map((s) => (
                  <section className="species-card station-option" key={s.id}>
                    <LearningPattern species={s.id} small />
                    <h3>{s.name}</h3>
                    <p>{s.description}</p>
                    <button
                      className="focus-secondary"
                      disabled={
                        disabled || !!active ||
                        state?.selected === s.id ||
                        (!state?.unlocked.includes(s.id) &&
                          (state?.coins || 0) < s.cost)
                      }
                      onClick={() =>
                        void focus.command({ type: "species", species: s.id })
                      }
                    >
                      {state?.selected === s.id
                        ? "Selected"
                        : state?.unlocked.includes(s.id)
                          ? "Use this design"
                          : `Unlock · ${s.cost} credits`}
                    </button>
                  </section>
                ))}
              </div>
              <p className="no-pressure">
                Earn one focus credit per whole minute of study. Designs
                celebrate time spent, not mastery. There are no purchases.
              </p>
            </>
          )}
          {page === "journal" && (
            <>
              <section className="focus-intro">
                <div>
                  <h1>Study journal</h1>
                  <p>
                    Saved focus sessions and breaks. Time spent does not measure
                    learning.
                  </p>
                </div>
                <button
                  className="focus-secondary"
                  disabled={!state}
                  onClick={exportFocus}
                >
                  <Download size={16} />
                  Export focus history
                </button>
              </section>
              <section className="weekly-panel">
                <h2>Your last seven days</h2>
                <div className="week-bars">
                  {Array.from({ length: 7 }, (_, i) => {
                    const date = new Date();
                    date.setDate(date.getDate() - 6 + i);
                    const value = minutes(
                      history
                        .filter(
                          (h) =>
                            h.kind === "focus" &&
                            dayKey(h.endedAt) === dayKey(date.getTime()),
                        )
                        .reduce((n, h) => n + h.elapsedMs, 0),
                    );
                    return (
                      <div key={i}>
                        <strong>
                          {value}
                          <small> min</small>
                        </strong>
                        <div className="bar-track">
                          {value > 0 && (
                            <span style={{ height: `${Math.min(100, (value / 120) * 100)}%` }} />
                          )}
                        </div>
                        <span>
                          {date.toLocaleDateString(undefined, {
                            weekday: "short",
                          })}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p>
                  Focus time grouped by session finish date. Bars fill at two
                  hours; exact minutes appear above.
                </p>
              </section>
              <section className="session-journal">
                <h2>Your sessions</h2>
                {!history.length && (
                  <p>Your first saved session will appear here.</p>
                )}
                {history
                  .slice(-50)
                  .reverse()
                  .map((h) => (
                    <article key={h.id}>
                      <span className="journal-icon">
                        {h.kind === "break" ? (
                          <Coffee size={20} />
                        ) : (
                          <BookOpen size={20} />
                        )}
                      </span>
                      <div>
                        <h3>{h.task || "Focus session"}</h3>
                        <p>
                          {new Date(h.endedAt).toLocaleString()} ·{" "}
                          {h.kind === "break"
                            ? "Break"
                            : h.outcome === "completed"
                              ? "Completed"
                              : "Finished early"}
                        </p>
                      </div>
                      <strong>
                        {minutes(h.elapsedMs)} min
                        <small>{h.coins} credits</small>
                      </strong>
                    </article>
                  ))}
                {history.length > 50 && (
                  <p>
                    Showing the latest 50 sessions. Your focus backup includes
                    the full journal.
                  </p>
                )}
              </section>
              <p className="no-pressure">
                Focus backups contain your session history and design unlocks. Use
                Back up in Study for your study materials.
              </p>
            </>
          )}
          <footer className="focus-footer">
            <span>
              <Layers3 size={16} />
              StudyStep
            </span>
            <label>
              <input
                type="checkbox"
                checked={state?.reducedMotion || false}
                disabled={disabled}
                onChange={(e) =>
                  void focus.command({
                    type: "motion",
                    value: e.target.checked,
                  })
                }
              />
              Less motion
            </label>
            <span>Saved on this computer</span>
          </footer>
        </main>
      )}
    </div>
  );
}
