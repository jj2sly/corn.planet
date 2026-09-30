// Sandboxed preloads run as plain scripts (no ESM), so this must stay CommonJS.
// The bridge is only exposed to the app's own local pages, never to remote Party/Database content.
const { contextBridge, ipcRenderer } = require("electron");

if (globalThis.location?.protocol === "file:") {
  contextBridge.exposeInMainWorld("cpiDesktop", {
    navigate: (target) => ipcRenderer.invoke("cpi:navigate", target),
    hostStatus: () => ipcRenderer.invoke("cpi:host-status"),
    roomCode: () => ipcRenderer.invoke("cpi:room-code"),
    copyRoomCode: () => ipcRenderer.invoke("cpi:copy-room-code"),
    returnHost: () => ipcRenderer.invoke("cpi:return-host"),
    stopHost: () => ipcRenderer.invoke("cpi:stop-host"),
    startPresentationHost: () => ipcRenderer.invoke("cpi:start-presentation-host"),
    togglePresentation: () => ipcRenderer.invoke("cpi:toggle-presentation"),
    launchGame: (gameId) => ipcRenderer.invoke("cpi:launch-game", gameId),
    launchPcGame: (gameId) => ipcRenderer.invoke("cpi:launch-pc-game", gameId),
    fetchCanon: () => ipcRenderer.invoke("cpi:fetch-canon"),
    openCanonUrl: (url) => ipcRenderer.invoke("cpi:open-canon-url", url),
    checkServer: () => ipcRenderer.invoke("cpi:check-server"),
    readiness: () => ipcRenderer.invoke("cpi:readiness"),
    config: () => ipcRenderer.invoke("cpi:config"),
    copyPlayerLink: () => ipcRenderer.invoke("cpi:copy-player-link"),
    playerQr: () => ipcRenderer.invoke("cpi:player-qr"),
    setPartyUrl: (value) => ipcRenderer.invoke("cpi:set-party-url", value),
    // Desktop updates: status plus three fixed actions. The updater itself stays in the main process.
    updateStatus: () => ipcRenderer.invoke("cpi:update-status"),
    checkForUpdates: () => ipcRenderer.invoke("cpi:check-updates"),
    installUpdate: () => ipcRenderer.invoke("cpi:install-update"),
    openUpdateDownload: () => ipcRenderer.invoke("cpi:open-update-download"),
    onUpdateStatus: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on("cpi:update-status", handler);
      return () => ipcRenderer.removeListener("cpi:update-status", handler);
    },
    onActiveTarget: (callback) => {
      const handler = (_event, target) => callback(target);
      ipcRenderer.on("cpi:active-target", handler);
      return () => ipcRenderer.removeListener("cpi:active-target", handler);
    },
    onContentError: (callback) => {
      const handler = (_event, detail) => callback(detail);
      ipcRenderer.on("cpi:content-error", handler);
      return () => ipcRenderer.removeListener("cpi:content-error", handler);
    },
    onPresentationMode: (callback) => {
      const handler = (_event, enabled) => callback(Boolean(enabled));
      ipcRenderer.on("cpi:presentation-mode", handler);
      return () => ipcRenderer.removeListener("cpi:presentation-mode", handler);
    },
    onHostState: (callback) => {
      const handler = (_event, detail) => callback(detail);
      ipcRenderer.on("cpi:host-state", handler);
      return () => ipcRenderer.removeListener("cpi:host-state", handler);
    },
    onRoomCode: (callback) => {
      const handler = (_event, detail) => callback(detail);
      ipcRenderer.on("cpi:room-code", handler);
      return () => ipcRenderer.removeListener("cpi:room-code", handler);
    },
  });
}
