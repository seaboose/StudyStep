import { cp, mkdir, writeFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(root, "package.json"));
// New staging and release folders keep earlier usable builds intact.
const buildId = new Date().toISOString().replace(/[:.]/g, "-");
const staging = path.join(root, "desktop", "staging", buildId);
await mkdir(staging, { recursive: true });
for (const name of [
  "LICENSE",
  "THIRD_PARTY_NOTICES.txt",
  ".local-dist",
  "scripts/local-server.mjs",
  "scripts/local-model.mjs",
  "scripts/local-generation.mjs",
  "scripts/draft-store.mjs",
  "scripts/generation-quality.mjs",
  "scripts/focus-store.mjs",
  "scripts/review-store.mjs",
  "scripts/topic-search.mjs",
  "desktop/main.mjs",
  ".runtime/local-server",
]) {
  const target = path.join(staging, name);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(root, name), target, { recursive: true });
}
const zod = await realpath(path.dirname(require.resolve("zod/package.json")));
await mkdir(path.join(staging, "node_modules"), { recursive: true });
await cp(zod, path.join(staging, "node_modules", "zod"), { recursive: true });
await writeFile(
  path.join(staging, "package.json"),
  JSON.stringify(
    {
      name: "studystep",
      productName: "StudyStep",
      version: "0.3.0",
      description: "A calm local space for study and focus.",
      main: "desktop/main.mjs",
      type: "module",
      author: "Sebastian Marquez",
      dependencies: { zod: "3.25.76" },
    },
    null,
    2,
  ),
);
const electronVersion = JSON.parse(
  await (
    await import("node:fs/promises")
  ).readFile(
    path.join(root, "desktop", "node_modules", "electron", "package.json"),
    "utf8",
  ),
).version;
const output = await packager({
  dir: staging,
  out: path.join(root, "desktop", "releases", buildId),
  name: "StudyStep",
  platform: "win32",
  arch: "x64",
  electronVersion,
  prune: false,
  asar: false,
  appCopyright: "Copyright 2026 Sebastian Marquez",
  overwrite: false,
});
const executable = path.join(output[0], "StudyStep.exe");
// Keep this machine's existing study data and model separate from the portable bundle.
await writeFile(
  path.join(root, "Start StudyStep Desktop.cmd"),
  `@echo off\r\ncd /d "%~dp0"\r\nset "STUDYSTEP_DATA_DIR=%~dp0.local-data"\r\nset "STUDYSTEP_OLLAMA_ROOT=%~dp0.runtime\\ollama"\r\nstart "" "%~dp0${path.relative(root, executable)}"\r\n`,
);
await writeFile(
  path.join(root, "desktop", "latest-build.json"),
  JSON.stringify({ executable, buildId }, null, 2),
);
console.log(
  JSON.stringify({
    executable,
    launcher: path.join(root, "Start StudyStep Desktop.cmd"),
  }),
);
