import { _electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../desktop/package.json", import.meta.url));
const dataDir = await mkdtemp(path.join(tmpdir(), "studystep-theme-"));
const out = path.join(root, "artifacts", "learning-theme");
await mkdir(out, { recursive: true });
const now = Date.now();
// Existing version-1 data must survive the focus presentation changes.
const historical = ["oak", "cherry", "pine"].map((species, index) => ({
  id: randomUUID(), species, task: ["Spanish verb forms", "Calculus: limits", "Renaissance art"][index],
  kind: "focus", targetMinutes: 25, elapsedMs: 1500000,
  startedAt: now - (index + 1) * 3600000, endedAt: now - (index + 1) * 3600000 + 1500000,
  outcome: "completed", coins: 25,
}));
await writeFile(path.join(dataDir, "focus.json"), JSON.stringify({version: 1, coins: 65, unlocked: ["oak", "cherry"], selected: "cherry", reducedMotion: true, active: null, history: historical}));
const app = await _electron.launch({
  executablePath: process.env.STUDYSTEP_TEST_EXE || require("electron"),
  args: [...(process.env.STUDYSTEP_TEST_EXE ? [] : [path.join(root, "desktop/main.mjs")]), `--study-data=${dataDir}`],
  env: {...process.env, STUDYSTEP_TEST_HIDDEN: "1"},
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  async function resize(width, height = 1000) {
    await app.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
    await page.waitForTimeout(100);
  }
  async function shot(name) {
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow: ${name}`);
    await page.screenshot({path: path.join(out, `${name}.png`), fullPage: true});
    console.log(name);
  }
  await page.getByText("All changes saved", {exact:true}).waitFor();
  await resize(1440);
  assert.equal(await page.locator(".desktop-app").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(8, 12, 18)");
  await page.getByRole("heading", {name: "What would you like to learn?", exact:true}).waitFor();
  await page.getByText("A personal learning workspace", {exact:true}).waitFor();
  assert.equal(await page.locator(".study-flow").count(), 0, "Study tools should not impose a numbered operational workflow");
  assert.equal(await page.getByRole("button", {name: "Study guide", exact:true}).locator("svg").evaluate(el => getComputedStyle(el).opacity), "1", "Inactive study icons remain visible");
  await shot("01-workspace");
  // Narrow windows always expose study tabs, even after hiding the wide sidebar.
  await page.getByRole("button", {name: "Hide sidebar", exact:true}).click();
  for (const width of [820, 700]) {
    await resize(width);
    assert.equal(await page.getByRole("button", {name: "Study guide", exact:true}).isVisible(), true, `Study navigation hidden at ${width}px`);
    await page.getByRole("button", {name: "Study guide", exact:true}).click();
  }
  await resize(1440);
  await page.getByRole("button", {name: "Show sidebar", exact:true}).click();
  await page.getByRole("button", {name: "Create a set", exact:true}).click();
  await page.getByText("Study-set tools · local AI, editing & backups", {exact:true}).click();
  await page.getByRole("button", {name: "Import set", exact:true}).click();
  await page.getByLabel("Study set JSON", {exact:true}).fill(await readFile(path.join(root,"examples/studystep-example.json"), "utf8"));
  await shot("02-import-dialog");
  await page.getByRole("button", {name: "Preview import", exact:true}).click();
  await page.getByRole("button", {name: "Replace workspace with this import", exact:true}).click();
  await page.getByRole("button", {name: "Study guide", exact:true}).click();
  await shot("03-guide");
  await page.getByRole("button", {name: "Practice", exact:true}).click();
  await shot("04-practice");
  await page.getByRole("button", {name: "Recall practice", exact:true}).click();
  await page.getByRole("heading", {name: "Recall practice", exact:true}).waitFor();
  await page.getByRole("button", {name: "Flashcards", exact:true}).click();
  await page.getByRole("button", {name: "Review due cards", exact:true}).click();
  await page.getByRole("button", {name: "Reveal reference answer", exact:true}).click();
  await shot("05-flashcards");
  await page.getByRole("button", {name: "Focus collection", exact:true}).click();
  assert.equal(await page.evaluate(() => scrollY), 0, "Switching workspaces should reset scroll");
  await page.getByRole("button", {name: "Unlock · 60 credits", exact:true}).click();
  await page.locator('.station-option').filter({has:page.getByRole('heading', {name:'Constellation', exact:true})}).getByRole('button',{name:'Selected',exact:true}).waitFor();
  const saved = JSON.parse(await readFile(path.join(dataDir,"focus.json"),"utf8"));
  assert.equal(saved.selected, "pine");
  assert.equal(saved.coins, 5);
  assert.equal(saved.history.length, 3);
  await shot("06-focus-collection");
  await page.getByRole("button", {name: "Focus timer", exact:true}).click();
  await page.getByRole("button", {name: "5 min", exact:true}).click();
  await page.getByRole("button", {name: /Start timer/}).click();
  await page.getByRole("button", {name: "Pause", exact:true}).click();
  await shot("07-focus");
  await page.getByRole("button", {name: "Focus collection", exact:true}).click();
  await page.getByText("Finish the current session before changing designs.").waitFor();
  assert.equal(await page.locator('.station-option').getByRole('button',{name:'Use this design',exact:true}).first().isDisabled(), true);
  await page.getByRole("button", {name: "Study journal", exact:true}).click();
  await shot("08-study-journal");
  await page.getByRole("button", {name: "Study", exact:true}).click();
  await resize(820,1000);
  await shot("09-narrow-study");
  await page.getByRole("button", {name: "Focus timer", exact:true}).click();
  await shot("10-narrow-focus");
  await resize(700,900);
  await page.getByRole("button", {name: "Focus collection", exact:true}).click();
  await shot("11-minimum-collection");
  assert.deepEqual(errors, []);
  console.log("Theme checks passed: study/import/practice/recall, legacy progress, design unlock, active timer navigation, 1440/820/700px layouts.");
} finally { await app.close(); }
