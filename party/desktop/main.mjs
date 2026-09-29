import { app, BrowserWindow, Menu, ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PARTY_URL = process.env.CPI_PARTY_URL?.trim() || "http://127.0.0.1:3000";
const DEFAULT_DATABASE_URL = process.env.CPI_DATABASE_URL?.trim() || "https://jj2sly.github.io/corn.planet";

let mainWindow = null;

function cleanBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const partyBase = cleanBase(DEFAULT_PARTY_URL);
const databaseBase = cleanBase(DEFAULT_DATABASE_URL);

const destinations = {
  home: null,
  party: `${partyBase}/host`,
  account: `${partyBase}/account`,
  prompts: `${partyBase}/prompts`,
  hall: `${partyBase}/hall`,
  database: databaseBase,
  health: `${partyBase}/healthz`,
};

function createWindow() {
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
    if (url.startsWith(partyBase) || url.startsWith(databaseBase)) {
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
  const url = destinations[target];
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
  partyBase,
  databaseBase,
  version: app.getVersion(),
}));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!mainWindow) createWindow();
});
