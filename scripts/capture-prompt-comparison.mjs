import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { generateAdvancedDraft, transferInstructions } from "./advanced-generation.mjs";
import { createAgentStore } from "./agent-workflow.mjs";

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const root = path.resolve("artifacts/prompt-comparison", new Date().toISOString().replace(/:/g, "-"));
mkdirSync(root, { recursive: true });
console.log(root);
const plan = read(process.argv[2] ?? "examples/prompt-comparison/plan.json");
assert.equal(plan.prompts.baseline, transferInstructions);
const base = "http://127.0.0.1:11434";
const metadata = async (route) => {
  const res = await fetch(base + route, { redirect: "error", signal: AbortSignal.timeout(5000) });
  assert.ok(res.ok);
  return res.json();
};
const installed = (await metadata("/api/tags")).models.find(m => m.name === plan.settings.model);
assert.match(installed.digest, /^[a-f0-9]{64}$/);
plan.settings.model_version = installed.digest;
save(path.join(root, "runtime.json"), { installed, ollama: await metadata("/api/version") });
const planPath = path.join(root, "plan.json");
save(planPath, plan);
const bundle = JSON.parse(execFileSync("python", ["-B", "scripts/run_scorecard.py", "--prepare", planPath]));
const bundlePath = path.join(root, "bundle.json");
save(bundlePath, bundle);

async function run(item, arm) {
  const dir = path.join(root, item.id, arm);
  mkdirSync(dir, { recursive: true });
  const record = bundle.records[item.id][arm];
  const calls = [];
  const source = {
    id: "4db57c37-d1a1-44c5-9ccc-bbd29559c594", name: item.id, type: "notes", role: "material",
    passages: [{ id: item.id, label: item.id, text: item.passage }], warnings: [], pageCount: 0,
    addedAt: "2026-11-13T00:00:00.000Z", fingerprint: createHash("sha256").update(item.passage).digest("hex"),
  };
  const data = { sources: [source], selectedPassageIds: [item.id], attempts: [],
    guide: { units: item.previous_questions.map(recallPrompt => ({ recallPrompt })), questions: [] } };
  const fetcher = async (url, init) => {
    assert.equal(new URL(url).origin, base);
    if (new URL(url).pathname === "/api/show") return fetch(url, init);
    assert.equal(new URL(url).pathname, "/api/chat");
    const request = JSON.parse(init.body);
    request.options.seed = plan.settings.seed;
    const call = { number: calls.length + 1, started: new Date().toISOString(), request };
    calls.push(call);
    const file = path.join(dir, "call-" + call.number + ".json");
    save(file, call);
    console.log(item.id, arm, "call", call.number);
    try {
      const response = await fetch(url, { ...init, body: JSON.stringify(request) });
      call.http_status = response.status;
      call.output = await response.text();
      return new Response(call.output, { status: response.status, headers: response.headers });
    } catch (error) {
      call.error = String(error);
      throw error;
    } finally {
      call.ended = new Date().toISOString();
      save(file, call);
    }
  };
  const store = createAgentStore({
    dataDir: dir, fetcher, loadWorkspace: async () => ({ revision: 0, data }),
    modelState: async () => ({ ready: true, model: plan.settings.model }),
    generate: (sources, model, signal, transport, stage, options) => {
      assert.deepEqual(sources.flatMap(s => s.passages.map(p => p.id)), [item.id]);
      assert.deepEqual(options.task.previousQuestions, item.previous_questions);
      // Pin the entire selected passage. Normal interactive ranking can shorten it.
      return generateAdvancedDraft(data.sources, model, signal, transport, stage, { ...options,
        comparison: { prompt: plan.prompts[arm], onDraft(q, index) {
          record.drafts.push({ writer_attempt: index + 1, question: q.prompt,
            options: q.options.map(o => o.text), answer: q.options[q.correctIndex].text,
            citation: q.citations.map(c => c.quote).join("\n") });
          save(path.join(dir, "drafts.json"), record.drafts);
        } }
      });
    }
  });
  const id = randomUUID();
  try {
    await store.command({ action: "create", id, brief: { topic: item.id.replaceAll("-", " "),
      goal: item.goal, level: item.level, sourceMode: plan.settings.source_mode, personalize: plan.settings.personalize } });
    let task;
    do {
      await delay(400);
      task = (await store.get()).tasks.find(t => t.id === id);
    } while (["queued", "researching", "writing", "reviewing"].includes(task.status));
    save(path.join(dir, "outcome.json"), task);
    record.status = task.status === "ready" ? "proposed" : "failed";
    record.note = task.error || "Proposal saved for human review.";
  } finally {
    await store.close();
  }
  record.calls = calls.length;
  record.transfer_calls = calls.filter(c => c.request.messages[0].content.startsWith(plan.prompts[arm] + "\n")).length;
  save(bundlePath, bundle);
  console.log(item.id, arm, record.status, record.calls, record.transfer_calls, record.note);
}

// Counterbalance execution order across passages.
for (const [index, item] of plan.cases.entries()) {
  for (const arm of index % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) await run(item, arm);
}
save(path.join(root, "scorecard.json"), JSON.parse(execFileSync("python", ["-B", "scripts/run_scorecard.py", "--paired", bundlePath])));
