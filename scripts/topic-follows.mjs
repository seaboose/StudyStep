import path from "node:path";
import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { topicSource } from "./topic-search.mjs";

const periods = { daily: 1, weekly: 7, monthly: 30 };
const day = 86400000;
const sentences = (text) =>
  [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)]
    .map((s) => s.segment.trim())
    .filter(Boolean);
// Ignore layout, citation numbers and typographic substitutions; retain numbers,
// negation and mathematical punctuation that can change a factual statement.
const normalize = (text) =>
  text
    .normalize("NFKC")
    .replace(/\[\d+\]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
function changes(before, after) {
  const old = sentences(normalize(before)),
    next = sentences(normalize(after));
  return {
    removed: old.filter((s) => !next.includes(s)),
    added: next.filter((s) => !old.includes(s)),
  };
}

export function createTopicFollows(dir, fetcher) {
  const file = path.join(dir, "topic-follows.json");
  let queue = Promise.resolve(),
    timer,
    closed = false,
    checking = false;
  const serial = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  async function load() {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
  async function save(rows) {
    await writeFile(file + ".tmp", JSON.stringify(rows));
    await rename(file + ".tmp", file);
  }
  async function snapshot(id) {
    const source = await topicSource(id, fetcher);
    return {
      title: source.name,
      text: source.passages.map((p) => p.text).join(" "),
    };
  }
  async function check(row) {
    try {
      const next = await snapshot(row.pageId);
      const diff = changes(row.text, next.text);
      if (!diff.added.length && !diff.removed.length) row.pending = null;
      else if (row.pending?.text !== next.text)
        row.pending = { ...next, ...diff, token: randomUUID() };
      row.title = next.title;
      row.error = "";
    } catch (e) {
      row.error = e.message;
    }
    row.checked = Date.now();
  }
  const due = async () => {
    if (closed || checking) return;
    checking = true;
    try {
      const ids = (await serial(load))
        .filter((r) => Date.now() - r.checked >= periods[r.cadence] * day)
        .map((r) => r.pageId);
      for (const id of ids) {
        if (closed) break;
        await serial(async () => {
          const rows = await load(),
            r = rows.find((v) => v.pageId === id);
          if (!r || Date.now() - r.checked < periods[r.cadence] * day) return;
          await check(r);
          await save(rows);
        });
      }
    } finally {
      checking = false;
    }
  };
  return {
    start() {
      const tick = () =>
        due().catch((e) => console.error("Topic check failed:", e.message));
      tick();
      timer = setInterval(tick, 60000);
      timer.unref();
    },
    close() {
      closed = true;
      clearInterval(timer);
      return queue;
    },
    get: () => serial(load),
    command: (cmd) =>
      serial(async () => {
        const { pageId, action, cadence } = cmd;
        if (!Number.isSafeInteger(pageId) || pageId < 1)
          throw Error("Choose a Wikipedia topic.");
        const rows = await load(),
          row = rows.find((r) => r.pageId === pageId);
        if (action === "follow" || action === "cadence") {
          if (!Object.hasOwn(periods, cadence))
            throw Error("Choose a check frequency.");
          if (row) row.cadence = cadence;
          else if (action === "follow")
            rows.push({
              pageId,
              cadence,
              ...(await snapshot(pageId)),
              checked: Date.now(),
              pending: null,
              error: "",
            });
          else throw Error("This topic is no longer followed.");
        } else if (action === "unfollow") {
          if (row) rows.splice(rows.indexOf(row), 1);
        } else if (row && action === "check") await check(row);
        else if (
          row &&
          action === "review" &&
          row.pending &&
          row.pending.token === cmd.token
        ) {
          row.text = row.pending.text;
          row.pending = null;
        } else
          throw Error("This update has changed. Reopen the latest version.");
        await save(rows);
        return rows;
      }),
  };
}
