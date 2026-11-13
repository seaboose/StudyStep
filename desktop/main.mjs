import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  powerMonitor,
  shell,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createLocalServer } from "../scripts/local-server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const hiddenTest = process.env.STUDYSTEP_TEST_HIDDEN === "1";
if (hiddenTest && !app.isReady()) app.disableHardwareAcceleration();
const option = (name) =>
  process.argv.find((v) => v.startsWith(name + "="))?.slice(name.length + 1);
const development = !app.isPackaged && process.env.STUDYSTEP_CHANNEL === "development";
const appName = development ? "StudyStep Dev" : "StudyStep";
app.setName(appName);
app.setAppUserModelId(development ? "local.studystep.development" : "local.studystep.desktop");
const dataDir = path.resolve(
  option("--study-data") ||
    process.env.STUDYSTEP_DATA_DIR ||
    path.join(app.getPath("appData"), appName, "study-data"),
);
const profileDir = path.join(dataDir, "desktop-profile");
mkdirSync(profileDir, { recursive: true });
app.setPath("userData", profileDir);
app.setPath("sessionData", profileDir);
let window,
  server,
  runtime,
  quitting = false;
if (!globalThis[Symbol.for("studystep.instance-lock")] && !app.requestSingleInstanceLock()) {
  console.info("An existing StudyStep window owns this workspace.");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      const ollamaRoot =
        option("--ollama-root") ||
        process.env.STUDYSTEP_OLLAMA_ROOT ||
        path.join(root, ".runtime", "ollama");
      const binary = path.join(ollamaRoot, "bin", "ollama.exe");
      if (existsSync(binary)) {
        let running = false;
        try {
          running = (
            await fetch("http://127.0.0.1:11434/api/tags", {
              signal: AbortSignal.timeout(1200),
            })
          ).ok;
        } catch {}
        if (!running) {
          runtime = spawn(binary, ["serve"], {
            windowsHide: true,
            stdio: "ignore",
            env: {
              ...process.env,
              OLLAMA_HOST: "127.0.0.1:11434",
              OLLAMA_MODELS: path.join(ollamaRoot, "models"),
              OLLAMA_NO_CLOUD: "1",
              OLLAMA_CONTEXT_LENGTH: "16384",
              OLLAMA_FLASH_ATTENTION: "1",
              OLLAMA_KV_CACHE_TYPE: "q8_0",
              OLLAMA_NUM_PARALLEL: "1",
              USERPROFILE: path.join(ollamaRoot, "profile"),
            },
          });
          runtime.on("error", () => {});
        }
      }
      server = await createLocalServer({ dataDir, port: 0, agentsEnabled: development });
      window = new BrowserWindow({
        width: 1260,
        height: 920,
        minWidth: 700,
        minHeight: 600,
        show: false,
        title: appName,
        icon: path.join(root, "desktop", development ? "icon-dev.ico" : "icon.ico"),
        backgroundColor: "#e7ecf2",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
          devTools: development,
          offscreen: hiddenTest,
        },
      });
      window.on("page-title-updated", (event) => {
        event.preventDefault();
        window.setTitle(development ? "StudyStep — Development" : "StudyStep");
      });
      const openReference = (url) => {
        try {
          const u = new URL(url);
          if (
            u.protocol === "https:" &&
            !u.username &&
            !u.password &&
            [
              "en.wikipedia.org",
              "www.psychologicalscience.org",
              "doi.org",
            ].includes(u.hostname)
          )
            void shell.openExternal(u.href);
        } catch {}
      };
      window.webContents.setWindowOpenHandler(({ url }) => {
        openReference(url);
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== server.url) {
          event.preventDefault();
          openReference(url);
        }
      });
      window.webContents.session.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false),
      );
      window.webContents.session.setPermissionCheckHandler(() => false);
      window.webContents.on("will-prevent-unload", async (event) => {
        quitting = false;
        // Respect the study editor's unsaved-work protection by keeping the window open.
        await dialog.showMessageBox(window, {
          type: "info",
          title: "Your changes are not saved yet",
          message:
            "Keep StudyStep open until the workspace says All changes saved and the editor says Draft saved on this computer. If saving failed, retry it before closing.",
          buttons: ["Keep working"],
        });
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "StudyStep",
            submenu: [
              {
                label: "Open local data folder",
                click: () => void shell.openPath(dataDir),
              },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          {
            label: "Edit",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "View",
            submenu: [
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
              { role: "togglefullscreen" },
            ],
          },
          ...(development ? [{
            label: "Developer",
            submenu: [
              { label: "Toggle interface inspector", accelerator: "F12", click: () => window.webContents.toggleDevTools() },
              { label: "Open source folder", click: () => void shell.openPath(root) },
              { label: "About development mode", click: () => void dialog.showMessageBox(window, {
                type: "info", message: "StudyStep development workspace",
                detail: "F12 or Ctrl+Shift+I opens the inspector. Right-click an element to inspect it. Save lasting edits in the source folder, then close and reopen StudyStep Dev to rebuild. Dev study data is stored separately from StudyStep.",
              }) },
            ],
          }] : []),
        ]),
      );
      if (development) {
        window.webContents.on("context-menu", (_event, params) => {
          Menu.buildFromTemplate([{ label: "Inspect element", click: () => window.webContents.inspectElement(params.x, params.y) }]).popup({ window });
        });
        window.webContents.on("before-input-event", (event, input) => {
          if (input.type === "keyDown" && (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i"))) {
            event.preventDefault();
            window.webContents.toggleDevTools();
          }
        });
      }
      powerMonitor.on(
        "suspend",
        () => void server.pauseFocus().catch(() => {}),
      );
      window.on("close", (event) => {
        if (!quitting) {
          event.preventDefault();
          void (async () => {
            try {
              await server.pauseFocus();
            } catch (e) {
              await dialog.showMessageBox(window, {
                type: "error",
                message: "Your focus time could not be saved.",
                detail: e.message,
                buttons: ["Keep open"],
              });
              return;
            }
            quitting = true;
            window.close();
          })();
        }
      });
      window.on("closed", () => {
        window = null;
        app.quit();
      });
      await window.loadURL(server.url);
      if (!hiddenTest) window.show();
    } catch (e) {
      dialog.showErrorBox("StudyStep could not open", e.message);
      runtime?.kill();
      app.quit();
    }
  });
  app.on("before-quit", (event) => {
    if (server && !quitting) {
      event.preventDefault();
      window?.close();
    }
  });
  app.on("will-quit", () => {
    runtime?.kill();
    void server?.close().catch(() => {});
  });
}
