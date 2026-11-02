import { totalText, validateSources, type Source } from "./study";
export const GENERATION_LIMIT = 12_000;
export function selectPassages(sources: Source[], ids: unknown): Source[] {
  if (
    ids !== undefined &&
    (!Array.isArray(ids) ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length)
  )
    throw Error("Choose each source section only once.");
  const all = new Set(sources.flatMap((s) => s.passages.map((p) => p.id)));
  const selected = new Set<string>(
    ids === undefined ? [...all] : (ids as string[]),
  );
  if ([...selected].some((id) => !all.has(id)))
    throw Error("A selected section changed. Reopen the section selector.");
  const result = sources
    .map((s) => ({
      ...s,
      passages: s.passages.filter((p) => selected.has(p.id)),
    }))
    .filter((s) => s.passages.length);
  validateSources(result);
  if (totalText(result) > GENERATION_LIMIT)
    throw Error(
      "Choose up to 12,000 characters of sections for this set. Your full materials stay saved.",
    );
  if (totalText(result) < 50)
    throw Error("Select at least 50 characters of readable material.");
  return result;
}
