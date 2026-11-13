import { readFileSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { reviewTimingKey } from "./advanced-generation.mjs";

// Developer-only shadow review of a supplied capture. Never writes proposals or calls a model.
const input = process.argv[2];
if (!input || statSync(input).size > 2_000_000)
  throw Error("Supply a saved bundle of at most 2 MB.");
const bundle = JSON.parse(readFileSync(input, "utf8"));
const start = performance.now();
const counts = { examined: 0, confirmed: 0, flagged: 0, outsideRule: 0 };
for (const item of bundle.plan.cases) {
  for (const attempt of Object.values(bundle.records[item.id])) {
    for (const draft of attempt.drafts) {
      if (counts.examined >= 100 || performance.now() - start > 5000)
        throw Error("Shadow replay budget reached.");
      const feedback = reviewTimingKey(
        {
          prompt: draft.question,
          options: draft.options.map((text) => ({ text })),
          correctIndex: draft.options.indexOf(draft.answer),
          citations: [{ quote: draft.citation }],
        },
        item.goal,
      );
      counts.examined++;
      if (feedback === undefined) counts.outsideRule++;
      else if (feedback.length) counts.flagged++;
      else counts.confirmed++;
    }
  }
}
console.log(
  JSON.stringify({
    ...counts,
    elapsedMs: Math.round(performance.now() - start),
  }),
);
