import { z } from "zod";
import {
  emptyWorkspace,
  guideSchema,
  workspaceSchema,
  validateSources,
  normalize,
  type Guide,
  type Workspace,
} from "./study";

// Local sets may be written by a person and need not claim verified citations.
const localUnit = guideSchema.shape.units.element.extend({
  objective: z.string().max(600),
  detail: z.string().max(2400),
  keyPoints: z.array(z.string().min(1).max(500)).max(8),
  recallPrompt: z.string().max(500),
  recallAnswer: z.string().max(1200),
  citations: guideSchema.shape.units.element.shape.citations.min(0),
});
const localQuestion = guideSchema.shape.questions.element.extend({
  options: z
    .array(
      z
        .object({
          text: z.string().trim().min(1).max(500),
          explanation: z.string().max(1000),
        })
        .strict(),
    )
    .min(2)
    .max(4),
  hint: z.string().max(500),
  citations: guideSchema.shape.questions.element.shape.citations.min(0),
});
export const localGuideSchema = guideSchema.extend({
  units: z.array(localUnit).min(1).max(60),
  questions: z.array(localQuestion).max(300),
});
export const localWorkspaceSchema = workspaceSchema.extend({
  guide: localGuideSchema.nullable(),
  currentUnit: z.number().int().min(0).max(59),
  currentQuestion: z.number().int().min(0).max(299),
  studied: z.array(z.string()).max(60),
  hintUsed: z.array(z.string()).max(300),
});

export function validateLocalGuide(
  value: unknown,
  sources: Workspace["sources"] = [],
): Guide {
  const guide = localGuideSchema.parse(value);
  const unitIds = new Set(guide.units.map((u) => u.id)),
    questionIds = new Set(guide.questions.map((q) => q.id));
  if (
    unitIds.size !== guide.units.length ||
    questionIds.size !== guide.questions.length
  )
    throw new Error("Topic and question IDs must be unique.");
  const passages = new Map(
    sources.flatMap((s) => s.passages.map((p) => [p.id, p.text])),
  );
  for (const item of [...guide.units, ...guide.questions])
    for (const c of item.citations) {
      if (
        !passages.has(c.passageId) ||
        !normalize(passages.get(c.passageId)!).includes(normalize(c.quote))
      )
        throw new Error("A citation does not match an included source.");
    }
  for (const q of guide.questions) {
    if (!unitIds.has(q.unitId) || q.correctIndex >= q.options.length)
      throw new Error(
        "Choose a valid topic and correct answer for every question.",
      );
    if (
      new Set(q.options.map((o) => normalize(o.text).toLowerCase())).size !==
      q.options.length
    )
      throw new Error("Answer choices must be different.");
  }
  return guide;
}
export function validateLocalWorkspace(value: unknown): Workspace {
  const data = localWorkspaceSchema.parse(value);
  if (data.selectedPassageIds) {
    const ids = new Set(
      data.sources.flatMap((s) => s.passages.map((p) => p.id)),
    );
    if (
      new Set(data.selectedPassageIds).size !==
        data.selectedPassageIds.length ||
      data.selectedPassageIds.some((id) => !ids.has(id))
    )
      throw Error(
        "A selected section no longer belongs to these materials. Choose sections again.",
      );
  }
  if (data.sources.length)
    validateSources(data.sources.map((s) => ({ ...s, role: "material" })));
  if (data.guide) {
    const guide = validateLocalGuide(data.guide, data.sources);
    const units = new Set(guide.units.map((u) => u.id)),
      questions = new Map(guide.questions.map((q) => [q.id, q]));
    if (
      data.currentUnit >= guide.units.length ||
      data.currentQuestion >= Math.max(1, guide.questions.length)
    )
      throw new Error("The saved study position is invalid.");
    if (
      data.studied.some((id) => !units.has(id)) ||
      data.hintUsed.some((id) => !questions.has(id))
    )
      throw new Error("Progress references an unknown topic or question.");
    if (
      new Set(data.attempts.map((a) => a.questionId)).size !==
      data.attempts.length
    )
      throw new Error("Duplicate practice attempts.");
    for (const a of data.attempts) {
      const q = questions.get(a.questionId);
      if (!q || (a.selected !== null && a.selected >= q.options.length))
        throw new Error("A saved answer is invalid.");
    }
  } else if (
    data.attempts.length ||
    data.studied.length ||
    data.hintUsed.length
  )
    throw new Error("Progress requires a study set.");
  return data;
}
export function editGuide(data: Workspace, value: unknown): Workspace {
  const guide = validateLocalGuide(value, data.sources);
  const unchangedQuestions = new Set(
    guide.questions
      .filter(
        (q) =>
          JSON.stringify(
            data.guide?.questions.find((old) => old.id === q.id),
          ) === JSON.stringify(q),
      )
      .map((q) => q.id),
  );
  const unchangedUnits = new Set(
    guide.units
      .filter(
        (u) =>
          JSON.stringify(data.guide?.units.find((old) => old.id === u.id)) ===
          JSON.stringify(u),
      )
      .map((u) => u.id),
  );
  return {
    ...data,
    guide,
    title: guide.title.slice(0, 100),
    generatedAt: new Date().toISOString(),
    attempts: data.attempts.filter((a) => unchangedQuestions.has(a.questionId)),
    hintUsed: data.hintUsed.filter((id) => unchangedQuestions.has(id)),
    studied: data.studied.filter((id) => unchangedUnits.has(id)),
    currentUnit: Math.min(data.currentUnit, guide.units.length - 1),
    currentQuestion: Math.min(
      data.currentQuestion,
      Math.max(0, guide.questions.length - 1),
    ),
  };
}

const text = z.string().trim().min(1);
const chatQuestion = z
  .object({
    prompt: text.max(900),
    options: z.array(text.max(500)).min(2).max(4),
    answer: z.number().int().min(1).max(4),
    explanation: z.string().max(1000).optional(),
    explanations: z.array(z.string().max(1000)).max(4).optional(),
    hint: z.string().max(500).optional(),
  })
  .strict();
export const chatSetSchema = z
  .object({
    format: z.literal("studystep"),
    version: z.literal(1),
    title: text.max(300),
    topics: z
      .array(
        z
          .object({
            title: text.max(300),
            explanation: text.max(1800),
            objective: z.string().max(600).optional(),
            detail: z.string().max(2400).optional(),
            keyPoints: z.array(text.max(500)).max(8).optional(),
            recallPrompt: z.string().max(500).optional(),
            recallAnswer: z.string().max(1200).optional(),
            questions: z.array(chatQuestion).max(50).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();
export function parseStudyImport(raw: string): {
  data: Workspace;
  kind: "set" | "backup";
} {
  if (raw.length > 2_000_000)
    throw new Error("Use a study-set file smaller than 2 MB.");
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```$/, "");
  let value;
  try {
    value = JSON.parse(clean);
  } catch {
    throw new Error(
      "Paste a complete StudyStep JSON study set or choose its .json file.",
    );
  }
  if (value?.format === "studystep-backup") {
    const backup = z
      .object({
        format: z.literal("studystep-backup"),
        version: z.literal(1),
        savedAt: z.string(),
        data: localWorkspaceSchema,
      })
      .strict()
      .parse(value);
    return { data: validateLocalWorkspace(backup.data), kind: "backup" };
  }
  const set = chatSetSchema.parse(value);
  const units = set.topics.map((t, i) => ({
    id: `topic-${i + 1}`,
    title: t.title,
    objective: t.objective || "",
    explanation: t.explanation,
    detail: t.detail || "",
    keyPoints: t.keyPoints || [],
    example: "",
    misconception: "",
    recallPrompt: t.recallPrompt || "",
    recallAnswer: t.recallAnswer || "",
    citations: [],
  }));
  const questions = set.topics.flatMap((t, i) =>
    t.questions.map((q, j) => {
      if (q.answer > q.options.length)
        throw new Error(
          `Topic ${i + 1}, question ${j + 1}: answer must point to an available choice (starting at 1).`,
        );
      if (q.explanations && q.explanations.length !== q.options.length)
        throw new Error("Provide one explanation per answer choice.");
      return {
        id: `question-${i + 1}-${j + 1}`,
        unitId: units[i].id,
        prompt: q.prompt,
        options: q.options.map((text, k) => ({
          text,
          explanation: q.explanations?.[k] || q.explanation || "",
        })),
        correctIndex: q.answer - 1,
        hint: q.hint || "",
        citations: [],
      };
    }),
  );
  return {
    data: editGuide(emptyWorkspace(), {
      title: set.title,
      units,
      questions,
      gaps: [],
    }),
    kind: "set",
  };
}
export function exportChatSet(guide: Guide) {
  return {
    format: "studystep",
    version: 1,
    title: guide.title,
    topics: guide.units.map((u) => ({
      title: u.title,
      explanation: u.explanation,
      objective: u.objective,
      detail: u.detail,
      keyPoints: u.keyPoints,
      recallPrompt: u.recallPrompt,
      recallAnswer: u.recallAnswer,
      questions: guide.questions
        .filter((q) => q.unitId === u.id)
        .map((q) => ({
          prompt: q.prompt,
          options: q.options.map((o) => o.text),
          answer: q.correctIndex + 1,
          explanations: q.options.map((o) => o.explanation),
          hint: q.hint,
        })),
    })),
  };
}
export function exportBackup(data: Workspace) {
  return {
    format: "studystep-backup",
    version: 1,
    savedAt: new Date().toISOString(),
    data,
  };
}
export function readableError(error: unknown) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return `${issue.path.join(" → ") || "Study set"}: ${issue.message}`;
  }
  return error instanceof Error
    ? error.message
    : "Could not read this study set.";
}
export function newUnit(): Guide["units"][number] {
  return {
    id: crypto.randomUUID(),
    title: "New topic",
    objective: "",
    explanation: "",
    detail: "",
    keyPoints: [],
    example: "",
    misconception: "",
    recallPrompt: "",
    recallAnswer: "",
    citations: [],
  };
}
export function newGuide(): Guide {
  return { title: "My study set", units: [newUnit()], questions: [], gaps: [] };
}
