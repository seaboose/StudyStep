// Explicitly opt in: STUDYSTEP_LIVE_ADAPTIVE=1 node tests/agents-live-adaptive.mjs
// Requires a current local build and a running, installed Ollama model. Uses real
// Wikipedia and local inference, with a new temporary profile for every run.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const normalize = (text) => text.replace(/\s+/g, " ").trim();
const promptKey = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const iso = () => new Date().toISOString();
const serializeError = (error) => ({
  name: error.name,
  message: error.message,
  stack: error.stack,
  ...(error.cause ? { cause: String(error.cause) } : {}),
});

async function main() {
  const startedAt = iso();
  const runId = `${startedAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const artifactDir = path.join(root, "artifacts", "agents", "evals", runId);
  await mkdir(artifactDir, { recursive: true });
  const summary = {
    runId,
    startedAt,
    status: "running",
    validationScope:
      "Live workflow and persistence invariants. Automated model review does not replace a separate audit of the accepted questions' educational quality.",
    topic: process.env.STUDYSTEP_LIVE_TOPIC || "Photosynthesis",
    goal:
      process.env.STUDYSTEP_LIVE_GOAL ||
      "Understand how plants use light, water and carbon dioxide to make sugars and release oxygen.",
    model: process.env.STUDYSTEP_LIVE_MODEL || "qwen3:8b",
    seed: null,
    maxBatches: 5,
    batches: [],
    modelCalls: 0,
    stages: [],
    checks: [],
    dataDir: null,
    artifactDir,
  };
  const event = async (type, value) =>
    appendFile(
      path.join(artifactDir, "events.jsonl"),
      JSON.stringify({ at: iso(), type, ...value }) + "\n",
    );
  const saveSummary = () =>
    writeFile(
      path.join(artifactDir, "summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
    );
  const check = async (name) => {
    summary.checks.push(name);
    await event("check", { name });
    await saveSummary();
  };
  let runtime;
  let failure;
  let activeId;
  let lastWorkspace;
  const lastTaskHashes = new Map();
  const observedStages = new Set();
  const modelCalls = [];
  const taskOutcomes = new Map();

  // Each request is journaled before inference, including an optional fixed seed.
  // This wrapper leaves research, generation, validation and review unmocked.
  async function tracedFetcher(url, init) {
    if (!String(url).endsWith("/api/chat")) return fetch(url, init);
    const request = JSON.parse(init.body);
    if (summary.seed !== null)
      request.options = { ...request.options, seed: summary.seed };
    const call = {
      index: modelCalls.length,
      taskId: activeId,
      startedAt: iso(),
      request,
    };
    modelCalls.push(call);
    summary.modelCalls = modelCalls.length;
    const began = Date.now();
    await appendFile(
      path.join(artifactDir, "model-trace.jsonl"),
      JSON.stringify({ phase: "request", ...call }) + "\n",
    );
    try {
      const response = await fetch(url, {
        ...init,
        body: JSON.stringify(request),
      });
      call.status = response.status;
      const responseText = await response.clone().text();
      try {
        call.response = JSON.parse(responseText);
      } catch (error) {
        call.responseText = responseText;
        call.responseParseError = serializeError(error);
      }
      return response;
    } catch (error) {
      call.error = serializeError(error);
      throw error;
    } finally {
      call.finishedAt = iso();
      call.elapsedMs = Date.now() - began;
      await appendFile(
        path.join(artifactDir, "model-trace.jsonl"),
        JSON.stringify({ phase: "response", ...call }) + "\n",
      );
    }
  }

  async function request(
    route,
    body,
    method = body === undefined ? "GET" : "POST",
  ) {
    const response = await fetch(runtime.url + route, {
      method,
      headers: { Origin: runtime.url, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const value = await response.json();
    if (!response.ok) {
      await event("http-error", {
        route,
        method,
        status: response.status,
        value,
      });
      throw Error(
        `${method} ${route}: ${response.status} ${value.error || JSON.stringify(value)}`,
      );
    }
    return value;
  }

  async function snapshot() {
    const state = await request("/api/agents");
    for (const task of state.tasks) {
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(task))
        .digest("hex");
      if (lastTaskHashes.get(task.id) === fingerprint) continue;
      lastTaskHashes.set(task.id, fingerprint);
      taskOutcomes.set(task.id, task);
      await appendFile(
        path.join(artifactDir, "public-tasks.jsonl"),
        JSON.stringify({ at: iso(), revision: state.revision, task }) + "\n",
      );
      const stage = `${task.id}:${task.status}:${task.events.at(-1)?.message || ""}`;
      if (!observedStages.has(stage)) {
        observedStages.add(stage);
        const entry = {
          at: iso(),
          taskId: task.id,
          level: task.brief.level,
          status: task.status,
          message: task.events.at(-1)?.message || "",
        };
        summary.stages.push(entry);
        console.log(`[${task.brief.level}] ${task.status}: ${entry.message}`);
      }
    }
    await saveSummary();
    return state;
  }

  async function workspace() {
    lastWorkspace = await request("/api/workspace");
    return lastWorkspace;
  }

  async function unchangedWorkspace(before, label) {
    const current = await workspace();
    assert.equal(
      current.revision,
      before.revision,
      `${label}: workspace revision changed`,
    );
    assert.deepEqual(current.data, before.data, `${label}: study data changed`);
    return current;
  }

  async function finish(id, baseline) {
    const deadline = Date.now() + 11 * 60_000;
    while (Date.now() < deadline) {
      const state = await snapshot();
      const task = state.tasks.find((item) => item.id === id);
      assert.ok(task, "The created task must remain visible in the public API");
      await unchangedWorkspace(baseline, `Task ${id} before approval`);
      if (["ready", "failed", "cancelled"].includes(task.status)) {
        assert.equal(
          task.status,
          "ready",
          task.error || `Task ended as ${task.status}`,
        );
        return { state, task };
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw Error(`Task ${id} did not finish within 11 minutes`);
  }

  function assertPreserved(before, after, changedAttemptIds = new Set()) {
    for (const source of before.sources)
      assert.deepEqual(
        after.sources.find((item) => item.id === source.id),
        source,
        "Existing source changed",
      );
    for (const kind of ["units", "questions"])
      for (const item of before.guide?.[kind] || [])
        assert.deepEqual(
          after.guide?.[kind].find((saved) => saved.id === item.id),
          item,
          `Existing ${kind} changed`,
        );
    for (const attempt of before.attempts)
      if (!changedAttemptIds.has(attempt.questionId))
        assert.deepEqual(
          after.attempts.find(
            (saved) => saved.questionId === attempt.questionId,
          ),
          attempt,
          "An earlier quiz attempt changed",
        );
    for (const id of before.studied)
      assert.ok(after.studied.includes(id), "Studied-card progress was lost");
    for (const id of before.hintUsed)
      assert.ok(after.hintUsed.includes(id), "Earlier hint history was lost");
  }

  function assertMaterial(data) {
    const units = data.guide.units;
    const questions = data.guide.questions;
    assert.equal(
      new Set(units.map((item) => item.id)).size,
      units.length,
      "Card IDs must be unique",
    );
    assert.equal(
      new Set(questions.map((item) => item.id)).size,
      questions.length,
      "Quiz IDs must be unique",
    );
    assert.equal(
      new Set(units.map((item) => promptKey(item.recallPrompt))).size,
      units.length,
      "Cards must ask new questions",
    );
    assert.equal(
      new Set(questions.map((item) => promptKey(item.prompt))).size,
      questions.length,
      "Quiz questions must be distinct across batches",
    );
    const passages = new Map(
      data.sources.flatMap((source) =>
        source.passages.map((passage) => [passage.id, passage.text]),
      ),
    );
    for (const item of [...units, ...questions]) {
      assert.ok(item.citations.length > 0, `${item.id} needs stored citations`);
      for (const citation of item.citations) {
        assert.ok(
          passages.has(citation.passageId),
          "Citation must resolve to a saved source passage",
        );
        assert.ok(
          normalize(citation.quote).length > 0,
          "Citation quote must not be empty",
        );
        assert.ok(
          normalize(passages.get(citation.passageId)).includes(
            normalize(citation.quote),
          ),
          "Stored quote must match its source snapshot",
        );
      }
    }
  }

  async function acceptReady(task, state, baseline) {
    assert.ok(
      task.proposal.units.length > 0 && task.proposal.questions.length > 0,
    );
    assert.ok(task.sources.length > 0);
    assert.ok(
      task.sources.every((source) =>
        source.originUrl?.startsWith("https://en.wikipedia.org/"),
      ),
      "Live research must save actual Wikipedia sources",
    );
    assert.equal(task.proposalHash.length, 64);
    assert.equal(state.revision, baseline.revision);
    const approval = {
      action: "accept",
      id: task.id,
      proposalHash: task.proposalHash,
      revision: state.revision,
    };
    await event("explicit-approval", { command: approval });
    await request("/api/agents", approval);
    const saved = await workspace();
    assert.equal(
      saved.revision,
      baseline.revision + 1,
      "Approval must save exactly once",
    );
    assertPreserved(baseline.data, saved.data);
    assertMaterial(saved.data);
    assert.equal(
      saved.data.guide.units.length,
      (baseline.data.guide?.units.length || 0) + task.proposal.units.length,
    );
    assert.equal(
      saved.data.guide.questions.length,
      (baseline.data.guide?.questions.length || 0) +
        task.proposal.questions.length,
    );
    for (const item of task.proposal.questions)
      assert.ok(
        saved.data.guide.questions.some((question) => question.id === item.id),
        "Approved question was not stored",
      );
    // Deliberately reuse the exact old revision as well as the original hash.
    await request("/api/agents", approval);
    await unchangedWorkspace(saved, "Idempotent approval");
    const accepted = (await snapshot()).tasks.find(
      (item) => item.id === task.id,
    );
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.proposalHash, approval.proposalHash);
    await check(
      `${task.brief.level}: explicit approval, idempotency, unique cited material and preserved progress`,
    );
    return accepted;
  }

  async function recordAnswers(task, answers, label) {
    const before = await workspace();
    const data = structuredClone(before.data);
    const changed = new Set(answers.map((answer) => answer.questionId));
    for (const answer of answers) {
      const question = data.guide.questions.find(
        (item) => item.id === answer.questionId,
      );
      assert.ok(
        question,
        "Cannot answer a question absent from the approved workspace",
      );
      const attempt = {
        questionId: question.id,
        selected: answer.correct
          ? question.correctIndex
          : (question.correctIndex + 1) % question.options.length,
        hinted: answer.hinted || false,
        revealed: false,
        at: iso(),
      };
      data.attempts = data.attempts.filter(
        (old) => old.questionId !== question.id,
      );
      data.attempts.push(attempt);
      if (!data.studied.includes(question.unitId))
        data.studied.push(question.unitId);
      if (attempt.hinted && !data.hintUsed.includes(question.id))
        data.hintUsed.push(question.id);
    }
    await request("/api/workspace", { data, revision: before.revision }, "PUT");
    const saved = await workspace();
    assert.equal(saved.revision, before.revision + 1);
    assert.deepEqual(
      saved.data.attempts,
      data.attempts,
      "The API must persist the exact quiz results",
    );
    assertPreserved(before.data, saved.data, changed);
    const progress = (await snapshot()).tasks.find(
      (item) => item.id === task.id,
    ).progress;
    await event("quiz-results", {
      label,
      taskId: task.id,
      answers,
      progress,
      revision: saved.revision,
    });
    return progress;
  }

  try {
    const seedText = process.env.STUDYSTEP_LIVE_SEED;
    if (seedText !== undefined) {
      assert.match(
        seedText,
        /^\d+$/,
        "STUDYSTEP_LIVE_SEED must be a nonnegative integer",
      );
      summary.seed = Number(seedText);
      assert.ok(
        Number.isSafeInteger(summary.seed),
        "STUDYSTEP_LIVE_SEED must be a safe integer",
      );
    }
    summary.dataDir = await mkdtemp(
      path.join(tmpdir(), "studystep-adaptive-live-"),
    );
    await saveSummary();
    console.log(`Live adaptive artifacts: ${artifactDir}`);
    const { createLocalServer } = await import("../scripts/local-server.mjs");
    runtime = await createLocalServer({
      dataDir: summary.dataDir,
      port: 0,
      agentsEnabled: true,
      agentDependencies: { fetcher: tracedFetcher },
    });
    await request("/api/local-model", { model: summary.model }, "PUT");
    const initial = await workspace();
    assert.equal(
      initial.data.guide,
      null,
      "The test must start in a fresh profile",
    );
    assert.equal(initial.data.attempts.length, 0);

    let parent;
    let rootId;
    let correctCount = 0;
    let explained = false;
    let applied = false;
    for (let batch = 1; batch <= summary.maxBatches; batch++) {
      const baseline = await workspace();
      const expectedLevel = parent ? parent.progress.level : "foundation";
      const id = randomUUID();
      activeId = id;
      rootId ||= id;
      const batchStart = Date.now();
      const callStart = modelCalls.length;
      const command = parent
        ? { action: "continue", id: parent.id, newId: id, level: "auto" }
        : {
            action: "create",
            id,
            brief: {
              topic: summary.topic,
              goal: summary.goal,
              level: "foundation",
              sourceMode: "research",
              personalize: true,
            },
          };
      await event("task-command", { command, expectedLevel });
      await request("/api/agents", command);
      const created = (await snapshot()).tasks.find((task) => task.id === id);
      assert.equal(
        created.brief.level,
        expectedLevel,
        "Auto continuation must use the observed progress level",
      );
      assert.equal(created.brief.topic, summary.topic);
      assert.equal(created.brief.goal, summary.goal);
      assert.equal(created.rootId, rootId);
      assert.equal(created.parentId, parent?.id || null);
      if (parent) assert.equal(created.adaptation, parent.progress.reason);
      const result = await finish(id, baseline);
      assert.equal(result.task.brief.level, expectedLevel);
      parent = await acceptReady(result.task, result.state, baseline);
      explained ||= expectedLevel === "explain";
      applied ||= expectedLevel === "apply";
      const batchResult = {
        number: batch,
        taskId: id,
        level: expectedLevel,
        elapsedMs: Date.now() - batchStart,
        modelCalls: modelCalls.length - callStart,
        sources: result.task.sources.length,
        cards: result.task.proposal.units.length,
        questions: result.task.proposal.questions.length,
      };
      summary.batches.push(batchResult);
      await saveSummary();
      if (applied) break;

      // Cap the first batch at two correct, later foundation work at four total.
      // Only an accepted explanation batch can take the score to five.
      const target = batch === 1 ? 2 : explained ? 5 : 4;
      const current = await workspace();
      const attempted = new Set(
        current.data.attempts.map((attempt) => attempt.questionId),
      );
      const newQuestions = current.data.guide.questions.filter(
        (question) =>
          Object.hasOwn(parent.questionHashes, question.id) &&
          !attempted.has(question.id),
      );
      const selected = newQuestions.slice(
        0,
        Math.max(0, target - correctCount),
      );
      assert.ok(
        selected.length > 0,
        "The next batch must contribute a new independent quiz result",
      );
      const progress = await recordAnswers(
        parent,
        selected.map((question) => ({
          questionId: question.id,
          correct: true,
        })),
        "unaided-correct",
      );
      correctCount += selected.length;
      assert.equal(progress.independentCorrect, correctCount);
      assert.equal(progress.assisted, 0);
      assert.equal(progress.incorrect, 0);
      const expectedProgress =
        correctCount >= 5
          ? "apply"
          : batch >= 2 && correctCount >= 3
            ? "explain"
            : "foundation";
      assert.equal(
        progress.level,
        expectedProgress,
        "Actual persisted quiz results must drive the next level",
      );
      parent.progress = progress;
      batchResult.progressAfterPractice = progress;
      await check(
        `${expectedLevel}: ${correctCount} saved unaided correct answers recommend ${expectedProgress}`,
      );
    }
    assert.ok(
      explained,
      "No automatically selected explanation batch completed within five batches",
    );
    assert.ok(
      applied,
      "No automatically selected application batch completed within five batches",
    );

    const appliedQuestions = (await workspace()).data.guide.questions.filter(
      (question) => Object.hasOwn(parent.questionHashes, question.id),
    );
    const wrong = await recordAnswers(
      parent,
      [{ questionId: appliedQuestions[0].id, correct: false }],
      "incorrect-application",
    );
    assert.equal(wrong.independentCorrect, correctCount);
    assert.equal(wrong.incorrect, 1);
    assert.equal(
      wrong.level,
      "foundation",
      "A recent wrong answer must recommend reinforcement",
    );
    // With a one-question proposal this is a second attempt on the same question;
    // otherwise preserve the wrong answer and use a separate hinted response.
    const hintedQuestion = appliedQuestions[1] || appliedQuestions[0];
    const hinted = await recordAnswers(
      parent,
      [{ questionId: hintedQuestion.id, correct: true, hinted: true }],
      "hinted-application",
    );
    assert.equal(
      hinted.independentCorrect,
      correctCount,
      "A hinted correct answer must not count as independent success",
    );
    assert.equal(hinted.assisted, 1);
    assert.equal(hinted.level, "foundation");
    await check(
      "Recent wrong and hinted answers independently recommend foundation without erasing earlier progress",
    );

    // Verify the actual auto-generated brief, then cancel immediately. This is a
    // bounded test of the transition, not another unbounded research cycle.
    const baseline = await workspace();
    const reinforcementId = randomUUID();
    activeId = reinforcementId;
    await request("/api/agents", {
      action: "continue",
      id: parent.id,
      newId: reinforcementId,
      level: "auto",
    });
    const reinforcement = (await snapshot()).tasks.find(
      (task) => task.id === reinforcementId,
    );
    assert.equal(reinforcement.brief.level, "foundation");
    assert.equal(reinforcement.adaptation, hinted.reason);
    await request("/api/agents", { action: "cancel", id: reinforcementId });
    const cancelled = (await snapshot()).tasks.find(
      (task) => task.id === reinforcementId,
    );
    assert.equal(cancelled.status, "cancelled");
    await unchangedWorkspace(baseline, "Cancelled reinforcement");
    await check(
      "Automatic reinforcement creates a foundation task and cancellation preserves the study set",
    );
    const final = await workspace();
    assertMaterial(final.data);
    summary.counts = {
      acceptedBatches: summary.batches.length,
      sources: final.data.sources.length,
      cards: final.data.guide.units.length,
      questions: final.data.guide.questions.length,
      savedAttempts: final.data.attempts.length,
      independentCorrect: hinted.independentCorrect,
      incorrect: hinted.incorrect,
      assisted: hinted.assisted,
    };
    summary.levels = summary.batches.map((batch) => batch.level);
    summary.status = "passed";
  } catch (error) {
    failure = error;
    summary.status = "failed";
    summary.error = serializeError(error);
    await event("failure", { error: summary.error });
  } finally {
    if (runtime) {
      // Capture failure state before shutdown, and expose cleanup errors too.
      try {
        await snapshot();
        await workspace();
      } catch (error) {
        summary.captureError = serializeError(error);
        failure ||= error;
      }
      try {
        await runtime.close();
      } catch (error) {
        summary.cleanupError = serializeError(error);
        failure ||= error;
      }
    }
    if (failure) summary.status = "failed";
    summary.finishedAt = iso();
    summary.elapsedMs = Date.now() - Date.parse(startedAt);
    summary.modelCalls = modelCalls.length;
    summary.levels = summary.batches.map((batch) => batch.level);
    summary.tokens = modelCalls.reduce(
      (counts, call) => ({
        input: counts.input + (call.response?.prompt_eval_count || 0),
        output: counts.output + (call.response?.eval_count || 0),
      }),
      { input: 0, output: 0 },
    );
    if (!summary.counts && lastWorkspace)
      summary.counts = {
        acceptedBatches: summary.batches.length,
        sources: lastWorkspace.data.sources.length,
        cards: lastWorkspace.data.guide?.units.length || 0,
        questions: lastWorkspace.data.guide?.questions.length || 0,
        savedAttempts: lastWorkspace.data.attempts.length,
      };
    await writeFile(
      path.join(artifactDir, "model-trace.json"),
      JSON.stringify(modelCalls, null, 2) + "\n",
    );
    await writeFile(
      path.join(artifactDir, "public-tasks.json"),
      JSON.stringify([...taskOutcomes.values()], null, 2) + "\n",
    );
    if (lastWorkspace)
      await writeFile(
        path.join(artifactDir, "workspace.json"),
        JSON.stringify(lastWorkspace, null, 2) + "\n",
      );
    await saveSummary();
  }
  console.log(
    `${summary.status.toUpperCase()}: ${summary.batches.length} accepted batches; ${summary.modelCalls} model calls; ${(summary.elapsedMs / 1000).toFixed(1)} seconds. ${artifactDir}`,
  );
  if (failure) throw failure;
}

if (process.env.STUDYSTEP_LIVE_ADAPTIVE === "1") await main();
else
  console.log(
    "Skipped live adaptive evaluation. Set STUDYSTEP_LIVE_ADAPTIVE=1 to use real Wikipedia and the installed local model.",
  );
