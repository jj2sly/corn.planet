import { app, BrowserWindow, Menu, WebContentsView, clipboard, ipcMain, shell } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PARTY_URL = process.env.CPI_PARTY_URL?.trim() || "http://127.0.0.1:3000";
const DEFAULT_DATABASE_URL = process.env.CPI_DATABASE_URL?.trim() || "https://jj2sly.github.io/corn.planet";
const SIDEBAR_WIDTH = 220;

let mainWindow = null;
let contentView = null;
let activeTarget = "home";
let settings = null;

const GAME_IDS = new Set(["chaos", "cornorshit", "entityauction", "mycob", "steamdeck", "thud"]);
const PC_GAME_IDS = new Set(["cornorshit-solo"]);

function cleanBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function settingsPath() {
  return path.join(app.getPath("userData"), "desktop-settings.json");
}

function loadSettings() {
  if (settings) return settings;
  settings = {
    partyBase: cleanBase(DEFAULT_PARTY_URL),
    databaseBase: cleanBase(DEFAULT_DATABASE_URL),
  };
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    if (saved?.partyBase) settings.partyBase = cleanBase(saved.partyBase);
    if (saved?.databaseBase) settings.databaseBase = cleanBase(saved.databaseBase);
  } catch {}
  return settings;
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

function destination(target) {
  const current = loadSettings();
  const destinations = {
    party: `${current.partyBase}/host`,
    account: `${current.partyBase}/account`,
    prompts: `${current.partyBase}/prompts`,
    hall: `${current.partyBase}/hall`,
    database: current.databaseBase,
  };
  return destinations[target] || null;
}

function emitActiveTarget() {
  mainWindow?.webContents.send("cpi:active-target", activeTarget);
}

function contentBounds() {
  if (!mainWindow) return { x: SIDEBAR_WIDTH, y: 0, width: 1000, height: 700 };
  const [width, height] = mainWindow.getContentSize();
  return {
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(1, width - SIDEBAR_WIDTH),
    height: Math.max(1, height),
  };
}

function closeContentView() {
  if (!mainWindow || !contentView) return;
  try {
    mainWindow.contentView.removeChildView(contentView);
  } catch {}
  try {
    contentView.webContents.close();
  } catch {}
  contentView = null;
}

function handleWindowOpen({ url }) {
  const current = loadSettings();
  if (url.startsWith(current.partyBase) || url.startsWith(current.databaseBase)) {
    if (contentView) contentView.webContents.loadURL(url);
    return { action: "deny" };
  }
  void shell.openExternal(url);
  return { action: "deny" };
}

function openContent(url, target) {
  if (!mainWindow) return;

  closeContentView();

  contentView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  contentView.setBackgroundColor("#050607");
  contentView.setBounds(contentBounds());
  contentView.webContents.setWindowOpenHandler(handleWindowOpen);

  contentView.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    const failed = activeTarget;
    closeContentView();
    activeTarget = "home";
    emitActiveTarget();
    mainWindow?.webContents.send("cpi:content-error", {
      target: failed,
      url: validatedURL,
      message: errorDescription || "Content could not be loaded.",
    });
  });

  contentView.webContents.on("will-navigate", (event, nextUrl) => {
    const current = loadSettings();
    if (
      nextUrl.startsWith(current.partyBase) ||
      nextUrl.startsWith(current.databaseBase) ||
      nextUrl.startsWith("file://")
    ) return;
    event.preventDefault();
    void shell.openExternal(nextUrl);
  });

  mainWindow.contentView.addChildView(contentView);
  activeTarget = target;
  emitActiveTarget();
  void contentView.webContents.loadURL(url);
}

function openPcLibrary() {
  const url = pathToFileURL(path.join(__dirname, "pc", "index.html")).toString();
  openContent(url, "pc-games");
}

function launchPcGame(gameId) {
  if (!PC_GAME_IDS.has(gameId)) throw new Error("Unknown CPI PC game");
  if (gameId === "cornorshit-solo") {
    const url = pathToFileURL(path.join(__dirname, "pc", "cornorshit.html")).toString();
    openContent(url, "pc-games");
  }
}

function createWindow() {
  loadSettings();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#050607",
    title: "CPI Party",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("resize", () => {
    if (contentView) contentView.setBounds(contentBounds());
  });

  mainWindow.on("closed", () => {
    contentView = null;
    mainWindow = null;
  });

  installMenu();
}

function goHome() {
  if (!mainWindow) return;
  closeContentView();
  activeTarget = "home";
  emitActiveTarget();
}

function navigate(target) {
  if (!mainWindow) return;
  if (target === "home") return goHome();
  if (target === "pc-games") return openPcLibrary();
  const url = destination(target);
  if (url) openContent(url, target);
}

function activeWebContents() {
  return contentView?.webContents ?? mainWindow?.webContents ?? null;
}

function installMenu() {
  const template = [
    {
      label: "CPI Party",
      submenu: [
        { label: "Command Center", accelerator: "CmdOrCtrl+Shift+H", click: () => goHome() },
        { label: "Party Host", accelerator: "CmdOrCtrl+Shift+P", click: () => navigate("party") },
        { label: "Corn or Shit — Solo", accelerator: "CmdOrCtrl+Shift+G", click: () => launchPcGame("cornorshit-solo") },
        {
          label: "Copy Phone Join Link",
          accelerator: "CmdOrCtrl+Shift+J",
          click: () => clipboard.writeText(`${loadSettings().partyBase}/play`),
        },
        { type: "separator" },
        {
          label: "Reload Current View",
          accelerator: "CmdOrCtrl+R",
          click: () => activeWebContents()?.reload(),
        },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "CPI",
      submenu: [
        { label: "CPI Database", click: () => navigate("database") },
        { label: "Account", click: () => navigate("account") },
        { label: "Prompts & Moderation", click: () => navigate("prompts") },
        { label: "Hall of Fame", click: () => navigate("hall") },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Back",
          accelerator: "Alt+Left",
          click: () => {
            const contents = activeWebContents();
            if (contents?.canGoBack()) contents.goBack();
          },
        },
        {
          label: "Forward",
          accelerator: "Alt+Right",
          click: () => {
            const contents = activeWebContents();
            if (contents?.canGoForward()) contents.goForward();
          },
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("cpi:navigate", (_event, target) => {
  navigate(String(target));
  return true;
});

ipcMain.handle("cpi:copy-player-link", () => {
  const url = `${loadSettings().partyBase}/play`;
  clipboard.writeText(url);
  return url;
});

ipcMain.handle("cpi:config", () => ({
  ...loadSettings(),
  activeTarget,
  version: app.getVersion(),
}));

ipcMain.handle("cpi:launch-game", (_event, gameId) => {
  const id = String(gameId);
  if (!GAME_IDS.has(id)) throw new Error("Unknown CPI Party game");
  const current = loadSettings();
  openContent(`${current.partyBase}/host?game=${encodeURIComponent(id)}`, "party");
  return true;
});

ipcMain.handle("cpi:launch-pc-game", (_event, gameId) => {
  launchPcGame(String(gameId));
  return true;
});

ipcMain.handle("cpi:fetch-canon", async () => {
  const current = loadSettings();
  try {
    const response = await fetch(`${current.partyBase}/api/native/canon`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { ok: false, status: response.status };
    const data = await response.json();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Canon request failed" };
  }
});

ipcMain.handle("cpi:readiness", async () => {
  const current = loadSettings();
  const result = {
    server: false,
    games: 0,
    canon: 0,
    protocol: 0,
    issues: [],
  };

  try {
    const [healthResponse, gamesResponse, canonResponse] = await Promise.all([
      fetch(`${current.partyBase}/api/native/health`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${current.partyBase}/api/native/games`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${current.partyBase}/api/native/canon`, { signal: AbortSignal.timeout(8000) }),
    ]);

    if (healthResponse.ok) {
      const health = await healthResponse.json();
      result.server = true;
      result.protocol = Number(health.protocol || 0);
    } else {
      result.issues.push("Native Party bridge health check failed.");
    }

    if (gamesResponse.ok) {
      const games = await gamesResponse.json();
      const installedIds = new Set(Array.isArray(games.games) ? games.games.map((game) => String(game?.id || "")) : []);
      result.games = [...GAME_IDS].filter((id) => installedIds.has(id)).length;
      const missing = [...GAME_IDS].filter((id) => !installedIds.has(id));
      if (missing.length) result.issues.push(`Missing Party games: ${missing.join(", ")}.`);
    } else {
      result.issues.push("Game catalog could not be loaded.");
    }

    if (canonResponse.ok) {
      const canon = await canonResponse.json();
      result.canon = Array.isArray(canon.records) ? canon.records.length : Number(canon.status?.records || 0);
      if (result.canon < 2) result.issues.push("CPI canon is too small for canon-driven games.");
    } else {
      result.issues.push("CPI canon could not be loaded.");
    }
  } catch (error) {
    result.issues.push(error instanceof Error ? error.message : "Readiness check failed.");
  }

  if (!result.server) result.issues.unshift("Party server is offline.");
  return result;
});

ipcMain.handle("cpi:check-server", async () => {
  const current = loadSettings();
  try {
    const response = await fetch(`${current.partyBase}/healthz`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: false, status: response.status };
    const data = await response.json();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Connection failed" };
  }
});

ipcMain.handle("cpi:set-party-url", (_event, value) => {
  const url = cleanBase(value);
  if (!/^https?:\/\//i.test(url)) throw new Error("Party server URL must start with http:// or https://");
  settings = { ...loadSettings(), partyBase: url };
  saveSettings();
  return { ...settings };
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!mainWindow) createWindow();
});
