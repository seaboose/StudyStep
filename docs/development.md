# Development

Use Node.js 24 and pnpm 11.25.0. Run commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm desktop
```

Use `pnpm start` for browser mode. On Windows, `pnpm desktop:package` creates the
portable app under `desktop/releases/`. Keep its complete folder together.

For local generation, install an Ollama model, keep the service at
`127.0.0.1:11434`, and select the model in StudyStep. Manual study needs no model.

## Checks

`pnpm test` covers validation, scoring, recovery, persistence, review scheduling,
and request boundaries. `node tests/desktop-smoke.mjs` checks the Windows desktop
workflow after a build. CI runs the logic checks on Windows and Linux, then tests
and packages the Windows app. Model fixtures do not establish real-model accuracy.

`node tests/theme-smoke.mjs` checks the 0.3.2 study flow, legacy focus data, and
1440, 820, and 700 pixel layouts. Set `STUDYSTEP_TEST_HIDDEN=1` for offscreen
desktop checks. Use `STUDYSTEP_TEST_EXE` to validate a packaged executable.

The regular desktop stores data in `%APPDATA%/StudyStep/study-data`. Development
editions use a separate identity and data folder. This source release reproduces
the regular 0.3.2 product, including its focus collection and study journal.

Keep source references visible and manual workflows available. Add a focused test
for a changed behavior or failure path. Check keyboard access and narrow windows
when changing the interface. Keep course documents, saved data, credentials, model
weights, dependencies, and generated builds out of Git.

## Data and backups

Local files are unencrypted. Optional Wikipedia search sends its search query;
local generation sends selected excerpts only to the configured loopback service.
For a complete backup, close the app and copy the folder opened by
**StudyStep → Open local data folder**. Browser mode uses `.local-data/`.

See the [code guide](code-guide.md), [release checklist](release-checklist.md),
and [security limits](../SECURITY.md).
