import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (!process.argv.includes("--no-build")) {
  const { buildLocal } = await import("./build-local.mjs");
  await buildLocal();
}
const { createLocalServer } = await import("./local-server.mjs");
let runtime;
const binary = path.join(root, ".runtime/ollama/bin/ollama.exe");
if (process.platform === "win32" && existsSync(binary)) {
  let running = false;
  try {
    running = (
      await fetch("http://127.0.0.1:11434/api/tags", {
        signal: AbortSignal.timeout(1000),
      })
    ).ok;
  } catch {}
  if (!running) {
    await mkdir(".runtime/ollama/models", { recursive: true });
    runtime = spawn(binary, ["serve"], {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        OLLAMA_HOST: "127.0.0.1:11434",
        OLLAMA_MODELS: path.join(root, ".runtime/ollama/models"),
        OLLAMA_NO_CLOUD: "1",
        OLLAMA_CONTEXT_LENGTH: "16384",
      },
    });
    runtime.on("error", () =>
      console.log(
        "Local AI could not start. Manual editing and importing are still available.",
      ),
    );
  }
}
try {
  const app = await createLocalServer();
  console.log(
    `StudyStep Local is ready: ${app.url}\nStudy data: ${path.join(root, ".local-data")}\nNo API key or paid service is used. Press Ctrl+C to close.`,
  );
  if (process.argv.includes("--open") && process.platform === "win32")
    spawn("rundll32", ["url.dll,FileProtocolHandler", app.url], {
      windowsHide: true,
      stdio: "ignore",
    });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await app.close();
      runtime?.kill();
      process.exit(0);
    });
} catch (e) {
  runtime?.kill();
  console.error(
    e.code === "EADDRINUSE"
      ? "Port 5173 is already in use. If StudyStep is running, open http://127.0.0.1:5173. Otherwise close the other app and retry."
      : e.message,
  );
  process.exitCode = 1;
}
