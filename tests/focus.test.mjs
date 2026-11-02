import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  emptyFocus,
  applyFocusCommand,
  reconcileFocus,
  focusSchema,
} from "../.runtime/local-server/focus.mjs";
import { createFocusStore } from "../scripts/focus-store.mjs";
import { createLocalServer } from "../scripts/local-server.mjs";
const start = (state = emptyFocus(), now = 100000, kind = "focus") =>
  applyFocusCommand(
    state,
    {
      type: "start",
      id: crypto.randomUUID(),
      minutes: 5,
      task: "Read two pages",
      kind,
    },
    now,
  );
function advance(state, from, to) {
  for (let time = from + 10000; time <= to; time += 10000)
    state = reconcileFocus(state, time);
  return state;
}
test("a small step starts immediately; repeated start IDs are harmless", () => {
  const s = start();
  assert.equal(s.active.status, "running");
  assert.equal(s.coins, 0);
  assert.deepEqual(
    applyFocusCommand(
      s,
      {
        type: "start",
        id: s.active.id,
        minutes: 5,
        task: "Read two pages",
        kind: "focus",
      },
      100000,
    ),
    s,
  );
  assert.throws(() => start(s), /current session/);
});
test("pause and resume exclude paused time", () => {
  let s = start();
  const id = s.active.id;
  s = applyFocusCommand(s, { type: "pause", id }, 110000);
  assert.equal(s.active.elapsedMs, 10000);
  s = reconcileFocus(s, 500000);
  assert.equal(s.active.elapsedMs, 10000);
  s = applyFocusCommand(s, { type: "resume", id }, 500000);
  s = reconcileFocus(s, 510000);
  assert.equal(s.active.elapsedMs, 20000);
});
test("full completion rewards once even on retry", () => {
  let s = start();
  const id = s.active.id;
  s = advance(s, 100000, 400000);
  assert.equal(s.active, null);
  assert.equal(s.coins, 5);
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].outcome, "completed");
  s = applyFocusCommand(s, { type: "finish", id }, 500000);
  assert.equal(s.coins, 5);
  assert.equal(s.history.length, 1);
});
test("early finish keeps actual whole minutes and never deducts rewards", () => {
  let s = start();
  const id = s.active.id;
  s = advance(s, 100000, 170000);
  s = applyFocusCommand(s, { type: "finish", id }, 170000);
  assert.equal(s.coins, 1);
  assert.equal(s.history[0].elapsedMs, 70000);
  assert.equal(s.history[0].outcome, "ended");
});
test("sleep, closed app and backward clock changes pause at the saved checkpoint", () => {
  const s = reconcileFocus(start(), 110000);
  for (const time of [140001, 90000, 9000000]) {
    const next = reconcileFocus(s, time);
    assert.equal(next.active.status, "paused");
    assert.equal(next.active.elapsedMs, 10000);
    assert.equal(next.coins, 0);
  }
});
test("breaks are recorded without coins", () => {
  const s = advance(start(emptyFocus(), 100000, "break"), 100000, 400000);
  assert.equal(s.coins, 0);
  assert.equal(s.history[0].kind, "break");
});
test("species unlock charges once and prevents negative balances", () => {
  assert.throws(
    () =>
      applyFocusCommand(
        emptyFocus(),
        { type: "species", species: "cherry" },
        100000,
      ),
    /more leaves/,
  );
  let s = { ...emptyFocus(), coins: 40 };
  s = applyFocusCommand(s, { type: "species", species: "cherry" }, 100000);
  assert.equal(s.coins, 10);
  s = applyFocusCommand(s, { type: "species", species: "cherry" }, 100000);
  assert.equal(s.coins, 10);
  assert.deepEqual(s.unlocked, ["oak", "cherry"]);
});
test("invalid durations, stale session commands and forged fields are rejected", () => {
  assert.throws(() =>
    applyFocusCommand(
      emptyFocus(),
      {
        type: "start",
        id: crypto.randomUUID(),
        minutes: 7,
        task: "",
        kind: "focus",
      },
      100000,
    ),
  );
  assert.throws(
    () =>
      applyFocusCommand(
        start(),
        { type: "finish", id: crypto.randomUUID() },
        100000,
      ),
    /session changed/,
  );
  assert.throws(() =>
    applyFocusCommand(
      emptyFocus(),
      { type: "motion", value: true, coins: 100 },
      100000,
    ),
  );
  assert.throws(() => focusSchema.parse({ ...emptyFocus(), selected: "pine" }));
});
test("focus journal survives restart and serializes concurrent purchases", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studystep-focus-"));
  let time = 100000;
  let store = createFocusStore(dir, () => time);
  const id = crypto.randomUUID();
  await store.command({
    type: "start",
    id,
    minutes: 5,
    task: "Test",
    kind: "focus",
  });
  time = 110000;
  await store.get();
  store = createFocusStore(dir, () => 500000);
  const restored = await store.get();
  assert.equal(restored.state.active.status, "paused");
  assert.equal(restored.state.active.elapsedMs, 10000);
  await writeFile(
    path.join(dir, "focus.json"),
    JSON.stringify({ ...emptyFocus(), coins: 40 }),
  );
  await Promise.all([
    store.command({ type: "species", species: "cherry" }),
    store.command({ type: "species", species: "cherry" }),
  ]);
  assert.equal((await store.get()).state.coins, 10);
});
test("corrupt focus state stays untouched", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studystep-corrupt-"));
  await writeFile(path.join(dir, "focus.json"), "{bad");
  await assert.rejects(() => createFocusStore(dir).get(), /has not been reset/);
  assert.equal(await readFile(path.join(dir, "focus.json"), "utf8"), "{bad");
});
test("focus routes persist separately, reject cross-origin writes, and pause on server close", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studystep-focus-api-"));
  let app = await createLocalServer({
    port: 0,
    dataDir: dir,
    fetcher: async () => {
      throw Error("offline");
    },
  });
  const call = (method = "GET", body, origin = app.url) =>
    fetch(app.url + "/api/focus", {
      method,
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const id = crypto.randomUUID();
    assert.equal(
      (
        await call(
          "POST",
          { type: "start", id, minutes: 5, task: "Test focus", kind: "focus" },
          "https://untrusted.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call("POST", {
          type: "start",
          id,
          minutes: 5,
          task: "Test focus",
          kind: "focus",
        })
      ).status,
      200,
    );
    await assert.rejects(() => readFile(path.join(dir, "workspace.json")));
    await app.close();
    app = await createLocalServer({
      port: 0,
      dataDir: dir,
      fetcher: async () => {
        throw Error("offline");
      },
    });
    assert.equal((await (await call()).json()).state.active.status, "paused");
  } finally {
    await app.close();
  }
});
