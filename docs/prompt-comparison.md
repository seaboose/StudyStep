# Comparing StudyStep review prompts

| Priority | Milestone | Completion check |
| --- | --- | --- |
| 1 · Critical | Freeze the human rubric and matched inputs | Record the approved rubric, two exact prompt texts, held-out passages, prior questions, model settings and budgets before capture. |
| 2 · Critical | Replay saved comparisons offline | A second developer can recompute per-case results from saved drafts and judgments, detect changed inputs, and reproduce the historical summaries. |
| 3 · High | Capture the paired local experiment | Run both prompts through the bounded Dev workflow on each frozen passage. Save actual drafts, settings, model digest, seeds, calls, reviewer feedback and incomplete runs. |
| 4 · High | Review failures and decide which prompt to use | Have a human assess the locked drafts without prompt labels, review regressions and abstentions alongside cost, and record the learner decision for any accepted study item. |
| 5 · Later | Replicate on new material | Repeat on fresh passages and seeds before making a broader prompt change or claiming more consistent challenge progression. |

Rubric v1 was approved by the project owner on November 12, 2026, before experiment scoring. Its text and approved fingerprint are checked by the scorer. The October conditioning audit informed the novelty and challenge criteria. Those historical passages and the public synthetic control are development examples. Reserve the two new cases in the plan for capture after the prompt texts are frozen. Once inspected to tune either prompt, retire those cases from the held-out set.

## Offline replay

From the StudyStep project root, with Python 3 and its standard library:

```powershell
python scripts/run_scorecard.py --paired examples/prompt-comparison/control.json
python scripts/run_scorecard.py --prepare examples/prompt-comparison/plan.json
python scripts/run_scorecard.py artifacts/agents/evals/2026-10-29T20-29-39-761Z-98043713 artifacts/agents/evals/2026-10-29T20-31-55-510Z-122d141d
python -B tests/test_paired_scorecard.py
```

The first command replays two **constructed** pairs. It includes a repaired answer, uncertainty about novelty, an abstention and a failed run. The second prints an experiment bundle with both arms pending and call cost unknown. Redirect it to a new UTF-8 file to begin a capture. The third retains the application-plan companion scorecard's directory interface and output format. It checks the budget per historical batch.

## Recording and reviewing a pair

1. Freeze the plan. Set the actual model version or digest when available, seed, inference options, deadline, call and revision limits before preparing the bundle. The baseline in the proposed plan is the current focused transfer review instruction in `scripts/advanced-generation.mjs`; the candidate adds a scenario-removal and novelty check. Keep the same plan for both arms. Scorecards describe the supplied records. Capture must independently verify that the runtime used those inputs.
2. Capture into an isolated study workspace with explicit source selection. Each case is one matched item in this first experiment. Retain its initial draft and at most one revision in order, each with question, keyed answer and citation. Set status to `proposed`, `abstained`, `failed` or `unavailable` as observed. Record attempted calls and the reason for a missing proposal. Use null for unknown cost. If the model was never invoked and zero calls are verified, record zero. Keep interrupted drafts and their trace. Put execution evidence in the record before requesting review.
3. Replay the bundle without reviews to obtain each `attempt_sha256`. Blind the copies given to the human reviewer. For each draft record pass, fail or uncertain on all three criteria, with a reason and an exact supporting passage excerpt. For every failed initial criterion explicitly record fixed or unresolved. Bind the review to its attempt hash, and record the reviewer by a non-contact identifier. Use the provided control as a format example. A learner acceptance or rejection also needs a decision reference tied to that proposal. Running this tool never applies a study-set change.
4. Replay again and keep the original bundle with the output. The paired comparison reports final **proposals**; the separate `accepted_support` counts cover proposals with recorded learner acceptance. Review uncertainty, absent outputs and unreviewed proposals retain their own states. Repair counts use initially failed criteria as their denominator. A missing final proposal can have a reviewed draft history but cannot earn a paired final gain. Inspect the reasons, source quotes and learner decisions in the bundle alongside the report. Hashes detect changed records against a saved fingerprint; they do not authenticate a run or a reviewer.

The scorer treats source and model text as data. It requires no model, network connection, credentials, or running desktop app. The synthetic checks exercise scoring behavior. Quality conclusions require captured experiment outputs and genuine human decisions.
