import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { parseStudyImport } from "../.runtime/local-server/local-study.mjs";
import {
  buildDeck,
  emptyDeck,
  applyReview,
} from "../.runtime/local-server/review.mjs";
import { createReviewStore } from "../scripts/review-store.mjs";

function workspace() {
  return parseStudyImport(
    JSON.stringify({
      format: "studystep",
      version: 1,
      title: "Biology",
      topics: ["Plant cells", "Plant roots"].map((title, index) => ({
        title,
        explanation: `A supported explanation for concept ${index}.`,
        recallPrompt: `What is concept ${index}?`,
        recallAnswer: `Reference ${index}.`,
        questions: [],
      })),
    }),
  ).data;
}
function expanded(before) {
  const after = structuredClone(before);
  after.guide.units.push({
    ...after.guide.units[0],
    id: "agent-unit-1",
    title: "Photosynthesis",
    recallPrompt: "What is photosynthesis?",
    recallAnswer: "A new reference.",
  });
  after.sources.push({
    id: crypto.randomUUID(),
    name: "New reference",
    type: "notes",
    role: "material",
    passages: [
      {
        id: "new-passage",
        label: "Overview",
        text: "A new reference explains photosynthesis in sufficient detail.",
      },
    ],
    warnings: [],
    pageCount: 0,
    addedAt: "2026-10-29T00:00:00.000Z",
    fingerprint: "new-source",
  });
  return after;
}
function begin(deck) {
  return applyReview(
    emptyDeck(),
    deck,
    {
      type: "start",
      deckId: deck.id,
      id: crypto.randomUUID(),
      mode: "trail",
      ahead: false,
    },
    1000,
  );
}
function rate(state, deck, rating, time = 1000) {
  const command = {
    deckId: deck.id,
    id: state.session.id,
    index: state.session.index,
  };
  state = applyReview(state, deck, { ...command, type: "reveal" }, time);
  return applyReview(state, deck, { ...command, type: "rate", rating }, time);
}
async function fixture(data = workspace()) {
  const dir = await mkdtemp(path.join(tmpdir(), "studystep-review-migration-"));
  let snapshot = { data, revision: 1 };
  let time = 1000;
  const store = createReviewStore(
    dir,
    async () => snapshot,
    () => time,
  );
  const deck = await buildDeck(data);
  const seed = async (state) =>
    writeFile(
      path.join(dir, "review.json"),
      JSON.stringify({ version: 1, decks: { [deck.id]: state } }),
    );
  const commit = (after) => async () => {
    snapshot = { data: after, revision: snapshot.revision + 1 };
    return snapshot;
  };
  return {
    dir,
    store,
    deck,
    seed,
    commit,
    snapshot: () => snapshot,
    time: (value) => {
      time = value;
    },
  };
}

test("legacy progress and an active round survive adding cards and unrelated sources", async () => {
  const f = await fixture();
  const state = rate(begin(f.deck), f.deck, "good");
  assert.equal(
    state.cardSignatures,
    undefined,
    "fixture is an existing version-1 file",
  );
  await f.seed(state);
  const after = expanded(f.snapshot().data);
  const result = await f.store.carryForward(
    f.snapshot(),
    after,
    f.commit(after),
  );
  assert.equal(result.revision, 2);
  const saved = await f.store.get();
  assert.notEqual(saved.deck.id, f.deck.id);
  assert.deepEqual(saved.state.progress, state.progress);
  assert.deepEqual(saved.state.session, state.session);
  assert.equal(saved.deck.cards[0].id, f.deck.cards[0].id);
  assert.equal(saved.state.progress[saved.deck.cards[2].id], undefined);
  assert.equal(saved.due, 2);
  assert.equal(
    JSON.parse(await readFile(path.join(f.dir, "review.json"), "utf8")).version,
    1,
  );
});

test("changed cited content invalidates only its card and drops a round that references it", async () => {
  const data = workspace();
  data.sources = [
    {
      id: crypto.randomUUID(),
      name: "Evidence",
      type: "notes",
      role: "material",
      passages: [
        {
          id: "p1",
          label: "Section",
          text: "The original evidence supports this reference.",
        },
      ],
      warnings: [],
      pageCount: 0,
      addedAt: "2026-10-29T00:00:00.000Z",
      fingerprint: "old",
    },
  ];
  data.guide.units[0].citations = [
    {
      passageId: "p1",
      quote: "The original evidence supports this reference.",
    },
  ];
  const f = await fixture(data);
  let state = rate(begin(f.deck), f.deck, "good");
  state = rate(state, f.deck, "good");
  await f.seed(state);
  const after = expanded(data);
  after.sources[0].passages[0].text += " A qualification changes its scope.";
  const nextDeck = await buildDeck(after);
  assert.equal(
    nextDeck.cards[0].id,
    f.deck.cards[0].id,
    "legacy card ID remains stable",
  );
  assert.notEqual(
    nextDeck.cardSignatures[nextDeck.cards[0].id],
    f.deck.cardSignatures[f.deck.cards[0].id],
  );
  await f.store.carryForward(f.snapshot(), after, f.commit(after));
  const saved = await f.store.get();
  assert.equal(saved.state.progress[f.deck.cards[0].id], undefined);
  assert.deepEqual(
    saved.state.progress[f.deck.cards[1].id],
    state.progress[f.deck.cards[1].id],
  );
  assert.equal(saved.state.session, null);
  assert.equal(saved.state.trails, 0);
});

test("identical words attached to a different unit do not inherit learning progress", async () => {
  const f = await fixture();
  const state = rate(begin(f.deck), f.deck, "good");
  await f.seed(state);
  const after = structuredClone(f.snapshot().data);
  after.guide.units[0].id = "another-topic-unit";
  const afterDeck = await buildDeck(after);
  assert.equal(
    afterDeck.id,
    f.deck.id,
    "existing deck fingerprint contract is retained",
  );
  await assert.rejects(
    () =>
      f.store.carryForward(f.snapshot(), after, async () => {
        throw Error("commit failed");
      }),
    /commit failed/,
  );
  assert.deepEqual(
    (await f.store.get()).state.progress,
    state.progress,
    "failed commit preserves original progress",
  );
  await f.store.carryForward(f.snapshot(), after, f.commit(after));
  assert.equal(
    (await f.store.get()).state.progress[f.deck.cards[0].id],
    undefined,
  );
});

test("retry after a failed workspace save preserves newer ratings without duplicating them", async () => {
  const f = await fixture();
  await f.seed(begin(f.deck));
  const after = expanded(f.snapshot().data);
  await assert.rejects(
    () =>
      f.store.carryForward(f.snapshot(), after, async () => {
        throw Error("disk error");
      }),
    /disk error/,
  );
  const prior = await f.store.get();
  f.time(2000);
  const command = { deckId: f.deck.id, id: prior.state.session.id, index: 0 };
  await f.store.command({ ...command, type: "reveal" });
  const latest = await f.store.command({
    ...command,
    type: "rate",
    rating: "good",
  });
  await f.store.carryForward(f.snapshot(), after, f.commit(after));
  const saved = await f.store.get();
  assert.deepEqual(saved.state.progress, latest.state.progress);
  assert.equal(saved.state.progress[f.deck.cards[0].id].reviews, 1);
  assert.equal(saved.state.session.index, 1);
});

test("workspace acceptance holds the review queue through commit and rejects stale snapshots", async () => {
  const f = await fixture();
  await f.seed(begin(f.deck));
  const before = f.snapshot();
  const after = expanded(before.data);
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const migration = f.store.carryForward(before, after, async () => {
    entered();
    await held;
    return f.commit(after)();
  });
  await started;
  let observed = false;
  const queued = f.store.get().then((value) => {
    observed = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(observed, false);
  release();
  await migration;
  assert.equal((await queued).deck.cards.length, 3);
  await assert.rejects(
    () => f.store.carryForward(before, after, f.commit(after)),
    /changed/,
  );
});

test("corrupt review state blocks migration and is never replaced", async () => {
  const f = await fixture();
  await writeFile(path.join(f.dir, "review.json"), "corrupt");
  const after = expanded(f.snapshot().data);
  await assert.rejects(
    () => f.store.carryForward(f.snapshot(), after, f.commit(after)),
    /could not be read/,
  );
  assert.equal(f.snapshot().revision, 1);
  assert.equal(
    await readFile(path.join(f.dir, "review.json"), "utf8"),
    "corrupt",
  );
});
