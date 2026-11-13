# StudyStep agent engineering roadmap

The [first runnable Dev slice](agents-dev.md) now implements topic/goal tasks, scoped research, reviewed proposals, exact acceptance, preserved progress, and next-step generation using the existing Node service. The remaining roadmap, including FastAPI/Pydantic/LangGraph, is mapped in the [full agent workflow](agent-workflow.md). All fifteen projects are not yet complete.

## Milestone 5 release evidence

The 0.4.0 release checks exercise the learner flows and keep developer replays separate. Read the measured notes on [practice history](reliability-history.md), [read-only shadow review](reliability-shadow.md), and [isolated repairs](reliability-maintenance.md). Optional code exercises and portal automation remain future product decisions.

## Product direction

StudyStep lets a user task agents with learning goals in any subject. Agents research the chosen topic, keep relevant material current, create reviewed study activities, and propose progressively harder material from evidence of the user's understanding. The user can inspect and correct the learning profile, choose a different challenge level, and pause or stop a task.

Surge contributes visual design choices only: color, typography, panels, controls, and status styling. StudyStep retains its own learning flow. Cybersecurity is an optional interest, not the default curriculum. Study time and progress visuals are motivational records, not mastery scores.

## First useful workflow

Choose a topic and goal → confirm an editable agent task → research and verify evidence → draft a small study activity → independent content review → user accepts → practice → explain the next step.

The task brief captures scope, starting level or uncertainty, study time, difficulty preference, allowed sources, desired outputs, and one-time or recurring cadence. Start with one-time tasks. Existing manual imports remain another way to supply source material.

Keep React/Electron and the working study tools. For the requested FastAPI/Pydantic/LangGraph engineering goals, add a loopback Python service behind a narrow typed API. Keep the existing Node service responsible for current study persistence until a tested migration is necessary. Preserve accepted cards and their review history when proposing additions or corrections.

State includes the task/plan revision, run ID, workspace revision, source hashes, evidence IDs, proposals, validation failures, attempts, budget, approval, and trace ID. Persist checkpoints so restart and cancellation do not lose a pending proposal. Enforce revision checks again before save. Learning observations, explicit user preferences, and inferred readiness estimates have separate contracts.

## Delivery sequence

1. **Task and reliability foundation (projects 1, 2, 3, 5, 9, 12).** Editable user task briefs; durable jobs; full prompt/schema/retrieval/output token budgets; strict tool validation; bounded repair; redacted tracing; cancellation; time, loop-depth, token, and spend limits. Load-test 100 concurrent orchestration requests with mock tools while separately capping local inference.
2. **First subject learning team (4, 6, 7, 10).** Subject Researcher, Evidence Analyst, Card Author, and Learning Reviewer pass typed evidence and proposal objects. Reuse existing source/draft protections. Add disposable working memory, source retrieval, and exact proposal-hash approval in the app. Restrict tools outside the model. Add Slack only as an optional approval adapter later.
3. **Adaptive learning.** Quiz Coach, Learner Modeler, and Curriculum Planner use actual answer/hint/reveal events and prerequisite coverage to explain the next activity. Keep knowledge estimates tentative, topic-specific, and editable. Several distinct unaided checks across sessions can support a proposed increase in challenge; calibrate the policy before claiming learning effectiveness. Correct/forget/pause controls invalidate dependent recommendations.
4. **Relevant updates and discovery.** Update Scout monitors only user-configured topic sources and cadence. Discovery Agent proposes adjacent or emerging concepts with relevance and prerequisites. Keep corrections and extensions in the review inbox. Stable topics do not require daily news; unchanged sources produce no notification.
5. **Maintenance and evidence of reliability (8, 14, 15).** Reliability Maintainer prepares isolated fixes; Experience Reviewer checks StudyStep's learning flow; Code Reviewer independently checks the patch. Replay 100 deterministic trajectories, including profile correction, difficulty progression, review-before-save, restart, cancellation, and cost failures. Evaluate real-model quality separately. Add read-only shadow runs within resource bounds, then write three measured architecture articles.
6. **Optional learning tools (11, 13).** Add no-egress sandboxed Python exercises for topics that benefit from code. Add browser fallback for a specific authorized source/portal workflow, with explicit handling of uncertain API outcomes to prevent duplicate actions.

## Existing starting points

- `scripts/local-generation.mjs`: draft, evidence validation, model review, one repair.
- `scripts/local-model.mjs`: local-only model calls, JSON output schema, cancellation and timeout.
- `lib/selection.ts`: character-based selection ceiling; replace this with full request budgeting, including duplicated evidence text.
- `scripts/local-server.mjs`: job status, cancellation, single-generation guard, and revision checks.
- `scripts/draft-store.mjs`: persisted editor drafts and workspace hashes.
- Existing review records: preserve actual scoring and hint/reveal behavior when defining versioned learning events.
- `tests/fixtures/quality-corpus.mjs`: initial evaluation corpus; expand across subjects, prerequisite levels, and harder transfer questions.

## Design decisions

- Concurrent requests are not concurrent GPU generations. Queue and bound inference separately; active study takes priority over background updates.
- Reserve the next paid call's maximum cost before dispatch. A cheaper fallback must fit the remaining budget; it cannot bypass a $0.50 cap. Local models need time/token limits even without an API invoice.
- Prompt sanitization is only one layer. Treat sources and agent messages as untrusted data; preserve quotations and enforce tool permissions, schemas, and approval in code.
- Store a proposal hash, workspace revision, expiry, and idempotency key with approval. A changed proposal needs new review and approval.
- Profile estimates cite learning events and show uncertainty. Focus minutes, repeated answer exposure, and hinted/revealed responses cannot establish independent mastery. Do not infer personality or diagnoses.
- Keep the user in charge of topic scope, preferences, difficulty, recurrence, and personalization. Forgetting an inference must prevent its immediate recreation from the same evidence.
- Trace metadata by default. Exporting private source content or learning records is a separate explicit product choice.
- Maintenance patches use an isolated development copy and fixture data. A reviewed patch becomes a release candidate, not an automatic modification of the running app.

References: [Pydantic strict mode](https://pydantic.dev/docs/validation/latest/concepts/strict_mode/), [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts), [OWASP prompt injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html), [OpenTelemetry GenAI conventions](https://github.com/open-telemetry/semantic-conventions-genai).
