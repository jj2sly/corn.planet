import { contextBridge, ipcRenderer } from "electron";

if (globalThis.location?.protocol === "file:") {
  contextBridge.exposeInMainWorld("cpiDesktop", {
    navigate: (target) => ipcRenderer.invoke("cpi:navigate", target),
    launchGame: (gameId) => ipcRenderer.invoke("cpi:launch-game", gameId),
    checkServer: () => ipcRenderer.invoke("cpi:check-server"),
    config: () => ipcRenderer.invoke("cpi:config"),
    setPartyUrl: (value) => ipcRenderer.invoke("cpi:set-party-url", value),
  });
}
