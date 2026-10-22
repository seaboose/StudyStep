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
const option = (name) =>
  process.argv.find((v) => v.startsWith(name + "="))?.slice(name.length + 1);
const dataDir = path.resolve(
  option("--study-data") ||
    process.env.STUDYSTEP_DATA_DIR ||
    path.join(app.getPath("userData"), "study-data"),
);
const profileDir = path.join(dataDir, "desktop-profile");
mkdirSync(profileDir, { recursive: true });
app.setPath("userData", profileDir);
app.setPath("sessionData", profileDir);
let window,
  server,
  runtime,
  quitting = false;
app.setName("StudyStep");
app.setAppUserModelId("local.studystep.desktop");
if (!app.requestSingleInstanceLock()) {
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
            },
          });
          runtime.on("error", () => {});
        }
      }
      server = await createLocalServer({ dataDir, port: 0 });
      window = new BrowserWindow({
        width: 1260,
        height: 920,
        minWidth: 700,
        minHeight: 600,
        show: false,
        title: "StudyStep",
        backgroundColor: "#f5f6ef",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
        },
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
        ]),
      );
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
      window.show();
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
