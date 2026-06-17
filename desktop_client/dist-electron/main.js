import { BrowserWindow, app, ipcMain } from "electron";
import * as sp from "node:path";
import path, { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs, { stat, unwatchFile, watch, watchFile, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { lstat, open, readdir, realpath, stat as stat$1 } from "node:fs/promises";
import { Readable } from "node:stream";
import { type } from "node:os";
import { createServer } from "node:http";
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
//#region electron/ipc/notify.ts
/**
* Sends `vault:ticket-updated` to all renderer windows.
*
* Called by the vault watcher (external file edits) and by the bridge
* (writes from external transports) so the renderer's TicketStore always
* stays in sync regardless of which path mutated the ticket.
*/
function notifyTicketUpdated(uuid) {
	for (const window of BrowserWindow.getAllWindows()) window.webContents.send("vault:ticket-updated", uuid);
}
/** Generates a token, writes it to `<userData>/bridge.token`, returns the token. */
function initToken(userData) {
	const token = randomBytes(32).toString("hex");
	writeFileSync(join(userData, "bridge.token"), token, {
		encoding: "utf8",
		mode: 384
	});
	return token;
}
//#endregion
//#region electron/bridge/gate.ts
/** Authorizes a method call. HTTP callers must supply a valid session token. */
function authorize(_method, ctx) {
	if (ctx.caller === "http") {}
}
//#endregion
//#region node_modules/zod/v4/core/core.js
var _a$1;
function $constructor(name, initializer, params) {
	function init(inst, def) {
		if (!inst._zod) Object.defineProperty(inst, "_zod", {
			value: {
				def,
				constr: _,
				traits: /* @__PURE__ */ new Set()
			},
			enumerable: false
		});
		if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		const proto = _.prototype;
		const keys = Object.keys(proto);
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		var _a;
		const inst = params?.Parent ? new Definition() : this;
		init(inst, def);
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		for (const fn of inst._zod.deferred) fn();
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}
//#endregion
//#region node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
function cached(getter) {
	return { get value() {
		{
			const value = getter();
			Object.defineProperty(this, "value", { value });
			return value;
		}
		throw new Error("cached value already set");
	} };
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object, key, getter) {
	let value = void 0;
	Object.defineProperty(object, key, {
		get() {
			if (value === EVALUATING) return;
			if (value === void 0) {
				value = EVALUATING;
				value = getter();
			}
			return value;
		},
		set(v) {
			Object.defineProperty(object, key, { value: v });
		},
		configurable: true
	});
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) Object.assign(mergedDescriptors, Object.getOwnPropertyDescriptors(def));
	return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject(o) {
	if (isObject(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
var propertyKeyTypes = /* @__PURE__ */ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
	});
}
Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -Number.MAX_VALUE, Number.MAX_VALUE;
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = {};
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				newShape[key] = currDef.shape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = { ...schema._zod.def.shape };
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				delete newShape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = schema._zod.def.shape;
		for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function safeExtend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function merge(a, b) {
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return clone(a, mergeDefs(a._zod.def, {
		get shape() {
			const _shape = {
				...a._zod.def.shape,
				...b._zod.def.shape
			};
			assignProp(this, "shape", _shape);
			return _shape;
		},
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask) {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const oldShape = schema._zod.def.shape;
			const shape = { ...oldShape };
			if (mask) for (const key in mask) {
				if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				shape[key] = Class ? new Class({
					type: "optional",
					innerType: oldShape[key]
				}) : oldShape[key];
			}
			else for (const key in oldShape) shape[key] = Class ? new Class({
				type: "optional",
				innerType: oldShape[key]
			}) : oldShape[key];
			assignProp(this, "shape", shape);
			return shape;
		},
		checks: []
	}));
}
function required(Class, schema, mask) {
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const oldShape = schema._zod.def.shape;
		const shape = { ...oldShape };
		if (mask) for (const key in mask) {
			if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
			if (!mask[key]) continue;
			shape[key] = new Class({
				type: "nonoptional",
				innerType: oldShape[key]
			});
		}
		else for (const key in oldShape) shape[key] = new Class({
			type: "nonoptional",
			innerType: oldShape[key]
		});
		assignProp(this, "shape", shape);
		return shape;
	} }));
}
function aborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage(message) {
	return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
	const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
	const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
	rest.path ?? (rest.path = []);
	rest.message = message;
	if (ctx?.reportInput) rest.input = _input;
	return rest;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}
//#endregion
//#region node_modules/zod/v4/core/errors.js
var initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	Object.defineProperty(inst, "_zod", {
		value: inst._zod,
		enumerable: false
	});
	Object.defineProperty(inst, "issues", {
		value: def,
		enumerable: false
	});
	inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
	Object.defineProperty(inst, "toString", {
		value: () => inst.message,
		enumerable: false
	});
};
var $ZodError = $constructor("$ZodError", initializer$1);
var $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) {
		fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
		fieldErrors[sub.path[0]].push(mapper(sub));
	} else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
					else {
						curr[el] = curr[el] || { _errors: [] };
						curr[el]._errors.push(mapper(issue));
					}
					curr = curr[el];
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
//#endregion
//#region node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	if (result.issues.length) {
		const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, _params?.callee);
		throw e;
	}
	return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	if (result.issues.length) {
		const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, params?.callee);
		throw e;
	}
	return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? {
		success: false,
		error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
var safeParse$1 = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? {
		success: false,
		error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
var safeParseAsync$1 = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parse(_Err)(schema, value, ctx);
};
var _decode = (_Err) => (schema, value, _ctx) => {
	return _parse(_Err)(schema, value, _ctx);
};
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parseAsync(_Err)(schema, value, ctx);
};
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _parseAsync(_Err)(schema, value, _ctx);
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};
//#endregion
//#region node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
var duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
var uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date$1 = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time$1(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
	const time = timeSource({ precision: args.precision });
	const opts = ["Z"];
	if (args.local) opts.push("");
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const timeRegex = `${time}(?:${opts.join("|")})`;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string$1 = (params) => {
	const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
	return new RegExp(`^${regex}$`);
};
var boolean$1 = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;
//#endregion
//#region node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
		if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
		if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.minimum = def.length;
		bag.maximum = def.length;
		bag.length = def.length;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		const length = input.length;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		if (def.pattern) {
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(def.pattern);
		}
	});
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
	def.pattern = pattern;
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});
//#endregion
//#region node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = []) {
		this.content = [];
		this.indent = 0;
		if (this) this.args = args;
	}
	indented(fn) {
		this.indent += 1;
		fn(this);
		this.indent -= 1;
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const args = this?.args;
		const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
		return new F(...args, lines.join("\n"));
	}
};
//#endregion
//#region node_modules/zod/v4/core/versions.js
var version = {
	major: 4,
	minor: 4,
	patch: 3
};
//#endregion
//#region node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version;
	const checks = [...inst._zod.def.checks ?? []];
	if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			let isAborted = aborted(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					if (!isAborted) isAborted = aborted(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					if (!isAborted) isAborted = aborted(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
	defineLazy(inst, "~standard", () => ({
		validate: (value) => {
			try {
				const r = safeParse$1(inst, value);
				return r.success ? { value: r.data } : { issues: r.error?.issues };
			} catch (_) {
				return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email);
	$ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			if (!def.normalize && def.protocol?.source === httpProtocol.source) {
				if (!/^https?:\/\//i.test(trimmed)) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid URL format",
						input: payload.value,
						inst,
						continue: !def.abort
					});
					return;
				}
			}
			const url = new URL(trimmed);
			if (def.hostname) {
				def.hostname.lastIndex = 0;
				if (!def.hostname.test(url.hostname)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid hostname",
					pattern: def.hostname.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.protocol) {
				def.protocol.lastIndex = 0;
				if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid protocol",
					pattern: def.protocol.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.normalize) payload.value = url.href;
			else payload.value = trimmed;
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
	def.pattern ?? (def.pattern = nanoid);
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime$1(def));
	$ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date$1);
	$ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time$1(def));
	$ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration$1);
	$ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv6`;
	inst._zod.check = (payload) => {
		try {
			new URL(`http://[${payload.value}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		const parts = payload.value.split("/");
		try {
			if (parts.length !== 2) throw new Error();
			const [address, prefix] = parts;
			if (!prefix) throw new Error();
			const prefixNum = Number(prefix);
			if (`${prefixNum}` !== prefix) throw new Error();
			if (prefixNum < 0 || prefixNum > 128) throw new Error();
			new URL(`http://[${address}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64";
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64URL(data) {
	if (!base64url.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64url);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64url";
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = boolean$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Boolean(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "boolean") return payload;
		payload.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = Array(input.length);
		const proms = [];
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else handleArrayResult(result, payload, i);
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
	const isPresent = key in input;
	if (result.issues.length) {
		if (isOptionalIn && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && !isOptionalIn) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		keys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const isOptionalIn = _catchall.optin === "optional";
	const isOptionalOut = _catchall.optout === "optional";
	for (const key in input) {
		if (key === "__proto__") continue;
		if (keySet.has(key)) continue;
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
		else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
		const sh = def.shape;
		Object.defineProperty(def, "shape", { get: () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			return newSh;
		} });
	}
	const _normalized = cached(() => normalizeDef(def));
	defineLazy(inst._zod, "propValues", () => {
		const shape = def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
			}
		}
		return propValues;
	});
	const isObject$1 = isObject;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$1(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = {};
		const proms = [];
		const shape = value.shape;
		for (const key of value.keys) {
			const el = shape[key];
			const isOptionalIn = el._zod.optin === "optional";
			const isOptionalOut = el._zod.optout === "optional";
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
			else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
	};
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached(() => normalizeDef(def));
	const generateFastpass = (shape) => {
		const doc = new Doc([
			"shape",
			"payload",
			"ctx"
		]);
		const normalized = _normalized.value;
		const parseStr = (key) => {
			const k = esc(key);
			return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		};
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.keys) ids[key] = `key_${counter++}`;
		doc.write(`const newResult = {};`);
		for (const key of normalized.keys) {
			const id = ids[key];
			const k = esc(key);
			const schema = shape[key];
			const isOptionalIn = schema?._zod?.optin === "optional";
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(key)};`);
			if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
			else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		const fn = doc.compile();
		return (payload, ctx) => fn(shape, payload, ctx);
	};
	let fastpass;
	const isObject$2 = isObject;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$2(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "values", () => {
		if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazy(inst._zod, "pattern", () => {
		if (def.options.every((o) => o._zod.pattern)) {
			const patterns = def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject(a) && isPlainObject(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		for (const key of sharedKeys) {
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
		unrecIssue ?? (unrecIssue = iss);
		for (const k of iss.keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k).l = true;
		}
	} else result.issues.push(iss);
	for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
		if (!unrecKeys.has(k)) unrecKeys.set(k, {});
		unrecKeys.get(k).r = true;
	}
	else result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length && unrecIssue) result.issues.push({
		...unrecIssue,
		keys: bothKeys
	});
	if (aborted(result)) return result;
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	result.value = merged.data;
	return result;
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		payload.fallback = true;
		return payload;
	};
});
function handleOptionalResult(result, input) {
	if (input === void 0 && (result.issues.length || result.fallback)) return {
		issues: [],
		value: void 0
	};
	return result;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.optout = "optional";
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? new Set([...def.innerType._zod.values, void 0]) : void 0;
	});
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (def.innerType._zod.optin === "optional") {
			const input = payload.value;
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
			return handleOptionalResult(result, input);
		}
		if (payload.value === void 0) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => {
		const v = def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => {
			payload.value = result.value;
			if (result.issues.length) {
				payload.value = def.catchValue({
					...payload,
					error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
					input: payload.value
				});
				payload.issues = [];
				payload.fallback = true;
			}
			return payload;
		});
		payload.value = result.value;
		if (result.issues.length) {
			payload.value = def.catchValue({
				...payload,
				error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
				input: payload.value
			});
			payload.issues = [];
			payload.fallback = true;
		}
		return payload;
	};
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => def.in._zod.values);
	defineLazy(inst._zod, "optin", () => def.in._zod.optin);
	defineLazy(inst._zod, "optout", () => def.out._zod.optout);
	defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.length) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues,
		fallback: left.fallback
	}, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
	defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	payload.value = Object.freeze(payload.value);
	return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}
//#endregion
//#region node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
//#endregion
//#region node_modules/zod/v4/core/api.js
/* @__NO_SIDE_EFFECTS__ */
function _string(Class, params) {
	return new Class({
		type: "string",
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
/* @__NO_SIDE_EFFECTS__ */
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _boolean(Class, params) {
	return new Class({
		type: "boolean",
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
/* @__NO_SIDE_EFFECTS__ */
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
/* @__NO_SIDE_EFFECTS__ */
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
/* @__NO_SIDE_EFFECTS__ */
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
/* @__NO_SIDE_EFFECTS__ */
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
/* @__NO_SIDE_EFFECTS__ */
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
/* @__NO_SIDE_EFFECTS__ */
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
/* @__NO_SIDE_EFFECTS__ */
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}
//#endregion
//#region node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		external: params?.external ?? void 0
	};
}
function process$1(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			process$1(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) Object.assign(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
			};
		}
		if (entry[1] === root) return { ref: "#" };
		const defUriPrefix = `#/${defsSegment}/`;
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + defId
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") {
				extractToDef(entry);
				continue;
			}
		}
	}
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else Object.assign(schema, refSchema);
			Object.assign(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	Object.assign(result, root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			defs[seen.defId] = seen.def;
		}
	}
	if (ctx.external) {} else if (Object.keys(defs).length > 0) if (ctx.target === "draft-2020-12") result.$defs = defs;
	else result.definitions = defs;
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	process$1(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	process$1(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
//#endregion
//#region node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
var stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time") delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const regexes = [...patterns];
		if (regexes.length === 1) json.pattern = regexes[0].source;
		else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
	json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
var enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
var customProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = schema._zod.bag;
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = process$1(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
var objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	json.properties = {};
	const shape = def.shape;
	for (const key in shape) json.properties[key] = process$1(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	});
	const allKeys = new Set(Object.keys(shape));
	const requiredKeys = new Set([...allKeys].filter((key) => {
		const v = def.shape[key]._zod;
		if (ctx.io === "input") return v.optin === void 0;
		else return v.optout === void 0;
	}));
	if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = process$1(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
var unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => process$1(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
var intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = process$1(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = process$1(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
};
var nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		throw new Error("Dynamic catch values are not supported in JSON Schema");
	}
	json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	process$1(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
//#endregion
//#region node_modules/zod/v4/classic/iso.js
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function datetime(params) {
	return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function date(params) {
	return /* @__PURE__ */ _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function time(params) {
	return /* @__PURE__ */ _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function duration(params) {
	return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
}
//#endregion
//#region node_modules/zod/v4/classic/errors.js
var initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	Object.defineProperties(inst, {
		format: { value: (mapper) => formatError(inst, mapper) },
		flatten: { value: (mapper) => flattenError(inst, mapper) },
		addIssue: { value: (issue) => {
			inst.issues.push(issue);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		addIssues: { value: (issues) => {
			inst.issues.push(...issues);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		isEmpty: { get() {
			return inst.issues.length === 0;
		} }
	});
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer, { Parent: Error });
//#endregion
//#region node_modules/zod/v4/classic/parse.js
var parse = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
//#endregion
//#region node_modules/zod/v4/classic/schemas.js
var _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
	const proto = Object.getPrototypeOf(inst);
	let installed = _installedGroups.get(proto);
	if (!installed) {
		installed = /* @__PURE__ */ new Set();
		_installedGroups.set(proto, installed);
	}
	if (installed.has(group)) return;
	installed.add(group);
	for (const key in methods) {
		const fn = methods[key];
		Object.defineProperty(proto, key, {
			configurable: true,
			enumerable: false,
			get() {
				const bound = fn.bind(this);
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: bound
				});
				return bound;
			},
			set(v) {
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: v
				});
			}
		});
	}
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
	$ZodType.init(inst, def);
	Object.assign(inst["~standard"], { jsonSchema: {
		input: createStandardJSONSchemaMethod(inst, "input"),
		output: createStandardJSONSchemaMethod(inst, "output")
	} });
	inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
	inst.def = def;
	inst.type = def.type;
	Object.defineProperty(inst, "_def", { value: def });
	inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
	inst.safeParse = (data, params) => safeParse(inst, data, params);
	inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
	inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
	inst.spa = inst.safeParseAsync;
	inst.encode = (data, params) => encode(inst, data, params);
	inst.decode = (data, params) => decode(inst, data, params);
	inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
	inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
	inst.safeEncode = (data, params) => safeEncode(inst, data, params);
	inst.safeDecode = (data, params) => safeDecode(inst, data, params);
	inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
	inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
	_installLazyMethods(inst, "ZodType", {
		check(...chks) {
			const def = this.def;
			return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
				check: ch,
				def: { check: "custom" },
				onattach: []
			} } : ch)] }), { parent: true });
		},
		with(...chks) {
			return this.check(...chks);
		},
		clone(def, params) {
			return clone(this, def, params);
		},
		brand() {
			return this;
		},
		register(reg, meta) {
			reg.add(this, meta);
			return this;
		},
		refine(check, params) {
			return this.check(refine(check, params));
		},
		superRefine(refinement, params) {
			return this.check(superRefine(refinement, params));
		},
		overwrite(fn) {
			return this.check(/* @__PURE__ */ _overwrite(fn));
		},
		optional() {
			return optional(this);
		},
		exactOptional() {
			return exactOptional(this);
		},
		nullable() {
			return nullable(this);
		},
		nullish() {
			return optional(nullable(this));
		},
		nonoptional(params) {
			return nonoptional(this, params);
		},
		array() {
			return array(this);
		},
		or(arg) {
			return union([this, arg]);
		},
		and(arg) {
			return intersection(this, arg);
		},
		transform(tx) {
			return pipe(this, transform(tx));
		},
		default(d) {
			return _default(this, d);
		},
		prefault(d) {
			return prefault(this, d);
		},
		catch(params) {
			return _catch(this, params);
		},
		pipe(target) {
			return pipe(this, target);
		},
		readonly() {
			return readonly(this);
		},
		describe(description) {
			const cl = this.clone();
			globalRegistry.add(cl, { description });
			return cl;
		},
		meta(...args) {
			if (args.length === 0) return globalRegistry.get(this);
			const cl = this.clone();
			globalRegistry.add(cl, args[0]);
			return cl;
		},
		isOptional() {
			return this.safeParse(void 0).success;
		},
		isNullable() {
			return this.safeParse(null).success;
		},
		apply(fn) {
			return fn(this);
		}
	});
	Object.defineProperty(inst, "description", {
		get() {
			return globalRegistry.get(inst)?.description;
		},
		configurable: true
	});
	return inst;
});
/** @internal */
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
	const bag = inst._zod.bag;
	inst.format = bag.format ?? null;
	inst.minLength = bag.minimum ?? null;
	inst.maxLength = bag.maximum ?? null;
	_installLazyMethods(inst, "_ZodString", {
		regex(...args) {
			return this.check(/* @__PURE__ */ _regex(...args));
		},
		includes(...args) {
			return this.check(/* @__PURE__ */ _includes(...args));
		},
		startsWith(...args) {
			return this.check(/* @__PURE__ */ _startsWith(...args));
		},
		endsWith(...args) {
			return this.check(/* @__PURE__ */ _endsWith(...args));
		},
		min(...args) {
			return this.check(/* @__PURE__ */ _minLength(...args));
		},
		max(...args) {
			return this.check(/* @__PURE__ */ _maxLength(...args));
		},
		length(...args) {
			return this.check(/* @__PURE__ */ _length(...args));
		},
		nonempty(...args) {
			return this.check(/* @__PURE__ */ _minLength(1, ...args));
		},
		lowercase(params) {
			return this.check(/* @__PURE__ */ _lowercase(params));
		},
		uppercase(params) {
			return this.check(/* @__PURE__ */ _uppercase(params));
		},
		trim() {
			return this.check(/* @__PURE__ */ _trim());
		},
		normalize(...args) {
			return this.check(/* @__PURE__ */ _normalize(...args));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ _toLowerCase());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ _toUpperCase());
		},
		slugify() {
			return this.check(/* @__PURE__ */ _slugify());
		}
	});
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
	inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
	inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
	inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
	inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
	inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
	inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
	inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
	inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
	inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
	inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
	inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
	inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
	inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
	inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
	inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
	inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
	inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
	inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
	inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
	inst.datetime = (params) => inst.check(datetime(params));
	inst.date = (params) => inst.check(date(params));
	inst.time = (params) => inst.check(time(params));
	inst.duration = (params) => inst.check(duration(params));
});
function string(params) {
	return /* @__PURE__ */ _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
	$ZodBoolean.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean(params) {
	return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
	return /* @__PURE__ */ _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return /* @__PURE__ */ _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
	_installLazyMethods(inst, "ZodArray", {
		min(n, params) {
			return this.check(/* @__PURE__ */ _minLength(n, params));
		},
		nonempty(params) {
			return this.check(/* @__PURE__ */ _minLength(1, params));
		},
		max(n, params) {
			return this.check(/* @__PURE__ */ _maxLength(n, params));
		},
		length(n, params) {
			return this.check(/* @__PURE__ */ _length(n, params));
		},
		unwrap() {
			return this.element;
		}
	});
});
function array(element, params) {
	return /* @__PURE__ */ _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	defineLazy(inst, "shape", () => {
		return def.shape;
	});
	_installLazyMethods(inst, "ZodObject", {
		keyof() {
			return _enum(Object.keys(this._zod.def.shape));
		},
		catchall(catchall) {
			return this.clone({
				...this._zod.def,
				catchall
			});
		},
		passthrough() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: never()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(incoming) {
			return extend(this, incoming);
		},
		safeExtend(incoming) {
			return safeExtend(this, incoming);
		},
		merge(other) {
			return merge(this, other);
		},
		pick(mask) {
			return pick(this, mask);
		},
		omit(mask) {
			return omit(this, mask);
		},
		partial(...args) {
			return partial(ZodOptional, this, args[0]);
		},
		required(...args) {
			return required(ZodNonOptional, this, args[0]);
		}
	});
});
function object(shape, params) {
	return new ZodObject({
		type: "object",
		shape: shape ?? {},
		...normalizeParams(params)
	});
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = Object.values(def.entries);
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	return new ZodEnum({
		type: "enum",
		entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
		...normalizeParams(params)
	});
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		payload.value = output;
		payload.fallback = true;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
	});
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return /* @__PURE__ */ _superRefine(fn, params);
}
//#endregion
//#region electron/bridge/tickets.ts
/**
* Governed ticket methods for the bridge (Door 2).
*
* Callers pass plain data — never SQL. Each method validates its input with Zod,
* then routes writes through `runTicketSql` so vault mirroring and history
* snapshots stay identical to the renderer's raw path. IDs, uuids and initial
* status are minted here, server-side, mirroring the renderer's Ticket factories.
*/
var ticketTypeSchema = _enum([
	"Explore",
	"Feature",
	"Execute"
]);
/** Initial status seeded per type — mirrors the subclass create() factories. */
var INITIAL_STATUS = {
	Execute: "Draft",
	Explore: "Open",
	Feature: "Idea"
};
var UPSERT_SQL = `
  INSERT INTO tickets (uuid, id, title, type, status, backlog, description, archived, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(uuid) DO UPDATE SET
    id          = excluded.id,
    title       = excluded.title,
    type        = excluded.type,
    status      = excluded.status,
    backlog     = excluded.backlog,
    description = excluded.description,
    archived    = excluded.archived,
    updated_at  = excluded.updated_at
`;
var COUNTER_KEY = "counter";
var ID_PREFIX = "OVH";
/** Mints the next human-readable id (OVH-001), mirroring the renderer Counter. */
function nextId() {
	const rows = runSql("SELECT value FROM settings WHERE key = ?", [COUNTER_KEY]);
	const next = (rows?.[0]?.value ? parseInt(rows[0].value, 10) : 0) + 1;
	runSql("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [COUNTER_KEY, String(next)]);
	return `${ID_PREFIX}-${String(next).padStart(3, "0")}`;
}
function rowToTicket(row) {
	return {
		...row,
		backlog: row.backlog === 1,
		archived: row.archived === 1
	};
}
function readRow(uuid) {
	return runTicketSql("SELECT * FROM tickets WHERE uuid = ? LIMIT 1", [uuid])[0] ?? null;
}
/**
* Writes a full ticket row via the shared write path. params[0] is the uuid, so
* the vault mirror + history snapshot in runTicketSql target the right ticket.
*/
function writeTicket(t) {
	runTicketSql(UPSERT_SQL, [
		t.uuid,
		t.id,
		t.title,
		t.type,
		t.status,
		t.backlog ? 1 : 0,
		t.description,
		t.archived ? 1 : 0,
		t.created_at,
		t.updated_at
	]);
	notifyTicketUpdated(t.uuid);
}
var createSchema = object({
	title: string().min(1),
	type: ticketTypeSchema,
	status: string().min(1).optional(),
	description: string().default(""),
	backlog: boolean().default(false)
});
var updateSchema = object({
	uuid: string().min(1),
	patch: object({
		title: string().min(1).optional(),
		status: string().min(1).optional(),
		description: string().optional(),
		backlog: boolean().optional(),
		archived: boolean().optional()
	})
});
var uuidSchema$1 = object({ uuid: string().min(1) });
function createTicket(input) {
	const data = createSchema.parse(input);
	const now = Date.now();
	const ticket = {
		uuid: randomUUID(),
		id: nextId(),
		title: data.title,
		type: data.type,
		status: data.status ?? INITIAL_STATUS[data.type],
		backlog: data.backlog,
		description: data.description,
		archived: false,
		created_at: now,
		updated_at: now
	};
	writeTicket(ticket);
	return ticket;
}
function getTicket(input) {
	const { uuid } = uuidSchema$1.parse(input);
	const row = readRow(uuid);
	return row ? rowToTicket(row) : null;
}
function listTickets() {
	return runTicketSql("SELECT * FROM tickets ORDER BY created_at ASC", []).map(rowToTicket);
}
/** Read-modify-write upsert so side effects (vault/history) target by uuid. */
function updateTicket(input) {
	const { uuid, patch } = updateSchema.parse(input);
	const row = readRow(uuid);
	if (!row) throw new Error(`bridge: ticket "${uuid}" not found.`);
	const updated = {
		...rowToTicket(row),
		...patch,
		updated_at: Date.now()
	};
	writeTicket(updated);
	return updated;
}
function deleteTicket(input) {
	const { uuid } = uuidSchema$1.parse(input);
	runTicketSql("DELETE FROM tickets WHERE uuid = ?", [uuid]);
	notifyTicketUpdated(uuid);
	return { uuid };
}
//#endregion
//#region electron/bridge/relations.ts
/**
* Governed relation methods for the bridge (Door 2).
*
* Thin, validated wrappers over `runRelationOp` — they expose intent-named
* operations (relate / blockBy / unrelate / listRelations) instead of the raw
* op+payload protocol, and never let the caller pick a relation type freely.
*/
var pairSchema = object({
	a: string().min(1),
	b: string().min(1)
});
var blockSchema = object({
	blocked: string().min(1),
	blocker: string().min(1)
});
var uuidSchema = object({ uuid: string().min(1) });
var ticketUuidSchema = object({ ticketUuid: string().min(1) });
/** Symmetric link between two tickets. Order doesn't matter (canonicalized downstream). */
function relate(input) {
	const { a, b } = pairSchema.parse(input);
	return runRelationOp("add", {
		type: "relates-to",
		node_a: a,
		node_b: b
	});
}
/** Marks `blocked` as blocked by `blocker`. */
function blockBy(input) {
	const { blocked, blocker } = blockSchema.parse(input);
	return runRelationOp("add", {
		type: "blocked-by",
		node_a: blocked,
		node_b: blocker
	});
}
/** Removes a relation by its uuid. */
function unrelate(input) {
	const { uuid } = uuidSchema.parse(input);
	return runRelationOp("remove", { uuid });
}
/** Lists every relation touching a ticket. */
function listRelations(input) {
	const { ticketUuid } = ticketUuidSchema.parse(input);
	return runRelationOp("list", { ticketUuid });
}
//#endregion
//#region electron/bridge/index.ts
/**
* The governed bridge (Door 2).
*
* `dispatchBridge(method, args)` is the single entry point for all external
* transports — HTTP, unix socket, MCP, CLI. No raw SQL crosses this boundary:
* callers name a method and pass data; the gate handles auth/throttle; each
* method validates its own input with Zod.
*
* There is no IPC channel here — the bridge does not touch the renderer.
* The renderer has Door 1 (window.db / raw SQL). External processes reach the
* bridge via whatever transport is stood up on top of dispatchBridge.
*/
/** The complete public method surface exposed to external callers. */
var methods = {
	createTicket,
	getTicket,
	listTickets,
	updateTicket,
	deleteTicket,
	relate,
	blockBy,
	unrelate,
	listRelations
};
/**
* Runs a bridge method through the gate. Single entry point for every caller
* and transport. Each method validates its own input.
*/
function dispatchBridge(method, args, ctx = {}) {
	const fn = methods[method];
	if (!fn) throw new Error(`bridge: unknown method "${method}".`);
	authorize(method, ctx);
	return fn(args);
}
//#endregion
//#region electron/servers/http.ts
/**
* Local HTTP server — the first external transport for the governed bridge.
*
* Binds to 127.0.0.1 only (never 0.0.0.0).
* Every request must carry `Authorization: Bearer <token>` matching the
* session token written to `userData/bridge.token` at startup.
*
* Protocol:
*   POST /invoke
*   Content-Type: application/json
*   Authorization: Bearer <token>
*   Body: { "method": "createTicket", "args": { ... } }
*
*   200 { "result": ... }
*   400 { "error": "..." }   — bad request / method error
*   401 { "error": "Unauthorized" }
*/
var PORT = 49152;
var server = null;
function json(body) {
	return JSON.stringify(body);
}
function startHttpServer() {
	server = createServer((req, res) => {
		res.setHeader("Content-Type", "application/json");
		if (req.method !== "POST" || req.url !== "/invoke") {
			res.writeHead(404).end(json({ error: "Not found. Use POST /invoke." }));
			return;
		}
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			try {
				const body = JSON.parse(Buffer.concat(chunks).toString());
				const result = dispatchBridge(body.method, body.args ?? null);
				res.writeHead(200).end(json({ result }));
			} catch (err) {
				res.writeHead(400).end(json({ error: err.message }));
			}
		});
	});
	server.on("error", (err) => {
		if (err.code === "EADDRINUSE") console.warn(`[bridge] port ${PORT} already in use — another instance is running. HTTP transport disabled for this process.`);
		else console.error("[bridge] HTTP server error:", err);
		server = null;
	});
	server.listen(PORT, "127.0.0.1", () => {
		console.log(`[bridge] HTTP server listening on 127.0.0.1:${PORT}`);
	});
}
function stopHttpServer() {
	server?.close();
	server = null;
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
	const userData = app.getPath("userData");
	initSqlite(path.join(userData, "overhead.db"));
	initVault(path.join(userData, "vault"));
	initVaultWatcher(getVaultDir(), notifyTicketUpdated);
	registerGeneralAPI();
	registerTicketAPI();
	registerHistoryAPI();
	registerRelationsAPI();
	registerGraphAPI();
	initToken(userData);
	startHttpServer();
	createWindow();
});
app.on("before-quit", () => {
	flushHistory();
	stopHttpServer();
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
