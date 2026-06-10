import { contextBridge as e, ipcRenderer as t } from "electron";
//#region electron/preload.ts
e.exposeInMainWorld("db", {
	query: (e, n) => t.invoke("db:query", e, n ?? []),
	ticket: (e, n) => t.invoke("db:ticket", e, n ?? []),
	history: (e) => t.invoke("db:history", e),
	historyFlush: (e) => t.invoke("db:history:flush", e),
	onVaultTicketUpdated: (e) => {
		let n = (t, n) => {
			e(n);
		};
		return t.on("vault:ticket-updated", n), () => {
			t.removeListener("vault:ticket-updated", n);
		};
	}
});
//#endregion
