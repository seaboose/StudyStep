import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTopicFollows } from "../scripts/topic-follows.mjs";

test("a learner can follow, review a changed source once, reopen and unfollow", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "studystep-follow-release-"));
  let extract =
    "A sampling instrument monitors water quality at a fixed site. It records observations every thirty minutes.";
  const fetcher = async () =>
    Response.json({ query: { pages: [{ title: "Field sampling", extract }] } });
  let store = createTopicFollows(dir, fetcher);
  const act = (action, extra = {}) =>
    store.command({ action, pageId: 7, ...extra });
  await act("follow", { cadence: "daily" });
  await act("cadence", { cadence: "weekly" });
  assert.equal((await act("check"))[0].pending, null);
  extract = extract.replace("thirty", "sixty");
  const update = (await act("check"))[0].pending;
  assert.match(update.added.join(" "), /sixty/);
  assert.match(update.removed.join(" "), /thirty/);
  await assert.rejects(act("review", { token: "obsolete" }));
  await act("review", { token: update.token });
  await store.close();
  store = createTopicFollows(dir, fetcher);
  const [saved] = await act("check");
  assert.equal(saved.cadence, "weekly");
  assert.equal(saved.pending, null);
  assert.deepEqual(await act("unfollow"), []);
  await store.close();
});
