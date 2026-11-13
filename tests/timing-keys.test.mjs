import assert from "node:assert/strict";
import test from "node:test";
import {
  reviewTimingKey,
  timingDecision,
  validateTransferAssessment,
} from "../scripts/advanced-generation.mjs";

const passage =
  "A sample cartridge locks its exit route at the instant its seal breaks. An upright cartridge selects the upper outlet. An inverted cartridge selects the lower outlet. Turning the cartridge after the seal breaks leaves the locked route unchanged.";
const goal = (order) =>
  `Predict which outlet receives the sample when an upright cartridge is inverted ${order} its seal breaks.`;

test("cartridge keys and reviewer state reverse across the locking event", () => {
  for (const [order, state, key] of [
    ["before", "inverted", "lower outlet"],
    ["after", "upright", "upper outlet"],
  ]) {
    const decision = timingDecision(goal(order), passage);
    assert.equal(decision.answer, key);
    assert.equal(decision.stateAtLock, state);
  }
});

test("different events, missing rules and contradictory routes do not supply a timing key", () => {
  for (const altered of [
    passage.replace("at the instant", "before"),
    passage.replace("locks its", "never locks its"),
    passage.replace("its seal breaks", "its lever moves"),
    passage.replace("An inverted cartridge", "An inverted bottle"),
    passage + " An upright cartridge selects the lower outlet.",
  ])
    assert.equal(timingDecision(goal("after"), altered), undefined);
});

test("cartridge review accepts the correct before key and rejects the former wrong after key", () => {
  const question = {
    prompt: goal("before"),
    citations: [{ quote: passage }],
    options: ["lower outlet", "Neither destination", "upper outlet"].map(
      (text) => ({ text }),
    ),
    correctIndex: 0,
  };
  assert.deepEqual(reviewTimingKey(question, question.prompt), []);
  question.prompt = goal("after");
  assert.equal(reviewTimingKey(question, question.prompt).length, 1);
  question.correctIndex = 2;
  assert.deepEqual(reviewTimingKey(question, question.prompt), []);
  question.options[1].text = "upper outlet";
  assert.equal(reviewTimingKey(question, question.prompt).length, 1);
});

test("verified timing resolves only the key disagreement; challenge and novelty remain reviewable", () => {
  const assessment = {
    answerFitsQuestion: false,
    answerFitReason: "Assumed the latest state.",
    cognitiveOperation: "recall",
    challengeReason: "Names a fact.",
    changedCondition: "",
    scenarioEssential: false,
    noveltyReason: "Repeated.",
    newQuestion: "repeated",
  };
  const problems = validateTransferAssessment(assessment, "apply", true);
  assert.ok(
    !problems.some((message) => message.startsWith("answerFitsQuestion")),
  );
  for (const field of ["cognitiveOperation", "changedCondition", "newQuestion"])
    assert.ok(problems.some((message) => message.startsWith(field)));
  assert.ok(
    validateTransferAssessment(assessment, "apply").some((message) =>
      message.startsWith("answerFitsQuestion"),
    ),
  );
});
