# Code guide

Follow one document from import to practice:

| Step | Start here | Main decision |
| --- | --- | --- |
| Import | `lib/extract.ts`, `local/SectionPicker.tsx` | Extract readable text and let the user select the material. |
| Generate | `scripts/local-generation.mjs`, `scripts/local-model.mjs` | Orchestrate local model requests with structured responses and a bounded revision. |
| Check evidence | `lib/study.ts`, `scripts/generation-quality.mjs` | Check source quotations, answer structure, and a second model review. |
| Review and save | `app/study-app.tsx`, `scripts/draft-store.mjs` | Keep a generated draft separate from the saved set until the user accepts it. |
| Practice | `local/Flashcards.tsx`, `lib/review.ts`, `scripts/review-store.mjs` | Record practice and schedule review. Self-ratings are not proof of mastery. |
| Desktop boundary | `desktop/main.mjs`, `scripts/local-server.mjs` | Restrict renderer privileges and validate local requests. |

The AI workflow allows at most two drafts. Failed checks leave the saved set
unchanged. Exact quotations make evidence easier to inspect; they do not guarantee
that a model's interpretation or a multiple-choice question is correct.

The focus timer is in `local/focus/` and `scripts/focus-store.mjs`. The server's
compiled TypeScript helpers are generated under `.runtime/` by the build.

Read `tests/refinement.test.mjs` for generation and evidence cases, then
`tests/local.test.mjs` for local API and persistence behavior. The example study
set in `examples/` makes the manual workflow available without a model.
