import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { emptyWorkspace } from "../.runtime/local-server/study.mjs";
import { newGuide } from "../.runtime/local-server/local-study.mjs";
import { selectPassages } from "../.runtime/local-server/selection.mjs";
import { createDraftStore, draftBaseKey } from "../scripts/draft-store.mjs";
import {
  qualityProblems,
  reviewItems,
  validateReview,
  limitGenerationSchema,
  assembleDraft,
  compactGenerationSchema,
} from "../scripts/generation-quality.mjs";
import { generationSchema } from "../.runtime/local-server/generate.mjs";
import { createLocalServer } from "../scripts/local-server.mjs";
import { generateLocalDraft } from "../scripts/local-generation.mjs";
import { approvedChecks } from "./fixtures/review-checks.mjs";

const text =
  "Water evaporates from leaves through stomata. Guard cells regulate the opening and closing of stomata. Roots absorb water from soil.";
test("compact questions become linked cards with original excerpts and a blind review payload", () => {
  const plan = {
    title: "Plants",
    topics: [
      {
        title: "Stomata",
        question: "What regulates the opening of stomata?",
        answer: "Guard cells",
        distractors: ["Roots", "Flowers"],
        hint: "Think about the opening.",
        citations: [{ evidenceId: "E1" }],
      },
    ],
    gaps: [],
  };
  const result = assembleDraft(
    plan,
    new Map([["E1", { passageId: "p1", quote: text }]]),
  );
  assert.equal(result.units[0].explanation, text);
  assert.equal(result.questions[0].unitId, result.units[0].id);
  assert.equal(
    result.questions[0].options[result.questions[0].correctIndex].text,
    "Guard cells",
  );
  assert.deepEqual(qualityProblems(result), []);
  const review = reviewItems(result)[1];
  assert.equal(review.content.correctIndex, undefined);
  assert.equal(review.content.hint, undefined);
  assert.equal(typeof review.content.options[0], "string");
  assert.equal(compactGenerationSchema().properties.topics.maxItems, 3);
  assert.throws(() => assembleDraft(plan, new Map()), /unknown source/);
});
function source() {
  return {
    id: crypto.randomUUID(),
    name: "Plant notes",
    type: "notes",
    role: "material",
    passages: [{ id: "p1", label: "First section", text }],
    warnings: [],
    pageCount: 0,
    addedAt: new Date().toISOString(),
    fingerprint: "test",
  };
}
function guide() {
  const citations = [{ passageId: "p1", quote: text }];
  return {
    title: "Water in leaves",
    units: [
      {
        id: "u1",
        title: "Stomata",
        objective: "Explain how openings are regulated.",
        explanation: "Water evaporates from leaves through stomata.",
        detail: "Guard cells regulate the opening and closing of stomata.",
        keyPoints: ["Roots absorb water from soil."],
        example: "",
        misconception: "",
        recallPrompt: "What regulates the opening and closing of stomata?",
        recallAnswer: "Guard cells",
        citations,
      },
    ],
    questions: [
      {
        id: "q1",
        unitId: "u1",
        prompt: "What regulates the opening and closing of stomata?",
        options: [
          {
            text: "Guard cells",
            explanation:
              "Guard cells regulate the opening and closing of stomata.",
          },
          { text: "Roots", explanation: "Roots absorb water from soil." },
          {
            text: "Leaves",
            explanation: "Water evaporates from leaves through stomata.",
          },
        ],
        correctIndex: 0,
        hint: "Think about the structures around the openings.",
        citations,
      },
    ],
    gaps: [],
  };
}

test("section selection uses original IDs, leaves files intact, and rejects stale/duplicate/empty/oversize choices", () => {
  const s = source();
  s.passages.push(
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `long-${i}`,
      label: `Section ${i}`,
      text: "Long reading. ".repeat(100),
    })),
  );
  const before = JSON.stringify(s);
  assert.ok(selectPassages([s], ["p1"])[0].passages[0].text === text);
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => selectPassages([s], []));
  assert.throws(() => selectPassages([s], ["absent"]), /changed/);
  assert.throws(() => selectPassages([s], ["p1", "p1"]), /once/);
  s.passages.push({
    id: "more",
    label: "More",
    text: "Extra text. ".repeat(100),
  });
  assert.throws(() => selectPassages([s]), /12,000/);
  assert.throws(
    () => selectPassages([{ ...s, role: "assignment" }], ["p1"]),
    /supporting/,
  );
});
test("incomplete editor fields survive restart without changing accepted study data", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studystep-draft-test-"));
  const data = emptyWorkspace();
  const before = JSON.stringify(data);
  let store = createDraftStore(dir, async () => ({ data }));
  const r = await store.get();
  const draft = newGuide();
  draft.title = "Work in progress";
  draft.units[0].explanation = "";
  const saved = await store.put({
    version: r.version,
    baseKey: r.baseKey,
    guide: draft,
    problems: [],
  });
  store = createDraftStore(dir, async () => ({ data }));
  assert.deepEqual((await store.get()).draft.guide, draft);
  assert.equal(JSON.stringify(data), before);
  await assert.rejects(
    () => store.put({ version: 0, baseKey: r.baseKey, guide: draft }),
    /another window/,
  );
  data.sources = [source()];
  await assert.rejects(
    () =>
      store.put({ version: saved.version, baseKey: r.baseKey, guide: draft }),
    /material changed/,
  );
  assert.equal((await store.get()).draft.baseKey, r.baseKey);
  await store.discard({ version: saved.version });
  assert.equal((await store.get()).draft, null);
});
test("draft writes serialize; corrupt drafts are never replaced silently", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studystep-draft-test-")),
    data = emptyWorkspace();
  const store = createDraftStore(dir, async () => ({ data }));
  const input = { version: 0, baseKey: draftBaseKey(data), guide: newGuide() };
  const attempts = await Promise.allSettled([
    store.put(input),
    store.put(input),
  ]);
  assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
  await writeFile(path.join(dir, "editor-draft.json"), "broken");
  await assert.rejects(() => store.get(), /left untouched/);
  await assert.rejects(() => store.put(input), /left untouched/);
  assert.equal(
    await readFile(path.join(dir, "editor-draft.json"), "utf8"),
    "broken",
  );
});
test("draft route rejects foreign origins and oversize or invalid draft fields", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studystep-draft-test-"));
  const app = await createLocalServer({
    dataDir: dir,
    port: 0,
    fetcher: async () => {
      throw Error("offline");
    },
  });
  try {
    const r = await (await fetch(app.url + "/api/editor-draft")).json();
    const send = (value, origin = app.url) =>
      fetch(app.url + "/api/editor-draft", {
        method: "PUT",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
    assert.equal(
      (await send({ ...r, guide: newGuide() }, "https://other.example")).status,
      403,
    );
    const bad = newGuide();
    bad.title = "x".repeat(301);
    assert.equal((await send({ ...r, guide: bad })).status, 400);
    assert.equal((await send({ ...r, guide: newGuide() })).status, 200);
  } finally {
    await app.close();
  }
});
test("quality checks reject truncation, evidence codes, verbosity, and answers absent from cited text", () => {
  assert.deepEqual(qualityProblems(guide()), []);
  for (const change of [
    (g) => (g.units[0].detail = "Guard cells regulate the"),
    (g) => (g.questions[0].options[1].explanation = "As shown in E3."),
    (g) => (g.units[0].explanation = "x".repeat(401) + "."),
    (g) => (g.units[0].recallAnswer = "Chloroplasts"),
    (g) => (g.questions[0].options[0].text = "Cell membranes"),
  ]) {
    const g = guide();
    change(g);
    assert.ok(qualityProblems(g).length);
  }
  const schema = limitGenerationSchema(generationSchema);
  assert.equal(
    schema.properties.questions.items.properties.options.items.properties
      .explanation.maxLength,
    180,
  );
});
test("evidence review must explicitly check every item and reject unsupported or uncertain verdicts", () => {
  const items = reviewItems(guide());
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].evidence, [text]);
  const checks = approvedChecks(items);
  assert.deepEqual(validateReview({ checks }, items), []);
  assert.throws(() => validateReview({ checks: checks.slice(1) }, items));
  assert.throws(() =>
    validateReview({ checks: [checks[0], checks[0]] }, items),
  );
  checks[1].answerIndex = 1;
  assert.equal(validateReview({ checks }, items).length, 1);
  checks[1].answerIndex = 0;
  checks[0].verdict = "uncertain";
  assert.equal(validateReview({ checks }, items).length, 1);
});
test("a failed evidence review does not become an accepted draft, even after the single repair", async () => {
  let writes = 0,
    reviews = 0;
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.format.properties.checks) {
      reviews++;
      const checks = approvedChecks(JSON.parse(body.messages[1].content).items);
      checks[0].verdict = "unsupported";
      return Response.json({
        done: true,
        message: { content: JSON.stringify({ checks }) },
      });
    }
    writes++;
    const g = guide();
    for (const item of [...g.units, ...g.questions])
      item.citations = [{ evidenceId: "E1" }];
    return Response.json({
      done: true,
      message: { content: JSON.stringify(g) },
    });
  };
  await assert.rejects(
    () =>
      generateLocalDraft(
        [source()],
        "test",
        new AbortController().signal,
        fetcher,
      ),
    /unsupported or uncertain/,
  );
  assert.equal(writes, 2);
  assert.equal(reviews, 2);
});
test("a missing review response fails closed; an abort is not retried", async () => {
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    const g = guide();
    for (const item of [...g.units, ...g.questions])
      item.citations = [{ evidenceId: "E1" }];
    return Response.json({
      done: true,
      message: {
        content: JSON.stringify(
          body.format.properties.checks ? { checks: [] } : g,
        ),
      },
    });
  };
  await assert.rejects(
    () =>
      generateLocalDraft(
        [source()],
        "test",
        new AbortController().signal,
        fetcher,
      ),
    /review could not complete/,
  );
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  await assert.rejects(
    () =>
      generateLocalDraft([source()], "test", abort.signal, async () => {
        calls++;
      }),
    /cancelled/,
  );
  assert.equal(calls, 0);
});
