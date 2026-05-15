import { contextBridge, ipcRenderer } from "electron";
//#region electron/preload.ts
contextBridge.exposeInMainWorld("electronAPI", { ping: () => ipcRenderer.invoke("ping") });
//#endregion
