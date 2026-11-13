import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAnswerCandidates } from "../scripts/answer-candidates.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const reviewed = read("./fixtures/reviewed-answer-keys.json");
const menu = (item) =>
  buildAnswerCandidates(
    [{ role: "material", quote: item.passage, evidenceId: "E1" }],
    { ...item, topic: item.id },
  ).map((candidate) => candidate.text);

test("reviewed drafts that failed challenge cannot reuse their deficient keys", () => {
  assert.equal(reviewed.length, 14);
  for (const draft of reviewed) {
    assert.equal(draft.ratings.challenge, "fail");
    assert.ok(!menu(draft.case).includes(draft.answer), draft.reason);
  }
});

test("fresh source menus retain the known answers for mechanism and timing goals", () => {
  const expected = read("../examples/prompt-comparison/known-keys.json");
  for (const item of read("../examples/prompt-comparison/known-key-plan.json")
    .cases) {
    for (const key of expected[item.id]) assert.ok(menu(item).includes(key));
  }
});
