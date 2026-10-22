# StudyStep

[![Checks](https://github.com/seaboose/StudyStep/actions/workflows/checks.yml/badge.svg)](https://github.com/seaboose/StudyStep/actions/workflows/checks.yml)

I built StudyStep to supplement my studies: turn my own notes into manageable practice, check answers against their sources, and make steady progress without juggling several tools.

StudyStep is a local Windows desktop application built with React, TypeScript, Node.js, and Electron. It combines source-linked study guides, flashcards, multiple-choice practice, spaced review, and a focus timer. You can create or import study sets without a model; optional local generation helps draft cards for you to review.

![StudyStep flashcard practice using the included example set](docs/study-cards.png)

## What it does

- **Study your own material.** Import text-based PDF, DOCX, TXT, or Markdown files, paste notes, and choose the sections to study. Topic search can bring in a Wikipedia introduction with its source link.
- **Keep answers traceable.** Open the quoted passage behind a card or explanation. Generated drafts must pass structure, quotation, and model-review checks, then remain editable before saving.
- **Practice before revealing.** Use flashcards, multiple-choice questions, or a short Recall Trail. Hinted and revealed answers do not count as independent correct answers.
- **Return to what needs work.** Rate recall and use scheduled review dates. These ratings guide practice; they are not an objective measurement of mastery.
- **Build a manageable routine.** Focus sessions, breaks, a small garden, and an effort journal reward time spent studying rather than purchases or streak penalties.
- **Keep control of your work.** Local persistence, draft recovery, revision-conflict checks, and exports help protect study progress.

## Run the desktop app

Use Node.js 24 and pnpm 11.25.0. From a fresh checkout:

```sh
pnpm install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
pnpm build
pnpm desktop
```

For a browser window on this computer, run `pnpm start`. This uses a loopback-only server. The desktop edition chooses an available port automatically.

On Windows, `pnpm desktop:package` creates a standalone application under `desktop/releases/`. Open `StudyStep.exe` from the complete extracted folder; do not move the executable away from its supporting files. Builds are unsigned. Models are not bundled.

## Optional local generation

Install [Ollama](https://ollama.com/download) from its official site, download a local model such as `qwen3:4b`, and keep its service on `127.0.0.1:11434`. Choose the model through StudyStep's connection controls. Manual creation, importing, practice, and focus sessions work without it.

Generation sends selected text only to that local service. Cloud-tagged and remote models are rejected. Model files can require several gigabytes, and speed depends on your computer. A second model pass reviews the draft, but both passes can make the same mistake: **check important answers yourself.** Matching quotations do not prove an explanation is correct.

Wikipedia search requires internet access and sends the search query to Wikipedia. Source documents are not uploaded there. Dependencies and models require downloads during setup; normal manual study does not require a hosted account or paid API.

## Data and limits

The desktop **StudyStep → Open local data folder** command locates your local files. Browser mode uses `.local-data/` in the project folder. Study-set backups, review exports, and focus exports are separate; close the app and copy the entire study data folder for a complete backup. Local files are not encrypted by StudyStep, so protect them with your operating-system account and disk encryption.

This release supports one active workspace, up to 10 source files, 20 MB per file, 200 PDF pages, and 80,000 extracted text characters in total. Generation works on selected excerpts up to 12,000 characters. Scanned PDFs need text recognition in another tool first. There is no account sync or multi-user service.

StudyStep supports a study routine; it does not certify course coverage, grades, learning outcomes, or clinical benefits. The example set contains small networking notes for demonstration, not an exam syllabus.

## Verify and contribute

```sh
pnpm typecheck
pnpm build
pnpm test
node tests/desktop-smoke.mjs
```

Tests cover source validation, citation rejection, practice scoring, local-only model handling, draft recovery, persistence, review scheduling, focus accounting, and request-origin boundaries. Model responses in automated tests are controlled fixtures, not evidence of real-model accuracy. CI runs these checks from a fresh installation.

The release includes the local desktop implementation. Personal notes, saved progress, model weights, credentials, generated builds, and older hosting infrastructure are excluded. See [SECURITY.md](SECURITY.md) for boundaries and [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance.

MIT licensed. Third-party packages retain their own licenses.
