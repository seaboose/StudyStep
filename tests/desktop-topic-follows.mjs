import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { _electron } from "playwright";
const executable = process.env.STUDYSTEP_TEST_EXE || JSON.parse(await readFile("desktop/latest-build.json")).executable;
const dir = await mkdtemp(path.join(tmpdir(), "studystep-follows-"));
const open = () =>
  _electron.launch({
    executablePath: executable,
    args: [`--study-data=${dir}`],
    env: { ...process.env, STUDYSTEP_TEST_HIDDEN: "1" },
  });
let app = await open();
try {
  let page = await app.firstWindow();
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.getByRole("button", { name: /Search a topic/ }).click();
  await page.getByLabel("Topic", { exact: true }).fill("Observatory");
  await button("Search").click();
  await page
    .getByRole("button", { name: /^Observatory .*Preview overview/ })
    .click();
  await page.getByLabel("Check this source").selectOption("daily");
  await button("Follow source").click();
  const frequency = () => page.getByLabel("Check frequency");
  await frequency().waitFor();
  async function check() {
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/topic-follows") &&
          r.request().method() === "POST",
      ),
      button("Check now").click(),
    ]);
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent === "Check now",
        )?.disabled,
    );
  }
  await check();
  assert.equal(
    await page.getByText("Review source update", { exact: true }).count(),
    0,
  );
  await frequency().selectOption("weekly");
  await page.waitForFunction(() => !document.querySelector("select[disabled]"));
  await app.close();
  // Seed an older snapshot in the isolated profile. On restart the real scheduler
  // must retrieve the live Wikipedia overview and expose the difference.
  const statePath = path.join(dir, "topic-follows.json");
  const rows = JSON.parse(await readFile(statePath));
  rows[0].text =
    "The saved overview from the earlier check contained this sentence.";
  rows[0].checked = Date.now() - 8 * 86400000;
  await writeFile(statePath, JSON.stringify(rows));
  app = await open();
  page = await app.firstWindow();
  await frequency().waitFor();
  assert.equal(await frequency().inputValue(), "weekly");
  const update = page.getByText("Review source update", { exact: true });
  await update.waitFor({ timeout: 140000 });
  await update.click();
  await page
    .getByText(
      "The saved overview from the earlier check contained this sentence.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("heading", { name: "New wording" }).waitFor();
  await button("Mark reviewed").click();
  await update.waitFor({ state: "detached" });
  await check();
  assert.equal(await update.count(), 0);
  await button("Stop following").click();
  await frequency().waitFor({ state: "detached" });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(dir, "topic-follows.json"))),
    [],
  );
  console.log(
    "Packaged consumer checks passed: follow, frequency, restart, quiet checks, scheduled change, review, no repeat, unfollow.",
  );
} finally {
  await app.close();
}
