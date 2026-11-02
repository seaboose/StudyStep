import { readFile, writeFile, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import {
  buildDeck,
  reviewSchema,
  emptyReview,
  emptyDeck,
  applyReview,
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
  async function run(command) {
    const workspace = await loadWorkspace();
    const deck = await buildDeck(workspace.data);
    const all = await read();
    const now = clock();
    let state = all.decks[deck.id] || emptyDeck();
    if (command) {
      state = applyReview(state, deck, command, now);
      if (!all.decks[deck.id] && Object.keys(all.decks).length >= 100)
        throw Error(
          "Your review archive has reached 100 study-set versions. Back up the local data folder before starting a new archive.",
        );
      // Do not commit a review against a workspace changed during the request.
      if ((await loadWorkspace()).revision !== workspace.revision)
        throw Error("Your study set changed. Reload the flashcards.");
      all.decks[deck.id] = state;
      reviewSchema.parse(all);
      try {
        await copyFile(file, path.join(dataDir, "review.previous.json"));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      await writeFile(file + ".tmp", JSON.stringify(all, null, 2), "utf8");
      await rename(file + ".tmp", file);
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
  };
}
