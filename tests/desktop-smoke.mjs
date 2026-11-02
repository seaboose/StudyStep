import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { textPdf, textDocx } from "./fixtures/documents.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
  new URL("../desktop/package.json", import.meta.url),
);
const data = await mkdtemp(path.join(tmpdir(), "studystep-desktop-"));
const executablePath = process.env.STUDYSTEP_TEST_EXE || require("electron");
const args = process.env.STUDYSTEP_TEST_EXE
  ? []
  : [path.join(root, "desktop/main.mjs")];
const errors = [];
let app;
async function open() {
  app = await electron.launch({
    executablePath,
    args: [...args, `--study-data=${data}`],
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByText("All changes saved", { exact: true }).waitFor();
  const preferences = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  return page;
}
try {
  let page = await open();
  await page.locator('input[type="file"][multiple]').setInputFiles([
    {
      name: "Network notes.pdf",
      mimeType: "application/pdf",
      buffer: textPdf(),
    },
    {
      name: "Review notes.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: textDocx(),
    },
  ]);
  await page
    .getByRole("button", { name: "Network notes.pdf", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Review notes.docx", exact: true })
    .waitFor();
  await page.getByText("All changes saved", { exact: true }).waitFor();
  await page
    .getByText("Study-set tools · local AI, editing & backups", { exact: true })
    .click();
  await page.getByRole("button", { name: "Import set", exact: true }).click();
  await page
    .getByLabel("Study set JSON", { exact: true })
    .fill(
      await readFile(
        path.join(root, "examples/studystep-example.json"),
        "utf8",
      ),
    );
  await page
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Replace workspace with this import",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Review due cards", exact: true })
    .click();
  assert.equal(
    await page.getByText("How did recall feel?", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Reveal reference answer", exact: true })
    .click();
  await mkdir(path.join(root, "artifacts"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "artifacts/study-cards.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /^Recalled it/ }).click();
  await page.getByRole("button", { name: "Focus timer", exact: true }).click();
  await page.getByRole("button", { name: "5 min", exact: true }).click();
  await page.getByRole("button", { name: /Start timer/ }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await mkdir(path.join(root, "artifacts"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "artifacts/study-desktop.png"),
  });
  await app.close();
  page = await open();
  await page.getByRole("button", { name: "Flashcards", exact: true }).click();
  await page
    .getByText("Example · Networking basics", { exact: true })
    .waitFor();
  const workspace = JSON.parse(
    await readFile(path.join(data, "workspace.json"), "utf8"),
  );
  assert.equal(workspace.data.guide.title, "Example · Networking basics");
  const focus = JSON.parse(
    await readFile(path.join(data, "focus.json"), "utf8"),
  );
  assert.equal(focus.active.status, "paused");
  assert.deepEqual(errors, []);
  console.log(
    "Desktop checks passed: sandbox, import, reveal/rating, focus pause, and restart persistence.",
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await app?.close().catch(() => {});
}
