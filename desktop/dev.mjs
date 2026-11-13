import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
process.env.STUDYSTEP_CHANNEL = "development";
const { buildLocal } = await import("../scripts/build-local.mjs");
await buildLocal();
const child = spawn(process.execPath, [fileURLToPath(new URL("./start.mjs", import.meta.url)), ...process.argv.slice(2)], {
  stdio: "inherit", windowsHide: true, env: process.env,
});
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
