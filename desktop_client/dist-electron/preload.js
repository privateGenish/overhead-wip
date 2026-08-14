import { contextBridge as e, ipcRenderer as t } from "electron";
//#region electron/preload.ts
e.exposeInMainWorld("db", {
	query: (e, n) => t.invoke("db:query", e, n ?? []),
	ticket: (e, n) => t.invoke("db:ticket", e, n ?? []),
	history: (e) => t.invoke("db:history", e),
	historyFlush: (e) => t.invoke("db:history:flush", e),
	relation: (e, n) => t.invoke("db:relation", e, n),
	graph: (e, n) => t.invoke("db:graph", e, n ?? {}),
	onVaultTicketUpdated: (e) => {
		let n = (t, n) => {
			e(n);
		};
		return t.on("vault:ticket-updated", n), () => {
			t.removeListener("vault:ticket-updated", n);
		};
	},
	onGraphUpdated: (e) => {
		let n = () => {
			e();
		};
		return t.on("graph:updated", n), () => {
			t.removeListener("graph:updated", n);
		};
	}
});
//#endregion
