import type { Guide } from "./study";

export function retainReviewed(
  previous: Guide,
  next: Guide,
  ids: string[],
): string[] {
  const signature = (g: Guide, id: string) =>
    JSON.stringify([
      g.units.find((u) => u.id === id),
      g.questions.filter((q) => q.unitId === id),
    ]);
  return ids.filter(
    (id) =>
      next.units.some((u) => u.id === id) &&
      signature(previous, id) === signature(next, id),
  );
}

export function removeCard(guide: Guide, id: string): Guide {
  if (guide.units.length <= 1)
    throw Error("Keep at least one card, or discard the draft.");
  return {
    ...guide,
    units: guide.units.filter((u) => u.id !== id),
    questions: guide.questions.filter((q) => q.unitId !== id),
  };
}
