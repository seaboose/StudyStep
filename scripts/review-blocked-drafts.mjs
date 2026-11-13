// Run matched supplemental reviews when either arm stopped before focused review.
// Restore the writer's text into its normal display scaffold for human scoring.
// A focused probe never changes the recorded workflow outcome or triggers repair.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { requestStructured } from "../.runtime/local-server/generate.mjs";
import { formatAdvancedQuestion, transferSchema } from "./advanced-generation.mjs";
import { assembleDraft } from "./generation-quality.mjs";
import { localResponseAdapter } from "./local-model.mjs";

const root = path.resolve(process.argv[2]);
const read = file => JSON.parse(readFileSync(file, "utf8"));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const bundle = read(path.join(root, "bundle.json"));
const { settings, prompts } = bundle.plan;
const base = "http://127.0.0.1:11434";
const tags = await (await fetch(base + "/api/tags")).json();
assert.equal(tags.models.find(m => m.name === settings.model)?.digest, settings.model_version);
const supplemental = path.join(root, "supplement");
mkdirSync(supplemental, { recursive: true });
for (const item of bundle.plan.cases) {
  const pair = bundle.records[item.id];
  if (!Object.values(pair).some(a => a.status === "failed" && a.transfer_calls === 0)) continue;
  let fixedInput;
  for (const [arm, attempt] of Object.entries(pair)) {
    const dir = path.join(root, item.id, arm);
    const needsReconstruction = !attempt.drafts.length;
    for (let i = 1; needsReconstruction && i <= attempt.calls; i++) {
      const call = read(path.join(dir, "call-" + i + ".json"));
      const input = JSON.parse(call.request.messages[1].content);
      if (!input.candidate) continue;
      const raw = JSON.parse(JSON.parse(call.output).message.content);
      const statement = item.level === "explain" ? raw.observation : raw.misconception;
      const question = formatAdvancedQuestion(item.level, statement.replace(/[.!?]+$/u, "").trim());
      const { answer, evidence } = input.candidate;
      assert.deepEqual(evidence, [item.passage]);
      const generated = assembleDraft({ title: item.id, topics: [{ title: item.id, question, answer,
        distractors: raw.distractors, citations: [{ evidenceId: "E1" }] }], gaps: [] },
        new Map([["E1", { passageId: item.id, quote: evidence[0] }]]));
      attempt.drafts.push({ writer_attempt: attempt.drafts.length + 1, question, answer,
        options: generated.questions[0].options.map(o => o.text), citation: evidence[0],
        provenance: "Display scaffold reconstructed from rejected writer output and its fixed answer.",
        source_call: i });
    }
    assert.ok(attempt.drafts.length && attempt.drafts[0].writer_attempt === 1);
    const initial = attempt.drafts[0];
    const input = { level: item.level, question: initial.question, answer: initial.answer,
      evidence: [initial.citation], previousQuestions: item.previous_questions };
    // Use the baseline initial draft for both probes, even if local sampling differed.
    if (arm === "baseline") fixedInput = input;
  }
  for (const [arm, attempt] of Object.entries(pair)) {
    assert.ok(attempt.calls + 1 <= settings.call_limit);
    const signal = AbortSignal.timeout(settings.deadline_seconds * 1000);
    const ledger = { kind: "supplemental focused review of matched initial writer output", started: new Date().toISOString() };
    const file = path.join(supplemental, item.id + "-" + arm + ".json");
    const transport = async (url, init) => {
      assert.equal(url, base + "/api/chat");
      const request = JSON.parse(init.body);
      request.options.seed = settings.seed;
      ledger.request = request;
      save(file, ledger);
      const response = await fetch(url, { ...init, body: JSON.stringify(request) });
      ledger.http_status = response.status;
      ledger.output = await response.text();
      return new Response(ledger.output, { status: response.status });
    };
    try {
      ledger.assessment = await requestStructured(settings.model, prompts[arm], JSON.stringify(fixedInput),
        transferSchema, "advanced_transfer", localResponseAdapter(settings.model, signal, transport));
    } finally {
      ledger.ended = new Date().toISOString();
      save(file, ledger);
    }
    attempt.supplemental_calls = 1;
    attempt.workflow_calls = attempt.calls;
    attempt.calls++;
  }
}
save(path.join(root, "review-bundle.json"), bundle);
