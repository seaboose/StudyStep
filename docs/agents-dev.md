# Developer learning agents

Run `pnpm dev` from a source checkout and open **Learning agents**. This mode uses a separate study profile. Experimental agent proposals can fail their checks and still require learner review.

## Use it

1. Select an installed local model in the connection panel. Start a local Ollama service or configure a local runtime. Initial model loading can take time. Refresh the connection if needed.
2. Enter a **Topic** and **What do you want to understand?** Choose foundations, explanation, or application, and whether to use progress for recommendations.
3. Choose **Find Wikipedia overviews** or **My selected study material**. Web research sends goal-derived search phrases to Wikipedia; generation and review run on the local model. This first research connector retrieves introductory extracts, not comprehensive web research. For specialist or deeper material, select your own source passages in Create a set.
4. Assign the task. Researcher, Card author, Learning reviewer, and coordinator stages appear in Activity. You may keep studying, cancel, or retry a failed task. Each task is a single run; no recurring monitoring is installed.
5. Review the proposed cards, quiz answers, quotations, sources, and coverage gaps. **Add cards and quiz to study set** approves that exact proposal. It appends material and preserves unchanged cards and review progress. A changed workspace requires refresh before approval.
6. Open the study set and answer questions in **Practice**. Return to Learning agents to see distinct unaided, assisted, and incorrect results. Choose **Build next step** using the suggested or explicitly selected challenge.

## How adaptation works

The initial policy is explicit and deterministic. It uses unchanged, accepted quiz questions in the same task lineage. It does not infer mastery from time, focus credits, card reveals, or self-rated recall.

- Hinted, revealed, and incorrect answers in the two most recent attempted batches suggest reinforcing foundations.
- At least three distinct unaided correct answers across two accepted batches can suggest explanation.
- At least five across two batches can suggest application, provided recent attempts do not indicate unresolved difficulty.
- Sparse evidence keeps the selected level. Accepting unpracticed batches does not erase earlier difficulties. Edited questions or changed evidence invalidate their old signals.
- A user-selected harder level is recorded as a preference, not an inferred ability. Personalization can be disabled when assigning a task.

This is an engineering progression policy, not a validated learning assessment. This release does not yet maintain a full editable learner profile, spaced longitudinal event history, or concept prerequisite graph. It derives its recommendations from actual saved quiz results and explains them in the interface.

## Implementation and limits

The first slice extends the existing Node service with strict Zod contracts shared with TypeScript, saved tasks, a bounded asynchronous worker, and local schema-constrained model calls. It reuses the existing citation validator and an independent answer-review call. Roles share one local model but have separate instructions and structured inputs. Scheduling, permission checks, acceptance, and progress scoring are deterministic code.

The larger FastAPI/Pydantic/LangGraph sidecar from the [architecture proposal](agent-workflow.md) remains a later implementation milestone. This release does not claim all fifteen engineering projects are complete.

An initial foundation task uses the compact exact-source phrase generator. Foundation follow-ups and all explanation/application tasks use a separate bounded pipeline:

1. Select source views for the topic and goal. Follow-up selection ranks complete sentence windows for relevance, useful relationships, weak concepts, and reduced overlap with previous questions. The inference view contains at most 2,400 source characters; full source snapshots remain saved. The author receives up to twelve previous questions and, when personalization is enabled, the six most recent valid quiz outcomes from the same accepted task lineage. Each outcome identifies the question as correct, assisted, or incorrect; edited questions and changed evidence do not contribute signals.
2. Build a deterministic menu of exact source phrases, then have the model select candidate IDs and learning objectives. The menu contains at most forty-eight entries, uses at most 2,800 serialized bytes, and preserves each evidence ID. Short concepts contain one to five words and at most sixty characters, including phrases such as “law of conservation of energy.” Explanation and application menus also offer exact relationship clauses up to one hundred characters. These end at source sentence or semicolon boundaries, preserve adjacent qualifiers and internal punctuation, and omit oversized clauses rather than clipping them. The app resolves IDs to original answer text and citations. A source substring is not a guarantee of a suitable answer.
3. Write one card/quiz pair at a time with an app-owned question format. Foundation writers return a question and two distractors. Explanation writers supply an observed result; the app asks which source excerpt explains why it occurs. Application writers supply a plausible mistaken explanation; the app asks which excerpt corrects that reasoning. These first advanced formats cover causal explanation and misconception diagnosis, not arbitrary worked problems. The fixed answer and citations cannot be rewritten. Advanced titles are neutral. If an observation leaks the answer in an explicitly marked causal tail, the app removes that tail before both reviews; remaining answer leakage requires repair. Card teaching text is assembled from validated source extracts.
4. Independently solve each question without its answer key, check every option and exact source support, and assess relevance, novelty and challenge. Explanation/application pairs then pass a separate focused assessment of literal answer fit and the actual reasoning required. It rejects recall in place of explanation, decorative “if” scenarios, repeated questions, and application without an essential case to diagnose or changed condition. Quoted learner claims are propositions to refute, not asserted source facts. A pair that passed both reviews is preserved while another pair is repaired or omitted. These model judgments can still be wrong; inspect the proposal before accepting it.

- One model task runs at a time; at most eight queued tasks and eighty saved tasks. Existing manual generation and agent generation do not run concurrently.
- A run has a ten-minute deadline and twelve model-call limit. Advanced generation uses at most two candidate-selection calls and three writing attempts, each followed by at most one blind review and one focused assessment: eleven generation calls plus research planning. Foundation follow-ups allow four writing attempts and four reviews, without the focused assessment. Each candidate gets at most two writing attempts. Initial foundation generation allows at most three author repairs, with reviews also charged to the run limit. Cancellation, deadline, and call-budget failures stop further work.
- Context preflight counts the UTF-8 bytes of messages and schema, reserves the actual requested output budget plus a 1,024-unit template margin, and checks that conservative estimate against the smaller of the model's advertised context and 16,384. This is not exact tokenizer accounting. Calls use non-thinking mode and request at most 4,500 output tokens. Advanced requests include the schema in the prompt as well as the constrained-output field so the model can interpret its required fields before emitting them. Repetition penalty is 1.0; presence and frequency penalties are explicitly zero. A response stopped by its output limit fails rather than being accepted as complete. No paid provider is configured.
- Initial foundation tasks propose up to three card/quiz pairs; follow-ups and higher challenges propose up to two. The proposal discloses omitted items and partial source coverage. Every retained item must pass independent evidence review. Schema/citation failures, no valid remaining pairs, or failed review produce a failed task with a recovery action. Structured JSON and a reviewer are additional checks, not a guarantee of truth or a completed adaptive-learning benchmark.
- Accepted study-set limits still apply: ten sources, eighty thousand source characters, sixty units, and three hundred quiz questions. Research snapshots deduplicate by source URL and fingerprint.
- Approval includes the exact proposal hash and current workspace revision. Stable per-run IDs allow recovery if saving study data succeeded just before the app stopped. Restart preserves reviewable proposals; interrupted work requires an explicit retry.
- Task data lives in the active Dev study-data folder as `agent-tasks.json`, with a previous backup. It contains goals, source snapshots, proposals, activity, and accepted-question fingerprints. Include it when backing up the entire data folder. Private study content is not exported to a tracing service.
- No maintenance agents, background services, Slack integration, browser fallback, arbitrary code execution, or automatic updates are enabled by this slice.

## Verification

For matched review-prompt experiments, see [Comparing StudyStep review prompts](prompt-comparison.md) for the approved rubric, milestone priorities and offline replay commands.

`pnpm test` includes persistence, schema, cancellation, approval, adaptation, source integrity, and review-migration tests. `node tests/agents-ui-smoke.mjs` exercises the actual Dev interface with deterministic API fixtures and captures 1440/700px layouts.

The complete live check uses real Wikipedia and local inference, isolated temporary profiles, explicit approval, and simulated quiz results saved through the real API:

```powershell
$env:STUDYSTEP_LIVE_ADAPTIVE = '1'
$env:STUDYSTEP_LIVE_MODEL = 'qwen3.5:9b'
$env:STUDYSTEP_LIVE_SEED = '42'
node tests/agents-live-adaptive.mjs
```

Optional `STUDYSTEP_LIVE_TOPIC` and `STUDYSTEP_LIVE_GOAL` select a different assignment. Each run preserves requests, responses, stage events, final workspace, and results under `artifacts/agents/evals/<run-id>/`. Live checks require network access and local compute, and are separate from deterministic CI. UI tests use deterministic fixtures; the live progression check drives the real backend API.

On October 29, 2026, **146 regression tests**, TypeScript, the local build, desktop smoke test, and Dev interface checks passed. Two final live runs automatically moved through foundation → foundation → explanation → application, with explicit approval at each batch. Five saved unaided correct results triggered application. Wrong and hinted answers separately triggered reinforcement recommendations; the resulting foundation task was created and cancelled to test safe stopping. Earlier material and progress survived every approval.

| Topic / seed              | Accepted cards and quizzes |    Time | Model calls | Content audit                                                                                           |
| ------------------------- | -------------------------: | ------: | ----------: | ------------------------------------------------------------------------------------------------------- |
| Photosynthesis / 42       |       6 pairs in 4 batches | 117.3 s |          28 | Source-correct introductory causal/diagnostic practice; limited depth and uneven distractors            |
| Operant conditioning / 17 |       7 pairs in 4 batches | 139.0 s |          32 | Source-correct, but intended harder questions still reused definitions; novelty/difficulty audit failed |

The final runs are `2026-10-29T20-29-39-761Z-98043713` and `2026-10-29T20-31-55-510Z-122d141d`. Each includes a separate `content-audit.json`: an integration pass is **not** a claim of educational quality. Earlier failed runs and the integration pass with content defects remain available for diagnosis.

The workflow and persistence are verified; **consistently harder material is not yet established**. Both reviewers can overrate a definition rewritten as a causal question. Wikipedia introductions often lack deeper mechanisms, and distractor grammar or length can reveal the answer. The next quality work is richer retrieval beyond introductions, better distractors, and calibrated difficulty/novelty evaluation against human-reviewed examples. Select detailed study passages when the overview is too shallow. These checks do not measure learning efficacy or mastery.
