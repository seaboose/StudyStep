import { useState } from "react";
import {
  independentCorrect,
  type Attempt,
  type Guide,
  type Workspace,
} from "../lib/study";

const activities = {
  guided: "Review the explanation",
  recall: "Recall without choices",
  explain: "Explain a wrong choice",
};

export default function PracticeNext({
  guide,
  attempts,
  assessments = {},
  disabled,
  onAssessment,
}: {
  guide: Guide;
  attempts: Attempt[];
  assessments?: Workspace["topicAssessments"];
  disabled: boolean;
  onAssessment: (id: string, value?: "practice" | "confident") => void;
}) {
  // Prefer a topic still needing practice, using the newest attempt within that group.
  const recent = [...attempts]
    .reverse()
    .filter((a) => guide.questions.some((q) => q.id === a.questionId));
  const questions = new Map(guide.questions.map((q) => [q.id, q]));
  const assessmentFor = (a: Attempt) =>
    assessments[questions.get(a.questionId)!.unitId];
  const target =
    recent.find((a) => assessmentFor(a) === "practice") ??
    recent.find((a) => !assessmentFor(a) && !independentCorrect(a, guide)) ??
    recent.find((a) => !assessmentFor(a)) ??
    recent[0];
  const question = questions.get(target.questionId)!;
  const unit = guide.units.find((u) => u.id === question.unitId)!;
  const topicAttempts = (id: string) =>
    recent.filter((a) => questions.get(a.questionId)!.unitId === id);
  const independent = independentCorrect(target, guide);
  const rating = assessments[unit.id];
  const count = topicAttempts(unit.id).length;
  const suggested =
    rating === "practice"
      ? "guided"
      : rating === "confident"
        ? "explain"
        : independent
          ? count > 1
            ? "explain"
            : "recall"
          : "guided";
  const reason =
    rating === "practice"
      ? "You marked this topic for more practice"
      : rating === "confident"
        ? "You marked this topic as confident"
        : target.revealed
          ? "You revealed the answer"
          : target.hinted
            ? "You used a hint"
            : !independent
              ? "You missed the question"
              : count === 1
                ? "You answered one question independently"
                : "You answered these questions independently";
  const [chosen, setLevel] = useState<keyof typeof activities | null>(null);
  const level = chosen ?? suggested;
  const [stage, setStage] = useState<"choose" | "work" | "check" | "done">(
    "choose",
  );
  const right = question.options[question.correctIndex];
  const wrong = question.options.find((_, i) => i !== question.correctIndex)!;
  return (
    <section className="practice-summary" aria-label="Next activity">
      <h3>{stage === "done" ? "Activity complete" : "Next activity"}</h3>
      {stage === "choose" ? (
        <>
          <p>
            {reason}. Try <strong>{activities[suggested].toLowerCase()}</strong>{" "}
            for “{unit.title}”.
          </p>
          <details>
            <summary>Why these recommendations?</summary>
            <p>
              Review this round’s answers by topic. Your assessment guides
              future rounds until you choose practice results again.
            </p>
            {guide.units
              .filter((u) => topicAttempts(u.id).length)
              .map((u) => (
                <div key={u.id}>
                  <h4>{u.title}</h4>
                  <ul>
                    {topicAttempts(u.id).map((a) => (
                      <li key={a.questionId}>
                        {questions.get(a.questionId)!.prompt} —{" "}
                        {a.revealed
                          ? "Answer revealed"
                          : a.hinted
                            ? a.selected ===
                              questions.get(a.questionId)!.correctIndex
                              ? "Correct with a hint"
                              : "Incorrect with a hint"
                            : independentCorrect(a, guide)
                              ? "Correct independently"
                              : "Incorrect"}
                      </li>
                    ))}
                  </ul>
                  <label>
                    Assessment for {u.title}{" "}
                    <select
                      disabled={disabled}
                      value={assessments[u.id] ?? ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        onAssessment(
                          u.id,
                          value === "practice" || value === "confident"
                            ? value
                            : undefined,
                        );
                        setLevel(null);
                      }}
                    >
                      <option value="">Use practice results</option>
                      <option value="practice">Needs practice</option>
                      <option value="confident">Confident</option>
                    </select>
                  </label>
                </div>
              ))}
          </details>
          <label>
            Difficulty{" "}
            <select
              value={level}
              onChange={(e) =>
                setLevel(e.target.value as keyof typeof activities)
              }
            >
              <option value="guided">Guided · review</option>
              <option value="recall">Standard · recall</option>
              <option value="explain">Challenge · explain</option>
            </select>
          </label>
          <button className="primary" onClick={() => setStage("work")}>
            Start: {activities[level]}
          </button>
        </>
      ) : stage === "done" ? (
        <button className="secondary" onClick={() => setStage("choose")}>
          Choose another activity
        </button>
      ) : (
        <>
          <h4>{activities[level]}</h4>
          <p>{level === "recall" ? unit.recallPrompt : question.prompt}</p>
          {level === "explain" && (
            <p>
              Explain aloud why “{wrong.text}” is wrong and what makes the
              correct answer fit.
            </p>
          )}
          {level === "recall" && stage === "work" && (
            <p>Say your answer before checking it.</p>
          )}
          {level === "guided" || stage === "check" ? (
            <>
              <p>{level === "recall" ? unit.recallAnswer : right.text}</p>
              {level !== "recall" && (
                <p>{right.explanation || unit.explanation}</p>
              )}
              {level === "explain" &&
                wrong.explanation !== right.explanation && (
                  <p>{wrong.explanation}</p>
                )}
              <button className="primary" onClick={() => setStage("done")}>
                Finish activity
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => setStage("check")}>
              Check against reference
            </button>
          )}
          <button className="secondary" onClick={() => setStage("choose")}>
            Change difficulty
          </button>
        </>
      )}
    </section>
  );
}
