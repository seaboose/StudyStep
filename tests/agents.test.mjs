import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rmdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalServer } from "../scripts/local-server.mjs";
import {
  learningProgress,
  learningSignals,
  questionFingerprint,
} from "../scripts/agent-workflow.mjs";
import { assembleDraft } from "../scripts/generation-quality.mjs";
import { generateLocalDraft } from "../scripts/local-generation.mjs";
import { approvedChecks } from "./fixtures/review-checks.mjs";
import {
  emptyWorkspace,
  sourceKey,
  validateGuide,
} from "../.runtime/local-server/study.mjs";
import { parseStudyImport } from "../.runtime/local-server/local-study.mjs";

const brief = {
  topic: "Plant biology",
  goal: "Understand how plants move water and regulate water loss.",
  level: "foundation",
  sourceMode: "research",
  personalize: true,
};
const text =
  "Guard cells regulate the opening and closing of stomata. Roots absorb water from soil. Xylem transports water from roots toward leaves. Chlorophyll absorbs light for photosynthesis. Phloem transports sugars through a plant.";
function source(id = crypto.randomUUID()) {
  return {
    id,
    name: "Plant physiology",
    type: "notes",
    role: "material",
    passages: [{ id: `${id}:1`, label: "Overview", text }],
    warnings: [],
    pageCount: 0,
    addedAt: "2026-10-29T00:00:00.000Z",
    fingerprint: "plant-reference-v1",
    originUrl: "https://en.wikipedia.org/?curid=123",
    attribution: "Test source snapshot",
  };
}
function guide(sources, variant = 0) {
  const facts = [
    [
      "Guard cells",
      "What regulates the opening and closing of stomata?",
      "Guard cells",
      ["Roots", "Flowers"],
    ],
    [
      "Roots",
      "Which plant structure absorbs water from soil?",
      "Roots",
      ["Petals", "Seeds"],
    ],
    [
      "Xylem",
      "What transports water from roots toward leaves?",
      "Xylem",
      ["Stomata", "Chlorophyll"],
    ],
    [
      "Chlorophyll",
      "What absorbs light for photosynthesis?",
      "Chlorophyll",
      ["Phloem", "Roots"],
    ],
    [
      "Phloem",
      "What transports sugars through a plant?",
      "Phloem",
      ["Xylem", "Stomata"],
    ],
  ];
  const chosen = variant === 0 ? facts.slice(0, 3) : facts.slice(3);
  const draft = assembleDraft(
    {
      title: "Plant physiology",
      gaps: [],
      topics: chosen.map(([title, question, answer, distractors]) => ({
        title,
        question,
        answer,
        distractors,
        citations: [{ evidenceId: "E1" }],
      })),
    },
    new Map([
      [
        "E1",
        {
          passageId: sources[0].passages[0].id,
          quote: sources[0].passages[0].text,
        },
      ],
    ]),
  );
  return validateGuide(draft, sources);
}
async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "studystep-agents-"));
  await writeFile(
    path.join(dir, "settings.json"),
    JSON.stringify({ model: "fixture-model" }),
  );
  let app;
  const counts = { search: 0, read: 0, generate: 0, plan: 0 };
  const fetcher = async (url, init = {}) => {
    if (String(url).endsWith("/api/tags"))
      return Response.json({ models: [{ name: "fixture-model", size: 1 }] });
    if (String(url).endsWith("/api/show")) return Response.json({});
    if (String(url).endsWith("/api/chat")) {
      const request = JSON.parse(init.body);
      if (options.chat) return options.chat(request);
      counts.plan++;
      assert.equal(request.format.properties.queries.type, "array");
      return Response.json({
        done: true,
        message: { content: JSON.stringify({ queries: ["Plant physiology"] }) },
      });
    }
    throw Error(`Unexpected fixture request ${url}`);
  };
  const dependencies = {
    search: async () => {
      counts.search++;
      return [{ pageId: 123, title: "Plant physiology" }];
    },
    readSource: async () => {
      counts.read++;
      return source();
    },
    generate: async (sources, model, signal, fetch, onStage, settings) => {
      counts.generate++;
      assert.equal(model, "fixture-model");
      assert.equal(settings.task.topic, brief.topic);
      signal.throwIfAborted();
      await onStage("Checking each topic and answer against its citations…");
      return { draft: guide(sources, counts.generate - 1), reviewProblems: [] };
    },
    ...options.agentDependencies,
  };
  async function open() {
    app = await createLocalServer({
      dataDir: dir,
      port: 0,
      fetcher,
      agentsEnabled: options.agentsEnabled ?? true,
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
  async function request(route, method = "GET", value, headers = {}) {
    const response = await fetch(app.url + route, {
      method,
      headers: {
        Origin: app.url,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    return { status: response.status, value: await response.json() };
  }
  async function post(value, expected = 200) {
    const response = await request("/api/agents", "POST", value);
    assert.equal(response.status, expected, JSON.stringify(response.value));
    return response.value;
  }
  async function snapshot() {
    const response = await request("/api/agents");
    assert.equal(response.status, 200, JSON.stringify(response.value));
    return response.value;
  }
  async function until(id, statuses = ["ready"], milliseconds = 5000) {
    const deadline = Date.now() + milliseconds;
    let current;
    while (Date.now() < deadline) {
      current = await snapshot();
      const task = current.tasks.find((task) => task.id === id);
      if (task && statuses.includes(task.status))
        return { snapshot: current, task };
      if (task?.status === "failed") throw Error(task.error);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw Error(
      `Task did not reach ${statuses.join("/")}: ${JSON.stringify(current)}`,
    );
  }
  async function create(taskBrief = brief) {
    const id = crypto.randomUUID();
    await post({ action: "create", id, brief: taskBrief });
    return id;
  }
  async function workspace() {
    const response = await request("/api/workspace");
    assert.equal(response.status, 200, JSON.stringify(response.value));
    return response.value;
  }
  async function save(data, revision) {
    const response = await request("/api/workspace", "PUT", { data, revision });
    assert.equal(response.status, 200, JSON.stringify(response.value));
    return response.value;
  }
  return {
    dir,
    counts,
    request,
    post,
    snapshot,
    until,
    create,
    workspace,
    save,
    close,
    open,
  };
}

test("agent routes are Dev-only and reject cross-origin or extra command fields", async (t) => {
  const product = await fixture(t, { agentsEnabled: false });
  assert.deepEqual((await product.request("/api/features")).value, {
    agents: false,
  });
  assert.equal((await product.request("/api/agents")).status, 404);
  const dev = await fixture(t);
  assert.deepEqual((await dev.request("/api/features")).value, {
    agents: true,
  });
  const command = { action: "create", id: crypto.randomUUID(), brief };
  assert.equal(
    (
      await dev.request("/api/agents", "POST", command, {
        Origin: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await dev.request("/api/agents", "GET", undefined, {
        Origin: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  await dev.post({ ...command, grantAdmin: true }, 400);
  await dev.post({ ...command, brief: { ...brief, cadence: "daily" } }, 400);
  await dev.post({ ...command, brief: { ...brief, personalize: "true" } }, 400);
  assert.equal((await dev.snapshot()).tasks.length, 0);
});

test("a rejected task write rolls back memory and cannot run after another command", async (t) => {
  const f = await fixture(t);
  const blocker = path.join(f.dir, "agent-tasks.json.tmp");
  await mkdir(blocker);
  const rejectedId = crypto.randomUUID();
  const failure = await f.post(
    { action: "create", id: rejectedId, brief },
    503,
  );
  assert.match(failure.error, /could not be saved/);
  assert.equal((await f.snapshot()).tasks.length, 0);
  await assert.rejects(readFile(path.join(f.dir, "agent-tasks.json"), "utf8"), {
    code: "ENOENT",
  });
  await rmdir(blocker);
  const id = await f.create();
  await f.until(id);
  const tasks = (await f.snapshot()).tasks;
  assert.equal(tasks.length, 1);
  assert.equal(
    tasks.some((task) => task.id === rejectedId),
    false,
  );
  assert.equal(f.counts.generate, 1);
});

test("a worker checkpoint failure rolls back its update and pauses instead of retrying forever", async (t) => {
  let reads = 0;
  const f = await fixture(t, {
    agentDependencies: {
      readSource: async () => {
        if (++reads === 1)
          await mkdir(path.join(f.dir, "agent-tasks.json.tmp"));
        return source();
      },
    },
  });
  const id = await f.create();
  const paused = await f.until(id, ["failed"]);
  assert.match(paused.task.error, /could not be saved/);
  assert.equal(paused.snapshot.active, false);
  assert.equal(
    paused.task.events.some((event) => event.message.startsWith("Retrieved")),
    false,
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(
    reads,
    1,
    "storage failure cannot spin the worker or repeat research",
  );
  assert.equal(f.counts.generate, 0);
  const stored = JSON.parse(
    await readFile(path.join(f.dir, "agent-tasks.json"), "utf8"),
  );
  assert.equal(
    stored.tasks[0].status,
    "researching",
    "the failed stage never becomes durable",
  );
  await rmdir(path.join(f.dir, "agent-tasks.json.tmp"));
  await f.post({ action: "retry", id });
  await f.until(id);
  assert.equal(reads, 2);
  assert.equal(f.counts.generate, 1);
});

test("research produces a durable proposal without changing accepted study data or rescheduling itself", async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  const { task } = await f.until(id);
  assert.equal(task.proposal.units.length, 3);
  assert.equal(task.proposal.questions.length, 3);
  assert.match(task.proposalHash, /^[a-f0-9]{64}$/);
  assert.ok(
    task.proposal.units.every((unit) => unit.id.startsWith(`agent-${id}-`)),
  );
  assert.ok(task.events.some((event) => event.role === "Researcher"));
  assert.ok(task.events.some((event) => event.role === "Learning reviewer"));
  assert.equal((await f.workspace()).data.guide, null);
  assert.deepEqual(f.counts, { search: 2, read: 1, generate: 1, plan: 1 });
  await f.post({ action: "create", id, brief });
  await f.post(
    {
      action: "create",
      id,
      brief: { ...brief, goal: "Another learning goal for this subject." },
    },
    409,
  );
  assert.equal((await f.snapshot()).tasks.length, 1);
  await f.close();
  await f.open();
  const reopened = (await f.snapshot()).tasks[0];
  assert.equal(reopened.status, "ready");
  assert.equal(reopened.proposalHash, task.proposalHash);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(
    f.counts.generate,
    1,
    "reading/reopening a completed task must not create recurring jobs",
  );
});

test("context admission reserves the requested reasoning output before contacting the model", async (t) => {
  const f = await fixture(t, {
    agentDependencies: {
      generate: async (_sources, _model, _signal, fetcher) => {
        await fetcher("http://127.0.0.1:11434/api/chat", {
          method: "POST",
          body: JSON.stringify({
            messages: [{ role: "user", content: "x".repeat(9000) }],
            format: {},
            options: { num_predict: 7000 },
          }),
        });
        throw Error("Oversized reasoning request reached the model");
      },
    },
  });
  const id = await f.create();
  const { task } = await f.until(id, ["failed"]);
  assert.match(task.error, /context budget/);
  assert.equal(f.counts.plan, 1, "only research planning reaches inference");
  assert.equal((await f.workspace()).data.guide, null);
});

test("inference reserves repair room without truncating stored sources or source sentences", async (t) => {
  const original = source();
  original.passages[0].text = (text + " ").repeat(8).trim();
  original.passages.push({ ...original.passages[0], id: `${original.id}:2` });
  const f = await fixture(t, {
    agentDependencies: {
      readSource: async () => original,
      generate: async (selected) => {
        const total = selected[0].passages.reduce(
          (sum, passage) => sum + passage.text.length,
          0,
        );
        assert.ok(total <= 2400 && total > 2000);
        assert.equal(selected[0].passages.length, 2);
        for (const excerpt of selected[0].passages) {
          assert.ok(
            original.passages
              .find((p) => p.id === excerpt.id)
              .text.startsWith(excerpt.text),
          );
          assert.match(excerpt.text, /\.$/);
        }
        return {
          draft: guide([
            {
              ...selected[0],
              passages: [{ ...selected[0].passages[0], text }],
            },
          ]),
          reviewProblems: [],
        };
      },
    },
  });
  const { task } = await f.until(await f.create());
  assert.equal(task.sources[0].passages[0].text, original.passages[0].text);
  assert.ok(
    task.proposal.gaps.some((gap) => gap.includes("bounded selection")),
  );
});

test("research starts with the assigned topic and bounds expansion even if the planner skips it", async (t) => {
  const queries = [];
  const f = await fixture(t, {
    chat: () =>
      Response.json({
        done: true,
        message: {
          content: JSON.stringify({
            queries: ["Plant physiology", "Root uptake"],
          }),
        },
      }),
    agentDependencies: {
      search: async (query) => {
        queries.push(query);
        return [{ pageId: 123, title: "Plant physiology" }];
      },
    },
  });
  await f.until(await f.create());
  assert.deepEqual(queries, [brief.topic, `${brief.topic} Plant physiology`]);
});

test("the model-call cap remains actionable when it interrupts an evidence-review batch", async (t) => {
  const calls = { total: 0, author: 0, review: 0 };
  const authored = guide([source()]);
  const proposal = {
    title: authored.title,
    topics: authored.units.map((unit) => {
      const question = authored.questions.find((q) => q.unitId === unit.id);
      return {
        title: unit.title,
        question: unit.recallPrompt,
        answerEvidenceId: "E1",
        answerPhrase: unit.recallAnswer,
        distractors: question.options
          .filter((_, index) => index !== question.correctIndex)
          .map((option) => option.text),
        citations: [{ evidenceId: "E1" }],
      };
    }),
    gaps: [],
  };
  const f = await fixture(t, {
    agentDependencies: { generate: generateLocalDraft },
    chat: async (request) => {
      calls.total++;
      let value;
      if (request.format.properties.queries)
        value = { queries: ["Plant physiology"] };
      else if (request.format.properties.checks) {
        calls.review++;
        const items = JSON.parse(request.messages[1].content).items;
        value = {
          checks: approvedChecks(items).map((check) => ({
            ...check,
            verdict: "unsupported",
            reason: "This deterministic fixture requests a revision.",
          })),
        };
      } else {
        calls.author++;
        value = proposal;
      }
      return Response.json({
        done: true,
        message: { content: JSON.stringify(value) },
      });
    },
  });
  const id = await f.create();
  const result = await f.until(id, ["failed"]);
  assert.match(result.task.error, /12-call limit.*Narrow the goal/);
  assert.doesNotMatch(result.task.error, /review could not complete/);
  assert.deepEqual(calls, { total: 12, author: 3, review: 8 });
  assert.equal(result.task.proposal, null);
  assert.equal((await f.workspace()).data.guide, null);
});

test("acceptance checks exact proposal and revision and is idempotent", async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  const { snapshot, task } = await f.until(id);
  const approval = {
    action: "accept",
    id,
    proposalHash: task.proposalHash,
    revision: snapshot.revision,
  };
  await f.post({ ...approval, proposalHash: "0".repeat(64) }, 409);
  const old = await f.workspace();
  await f.save({ ...old.data, title: "A user change" }, old.revision);
  await f.post(approval, 409);
  const fresh = await f.snapshot();
  const accepted = await f.post({ ...approval, revision: fresh.revision });
  assert.equal(accepted.tasks[0].status, "accepted");
  const after = await f.workspace();
  assert.equal(after.data.guide.units.length, 3);
  assert.equal(after.data.guide.questions.length, 3);
  await f.post({ ...approval, revision: fresh.revision });
  assert.deepEqual(
    await f.workspace(),
    after,
    "duplicate approval cannot append or advance revision again",
  );
  await f.post({ ...approval, proposalHash: "f".repeat(64) }, 409);
  await f.post({ action: "cancel", id }, 400);
});

test("acceptance recovers after a post-save crash even when source passage IDs were deduplicated", async (t) => {
  const f = await fixture(t);
  const existing = source();
  const initial = emptyWorkspace();
  initial.sources = [existing];
  await f.save(initial, 0);
  const id = await f.create();
  const ready = await f.until(id);
  assert.notEqual(ready.task.sources[0].id, existing.id);
  const approval = {
    action: "accept",
    id,
    proposalHash: ready.task.proposalHash,
    revision: ready.snapshot.revision,
  };
  await f.post(approval);
  const accepted = await f.workspace();
  assert.equal(accepted.data.sources.length, 1);
  assert.equal(
    accepted.data.guide.questions[0].citations[0].passageId,
    existing.passages[0].id,
  );
  await f.close();
  const file = path.join(f.dir, "agent-tasks.json");
  const checkpoint = JSON.parse(await readFile(file, "utf8"));
  checkpoint.tasks[0].status = "ready";
  checkpoint.tasks[0].acceptedRevision = null;
  checkpoint.tasks[0].questionHashes = {};
  await writeFile(file, JSON.stringify(checkpoint));
  await f.open();
  const recovered = await f.post(approval);
  assert.equal(recovered.tasks[0].status, "accepted");
  assert.equal(Object.keys(recovered.tasks[0].questionHashes).length, 3);
  assert.deepEqual(
    await f.workspace(),
    accepted,
    "recovery recognizes the saved effect and does not append twice",
  );
});

test("failed task persistence after acceptance restores ready state and recovers the saved effect once", async (t) => {
  let commits = 0;
  const f = await fixture(t, {
    agentDependencies: {
      saveWorkspace: async (data, revision) => {
        const saved = await f.save(data, revision);
        commits++;
        await mkdir(path.join(f.dir, "agent-tasks.json.tmp"));
        return saved;
      },
    },
  });
  const id = await f.create();
  const ready = await f.until(id);
  const approval = {
    action: "accept",
    id,
    proposalHash: ready.task.proposalHash,
    revision: ready.snapshot.revision,
  };
  await f.post(approval, 503);
  const rolledBack = (await f.snapshot()).tasks[0];
  assert.equal(rolledBack.status, "ready");
  assert.equal(rolledBack.acceptedRevision, null);
  assert.deepEqual(rolledBack.questionHashes, {});
  const saved = await f.workspace();
  assert.equal(
    saved.data.guide.units.length,
    3,
    "workspace commit already succeeded",
  );
  await rmdir(path.join(f.dir, "agent-tasks.json.tmp"));
  const recovered = await f.post(approval);
  assert.equal(recovered.tasks[0].status, "accepted");
  assert.equal(
    commits,
    1,
    "receipt recovery must not write the workspace again",
  );
  assert.deepEqual(await f.workspace(), saved);
});

test("accepting generated additions preserves existing cards, quiz answers, and review schedules", async (t) => {
  const f = await fixture(t);
  const prior = parseStudyImport(
    JSON.stringify({
      format: "studystep",
      version: 1,
      title: "My material",
      topics: [
        {
          title: "Original concept",
          explanation: "The original explanation stays intact.",
          recallPrompt: "What is the original reference?",
          recallAnswer: "Original reference",
          questions: [
            {
              prompt: "Which answer is the original reference?",
              options: ["Original reference", "Another reference"],
              answer: 1,
              explanation: "This is the original reference.",
            },
          ],
        },
      ],
    }),
  ).data;
  prior.sources = [source()];
  prior.guideSourceKey = await sourceKey(prior.sources);
  prior.attempts = [
    {
      questionId: prior.guide.questions[0].id,
      selected: 0,
      hinted: false,
      revealed: false,
      at: "2026-10-29T10:00:00.000Z",
    },
  ];
  await f.save(prior, 0);
  const deck = (await f.request("/api/review")).value.deck;
  let review = (
    await f.request("/api/review", "POST", {
      type: "start",
      deckId: deck.id,
      id: crypto.randomUUID(),
      mode: "cards",
      ahead: false,
    })
  ).value;
  const cmd = { deckId: deck.id, id: review.state.session.id, index: 0 };
  await f.request("/api/review", "POST", { ...cmd, type: "reveal" });
  review = (
    await f.request("/api/review", "POST", {
      ...cmd,
      type: "rate",
      rating: "good",
    })
  ).value;
  const id = await f.create({ ...brief, sourceMode: "workspace" });
  const ready = await f.until(id);
  await f.post({
    action: "accept",
    id,
    proposalHash: ready.task.proposalHash,
    revision: ready.snapshot.revision,
  });
  const saved = (await f.workspace()).data;
  assert.deepEqual(saved.guide.units[0], prior.guide.units[0]);
  assert.deepEqual(saved.guide.questions[0], prior.guide.questions[0]);
  assert.deepEqual(saved.attempts, prior.attempts);
  assert.deepEqual(saved.sources, prior.sources);
  assert.equal(saved.guide.units.length, 4);
  const nextReview = (await f.request("/api/review")).value;
  assert.deepEqual(
    nextReview.state.progress[deck.cards[0].id],
    review.state.progress[deck.cards[0].id],
  );
  assert.equal(f.counts.search, 0, "workspace source mode must not browse");
});

test("accepted normalized options retain matching learning fingerprints", async (t) => {
  const f = await fixture(t, {
    agentDependencies: {
      generate: async (sources) => {
        const draft = guide(sources);
        for (const question of draft.questions)
          for (const option of question.options)
            option.text = `  ${option.text}  `;
        return { draft, reviewProblems: [] };
      },
    },
  });
  const id = await f.create();
  const ready = await f.until(id);
  await f.post({
    action: "accept",
    id,
    proposalHash: ready.task.proposalHash,
    revision: ready.snapshot.revision,
  });
  const current = await f.workspace();
  assert.ok(
    current.data.guide.questions.every((question) =>
      question.options.every((option) => option.text === option.text.trim()),
    ),
  );
  current.data.attempts = current.data.guide.questions.map((question) => ({
    questionId: question.id,
    selected: question.correctIndex,
    hinted: false,
    revealed: false,
    at: "2026-10-29T10:00:00.000Z",
  }));
  await f.save(current.data, current.revision);
  const task = (await f.snapshot()).tasks[0];
  assert.equal(task.progress.total, 3);
  assert.equal(task.progress.independentCorrect, 3);
  for (const question of current.data.guide.questions)
    assert.equal(
      task.questionHashes[question.id],
      questionFingerprint(question, current.data.sources),
    );
});

test("cancellation aborts active generation and retry is explicit", async (t) => {
  let aborted = false,
    started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  let runs = 0;
  const f = await fixture(t, {
    agentDependencies: {
      generate: async (sources, model, signal) => {
        if (++runs === 1) {
          started();
          return await new Promise((resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        }
        return { draft: guide(sources), reviewProblems: [] };
      },
    },
  });
  const id = await f.create();
  await entered;
  await f.post({ action: "cancel", id });
  await f.until(id, ["cancelled"]);
  for (let attempt = 0; attempt < 100 && (await f.snapshot()).active; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(aborted, true);
  assert.equal((await f.workspace()).data.guide, null);
  await f.close();
  await f.open();
  assert.equal((await f.snapshot()).tasks[0].status, "cancelled");
  assert.equal(runs, 1);
  await f.post({ action: "retry", id });
  await f.until(id);
  assert.equal(runs, 2);
});

test("interrupted persisted runs become actionable failures after restart", async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.until(id);
  await f.close();
  const file = path.join(f.dir, "agent-tasks.json");
  const stored = JSON.parse(await readFile(file, "utf8"));
  stored.tasks[0].status = "writing";
  stored.tasks[0].proposal = null;
  stored.tasks[0].proposalHash = "";
  await writeFile(file, JSON.stringify(stored));
  await f.open();
  const task = (await f.snapshot()).tasks[0];
  assert.equal(task.status, "failed");
  assert.match(task.error, /closed|Retry/);
  assert.equal(f.counts.generate, 1);
});

test("failed interrupted-run recovery reloads the durable checkpoint before retrying initialization", async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.until(id);
  await f.close();
  const file = path.join(f.dir, "agent-tasks.json");
  const checkpoint = JSON.parse(await readFile(file, "utf8"));
  checkpoint.tasks[0].status = "writing";
  checkpoint.tasks[0].proposal = null;
  checkpoint.tasks[0].proposalHash = "";
  await writeFile(file, JSON.stringify(checkpoint));
  const blocker = path.join(f.dir, "agent-tasks.json.tmp");
  await mkdir(blocker);
  await f.open();
  assert.equal((await f.request("/api/agents")).status, 503);
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).tasks[0].status,
    "writing",
  );
  await rmdir(blocker);
  assert.equal((await f.snapshot()).tasks[0].status, "failed");
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).tasks[0].status,
    "failed",
  );
});

test("fabricated source citations fail the task without replacing accepted content", async (t) => {
  const f = await fixture(t, {
    agentDependencies: {
      generate: async (sources) => {
        const draft = guide(sources);
        draft.units[0].citations[0].quote =
          "An unsupported assertion that does not occur in the source.";
        return { draft, reviewProblems: [] };
      },
    },
  });
  const before = await f.workspace();
  const id = await f.create();
  const failed = (await f.until(id, ["failed"])).task;
  assert.equal(failed.proposal, null);
  assert.equal(failed.proposalHash, "");
  assert.ok(failed.error.length);
  assert.deepEqual(await f.workspace(), before);
  await f.post(
    {
      action: "accept",
      id,
      proposalHash: "0".repeat(64),
      revision: before.revision,
    },
    409,
  );
});

test("next-step tasks retain the goal and require an explicit continuation", async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  const ready = await f.until(id);
  await f.post({
    action: "accept",
    id,
    proposalHash: ready.task.proposalHash,
    revision: ready.snapshot.revision,
  });
  let current = await f.workspace();
  current.data.attempts = current.data.guide.questions.map((q) => ({
    questionId: q.id,
    selected: q.correctIndex,
    hinted: false,
    revealed: false,
    at: "2026-10-29T10:00:00.000Z",
  }));
  await f.save(current.data, current.revision);
  const observed = await f.snapshot();
  assert.equal(observed.tasks[0].progress.independentCorrect, 3);
  assert.equal(
    observed.tasks[0].progress.level,
    "foundation",
    "one batch cannot establish readiness for automatic progression",
  );
  assert.equal(observed.tasks.length, 1);
  const newId = crypto.randomUUID();
  await f.post({ action: "continue", id, newId, level: "apply" });
  const next = (await f.until(newId)).task;
  assert.equal(next.rootId, id);
  assert.equal(next.parentId, id);
  assert.equal(next.brief.topic, brief.topic);
  assert.equal(next.brief.goal, brief.goal);
  assert.equal(next.brief.level, "apply");
  assert.match(next.adaptation, /explicit preference/);
});

function progressFixture() {
  const data = emptyWorkspace();
  data.sources = [source()];
  const one = guide(data.sources);
  const two = guide(data.sources, 1);
  two.units = two.units.map((u, i) => ({ ...u, id: `second-u-${i}` }));
  two.questions = two.questions.map((q, i) => ({
    ...q,
    id: `second-q-${i}`,
    unitId: two.units[i].id,
  }));
  data.guide = {
    ...one,
    units: [...one.units, ...two.units],
    questions: [...one.questions, ...two.questions],
  };
  const rootId = crypto.randomUUID();
  const tasks = [one, two].map((g, i) => ({
    id: i ? crypto.randomUUID() : rootId,
    rootId,
    status: "accepted",
    brief: { ...brief },
    questionHashes: Object.fromEntries(
      g.questions.map((q) => [q.id, questionFingerprint(q, data.sources)]),
    ),
  }));
  data.attempts = data.guide.questions.map((q) => ({
    questionId: q.id,
    selected: q.correctIndex,
    hinted: false,
    revealed: false,
    at: "2026-10-29T10:00:00.000Z",
  }));
  return { data, tasks };
}

test("author learning signals exclude stale evidence, unrelated tasks and disabled personalization", () => {
  const { data, tasks } = progressFixture();
  data.attempts[0].hinted = true;
  data.attempts[1].selected = (data.guide.questions[1].correctIndex + 1) % 3;
  const unrelated = { ...tasks[0], rootId: crypto.randomUUID() };
  const signals = learningSignals(tasks[0], [...tasks, unrelated], data);
  assert.equal(signals.length, 5);
  assert.deepEqual(
    signals.slice(0, 2).map((signal) => signal.outcome),
    ["assisted", "incorrect"],
  );
  assert.ok(
    signals.every(
      (signal) => Object.keys(signal).sort().join() === "outcome,question",
    ),
  );
  assert.deepEqual(
    learningSignals(
      { ...tasks[0], brief: { ...brief, personalize: false } },
      tasks,
      data,
    ),
    [],
  );
  data.guide.questions[0].prompt += " edited";
  assert.equal(learningSignals(tasks[0], tasks, data).length, 4);
  data.sources[0].fingerprint = "changed";
  assert.deepEqual(learningSignals(tasks[0], tasks, data), []);
});

test("adaptation counts distinct unaided answers across task batches, excluding unrelated topics", () => {
  const { data, tasks } = progressFixture();
  const unrelated = {
    ...tasks[0],
    rootId: crypto.randomUUID(),
    questionHashes: { ...tasks[0].questionHashes },
  };
  let progress = learningProgress(tasks[0], [...tasks, unrelated], data);
  assert.equal(progress.total, 5);
  assert.equal(progress.independentCorrect, 5);
  assert.equal(progress.level, "apply");
  data.attempts = data.attempts.slice(0, 2).concat(data.attempts.slice(3, 4));
  progress = learningProgress(tasks[0], tasks, data);
  assert.equal(progress.independentCorrect, 3);
  assert.equal(progress.level, "explain");
});

test("hinted, revealed, and incorrect answers do not advance inferred difficulty; personalization can be off", () => {
  const { data, tasks } = progressFixture();
  data.attempts[0].hinted = true;
  data.attempts[1].revealed = true;
  data.attempts[2].selected = (data.guide.questions[2].correctIndex + 1) % 3;
  let progress = learningProgress(tasks[0], tasks, data);
  assert.equal(progress.assisted, 2);
  assert.equal(progress.incorrect, 1);
  assert.equal(progress.independentCorrect, 2);
  assert.equal(progress.level, "foundation");
  progress = learningProgress(
    { ...tasks[0], brief: { ...brief, personalize: false, level: "explain" } },
    tasks,
    data,
  );
  assert.equal(progress.level, "explain");
  assert.match(progress.reason, /off/);
});

test("two later clean practice batches can recover from an earlier mistake without erasing its record", () => {
  const { data, tasks } = progressFixture();
  const original = data.guide.questions[0];
  const olderQuestion = { ...structuredClone(original), id: "older-question" };
  data.guide.questions.unshift(olderQuestion);
  data.attempts.unshift({
    questionId: olderQuestion.id,
    selected: (olderQuestion.correctIndex + 1) % olderQuestion.options.length,
    hinted: false,
    revealed: false,
    at: "2026-10-28T10:00:00.000Z",
  });
  tasks.unshift({
    ...tasks[0],
    id: crypto.randomUUID(),
    questionHashes: {
      [olderQuestion.id]: questionFingerprint(olderQuestion, data.sources),
    },
  });
  const progress = learningProgress(tasks[2], tasks, data);
  assert.equal(progress.incorrect, 1, "the earlier observation is retained");
  assert.equal(progress.independentCorrect, 5);
  assert.equal(
    progress.level,
    "apply",
    "later clean practice can support progression",
  );
});

test("accepting unpracticed batches does not age out recent assisted answers", () => {
  const { data, tasks } = progressFixture();
  data.attempts[0].hinted = true;
  for (let index = 0; index < 2; index++) {
    const question = {
      ...structuredClone(data.guide.questions[0]),
      id: `unpracticed-${index}`,
    };
    data.guide.questions.push(question);
    tasks.push({
      ...tasks[0],
      id: crypto.randomUUID(),
      questionHashes: {
        [question.id]: questionFingerprint(question, data.sources),
      },
    });
  }
  const progress = learningProgress(tasks.at(-1), tasks, data);
  assert.equal(progress.total, 7);
  assert.equal(progress.attempted, 5);
  assert.equal(progress.assisted, 1);
  assert.equal(progress.level, "foundation");
});

test("edited question or evidence invalidates its learning signal while unrelated new sources do not", () => {
  const { data, tasks } = progressFixture();
  data.sources.push({ ...source(), fingerprint: "unrelated" });
  assert.equal(learningProgress(tasks[0], tasks, data).total, 5);
  data.guide.questions[0].options[0].text += " changed";
  assert.equal(learningProgress(tasks[0], tasks, data).total, 4);
  data.sources[0].passages[0].text +=
    " A new qualification changes this evidence.";
  const progress = learningProgress(tasks[0], tasks, data);
  assert.equal(progress.total, 0);
  assert.equal(progress.attempted, 0);
  assert.equal(progress.readyForNext, false);
  const fresh = progressFixture();
  fresh.data.sources[0].fingerprint = "revised-source-v2";
  assert.equal(
    learningProgress(fresh.tasks[0], fresh.tasks, fresh.data).total,
    0,
  );
});
