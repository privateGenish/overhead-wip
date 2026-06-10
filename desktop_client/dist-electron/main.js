import { BrowserWindow, app, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
//#region electron/db/sqlite.ts
var db = null;
function initSqlite(file) {
	if (db) return;
	db = new DatabaseSync(file);
	db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      uuid        TEXT PRIMARY KEY,
      id          TEXT NOT NULL,
      title       TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('Explore', 'Feature', 'Execute')),
      status      TEXT NOT NULL,
      backlog     INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_history (
      ticket_uuid  TEXT    NOT NULL,
      ts           INTEGER NOT NULL,
      description  TEXT    NOT NULL,
      hash         TEXT    NOT NULL,
      PRIMARY KEY (ticket_uuid, ts)
    );

  `);
}
function ready() {
	if (!db) throw new Error("SQLite not initialised — call initSqlite() first.");
	return db;
}
/**
* Snapshots a ticket's description into history, but only if it differs from
* the most recent snapshot. Dedup is by content hash, so identical descriptions
* never produce duplicate versions.
*/
function historyInsert(ticketUuid, description) {
	const hash = createHash("sha256").update(description).digest("hex");
	if (ready().prepare("SELECT hash FROM ticket_history WHERE ticket_uuid = ? ORDER BY ts DESC LIMIT 1").get(ticketUuid)?.hash === hash) return;
	const ts = Math.floor(Date.now() / 1e3);
	ready().prepare("INSERT OR REPLACE INTO ticket_history (ticket_uuid, ts, description, hash) VALUES (?, ?, ?, ?)").run(ticketUuid, ts, description, hash);
}
function historyGet(ticketUuid) {
	return ready().prepare("SELECT ts, description FROM ticket_history WHERE ticket_uuid = ? ORDER BY ts DESC").all(ticketUuid);
}
function runSql(sql, params = []) {
	const stmt = ready().prepare(sql);
	if (/^\s*SELECT/i.test(sql)) return stmt.all(...params);
	return stmt.run(...params);
}
//#endregion
//#region electron/ipc/generalAPI.ts
var TICKET_TABLE_RE$1 = /\b(tickets|ticket_history|pending_sync)\b/i;
function registerGeneralAPI() {
	ipcMain.handle("db:query", (_e, sql, params = []) => {
		if (typeof sql !== "string") throw new Error("db:query expects a SQL string.");
		if (TICKET_TABLE_RE$1.test(sql)) throw new Error("db:query cannot access ticket tables — use db:ticket instead.");
		return runSql(sql, params);
	});
}
//#endregion
//#region electron/ipc/ticketAPI.ts
var TICKET_TABLE_RE = /\btickets\b/i;
var SELECT_RE = /^\s*SELECT/i;
/** How long a ticket must sit unchanged before its description is snapshotted. */
var HISTORY_DEBOUNCE_MS = 3e4;
/** Pending description snapshots, keyed by ticket uuid. One timer per ticket. */
var debounceTimers = /* @__PURE__ */ new Map();
function validateTicketSql(sql) {
	if (typeof sql !== "string") throw new Error("db:ticket expects a SQL string.");
	if (!TICKET_TABLE_RE.test(sql)) throw new Error("db:ticket only accepts queries on ticket tables.");
}
/** Reads a ticket's current description straight from SQLite. */
function currentDescription(uuid) {
	return runSql("SELECT description FROM tickets WHERE uuid = ? LIMIT 1", [uuid])?.[0]?.description ?? null;
}
/** Snapshots a ticket's current description into history, clearing its timer. */
function snapshot(uuid) {
	debounceTimers.delete(uuid);
	const description = currentDescription(uuid);
	if (description !== null) historyInsert(uuid, description);
}
/** Called after every ticket mutation — (re)arms the per-ticket debounce. */
function onTicketWritten(uuid) {
	if (!uuid) return;
	const existing = debounceTimers.get(uuid);
	if (existing) clearTimeout(existing);
	debounceTimers.set(uuid, setTimeout(() => snapshot(uuid), HISTORY_DEBOUNCE_MS));
}
/** Fires every pending snapshot immediately — call before the app quits. */
function flushHistory() {
	for (const [uuid, timer] of debounceTimers) {
		clearTimeout(timer);
		const description = currentDescription(uuid);
		if (description !== null) historyInsert(uuid, description);
	}
	debounceTimers.clear();
}
function registerTicketAPI() {
	ipcMain.handle("db:ticket", (_e, sql, params = []) => {
		validateTicketSql(sql);
		const result = runSql(sql, params);
		if (!SELECT_RE.test(sql)) onTicketWritten(params[0]);
		return result;
	});
}
//#endregion
//#region electron/ipc/historyAPI.ts
function registerHistoryAPI() {
	ipcMain.handle("db:history", (_e, ticketUuid) => {
		if (typeof ticketUuid !== "string") throw new Error("db:history expects a ticket UUID string.");
		return historyGet(ticketUuid);
	});
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
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			sandbox: false
		}
	});
	if (VITE_DEV_SERVER_URL) win.loadURL(VITE_DEV_SERVER_URL);
	else win.loadFile(path.join(RENDERER_DIST, "index.html"));
}
app.whenReady().then(() => {
	initSqlite(path.join(app.getPath("userData"), "overhead.db"));
	registerGeneralAPI();
	registerTicketAPI();
	registerHistoryAPI();
	createWindow();
});
app.on("before-quit", () => {
	flushHistory();
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
	win = null;
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
//#endregion
