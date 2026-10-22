import { z } from "zod";

export const MAX_TEXT = 80_000;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const short = z.string().trim().min(1).max(300);
export const passageSchema = z
  .object({ id: short, label: short, text: z.string().min(1).max(2200) })
  .strict();
export const sourceSchema = z
  .object({
    id: z.string().uuid(),
    name: short,
    type: z.enum(["pdf", "docx", "txt", "notes"]),
    role: z.enum(["material", "assignment"]),
    passages: z.array(passageSchema).min(1).max(300),
    warnings: z.array(z.string().max(500)).max(30),
    pageCount: z.number().int().min(0).max(200),
    addedAt: z.string().datetime(),
    fingerprint: z.string().max(100),
    originUrl: z
      .string()
      .max(1000)
      .url()
      .refine((value) => {
        try {
          return new URL(value).protocol === "https:";
        } catch {
          return false;
        }
      })
      .optional(),
    attribution: z.string().max(500).optional(),
  })
  .strict();
export type Source = z.infer<typeof sourceSchema>;
export type Passage = z.infer<typeof passageSchema>;
const citation = z
  .object({ passageId: short, quote: z.string().min(12).max(600) })
  .strict();
export const guideSchema = z
  .object({
    title: short,
    units: z
      .array(
        z
          .object({
            id: short,
            title: short,
            objective: z.string().min(1).max(600),
            explanation: z.string().min(1).max(1800),
            detail: z.string().min(1).max(2400),
            keyPoints: z.array(z.string().min(1).max(500)).min(1).max(5),
            example: z.string().max(1200),
            misconception: z.string().max(1000),
            recallPrompt: z.string().min(1).max(500),
            recallAnswer: z.string().min(1).max(1200),
            citations: z.array(citation).min(1).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    questions: z
      .array(
        z
          .object({
            id: short,
            unitId: short,
            prompt: z.string().min(1).max(900),
            options: z
              .array(
                z
                  .object({
                    text: z.string().min(1).max(500),
                    explanation: z.string().min(1).max(1000),
                  })
                  .strict(),
              )
              .min(3)
              .max(4),
            correctIndex: z.number().int().min(0).max(3),
            hint: z.string().min(1).max(500),
            citations: z.array(citation).min(1).max(4),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    gaps: z.array(z.string().min(1).max(700)).max(12),
  })
  .strict();
export type Guide = z.infer<typeof guideSchema>;
export type Citation = Guide["units"][number]["citations"][number];
export const attemptSchema = z
  .object({
    questionId: short,
    selected: z.number().int().min(0).max(3).nullable(),
    hinted: z.boolean(),
    revealed: z.boolean(),
    at: z.string().datetime(),
  })
  .strict();
export type Attempt = z.infer<typeof attemptSchema>;
export const workspaceSchema = z
  .object({
    title: z.string().max(100),
    sources: z.array(sourceSchema).max(10),
    guide: guideSchema.nullable(),
    guideSourceKey: z.string().max(100),
    generatedAt: z.string().max(40),
    attempts: z.array(attemptSchema).max(1000),
    currentUnit: z.number().int().min(0).max(5),
    currentQuestion: z.number().int().min(0).max(11),
    studied: z.array(short).max(6),
    hintUsed: z.array(short).max(12).default([]),
    selectedPassageIds: z
      .array(z.string().max(300))
      .max(3000)
      .nullable()
      .optional(),
  })
  .strict();
export type Workspace = z.infer<typeof workspaceSchema>;
export const emptyWorkspace = (): Workspace => ({
  title: "My study workspace",
  sources: [],
  guide: null,
  guideSourceKey: "",
  generatedAt: "",
  attempts: [],
  currentUnit: 0,
  currentQuestion: 0,
  studied: [],
  hintUsed: [],
});

export function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
export function splitPassages(
  text: string,
  prefix: string,
  label: string,
): Passage[] {
  const clean = text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of clean.split(/\n\s*\n/)) {
    let remaining = paragraph.trim();
    if (!remaining) continue;
    if (current && current.length + remaining.length + 2 > 1800) {
      chunks.push(current);
      current = "";
    }
    while (remaining.length > 1800) {
      let end = remaining.lastIndexOf(" ", 1800);
      if (end < 900) end = 1800;
      chunks.push(remaining.slice(0, end));
      remaining = remaining.slice(end).trim();
    }
    current += (current ? "\n\n" : "") + remaining;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.map((text, i) => ({
    id: `${prefix}:${i + 1}`,
    label: `${label}${chunks.length > 1 ? ` · passage ${i + 1}` : ""}`,
    text,
  }));
}
export function totalText(sources: Source[]) {
  return sources.reduce(
    (n, s) => n + s.passages.reduce((a, p) => a + p.text.length, 0),
    0,
  );
}
export function validateSources(sources: Source[]) {
  if (!sources.length) throw new Error("Add study material first.");
  if (sources.length > 10)
    throw new Error("Use up to 10 sources per workspace.");
  if (!sources.some((s) => s.role === "material"))
    throw new Error(
      "Add supporting material as well as your assigned study guide.",
    );
  if (totalText(sources) > MAX_TEXT)
    throw new Error(
      "This first version supports 80,000 extracted characters per guide. Remove a source or use a shorter excerpt; nothing will be silently cut off.",
    );
  if (sources.reduce((n, s) => n + s.pageCount, 0) > 200)
    throw new Error("Use no more than 200 PDF pages per workspace.");
  const ids = sources.flatMap((s) => s.passages.map((p) => p.id));
  if (
    new Set(ids).size !== ids.length ||
    new Set(sources.map((s) => s.id)).size !== sources.length
  )
    throw new Error(
      "Duplicate source identifiers. Reimport the affected material.",
    );
}
export function validateGuide(value: unknown, sources: Source[]): Guide {
  const guide = guideSchema.parse(value);
  const passages = new Map(
    sources.flatMap((s) => s.passages.map((p) => [p.id, p] as const)),
  );
  const units = new Set(guide.units.map((u) => u.id));
  if (
    units.size !== guide.units.length ||
    new Set(guide.questions.map((q) => q.id)).size !== guide.questions.length
  )
    throw new Error("Duplicate generated identifiers.");
  for (const item of [...guide.units, ...guide.questions])
    for (const c of item.citations) {
      const passage = passages.get(c.passageId);
      if (!passage || !normalize(passage.text).includes(normalize(c.quote)))
        throw new Error(
          "A generated citation did not match its source. Try generating again.",
        );
    }
  for (const q of guide.questions) {
    if (!units.has(q.unitId) || q.correctIndex >= q.options.length)
      throw new Error("Invalid question mapping.");
    if (
      new Set(q.options.map((o) => normalize(o.text).toLowerCase())).size !==
      q.options.length
    )
      throw new Error("Duplicate answer options.");
  }
  if (guide.units.some((u) => !guide.questions.some((q) => q.unitId === u.id)))
    throw new Error("A study topic is missing a practice question.");
  return guide;
}
export async function sourceKey(sources: Source[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(sources));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function independentCorrect(attempt: Attempt, guide: Guide) {
  return (
    !attempt.hinted &&
    !attempt.revealed &&
    guide.questions.find((q) => q.id === attempt.questionId)?.correctIndex ===
      attempt.selected
  );
}
