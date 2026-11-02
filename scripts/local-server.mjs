import http from "node:http";
import path from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  copyFile,
  stat,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  emptyWorkspace,
  totalText,
  validateSources,
} from "../.runtime/local-server/study.mjs";
import { validateLocalWorkspace } from "../.runtime/local-server/local-study.mjs";
import { generateLocalDraft } from "./local-generation.mjs";
import { listModels } from "./local-model.mjs";
import { createFocusStore } from "./focus-store.mjs";
import { createReviewStore } from "./review-store.mjs";
import { createDraftStore } from "./draft-store.mjs";
import { selectPassages } from "../.runtime/local-server/selection.mjs";
import { searchTopics, topicSource } from "./topic-search.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function createLocalServer({
  dataDir = path.join(root, ".local-data"),
  port = 5173,
  fetcher = fetch,
  topicFetcher = fetch,
} = {}) {
  await mkdir(dataDir, { recursive: true });
  const focusStore = createFocusStore(dataDir);
  const reviewStore = createReviewStore(dataDir, load);
  const draftStore = createDraftStore(dataDir, load);
  const workspacePath = path.join(dataDir, "workspace.json"),
    settingsPath = path.join(dataDir, "settings.json");
  let pendingWrite = Promise.resolve(),
    job = null,
    controller = null,
    generationBusy = false;
  const locked = (fn) => {
    const result = pendingWrite.then(fn);
    pendingWrite = result.catch(() => {});
    return result;
  };
  async function load() {
    try {
      const value = JSON.parse(await readFile(workspacePath, "utf8"));
      if (!Number.isSafeInteger(value.revision) || value.revision < 0)
        throw Error();
      return {
        data: validateLocalWorkspace(value.data),
        revision: value.revision,
      };
    } catch (e) {
      if (e.code === "ENOENT") return { data: emptyWorkspace(), revision: 0 };
      throw new Error(
        "The local workspace could not be read. Your files were left untouched. Restore a backup or inspect .local-data/workspace.previous.json.",
      );
    }
  }
  async function atomicSave(file, value) {
    const temp = file + ".tmp";
    await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    await rename(temp, file);
  }
  async function save(data, revision) {
    return locked(async () => {
      const current = await load();
      if (current.revision !== revision) {
        const e = new Error(
          "This workspace changed in another tab. Reload your saved workspace.",
        );
        e.status = 409;
        throw e;
      }
      const next = {
        data: validateLocalWorkspace(data),
        revision: revision + 1,
      };
      try {
        await copyFile(
          workspacePath,
          path.join(dataDir, "workspace.previous.json"),
        );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      await atomicSave(workspacePath, next);
      return next;
    });
  }
  async function settings() {
    try {
      return JSON.parse(await readFile(settingsPath, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return { model: "" };
      throw new Error("Local AI settings could not be read.");
    }
  }
  async function modelState() {
    const selected = await settings();
    try {
      const models = await listModels(fetcher);
      return {
        connected: true,
        models,
        model: selected.model || "",
        ready: models.some((m) => m.name === selected.model),
      };
    } catch {
      return {
        connected: false,
        models: [],
        model: selected.model || "",
        ready: false,
      };
    }
  }
  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2_500_000) {
        const e = new Error(
          "This request is too large. Use a smaller study set.",
        );
        e.status = 413;
        throw e;
      }
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("Expected valid JSON.");
    }
  }
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const reply = (value, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    // Bind to loopback and reject remote origins and DNS rebinding, including reads.
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return reply({ error: "Open StudyStep using its local address." }, 403);
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "POST", "PUT", "DELETE"].includes(req.method))
        return reply({ error: "Method not allowed." }, 405);
      if (
        req.method !== "GET" &&
        (req.headers.origin !== origin ||
          !req.headers["content-type"]?.includes("application/json"))
      )
        return reply({ error: "Use the StudyStep app to make changes." }, 403);
      try {
        if (url.pathname === "/api/editor-draft") {
          if (req.method === "GET") return reply(await draftStore.get());
          if (req.method === "PUT")
            return reply(await draftStore.put(await body(req)));
          if (req.method === "DELETE")
            return reply(await draftStore.discard(await body(req)));
        }
        if (url.pathname === "/api/review") {
          if (req.method === "GET") return reply(await reviewStore.get());
          if (req.method === "POST")
            return reply(await reviewStore.command(await body(req)));
        }
        if (url.pathname === "/api/topics" && req.method === "POST")
          return reply({
            results: await searchTopics((await body(req)).query, topicFetcher),
          });
        if (url.pathname === "/api/topics/source" && req.method === "POST")
          return reply({
            source: await topicSource((await body(req)).pageId, topicFetcher),
          });
        if (url.pathname === "/api/focus") {
          if (req.method === "GET") return reply(await focusStore.get());
          if (req.method === "POST")
            return reply(await focusStore.command(await body(req)));
        }
        if (url.pathname === "/api/local-model") {
          if (req.method === "GET") return reply(await modelState());
          if (req.method === "PUT") {
            const value = await body(req),
              models = await listModels(fetcher);
            if (!models.some((m) => m.name === value.model))
              throw new Error("Choose an installed local model.");
            await atomicSave(settingsPath, { model: value.model });
            return reply(await modelState());
          }
        }
        if (url.pathname === "/api/workspace") {
          if (req.method === "GET") {
            const state = await load();
            return reply({ ...state, aiReady: (await modelState()).ready });
          }
          if (req.method === "PUT") {
            const value = await body(req);
            return reply(await save(value.data, value.revision));
          }
          if (req.method === "DELETE") {
            const value = await body(req);
            return reply(await save(emptyWorkspace(), value.revision));
          }
        }
        if (url.pathname === "/api/generate") {
          if (req.method === "GET") return reply(job);
          if (req.method === "DELETE") {
            if (controller) controller.abort();
            else job = null;
            return reply({ cancelled: true });
          }
          if (req.method === "POST") {
            if (generationBusy)
              return reply(
                { error: "A local generation is already running." },
                409,
              );
            generationBusy = true;
            controller = new AbortController();
            job = { status: "running", created_at: Date.now() };
            try {
              const value = await body(req),
                current = await load();
              if (current.revision !== value.revision) {
                const e = new Error(
                  "This workspace changed in another tab. Reload before generating.",
                );
                e.status = 409;
                throw e;
              }
              validateSources(current.data.sources);
              const sources = selectPassages(
                current.data.sources,
                value.passageIds,
              );
              const recovery = await draftStore.get();
              if (recovery.draft)
                throw Error(
                  "Resume or discard your saved draft before generating another.",
                );
              const config = await modelState();
              if (!config.ready)
                throw new Error(
                  "Open Local AI, start Ollama, and choose an installed model. Manual study sets always work.",
                );
              // Check the running daemon describes this as a local model, not a cloud alias.
              const info = await fetcher("http://127.0.0.1:11434/api/show", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: config.model }),
                signal: AbortSignal.timeout(5000),
                redirect: "error",
              });
              if (!info.ok) throw new Error("The local model is unavailable.");
              const details = await info.json();
              if (details.remote_host || details.remote_model)
                throw new Error(
                  "Cloud models are disabled. Choose a downloaded local model.",
                );
              if (controller.signal.aborted)
                throw new Error(
                  "Local generation cancelled. Your previous set is unchanged.",
                );
              try {
                const result = await generateLocalDraft(
                  sources,
                  config.model,
                  controller.signal,
                  fetcher,
                  (stage) => {
                    job = { ...job, stage };
                  },
                );
                if (controller.signal.aborted)
                  throw new Error("Local generation cancelled.");
                if ((await load()).revision !== current.revision) {
                  const e = new Error(
                    "This workspace changed in another tab. Generate again from the current material.",
                  );
                  e.status = 409;
                  throw e;
                }
                const omitted =
                  current.data.sources.flatMap((s) => s.passages).length -
                  sources.flatMap((s) => s.passages).length;
                if (omitted)
                  result.draft.gaps = [
                    ...result.draft.gaps.slice(0, 10),
                    `${omitted} source sections were left out of this generation. This set does not cover those sections.`,
                  ];
                result.reviewProblems.push(
                  "Automated checks passed, but answers can still be wrong. Compare each card with its sources.",
                );
                await draftStore.put({
                  version: recovery.version,
                  baseKey: recovery.baseKey,
                  guide: result.draft,
                  problems: result.reviewProblems,
                });
                job = {
                  ...job,
                  status: "draft",
                  ...result,
                  revision: current.revision,
                };
                return reply({ ...current, ...result });
              } catch (e) {
                job = {
                  ...job,
                  status: "failed",
                  error: controller.signal.aborted
                    ? "Local generation cancelled. Your previous set is unchanged."
                    : e.message,
                };
                throw new Error(job.error);
              }
            } catch (e) {
              if (job?.status === "running")
                job = { ...job, status: "failed", error: e.message };
              throw e;
            } finally {
              generationBusy = false;
              controller = null;
            }
          }
        }
        return reply({ error: "Not found." }, 404);
      } catch (e) {
        return reply(
          {
            error:
              e.name === "ZodError"
                ? "Some study-set fields are missing or invalid. Check the editor or import file."
                : e.message || "Could not finish this action.",
          },
          e.status || 400,
        );
      }
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      return reply({ error: "Method not allowed." }, 405);
    try {
      const publicRoot = path.resolve(root, ".local-dist");
      let target = path.resolve(
        publicRoot,
        "." + decodeURIComponent(url.pathname),
      );
      if (target !== publicRoot && !target.startsWith(publicRoot + path.sep))
        return reply({ error: "Not found." }, 404);
      if (url.pathname === "/") target = path.join(publicRoot, "index.html");
      if (!(await stat(target)).isFile())
        return reply({ error: "Not found." }, 404);
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
        ".ico": "image/x-icon",
      };
      res.writeHead(200, {
        "Content-Type":
          types[path.extname(target)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'",
      });
      res.end(req.method === "HEAD" ? undefined : await readFile(target));
    } catch {
      return reply(
        {
          error:
            "Not found. Start StudyStep with Start StudyStep.cmd to build the app.",
        },
        404,
      );
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const pauseFocus = async () => {
    const { state } = await focusStore.get();
    if (state.active?.status === "running")
      await focusStore.command({ type: "pause", id: state.active.id });
  };
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    pauseFocus,
    close: async () => {
      await pauseFocus();
      return new Promise((resolve) => {
        controller?.abort();
        server.close(resolve);
        server.closeAllConnections();
      });
    },
  };
}
