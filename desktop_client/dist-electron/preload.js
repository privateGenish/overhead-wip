import { contextBridge, ipcRenderer } from "electron";
//#region electron/preload.ts
contextBridge.exposeInMainWorld("db", {
	tickets: {
		all: () => ipcRenderer.invoke("db:tickets:all"),
		get: (uuid) => ipcRenderer.invoke("db:tickets:get", uuid),
		upsert: (ticket) => ipcRenderer.invoke("db:tickets:upsert", ticket),
		delete: (uuid) => ipcRenderer.invoke("db:tickets:delete", uuid)
	},
	relations: {
		all: () => ipcRenderer.invoke("db:relations:all"),
		add: (from, to, kind) => ipcRenderer.invoke("db:relations:add", from, to, kind),
		remove: (from, to, kind) => ipcRenderer.invoke("db:relations:remove", from, to, kind),
		of: (uuid) => ipcRenderer.invoke("db:relations:of", uuid)
	}
});
//#endregion
