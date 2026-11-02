import { approvedChecks } from "./fixtures/review-checks.mjs";
import { EXAMPLE_SET } from "../tests/fixtures/example-set.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseStudyImport,
  exportChatSet,
  exportBackup,
  editGuide,
  validateLocalWorkspace,
} from "../.runtime/local-server/local-study.mjs";
import { independentCorrect } from "../.runtime/local-server/study.mjs";
import { createLocalServer } from "../scripts/local-server.mjs";
import { isLocalModel, localResponseAdapter } from "../scripts/local-model.mjs";

const imported = () => parseStudyImport(JSON.stringify(EXAMPLE_SET)).data;
test("chat sets round-trip and use human-friendly one-based answers", () => {
  const data = imported();
  assert.equal(data.guide.questions[0].correctIndex, 0);
  assert.deepEqual(
    exportChatSet(
      parseStudyImport(JSON.stringify(exportChatSet(data.guide))).data.guide,
    ),
    exportChatSet(data.guide),
  );
  assert.equal(
    parseStudyImport("```json\n" + JSON.stringify(EXAMPLE_SET) + "\n```").data
      .guide.title,
    "Networking basics",
  );
});
test("bad answers, duplicated options, oversize input, and malformed sets are rejected", () => {
  const bad = structuredClone(EXAMPLE_SET);
  bad.topics[0].questions[0].answer = 4;
  assert.throws(
    () => parseStudyImport(JSON.stringify(bad)),
    /available choice/,
  );
  bad.topics[0].questions[0].answer = 1;
  bad.topics[0].questions[0].options[1] = bad.topics[0].questions[0].options[0];
  assert.throws(() => parseStudyImport(JSON.stringify(bad)), /different/);
  assert.throws(() => parseStudyImport("x".repeat(2_000_001)), /smaller/);
  assert.throws(() => parseStudyImport("{}"));
});
test("editing preserves unaffected attempts and invalidates changed questions", () => {
  const data = imported();
  const q = data.guide.questions[0];
  data.guide.questions.push({ ...structuredClone(q), id: "second" });
  data.attempts = [q.id, "second"].map((questionId) => ({
    questionId,
    selected: 0,
    hinted: false,
    revealed: false,
    at: new Date().toISOString(),
  }));
  data.hintUsed = [q.id];
  data.studied = [data.guide.units[0].id];
  const draft = structuredClone(data.guide);
  draft.questions[0].prompt = "An updated question?";
  const next = editGuide(data, draft);
  assert.deepEqual(
    next.attempts.map((a) => a.questionId),
    ["second"],
  );
  assert.deepEqual(next.hintUsed, []);
  assert.deepEqual(next.studied, data.studied);
  assert.ok(independentCorrect(next.attempts[0], next.guide));
  assert.equal(
    independentCorrect({ ...next.attempts[0], hinted: true }, next.guide),
    false,
  );
  assert.equal(
    independentCorrect({ ...next.attempts[0], revealed: true }, next.guide),
    false,
  );
});
test("full backups retain progress and reject fabricated references", () => {
  const data = imported();
  data.attempts = [
    {
      questionId: data.guide.questions[0].id,
      selected: 0,
      hinted: false,
      revealed: false,
      at: new Date().toISOString(),
    },
  ];
  assert.deepEqual(
    parseStudyImport(JSON.stringify(exportBackup(data))).data,
    data,
  );
  data.attempts[0].questionId = "missing";
  assert.throws(() => validateLocalWorkspace(data), /invalid/);
});
test("manual topics can be saved before practice questions are written", () => {
  const data = imported();
  data.guide.questions = [];
  assert.equal(validateLocalWorkspace(data).guide.questions.length, 0);
});
test("local storage persists across restarts, rejects stale writes and cross-site access", async () => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "studystep-local-test-"),
  );
  const fetcher = async () => {
    throw Error("Ollama offline");
  };
  let app = await createLocalServer({ port: 0, dataDir, fetcher });
  const call = (route, method = "GET", data, origin = app.url) =>
    fetch(app.url + route, {
      method,
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  try {
    assert.equal((await call("/api/workspace")).status, 200);
    const saved = await (
      await call("/api/workspace", "PUT", { data: imported(), revision: 0 })
    ).json();
    assert.equal(saved.revision, 1);
    assert.equal(
      (await call("/api/workspace", "PUT", { data: imported(), revision: 0 }))
        .status,
      409,
    );
    assert.equal(
      (
        await call(
          "/api/workspace",
          "GET",
          undefined,
          "https://untrusted.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/workspace",
          "DELETE",
          { revision: 1 },
          "https://untrusted.example",
        )
      ).status,
      403,
    );
    assert.equal((await call("/api/workspace", "DELETE", {})).status, 409);
    await app.close();
    app = await createLocalServer({ port: 0, dataDir, fetcher });
    const restored = await (await call("/api/workspace")).json();
    assert.equal(restored.data.guide.title, "Networking basics");
    assert.equal(restored.aiReady, false);
    await call("/api/workspace", "PUT", { data: restored.data, revision: 1 });
    assert.equal(
      JSON.parse(
        await readFile(path.join(dataDir, "workspace.previous.json"), "utf8"),
      ).revision,
      1,
    );
  } finally {
    await app.close();
  }
});
test("local generation uses only loopback and returns a reviewed draft without changing saved progress", async () => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "studystep-local-ai-test-"),
  );
  const calls = [];
  const data = imported();
  const quote = "DNS translates domain names into IP addresses.";
  data.sources = [
    {
      id: crypto.randomUUID(),
      name: "Sample",
      type: "notes",
      role: "material",
      passages: [
        {
          id: "p1",
          label: "Notes",
          text: quote + " Name resolution is separate from encryption.",
        },
      ],
      warnings: [],
      pageCount: 0,
      addedAt: new Date().toISOString(),
      fingerprint: "test",
    },
  ];
  data.sources[0].passages.push(
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `extra-${i}`,
      label: `Extra ${i}`,
      text: "Unselected material. ".repeat(80),
    })),
  );
  const guide = structuredClone(data.guide);
  guide.units[0].objective = "Explain DNS.";
  guide.units[0].detail = "DNS resolves names.";
  guide.units[0].citations = [{ passageId: "p1", quote }];
  guide.questions[0].citations = [{ passageId: "p1", quote }];
  guide.questions[0].options[0].text = "domain names into IP addresses";
  guide.questions[0].options.forEach(
    (o) => (o.explanation = "DNS translates domain names into IP addresses."),
  );
  const fetcher = async (url, init) => {
    calls.push({ url, body: init?.body });
    assert.ok(url.startsWith("http://127.0.0.1:11434/"));
    if (url.endsWith("/tags"))
      return Response.json({
        models: [{ name: "qwen3:4b", size: 2e9 }, { name: "large:cloud" }],
      });
    if (url.endsWith("/show"))
      return Response.json({ details: { family: "qwen3" } });
    if (url.endsWith("/chat")) {
      const body = JSON.parse(init.body);
      assert.equal(body.model, "qwen3:4b");
      assert.equal(init.headers.Authorization, undefined);
      const raw = structuredClone(guide);
      const evidence = JSON.parse(body.messages[1].content).evidence;
      if (evidence)
        for (const item of [...raw.units, ...raw.questions])
          item.citations = item.citations.map((c) => ({
            evidenceId: evidence.find((e) => e.quote.includes(c.quote))
              .evidenceId,
          }));
      return Response.json({
        done: true,
        message: {
          content: JSON.stringify(
            body.format.properties.checks
              ? {
                  checks: approvedChecks(
                    JSON.parse(body.messages[1].content).items,
                  ),
                }
              : raw,
          ),
        },
      });
    }
    throw Error("Unexpected endpoint");
  };
  const app = await createLocalServer({ port: 0, dataDir, fetcher });
  const call = (route, method, body) =>
    fetch(app.url + route, {
      method,
      headers: { Origin: app.url, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await call("/api/local-model", "PUT", { model: "large:cloud" })).status,
      400,
    );
    assert.equal(
      (await call("/api/local-model", "PUT", { model: "qwen3:4b" })).status,
      200,
    );
    await call("/api/workspace", "PUT", { data, revision: 0 });
    assert.equal(
      (await call("/api/generate", "POST", { revision: 0 })).status,
      409,
    );
    assert.equal(
      (await call("/api/generate", "POST", { revision: 1 })).status,
      400,
    );
    const response = await call("/api/generate", "POST", {
      revision: 1,
      passageIds: ["p1"],
    });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.revision, 1);
    assert.ok(result.draft.units[0].citations[0].quote.includes(quote));
    assert.equal(result.reviewProblems.length, 1);
    assert.deepEqual(result.data.guide, data.guide);
    assert.equal(calls.filter((c) => c.url.endsWith("/chat")).length, 2);
    assert.match(result.draft.gaps.at(-1), /8 source sections/);
    const recovery = await (await fetch(app.url + "/api/editor-draft")).json();
    assert.deepEqual(recovery.draft.guide, result.draft);
    assert.equal(
      (await call("/api/generate", "POST", { revision: 1, passageIds: ["p1"] }))
        .status,
      400,
    );
  } finally {
    await app.close();
  }
});
test("generation can be cancelled during model preflight without producing or saving a draft", async () => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "studystep-cancel-test-"),
  );
  let release, started;
  const gate = new Promise((r) => {
    release = r;
  });
  const entered = new Promise((r) => {
    started = r;
  });
  const fetcher = async (url) => {
    if (url.endsWith("/tags"))
      return Response.json({ models: [{ name: "qwen3:4b" }] });
    if (url.endsWith("/show")) {
      started();
      await gate;
      return Response.json({});
    }
    throw Error("Inference should not begin after cancellation.");
  };
  const app = await createLocalServer({ port: 0, dataDir, fetcher });
  const call = (route, method, body) =>
    fetch(app.url + route, {
      method,
      headers: { Origin: app.url, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    await call("/api/local-model", "PUT", { model: "qwen3:4b" });
    const data = imported();
    data.sources = [
      {
        id: crypto.randomUUID(),
        name: "Test",
        type: "notes",
        role: "material",
        passages: [
          {
            id: "p1",
            label: "Test",
            text: "DNS translates domain names into IP addresses. Name resolution is separate from encryption.",
          },
        ],
        warnings: [],
        pageCount: 0,
        addedAt: new Date().toISOString(),
        fingerprint: "test",
      },
    ];
    await call("/api/workspace", "PUT", { data, revision: 0 });
    const pending = call("/api/generate", "POST", { revision: 1 });
    await entered;
    assert.equal(
      (await call("/api/generate", "POST", { revision: 1 })).status,
      409,
    );
    await call("/api/generate", "DELETE", {});
    release();
    const result = await pending;
    assert.equal(result.status, 400);
    assert.match((await result.json()).error, /cancelled/);
    const state = await (await fetch(app.url + "/api/workspace")).json();
    assert.equal(state.revision, 1);
    assert.deepEqual(state.data.guide, data.guide);
  } finally {
    release();
    await app.close();
  }
});
test("local adapter blocks cloud names, redirects, and incomplete outputs", async () => {
  assert.equal(isLocalModel("model:cloud"), false);
  assert.equal(isLocalModel("https://example.com/model"), false);
  assert.throws(() =>
    localResponseAdapter("model:cloud", new AbortController().signal),
  );
  const adapter = localResponseAdapter(
    "qwen3:4b",
    new AbortController().signal,
    async (url, init) => {
      assert.equal(init.redirect, "error");
      return Response.json({
        done: true,
        done_reason: "length",
        message: { content: "{}" },
      });
    },
  );
  await assert.rejects(
    () =>
      adapter("ignored", {
        body: JSON.stringify({
          instructions: "",
          input: "",
          text: { format: { schema: {} } },
        }),
      }),
    /ran out/,
  );
});
