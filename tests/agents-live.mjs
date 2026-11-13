// Opt-in live integration check. Uses real Wikipedia and the installed local model;
// all task/workspace writes go to a disposable profile, never the user's study data.
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createLocalServer } from "../scripts/local-server.mjs";

const dataDir = await mkdtemp(path.join(tmpdir(), "studystep-agents-live-"));
// Public-topic test diagnostics only; the application does not record raw model prompts.
const modelCalls = [];
const runtime = await createLocalServer({
  dataDir,
  port: 0,
  agentsEnabled: true,
  agentDependencies: {
    fetcher: async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).endsWith("/api/chat"))
        modelCalls.push({
          request: JSON.parse(init.body),
          response: await response.clone().json(),
        });
      return response;
    },
  },
});
const headers = { Origin: runtime.url, "Content-Type": "application/json" };
async function request(route, body, method = "POST") {
  const response = await fetch(
    runtime.url + route,
    body ? { method, headers, body: JSON.stringify(body) } : undefined,
  );
  const value = await response.json();
  if (!response.ok) throw Error(value.error);
  return value;
}
async function finish(id) {
  const deadline = Date.now() + 11 * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const state = await request("/api/agents");
    const task = state.tasks.find((t) => t.id === id);
    const stage = task.status + ":" + (task.events.at(-1)?.message || "");
    if (stage !== last) {
      console.log(stage);
      last = stage;
    }
    if (["ready", "failed", "cancelled"].includes(task.status))
      return { state, task };
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw Error("Live task did not finish within its deadline.");
}
try {
  await request(
    "/api/local-model",
    { model: process.env.STUDYSTEP_LIVE_MODEL || "qwen3:4b" },
    "PUT",
  );
  const id = randomUUID();
  await request("/api/agents", {
    action: "create",
    id,
    brief: {
      topic: "Photosynthesis",
      goal: "Understand how plants use light, water and carbon dioxide to make sugars and release oxygen.",
      level: "foundation",
      sourceMode: "research",
      personalize: true,
    },
  });
  const { state, task } = await finish(id);
  await mkdir("artifacts/agents", { recursive: true });
  await writeFile(
    "artifacts/agents/live-result.json",
    JSON.stringify({ dataDir, task }, null, 2),
  );
  assert.equal(task.status, "ready", task.error);
  assert.ok(task.proposal.units.length > 0);
  assert.ok(
    task.sources.every((s) =>
      s.originUrl?.startsWith("https://en.wikipedia.org/"),
    ),
  );
  const accepted = await request("/api/agents", {
    action: "accept",
    id,
    proposalHash: task.proposalHash,
    revision: state.revision,
  });
  const workspace = await request("/api/workspace");
  assert.equal(workspace.data.guide.units.length, task.proposal.units.length);
  await request("/api/agents", {
    action: "accept",
    id,
    proposalHash: task.proposalHash,
    revision: state.revision,
  });
  assert.equal(
    (await request("/api/workspace")).revision,
    workspace.revision,
    "Duplicate acceptance must not save twice",
  );
  workspace.data.attempts = workspace.data.guide.questions.map((q) => ({
    questionId: q.id,
    selected: q.correctIndex,
    hinted: false,
    revealed: false,
    at: new Date().toISOString(),
  }));
  await request(
    "/api/workspace",
    { data: workspace.data, revision: workspace.revision },
    "PUT",
  );
  const progress = (await request("/api/agents")).tasks.find(
    (t) => t.id === id,
  ).progress;
  assert.equal(progress.independentCorrect, task.proposal.questions.length);
  console.log(
    `LIVE PASSED: ${task.sources.length} sources, ${task.proposal.units.length} cards, ${task.proposal.questions.length} quiz questions, exact approval, duplicate acceptance, progress attribution. ${progress.reason}`,
  );
  if (process.env.STUDYSTEP_LIVE_NEXT === "1") {
    const nextId = randomUUID();
    await request("/api/agents", {
      action: "continue",
      id,
      newId: nextId,
      level: "explain",
    });
    const next = await finish(nextId);
    await writeFile(
      "artifacts/agents/live-next-result.json",
      JSON.stringify(next.task, null, 2),
    );
    assert.equal(next.task.status, "ready", next.task.error);
    assert.equal(next.task.brief.level, "explain");
    assert.ok(next.task.adaptation.includes("You chose explain"));
    console.log(
      "LIVE NEXT STEP PASSED: distinct reviewed material at requested explanation level.",
    );
  }
} finally {
  await mkdir("artifacts/agents", { recursive: true });
  await writeFile(
    "artifacts/agents/live-model-trace.json",
    JSON.stringify(modelCalls, null, 2),
  );
  await runtime.close();
}
