import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseStudyImport,
  editGuide,
  validateLocalWorkspace,
} from "../.runtime/local-server/local-study.mjs";
import { independentCorrect } from "../.runtime/local-server/study.mjs";

const example = readFileSync(
  new URL("../examples/studystep-example.json", import.meta.url),
  "utf8",
);
const outcomes = ["correct", "incorrect", "hint", "reveal", "skip"];
for (const first of outcomes)
  for (const second of outcomes)
    for (const rating of ["practice", "confident"])
      for (const editTopic of [false, true]) {
        test(`practice ${first}/${second}, mark ${rating}, reopen after ${editTopic ? "topic edit" : "unchanged guide"}`, () => {
          const imported = JSON.parse(example);
          imported.topics[0].questions.push({
            ...imported.topics[0].questions[0],
            prompt: "Which answer describes name resolution?",
          });
          const { data } = parseStudyImport(JSON.stringify(imported));
          const unit = data.guide.units[0];
          data.topicAssessments = { [unit.id]: rating };
          for (const [i, mode] of [first, second].entries()) {
            if (mode === "skip") continue;
            const q = data.guide.questions[i];
            const a = {
              questionId: q.id,
              hinted: mode === "hint",
              revealed: mode === "reveal",
              selected:
                mode === "reveal"
                  ? null
                  : mode === "incorrect"
                    ? (q.correctIndex + 1) % q.options.length
                    : q.correctIndex,
              at: "2026-01-01T12:00:00.000Z",
            };
            data.attempts.push(a);
            assert.equal(independentCorrect(a, data.guide), mode === "correct");
          }
          const guide = structuredClone(data.guide);
          if (editTopic)
            guide.units[0].objective = "Explain the role of a name resolver.";
          const restored = validateLocalWorkspace(
            JSON.parse(JSON.stringify(editGuide(data, guide))),
          );
          assert.deepEqual(restored.attempts, data.attempts);
          assert.deepEqual(
            restored.topicAssessments,
            editTopic ? {} : { [unit.id]: rating },
          );
        });
      }
