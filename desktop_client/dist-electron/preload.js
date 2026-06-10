import { contextBridge, ipcRenderer } from "electron";
//#region electron/preload.ts
/**
* Exposes a single `window.db.query(ops)` to the renderer.
*
* `ops` is an array of up to 10 operations (`get` | `all` | `put` | `delete`),
* executed in one SQLite transaction in the main process. See
* `electron/ipc/localStorageAPI.ts` for the protocol.
*/
contextBridge.exposeInMainWorld("db", { query: (ops) => ipcRenderer.invoke("db:query", ops) });
//#endregion
