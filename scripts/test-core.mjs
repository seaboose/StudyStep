import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import ts from "typescript";
await mkdir(".runtime/tests", { recursive: true });
for (const name of ["study", "generate", "sample"]) {
  const source = await readFile(`lib/${name}.ts`, "utf8");
  const js = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replaceAll('"./study"', '"./study.mjs"');
  await writeFile(`.runtime/tests/${name}.mjs`, js);
}
const result = spawnSync(process.execPath, ["--test", "tests/core.test.mjs"], {
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
