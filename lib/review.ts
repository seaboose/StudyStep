import { z } from "zod";
import type { Citation, Workspace } from "./study";
export type Card = {
  id: string;
  front: string;
  back: string;
  detail: string;
  topic: string;
  citations: Citation[];
};
const hash = async (value: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
export async function buildDeck(data: Workspace) {
  const units = data.guide?.units || [];
  const raw: Omit<Card, "id">[] = [];
  for (const u of units)
    raw.push({
      front: u.recallPrompt.trim() || `Explain: ${u.title}`,
      back: u.recallAnswer.trim() || u.explanation,
      detail: u.explanation,
      topic: u.title,
      citations: u.citations,
    });
  // Multiple-choice questions remain in Practice. Removing their options can make
  // prompts such as "Which of the following…" meaningless as recall cards.
  const seen = new Set<string>();
  const cards: Card[] = [];
  const cardSignatures: Record<string, string> = {};
  for (const [index, c] of raw.entries()) {
    const key = c.front.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key) || !c.back.trim()) continue;
    seen.add(key);
    const card = { ...c, id: await hash(c) };
    cards.push(card);
    const passageIds = new Set(
      c.citations.map((citation) => citation.passageId),
    );
    // Keep the established card/deck IDs. A separate signature binds carryover
    // to the original unit, related quiz, and cited source contents/provenance.
    // An uncited manual card is bound to its unit, not to unrelated new sources.
    cardSignatures[card.id] = await hash({
      unit: units[index],
      questions: (data.guide?.questions || []).filter(
        (question) => question.unitId === units[index].id,
      ),
      sources: data.sources.filter((source) =>
        source.passages.some((passage) => passageIds.has(passage.id)),
      ),
    });
  }
  // Source edits invalidate old scheduling as well as changes to card wording.
  return {
    id: await hash({ cards, sources: data.sources }),
    title: data.guide?.title || "Your study set",
    cards,
    cardSignatures,
  };
}
const stamp = z.number().int().nonnegative();
const key = z.string().regex(/^[a-f0-9]{64}$/);
const progress = z
  .object({
    due: stamp,
    step: z.number().int().min(0).max(4),
    reviews: z.number().int().nonnegative(),
    last: stamp,
  })
  .strict();
const session = z
  .object({
    id: z.string().uuid(),
    mode: z.enum(["cards", "trail"]),
    queue: z
      .array(z.object({ cardId: key, retry: z.boolean() }).strict())
      .max(40),
    index: z.number().int().min(0).max(40),
    revealed: z.boolean(),
    rated: z.array(key).max(20),
    missed: z.array(key).max(20),
    recalled: z.number().int().min(0).max(20),
    finished: z.boolean(),
    ahead: z.boolean(),
  })
  .strict();
const deckState = z
  .object({
    progress: z.record(key, progress),
    session: session.nullable(),
    trails: z.number().int().nonnegative(),
    // Optional so existing version-1 progress files remain readable.
    cardSignatures: z.record(key, key).optional(),
  })
  .strict();
export const reviewSchema = z
  .object({ version: z.literal(1), decks: z.record(key, deckState) })
  .strict();
export type ReviewState = z.infer<typeof reviewSchema>;
export type DeckState = z.infer<typeof deckState>;
export type Deck = Awaited<ReturnType<typeof buildDeck>>;
export const emptyReview = (): ReviewState => ({ version: 1, decks: {} });
export const emptyDeck = (): DeckState => ({
  progress: {},
  session: null,
  trails: 0,
});

function usableSession(value: DeckState["session"], unchanged: Set<string>) {
  return value &&
    value.queue.every((item) => unchanged.has(item.cardId)) &&
    value.rated.every((id) => unchanged.has(id)) &&
    value.missed.every((id) => unchanged.has(id))
    ? structuredClone(value)
    : null;
}

// Never search other archived decks by similar text. Both snapshots must come
// from one explicit, revision-checked workspace transition.
export function carryReview(
  before: Deck,
  after: Deck,
  previous: DeckState,
  target?: DeckState,
): DeckState {
  const unchanged = new Set(
    before.cards
      .filter(
        (card) =>
          before.cardSignatures[card.id] === after.cardSignatures[card.id] &&
          (!previous.cardSignatures ||
            previous.cardSignatures[card.id] ===
              before.cardSignatures[card.id]),
      )
      .map((card) => card.id),
  );
  const targetValid = new Set(
    after.cards
      .filter(
        (card) =>
          target?.cardSignatures?.[card.id] === after.cardSignatures[card.id],
      )
      .map((card) => card.id),
  );
  const result = emptyDeck();
  for (const card of after.cards) {
    const old = unchanged.has(card.id) ? previous.progress[card.id] : undefined;
    const existing = targetValid.has(card.id)
      ? target?.progress[card.id]
      : undefined;
    const latest = !old
      ? existing
      : !existing
        ? old
        : existing.last > old.last ||
            (existing.last === old.last && existing.reviews > old.reviews)
          ? existing
          : old;
    if (latest) result.progress[card.id] = structuredClone(latest);
  }
  const activity = (state: DeckState | undefined) =>
    Math.max(
      0,
      ...Object.values(state?.progress || {}).map((item) => item.last),
    );
  const priorSession = usableSession(previous.session, unchanged);
  const targetSession = usableSession(target?.session || null, targetValid);
  result.session =
    targetSession && activity(target) > activity(previous)
      ? targetSession
      : priorSession || targetSession;
  // A cumulative round count cannot be reliably apportioned to edited cards.
  result.trails = Math.max(
    unchanged.size === before.cards.length ? previous.trails : 0,
    target && targetValid.size === after.cards.length ? target.trails : 0,
  );
  result.cardSignatures = after.cardSignatures;
  return result;
}
export const reviewCommand = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("start"),
      deckId: key,
      id: z.string().uuid(),
      mode: z.enum(["cards", "trail"]),
      ahead: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("reveal"),
      deckId: key,
      id: z.string().uuid(),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("rate"),
      deckId: key,
      id: z.string().uuid(),
      index: z.number().int().nonnegative(),
      rating: z.enum(["again", "hard", "good"]),
    })
    .strict(),
]);
export function applyReview(
  value: DeckState,
  deck: Deck,
  input: unknown,
  now: number,
): DeckState {
  const cmd = reviewCommand.parse(input);
  if (cmd.deckId !== deck.id)
    throw Error("Your study set changed. Reload the flashcards.");
  const state = structuredClone(value);
  if (cmd.type === "start") {
    if (state.session?.id === cmd.id) return state;
    if (state.session && !state.session.finished)
      throw Error("Finish your saved round before starting another.");
    const due = deck.cards.filter(
      (c) => !state.progress[c.id] || state.progress[c.id].due <= now,
    );
    const candidates = (due.length ? due : cmd.ahead ? deck.cards : []).sort(
      (a, b) =>
        (state.progress[a.id]?.due || 0) - (state.progress[b.id]?.due || 0),
    );
    if (!candidates.length)
      throw Error(
        "Nothing is due yet. You can choose an extra practice round.",
      );
    state.session = {
      id: cmd.id,
      mode: cmd.mode,
      queue: candidates
        .slice(0, cmd.mode === "trail" ? 5 : 20)
        .map((c) => ({ cardId: c.id, retry: false })),
      index: 0,
      revealed: false,
      rated: [],
      missed: [],
      recalled: 0,
      finished: false,
      ahead: !due.length,
    };
    return state;
  }
  const s = state.session;
  if (!s || s.id !== cmd.id)
    throw Error("This round has changed. Reload your flashcards.");
  // A retried request must not double-credit a card or advance another card.
  if (cmd.index < s.index) return state;
  if (cmd.index !== s.index || s.finished)
    throw Error("This card has already moved on. Reload your flashcards.");
  if (cmd.type === "reveal") {
    s.revealed = true;
    return state;
  }
  if (!s.revealed)
    throw Error("Reveal the reference answer before rating your recall.");
  const item = s.queue[s.index];
  if (!item || !deck.cards.some((c) => c.id === item.cardId))
    throw Error("This card is unavailable. Reload the study set.");
  const old = state.progress[item.cardId] || {
    due: 0,
    step: 0,
    reviews: 0,
    last: 0,
  };
  const previouslyMissed = s.missed.includes(item.cardId);
  if (!item.retry) {
    s.rated.push(item.cardId);
    if (cmd.rating === "good") s.recalled++;
  }
  let step = old.step,
    due = old.due;
  if (cmd.rating === "again" || previouslyMissed) {
    step = 0;
    due = now + 10 * 60_000;
  } else if (cmd.rating === "hard") {
    step = 0;
    due = now + 86_400_000;
  } else if (old.due <= now) {
    due = now + [1, 3, 7, 14, 30][step] * 86_400_000;
    step = Math.min(4, step + 1);
  }
  // Extra early practice never moves a future due date farther away.
  if (s.ahead) due = Math.min(old.due, due);
  state.progress[item.cardId] = {
    due,
    step,
    reviews: old.reviews + 1,
    last: now,
  };
  if (cmd.rating === "again" && !item.retry) {
    s.missed.push(item.cardId);
    s.queue.splice(Math.min(s.index + 3, s.queue.length), 0, {
      cardId: item.cardId,
      retry: true,
    });
  }
  s.index++;
  s.revealed = false;
  if (s.index >= s.queue.length) {
    s.finished = true;
    if (s.mode === "trail") state.trails++;
  }
  return state;
}
