import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

// Run the real regression test against a private copy of one module. Its
// dependencies still resolve against the checkout, just as in the normal test.
const root = resolve("artifacts/maintenance");
await mkdir(root, { recursive: true });
const dir = await mkdtemp(join(root, "timing-"));
const modulePath = resolve("scripts/advanced-generation.mjs");
const original = await readFile(modulePath, "utf8");
const rule = 'answer: order.toLowerCase() === "before" ? newRoute : oldRoute';
const defect = 'answer: order.toLowerCase() === "before" ? oldRoute : newRoute';
assert.equal(
  original.split(rule).length,
  2,
  "Update the fixture to match the current timing rule.",
);
const copy = join(dir, "advanced-generation.mjs");
const loader = join(dir, "isolated-module.mjs");
await writeFile(
  loader,
  `import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
registerHooks({load(url, context, next) {
  if(url === ${JSON.stringify(pathToFileURL(modulePath).href)})
    return {format:"module", source:readFileSync(${JSON.stringify(copy)},"utf8"), shortCircuit:true};
  return next(url,context);
}});
`,
);
const hash = (s) => createHash("sha256").update(s).digest("hex");
function replay() {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(loader).href,
      "--test",
      "--test-reporter=tap",
      "tests/timing-keys.test.mjs",
    ],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  return { status: result.status, log: result.stdout + result.stderr };
}
const seeded = original.replace(rule, defect);
await writeFile(copy, seeded);
const before = replay();
await writeFile(join(dir, "before.tap"), before.log);
assert.equal(before.status, 1);
assert.match(
  before.log,
  /not ok \d+ - cartridge keys and reviewer state reverse/,
);
assert.match(before.log, /lower outlet/);
const repaired = (await readFile(copy, "utf8")).replace(defect, rule);
await writeFile(copy, repaired);
const after = replay();
await writeFile(join(dir, "after.tap"), after.log);
assert.equal(after.status, 0, after.log);
assert.equal(hash(repaired), hash(original));
assert.equal(await readFile(modulePath, "utf8"), original);
await writeFile(
  join(dir, "repair.diff"),
  `--- seeded/advanced-generation.mjs\n+++ repaired/advanced-generation.mjs\n@@\n-${defect}\n+${rule}\n`,
);
await writeFile(
  join(dir, "report.json"),
  JSON.stringify(
    {
      fixture: "reversed timing destinations",
      original: hash(original),
      seeded: hash(seeded),
      repaired: hash(repaired),
      reproduced: true,
      repairedCopyPassed: true,
    },
    null,
    2,
  ),
);
console.log("Verified isolated defect reproduction and repair:", dir);
