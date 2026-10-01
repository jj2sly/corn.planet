import { app, BrowserWindow, Menu, WebContentsView, clipboard, dialog, ipcMain, powerSaveBlocker, shell } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import electronUpdater from "electron-updater";
import { CHECK_INTERVAL_MS, STARTUP_DELAY_MS, createUpdateController, notifyReasonFor, updateMode } from "./updater.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PARTY_URL = process.env.CPI_PARTY_URL?.trim() || "http://127.0.0.1:3000";
// The public Railway Party server (already linked from the CPI Database site). Offered as a one-click
// setup choice when no local server is running; never forced.
const PUBLIC_PARTY_URL = "https://cornplanet-production.up.railway.app";
const DEFAULT_DATABASE_URL = process.env.CPI_DATABASE_URL?.trim() || "https://jj2sly.github.io/corn.planet";
const SIDEBAR_WIDTH = 220;
const PC_ROOT_URL = pathToFileURL(path.join(__dirname, "pc") + path.sep).toString();
const SMOKE_TEST = process.env.CPI_DESKTOP_SMOKE === "1";
// Written at package time (scripts/build-info.mjs) so a build names the commit it came from.
const BUILD_INFO = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "build-info.json"), "utf8"));
  } catch {
    return null;
  }
})();
// Unpackaged test runs only: point the updater at a local feed to rehearse an update. Packaged
// builds ignore this and always use GitHub Releases.
const DEV_UPDATE_FEED = app.isPackaged ? "" : process.env.CPI_UPDATER_DEV_FEED?.trim() || "";

let mainWindow = null;
let contentView = null;
const retainedViews = new Map();
let activeTarget = "home";
let presentationMode = false;
let presentationBlockerId = null;
let allowWindowClose = false;
let quitRequested = false;
let settings = null;
let liveRoomCode = "";

const PORTABLE_BUILD = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
const UPDATE_MODE = DEV_UPDATE_FEED
  ? (process.env.CPI_UPDATER_DEV_MODE === "install" ? "install" : "notify")
  : updateMode({ platform: process.platform, isPackaged: app.isPackaged, portable: PORTABLE_BUILD });

const updates = createUpdateController({
  mode: UPDATE_MODE,
  notifyReason: notifyReasonFor({ platform: process.platform, portable: PORTABLE_BUILD }),
  arch: process.arch,
  currentVersion: app.getVersion(),
  // The same retained-host state the close warning and Command Center use.
  hostIsLive: () => hostIsRetained(),
  emit: (state) => sendToShell("cpi:update-status", state),
  openExternal: (url) => void shell.openExternal(url),
  getUpdater: () => {
    const { autoUpdater } = electronUpdater;
    if (DEV_UPDATE_FEED) {
      autoUpdater.forceDevUpdateConfig = true;
      autoUpdater.setFeedURL({ provider: "generic", url: DEV_UPDATE_FEED });
    }
    return autoUpdater;
  },
});

const PC_GAME_IDS = new Set(["cornorshit-solo", "coldcase"]);

async function fetchGameCatalog() {
  const current = loadSettings();
  const response = await fetch(`${current.partyBase}/api/native/games`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Game catalog request failed (${response.status}).`);
  const data = await response.json();
  const games = Array.isArray(data?.games) ? data.games : [];
  return games
    .filter((game) => game && typeof game.id === "string" && typeof game.name === "string")
    .map((game) => ({
      id: game.id,
      name: game.name,
      tagline: typeof game.tagline === "string" ? game.tagline : "",
      description: typeof game.description === "string" ? game.description : "",
      minPlayers: Number(game.minPlayers || 0),
      maxPlayers: Number(game.maxPlayers || 0),
    }));
}

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

function privateIpv4Score(address) {
  if (/^192\.168\./.test(address)) return 3;
  if (/^10\./.test(address)) return 3;
  const match = /^172\.(\d+)\./.exec(address);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return 3;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) return 1;
  return 2;
}

function bestLanIpv4() {
  const candidates = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      candidates.push(address.address);
    }
  }
  candidates.sort((a, b) => privateIpv4Score(b) - privateIpv4Score(a));
  return candidates[0] || null;
}

function playerJoinUrl() {
  const current = loadSettings();
  try {
    const url = new URL(current.partyBase);
    if (["127.0.0.1", "localhost", "0.0.0.0"].includes(url.hostname)) {
      const lan = bestLanIpv4();
      if (lan) url.hostname = lan;
    }
    url.pathname = "/play";
    url.search = "";
    if (liveRoomCode) url.searchParams.set("code", liveRoomCode);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return `${current.partyBase}/play`;
  }
}

function partyHostUrl(gameId = "") {
  const current = loadSettings();
  const url = new URL(`${current.partyBase}/host`);
  url.searchParams.set("join", playerJoinUrl());
  if (gameId) url.searchParams.set("game", gameId);
  return url.toString();
}

function destination(target) {
  const current = loadSettings();
  const destinations = {
    party: partyHostUrl(),
    account: `${current.partyBase}/account`,
    prompts: `${current.partyBase}/prompts`,
    hall: `${current.partyBase}/hall`,
    database: current.databaseBase,
  };
  return destinations[target] || null;
}

// True when `candidate` is on the same origin as `base` and inside its path. Compares parsed
// origins/paths so lookalikes such as "http://127.0.0.1:3000.evil.test" or "/corn.planet-other"
// never pass the way a plain string-prefix check would.
function isWithinBase(candidate, base) {
  let url;
  let root;
  try {
    url = new URL(candidate);
    root = new URL(base);
  } catch {
    return false;
  }
  if (url.protocol !== root.protocol) return false;
  if (root.protocol === "file:") return isFileInside(url, fileURLToPath(root));
  if (url.origin !== root.origin) return false;
  const rootPath = root.pathname.replace(/\/+$/, "");
  return url.pathname === rootPath || url.pathname.startsWith(`${rootPath}/`);
}

// File URLs are compared as real paths so drive-letter case and percent-encoding can't matter.
function isFileInside(fileUrl, directory) {
  try {
    const relative = path.relative(path.resolve(directory), path.resolve(fileURLToPath(fileUrl)));
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

function isTrustedContentUrl(candidate) {
  const current = loadSettings();
  return isWithinBase(candidate, current.partyBase)
    || isWithinBase(candidate, current.databaseBase)
    || isWithinBase(candidate, PC_ROOT_URL);
}

// IPC is only honoured from the app's own local pages (shell + PC games), never remote content.
function isLocalAppSender(event) {
  const url = event?.senderFrame?.url || "";
  return url.startsWith("file:") && isFileInside(url, __dirname);
}

function handle(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isLocalAppSender(event)) throw new Error("CPI desktop controls are only available to local app pages.");
    return listener(event, ...args);
  });
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

function emitRoomCode() {
  sendToShell("cpi:room-code", { code: liveRoomCode });
}

async function updateHostJoinOverlay() {
  const host = retainedViews.get("party");
  if (!host || host.webContents.isDestroyed()) return;

  const url = playerJoinUrl();
  let dataUrl;
  try {
    dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 180,
      color: { dark: "#050607", light: "#ffd400" },
    });
  } catch {
    return;
  }

  const payload = JSON.stringify({ url, dataUrl, code: liveRoomCode });
  try {
    await host.webContents.executeJavaScript(`
      (() => {
        const data = ${payload};
        const hint = document.querySelector("#joinHint");
        if (!hint) return;
        let wrap = document.querySelector("#cpiDesktopJoinOverlay");
        if (!wrap) {
          wrap = document.createElement("span");
          wrap.id = "cpiDesktopJoinOverlay";
          wrap.style.cssText = "display:inline-flex;align-items:center;gap:10px;margin-right:12px;vertical-align:middle";
          const img = document.createElement("img");
          img.id = "cpiDesktopJoinQr";
          img.alt = "Phone join QR code";
          img.style.cssText = "width:72px;height:72px;background:#ffd400;padding:3px;border:1px solid #665600;image-rendering:pixelated";
          wrap.appendChild(img);
          hint.prepend(wrap);
        }
        const img = document.querySelector("#cpiDesktopJoinQr");
        if (img) img.src = data.dataUrl;
        wrap.title = data.url;
      })();
    `, true);
  } catch {}
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

  const detached = contentView;
  const retainedEntry = [...retainedViews.entries()].find(([, view]) => view === detached);
  const retained = Boolean(retainedEntry);
  const shouldDestroy = destroy || !retained;

  try {
    mainWindow.contentView.removeChildView(detached);
  } catch {}

  if (shouldDestroy) {
    if (retainedEntry) retainedViews.delete(retainedEntry[0]);
    if (retainedEntry?.[0] === "party") {
      liveRoomCode = "";
      emitRoomCode();
      setPresentationMode(false);
    }
    try {
      detached.webContents.close();
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
  liveRoomCode = "";
  emitRoomCode();
  setPresentationMode(false);
  emitHostState();
}

function exitPresentationOnEscape(event, input) {
  if (!presentationMode || input.type !== "keyDown" || input.key !== "Escape") return;
  event.preventDefault();
  setPresentationMode(false);
  if (mainWindow?.isFullScreen()) mainWindow.setFullScreen(false);
}

function createContentView(target) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: target !== "party",
    },
  });
  view.setBackgroundColor("#050607");
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedContentUrl(url) && !url.startsWith("file:")) {
      view.webContents.loadURL(url);
      return { action: "deny" };
    }
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  view.webContents.on("did-finish-load", () => {
    if (target === "party") void updateHostJoinOverlay();
  });

  view.webContents.on("page-title-updated", (_event, title) => {
    if (target !== "party") return;
    const match = /—\s*([BCDFGHJKLMNPQRSTVWXZ]{4})\s*$/.exec(String(title).toUpperCase());
    const nextCode = match?.[1];
    if (nextCode && nextCode !== liveRoomCode) {
      liveRoomCode = nextCode;
      emitRoomCode();
      void updateHostJoinOverlay();
    }
  });

  view.webContents.on("before-input-event", exitPresentationOnEscape);

  view.webContents.on("render-process-gone", (_event, details) => {
    if (target === "party" && retainedViews.get("party") === view) {
      retainedViews.delete("party");
      liveRoomCode = "";
      emitRoomCode();
      setPresentationMode(false);
    }

    if (contentView === view) {
      try { mainWindow?.contentView.removeChildView(view); } catch {}
      contentView = null;
      activeTarget = "home";
      emitActiveTarget();
    }

    emitHostState();
    sendToShell("cpi:content-error", {
      target,
      url: view.webContents.getURL(),
      message: `Embedded ${target} renderer stopped unexpectedly (${details.reason}).`,
    });
    // The dead view is no longer shown or retained; release it instead of leaking its WebContents.
    setImmediate(() => {
      try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch {}
    });
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
    if (isTrustedContentUrl(nextUrl)) return;
    event.preventDefault();
    if (/^https?:/i.test(nextUrl)) void shell.openExternal(nextUrl);
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
  contentView.webContents.focus();
}

function stopRetainedHost() {
  const host = retainedViews.get("party");
  if (!host) return false;

  if (contentView === host && mainWindow) {
    try { mainWindow.contentView.removeChildView(host); } catch {}
    contentView = null;
  }

  retainedViews.delete("party");
  liveRoomCode = "";
  emitRoomCode();
  try { host.webContents.close(); } catch {}

  if (activeTarget === "party") {
    activeTarget = "home";
    emitActiveTarget();
  }
  setPresentationMode(false);
  if (mainWindow?.isFullScreen()) mainWindow.setFullScreen(false);
  emitHostState();
  return true;
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
  } else if (gameId === "coldcase") {
    // CPI: Cold Case is the Party server's own /coldcase page, the same one a browser opens.
    openContent(`${loadSettings().partyBase}/coldcase`, "pc-games");
  }
}

function setPresentationMode(enabled) {
  presentationMode = Boolean(enabled);

  if (presentationMode) {
    if (presentationBlockerId === null || !powerSaveBlocker.isStarted(presentationBlockerId)) {
      presentationBlockerId = powerSaveBlocker.start("prevent-display-sleep");
    }
  } else if (presentationBlockerId !== null) {
    if (powerSaveBlocker.isStarted(presentationBlockerId)) powerSaveBlocker.stop(presentationBlockerId);
    presentationBlockerId = null;
  }

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
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.webContents.on("before-input-event", exitPresentationOnEscape);
  if (SMOKE_TEST) runSmokeTest(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  mainWindow.on("resize", () => {
    if (contentView) contentView.setBounds(contentBounds());
  });

  mainWindow.on("close", async (event) => {
    if (allowWindowClose || !hostIsRetained()) return;
    event.preventDefault();

    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Keep Host Running", "Close CPI Party"],
      defaultId: 0,
      cancelId: 0,
      title: "Party host is still live",
      message: "A Party host display is still connected.",
      detail: "Closing CPI Party can pause an active game until another host display reconnects.",
    });

    if (result.response === 1) {
      allowWindowClose = true;
      if (quitRequested) app.quit();
      else mainWindow?.close();
    } else {
      quitRequested = false;
    }
  });

  mainWindow.on("closed", () => {
    destroyAllContentViews();
    mainWindow = null;
  });

  installMenu();
}

// CI launch check: the shell must load, the sandboxed preload must expose the bridge, and a real
// IPC round trip must succeed. Source-level checks can't catch a preload Electron refuses to run.
function runSmokeTest(window) {
  const finish = (ok, detail) => {
    (ok ? console.log : console.error)(`CPI desktop smoke test ${ok ? "passed" : "failed"}: ${detail}`);
    app.exit(ok ? 0 : 1);
  };
  const timer = setTimeout(() => finish(false, "timed out waiting for the shell"), 45_000);
  window.webContents.once("did-finish-load", async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => ({
        bridge: typeof window.cpiDesktop,
        version: window.cpiDesktop ? (await window.cpiDesktop.config()).version : null,
        pcBridge: typeof window.cpiDesktop?.launchPcGame,
        updateBridge: typeof window.cpiDesktop?.checkForUpdates,
        updateVersion: window.cpiDesktop ? (await window.cpiDesktop.updateStatus()).currentVersion : null,
        updateCard: Boolean(document.querySelector("#updateCard")),
        heading: document.querySelector("h1")?.textContent ?? "",
      }))()`, true);
      clearTimeout(timer);
      const ok = result.bridge === "object" && result.version === app.getVersion() && result.pcBridge === "function"
        && result.updateBridge === "function" && result.updateVersion === app.getVersion() && result.updateCard;
      finish(ok, JSON.stringify(result));
    } catch (error) {
      clearTimeout(timer);
      finish(false, error instanceof Error ? error.message : String(error));
    }
  });
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
        { label: "CPI: Cold Case", click: () => launchPcGame("coldcase") },
        {
          label: "Copy Phone Join Link",
          accelerator: "CmdOrCtrl+Shift+J",
          click: () => clipboard.writeText(playerJoinUrl()),
        },
        { label: "Check for Updates…", click: () => void updates.check() },
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

handle("cpi:navigate", (_event, target) => {
  navigate(String(target));
  return true;
});

handle("cpi:host-status", () => ({ running: hostIsRetained(), active: activeTarget === "party" }));
handle("cpi:room-code", () => ({ code: liveRoomCode }));

handle("cpi:copy-room-code", () => {
  if (!liveRoomCode) return "";
  clipboard.writeText(liveRoomCode);
  return liveRoomCode;
});
handle("cpi:stop-host", () => stopRetainedHost());

handle("cpi:return-host", () => {
  navigate("party");
  return true;
});

handle("cpi:start-presentation-host", () => {
  startPresentationHost();
  return true;
});

handle("cpi:toggle-presentation", () => setPresentationMode(!presentationMode));

handle("cpi:player-qr", async () => {
  const url = playerJoinUrl();
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: { dark: "#050607", light: "#ffd400" },
  });
  return { url, dataUrl };
});

handle("cpi:copy-player-link", () => {
  const url = playerJoinUrl();
  clipboard.writeText(url);
  return url;
});

handle("cpi:update-status", () => updates.status());
handle("cpi:check-updates", () => updates.check());
handle("cpi:install-update", () => updates.install());
handle("cpi:open-update-download", () => updates.openDownloadPage());

handle("cpi:config", () => ({
  ...loadSettings(),
  activeTarget,
  presentationMode,
  publicPartyBase: PUBLIC_PARTY_URL,
  version: app.getVersion(),
  build: BUILD_INFO ? { commit: String(BUILD_INFO.commit || "").slice(0, 7), builtAt: BUILD_INFO.builtAt || null } : null,
}));

handle("cpi:launch-game", async (_event, gameId) => {
  const id = String(gameId);
  const games = await fetchGameCatalog();
  if (!games.some((game) => game.id === id)) throw new Error("Unknown CPI Party game");
  openContent(partyHostUrl(id), "party", { retain: true, forceNavigate: true });
  return true;
});

handle("cpi:game-catalog", () => fetchGameCatalog());

handle("cpi:open-canon-url", (_event, value) => {
  const raw = String(value || "");
  let requested;
  try {
    requested = new URL(raw);
  } catch {
    throw new Error("That canon URL is not valid.");
  }
  if (!isWithinBase(requested.toString(), loadSettings().databaseBase)) {
    throw new Error("That canon URL is outside the configured CPI Database.");
  }

  openContent(requested.toString(), "database");
  return true;
});

handle("cpi:launch-pc-game", (_event, gameId) => {
  launchPcGame(String(gameId));
  return true;
});

handle("cpi:fetch-canon", async () => {
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

handle("cpi:readiness", async () => {
  const current = loadSettings();
  const result = {
    server: false,
    games: 0,
    totalGames: 0,
    canon: 0,
    entityCanon: 0,
    cornOrShitPlayable: false,
    protocol: 0,
    phoneUrl: playerJoinUrl(),
    issues: [],
    warnings: [],
  };

  try {
    const phone = new URL(result.phoneUrl);
    if (["127.0.0.1", "localhost", "0.0.0.0"].includes(phone.hostname)) {
      result.issues.push("Phone join URL is still local-only; connect this computer to the same network as the players or use Railway.");
    }
  } catch {
    result.issues.push("Phone join URL is invalid.");
  }

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
      const catalog = Array.isArray(games.games) ? games.games.filter((game) => game?.id && game?.name) : [];
      result.games = catalog.length;
      result.totalGames = catalog.length;
      if (!catalog.length) result.issues.push("Party server returned an empty game catalog.");
    } else {
      result.issues.push("Game catalog could not be loaded.");
    }

    if (canonResponse.ok) {
      const canon = await canonResponse.json();
      const records = Array.isArray(canon.records) ? canon.records : [];
      result.canon = records.length || Number(canon.status?.records || 0);
      result.entityCanon = records.filter((record) => record?.kind === "entity").length;

      const byKind = new Map();
      for (const record of records) {
        if (!record || typeof record !== "object") continue;
        const kind = String(record.kind || "");
        if (!byKind.has(kind)) byKind.set(kind, []);
        byKind.get(kind).push(record);
      }

      for (const pool of byKind.values()) {
        for (const source of pool) {
          const sourceFields = source?.fields && typeof source.fields === "object" ? source.fields : {};
          const playable = pool.some((donor) => {
            if (donor === source) return false;
            const donorFields = donor?.fields && typeof donor.fields === "object" ? donor.fields : {};
            return Object.keys(sourceFields).some((key) => {
              const real = String(sourceFields[key] ?? "").trim();
              const fake = String(donorFields[key] ?? "").trim();
              return real && fake && real !== fake;
            });
          });
          if (playable) {
            result.cornOrShitPlayable = true;
            break;
          }
        }
        if (result.cornOrShitPlayable) break;
      }

      if (result.canon < 2) result.issues.push("CPI canon is too small for canon-driven games.");
      if (!result.cornOrShitPlayable) result.issues.push("CPI canon cannot currently build a Corn or Shit claim pair.");
      if (result.entityCanon < 24) {
        result.warnings.push(`Entity Auction has ${result.entityCanon} entity records; 24 are recommended for the default 8-player / 3-entity setup.`);
      }
    } else {
      result.issues.push("CPI canon could not be loaded.");
    }
  } catch (error) {
    // Network failures surface as a bare "fetch failed"; the offline line below already says it.
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    if (timedOut) result.issues.push("The Party server took too long to answer.");
    else if (!(error instanceof TypeError)) result.issues.push(error instanceof Error ? error.message : "Readiness check failed.");
  }

  if (!result.server) result.issues.unshift("Party server is offline or unreachable.");
  return result;
});

handle("cpi:check-server", async () => {
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

handle("cpi:set-party-url", (_event, value) => {
  const url = cleanBase(value);
  if (!/^https?:\/\//i.test(url)) throw new Error("Party server URL must start with http:// or https://");

  const current = loadSettings();
  if (url !== current.partyBase && hostIsRetained()) stopRetainedHost();

  settings = { ...current, partyBase: url };
  saveSettings();
  return { ...settings };
});

// Smoke runs get a throwaway profile so they never read/write real settings or collide with a
// running copy's single-instance lock (which would quit early and look like a pass).
if (SMOKE_TEST) app.setPath("userData", fs.mkdtempSync(path.join(app.getPath("temp"), "cpi-party-smoke-")));

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("before-quit", () => { quitRequested = true; });
  app.whenReady().then(() => {
    createWindow();
    // Update checks never block startup and never run during the CI launch check.
    if (!SMOKE_TEST && UPDATE_MODE !== "dev") {
      setTimeout(() => void updates.check(), STARTUP_DELAY_MS);
      setInterval(() => void updates.check(), CHECK_INTERVAL_MS);
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (!mainWindow) createWindow();
  });
}
