import { readFile, writeFile, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import {
  buildDeck,
  reviewSchema,
  emptyReview,
  emptyDeck,
  applyReview,
  carryReview,
} from "../.runtime/local-server/review.mjs";
export function createReviewStore(dataDir, loadWorkspace, clock = Date.now) {
  const file = path.join(dataDir, "review.json");
  let queue = Promise.resolve();
  const locked = (fn) => {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  };
  async function read() {
    try {
      return reviewSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (e) {
      if (e.code === "ENOENT") return emptyReview();
      throw Error(
        "Flashcard progress could not be read. Your study set is safe. Inspect review.json or restore review.previous.json with the app closed.",
      );
    }
  }
  function checkArchive(all, deckId) {
    if (!all.decks[deckId] && Object.keys(all.decks).length >= 100)
      throw Error(
        "Your review archive has reached 100 study-set versions. Back up the local data folder before starting a new archive.",
      );
  }
  async function persist(all) {
    reviewSchema.parse(all);
    try {
      await copyFile(file, path.join(dataDir, "review.previous.json"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await writeFile(file + ".tmp", JSON.stringify(all, null, 2), "utf8");
    await rename(file + ".tmp", file);
  }
  async function run(command) {
    const workspace = await loadWorkspace();
    const deck = await buildDeck(workspace.data);
    const all = await read();
    const now = clock();
    let state = all.decks[deck.id] || emptyDeck();
    if (state.cardSignatures) state = carryReview(deck, deck, state);
    if (command) {
      state = applyReview(state, deck, command, now);
      checkArchive(all, deck.id);
      // Do not commit a review against a workspace changed during the request.
      if ((await loadWorkspace()).revision !== workspace.revision)
        throw Error("Your study set changed. Reload the flashcards.");
      all.decks[deck.id] = state;
      state.cardSignatures = deck.cardSignatures;
      await persist(all);
    }
    return {
      deck,
      state,
      now,
      due: deck.cards.filter(
        (c) => !state.progress[c.id] || state.progress[c.id].due <= now,
      ).length,
    };
  }
  return {
    get: () => locked(() => run()),
    command: (cmd) => locked(() => run(cmd)),
    // Holds the review queue through the caller's revision-checked workspace
    // commit. A failed commit leaves only an unreachable future-deck snapshot;
    // a retry merges any newer old-deck progress without double-crediting it.
    carryForward: (beforeSnapshot, afterData, commit) =>
      locked(async () => {
        if (typeof commit !== "function")
          throw Error("A revision-checked workspace commit is required.");
        const current = await loadWorkspace();
        if (
          current.revision !== beforeSnapshot.revision ||
          JSON.stringify(current.data) !== JSON.stringify(beforeSnapshot.data)
        )
          throw Error(
            "Your study set changed. Review the proposed additions again.",
          );
        const [before, after] = await Promise.all([
          buildDeck(beforeSnapshot.data),
          buildDeck(afterData),
        ]);
        const all = await read();
        const previous = all.decks[before.id];
        if (previous) {
          checkArchive(all, after.id);
          // A changed unit/quiz can leave the legacy deck ID identical. Attach
          // its old signature before commit; the next read filters it against
          // the new workspace. Do not erase live progress if commit then fails.
          const next =
            before.id === after.id
              ? {
                  ...previous,
                  cardSignatures:
                    previous.cardSignatures || before.cardSignatures,
                }
              : carryReview(before, after, previous, all.decks[after.id]);
          all.decks[after.id] = next;
          await persist(all);
        }
        return await commit();
      }),
  };
}
