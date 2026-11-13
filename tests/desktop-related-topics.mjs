import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron } from "playwright";
const executable =
  process.env.STUDYSTEP_TEST_EXE ||
  JSON.parse(await readFile("desktop/latest-build.json")).executable;
const dir = await mkdtemp(path.join(tmpdir(), "studystep-discovery-"));
const launch = () =>
  _electron.launch({
    executablePath: executable,
    args: [`--study-data=${dir}`],
    env: { ...process.env, STUDYSTEP_TEST_HIDDEN: "1" },
  });
async function installSearchFixture(page) {
  if (process.env.STUDYSTEP_SEARCH_FIXTURE !== "1") return;
  await page.route("**/api/topics", (route) =>
    route.fulfill({
      json: {
        results: [
          {
            pageId: 1,
            title: "DNS resolver",
            description: "A resolver obtains IP addresses for domain names.",
          },
          {
            pageId: 2,
            title: "DNS caching",
            description: "Cached DNS responses speed up name resolution.",
          },
        ],
      },
    }),
  );
}
let app = await launch();
try {
  let page = await app.firstWindow();
  await installSearchFixture(page);
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page
    .getByText("Study-set tools · local AI, editing & backups", { exact: true })
    .click();
  await button("Import set").click();
  await page
    .getByLabel("Study set JSON")
    .fill(await readFile("examples/studystep-example.json", "utf8"));
  await button("Preview import").click();
  await button("Replace workspace with this import").click();
  await button("Create a set").click();
  const region = () => page.getByRole("region", { name: "Related topics" });
  await button("Suggest related topics").click();
  const cards = () => region().locator("article");
  await cards().nth(1).waitFor();
  const first = cards().first();
  assert.match(await first.innerText(), /Why it fits.*What DNS does/s);
  assert.match(
    await first.innerText(),
    /Know first.*DNS resolves names to IP addresses/s,
  );
  const accepted = await first.locator("h3").innerText();
  await first.getByText("Accept topic", { exact: true }).click();
  const dismissed = await first.locator("h3").innerText();
  await first.getByText("Dismiss", { exact: true }).click();
  await region().getByText(accepted, { exact: true }).click();
  assert.match(
    await region()
      .getByRole("link", { name: "Read article" })
      .getAttribute("href"),
    /^https:\/\/en.wikipedia.org\/\?curid=\d+$/,
  );
  await page.getByText("All changes saved", { exact: true }).waitFor();
  const state = JSON.parse(
    await readFile(path.join(dir, "workspace.json")),
  ).data;
  assert.equal(state.relatedTopics.length, 2);
  assert.equal(state.guide.title, "Example · Networking basics");
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await installSearchFixture(page);
  await button("Create a set").click();
  await region().getByText(accepted, { exact: true }).waitFor();
  await button("Suggest related topics").click();
  await button("Suggest related topics").waitFor();
  assert.equal(await cards().getByText(accepted, { exact: true }).count(), 0);
  assert.equal(await region().getByText(dismissed, { exact: true }).count(), 0);
  console.log(
    "Packaged discovery passed: suggestions, relevance, prerequisite, accept, dismiss and restart.",
  );
} finally {
  await app.close();
}
