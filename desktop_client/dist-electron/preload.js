import { contextBridge, ipcRenderer } from "electron";
//#region electron/preload.ts
contextBridge.exposeInMainWorld("db", {
	query: (sql, params) => ipcRenderer.invoke("db:query", sql, params ?? []),
	ticket: (sql, params) => ipcRenderer.invoke("db:ticket", sql, params ?? []),
	history: (ticketUuid) => ipcRenderer.invoke("db:history", ticketUuid)
});
//#endregion
