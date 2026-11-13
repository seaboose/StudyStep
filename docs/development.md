# Development

Use Node 24 and pnpm 11.25.0. Run `pnpm install --frozen-lockfile` and `pnpm --dir desktop install --frozen-lockfile` from the repository root. Build with `pnpm build`. Open the consumer app from source with `pnpm desktop`, or use `pnpm dev` for source inspection and local agent experiments with a separate profile.

## Consumer release checks

Run `pnpm typecheck` and `pnpm test:consumer` after building. On Windows run `pnpm desktop:package`. The packaging command creates a versioned directory and updates the local launcher. The CI workflow exercises the packaged executable on Windows and the desktop source on Linux. The independent live Wikipedia checks are `node tests/desktop-related-topics.mjs` and `node tests/desktop-topic-follows.mjs`.

## Developer-only checks

Run `pnpm test:developer` after building. The maintenance rehearsal saves a temporary copy of the faulty module and a repaired copy with hash evidence and test logs in `artifacts/maintenance/`. The production checkout and learner profile are outside the rehearsal. See [the engineering roadmap](agent-roadmap.md) for longer-term work.
