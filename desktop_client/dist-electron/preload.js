import { contextBridge, ipcRenderer } from "electron";
//#region electron/preload.ts
contextBridge.exposeInMainWorld("db", {
	query: (sql, params) => ipcRenderer.invoke("db:query", sql, params ?? []),
	ticket: (sql, params) => ipcRenderer.invoke("db:ticket", sql, params ?? []),
	history: (ticketUuid) => ipcRenderer.invoke("db:history", ticketUuid),
	historyFlush: (ticketUuid) => ipcRenderer.invoke("db:history:flush", ticketUuid),
	relation: (op, payload) => ipcRenderer.invoke("db:relation", op, payload),
	graph: (op, payload) => ipcRenderer.invoke("db:graph", op, payload ?? {}),
	onVaultTicketUpdated: (callback) => {
		const listener = (_event, ticketUuid) => {
			callback(ticketUuid);
		};
		ipcRenderer.on("vault:ticket-updated", listener);
		return () => {
			ipcRenderer.removeListener("vault:ticket-updated", listener);
		};
	},
	onGraphUpdated: (callback) => {
		const listener = () => {
			callback();
		};
		ipcRenderer.on("graph:updated", listener);
		return () => {
			ipcRenderer.removeListener("graph:updated", listener);
		};
	}
});
//#endregion
