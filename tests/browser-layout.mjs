import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createLocalServer } from "../scripts/local-server.mjs";

// Run against the production build with a disposable profile. "before" records
// existing defects, while "after" also enforces the layout regression checks.
const phase = process.argv[2] || "after";
assert.ok(["before", "after"].includes(phase));
const out = path.resolve("artifacts/browser-audit", phase);
await mkdir(out, { recursive: true });
const dataDir = await mkdtemp(path.join(tmpdir(), "studystep-browser-"));
const server = await createLocalServer({
  port: 0,
  dataDir,
  agentsEnabled: true,
});
const browser = await chromium.launch({ channel: "msedge" });
const rows = [];
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const net = await context.newCDPSession(page);
  await net.send("Network.enable");
  await net.send("Network.setCacheDisabled", { cacheDisabled: true });
  const network = {
    offline: false,
    latency: 400,
    downloadThroughput: 500000 / 8,
    uploadThroughput: 250000 / 8,
    connectionType: "cellular3g",
  };
  await net.send("Network.emulateNetworkConditions", network);
  const start = Date.now();
  await page.goto(server.url, { waitUntil: "commit" });
  await page.waitForSelector("#root", { state: "attached" });
  await page.screenshot({
    path: path.join(out, "cold-start-390.png"),
    timeout: 15000,
  });
  async function activate(p, name, touch) {
    const select = p
      .getByRole("combobox")
      .filter({
        has: p
          .locator("option")
          .filter({ hasText: new RegExp("^" + name + "$") }),
      });
    if (await select.count()) return select.selectOption({ label: name });
    const target = p.getByRole("button", { name, exact: true });
    return touch ? target.tap() : target.click();
  }
  const tap = (name) => activate(page, name, true);
  await page.getByText("All changes saved", { exact: true }).first().waitFor();
  const readyMs = Date.now() - start;
  const assets = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((r) => /\/assets\/index-/.test(r.name))
      .map((r) => ({
        asset: new URL(r.name).pathname,
        encoded: r.encodedBodySize,
        decoded: r.decodedBodySize,
      })),
  );
  if (phase === "after")
    assert.ok(
      assets.length >= 2 &&
        assets.every((a) => a.encoded > 0 && a.encoded < a.decoded),
    );
  assert.ok(await page.evaluate(() => navigator.maxTouchPoints > 0));
  await page.locator(".study-utilities > summary").tap();
  await tap("Import set");
  await page
    .getByLabel("Study set JSON", { exact: true })
    .fill(await readFile("examples/studystep-example.json", "utf8"));
  await tap("Preview import");
  await tap("Replace workspace with this import");
  await page.locator(".study-utilities[open] > summary").tap();
  await tap("Dismiss message");
  await tap("Practice");
  await page.locator(".answer-option").first().tap();
  await tap("Check my answer");
  await page.locator(".feedback").waitFor();
  await tap("Flashcards");
  await tap("Review due cards");
  await tap("Reveal reference answer");
  await page.locator(".recall-answer").waitFor();
  await tap("Focus timer");
  await tap("5 min");
  await page.getByRole("button", { name: /Start timer/ }).tap();
  await page.waitForFunction(() => document.querySelector('[role="timer"]')?.textContent === "04:59");
  await tap("Pause");
  await tap("Finish session");
  await tap("Save this session");
  await tap("Study journal");
  await page.locator(".session-journal article").first().waitFor();
  if (phase === "after")
    assert.equal(await page.locator(".bar-track span").count(), 0);
  await page.reload();
  await tap("Study journal");
  await page.locator(".session-journal article").first().waitFor();
  await net.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  async function readDownload(label, name) {
    const pending = page.waitForEvent("download");
    await tap(label);
    const file = await pending;
    assert.equal(file.suggestedFilename(), name);
    return readFile(await file.path(), "utf8");
  }
  const exported = JSON.parse(await readDownload("Export focus history", "studystep-focus-backup.json"));
  assert.equal(exported.state.history.length, 1);
  await tap("Study");
  await tap("Study guide");
  assert.match(await readDownload("Export guide", "studystep-guide.md"), /DNS/);
  if (phase === "after") {
    const picker = page.getByRole("combobox", {name:"Workspace navigation"});
    await picker.focus();
    await picker.press("ArrowDown");
    await page.locator(".question-card h2:focus").waitFor();
  }

  async function inspect(p, name, width, touch) {
    await p.evaluate(() => window.scrollTo(0, 0));
    const metrics = await p.evaluate(() => {
      const doc = document.documentElement;
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        outside: [...document.querySelectorAll("main *, header *, aside *")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width && r.right > doc.clientWidth + 1;
          })
          .slice(0, 7)
          .map((el) => el.className?.baseVal ?? el.className),
      };
    });
    rows.push({ name, width, touch, ...metrics });
    if (width === 320 || width === 390 || metrics.overflow)
      await p.screenshot({ path: path.join(out, name + "-" + width + ".png") });
  }
  for (const width of [320, 390, 768, 1024, 1440]) {
    const touch = width <= 768;
    const ctx = touch
      ? context
      : await browser.newContext({ reducedMotion: "reduce" });
    const p = touch ? page : await ctx.newPage();
    await p.setViewportSize({ width, height: width <= 390 ? 844 : 960 });
    if (!touch) await p.goto(server.url);
    const go = (name) => activate(p, name, touch);
    await go("Study");
    for (const [label, name] of [
      ["Create a set", "materials"],
      ["Study guide", "guide"],
      ["Practice", "practice"],
      ["Flashcards", "flashcards"],
      ["Recall practice", "recall"],
      ["Focus timer", "timer"],
      ["Study journal", "journal"],
      ["Focus collection", "collection"],
      ["Learning agents", "agents"],
    ]) {
      await go(label);
      await inspect(p, name, width, touch);
    }
    if (!touch) await ctx.close();
  }
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify(
      { browser: browser.version(), network, readyMs, assets, errors, rows },
      null,
      2,
    ),
  );
  console.log({ readyMs, errors, overflow: rows.filter((r) => r.overflow) });
  assert.deepEqual(errors, []);
  if (phase === "after") assert.ok(rows.every((row) => row.overflow === 0));
} finally {
  await browser.close();
  await server.close();
}
