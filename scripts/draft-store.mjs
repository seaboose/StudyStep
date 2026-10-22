import { readFile, writeFile, rename, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { localGuideSchema } from "../.runtime/local-server/local-study.mjs";

// Editing permits incomplete fields. Acceptance still uses the normal guide validator.
const str = (max) => z.string().max(max);
const unit = localGuideSchema.shape.units.element.extend({
  title: str(300),
  explanation: str(1800),
  keyPoints: z.array(str(500)).max(8),
});
const question = localGuideSchema.shape.questions.element.extend({
  prompt: str(900),
  options: z
    .array(z.object({ text: str(500), explanation: str(1000) }).strict())
    .min(2)
    .max(4),
});
const guide = localGuideSchema.extend({
  title: str(300),
  units: z.array(unit).min(1).max(60),
  questions: z.array(question).max(300),
});
const record = z
  .object({
    guide,
    reviewedIds: z.array(str(300)).max(60).default([]),
    problems: z.array(str(1000)).max(30),
    baseKey: z.string().length(64),
    savedAt: z.string().datetime(),
  })
  .strict();
const envelope = z
  .object({ version: z.number().int().nonnegative(), draft: record.nullable() })
  .strict();
export const draftBaseKey = (data) =>
  createHash("sha256")
    .update(JSON.stringify({ guide: data.guide, sources: data.sources }))
    .digest("hex");
export function createDraftStore(dataDir, loadWorkspace) {
  const file = path.join(dataDir, "editor-draft.json");
  let queue = Promise.resolve();
  const locked = (fn) => {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  };
  async function read() {
    try {
      return envelope.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (e) {
      if (e.code === "ENOENT") return { version: 0, draft: null };
      throw Error(
        "Your saved draft could not be read. It has been left untouched. Restore editor-draft.previous.json with StudyStep closed.",
      );
    }
  }
  async function update(input, discard) {
    const current = await read();
    if (current.version !== input.version)
      throw Error(
        "The draft changed in another window. Close this editor and reload before editing.",
      );
    let draft = null;
    if (!discard) {
      const baseKey = draftBaseKey((await loadWorkspace()).data);
      if (input.baseKey !== baseKey)
        throw Error(
          "The study material changed. Keep or export your saved draft before starting again.",
        );
      draft = record.parse({
        guide: input.guide,
        reviewedIds: input.reviewedIds || [],
        problems: input.problems || [],
        baseKey,
        savedAt: new Date().toISOString(),
      });
      if (
        new Set(draft.reviewedIds).size !== draft.reviewedIds.length ||
        draft.reviewedIds.some(
          (id) => !draft.guide.units.some((u) => u.id === id),
        )
      )
        throw Error("The reviewed cards do not match this draft.");
    }
    const next = { version: current.version + 1, draft };
    try {
      await copyFile(file, path.join(dataDir, "editor-draft.previous.json"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await writeFile(file + ".tmp", JSON.stringify(next, null, 2));
    await rename(file + ".tmp", file);
    return { ...next, baseKey: draftBaseKey((await loadWorkspace()).data) };
  }
  return {
    get: () =>
      locked(async () => ({
        ...(await read()),
        baseKey: draftBaseKey((await loadWorkspace()).data),
      })),
    put: (input) => locked(() => update(input, false)),
    discard: (input) => locked(() => update(input, true)),
  };
}
