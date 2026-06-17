import { BrowserWindow, app, ipcMain } from "electron";
import * as sp from "node:path";
import path, { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import fs, { stat, unwatchFile, watch, watchFile } from "node:fs";
import { EventEmitter } from "node:events";
import { lstat, open, readdir, realpath, stat as stat$1 } from "node:fs/promises";
import { Readable } from "node:stream";
import { type } from "node:os";
//#region electron/db/sqlite.ts
var db = null;
function initSqlite(file) {
	if (db) return;
	db = new DatabaseSync(file);
	db.exec("PRAGMA foreign_keys = ON");
	db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      uuid        TEXT PRIMARY KEY,
      id          TEXT NOT NULL,
      title       TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('Explore', 'Feature', 'Execute')),
      status      TEXT NOT NULL,
      backlog     INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      archived    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_history (
      ticket_uuid  TEXT    NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,
      ts           INTEGER NOT NULL,
      description  TEXT    NOT NULL,
      hash         TEXT    NOT NULL,
      PRIMARY KEY (ticket_uuid, ts)
    );

    CREATE TABLE IF NOT EXISTS ticket_relations (
      uuid   TEXT NOT NULL UNIQUE,
      node_a TEXT NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,
      node_b TEXT NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,
      type   TEXT NOT NULL CHECK(type IN ('relates-to', 'blocked-by')),
      PRIMARY KEY (node_a, node_b, type),
      CHECK (type != 'relates-to' OR node_a < node_b)
    );

    CREATE TABLE IF NOT EXISTS graph_views (
      uuid       TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_view_nodes (
      view_uuid   TEXT NOT NULL REFERENCES graph_views(uuid) ON DELETE CASCADE,
      ticket_uuid TEXT NOT NULL REFERENCES tickets(uuid)     ON DELETE CASCADE,
      x           REAL NOT NULL DEFAULT 0,
      y           REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (view_uuid, ticket_uuid)
    );

    CREATE TABLE IF NOT EXISTS graph_view_edges (
      uuid          TEXT PRIMARY KEY,
      view_uuid     TEXT NOT NULL REFERENCES graph_views(uuid) ON DELETE CASCADE,
      source_uuid   TEXT NOT NULL REFERENCES tickets(uuid)     ON DELETE CASCADE,
      target_uuid   TEXT NOT NULL REFERENCES tickets(uuid)     ON DELETE CASCADE,
      source_handle TEXT,
      target_handle TEXT
    );

  `);
	try {
		db.exec("ALTER TABLE graph_view_edges ADD COLUMN source_handle TEXT");
	} catch {}
	try {
		db.exec("ALTER TABLE graph_view_edges ADD COLUMN target_handle TEXT");
	} catch {}
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
	if (!description.trim()) return;
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
//#region electron/vault/vaultManager.ts
var vaultDir = "";
/** In-memory map of uuid → last written filename (for rename/delete cleanup). */
var lastPaths = /* @__PURE__ */ new Map();
function initVault(dir) {
	vaultDir = dir;
	fs.mkdirSync(dir, { recursive: true });
	rebuildIndex();
}
function getVaultDir() {
	return vaultDir;
}
/**
* Rebuilds the uuid → filename map from files already on disk. Without this,
* the map starts empty each session and renames/archives/deletes of tickets
* created in a previous session can't find their stale .md file.
*/
function rebuildIndex() {
	lastPaths.clear();
	for (const filename of fs.readdirSync(vaultDir)) {
		if (!filename.endsWith(".md")) continue;
		const match = fs.readFileSync(path.join(vaultDir, filename), "utf8").match(/^uuid:\s*(.+)$/m);
		if (match) lastPaths.set(match[1].trim(), filename);
	}
}
function buildFrontmatter(ticket) {
	return [
		"---",
		`uuid: ${ticket.uuid}`,
		`id: ${ticket.id}`,
		`title: ${ticket.title}`,
		`type: ${ticket.type}`,
		`status: ${ticket.status}`,
		`backlog: ${ticket.backlog === 1}`,
		"---"
	].join("\n");
}
/** Writes a ticket's .md file. If the ticket is archived or missing, deletes instead. */
function vaultWrite(uuid) {
	if (!vaultDir) return;
	const ticket = runSql("SELECT * FROM tickets WHERE uuid = ? LIMIT 1", [uuid])[0];
	if (!ticket || ticket.archived === 1) {
		vaultDelete(uuid);
		return;
	}
	const filename = `${ticket.id}.md`;
	const newPath = path.join(vaultDir, filename);
	const oldFilename = lastPaths.get(uuid);
	if (oldFilename && oldFilename !== filename) fs.rmSync(path.join(vaultDir, oldFilename), { force: true });
	const content = `${buildFrontmatter(ticket)}\n\n${ticket.description}`;
	fs.writeFileSync(newPath, content, "utf8");
	lastPaths.set(uuid, filename);
}
/** Removes a ticket's .md file using the cached filename. */
function vaultDelete(uuid) {
	if (!vaultDir) return;
	const filename = lastPaths.get(uuid);
	if (filename) {
		fs.rmSync(path.join(vaultDir, filename), { force: true });
		lastPaths.delete(uuid);
	}
}
/** Removes all .md files and resets the vault directory. */
function vaultClear() {
	if (!vaultDir) return;
	fs.rmSync(vaultDir, {
		recursive: true,
		force: true
	});
	fs.mkdirSync(vaultDir, { recursive: true });
	lastPaths.clear();
}
//#endregion
//#region node_modules/readdirp/index.js
var EntryTypes = {
	FILE_TYPE: "files",
	DIR_TYPE: "directories",
	FILE_DIR_TYPE: "files_directories",
	EVERYTHING_TYPE: "all"
};
var defaultOptions = {
	root: ".",
	fileFilter: (_entryInfo) => true,
	directoryFilter: (_entryInfo) => true,
	type: EntryTypes.FILE_TYPE,
	lstat: false,
	depth: 2147483648,
	alwaysStat: false,
	highWaterMark: 4096
};
Object.freeze(defaultOptions);
var RECURSIVE_ERROR_CODE = "READDIRP_RECURSIVE_ERROR";
var NORMAL_FLOW_ERRORS = new Set([
	"ENOENT",
	"EPERM",
	"EACCES",
	"ELOOP",
	RECURSIVE_ERROR_CODE
]);
var ALL_TYPES = [
	EntryTypes.DIR_TYPE,
	EntryTypes.EVERYTHING_TYPE,
	EntryTypes.FILE_DIR_TYPE,
	EntryTypes.FILE_TYPE
];
var DIR_TYPES = new Set([
	EntryTypes.DIR_TYPE,
	EntryTypes.EVERYTHING_TYPE,
	EntryTypes.FILE_DIR_TYPE
]);
var FILE_TYPES = new Set([
	EntryTypes.EVERYTHING_TYPE,
	EntryTypes.FILE_DIR_TYPE,
	EntryTypes.FILE_TYPE
]);
var isNormalFlowError = (error) => NORMAL_FLOW_ERRORS.has(error.code);
var wantBigintFsStats = process.platform === "win32";
var emptyFn = (_entryInfo) => true;
var normalizeFilter = (filter) => {
	if (filter === void 0) return emptyFn;
	if (typeof filter === "function") return filter;
	if (typeof filter === "string") {
		const fl = filter.trim();
		return (entry) => entry.basename === fl;
	}
	if (Array.isArray(filter)) {
		const trItems = filter.map((item) => item.trim());
		return (entry) => trItems.some((f) => entry.basename === f);
	}
	return emptyFn;
};
/** Readable readdir stream, emitting new files as they're being listed. */
var ReaddirpStream = class extends Readable {
	parents;
	reading;
	parent;
	_stat;
	_maxDepth;
	_wantsDir;
	_wantsFile;
	_wantsEverything;
	_root;
	_isDirent;
	_statsProp;
	_rdOptions;
	_fileFilter;
	_directoryFilter;
	constructor(options = {}) {
		super({
			objectMode: true,
			autoDestroy: true,
			highWaterMark: options.highWaterMark
		});
		const opts = {
			...defaultOptions,
			...options
		};
		const { root, type } = opts;
		this._fileFilter = normalizeFilter(opts.fileFilter);
		this._directoryFilter = normalizeFilter(opts.directoryFilter);
		const statMethod = opts.lstat ? lstat : stat$1;
		if (wantBigintFsStats) this._stat = (path) => statMethod(path, { bigint: true });
		else this._stat = statMethod;
		this._maxDepth = opts.depth != null && Number.isSafeInteger(opts.depth) ? opts.depth : defaultOptions.depth;
		this._wantsDir = type ? DIR_TYPES.has(type) : false;
		this._wantsFile = type ? FILE_TYPES.has(type) : false;
		this._wantsEverything = type === EntryTypes.EVERYTHING_TYPE;
		this._root = resolve(root);
		this._isDirent = !opts.alwaysStat;
		this._statsProp = this._isDirent ? "dirent" : "stats";
		this._rdOptions = {
			encoding: "utf8",
			withFileTypes: this._isDirent
		};
		this.parents = [this._exploreDir(root, 1)];
		this.reading = false;
		this.parent = void 0;
	}
	async _read(batch) {
		if (this.reading) return;
		this.reading = true;
		try {
			while (!this.destroyed && batch > 0) {
				const par = this.parent;
				const fil = par && par.files;
				if (fil && fil.length > 0) {
					const { path, depth } = par;
					const slice = fil.splice(0, batch).map((dirent) => this._formatEntry(dirent, path));
					const awaited = await Promise.all(slice);
					for (const entry of awaited) {
						if (!entry) continue;
						if (this.destroyed) return;
						const entryType = await this._getEntryType(entry);
						if (entryType === "directory" && this._directoryFilter(entry)) {
							if (depth <= this._maxDepth) this.parents.push(this._exploreDir(entry.fullPath, depth + 1));
							if (this._wantsDir) {
								this.push(entry);
								batch--;
							}
						} else if ((entryType === "file" || this._includeAsFile(entry)) && this._fileFilter(entry)) {
							if (this._wantsFile) {
								this.push(entry);
								batch--;
							}
						}
					}
				} else {
					const parent = this.parents.pop();
					if (!parent) {
						this.push(null);
						break;
					}
					this.parent = await parent;
					if (this.destroyed) return;
				}
			}
		} catch (error) {
			this.destroy(error);
		} finally {
			this.reading = false;
		}
	}
	async _exploreDir(path, depth) {
		let files;
		try {
			files = await readdir(path, this._rdOptions);
		} catch (error) {
			this._onError(error);
		}
		return {
			files,
			depth,
			path
		};
	}
	async _formatEntry(dirent, path) {
		let entry;
		const basename = this._isDirent ? dirent.name : dirent;
		try {
			const fullPath = resolve(join(path, basename));
			entry = {
				path: relative(this._root, fullPath),
				fullPath,
				basename
			};
			entry[this._statsProp] = this._isDirent ? dirent : await this._stat(fullPath);
		} catch (err) {
			this._onError(err);
			return;
		}
		return entry;
	}
	_onError(err) {
		if (isNormalFlowError(err) && !this.destroyed) this.emit("warn", err);
		else this.destroy(err);
	}
	async _getEntryType(entry) {
		if (!entry && this._statsProp in entry) return "";
		const stats = entry[this._statsProp];
		if (stats.isFile()) return "file";
		if (stats.isDirectory()) return "directory";
		if (stats && stats.isSymbolicLink()) {
			const full = entry.fullPath;
			try {
				const entryRealPath = await realpath(full);
				const entryRealPathStats = await lstat(entryRealPath);
				if (entryRealPathStats.isFile()) return "file";
				if (entryRealPathStats.isDirectory()) {
					const len = entryRealPath.length;
					if (full.startsWith(entryRealPath) && full.substr(len, 1) === sep) {
						const recursiveError = /* @__PURE__ */ new Error(`Circular symlink detected: "${full}" points to "${entryRealPath}"`);
						recursiveError.code = RECURSIVE_ERROR_CODE;
						return this._onError(recursiveError);
					}
					return "directory";
				}
			} catch (error) {
				this._onError(error);
				return "";
			}
		}
	}
	_includeAsFile(entry) {
		const stats = entry && entry[this._statsProp];
		return stats && this._wantsEverything && !stats.isDirectory();
	}
};
/**
* Streaming version: Reads all files and directories in given root recursively.
* Consumes ~constant small amount of RAM.
* @param root Root directory
* @param options Options to specify root (start directory), filters and recursion depth
*/
function readdirp(root, options = {}) {
	let type = options.entryType || options.type;
	if (type === "both") type = EntryTypes.FILE_DIR_TYPE;
	if (type) options.type = type;
	if (!root) throw new Error("readdirp: root argument is required. Usage: readdirp(root, options)");
	else if (typeof root !== "string") throw new TypeError("readdirp: root argument must be a string. Usage: readdirp(root, options)");
	else if (type && !ALL_TYPES.includes(type)) throw new Error(`readdirp: Invalid type passed. Use one of ${ALL_TYPES.join(", ")}`);
	options.root = root;
	return new ReaddirpStream(options);
}
//#endregion
//#region node_modules/chokidar/handler.js
var STR_DATA = "data";
var STR_CLOSE = "close";
var EMPTY_FN = () => {};
var pl = process.platform;
var isWindows = pl === "win32";
var isMacos = pl === "darwin";
var isLinux = pl === "linux";
var isFreeBSD = pl === "freebsd";
var isIBMi = type() === "OS400";
var EVENTS = {
	ALL: "all",
	READY: "ready",
	ADD: "add",
	CHANGE: "change",
	ADD_DIR: "addDir",
	UNLINK: "unlink",
	UNLINK_DIR: "unlinkDir",
	RAW: "raw",
	ERROR: "error"
};
var EV = EVENTS;
var THROTTLE_MODE_WATCH = "watch";
var statMethods = {
	lstat,
	stat: stat$1
};
var KEY_LISTENERS = "listeners";
var KEY_ERR = "errHandlers";
var KEY_RAW = "rawEmitters";
var HANDLER_KEYS = [
	KEY_LISTENERS,
	KEY_ERR,
	KEY_RAW
];
var binaryExtensions = new Set([
	"3dm",
	"3ds",
	"3g2",
	"3gp",
	"7z",
	"a",
	"aac",
	"adp",
	"afdesign",
	"afphoto",
	"afpub",
	"ai",
	"aif",
	"aiff",
	"alz",
	"ape",
	"apk",
	"appimage",
	"ar",
	"arj",
	"asf",
	"au",
	"avi",
	"bak",
	"baml",
	"bh",
	"bin",
	"bk",
	"bmp",
	"btif",
	"bz2",
	"bzip2",
	"cab",
	"caf",
	"cgm",
	"class",
	"cmx",
	"cpio",
	"cr2",
	"cur",
	"dat",
	"dcm",
	"deb",
	"dex",
	"djvu",
	"dll",
	"dmg",
	"dng",
	"doc",
	"docm",
	"docx",
	"dot",
	"dotm",
	"dra",
	"DS_Store",
	"dsk",
	"dts",
	"dtshd",
	"dvb",
	"dwg",
	"dxf",
	"ecelp4800",
	"ecelp7470",
	"ecelp9600",
	"egg",
	"eol",
	"eot",
	"epub",
	"exe",
	"f4v",
	"fbs",
	"fh",
	"fla",
	"flac",
	"flatpak",
	"fli",
	"flv",
	"fpx",
	"fst",
	"fvt",
	"g3",
	"gh",
	"gif",
	"graffle",
	"gz",
	"gzip",
	"h261",
	"h263",
	"h264",
	"icns",
	"ico",
	"ief",
	"img",
	"ipa",
	"iso",
	"jar",
	"jpeg",
	"jpg",
	"jpgv",
	"jpm",
	"jxr",
	"key",
	"ktx",
	"lha",
	"lib",
	"lvp",
	"lz",
	"lzh",
	"lzma",
	"lzo",
	"m3u",
	"m4a",
	"m4v",
	"mar",
	"mdi",
	"mht",
	"mid",
	"midi",
	"mj2",
	"mka",
	"mkv",
	"mmr",
	"mng",
	"mobi",
	"mov",
	"movie",
	"mp3",
	"mp4",
	"mp4a",
	"mpeg",
	"mpg",
	"mpga",
	"mxu",
	"nef",
	"npx",
	"numbers",
	"nupkg",
	"o",
	"odp",
	"ods",
	"odt",
	"oga",
	"ogg",
	"ogv",
	"otf",
	"ott",
	"pages",
	"pbm",
	"pcx",
	"pdb",
	"pdf",
	"pea",
	"pgm",
	"pic",
	"png",
	"pnm",
	"pot",
	"potm",
	"potx",
	"ppa",
	"ppam",
	"ppm",
	"pps",
	"ppsm",
	"ppsx",
	"ppt",
	"pptm",
	"pptx",
	"psd",
	"pya",
	"pyc",
	"pyo",
	"pyv",
	"qt",
	"rar",
	"ras",
	"raw",
	"resources",
	"rgb",
	"rip",
	"rlc",
	"rmf",
	"rmvb",
	"rpm",
	"rtf",
	"rz",
	"s3m",
	"s7z",
	"scpt",
	"sgi",
	"shar",
	"snap",
	"sil",
	"sketch",
	"slk",
	"smv",
	"snk",
	"so",
	"stl",
	"suo",
	"sub",
	"swf",
	"tar",
	"tbz",
	"tbz2",
	"tga",
	"tgz",
	"thmx",
	"tif",
	"tiff",
	"tlz",
	"ttc",
	"ttf",
	"txz",
	"udf",
	"uvh",
	"uvi",
	"uvm",
	"uvp",
	"uvs",
	"uvu",
	"viv",
	"vob",
	"war",
	"wav",
	"wax",
	"wbmp",
	"wdp",
	"weba",
	"webm",
	"webp",
	"whl",
	"wim",
	"wm",
	"wma",
	"wmv",
	"wmx",
	"woff",
	"woff2",
	"wrm",
	"wvx",
	"xbm",
	"xif",
	"xla",
	"xlam",
	"xls",
	"xlsb",
	"xlsm",
	"xlsx",
	"xlt",
	"xltm",
	"xltx",
	"xm",
	"xmind",
	"xpi",
	"xpm",
	"xwd",
	"xz",
	"z",
	"zip",
	"zipx"
]);
var isBinaryPath = (filePath) => binaryExtensions.has(sp.extname(filePath).slice(1).toLowerCase());
var foreach = (val, fn) => {
	if (val instanceof Set) val.forEach(fn);
	else fn(val);
};
var addAndConvert = (main, prop, item) => {
	let container = main[prop];
	if (!(container instanceof Set)) main[prop] = container = new Set([container]);
	container.add(item);
};
var clearItem = (cont) => (key) => {
	const set = cont[key];
	if (set instanceof Set) set.clear();
	else delete cont[key];
};
var delFromSet = (main, prop, item) => {
	const container = main[prop];
	if (container instanceof Set) container.delete(item);
	else if (container === item) delete main[prop];
};
var isEmptySet = (val) => val instanceof Set ? val.size === 0 : !val;
var FsWatchInstances = /* @__PURE__ */ new Map();
/**
* Instantiates the fs_watch interface
* @param path to be watched
* @param options to be passed to fs_watch
* @param listener main event handler
* @param errHandler emits info about errors
* @param emitRaw emits raw event data
* @returns {NativeFsWatcher}
*/
function createFsWatchInstance(path, options, listener, errHandler, emitRaw) {
	const handleEvent = (rawEvent, evPath) => {
		listener(path);
		emitRaw(rawEvent, evPath, { watchedPath: path });
		if (evPath && path !== evPath) fsWatchBroadcast(sp.resolve(path, evPath), KEY_LISTENERS, sp.join(path, evPath));
	};
	try {
		return watch(path, { persistent: options.persistent }, handleEvent);
	} catch (error) {
		errHandler(error);
		return;
	}
}
/**
* Helper for passing fs_watch event data to a collection of listeners
* @param fullPath absolute path bound to fs_watch instance
*/
var fsWatchBroadcast = (fullPath, listenerType, val1, val2, val3) => {
	const cont = FsWatchInstances.get(fullPath);
	if (!cont) return;
	foreach(cont[listenerType], (listener) => {
		listener(val1, val2, val3);
	});
};
/**
* Instantiates the fs_watch interface or binds listeners
* to an existing one covering the same file system entry
* @param path
* @param fullPath absolute path
* @param options to be passed to fs_watch
* @param handlers container for event listener functions
*/
var setFsWatchListener = (path, fullPath, options, handlers) => {
	const { listener, errHandler, rawEmitter } = handlers;
	let cont = FsWatchInstances.get(fullPath);
	let watcher;
	if (!options.persistent) {
		watcher = createFsWatchInstance(path, options, listener, errHandler, rawEmitter);
		if (!watcher) return;
		return watcher.close.bind(watcher);
	}
	if (cont) {
		addAndConvert(cont, KEY_LISTENERS, listener);
		addAndConvert(cont, KEY_ERR, errHandler);
		addAndConvert(cont, KEY_RAW, rawEmitter);
	} else {
		watcher = createFsWatchInstance(path, options, fsWatchBroadcast.bind(null, fullPath, KEY_LISTENERS), errHandler, fsWatchBroadcast.bind(null, fullPath, KEY_RAW));
		if (!watcher) return;
		watcher.on(EV.ERROR, async (error) => {
			const broadcastErr = fsWatchBroadcast.bind(null, fullPath, KEY_ERR);
			if (cont) cont.watcherUnusable = true;
			if (isWindows && error.code === "EPERM") try {
				await (await open(path, "r")).close();
				broadcastErr(error);
			} catch (err) {}
			else broadcastErr(error);
		});
		cont = {
			listeners: listener,
			errHandlers: errHandler,
			rawEmitters: rawEmitter,
			watcher
		};
		FsWatchInstances.set(fullPath, cont);
	}
	return () => {
		delFromSet(cont, KEY_LISTENERS, listener);
		delFromSet(cont, KEY_ERR, errHandler);
		delFromSet(cont, KEY_RAW, rawEmitter);
		if (isEmptySet(cont.listeners)) {
			cont.watcher.close();
			FsWatchInstances.delete(fullPath);
			HANDLER_KEYS.forEach(clearItem(cont));
			cont.watcher = void 0;
			Object.freeze(cont);
		}
	};
};
var FsWatchFileInstances = /* @__PURE__ */ new Map();
/**
* Instantiates the fs_watchFile interface or binds listeners
* to an existing one covering the same file system entry
* @param path to be watched
* @param fullPath absolute path
* @param options options to be passed to fs_watchFile
* @param handlers container for event listener functions
* @returns closer
*/
var setFsWatchFileListener = (path, fullPath, options, handlers) => {
	const { listener, rawEmitter } = handlers;
	let cont = FsWatchFileInstances.get(fullPath);
	const copts = cont && cont.options;
	if (copts && (copts.persistent < options.persistent || copts.interval > options.interval)) {
		unwatchFile(fullPath);
		cont = void 0;
	}
	if (cont) {
		addAndConvert(cont, KEY_LISTENERS, listener);
		addAndConvert(cont, KEY_RAW, rawEmitter);
	} else {
		cont = {
			listeners: listener,
			rawEmitters: rawEmitter,
			options,
			watcher: watchFile(fullPath, options, (curr, prev) => {
				foreach(cont.rawEmitters, (rawEmitter) => {
					rawEmitter(EV.CHANGE, fullPath, {
						curr,
						prev
					});
				});
				const currmtime = curr.mtimeMs;
				if (curr.size !== prev.size || currmtime > prev.mtimeMs || currmtime === 0) foreach(cont.listeners, (listener) => listener(path, curr));
			})
		};
		FsWatchFileInstances.set(fullPath, cont);
	}
	return () => {
		delFromSet(cont, KEY_LISTENERS, listener);
		delFromSet(cont, KEY_RAW, rawEmitter);
		if (isEmptySet(cont.listeners)) {
			FsWatchFileInstances.delete(fullPath);
			unwatchFile(fullPath);
			cont.options = cont.watcher = void 0;
			Object.freeze(cont);
		}
	};
};
/**
* @mixin
*/
var NodeFsHandler = class {
	fsw;
	_boundHandleError;
	constructor(fsW) {
		this.fsw = fsW;
		this._boundHandleError = (error) => fsW._handleError(error);
	}
	/**
	* Watch file for changes with fs_watchFile or fs_watch.
	* @param path to file or dir
	* @param listener on fs change
	* @returns closer for the watcher instance
	*/
	_watchWithNodeFs(path, listener) {
		const opts = this.fsw.options;
		const directory = sp.dirname(path);
		const basename = sp.basename(path);
		this.fsw._getWatchedDir(directory).add(basename);
		const absolutePath = sp.resolve(path);
		const options = { persistent: opts.persistent };
		if (!listener) listener = EMPTY_FN;
		let closer;
		if (opts.usePolling) {
			options.interval = opts.interval !== opts.binaryInterval && isBinaryPath(basename) ? opts.binaryInterval : opts.interval;
			closer = setFsWatchFileListener(path, absolutePath, options, {
				listener,
				rawEmitter: this.fsw._emitRaw
			});
		} else closer = setFsWatchListener(path, absolutePath, options, {
			listener,
			errHandler: this._boundHandleError,
			rawEmitter: this.fsw._emitRaw
		});
		return closer;
	}
	/**
	* Watch a file and emit add event if warranted.
	* @returns closer for the watcher instance
	*/
	_handleFile(file, stats, initialAdd) {
		if (this.fsw.closed) return;
		const dirname = sp.dirname(file);
		const basename = sp.basename(file);
		const parent = this.fsw._getWatchedDir(dirname);
		let prevStats = stats;
		if (parent.has(basename)) return;
		const listener = async (path, newStats) => {
			if (!this.fsw._throttle(THROTTLE_MODE_WATCH, file, 5)) return;
			if (!newStats || newStats.mtimeMs === 0) try {
				const newStats = await stat$1(file);
				if (this.fsw.closed) return;
				const at = newStats.atimeMs;
				const mt = newStats.mtimeMs;
				if (!at || at <= mt || mt !== prevStats.mtimeMs) this.fsw._emit(EV.CHANGE, file, newStats);
				if ((isMacos || isLinux || isFreeBSD) && prevStats.ino !== newStats.ino) {
					this.fsw._closeFile(path);
					prevStats = newStats;
					const closer = this._watchWithNodeFs(file, listener);
					if (closer) this.fsw._addPathCloser(path, closer);
				} else prevStats = newStats;
			} catch (error) {
				this.fsw._remove(dirname, basename);
			}
			else if (parent.has(basename)) {
				const at = newStats.atimeMs;
				const mt = newStats.mtimeMs;
				if (!at || at <= mt || mt !== prevStats.mtimeMs) this.fsw._emit(EV.CHANGE, file, newStats);
				prevStats = newStats;
			}
		};
		const closer = this._watchWithNodeFs(file, listener);
		if (!(initialAdd && this.fsw.options.ignoreInitial) && this.fsw._isntIgnored(file)) {
			if (!this.fsw._throttle(EV.ADD, file, 0)) return;
			this.fsw._emit(EV.ADD, file, stats);
		}
		return closer;
	}
	/**
	* Handle symlinks encountered while reading a dir.
	* @param entry returned by readdirp
	* @param directory path of dir being read
	* @param path of this item
	* @param item basename of this item
	* @returns true if no more processing is needed for this entry.
	*/
	async _handleSymlink(entry, directory, path, item) {
		if (this.fsw.closed) return;
		const full = entry.fullPath;
		const dir = this.fsw._getWatchedDir(directory);
		if (!this.fsw.options.followSymlinks) {
			this.fsw._incrReadyCount();
			let linkPath;
			try {
				linkPath = await realpath(path);
			} catch (e) {
				this.fsw._emitReady();
				return true;
			}
			if (this.fsw.closed) return;
			if (dir.has(item)) {
				if (this.fsw._symlinkPaths.get(full) !== linkPath) {
					this.fsw._symlinkPaths.set(full, linkPath);
					this.fsw._emit(EV.CHANGE, path, entry.stats);
				}
			} else {
				dir.add(item);
				this.fsw._symlinkPaths.set(full, linkPath);
				this.fsw._emit(EV.ADD, path, entry.stats);
			}
			this.fsw._emitReady();
			return true;
		}
		if (this.fsw._symlinkPaths.has(full)) return true;
		this.fsw._symlinkPaths.set(full, true);
	}
	_handleRead(directory, initialAdd, wh, target, dir, depth, throttler) {
		directory = sp.join(directory, "");
		const throttleKey = target ? `${directory}:${target}` : directory;
		throttler = this.fsw._throttle("readdir", throttleKey, 1e3);
		if (!throttler) return;
		const previous = this.fsw._getWatchedDir(wh.path);
		const current = /* @__PURE__ */ new Set();
		let stream = this.fsw._readdirp(directory, {
			fileFilter: (entry) => wh.filterPath(entry),
			directoryFilter: (entry) => wh.filterDir(entry)
		});
		if (!stream) return;
		stream.on(STR_DATA, async (entry) => {
			if (this.fsw.closed) {
				stream = void 0;
				return;
			}
			const item = entry.path;
			let path = sp.join(directory, item);
			current.add(item);
			if (entry.stats.isSymbolicLink() && await this._handleSymlink(entry, directory, path, item)) return;
			if (this.fsw.closed) {
				stream = void 0;
				return;
			}
			if (item === target || !target && !previous.has(item)) {
				this.fsw._incrReadyCount();
				path = sp.join(dir, sp.relative(dir, path));
				this._addToNodeFs(path, initialAdd, wh, depth + 1);
			}
		}).on(EV.ERROR, this._boundHandleError);
		return new Promise((resolve, reject) => {
			if (!stream) return reject();
			stream.once("end", () => {
				if (this.fsw.closed) {
					stream = void 0;
					return;
				}
				const wasThrottled = throttler ? throttler.clear() : false;
				resolve(void 0);
				previous.getChildren().filter((item) => {
					return item !== directory && !current.has(item);
				}).forEach((item) => {
					this.fsw._remove(directory, item);
				});
				stream = void 0;
				if (wasThrottled) this._handleRead(directory, false, wh, target, dir, depth, throttler);
			});
		});
	}
	/**
	* Read directory to add / remove files from `@watched` list and re-read it on change.
	* @param dir fs path
	* @param stats
	* @param initialAdd
	* @param depth relative to user-supplied path
	* @param target child path targeted for watch
	* @param wh Common watch helpers for this path
	* @param realpath
	* @returns closer for the watcher instance.
	*/
	async _handleDir(dir, stats, initialAdd, depth, target, wh, realpath) {
		const parentDir = this.fsw._getWatchedDir(sp.dirname(dir));
		const tracked = parentDir.has(sp.basename(dir));
		if (!(initialAdd && this.fsw.options.ignoreInitial) && !target && !tracked) this.fsw._emit(EV.ADD_DIR, dir, stats);
		parentDir.add(sp.basename(dir));
		this.fsw._getWatchedDir(dir);
		let throttler;
		let closer;
		const oDepth = this.fsw.options.depth;
		if ((oDepth == null || depth <= oDepth) && !this.fsw._symlinkPaths.has(realpath)) {
			if (!target) {
				await this._handleRead(dir, initialAdd, wh, target, dir, depth, throttler);
				if (this.fsw.closed) return;
			}
			closer = this._watchWithNodeFs(dir, (dirPath, stats) => {
				if (stats && stats.mtimeMs === 0) return;
				this._handleRead(dirPath, false, wh, target, dir, depth, throttler);
			});
		}
		return closer;
	}
	/**
	* Handle added file, directory, or glob pattern.
	* Delegates call to _handleFile / _handleDir after checks.
	* @param path to file or ir
	* @param initialAdd was the file added at watch instantiation?
	* @param priorWh depth relative to user-supplied path
	* @param depth Child path actually targeted for watch
	* @param target Child path actually targeted for watch
	*/
	async _addToNodeFs(path, initialAdd, priorWh, depth, target) {
		const ready = this.fsw._emitReady;
		if (this.fsw._isIgnored(path) || this.fsw.closed) {
			ready();
			return false;
		}
		const wh = this.fsw._getWatchHelpers(path);
		if (priorWh) {
			wh.filterPath = (entry) => priorWh.filterPath(entry);
			wh.filterDir = (entry) => priorWh.filterDir(entry);
		}
		try {
			const stats = await statMethods[wh.statMethod](wh.watchPath);
			if (this.fsw.closed) return;
			if (this.fsw._isIgnored(wh.watchPath, stats)) {
				ready();
				return false;
			}
			const follow = this.fsw.options.followSymlinks;
			let closer;
			if (stats.isDirectory()) {
				const absPath = sp.resolve(path);
				const targetPath = follow ? await realpath(path) : path;
				if (this.fsw.closed) return;
				closer = await this._handleDir(wh.watchPath, stats, initialAdd, depth, target, wh, targetPath);
				if (this.fsw.closed) return;
				if (absPath !== targetPath && targetPath !== void 0) this.fsw._symlinkPaths.set(absPath, targetPath);
			} else if (stats.isSymbolicLink()) {
				const targetPath = follow ? await realpath(path) : path;
				if (this.fsw.closed) return;
				const parent = sp.dirname(wh.watchPath);
				this.fsw._getWatchedDir(parent).add(wh.watchPath);
				this.fsw._emit(EV.ADD, wh.watchPath, stats);
				closer = await this._handleDir(parent, stats, initialAdd, depth, path, wh, targetPath);
				if (this.fsw.closed) return;
				if (targetPath !== void 0) this.fsw._symlinkPaths.set(sp.resolve(path), targetPath);
			} else closer = this._handleFile(wh.watchPath, stats, initialAdd);
			ready();
			if (closer) this.fsw._addPathCloser(path, closer);
			return false;
		} catch (error) {
			if (this.fsw._handleError(error)) {
				ready();
				return path;
			}
		}
	}
};
//#endregion
//#region node_modules/chokidar/index.js
/*! chokidar - MIT License (c) 2012 Paul Miller (paulmillr.com) */
var SLASH = "/";
var SLASH_SLASH = "//";
var ONE_DOT = ".";
var TWO_DOTS = "..";
var STRING_TYPE = "string";
var BACK_SLASH_RE = /\\/g;
var DOUBLE_SLASH_RE = /\/\//g;
var DOT_RE = /\..*\.(sw[px])$|~$|\.subl.*\.tmp/;
var REPLACER_RE = /^\.[/\\]/;
function arrify(item) {
	return Array.isArray(item) ? item : [item];
}
var isMatcherObject = (matcher) => typeof matcher === "object" && matcher !== null && !(matcher instanceof RegExp);
function createPattern(matcher) {
	if (typeof matcher === "function") return matcher;
	if (typeof matcher === "string") return (string) => matcher === string;
	if (matcher instanceof RegExp) return (string) => matcher.test(string);
	if (typeof matcher === "object" && matcher !== null) return (string) => {
		if (matcher.path === string) return true;
		if (matcher.recursive) {
			const relative = sp.relative(matcher.path, string);
			if (!relative) return false;
			return !relative.startsWith("..") && !sp.isAbsolute(relative);
		}
		return false;
	};
	return () => false;
}
function normalizePath(path) {
	if (typeof path !== "string") throw new Error("string expected");
	path = sp.normalize(path);
	path = path.replace(/\\/g, "/");
	let prepend = false;
	if (path.startsWith("//")) prepend = true;
	path = path.replace(DOUBLE_SLASH_RE, "/");
	if (prepend) path = "/" + path;
	return path;
}
function matchPatterns(patterns, testString, stats) {
	const path = normalizePath(testString);
	for (let index = 0; index < patterns.length; index++) {
		const pattern = patterns[index];
		if (pattern(path, stats)) return true;
	}
	return false;
}
function anymatch(matchers, testString) {
	if (matchers == null) throw new TypeError("anymatch: specify first argument");
	const patterns = arrify(matchers).map((matcher) => createPattern(matcher));
	if (testString == null) return (testString, stats) => {
		return matchPatterns(patterns, testString, stats);
	};
	return matchPatterns(patterns, testString);
}
var unifyPaths = (paths_) => {
	const paths = arrify(paths_).flat();
	if (!paths.every((p) => typeof p === STRING_TYPE)) throw new TypeError(`Non-string provided as watch path: ${paths}`);
	return paths.map(normalizePathToUnix);
};
var toUnix = (string) => {
	let str = string.replace(BACK_SLASH_RE, SLASH);
	let prepend = false;
	if (str.startsWith(SLASH_SLASH)) prepend = true;
	str = str.replace(DOUBLE_SLASH_RE, SLASH);
	if (prepend) str = SLASH + str;
	return str;
};
var normalizePathToUnix = (path) => toUnix(sp.normalize(toUnix(path)));
var normalizeIgnored = (cwd = "") => (path) => {
	if (typeof path === "string") return normalizePathToUnix(sp.isAbsolute(path) ? path : sp.join(cwd, path));
	else return path;
};
var getAbsolutePath = (path, cwd) => {
	if (sp.isAbsolute(path)) return path;
	return sp.join(cwd, path);
};
var EMPTY_SET = Object.freeze(/* @__PURE__ */ new Set());
/**
* Directory entry.
*/
var DirEntry = class {
	path;
	_removeWatcher;
	items;
	constructor(dir, removeWatcher) {
		this.path = dir;
		this._removeWatcher = removeWatcher;
		this.items = /* @__PURE__ */ new Set();
	}
	add(item) {
		const { items } = this;
		if (!items) return;
		if (item !== ONE_DOT && item !== TWO_DOTS) items.add(item);
	}
	async remove(item) {
		const { items } = this;
		if (!items) return;
		items.delete(item);
		if (items.size > 0) return;
		const dir = this.path;
		try {
			await readdir(dir);
		} catch (err) {
			if (this._removeWatcher) this._removeWatcher(sp.dirname(dir), sp.basename(dir));
		}
	}
	has(item) {
		const { items } = this;
		if (!items) return;
		return items.has(item);
	}
	getChildren() {
		const { items } = this;
		if (!items) return [];
		return [...items.values()];
	}
	dispose() {
		this.items.clear();
		this.path = "";
		this._removeWatcher = EMPTY_FN;
		this.items = EMPTY_SET;
		Object.freeze(this);
	}
};
var STAT_METHOD_F = "stat";
var STAT_METHOD_L = "lstat";
var WatchHelper = class {
	fsw;
	path;
	watchPath;
	fullWatchPath;
	dirParts;
	followSymlinks;
	statMethod;
	constructor(path, follow, fsw) {
		this.fsw = fsw;
		const watchPath = path;
		this.path = path = path.replace(REPLACER_RE, "");
		this.watchPath = watchPath;
		this.fullWatchPath = sp.resolve(watchPath);
		this.dirParts = [];
		this.dirParts.forEach((parts) => {
			if (parts.length > 1) parts.pop();
		});
		this.followSymlinks = follow;
		this.statMethod = follow ? STAT_METHOD_F : STAT_METHOD_L;
	}
	entryPath(entry) {
		return sp.join(this.watchPath, sp.relative(this.watchPath, entry.fullPath));
	}
	filterPath(entry) {
		const { stats } = entry;
		if (stats && stats.isSymbolicLink()) return this.filterDir(entry);
		const resolvedPath = this.entryPath(entry);
		return this.fsw._isntIgnored(resolvedPath, stats) && this.fsw._hasReadPermissions(stats);
	}
	filterDir(entry) {
		return this.fsw._isntIgnored(this.entryPath(entry), entry.stats);
	}
};
/**
* Watches files & directories for changes. Emitted events:
* `add`, `addDir`, `change`, `unlink`, `unlinkDir`, `all`, `error`
*
*     new FSWatcher()
*       .add(directories)
*       .on('add', path => log('File', path, 'was added'))
*/
var FSWatcher = class extends EventEmitter {
	closed;
	options;
	_closers;
	_ignoredPaths;
	_throttled;
	_streams;
	_symlinkPaths;
	_watched;
	_pendingWrites;
	_pendingUnlinks;
	_readyCount;
	_emitReady;
	_closePromise;
	_userIgnored;
	_readyEmitted;
	_emitRaw;
	_boundRemove;
	_nodeFsHandler;
	constructor(_opts = {}) {
		super();
		this.closed = false;
		this._closers = /* @__PURE__ */ new Map();
		this._ignoredPaths = /* @__PURE__ */ new Set();
		this._throttled = /* @__PURE__ */ new Map();
		this._streams = /* @__PURE__ */ new Set();
		this._symlinkPaths = /* @__PURE__ */ new Map();
		this._watched = /* @__PURE__ */ new Map();
		this._pendingWrites = /* @__PURE__ */ new Map();
		this._pendingUnlinks = /* @__PURE__ */ new Map();
		this._readyCount = 0;
		this._readyEmitted = false;
		const awf = _opts.awaitWriteFinish;
		const DEF_AWF = {
			stabilityThreshold: 2e3,
			pollInterval: 100
		};
		const opts = {
			persistent: true,
			ignoreInitial: false,
			ignorePermissionErrors: false,
			interval: 100,
			binaryInterval: 300,
			followSymlinks: true,
			usePolling: false,
			atomic: true,
			..._opts,
			ignored: _opts.ignored ? arrify(_opts.ignored) : arrify([]),
			awaitWriteFinish: awf === true ? DEF_AWF : typeof awf === "object" ? {
				...DEF_AWF,
				...awf
			} : false
		};
		if (isIBMi) opts.usePolling = true;
		if (opts.atomic === void 0) opts.atomic = !opts.usePolling;
		const envPoll = process.env.CHOKIDAR_USEPOLLING;
		if (envPoll !== void 0) {
			const envLower = envPoll.toLowerCase();
			if (envLower === "false" || envLower === "0") opts.usePolling = false;
			else if (envLower === "true" || envLower === "1") opts.usePolling = true;
			else opts.usePolling = !!envLower;
		}
		const envInterval = process.env.CHOKIDAR_INTERVAL;
		if (envInterval) opts.interval = Number.parseInt(envInterval, 10);
		let readyCalls = 0;
		this._emitReady = () => {
			readyCalls++;
			if (readyCalls >= this._readyCount) {
				this._emitReady = EMPTY_FN;
				this._readyEmitted = true;
				process.nextTick(() => this.emit(EVENTS.READY));
			}
		};
		this._emitRaw = (...args) => this.emit(EVENTS.RAW, ...args);
		this._boundRemove = this._remove.bind(this);
		this.options = opts;
		this._nodeFsHandler = new NodeFsHandler(this);
		Object.freeze(opts);
	}
	_addIgnoredPath(matcher) {
		if (isMatcherObject(matcher)) {
			for (const ignored of this._ignoredPaths) if (isMatcherObject(ignored) && ignored.path === matcher.path && ignored.recursive === matcher.recursive) return;
		}
		this._ignoredPaths.add(matcher);
	}
	_removeIgnoredPath(matcher) {
		this._ignoredPaths.delete(matcher);
		if (typeof matcher === "string") {
			for (const ignored of this._ignoredPaths) if (isMatcherObject(ignored) && ignored.path === matcher) this._ignoredPaths.delete(ignored);
		}
	}
	/**
	* Adds paths to be watched on an existing FSWatcher instance.
	* @param paths_ file or file list. Other arguments are unused
	*/
	add(paths_, _origAdd, _internal) {
		const { cwd } = this.options;
		this.closed = false;
		this._closePromise = void 0;
		let paths = unifyPaths(paths_);
		if (cwd) paths = paths.map((path) => {
			return getAbsolutePath(path, cwd);
		});
		paths.forEach((path) => {
			this._removeIgnoredPath(path);
		});
		this._userIgnored = void 0;
		if (!this._readyCount) this._readyCount = 0;
		this._readyCount += paths.length;
		Promise.all(paths.map(async (path) => {
			const res = await this._nodeFsHandler._addToNodeFs(path, !_internal, void 0, 0, _origAdd);
			if (res) this._emitReady();
			return res;
		})).then((results) => {
			if (this.closed) return;
			results.forEach((item) => {
				if (item) this.add(sp.dirname(item), sp.basename(_origAdd || item));
			});
		});
		return this;
	}
	/**
	* Close watchers or start ignoring events from specified paths.
	*/
	unwatch(paths_) {
		if (this.closed) return this;
		const paths = unifyPaths(paths_);
		const { cwd } = this.options;
		paths.forEach((path) => {
			if (!sp.isAbsolute(path) && !this._closers.has(path)) {
				if (cwd) path = sp.join(cwd, path);
				path = sp.resolve(path);
			}
			this._closePath(path);
			this._addIgnoredPath(path);
			if (this._watched.has(path)) this._addIgnoredPath({
				path,
				recursive: true
			});
			this._userIgnored = void 0;
		});
		return this;
	}
	/**
	* Close watchers and remove all listeners from watched paths.
	*/
	close() {
		if (this._closePromise) return this._closePromise;
		this.closed = true;
		this.removeAllListeners();
		const closers = [];
		this._closers.forEach((closerList) => closerList.forEach((closer) => {
			const promise = closer();
			if (promise instanceof Promise) closers.push(promise);
		}));
		this._streams.forEach((stream) => stream.destroy());
		this._userIgnored = void 0;
		this._readyCount = 0;
		this._readyEmitted = false;
		this._watched.forEach((dirent) => dirent.dispose());
		this._closers.clear();
		this._watched.clear();
		this._streams.clear();
		this._symlinkPaths.clear();
		this._throttled.clear();
		this._closePromise = closers.length ? Promise.all(closers).then(() => void 0) : Promise.resolve();
		return this._closePromise;
	}
	/**
	* Expose list of watched paths
	* @returns for chaining
	*/
	getWatched() {
		const watchList = {};
		this._watched.forEach((entry, dir) => {
			const index = (this.options.cwd ? sp.relative(this.options.cwd, dir) : dir) || ONE_DOT;
			watchList[index] = entry.getChildren().sort();
		});
		return watchList;
	}
	emitWithAll(event, args) {
		this.emit(event, ...args);
		if (event !== EVENTS.ERROR) this.emit(EVENTS.ALL, event, ...args);
	}
	/**
	* Normalize and emit events.
	* Calling _emit DOES NOT MEAN emit() would be called!
	* @param event Type of event
	* @param path File or directory path
	* @param stats arguments to be passed with event
	* @returns the error if defined, otherwise the value of the FSWatcher instance's `closed` flag
	*/
	async _emit(event, path, stats) {
		if (this.closed) return;
		const opts = this.options;
		if (isWindows) path = sp.normalize(path);
		if (opts.cwd) path = sp.relative(opts.cwd, path);
		const args = [path];
		if (stats != null) args.push(stats);
		const awf = opts.awaitWriteFinish;
		let pw;
		if (awf && (pw = this._pendingWrites.get(path))) {
			pw.lastChange = /* @__PURE__ */ new Date();
			return this;
		}
		if (opts.atomic) {
			if (event === EVENTS.UNLINK) {
				this._pendingUnlinks.set(path, [event, ...args]);
				setTimeout(() => {
					this._pendingUnlinks.forEach((entry, path) => {
						this.emit(...entry);
						this.emit(EVENTS.ALL, ...entry);
						this._pendingUnlinks.delete(path);
					});
				}, typeof opts.atomic === "number" ? opts.atomic : 100);
				return this;
			}
			if (event === EVENTS.ADD && this._pendingUnlinks.has(path)) {
				event = EVENTS.CHANGE;
				this._pendingUnlinks.delete(path);
			}
		}
		if (awf && (event === EVENTS.ADD || event === EVENTS.CHANGE) && this._readyEmitted) {
			const awfEmit = (err, stats) => {
				if (err) {
					event = EVENTS.ERROR;
					args[0] = err;
					this.emitWithAll(event, args);
				} else if (stats) {
					if (args.length > 1) args[1] = stats;
					else args.push(stats);
					this.emitWithAll(event, args);
				}
			};
			this._awaitWriteFinish(path, awf.stabilityThreshold, event, awfEmit);
			return this;
		}
		if (event === EVENTS.CHANGE) {
			if (!this._throttle(EVENTS.CHANGE, path, 50)) return this;
		}
		if (opts.alwaysStat && stats === void 0 && (event === EVENTS.ADD || event === EVENTS.ADD_DIR || event === EVENTS.CHANGE)) {
			const fullPath = opts.cwd ? sp.join(opts.cwd, path) : path;
			let stats;
			try {
				stats = await stat$1(fullPath);
			} catch (err) {}
			if (!stats || this.closed) return;
			args.push(stats);
		}
		this.emitWithAll(event, args);
		return this;
	}
	/**
	* Common handler for errors
	* @returns The error if defined, otherwise the value of the FSWatcher instance's `closed` flag
	*/
	_handleError(error) {
		const code = error && error.code;
		if (error && code !== "ENOENT" && code !== "ENOTDIR" && (!this.options.ignorePermissionErrors || code !== "EPERM" && code !== "EACCES")) this.emit(EVENTS.ERROR, error);
		return error || this.closed;
	}
	/**
	* Helper utility for throttling
	* @param actionType type being throttled
	* @param path being acted upon
	* @param timeout duration of time to suppress duplicate actions
	* @returns tracking object or false if action should be suppressed
	*/
	_throttle(actionType, path, timeout) {
		if (!this._throttled.has(actionType)) this._throttled.set(actionType, /* @__PURE__ */ new Map());
		const action = this._throttled.get(actionType);
		if (!action) throw new Error("invalid throttle");
		const actionPath = action.get(path);
		if (actionPath) {
			actionPath.count++;
			return false;
		}
		let timeoutObject;
		const clear = () => {
			const item = action.get(path);
			const count = item ? item.count : 0;
			action.delete(path);
			clearTimeout(timeoutObject);
			if (item) clearTimeout(item.timeoutObject);
			return count;
		};
		timeoutObject = setTimeout(clear, timeout);
		const thr = {
			timeoutObject,
			clear,
			count: 0
		};
		action.set(path, thr);
		return thr;
	}
	_incrReadyCount() {
		return this._readyCount++;
	}
	/**
	* Awaits write operation to finish.
	* Polls a newly created file for size variations. When files size does not change for 'threshold' milliseconds calls callback.
	* @param path being acted upon
	* @param threshold Time in milliseconds a file size must be fixed before acknowledging write OP is finished
	* @param event
	* @param awfEmit Callback to be called when ready for event to be emitted.
	*/
	_awaitWriteFinish(path, threshold, event, awfEmit) {
		const awf = this.options.awaitWriteFinish;
		if (typeof awf !== "object") return;
		const pollInterval = awf.pollInterval;
		let timeoutHandler;
		let fullPath = path;
		if (this.options.cwd && !sp.isAbsolute(path)) fullPath = sp.join(this.options.cwd, path);
		const now = /* @__PURE__ */ new Date();
		const writes = this._pendingWrites;
		function awaitWriteFinishFn(prevStat) {
			stat(fullPath, (err, curStat) => {
				if (err || !writes.has(path)) {
					if (err && err.code !== "ENOENT") awfEmit(err);
					return;
				}
				const now = Number(/* @__PURE__ */ new Date());
				if (prevStat && curStat.size !== prevStat.size) writes.get(path).lastChange = now;
				if (now - writes.get(path).lastChange >= threshold) {
					writes.delete(path);
					awfEmit(void 0, curStat);
				} else timeoutHandler = setTimeout(awaitWriteFinishFn, pollInterval, curStat);
			});
		}
		if (!writes.has(path)) {
			writes.set(path, {
				lastChange: now,
				cancelWait: () => {
					writes.delete(path);
					clearTimeout(timeoutHandler);
					return event;
				}
			});
			timeoutHandler = setTimeout(awaitWriteFinishFn, pollInterval);
		}
	}
	/**
	* Determines whether user has asked to ignore this path.
	*/
	_isIgnored(path, stats) {
		if (this.options.atomic && DOT_RE.test(path)) return true;
		if (!this._userIgnored) {
			const { cwd } = this.options;
			const ignored = (this.options.ignored || []).map(normalizeIgnored(cwd));
			const list = [...[...this._ignoredPaths].map(normalizeIgnored(cwd)), ...ignored];
			this._userIgnored = anymatch(list, void 0);
		}
		return this._userIgnored(path, stats);
	}
	_isntIgnored(path, stat) {
		return !this._isIgnored(path, stat);
	}
	/**
	* Provides a set of common helpers and properties relating to symlink handling.
	* @param path file or directory pattern being watched
	*/
	_getWatchHelpers(path) {
		return new WatchHelper(path, this.options.followSymlinks, this);
	}
	/**
	* Provides directory tracking objects
	* @param directory path of the directory
	*/
	_getWatchedDir(directory) {
		const dir = sp.resolve(directory);
		if (!this._watched.has(dir)) this._watched.set(dir, new DirEntry(dir, this._boundRemove));
		return this._watched.get(dir);
	}
	/**
	* Check for read permissions: https://stackoverflow.com/a/11781404/1358405
	*/
	_hasReadPermissions(stats) {
		if (this.options.ignorePermissionErrors) return true;
		return Boolean(Number(stats.mode) & 256);
	}
	/**
	* Handles emitting unlink events for
	* files and directories, and via recursion, for
	* files and directories within directories that are unlinked
	* @param directory within which the following item is located
	* @param item      base path of item/directory
	*/
	_remove(directory, item, isDirectory) {
		const path = sp.join(directory, item);
		const fullPath = sp.resolve(path);
		isDirectory = isDirectory != null ? isDirectory : this._watched.has(path) || this._watched.has(fullPath);
		if (!this._throttle("remove", path, 100)) return;
		if (!isDirectory && this._watched.size === 1) this.add(directory, item, true);
		this._getWatchedDir(path).getChildren().forEach((nested) => this._remove(path, nested));
		const parent = this._getWatchedDir(directory);
		const wasTracked = parent.has(item);
		parent.remove(item);
		if (this._symlinkPaths.has(fullPath)) this._symlinkPaths.delete(fullPath);
		let relPath = path;
		if (this.options.cwd) relPath = sp.relative(this.options.cwd, path);
		if (this.options.awaitWriteFinish && this._pendingWrites.has(relPath)) {
			if (this._pendingWrites.get(relPath).cancelWait() === EVENTS.ADD) return;
		}
		this._watched.delete(path);
		this._watched.delete(fullPath);
		const eventName = isDirectory ? EVENTS.UNLINK_DIR : EVENTS.UNLINK;
		if (wasTracked && !this._isIgnored(path)) this._emit(eventName, path);
		this._closePath(path);
	}
	/**
	* Closes all watchers for a path
	*/
	_closePath(path) {
		this._closeFile(path);
		const dir = sp.dirname(path);
		this._getWatchedDir(dir).remove(sp.basename(path));
	}
	/**
	* Closes only file-specific watchers
	*/
	_closeFile(path) {
		const closers = this._closers.get(path);
		if (!closers) return;
		closers.forEach((closer) => closer());
		this._closers.delete(path);
	}
	_addPathCloser(path, closer) {
		if (!closer) return;
		let list = this._closers.get(path);
		if (!list) {
			list = [];
			this._closers.set(path, list);
		}
		list.push(closer);
	}
	_readdirp(root, opts) {
		if (this.closed) return;
		let stream = readdirp(root, {
			type: EVENTS.ALL,
			alwaysStat: true,
			lstat: true,
			...opts,
			depth: 0
		});
		this._streams.add(stream);
		stream.once(STR_CLOSE, () => {
			stream = void 0;
		});
		stream.once("end", () => {
			if (stream) {
				this._streams.delete(stream);
				stream = void 0;
			}
		});
		return stream;
	}
};
/**
* Instantiates watcher with paths to be tracked.
* @param paths file / directory paths
* @param options opts, such as `atomic`, `awaitWriteFinish`, `ignored`, and others
* @returns an instance of FSWatcher for chaining.
* @example
* const watcher = watch('.').on('all', (event, path) => { console.log(event, path); });
* watch('.', { atomic: true, awaitWriteFinish: true, ignored: (f, stats) => stats?.isFile() && !f.endsWith('.js') })
*/
function watch$1(paths, options = {}) {
	const watcher = new FSWatcher(options);
	watcher.add(paths);
	return watcher;
}
//#endregion
//#region electron/vault/vaultWatcher.ts
var watcher = null;
function parseFrontmatterValue(value) {
	const trimmed = value.trim();
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	return trimmed.replace(/^(['"])(.*)\1$/, "$2");
}
function parseMarkdown(content) {
	const normalized = content.replace(/^\uFEFF/, "");
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/.exec(normalized);
	if (!match) return null;
	const frontmatter = {};
	for (const line of match[1].split(/\r?\n/)) {
		if (!line.trim()) continue;
		const separator = line.indexOf(":");
		if (separator === -1) continue;
		const key = line.slice(0, separator).trim();
		if (!key) continue;
		frontmatter[key] = parseFrontmatterValue(line.slice(separator + 1));
	}
	return {
		frontmatter,
		body: match[2].replace(/^\r?\n/, "")
	};
}
function ticketForUuid(uuid) {
	return runSql("SELECT uuid, description, updated_at FROM tickets WHERE uuid = ? LIMIT 1", [uuid])[0] ?? null;
}
function syncMarkdownToSqlite(filename, uuidOverride, onSynced) {
	let stat;
	let content;
	try {
		stat = fs.statSync(filename);
		if (!stat.isFile()) return false;
		content = fs.readFileSync(filename, "utf8");
	} catch (err) {
		console.warn(`Vault watcher skipped unreadable file: ${filename}`, err);
		return false;
	}
	const parsed = parseMarkdown(content);
	if (!parsed) {
		console.warn(`Vault watcher skipped malformed markdown: ${filename}`);
		return false;
	}
	const uuid = uuidOverride ?? parsed.frontmatter.uuid;
	if (typeof uuid !== "string" || !uuid.trim()) {
		console.warn(`Vault watcher skipped markdown without uuid: ${filename}`);
		return false;
	}
	const description = parsed.body;
	if (!description.trim()) return false;
	const ticket = ticketForUuid(uuid);
	if (!ticket) {
		console.warn(`Vault watcher could not find ticket for uuid: ${uuid}`);
		return false;
	}
	if (stat.mtime.getTime() <= ticket.updated_at) return false;
	if (ticket.description === description) return false;
	runSql("UPDATE tickets SET description = ?, updated_at = ? WHERE uuid = ?", [
		description,
		stat.mtime.getTime(),
		uuid
	]);
	onSynced?.(uuid);
	return true;
}
function isMarkdownFile(filename) {
	return path.extname(filename).toLowerCase() === ".md";
}
function handleVaultFile(filename, onSynced) {
	if (!isMarkdownFile(filename)) return;
	syncMarkdownToSqlite(filename, void 0, onSynced);
}
function initVaultWatcher(vaultDir, onSynced) {
	stopVaultWatcher();
	watcher = watch$1(vaultDir, {
		ignoreInitial: true,
		awaitWriteFinish: {
			stabilityThreshold: 100,
			pollInterval: 25
		},
		ignored: (filename, stats) => {
			if (!stats?.isFile()) return false;
			return !isMarkdownFile(filename);
		}
	});
	watcher.on("add", (filename) => handleVaultFile(filename, onSynced));
	watcher.on("change", (filename) => handleVaultFile(filename, onSynced));
	watcher.on("error", (err) => {
		console.warn("Vault watcher error:", err);
	});
	return watcher;
}
async function stopVaultWatcher() {
	const active = watcher;
	watcher = null;
	if (active) await active.close();
}
//#endregion
//#region electron/ipc/generalAPI.ts
var TICKET_TABLE_RE$1 = /\b(tickets|ticket_history|ticket_relations|pending_sync)\b/i;
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
var DELETE_RE = /^\s*DELETE/i;
var DELETE_ALL_RE = /DELETE\s+FROM\s+tickets\s*$/i;
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
function snapshotTicket(uuid) {
	debounceTimers.delete(uuid);
	const description = currentDescription(uuid);
	if (description !== null) historyInsert(uuid, description);
}
/** Called after every ticket mutation — (re)arms the per-ticket debounce. */
function onTicketWritten(uuid) {
	if (!uuid) return;
	const existing = debounceTimers.get(uuid);
	if (existing) clearTimeout(existing);
	debounceTimers.set(uuid, setTimeout(() => snapshotTicket(uuid), HISTORY_DEBOUNCE_MS));
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
/**
* Runs a ticket-table SQL statement and keeps the side mirrors in sync
* (vault markdown + debounced history snapshot).
*
* This is the shared write path for both doors:
*   - the renderer's raw `db:ticket` channel (registerTicketAPI), and
*   - the governed bridge (which calls this directly, post-gate).
*
* Reaching this function means the caller is already trusted/authorized —
* it performs no auth itself.
*/
function runTicketSql(sql, params = []) {
	validateTicketSql(sql);
	if (DELETE_ALL_RE.test(sql)) vaultClear();
	else if (DELETE_RE.test(sql)) vaultDelete(params[0]);
	const result = runSql(sql, params);
	if (!SELECT_RE.test(sql) && !DELETE_RE.test(sql)) {
		const uuid = params[0];
		onTicketWritten(uuid);
		if (uuid) vaultWrite(uuid);
	}
	return result;
}
function registerTicketAPI() {
	ipcMain.handle("db:ticket", (_e, sql, params = []) => runTicketSql(sql, params));
}
//#endregion
//#region electron/ipc/historyAPI.ts
function registerHistoryAPI() {
	ipcMain.handle("db:history", (_e, ticketUuid) => {
		if (typeof ticketUuid !== "string") throw new Error("db:history expects a ticket UUID string.");
		return historyGet(ticketUuid);
	});
	/** Immediately snapshots a ticket, bypassing the debounce. Called on edit→view. */
	ipcMain.handle("db:history:flush", (_e, ticketUuid) => {
		if (typeof ticketUuid !== "string") throw new Error("db:history:flush expects a ticket UUID string.");
		snapshotTicket(ticketUuid);
	});
}
//#endregion
//#region electron/ipc/relationsAPI.ts
function assertString$1(v, name) {
	if (typeof v !== "string" || !v) throw new Error(`db:relation: ${name} must be a non-empty string.`);
	return v;
}
/**
* Executes a relations operation and returns its result.
*
* Shared dispatch for both doors: the renderer's raw `db:relation` channel
* (registerRelationsAPI) and the governed bridge (which calls this directly,
* post-gate). Reaching this function means the caller is already authorized —
* it performs no auth itself, only payload validation.
*/
function runRelationOp(op, payload) {
	if (typeof op !== "string") throw new Error("db:relation: op must be a string.");
	if (typeof payload !== "object" || payload === null) throw new Error("db:relation: payload must be an object.");
	if (op === "add") {
		const { type, node_a, node_b } = payload;
		assertString$1(type, "type");
		assertString$1(node_a, "node_a");
		assertString$1(node_b, "node_b");
		if (type !== "relates-to" && type !== "blocked-by") throw new Error(`db:relation: unknown type "${type}".`);
		if (node_a === node_b) throw new Error("db:relation: a ticket cannot relate to itself.");
		const [a, b] = type === "relates-to" && node_a > node_b ? [node_b, node_a] : [node_a, node_b];
		const uuid = randomUUID();
		runSql("INSERT INTO ticket_relations (uuid, node_a, node_b, type) VALUES (?, ?, ?, ?)", [
			uuid,
			a,
			b,
			type
		]);
		return {
			uuid,
			node_a: a,
			node_b: b,
			type
		};
	}
	if (op === "remove") {
		const { uuid } = payload;
		assertString$1(uuid, "uuid");
		runSql("DELETE FROM ticket_relations WHERE uuid = ?", [uuid]);
		return;
	}
	if (op === "list") {
		const { ticketUuid } = payload;
		assertString$1(ticketUuid, "ticketUuid");
		return runSql("SELECT uuid, node_a, node_b, type FROM ticket_relations WHERE node_a = ? OR node_b = ?", [ticketUuid, ticketUuid]);
	}
	if (op === "listAll") return runSql("SELECT uuid, node_a, node_b, type FROM ticket_relations", []);
	throw new Error(`db:relation: unknown op "${op}".`);
}
function registerRelationsAPI() {
	ipcMain.handle("db:relation", (_e, op, payload) => runRelationOp(op, payload));
}
//#endregion
//#region electron/ipc/graphAPI.ts
function assertString(v, name) {
	if (typeof v !== "string" || !v) throw new Error(`db:graph: ${name} must be a non-empty string.`);
	return v;
}
function assertNumber(v, name) {
	if (typeof v !== "number") throw new Error(`db:graph: ${name} must be a number.`);
	return v;
}
function registerGraphAPI() {
	ipcMain.handle("db:graph", (_e, op, payload) => {
		if (typeof op !== "string") throw new Error("db:graph: op must be a string.");
		if (typeof payload !== "object" || payload === null) throw new Error("db:graph: payload must be an object.");
		const p = payload;
		if (op === "view:list") return runSql("SELECT uuid, name, created_at FROM graph_views ORDER BY created_at ASC", []);
		if (op === "view:create") {
			const name = assertString(p.name, "name");
			const uuid = randomUUID();
			const created_at = Date.now();
			runSql("INSERT INTO graph_views (uuid, name, created_at) VALUES (?, ?, ?)", [
				uuid,
				name,
				created_at
			]);
			return {
				uuid,
				name,
				created_at
			};
		}
		if (op === "view:rename") {
			const uuid = assertString(p.uuid, "uuid");
			runSql("UPDATE graph_views SET name = ? WHERE uuid = ?", [assertString(p.name, "name"), uuid]);
			return;
		}
		if (op === "view:delete") {
			runSql("DELETE FROM graph_views WHERE uuid = ?", [assertString(p.uuid, "uuid")]);
			return;
		}
		if (op === "node:list") return runSql("SELECT ticket_uuid, x, y FROM graph_view_nodes WHERE view_uuid = ?", [assertString(p.viewUuid, "viewUuid")]);
		if (op === "node:upsert") {
			runSql(`INSERT INTO graph_view_nodes (view_uuid, ticket_uuid, x, y)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(view_uuid, ticket_uuid) DO UPDATE SET x = excluded.x, y = excluded.y`, [
				assertString(p.viewUuid, "viewUuid"),
				assertString(p.ticketUuid, "ticketUuid"),
				assertNumber(p.x, "x"),
				assertNumber(p.y, "y")
			]);
			return;
		}
		if (op === "node:remove") {
			runSql("DELETE FROM graph_view_nodes WHERE view_uuid = ? AND ticket_uuid = ?", [assertString(p.viewUuid, "viewUuid"), assertString(p.ticketUuid, "ticketUuid")]);
			return;
		}
		if (op === "edge:list") return runSql("SELECT uuid, source_uuid, target_uuid, source_handle, target_handle FROM graph_view_edges WHERE view_uuid = ?", [assertString(p.viewUuid, "viewUuid")]);
		if (op === "edge:create") {
			const viewUuid = assertString(p.viewUuid, "viewUuid");
			const sourceUuid = assertString(p.sourceUuid, "sourceUuid");
			const targetUuid = assertString(p.targetUuid, "targetUuid");
			const sourceHandle = typeof p.sourceHandle === "string" ? p.sourceHandle : null;
			const targetHandle = typeof p.targetHandle === "string" ? p.targetHandle : null;
			const uuid = randomUUID();
			runSql("INSERT INTO graph_view_edges (uuid, view_uuid, source_uuid, target_uuid, source_handle, target_handle) VALUES (?, ?, ?, ?, ?, ?)", [
				uuid,
				viewUuid,
				sourceUuid,
				targetUuid,
				sourceHandle,
				targetHandle
			]);
			return {
				uuid,
				source_uuid: sourceUuid,
				target_uuid: targetUuid,
				source_handle: sourceHandle,
				target_handle: targetHandle
			};
		}
		if (op === "edge:remove") {
			runSql("DELETE FROM graph_view_edges WHERE uuid = ?", [assertString(p.uuid, "uuid")]);
			return;
		}
		throw new Error(`db:graph: unknown op "${op}".`);
	});
}
//#endregion
//#region electron/main.ts
var __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
var VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
var RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
var win = null;
function notifyVaultTicketUpdated(uuid) {
	for (const window of BrowserWindow.getAllWindows()) window.webContents.send("vault:ticket-updated", uuid);
}
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
	const userData = app.getPath("userData");
	initSqlite(path.join(userData, "overhead.db"));
	initVault(path.join(userData, "vault"));
	initVaultWatcher(getVaultDir(), notifyVaultTicketUpdated);
	registerGeneralAPI();
	registerTicketAPI();
	registerHistoryAPI();
	registerRelationsAPI();
	registerGraphAPI();
	createWindow();
});
app.on("before-quit", () => {
	flushHistory();
	stopVaultWatcher();
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
	win = null;
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
//#endregion
