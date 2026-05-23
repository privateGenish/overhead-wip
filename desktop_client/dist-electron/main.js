import { BrowserWindow, app, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
//#region electron/ipc/localStorageAPI.ts
function registerLocalStorageAPI() {
	ipcMain.handle("db:tickets:all", () => {});
	ipcMain.handle("db:tickets:get", (_e, uuid) => {});
	ipcMain.handle("db:tickets:upsert", (_e, ticket) => {});
	ipcMain.handle("db:tickets:delete", (_e, uuid) => {});
	ipcMain.handle("db:relations:all", () => {});
	ipcMain.handle("db:relations:add", (_e, from, to, kind) => {});
	ipcMain.handle("db:relations:remove", (_e, from, to, kind) => {});
	ipcMain.handle("db:relations:of", (_e, uuid) => {});
}
//#endregion
//#region electron/main.ts
var __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
var VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
var RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
var win = null;
function createWindow() {
	win = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: { preload: path.join(__dirname, "preload.js") }
	});
	if (VITE_DEV_SERVER_URL) win.loadURL(VITE_DEV_SERVER_URL);
	else win.loadFile(path.join(RENDERER_DIST, "index.html"));
}
app.whenReady().then(() => {
	registerLocalStorageAPI();
	createWindow();
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
	win = null;
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
//#endregion
