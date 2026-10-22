import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  emptyWorkspace,
  sourceSchema,
} from "../.runtime/local-server/study.mjs";
import { parseStudyImport } from "../.runtime/local-server/local-study.mjs";
import {
  buildDeck,
  applyReview,
  emptyDeck,
} from "../.runtime/local-server/review.mjs";
import { createReviewStore } from "../scripts/review-store.mjs";
import { createLocalServer } from "../scripts/local-server.mjs";
import { searchTopics, topicSource } from "../scripts/topic-search.mjs";
import {
  evidenceCatalogue,
  generateLocalDraft,
} from "../scripts/local-generation.mjs";

const workspace = (title = "An arbitrary topic") =>
  parseStudyImport(
    JSON.stringify({
      format: "studystep",
      version: 1,
      title,
      topics: Array.from({ length: 3 }, (_, i) => ({
        title: `Concept ${i}`,
        explanation: `Explanation of concept ${i}.`,
        recallPrompt: `Recall concept ${i}?`,
        recallAnswer: `Reference ${i}.`,
        questions: [],
      })),
    }),
  ).data;
const begin = (deck, state = emptyDeck(), ahead = false) =>
  applyReview(
    state,
    deck,
    {
      type: "start",
      deckId: deck.id,
      id: crypto.randomUUID(),
      mode: "trail",
      ahead,
    },
    1000,
  );
function rate(state, deck, rating, now = 1000) {
  const cmd = {
    deckId: deck.id,
    id: state.session.id,
    index: state.session.index,
  };
  state = applyReview(state, deck, { ...cmd, type: "reveal" }, now);
  return applyReview(state, deck, { ...cmd, type: "rate", rating }, now);
}
test("cards use any user content, never seed an empty workspace, and deduplicate prompts", async () => {
  assert.equal((await buildDeck(emptyWorkspace())).cards.length, 0);
  const data = workspace("User-chosen topic");
  let deck = await buildDeck(data);
  assert.equal(deck.cards.length, 3);
  assert.equal(deck.title, "User-chosen topic");
  assert.equal(deck.cards[1].back, "Reference 1.");
  data.guide.units[1].recallPrompt = data.guide.units[0].recallPrompt;
  assert.equal((await buildDeck(data)).cards.length, 2);
});
test("excerpt catalogue preserves exact text and the model cannot invent evidence identifiers", async () => {
  const source = {
    id: crypto.randomUUID(),
    name: "QA source",
    type: "notes",
    role: "material",
    passages: [
      {
        id: "paragraph-1",
        label: "Notes",
        text: "A long source contains several facts. ".repeat(70),
      },
    ],
    warnings: [],
    pageCount: 0,
    addedAt: new Date().toISOString(),
    fingerprint: "qa",
  };
  const evidence = evidenceCatalogue([source]);
  assert.ok(evidence.length > 1);
  for (const e of evidence) {
    assert.ok(e.quote.length >= 12 && e.quote.length <= 600);
    assert.ok(source.passages[0].text.includes(e.quote));
    assert.equal(e.passageId, "paragraph-1");
  }
  await assert.rejects(
    () =>
      generateLocalDraft(
        [source],
        "test-model",
        new AbortController().signal,
        async () =>
          Response.json({
            done: true,
            message: {
              content: JSON.stringify({
                units: [{ citations: [{ evidenceId: "invented" }] }],
                questions: [],
              }),
            },
          }),
      ),
    /unknown source excerpt/,
  );
});
test("content and citation-source changes invalidate the deck fingerprint", async () => {
  const data = workspace(),
    a = await buildDeck(data);
  data.guide.units[0].recallAnswer = "Changed answer";
  const b = await buildDeck(data);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.cards[0].id, b.cards[0].id);
  assert.equal(a.cards[1].id, b.cards[1].id);
  assert.throws(
    () =>
      applyReview(
        emptyDeck(),
        b,
        {
          type: "start",
          deckId: a.id,
          id: crypto.randomUUID(),
          mode: "trail",
          ahead: false,
        },
        1000,
      ),
    /changed/,
  );
});
test("rating requires reveal and duplicate requests do not advance or reward twice", async () => {
  const deck = await buildDeck(workspace());
  let state = begin(deck);
  const cmd = {
    type: "rate",
    deckId: deck.id,
    id: state.session.id,
    index: 0,
    rating: "good",
  };
  assert.throws(() => applyReview(state, deck, cmd, 1000), /Reveal/);
  state = rate(state, deck, "good");
  assert.deepEqual(applyReview(state, deck, cmd, 1000), state);
  assert.equal(state.session.recalled, 1);
  assert.throws(
    () => applyReview(state, deck, { ...cmd, index: 9 }, 1000),
    /moved/,
  );
});
test("a missed card returns after intervening cards and its retry does not advance spacing", async () => {
  const deck = await buildDeck(workspace());
  let state = begin(deck);
  const id = state.session.queue[0].cardId;
  state = rate(state, deck, "again");
  assert.equal(state.session.queue[3].cardId, id);
  assert.equal(state.session.queue[3].retry, true);
  state = rate(state, deck, "good");
  state = rate(state, deck, "good");
  state = rate(state, deck, "good");
  assert.equal(state.progress[id].due, 601000);
  assert.equal(state.progress[id].step, 0);
  assert.equal(state.session.rated.length, 3);
  assert.equal(state.session.recalled, 2);
  assert.equal(state.trails, 1);
  assert.equal(state.session.finished, true);
});
test("due recall expands spacing; early practice cannot postpone the due date", async () => {
  const deck = await buildDeck(workspace());
  let state = begin(deck);
  for (let i = 0; i < 3; i++) state = rate(state, deck, "good");
  const first = deck.cards[0].id;
  assert.equal(state.progress[first].due, 86401000);
  assert.throws(() => begin(deck, state), /Nothing is due/);
  state = begin(deck, state, true);
  state = rate(state, deck, "hard", 2000);
  assert.equal(state.progress[first].due, 86401000);
  for (let i = 1; i < 3; i++) state = rate(state, deck, "good", 2000);
  state = applyReview(
    state,
    deck,
    {
      type: "start",
      deckId: deck.id,
      id: crypto.randomUUID(),
      mode: "cards",
      ahead: false,
    },
    86402000,
  );
  state = rate(state, deck, "good", 86402000);
  assert.equal(state.progress[first].due, 172802000);
});
test("review storage resumes, serializes concurrent retries and preserves corrupt files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studystep-review-"));
  const data = workspace();
  let store = createReviewStore(
    dir,
    async () => ({ data, revision: 1 }),
    () => 1000,
  );
  const { deck } = await store.get();
  let value = await store.command({
    type: "start",
    deckId: deck.id,
    id: crypto.randomUUID(),
    mode: "trail",
    ahead: false,
  });
  const cmd = { deckId: deck.id, id: value.state.session.id, index: 0 };
  await store.command({ ...cmd, type: "reveal" });
  await Promise.all([
    store.command({ ...cmd, type: "rate", rating: "again" }),
    store.command({ ...cmd, type: "rate", rating: "again" }),
  ]);
  store = createReviewStore(
    dir,
    async () => ({ data, revision: 1 }),
    () => 1000,
  );
  value = await store.get();
  assert.equal(value.state.session.index, 1);
  assert.equal(value.state.session.rated.length, 1);
  assert.equal(value.state.progress[deck.cards[0].id].reviews, 1);
  await writeFile(path.join(dir, "review.json"), "corrupt");
  await assert.rejects(() => store.get(), /could not be read/);
  assert.equal(
    await readFile(path.join(dir, "review.json"), "utf8"),
    "corrupt",
  );
});
test("topic search is dynamic, restricted to Wikipedia and text-only", async () => {
  let requested;
  const results = await searchTopics(
    "A topic entered by the learner",
    async (url, options) => {
      requested = new URL(url);
      assert.equal(options.redirect, "error");
      return Response.json({
        query: {
          search: [
            {
              pageid: 77,
              title: "A matching article",
              snippet: "A <span>matching</span> overview.",
            },
          ],
        },
      });
    },
  );
  assert.equal(requested.origin, "https://en.wikipedia.org");
  assert.equal(
    requested.searchParams.get("srsearch"),
    "A topic entered by the learner",
  );
  assert.equal(results[0].description, "A matching overview.");
  await assert.rejects(() => searchTopics("x"), /between/);
  await assert.rejects(() => topicSource("https://localhost"), /Choose/);
});
test("article provenance survives source validation; missing, ambiguous and oversize sources fail explicitly", async () => {
  const extract =
    "An independently selected reference paragraph with enough readable material to create a useful study card. ".repeat(
      2,
    );
  const source = await topicSource(77, async () =>
    Response.json({ query: { pages: [{ title: "Chosen article", extract }] } }),
  );
  assert.equal(source.originUrl, "https://en.wikipedia.org/?curid=77");
  assert.equal(sourceSchema.parse(source).attribution, source.attribution);
  assert.equal(source.passages.map((p) => p.text).join(""), extract.trim());
  await assert.rejects(
    () =>
      topicSource(77, async () =>
        Response.json({ query: { pages: [{ missing: true }] } }),
      ),
    /too little/,
  );
  await assert.rejects(
    () =>
      topicSource(77, async () =>
        Response.json({
          query: { pages: [{ extract, pageprops: { disambiguation: "" } }] },
        }),
      ),
    /specific/,
  );
  await assert.rejects(
    () =>
      topicSource(77, async () =>
        Response.json({ query: { pages: [{ extract: "a".repeat(12001) }] } }),
      ),
    /too long/,
  );
});
test("review and topic routes reject cross-origin requests and preserve study data", async () => {
  const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "studystep-learning-api-"),
    ),
    data = workspace();
  await writeFile(
    path.join(dataDir, "workspace.json"),
    JSON.stringify({ data, revision: 9 }),
  );
  const before = await readFile(path.join(dataDir, "workspace.json"), "utf8");
  const app = await createLocalServer({
    port: 0,
    dataDir,
    fetcher: async () => {
      throw Error("offline");
    },
    topicFetcher: async () => Response.json({ query: { search: [] } }),
  });
  const call = (route, body, origin = app.url) =>
    fetch(app.url + route, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await call(
          "/api/topics",
          { query: "New topic" },
          "https://evil.invalid",
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/review", {}, "https://evil.invalid")).status,
      403,
    );
    assert.deepEqual(
      await (await call("/api/topics", { query: "New topic" })).json(),
      { results: [] },
    );
    const { deck } = await (await fetch(app.url + "/api/review")).json();
    assert.equal(
      (
        await call("/api/review", {
          type: "start",
          deckId: deck.id,
          id: crypto.randomUUID(),
          mode: "trail",
          ahead: false,
        })
      ).status,
      200,
    );
    assert.equal(
      await readFile(path.join(dataDir, "workspace.json"), "utf8"),
      before,
    );
  } finally {
    await app.close();
  }
});
