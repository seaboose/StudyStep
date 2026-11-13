import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron } from "playwright";
import { createRequire } from "node:module";
const source = process.env.STUDYSTEP_TEST_SOURCE === "1";
const executable =
  process.env.STUDYSTEP_TEST_EXE ||
  (source
    ? createRequire(new URL("../desktop/package.json", import.meta.url))(
        "electron",
      )
    : JSON.parse(await readFile("desktop/latest-build.json")).executable);
const dir = await mkdtemp(path.join(tmpdir(), "studystep-next-"));
const launch = () =>
  _electron.launch({
    executablePath: executable,
    args: [
      ...(source ? [path.resolve("desktop/main.mjs")] : []),
      `--study-data=${dir}`,
    ],
    env: { ...process.env, STUDYSTEP_TEST_HIDDEN: "1" },
  });
let app = await launch();
try {
  let page = await app.firstWindow();
  const button = (name) => page.getByRole("button", { name, exact: true });
  const attempts = async () => {
    await page.getByText("All changes saved", { exact: true }).waitFor();
    return JSON.parse(await readFile(path.join(dir, "workspace.json"))).data
      .attempts;
  };
  await page
    .getByText("Study-set tools · local AI, editing & backups", { exact: true })
    .click();
  await button("Import set").click();
  const set = JSON.parse(await readFile("examples/studystep-example.json"));
  set.topics[0].questions.push({
    ...set.topics[0].questions[0],
    prompt: "Which choice describes name resolution?",
  });
  await page.getByLabel("Study set JSON").fill(JSON.stringify(set));
  await button("Preview import").click();
  await button("Replace workspace with this import").click();
  await button("Practice").click();
  const next = () => page.getByRole("region", { name: "Next activity" });
  for (const [mode, reason, suggested] of [
    ["independent", "answered these questions independently", "explain"],
    ["hinted", "used a hint", "guided"],
    ["missed", "missed the question", "guided"],
    ["revealed", "revealed the answer", "guided"],
  ]) {
    assert.equal(await next().count(), 0);
    if (mode === "hinted") await button("Show hint").click();
    if (mode === "revealed")
      await button("I’m not sure — show the explanation").click();
    else {
      await page
        .getByRole("radio")
        .nth(mode === "missed" ? 1 : 0)
        .check();
      await button("Check my answer").click();
    }
    assert.equal(await next().count(), 0);
    await button("Next question").click();
    await page.getByRole("radio").first().check();
    await button("Check my answer").click();
    await next().waitFor();
    assert.ok((await next().innerText()).includes(reason));
    assert.equal(await next().getByLabel("Difficulty").inputValue(), suggested);
    const saved = await attempts();
    assert.equal(saved.length, 2);
    const level =
      mode === "hinted" ? "guided" : mode === "missed" ? "explain" : "recall";
    await next().getByLabel("Difficulty").selectOption(level);
    await next()
      .getByRole("button", { name: /^Start:/ })
      .click();
    if (level !== "guided") await button("Check against reference").click();
    await button("Finish activity").click();
    await page.getByRole("heading", { name: "Activity complete" }).waitFor();
    assert.deepEqual(await attempts(), saved);
    if (mode === "revealed") {
      await app.close();
      app = await launch();
      page = await app.firstWindow();
      await button("Practice").click();
      assert.deepEqual(await attempts(), saved);
      assert.ok((await next().innerText()).includes(reason));
    } else {
      await button("Start another round").click();
      await button("Continue").click();
    }
  }
  const evidence = () =>
    page.getByText("Why these recommendations?", { exact: true });
  const assessment = () => page.getByLabel("Assessment for What DNS does");
  const original = await attempts();
  await evidence().click();
  assert.ok((await next().innerText()).includes("Answer revealed"));
  assert.ok((await next().innerText()).includes("Correct independently"));
  await assessment().selectOption("confident");
  assert.equal(await next().getByLabel("Difficulty").inputValue(), "explain");
  assert.deepEqual(await attempts(), original);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await button("Practice").click();
  await next()
    .getByText(/You marked this topic as confident/)
    .waitFor();
  await button("Start another round").click();
  await button("Continue").click();
  await button("I’m not sure — show the explanation").click();
  await button("Next question").click();
  await page.getByRole("radio").first().check();
  await button("Check my answer").click();
  assert.equal(await next().getByLabel("Difficulty").inputValue(), "explain");
  await evidence().click();
  await assessment().selectOption("practice");
  await next()
    .getByText(/You marked this topic for more practice/)
    .waitFor();
  assert.equal(await next().getByLabel("Difficulty").inputValue(), "guided");
  await assessment().selectOption("");
  await next()
    .getByText(/You revealed the answer/)
    .waitFor();
  assert.equal((await attempts()).length, 2);
  console.log(
    "Packaged consumer practice recommendations, three difficulty activities, override and restart passed.",
  );
} finally {
  await app.close();
}
