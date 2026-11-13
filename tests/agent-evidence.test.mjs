import test from "node:test";
import assert from "node:assert/strict";
import { selectAgentEvidence } from "../scripts/agent-evidence.mjs";
const source = (passages, role = "material") => ({
  id: "source",
  name: "Source",
  role,
  passages: passages.map((text, index) => ({
    id: "p" + index,
    label: "Reference",
    text,
  })),
});
const task = {
  topic: "Photosynthesis",
  goal: "Understand how plants use light and water to store chemical energy in sugars.",
  level: "explain",
  previousQuestions: ["What is the byproduct of photosynthesis?"],
};

test("follow-up selection finds goal-relevant relationships beyond the introduction", () => {
  const intro =
    "The history of discoveries is extensive. Scientists described several organisms and their historical names. ".repeat(
      8,
    );
  const mechanism =
    "Light-dependent reactions convert light energy into chemical energy. Water splitting releases oxygen and supplies electrons for these reactions.";
  const sources = [
    source([intro, mechanism]),
    {
      ...source([
        "LED packaging commonly uses resin and plastic. Manufacturers offer many package shapes for indicator lamps.",
      ]),
      id: "unrelated",
    },
  ];
  const original = structuredClone(sources);
  const selected = selectAgentEvidence(sources, task, 2400);
  assert.deepEqual(sources, original);
  assert.equal(selected.length, 1);
  assert.ok(
    selected[0].passages.some((p) =>
      p.text.includes("Light-dependent reactions"),
    ),
  );
  assert.ok(
    selected[0].passages.every((p) =>
      original[0].passages.find((q) => p.id === q.id).text.includes(p.text),
    ),
  );
});

test("follow-up views preserve exact contiguous quotations, identifiers and sentence endings within budget", () => {
  const sources = [
    source([
      "Plants absorb light. This energy powers the reactions. Sugar stores energy for later use.",
      "Water supplies electrons. Carbon dioxide provides carbon atoms for sugar synthesis.",
    ]),
  ];
  const selected = selectAgentEvidence(sources, task, 150);
  const passages = selected.flatMap((s) => s.passages);
  assert.ok(passages.length);
  assert.ok(passages.reduce((sum, p) => sum + p.text.length, 0) <= 150);
  assert.equal(new Set(passages.map((p) => p.id)).size, passages.length);
  for (const p of passages) {
    assert.ok(
      sources[0].passages.find((q) => p.id === q.id).text.includes(p.text),
    );
    assert.match(p.text, /[.!?]$/);
  }
});

test("assignment text is not selected as teaching evidence and cut sentence fragments are skipped", () => {
  const sources = [
    source(
      ["Explain how plants use light energy and water for sugar synthesis."],
      "assignment",
    ),
    source([
      "Plants use light energy to power their",
      "metabolism while storing sugar. Water supplies electrons for photosynthesis.",
    ]),
  ];
  const selected = selectAgentEvidence(sources, task);
  assert.ok(selected.every((s) => s.role === "material"));
  assert.equal(
    selected[0].passages[0].text,
    "Water supplies electrons for photosynthesis.",
  );
});

test("an initial foundation task retains the bounded introductory reading path", () => {
  const text = "Plants capture light and use water. ".repeat(20);
  const sources = [source([text])];
  const selected = selectAgentEvidence(
    sources,
    { ...task, level: "foundation", previousQuestions: [] },
    210,
  );
  assert.ok(text.startsWith(selected[0].passages[0].text));
  assert.ok(selected[0].passages[0].text.length <= 210);
});
