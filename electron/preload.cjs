const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "qmplayDesktop",
  Object.freeze({
    minimize: () => ipcRenderer.send("window:minimize"),
    close: () => ipcRenderer.send("window:close"),
  }),
);
