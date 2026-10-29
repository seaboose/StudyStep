import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import ts from "typescript";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
export async function buildLocal() {
  await mkdir(".runtime/local-server", { recursive: true });
  for (const name of [
    "study",
    "generate",
    "local-study",
    "focus",
    "review",
    "selection",
    "card-review",
  ]) {
    const source = await readFile(`lib/${name}.ts`, "utf8");
    const compiled = ts
      .transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      })
      .outputText.replace(
        /from (['"])\.\/(study|generate|local-study)\1/g,
        'from "./$2.mjs"',
      );
    await writeFile(`.runtime/local-server/${name}.mjs`, compiled);
  }
  await build({ configFile: "vite.local.config.ts" });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildLocal();
