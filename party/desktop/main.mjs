import { app, BrowserWindow, Menu, WebContentsView, clipboard, ipcMain, shell } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PARTY_URL = process.env.CPI_PARTY_URL?.trim() || "http://127.0.0.1:3000";
const DEFAULT_DATABASE_URL = process.env.CPI_DATABASE_URL?.trim() || "https://jj2sly.github.io/corn.planet";
const SIDEBAR_WIDTH = 220;
const PC_ROOT_URL = pathToFileURL(path.join(__dirname, "pc") + path.sep).toString();

let mainWindow = null;
let contentView = null;
const retainedViews = new Map();
let activeTarget = "home";
let presentationMode = false;
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

function sendToShell(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function emitActiveTarget() {
  sendToShell("cpi:active-target", activeTarget);
}

function hostIsRetained() {
  const host = retainedViews.get("party");
  return Boolean(host && !host.webContents.isDestroyed());
}

function emitHostState() {
  sendToShell("cpi:host-state", { running: hostIsRetained(), active: activeTarget === "party" });
}

function contentBounds() {
  if (!mainWindow) return { x: SIDEBAR_WIDTH, y: 0, width: 1000, height: 700 };
  const [width, height] = mainWindow.getContentSize();
  const sidebar = presentationMode ? 0 : SIDEBAR_WIDTH;
  return {
    x: sidebar,
    y: 0,
    width: Math.max(1, width - sidebar),
    height: Math.max(1, height),
  };
}

function detachContentView({ destroy = false } = {}) {
  if (!mainWindow || !contentView) return;
  try {
    mainWindow.contentView.removeChildView(contentView);
  } catch {}
  if (destroy) {
    for (const [key, view] of retainedViews) {
      if (view === contentView) retainedViews.delete(key);
    }
    try {
      contentView.webContents.close();
    } catch {}
  }
  contentView = null;
  emitHostState();
}

function destroyAllContentViews() {
  if (contentView && ![...retainedViews.values()].includes(contentView)) {
    try { contentView.webContents.close(); } catch {}
  }
  contentView = null;
  for (const view of retainedViews.values()) {
    try { view.webContents.close(); } catch {}
  }
  retainedViews.clear();
  emitHostState();
}

function createContentView(target) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  view.setBackgroundColor("#050607");
  view.webContents.setWindowOpenHandler(({ url }) => {
    const current = loadSettings();
    if (url.startsWith(current.partyBase) || url.startsWith(current.databaseBase)) {
      view.webContents.loadURL(url);
      return { action: "deny" };
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });

  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (activeTarget !== target) return;
    detachContentView({ destroy: true });
    activeTarget = "home";
    emitActiveTarget();
    sendToShell("cpi:content-error", {
      target,
      url: validatedURL,
      message: errorDescription || "Content could not be loaded.",
    });
  });

  view.webContents.on("will-navigate", (event, nextUrl) => {
    const current = loadSettings();
    if (
      nextUrl.startsWith(current.partyBase) ||
      nextUrl.startsWith(current.databaseBase) ||
      nextUrl.startsWith(PC_ROOT_URL)
    ) return;
    event.preventDefault();
    void shell.openExternal(nextUrl);
  });

  return view;
}

function openContent(url, target, { retain = target === "party", forceNavigate = false } = {}) {
  if (!mainWindow) return;

  detachContentView();

  let view = retain ? retainedViews.get(target) : null;
  let reused = Boolean(view && !view.webContents.isDestroyed());
  if (!reused) {
    view = createContentView(target);
    if (retain) retainedViews.set(target, view);
  }

  contentView = view;
  contentView.setBounds(contentBounds());
  mainWindow.contentView.addChildView(contentView);
  activeTarget = target;
  emitActiveTarget();
  emitHostState();

  const currentUrl = contentView.webContents.getURL();
  if (!reused || forceNavigate || !currentUrl) void contentView.webContents.loadURL(url);
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

function setPresentationMode(enabled) {
  presentationMode = Boolean(enabled);
  if (contentView) contentView.setBounds(contentBounds());
  sendToShell("cpi:presentation-mode", presentationMode);
  return presentationMode;
}

function startPresentationHost() {
  navigate("party");
  setPresentationMode(true);
  mainWindow?.setFullScreen(true);
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
    destroyAllContentViews();
    mainWindow = null;
  });

  installMenu();
}

function goHome() {
  if (!mainWindow) return;
  setPresentationMode(false);
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  detachContentView();
  activeTarget = "home";
  emitActiveTarget();
  emitHostState();
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
        { label: "Presentation Host", accelerator: "CmdOrCtrl+Shift+Enter", click: () => startPresentationHost() },
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
        {
          label: "Toggle Presentation Mode",
          accelerator: "CmdOrCtrl+Shift+F",
          click: () => setPresentationMode(!presentationMode),
        },
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

ipcMain.handle("cpi:host-status", () => ({ running: hostIsRetained(), active: activeTarget === "party" }));

ipcMain.handle("cpi:return-host", () => {
  navigate("party");
  return true;
});

ipcMain.handle("cpi:start-presentation-host", () => {
  startPresentationHost();
  return true;
});

ipcMain.handle("cpi:toggle-presentation", () => setPresentationMode(!presentationMode));

ipcMain.handle("cpi:player-qr", async () => {
  const url = `${loadSettings().partyBase}/play`;
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: { dark: "#050607", light: "#ffd400" },
  });
  return { url, dataUrl };
});

ipcMain.handle("cpi:copy-player-link", () => {
  const url = `${loadSettings().partyBase}/play`;
  clipboard.writeText(url);
  return url;
});

ipcMain.handle("cpi:config", () => ({
  ...loadSettings(),
  activeTarget,
  presentationMode,
  version: app.getVersion(),
}));

ipcMain.handle("cpi:launch-game", (_event, gameId) => {
  const id = String(gameId);
  if (!GAME_IDS.has(id)) throw new Error("Unknown CPI Party game");
  const current = loadSettings();
  openContent(`${current.partyBase}/host?game=${encodeURIComponent(id)}`, "party", { retain: true, forceNavigate: true });
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
