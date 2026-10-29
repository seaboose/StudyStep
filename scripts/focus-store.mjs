import { readFile, writeFile, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import {
  focusSchema,
  emptyFocus,
  applyFocusCommand,
  reconcileFocus,
} from "../.runtime/local-server/focus.mjs";

export function createFocusStore(dataDir, clock = Date.now) {
  const file = path.join(dataDir, "focus.json");
  let pending = Promise.resolve();
  const locked = (fn) => {
    const next = pending.then(fn);
    pending = next.catch(() => {});
    return next;
  };
  async function read() {
    try {
      return focusSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (e) {
      if (e.code === "ENOENT") return emptyFocus();
      throw new Error(
        "Your focus journal could not be read. It has not been reset. Keep focus.json and focus.previous.json for recovery.",
      );
    }
  }
  async function save(state) {
    try {
      await copyFile(file, path.join(dataDir, "focus.previous.json"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await writeFile(
      file + ".tmp",
      JSON.stringify(focusSchema.parse(state), null, 2),
      "utf8",
    );
    await rename(file + ".tmp", file);
  }
  async function transact(command) {
    const before = await read(),
      now = clock();
    const next = command
      ? applyFocusCommand(before, command, now)
      : reconcileFocus(before, now);
    if (JSON.stringify(before) !== JSON.stringify(next)) await save(next);
    return { state: next, serverNow: now };
  }
  return {
    get: () => locked(() => transact()),
    command: (input) => locked(() => transact(input)),
  };
}
