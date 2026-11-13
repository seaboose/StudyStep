import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLocalServer } from "../scripts/local-server.mjs";
import { assembleDraft } from "../scripts/generation-quality.mjs";
import { validateGuide } from "../.runtime/local-server/study.mjs";

// Real orchestration and persistence; only external research/model responses are
// fixtures. No running Ollama process or internet connection is used by this test.
const brief = {
  topic: "Descriptive statistics",
  goal: "Understand measures of center and spread and compare their purposes.",
  level: "foundation",
  sourceMode: "research",
  personalize: true,
};
const facts = [
  [
    "Mean",
    "The arithmetic mean is the sum of values divided by their count.",
    "How is the arithmetic mean calculated?",
    "the sum of values divided by their count",
    ["the most frequent value", "the largest observation"],
  ],
  [
    "Median",
    "The median is the middle value in an ordered data set with an odd number of observations.",
    "What is the median in an ordered data set with an odd count?",
    "the middle value",
    ["the sum of all values", "the most frequent value"],
  ],
  [
    "Mode",
    "The mode is the most frequent value in a data set.",
    "What does the mode identify?",
    "the most frequent value",
    ["the smallest value", "the sum of all values"],
  ],
  [
    "Range",
    "The range is the difference between the largest and smallest values.",
    "What is the range of a data set?",
    "the difference between the largest and smallest values",
    ["the most frequent observation", "the number of observations"],
  ],
  [
    "Variance",
    "Population variance is the average of squared deviations from the population mean.",
    "How is population variance described?",
    "the average of squared deviations from the population mean",
    ["the number of distinct observations", "the most frequent measurement"],
  ],
  [
    "Standard deviation",
    "The standard deviation is the square root of the variance.",
    "What is the relationship between standard deviation and variance?",
    "the square root of the variance",
    ["twice the variance", "the largest value"],
  ],
  [
    "Interquartile range",
    "The interquartile range is the difference between the third and first quartiles.",
    "Which difference defines the interquartile range?",
    "the difference between the third and first quartiles",
    [
      "the difference between every pair of values",
      "the sum of the first and third quartiles",
    ],
  ],
  [
    "Sample",
    "A sample is a subset of the population selected for observation.",
    "What is a sample in statistics?",
    "a subset of the population selected for observation",
    ["the largest possible measurement", "the sum of squared deviations"],
  ],
];
const batches = [[0, 1], [2, 3], [4], [5, 6], [7]];

async function fixture(t) {
  const dataDir = await mkdtemp(
    path.join(tmpdir(), "studystep-adaptive-flow-"),
  );
  await writeFile(
    path.join(dataDir, "settings.json"),
    JSON.stringify({ model: "adaptive-fixture" }),
  );
  const sourceId = randomUUID();
  const source = {
    id: sourceId,
    name: "Measures of center and spread",
    type: "notes",
    role: "material",
    passages: facts.map((fact, index) => ({
      id: `${sourceId}:${index + 1}`,
      label: "Reference",
      text: fact[1],
    })),
    warnings: [],
    pageCount: 0,
    addedAt: "2026-10-29T00:00:00.000Z",
    fingerprint: "adaptive-reference-v1",
    originUrl: "https://en.wikipedia.org/?curid=123",
    attribution: "Deterministic test reference; no external source was fetched",
  };
  const generated = [];
  const commands = [];
  let app;
  const fetcher = async (url, init = {}) => {
    if (String(url).endsWith("/api/tags"))
      return Response.json({ models: [{ name: "adaptive-fixture", size: 1 }] });
    if (String(url).endsWith("/api/show"))
      return Response.json({ model_info: { "fixture.context_length": 32768 } });
    if (String(url).endsWith("/api/chat")) {
      const body = JSON.parse(init.body);
      assert.ok(
        body.format.properties.queries,
        "Only the bounded research planner uses this fixture transport",
      );
      return Response.json({
        done: true,
        message: { content: JSON.stringify({ queries: [brief.topic] }) },
      });
    }
    throw Error(`Unexpected external request: ${url}`);
  };
  const dependencies = {
    search: async () => [{ pageId: 123, title: "Descriptive statistics" }],
    readSource: async () => structuredClone(source),
    generate: async (sources, model, signal, transport, onStage, options) => {
      signal.throwIfAborted();
      assert.equal(model, "adaptive-fixture");
      const batch = batches[generated.length];
      assert.ok(batch, "Only user-requested continuation batches may run");
      generated.push(structuredClone(options.task));
      await onStage("Checking each topic and answer against its citations…");
      const draft = assembleDraft(
        {
          title: "Measures of center and spread",
          gaps: [],
          topics: batch.map((index) => {
            const [title, quote, question, answer, distractors] = facts[index];
            return {
              title,
              question,
              answer,
              distractors,
              citations: [{ evidenceId: `E${index + 1}` }],
            };
          }),
        },
        new Map(
          facts.map((fact, index) => [
            `E${index + 1}`,
            { passageId: `${sourceId}:${index + 1}`, quote: fact[1] },
          ]),
        ),
      );
      return { draft: validateGuide(draft, sources), reviewProblems: [] };
    },
  };
  async function open() {
    app = await createLocalServer({
      dataDir,
      port: 0,
      agentsEnabled: true,
      fetcher,
      agentDependencies: dependencies,
    });
  }
  async function close() {
    const current = app;
    app = undefined;
    await current?.close();
  }
  await open();
  t.after(close);
  async function request(route, body, method = body ? "POST" : "GET") {
    const response = await fetch(app.url + route, {
      method,
      headers: { Origin: app.url, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  }
  async function command(body) {
    commands.push(structuredClone(body));
    return request("/api/agents", body);
  }
  async function untilReady(id) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const snapshot = await request("/api/agents");
      const task = snapshot.tasks.find((candidate) => candidate.id === id);
      if (task?.status === "ready") return { snapshot, task };
      assert.notEqual(task?.status, "failed", task?.error);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw Error("Adaptive task did not finish");
  }
  async function accept(id) {
    const ready = await untilReady(id);
    const before = await request("/api/workspace");
    await command({
      action: "accept",
      id,
      proposalHash: ready.task.proposalHash,
      revision: ready.snapshot.revision,
    });
    const after = await request("/api/workspace");
    for (const question of before.data.guide?.questions || []) {
      assert.deepEqual(
        after.data.guide.questions.find(
          (candidate) => candidate.id === question.id,
        ),
        question,
        "Acceptance preserves previous questions",
      );
    }
    assert.deepEqual(
      after.data.attempts,
      before.data.attempts,
      "Acceptance preserves observations from previous batches",
    );
    return ready.task;
  }
  async function answer(task, modes) {
    const current = await request("/api/workspace");
    const ids = task.proposal.questions.map((question) => question.id);
    assert.equal(ids.length, modes.length);
    for (const [index, id] of ids.entries()) {
      const question = current.data.guide.questions.find(
        (candidate) => candidate.id === id,
      );
      assert.ok(question, "Quiz answers target accepted, namespaced questions");
      assert.ok(
        !current.data.attempts.some((attempt) => attempt.questionId === id),
        "Each observation is a distinct question",
      );
      current.data.attempts.push({
        questionId: id,
        selected:
          modes[index] === "wrong"
            ? (question.correctIndex + 1) % question.options.length
            : question.correctIndex,
        hinted: modes[index] === "hinted",
        revealed: false,
        at: new Date().toISOString(),
      });
    }
    await request(
      "/api/workspace",
      { data: current.data, revision: current.revision },
      "PUT",
    );
    return (await request("/api/agents")).tasks.find(
      (candidate) => candidate.id === task.id,
    ).progress;
  }
  async function next(parentId) {
    const newId = randomUUID();
    await command({ action: "continue", id: parentId, newId, level: "auto" });
    return (await untilReady(newId)).task;
  }
  return {
    command,
    request,
    accept,
    answer,
    next,
    generated,
    commands,
    close,
    open,
  };
}

test("automatic continuation advances from foundation to explanation and application using accepted quiz progress, then reinforces misses and hints", async (t) => {
  const f = await fixture(t);
  const rootId = randomUUID();
  await f.command({ action: "create", id: rootId, brief });
  const first = await f.accept(rootId);
  const firstProgress = await f.answer(first, ["correct", "correct"]);
  assert.equal(firstProgress.independentCorrect, 2);
  assert.equal(
    firstProgress.level,
    "foundation",
    "One successful batch does not automatically advance difficulty",
  );
  assert.equal(
    (await f.request("/api/agents")).tasks.length,
    1,
    "Scoring alone must not schedule another job",
  );

  const second = await f.next(rootId);
  assert.equal(second.brief.level, "foundation");
  assert.match(second.adaptation, /another small batch/);
  await f.accept(second.id);
  const secondProgress = await f.answer(second, ["correct", "correct"]);
  assert.equal(secondProgress.independentCorrect, 4);
  assert.equal(secondProgress.level, "explain");
  assert.match(
    secondProgress.reason,
    /4 distinct unaided correct answers across 2 accepted batches/,
  );
  assert.equal((await f.request("/api/agents")).tasks.length, 2);

  // Reopening must derive the same next step from durable accepted tasks and
  // saved answers, rather than relying on an in-memory progress counter.
  await f.close();
  await f.open();
  const reopened = (await f.request("/api/agents")).tasks.find(
    (task) => task.id === second.id,
  );
  assert.deepEqual(reopened.progress, secondProgress);
  const explanation = await f.next(second.id);
  assert.equal(explanation.brief.level, "explain");
  assert.equal(explanation.adaptation, secondProgress.reason);
  await f.accept(explanation.id);
  const explanationProgress = await f.answer(explanation, ["correct"]);
  assert.equal(explanationProgress.independentCorrect, 5);
  assert.equal(explanationProgress.level, "apply");
  assert.match(
    explanationProgress.reason,
    /5 distinct unaided correct answers across 3 accepted batches/,
  );

  const application = await f.next(explanation.id);
  assert.equal(application.brief.level, "apply");
  assert.equal(application.adaptation, explanationProgress.reason);
  await f.accept(application.id);
  const reinforceProgress = await f.answer(application, ["wrong", "hinted"]);
  assert.equal(reinforceProgress.attempted, 7);
  assert.equal(
    reinforceProgress.independentCorrect,
    5,
    "Wrong or assisted answers cannot inflate readiness",
  );
  assert.equal(reinforceProgress.incorrect, 1);
  assert.equal(reinforceProgress.assisted, 1);
  assert.equal(reinforceProgress.level, "foundation");
  const reinforcement = await f.next(application.id);
  assert.equal(reinforcement.brief.level, "foundation");
  assert.equal(reinforcement.adaptation, reinforceProgress.reason);
  assert.match(reinforcement.adaptation, /incorrect and 1 assisted/);
  assert.deepEqual(f.generated[0].learningSignals, []);
  assert.ok(
    f.generated[1].learningSignals.every(
      (signal) => signal.outcome === "correct",
    ),
  );
  const weakSignals = f.generated
    .at(-1)
    .learningSignals.filter((signal) => signal.outcome !== "correct");
  assert.deepEqual(
    weakSignals.map((signal) => signal.outcome),
    ["incorrect", "assisted"],
  );
  assert.deepEqual(
    weakSignals.map((signal) => signal.question),
    application.proposal.questions.map((question) => question.prompt),
  );

  assert.deepEqual(
    f.generated.map((task) => task.level),
    ["foundation", "foundation", "explain", "apply", "foundation"],
    "The inferred level must reach the actual generation boundary",
  );
  for (const [index, task] of [
    first,
    second,
    explanation,
    application,
    reinforcement,
  ].entries()) {
    assert.equal(task.rootId, rootId);
    assert.equal(task.brief.topic, brief.topic);
    assert.equal(task.brief.goal, brief.goal);
    if (index)
      assert.equal(
        task.parentId,
        [first, second, explanation, application][index - 1].id,
      );
    assert.equal(f.generated[index].level, task.brief.level);
    assert.equal(f.generated[index].adaptation, task.adaptation);
    assert.doesNotMatch(
      task.adaptation,
      /You chose/,
      "This workflow uses inferred readiness, not an explicit harder-level preference",
    );
  }
  assert.ok(
    f.commands
      .filter((command) => command.action === "continue")
      .every((command) => command.level === "auto"),
  );
  assert.equal(
    (await f.request("/api/workspace")).data.attempts.length,
    7,
    "Reinforcement retains the original observations",
  );
});
