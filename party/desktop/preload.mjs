import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cpiDesktop", {
  navigate: (target) => ipcRenderer.invoke("cpi:navigate", target),
  config: () => ipcRenderer.invoke("cpi:config"),
  setPartyUrl: (value) => ipcRenderer.invoke("cpi:set-party-url", value),
});
