import { app, BrowserWindow, Menu, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PARTY_URL = process.env.CPI_PARTY_URL?.trim() || "http://127.0.0.1:3000";
const DEFAULT_DATABASE_URL = process.env.CPI_DATABASE_URL?.trim() || "https://jj2sly.github.io/corn.planet";

let mainWindow = null;
let settings = null;
const GAME_IDS = new Set(["chaos", "cornorshit", "entityauction", "mycob", "steamdeck", "thud"]);

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
  const partyBase = current.partyBase;
  const databaseBase = current.databaseBase;
  const destinations = {
    party: `${partyBase}/host`,
    account: `${partyBase}/account`,
    prompts: `${partyBase}/prompts`,
    hall: `${partyBase}/hall`,
    database: databaseBase,
    health: `${partyBase}/healthz`,
  };
  return destinations[target] || null;
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

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const current = loadSettings();
    if (url.startsWith(current.partyBase) || url.startsWith(current.databaseBase)) {
      mainWindow.loadURL(url);
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  installMenu();
}

function goHome() {
  if (mainWindow) mainWindow.loadFile(path.join(__dirname, "index.html"));
}

function navigate(target) {
  if (!mainWindow) return;
  if (target === "home") return goHome();
  const url = destination(target);
  if (url) mainWindow.loadURL(url);
}

function installMenu() {
  const template = [
    {
      label: "CPI Party",
      submenu: [
        { label: "Command Center", accelerator: "CmdOrCtrl+Shift+H", click: () => goHome() },
        { label: "Party Host", accelerator: "CmdOrCtrl+Shift+P", click: () => navigate("party") },
        { type: "separator" },
        { role: "reload" },
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
        { role: "back" },
        { role: "forward" },
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

ipcMain.handle("cpi:config", () => ({
  ...loadSettings(),
  version: app.getVersion(),
}));

ipcMain.handle("cpi:launch-game", (_event, gameId) => {
  const id = String(gameId);
  if (!GAME_IDS.has(id)) throw new Error("Unknown CPI Party game");
  const current = loadSettings();
  if (mainWindow) mainWindow.loadURL(`${current.partyBase}/host?game=${encodeURIComponent(id)}`);
  return true;
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
