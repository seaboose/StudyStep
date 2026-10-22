import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emptyWorkspace } from "../.runtime/local-server/study.mjs";
import {
  retainReviewed,
  removeCard,
} from "../.runtime/local-server/card-review.mjs";
import {
  assembleDraft,
  qualityProblems,
  reviewItems,
  validateReview,
} from "../scripts/generation-quality.mjs";
import { createDraftStore } from "../scripts/draft-store.mjs";
import { createLocalServer } from "../scripts/local-server.mjs";
import { approvedChecks } from "./fixtures/review-checks.mjs";

const quote =
  "Guard cells regulate the opening and closing of stomata. Roots absorb water from soil.";
const source = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Plant notes",
  type: "notes",
  role: "material",
  passages: [
    { id: "p1", label: "Section 1", text: quote },
    {
      id: "p2",
      label: "Section 2",
      text: "Xylem transports water through a plant from the roots toward its leaves.",
    },
  ],
  warnings: [],
  pageCount: 0,
  addedAt: "2026-10-19T00:00:00.000Z",
  fingerprint: "plants",
};
function guide() {
  return assembleDraft(
    {
      title: "Plants",
      topics: [
        {
          title: "Guard cells",
          question: "What regulates the opening and closing of stomata?",
          answer: "Guard cells",
          distractors: ["Roots", "Flowers"],
          citations: [{ evidenceId: "E1" }],
        },
      ],
      gaps: [],
    },
    new Map([["E1", { passageId: "p1", quote }]]),
  );
}
function checked() {
  const g = guide();
  const q = g.questions[0];
  [q.options[0], q.options[q.correctIndex]] = [
    q.options[q.correctIndex],
    q.options[0],
  ];
  q.correctIndex = 0;
  const items = reviewItems(g);
  return { g, items, checks: approvedChecks(items) };
}

test("selected sections and intentionally empty selections survive server restart without changing the accepted set", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "studystep-selection-"));
  let app = await createLocalServer({
    dataDir,
    port: 0,
    fetcher: async () => {
      throw Error("offline");
    },
  });
  const call = (method, data) =>
    fetch(app.url + "/api/workspace", {
      method,
      headers: { Origin: app.url, "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
  try {
    const data = {
      ...emptyWorkspace(),
      sources: [source],
      guide: guide(),
      selectedPassageIds: ["p2"],
    };
    assert.equal((await call("PUT", { data, revision: 0 })).status, 200);
    await app.close();
    app = await createLocalServer({
      dataDir,
      port: 0,
      fetcher: async () => {
        throw Error("offline");
      },
    });
    let record = await (await call("GET")).json();
    assert.deepEqual(record.data.selectedPassageIds, ["p2"]);
    assert.deepEqual(record.data.guide, data.guide);
    assert.equal(record.data.sources[0].passages.length, 2);
    assert.equal(
      (
        await call("PUT", {
          data: { ...record.data, selectedPassageIds: [] },
          revision: record.revision,
        })
      ).status,
      200,
    );
    await app.close();
    app = await createLocalServer({
      dataDir,
      port: 0,
      fetcher: async () => {
        throw Error("offline");
      },
    });
    record = await (await call("GET")).json();
    assert.deepEqual(record.data.selectedPassageIds, []);
    assert.equal(
      (
        await call("PUT", {
          data: { ...record.data, selectedPassageIds: ["missing"] },
          revision: record.revision,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("PUT", {
          data: { ...record.data, selectedPassageIds: ["p1", "p1"] },
          revision: record.revision,
        })
      ).status,
      400,
    );
  } finally {
    await app.close();
  }
});
test("review progress survives restart and draft saves do not alter accepted material", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "studystep-reviewed-"));
  const data = { ...emptyWorkspace(), sources: [source] };
  let store = createDraftStore(dataDir, async () => ({ data }));
  const record = await store.get();
  const g = guide();
  await store.put({
    version: 0,
    baseKey: record.baseKey,
    guide: g,
    reviewedIds: [g.units[0].id],
  });
  store = createDraftStore(dataDir, async () => ({ data }));
  const restored = await store.get();
  assert.deepEqual(restored.draft.reviewedIds, [g.units[0].id]);
  assert.equal(data.guide, null);
  data.selectedPassageIds = ["p2"];
  assert.equal((await store.get()).baseKey, record.baseKey);
  await assert.rejects(
    () =>
      store.put({
        version: 1,
        baseKey: record.baseKey,
        guide: g,
        reviewedIds: ["missing"],
      }),
    /reviewed cards/,
  );
});
test("changing a card or any of its practice choices invalidates its review while other cards stay kept", () => {
  const g = guide();
  g.units.push({ ...g.units[0], id: "other" });
  const ids = g.units.map((u) => u.id);
  const changed = structuredClone(g);
  changed.questions[0].options[0].text = "Changed answer";
  assert.deepEqual(retainReviewed(g, changed, ids), ["other"]);
  changed.units[1].recallAnswer = "Changed";
  assert.deepEqual(retainReviewed(g, changed, ids), []);
  const renamed = { ...g, title: "Renamed set" };
  assert.deepEqual(retainReviewed(g, renamed, ids), ids);
});
test("removing a review card removes its questions, preserves others, and prevents an empty set", () => {
  const g = guide();
  assert.throws(() => removeCard(g, g.units[0].id), /at least one/);
  g.units.push({ ...g.units[0], id: "other" });
  const reduced = removeCard(g, g.units[0].id);
  assert.equal(reduced.units.length, 1);
  assert.equal(reduced.questions.length, 0);
  assert.equal(g.units.length, 2);
});
test("punctuation duplicates, overlapping choices, and answer-revealing hints are rejected", () => {
  const g = guide();
  assert.deepEqual(qualityProblems(g), []);
  const q = g.questions[0];
  const other = (q.correctIndex + 1) % 3;
  for (const text of ["The guard cells.", "Guard cells and roots"]) {
    const changed = structuredClone(g);
    changed.questions[0].options[other].text = text;
    assert.ok(qualityProblems(changed).some((p) => p.includes("overlap")));
  }
  const leaked = structuredClone(g);
  leaked.questions[0].hint = "Remember: guard cells.";
  assert.ok(qualityProblems(leaked).some((p) => p.includes("hint reveals")));
});
test("review cannot pass with an unchecked option, multiple possible answers, uncertainty, or a fabricated supporting quote", () => {
  const { items, checks } = checked();
  assert.deepEqual(validateReview({ checks }, items), []);
  const missing = structuredClone(checks);
  delete missing[1].optionChecks["2"];
  assert.throws(
    () => validateReview({ checks: missing }, items),
    /every answer choice/,
  );
  for (const verdict of ["answers", "uncertain"]) {
    const ambiguous = structuredClone(checks);
    ambiguous[1].optionChecks["1"].verdict = verdict;
    assert.ok(
      validateReview({ checks: ambiguous }, items).some((p) =>
        p.includes("ambiguous"),
      ),
    );
  }
  const invented = structuredClone(checks);
  invented[1].supportingQuote = "Guard cells regulate all plant transport.";
  assert.ok(
    validateReview({ checks: invented }, items).some((p) =>
      p.includes("exact supporting"),
    ),
  );
  const unrelated = structuredClone(checks);
  unrelated[1].supportingQuote = "Roots absorb water from soil.";
  assert.ok(
    validateReview({ checks: unrelated }, items).some((p) =>
      p.includes("reference answer"),
    ),
  );
});
test("the app supplies a neutral cue instead of a model hint that gives away the answer", () => {
  const g = assembleDraft(
    {
      title: "Plants",
      topics: [
        {
          title: "Guard cells",
          question: "What regulates stomata?",
          answer: "Guard cells",
          hint: "Guard cells is the answer.",
          distractors: ["Roots", "Flowers"],
          citations: [{ evidenceId: "E1" }],
        },
      ],
      gaps: [],
    },
    new Map([["E1", { passageId: "p1", quote }]]),
  );
  assert.equal(
    g.questions[0].hint,
    "Think of the fact stated in the source section.",
  );
  assert.deepEqual(qualityProblems(g), []);
});
test("a source prefix ending inside a word cannot pass as an exact answer", () => {
  const g = guide();
  g.units[0].recallAnswer = "Guard cel";
  g.questions[0].options[g.questions[0].correctIndex].text = "Guard cel";
  assert.ok(qualityProblems(g).some((p) => p.includes("exact phrase")));
  assert.ok(qualityProblems(g).some((p) => p.includes("inside a source word")));
});
