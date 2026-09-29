import { contextBridge, ipcRenderer } from "electron";

if (globalThis.location?.protocol === "file:") {
  contextBridge.exposeInMainWorld("cpiDesktop", {
    navigate: (target) => ipcRenderer.invoke("cpi:navigate", target),
    launchGame: (gameId) => ipcRenderer.invoke("cpi:launch-game", gameId),
    launchPcGame: (gameId) => ipcRenderer.invoke("cpi:launch-pc-game", gameId),
    fetchCanon: () => ipcRenderer.invoke("cpi:fetch-canon"),
    checkServer: () => ipcRenderer.invoke("cpi:check-server"),
    config: () => ipcRenderer.invoke("cpi:config"),
    setPartyUrl: (value) => ipcRenderer.invoke("cpi:set-party-url", value),
    onActiveTarget: (callback) => {
      const handler = (_event, target) => callback(target);
      ipcRenderer.on("cpi:active-target", handler);
      return () => ipcRenderer.removeListener("cpi:active-target", handler);
    },
  });
}
