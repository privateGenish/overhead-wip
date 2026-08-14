import { BrowserWindow as e, app as t, ipcMain as n, screen as r } from "electron";
import * as i from "node:path";
import a, { join as o, relative as s, resolve as c, sep as l } from "node:path";
import { fileURLToPath as u } from "node:url";
import { DatabaseSync as d } from "node:sqlite";
import { createHash as f, randomBytes as p, randomUUID as m } from "node:crypto";
import h, { existsSync as ee, stat as te, unlinkSync as ne, unwatchFile as re, watch as ie, watchFile as ae, writeFileSync as oe } from "node:fs";
import { EventEmitter as se } from "node:events";
import { lstat as ce, open as le, readdir as ue, realpath as de, stat as fe } from "node:fs/promises";
import { Readable as pe } from "node:stream";
import { type as me } from "node:os";
import { createServer as he } from "node:http";
import { createServer as ge } from "node:net";
//#region electron/db/globalDb.ts
var _e = "activeProject", g = null;
function ve(e) {
	g || (g = new d(e), g.exec("PRAGMA foreign_keys = ON"), g.exec("\n    -- Names and prefixes are unique at the schema level, not just in the UI:\n    -- duplicate names make projects ambiguous, duplicate prefixes make\n    -- @OVH-123 mentions ambiguous across vaults.\n    CREATE TABLE IF NOT EXISTS projects (\n      uuid       TEXT PRIMARY KEY,\n      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,\n      prefix     TEXT NOT NULL UNIQUE COLLATE NOCASE,\n      created_at INTEGER NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS app_settings (\n      key   TEXT PRIMARY KEY,\n      value TEXT NOT NULL\n    );\n  "));
}
function _() {
	if (!g) throw Error("Global database not initialised — call initGlobalDb() first.");
	return g;
}
function ye() {
	g?.close(), g = null;
}
function be() {
	return _().prepare("SELECT uuid, name, prefix, created_at FROM projects ORDER BY created_at ASC").all();
}
function xe(e) {
	return _().prepare("SELECT uuid, name, prefix, created_at FROM projects WHERE uuid = ?").get(e) ?? null;
}
function Se(e, t) {
	let n = e.trim(), r = t.trim().toUpperCase();
	if (!n) throw Error("Project name cannot be empty.");
	if (!r) throw Error("Project prefix cannot be empty.");
	let i = {
		uuid: m(),
		name: n,
		prefix: r,
		created_at: Date.now()
	};
	try {
		_().prepare("INSERT INTO projects (uuid, name, prefix, created_at) VALUES (?, ?, ?, ?)").run(i.uuid, i.name, i.prefix, i.created_at);
	} catch (e) {
		throw String(e).includes("UNIQUE") ? Error(`A project named "${n}" or using prefix "${r}" already exists.`) : e;
	}
	return i;
}
function Ce(e, t) {
	let n = t.trim();
	if (!n) throw Error("Project name cannot be empty.");
	if (!xe(e)) throw Error(`Project "${e}" not found.`);
	try {
		_().prepare("UPDATE projects SET name = ? WHERE uuid = ?").run(n, e);
	} catch (e) {
		throw String(e).includes("UNIQUE") ? Error(`A project named "${n}" already exists.`) : e;
	}
	return xe(e);
}
function we(e) {
	_().prepare("DELETE FROM projects WHERE uuid = ?").run(e), Oe() === e && Ae();
}
function Te(e) {
	return _().prepare("SELECT value FROM app_settings WHERE key = ?").get(e)?.value ?? null;
}
function Ee(e, t) {
	_().prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(e, t);
}
function De(e) {
	_().prepare("DELETE FROM app_settings WHERE key = ?").run(e);
}
function Oe() {
	return Te(_e);
}
function ke(e) {
	Ee(_e, e);
}
function Ae() {
	De(_e);
}
//#endregion
//#region electron/db/sqlite.ts
var v = null;
function je(e) {
	v || (v = new d(e), v.exec("PRAGMA foreign_keys = ON"), v.exec("\n    CREATE TABLE IF NOT EXISTS tickets (\n      uuid        TEXT PRIMARY KEY,\n      id          TEXT NOT NULL,\n      title       TEXT NOT NULL,\n      type        TEXT NOT NULL CHECK(type IN ('Explore', 'Feature', 'Execute')),\n      status      TEXT NOT NULL,\n      backlog     INTEGER NOT NULL DEFAULT 0,\n      pinned      INTEGER NOT NULL DEFAULT 0,\n      description TEXT NOT NULL DEFAULT '',\n      archived    INTEGER NOT NULL DEFAULT 0,\n      created_at  INTEGER NOT NULL,\n      updated_at  INTEGER NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS settings (\n      key   TEXT PRIMARY KEY,\n      value TEXT NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS ticket_history (\n      ticket_uuid  TEXT    NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,\n      ts           INTEGER NOT NULL,\n      description  TEXT    NOT NULL,\n      hash         TEXT    NOT NULL,\n      PRIMARY KEY (ticket_uuid, ts)\n    );\n\n    CREATE TABLE IF NOT EXISTS ticket_relations (\n      uuid   TEXT NOT NULL UNIQUE,\n      node_a TEXT NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,\n      node_b TEXT NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,\n      type   TEXT NOT NULL CHECK(type IN ('relates-to', 'blocked-by')),\n      PRIMARY KEY (node_a, node_b, type),\n      CHECK (type != 'relates-to' OR node_a < node_b)\n    );\n\n    CREATE TABLE IF NOT EXISTS graph_views (\n      uuid       TEXT PRIMARY KEY,\n      name       TEXT NOT NULL,\n      created_at INTEGER NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS graph_view_nodes (\n      view_uuid   TEXT NOT NULL REFERENCES graph_views(uuid) ON DELETE CASCADE,\n      ticket_uuid TEXT NOT NULL REFERENCES tickets(uuid)     ON DELETE CASCADE,\n      x           REAL NOT NULL DEFAULT 0,\n      y           REAL NOT NULL DEFAULT 0,\n      PRIMARY KEY (view_uuid, ticket_uuid)\n    );\n\n    CREATE TABLE IF NOT EXISTS graph_view_edges (\n      uuid          TEXT PRIMARY KEY,\n      view_uuid     TEXT NOT NULL REFERENCES graph_views(uuid) ON DELETE CASCADE,\n      source_uuid   TEXT NOT NULL REFERENCES tickets(uuid)     ON DELETE CASCADE,\n      target_uuid   TEXT NOT NULL REFERENCES tickets(uuid)     ON DELETE CASCADE,\n      source_handle TEXT,\n      target_handle TEXT\n    );\n\n    CREATE TABLE IF NOT EXISTS notes (\n      uuid       TEXT PRIMARY KEY,\n      title      TEXT NOT NULL,\n      body       TEXT NOT NULL DEFAULT '',\n      created_at INTEGER NOT NULL,\n      updated_at INTEGER NOT NULL\n    );\n\n    -- Backlinks extracted from markdown (@OVH-123). A projection of document\n    -- content, never a source of truth: rebuilding it by re-parsing every\n    -- ticket and note must always be safe.\n    CREATE TABLE IF NOT EXISTS mentions (\n      source_type TEXT NOT NULL CHECK(source_type IN ('ticket', 'note')),\n      source_uuid TEXT NOT NULL,\n      target_uuid TEXT NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,\n      PRIMARY KEY (source_type, source_uuid, target_uuid)\n    );\n\n    CREATE INDEX IF NOT EXISTS idx_mentions_target ON mentions(target_uuid);\n  "));
}
function Me() {
	if (!v) throw Error("No project database is open — open a project first.");
	return v;
}
function Ne() {
	v?.close(), v = null;
}
function Pe(e, t) {
	if (!t.trim()) return;
	let n = f("sha256").update(t).digest("hex");
	if (Me().prepare("SELECT hash FROM ticket_history WHERE ticket_uuid = ? ORDER BY ts DESC LIMIT 1").get(e)?.hash === n) return;
	let r = Math.floor(Date.now() / 1e3);
	Me().prepare("INSERT OR REPLACE INTO ticket_history (ticket_uuid, ts, description, hash) VALUES (?, ?, ?, ?)").run(e, r, t, n);
}
function Fe(e) {
	return Me().prepare("SELECT ts, description FROM ticket_history WHERE ticket_uuid = ? ORDER BY ts DESC").all(e);
}
function y(e, t = []) {
	let n = Me().prepare(e);
	return /^\s*SELECT/i.test(e) ? n.all(...t) : n.run(...t);
}
//#endregion
//#region electron/vault/vaultManager.ts
var b = "", x = /* @__PURE__ */ new Map();
function Ie(e) {
	b = e, h.mkdirSync(e, { recursive: !0 }), Le();
}
function Le() {
	x.clear();
	for (let e of h.readdirSync(b)) {
		if (!e.endsWith(".md")) continue;
		let t = h.readFileSync(a.join(b, e), "utf8").match(/^uuid:\s*(.+)$/m);
		t && x.set(t[1].trim(), e);
	}
}
function Re() {
	b = "", x.clear();
}
function ze(e) {
	return [
		"---",
		`uuid: ${e.uuid}`,
		`id: ${e.id}`,
		`title: ${e.title}`,
		`type: ${e.type}`,
		`status: ${e.status}`,
		`backlog: ${e.backlog === 1}`,
		"---"
	].join("\n");
}
function Be(e) {
	if (!b) return;
	let t = y("SELECT * FROM tickets WHERE uuid = ? LIMIT 1", [e])[0];
	if (!t || t.archived === 1) {
		Ve(e);
		return;
	}
	let n = `${t.id}.md`, r = a.join(b, n), i = x.get(e);
	i && i !== n && h.rmSync(a.join(b, i), { force: !0 });
	let o = `${ze(t)}\n\n${t.description}`;
	h.writeFileSync(r, o, "utf8"), x.set(e, n);
}
function Ve(e) {
	if (!b) return;
	let t = x.get(e);
	t && (h.rmSync(a.join(b, t), { force: !0 }), x.delete(e));
}
function He() {
	b && (h.rmSync(b, {
		recursive: !0,
		force: !0
	}), h.mkdirSync(b, { recursive: !0 }), x.clear());
}
//#endregion
//#region node_modules/readdirp/index.js
var S = {
	FILE_TYPE: "files",
	DIR_TYPE: "directories",
	FILE_DIR_TYPE: "files_directories",
	EVERYTHING_TYPE: "all"
}, Ue = {
	root: ".",
	fileFilter: (e) => !0,
	directoryFilter: (e) => !0,
	type: S.FILE_TYPE,
	lstat: !1,
	depth: 2147483648,
	alwaysStat: !1,
	highWaterMark: 4096
};
Object.freeze(Ue);
var We = "READDIRP_RECURSIVE_ERROR", Ge = new Set([
	"ENOENT",
	"EPERM",
	"EACCES",
	"ELOOP",
	We
]), Ke = [
	S.DIR_TYPE,
	S.EVERYTHING_TYPE,
	S.FILE_DIR_TYPE,
	S.FILE_TYPE
], qe = new Set([
	S.DIR_TYPE,
	S.EVERYTHING_TYPE,
	S.FILE_DIR_TYPE
]), Je = new Set([
	S.EVERYTHING_TYPE,
	S.FILE_DIR_TYPE,
	S.FILE_TYPE
]), Ye = (e) => Ge.has(e.code), Xe = process.platform === "win32", Ze = (e) => !0, Qe = (e) => {
	if (e === void 0) return Ze;
	if (typeof e == "function") return e;
	if (typeof e == "string") {
		let t = e.trim();
		return (e) => e.basename === t;
	}
	if (Array.isArray(e)) {
		let t = e.map((e) => e.trim());
		return (e) => t.some((t) => e.basename === t);
	}
	return Ze;
}, $e = class extends pe {
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
	constructor(e = {}) {
		super({
			objectMode: !0,
			autoDestroy: !0,
			highWaterMark: e.highWaterMark
		});
		let t = {
			...Ue,
			...e
		}, { root: n, type: r } = t;
		this._fileFilter = Qe(t.fileFilter), this._directoryFilter = Qe(t.directoryFilter);
		let i = t.lstat ? ce : fe;
		Xe ? this._stat = (e) => i(e, { bigint: !0 }) : this._stat = i, this._maxDepth = t.depth != null && Number.isSafeInteger(t.depth) ? t.depth : Ue.depth, this._wantsDir = r ? qe.has(r) : !1, this._wantsFile = r ? Je.has(r) : !1, this._wantsEverything = r === S.EVERYTHING_TYPE, this._root = c(n), this._isDirent = !t.alwaysStat, this._statsProp = this._isDirent ? "dirent" : "stats", this._rdOptions = {
			encoding: "utf8",
			withFileTypes: this._isDirent
		}, this.parents = [this._exploreDir(n, 1)], this.reading = !1, this.parent = void 0;
	}
	async _read(e) {
		if (!this.reading) {
			this.reading = !0;
			try {
				for (; !this.destroyed && e > 0;) {
					let t = this.parent, n = t && t.files;
					if (n && n.length > 0) {
						let { path: r, depth: i } = t, a = n.splice(0, e).map((e) => this._formatEntry(e, r)), o = await Promise.all(a);
						for (let t of o) {
							if (!t) continue;
							if (this.destroyed) return;
							let n = await this._getEntryType(t);
							n === "directory" && this._directoryFilter(t) ? (i <= this._maxDepth && this.parents.push(this._exploreDir(t.fullPath, i + 1)), this._wantsDir && (this.push(t), e--)) : (n === "file" || this._includeAsFile(t)) && this._fileFilter(t) && this._wantsFile && (this.push(t), e--);
						}
					} else {
						let e = this.parents.pop();
						if (!e) {
							this.push(null);
							break;
						}
						if (this.parent = await e, this.destroyed) return;
					}
				}
			} catch (e) {
				this.destroy(e);
			} finally {
				this.reading = !1;
			}
		}
	}
	async _exploreDir(e, t) {
		let n;
		try {
			n = await ue(e, this._rdOptions);
		} catch (e) {
			this._onError(e);
		}
		return {
			files: n,
			depth: t,
			path: e
		};
	}
	async _formatEntry(e, t) {
		let n, r = this._isDirent ? e.name : e;
		try {
			let i = c(o(t, r));
			n = {
				path: s(this._root, i),
				fullPath: i,
				basename: r
			}, n[this._statsProp] = this._isDirent ? e : await this._stat(i);
		} catch (e) {
			this._onError(e);
			return;
		}
		return n;
	}
	_onError(e) {
		Ye(e) && !this.destroyed ? this.emit("warn", e) : this.destroy(e);
	}
	async _getEntryType(e) {
		if (!e && this._statsProp in e) return "";
		let t = e[this._statsProp];
		if (t.isFile()) return "file";
		if (t.isDirectory()) return "directory";
		if (t && t.isSymbolicLink()) {
			let t = e.fullPath;
			try {
				let e = await de(t), n = await ce(e);
				if (n.isFile()) return "file";
				if (n.isDirectory()) {
					let n = e.length;
					if (t.startsWith(e) && t.substr(n, 1) === l) {
						let n = /* @__PURE__ */ Error(`Circular symlink detected: "${t}" points to "${e}"`);
						return n.code = We, this._onError(n);
					}
					return "directory";
				}
			} catch (e) {
				return this._onError(e), "";
			}
		}
	}
	_includeAsFile(e) {
		let t = e && e[this._statsProp];
		return t && this._wantsEverything && !t.isDirectory();
	}
};
function et(e, t = {}) {
	let n = t.entryType || t.type;
	if (n === "both" && (n = S.FILE_DIR_TYPE), n && (t.type = n), !e) throw Error("readdirp: root argument is required. Usage: readdirp(root, options)");
	if (typeof e != "string") throw TypeError("readdirp: root argument must be a string. Usage: readdirp(root, options)");
	if (n && !Ke.includes(n)) throw Error(`readdirp: Invalid type passed. Use one of ${Ke.join(", ")}`);
	return t.root = e, new $e(t);
}
//#endregion
//#region node_modules/chokidar/handler.js
var tt = "data", nt = "close", rt = () => {}, it = process.platform, at = it === "win32", ot = it === "darwin", st = it === "linux", ct = it === "freebsd", lt = me() === "OS400", C = {
	ALL: "all",
	READY: "ready",
	ADD: "add",
	CHANGE: "change",
	ADD_DIR: "addDir",
	UNLINK: "unlink",
	UNLINK_DIR: "unlinkDir",
	RAW: "raw",
	ERROR: "error"
}, w = C, ut = "watch", dt = {
	lstat: ce,
	stat: fe
}, T = "listeners", ft = "errHandlers", E = "rawEmitters", pt = [
	T,
	ft,
	E
], mt = new Set(/* @__PURE__ */ "3dm.3ds.3g2.3gp.7z.a.aac.adp.afdesign.afphoto.afpub.ai.aif.aiff.alz.ape.apk.appimage.ar.arj.asf.au.avi.bak.baml.bh.bin.bk.bmp.btif.bz2.bzip2.cab.caf.cgm.class.cmx.cpio.cr2.cur.dat.dcm.deb.dex.djvu.dll.dmg.dng.doc.docm.docx.dot.dotm.dra.DS_Store.dsk.dts.dtshd.dvb.dwg.dxf.ecelp4800.ecelp7470.ecelp9600.egg.eol.eot.epub.exe.f4v.fbs.fh.fla.flac.flatpak.fli.flv.fpx.fst.fvt.g3.gh.gif.graffle.gz.gzip.h261.h263.h264.icns.ico.ief.img.ipa.iso.jar.jpeg.jpg.jpgv.jpm.jxr.key.ktx.lha.lib.lvp.lz.lzh.lzma.lzo.m3u.m4a.m4v.mar.mdi.mht.mid.midi.mj2.mka.mkv.mmr.mng.mobi.mov.movie.mp3.mp4.mp4a.mpeg.mpg.mpga.mxu.nef.npx.numbers.nupkg.o.odp.ods.odt.oga.ogg.ogv.otf.ott.pages.pbm.pcx.pdb.pdf.pea.pgm.pic.png.pnm.pot.potm.potx.ppa.ppam.ppm.pps.ppsm.ppsx.ppt.pptm.pptx.psd.pya.pyc.pyo.pyv.qt.rar.ras.raw.resources.rgb.rip.rlc.rmf.rmvb.rpm.rtf.rz.s3m.s7z.scpt.sgi.shar.snap.sil.sketch.slk.smv.snk.so.stl.suo.sub.swf.tar.tbz.tbz2.tga.tgz.thmx.tif.tiff.tlz.ttc.ttf.txz.udf.uvh.uvi.uvm.uvp.uvs.uvu.viv.vob.war.wav.wax.wbmp.wdp.weba.webm.webp.whl.wim.wm.wma.wmv.wmx.woff.woff2.wrm.wvx.xbm.xif.xla.xlam.xls.xlsb.xlsm.xlsx.xlt.xltm.xltx.xm.xmind.xpi.xpm.xwd.xz.z.zip.zipx".split(".")), ht = (e) => mt.has(i.extname(e).slice(1).toLowerCase()), gt = (e, t) => {
	e instanceof Set ? e.forEach(t) : t(e);
}, _t = (e, t, n) => {
	let r = e[t];
	r instanceof Set || (e[t] = r = new Set([r])), r.add(n);
}, vt = (e) => (t) => {
	let n = e[t];
	n instanceof Set ? n.clear() : delete e[t];
}, yt = (e, t, n) => {
	let r = e[t];
	r instanceof Set ? r.delete(n) : r === n && delete e[t];
}, bt = (e) => e instanceof Set ? e.size === 0 : !e, xt = /* @__PURE__ */ new Map();
function St(e, t, n, r, a) {
	let o = (t, r) => {
		n(e), a(t, r, { watchedPath: e }), r && e !== r && Ct(i.resolve(e, r), T, i.join(e, r));
	};
	try {
		return ie(e, { persistent: t.persistent }, o);
	} catch (e) {
		r(e);
		return;
	}
}
var Ct = (e, t, n, r, i) => {
	let a = xt.get(e);
	a && gt(a[t], (e) => {
		e(n, r, i);
	});
}, wt = (e, t, n, r) => {
	let { listener: i, errHandler: a, rawEmitter: o } = r, s = xt.get(t), c;
	if (!n.persistent) return c = St(e, n, i, a, o), c ? c.close.bind(c) : void 0;
	if (s) _t(s, T, i), _t(s, ft, a), _t(s, E, o);
	else {
		if (c = St(e, n, Ct.bind(null, t, T), a, Ct.bind(null, t, E)), !c) return;
		c.on(w.ERROR, async (n) => {
			let r = Ct.bind(null, t, ft);
			if (s && (s.watcherUnusable = !0), at && n.code === "EPERM") try {
				await (await le(e, "r")).close(), r(n);
			} catch {}
			else r(n);
		}), s = {
			listeners: i,
			errHandlers: a,
			rawEmitters: o,
			watcher: c
		}, xt.set(t, s);
	}
	return () => {
		yt(s, T, i), yt(s, ft, a), yt(s, E, o), bt(s.listeners) && (s.watcher.close(), xt.delete(t), pt.forEach(vt(s)), s.watcher = void 0, Object.freeze(s));
	};
}, Tt = /* @__PURE__ */ new Map(), Et = (e, t, n, r) => {
	let { listener: i, rawEmitter: a } = r, o = Tt.get(t), s = o && o.options;
	return s && (s.persistent < n.persistent || s.interval > n.interval) && (re(t), o = void 0), o ? (_t(o, T, i), _t(o, E, a)) : (o = {
		listeners: i,
		rawEmitters: a,
		options: n,
		watcher: ae(t, n, (n, r) => {
			gt(o.rawEmitters, (e) => {
				e(w.CHANGE, t, {
					curr: n,
					prev: r
				});
			});
			let i = n.mtimeMs;
			(n.size !== r.size || i > r.mtimeMs || i === 0) && gt(o.listeners, (t) => t(e, n));
		})
	}, Tt.set(t, o)), () => {
		yt(o, T, i), yt(o, E, a), bt(o.listeners) && (Tt.delete(t), re(t), o.options = o.watcher = void 0, Object.freeze(o));
	};
}, Dt = class {
	fsw;
	_boundHandleError;
	constructor(e) {
		this.fsw = e, this._boundHandleError = (t) => e._handleError(t);
	}
	_watchWithNodeFs(e, t) {
		let n = this.fsw.options, r = i.dirname(e), a = i.basename(e);
		this.fsw._getWatchedDir(r).add(a);
		let o = i.resolve(e), s = { persistent: n.persistent };
		t ||= rt;
		let c;
		return n.usePolling ? (s.interval = n.interval !== n.binaryInterval && ht(a) ? n.binaryInterval : n.interval, c = Et(e, o, s, {
			listener: t,
			rawEmitter: this.fsw._emitRaw
		})) : c = wt(e, o, s, {
			listener: t,
			errHandler: this._boundHandleError,
			rawEmitter: this.fsw._emitRaw
		}), c;
	}
	_handleFile(e, t, n) {
		if (this.fsw.closed) return;
		let r = i.dirname(e), a = i.basename(e), o = this.fsw._getWatchedDir(r), s = t;
		if (o.has(a)) return;
		let c = async (t, n) => {
			if (this.fsw._throttle(ut, e, 5)) {
				if (!n || n.mtimeMs === 0) try {
					let n = await fe(e);
					if (this.fsw.closed) return;
					let r = n.atimeMs, i = n.mtimeMs;
					if ((!r || r <= i || i !== s.mtimeMs) && this.fsw._emit(w.CHANGE, e, n), (ot || st || ct) && s.ino !== n.ino) {
						this.fsw._closeFile(t), s = n;
						let r = this._watchWithNodeFs(e, c);
						r && this.fsw._addPathCloser(t, r);
					} else s = n;
				} catch {
					this.fsw._remove(r, a);
				}
				else if (o.has(a)) {
					let t = n.atimeMs, r = n.mtimeMs;
					(!t || t <= r || r !== s.mtimeMs) && this.fsw._emit(w.CHANGE, e, n), s = n;
				}
			}
		}, l = this._watchWithNodeFs(e, c);
		if (!(n && this.fsw.options.ignoreInitial) && this.fsw._isntIgnored(e)) {
			if (!this.fsw._throttle(w.ADD, e, 0)) return;
			this.fsw._emit(w.ADD, e, t);
		}
		return l;
	}
	async _handleSymlink(e, t, n, r) {
		if (this.fsw.closed) return;
		let i = e.fullPath, a = this.fsw._getWatchedDir(t);
		if (!this.fsw.options.followSymlinks) {
			this.fsw._incrReadyCount();
			let t;
			try {
				t = await de(n);
			} catch {
				return this.fsw._emitReady(), !0;
			}
			return this.fsw.closed ? void 0 : (a.has(r) ? this.fsw._symlinkPaths.get(i) !== t && (this.fsw._symlinkPaths.set(i, t), this.fsw._emit(w.CHANGE, n, e.stats)) : (a.add(r), this.fsw._symlinkPaths.set(i, t), this.fsw._emit(w.ADD, n, e.stats)), this.fsw._emitReady(), !0);
		}
		if (this.fsw._symlinkPaths.has(i)) return !0;
		this.fsw._symlinkPaths.set(i, !0);
	}
	_handleRead(e, t, n, r, a, o, s) {
		e = i.join(e, "");
		let c = r ? `${e}:${r}` : e;
		if (s = this.fsw._throttle("readdir", c, 1e3), !s) return;
		let l = this.fsw._getWatchedDir(n.path), u = /* @__PURE__ */ new Set(), d = this.fsw._readdirp(e, {
			fileFilter: (e) => n.filterPath(e),
			directoryFilter: (e) => n.filterDir(e)
		});
		if (d) return d.on(tt, async (s) => {
			if (this.fsw.closed) {
				d = void 0;
				return;
			}
			let c = s.path, f = i.join(e, c);
			if (u.add(c), !(s.stats.isSymbolicLink() && await this._handleSymlink(s, e, f, c))) {
				if (this.fsw.closed) {
					d = void 0;
					return;
				}
				(c === r || !r && !l.has(c)) && (this.fsw._incrReadyCount(), f = i.join(a, i.relative(a, f)), this._addToNodeFs(f, t, n, o + 1));
			}
		}).on(w.ERROR, this._boundHandleError), new Promise((t, i) => {
			if (!d) return i();
			d.once("end", () => {
				if (this.fsw.closed) {
					d = void 0;
					return;
				}
				let i = s ? s.clear() : !1;
				t(void 0), l.getChildren().filter((t) => t !== e && !u.has(t)).forEach((t) => {
					this.fsw._remove(e, t);
				}), d = void 0, i && this._handleRead(e, !1, n, r, a, o, s);
			});
		});
	}
	async _handleDir(e, t, n, r, a, o, s) {
		let c = this.fsw._getWatchedDir(i.dirname(e)), l = c.has(i.basename(e));
		!(n && this.fsw.options.ignoreInitial) && !a && !l && this.fsw._emit(w.ADD_DIR, e, t), c.add(i.basename(e)), this.fsw._getWatchedDir(e);
		let u, d = this.fsw.options.depth;
		if ((d == null || r <= d) && !this.fsw._symlinkPaths.has(s)) {
			if (!a && (await this._handleRead(e, n, o, a, e, r, void 0), this.fsw.closed)) return;
			u = this._watchWithNodeFs(e, (t, n) => {
				n && n.mtimeMs === 0 || this._handleRead(t, !1, o, a, e, r, void 0);
			});
		}
		return u;
	}
	async _addToNodeFs(e, t, n, r, a) {
		let o = this.fsw._emitReady;
		if (this.fsw._isIgnored(e) || this.fsw.closed) return o(), !1;
		let s = this.fsw._getWatchHelpers(e);
		n && (s.filterPath = (e) => n.filterPath(e), s.filterDir = (e) => n.filterDir(e));
		try {
			let n = await dt[s.statMethod](s.watchPath);
			if (this.fsw.closed) return;
			if (this.fsw._isIgnored(s.watchPath, n)) return o(), !1;
			let c = this.fsw.options.followSymlinks, l;
			if (n.isDirectory()) {
				let o = i.resolve(e), u = c ? await de(e) : e;
				if (this.fsw.closed || (l = await this._handleDir(s.watchPath, n, t, r, a, s, u), this.fsw.closed)) return;
				o !== u && u !== void 0 && this.fsw._symlinkPaths.set(o, u);
			} else if (n.isSymbolicLink()) {
				let a = c ? await de(e) : e;
				if (this.fsw.closed) return;
				let o = i.dirname(s.watchPath);
				if (this.fsw._getWatchedDir(o).add(s.watchPath), this.fsw._emit(w.ADD, s.watchPath, n), l = await this._handleDir(o, n, t, r, e, s, a), this.fsw.closed) return;
				a !== void 0 && this.fsw._symlinkPaths.set(i.resolve(e), a);
			} else l = this._handleFile(s.watchPath, n, t);
			return o(), l && this.fsw._addPathCloser(e, l), !1;
		} catch (t) {
			if (this.fsw._handleError(t)) return o(), e;
		}
	}
}, Ot = "/", kt = "//", At = ".", jt = "..", Mt = "string", Nt = /\\/g, Pt = /\/\//g, Ft = /\..*\.(sw[px])$|~$|\.subl.*\.tmp/, It = /^\.[/\\]/;
function Lt(e) {
	return Array.isArray(e) ? e : [e];
}
var Rt = (e) => typeof e == "object" && !!e && !(e instanceof RegExp);
function zt(e) {
	return typeof e == "function" ? e : typeof e == "string" ? (t) => e === t : e instanceof RegExp ? (t) => e.test(t) : typeof e == "object" && e ? (t) => {
		if (e.path === t) return !0;
		if (e.recursive) {
			let n = i.relative(e.path, t);
			return n ? !n.startsWith("..") && !i.isAbsolute(n) : !1;
		}
		return !1;
	} : () => !1;
}
function Bt(e) {
	if (typeof e != "string") throw Error("string expected");
	e = i.normalize(e), e = e.replace(/\\/g, "/");
	let t = !1;
	return e.startsWith("//") && (t = !0), e = e.replace(Pt, "/"), t && (e = "/" + e), e;
}
function Vt(e, t, n) {
	let r = Bt(t);
	for (let t = 0; t < e.length; t++) {
		let i = e[t];
		if (i(r, n)) return !0;
	}
	return !1;
}
function Ht(e, t) {
	if (e == null) throw TypeError("anymatch: specify first argument");
	let n = Lt(e).map((e) => zt(e));
	return t == null ? (e, t) => Vt(n, e, t) : Vt(n, t);
}
var Ut = (e) => {
	let t = Lt(e).flat();
	if (!t.every((e) => typeof e === Mt)) throw TypeError(`Non-string provided as watch path: ${t}`);
	return t.map(Gt);
}, Wt = (e) => {
	let t = e.replace(Nt, Ot), n = !1;
	return t.startsWith(kt) && (n = !0), t = t.replace(Pt, Ot), n && (t = Ot + t), t;
}, Gt = (e) => Wt(i.normalize(Wt(e))), Kt = (e = "") => (t) => typeof t == "string" ? Gt(i.isAbsolute(t) ? t : i.join(e, t)) : t, qt = (e, t) => i.isAbsolute(e) ? e : i.join(t, e), Jt = Object.freeze(/* @__PURE__ */ new Set()), Yt = class {
	path;
	_removeWatcher;
	items;
	constructor(e, t) {
		this.path = e, this._removeWatcher = t, this.items = /* @__PURE__ */ new Set();
	}
	add(e) {
		let { items: t } = this;
		t && e !== At && e !== jt && t.add(e);
	}
	async remove(e) {
		let { items: t } = this;
		if (!t || (t.delete(e), t.size > 0)) return;
		let n = this.path;
		try {
			await ue(n);
		} catch {
			this._removeWatcher && this._removeWatcher(i.dirname(n), i.basename(n));
		}
	}
	has(e) {
		let { items: t } = this;
		if (t) return t.has(e);
	}
	getChildren() {
		let { items: e } = this;
		return e ? [...e.values()] : [];
	}
	dispose() {
		this.items.clear(), this.path = "", this._removeWatcher = rt, this.items = Jt, Object.freeze(this);
	}
}, Xt = "stat", Zt = "lstat", Qt = class {
	fsw;
	path;
	watchPath;
	fullWatchPath;
	dirParts;
	followSymlinks;
	statMethod;
	constructor(e, t, n) {
		this.fsw = n;
		let r = e;
		this.path = e = e.replace(It, ""), this.watchPath = r, this.fullWatchPath = i.resolve(r), this.dirParts = [], this.dirParts.forEach((e) => {
			e.length > 1 && e.pop();
		}), this.followSymlinks = t, this.statMethod = t ? Xt : Zt;
	}
	entryPath(e) {
		return i.join(this.watchPath, i.relative(this.watchPath, e.fullPath));
	}
	filterPath(e) {
		let { stats: t } = e;
		if (t && t.isSymbolicLink()) return this.filterDir(e);
		let n = this.entryPath(e);
		return this.fsw._isntIgnored(n, t) && this.fsw._hasReadPermissions(t);
	}
	filterDir(e) {
		return this.fsw._isntIgnored(this.entryPath(e), e.stats);
	}
}, $t = class extends se {
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
	constructor(e = {}) {
		super(), this.closed = !1, this._closers = /* @__PURE__ */ new Map(), this._ignoredPaths = /* @__PURE__ */ new Set(), this._throttled = /* @__PURE__ */ new Map(), this._streams = /* @__PURE__ */ new Set(), this._symlinkPaths = /* @__PURE__ */ new Map(), this._watched = /* @__PURE__ */ new Map(), this._pendingWrites = /* @__PURE__ */ new Map(), this._pendingUnlinks = /* @__PURE__ */ new Map(), this._readyCount = 0, this._readyEmitted = !1;
		let t = e.awaitWriteFinish, n = {
			stabilityThreshold: 2e3,
			pollInterval: 100
		}, r = {
			persistent: !0,
			ignoreInitial: !1,
			ignorePermissionErrors: !1,
			interval: 100,
			binaryInterval: 300,
			followSymlinks: !0,
			usePolling: !1,
			atomic: !0,
			...e,
			ignored: e.ignored ? Lt(e.ignored) : Lt([]),
			awaitWriteFinish: t === !0 ? n : typeof t == "object" ? {
				...n,
				...t
			} : !1
		};
		lt && (r.usePolling = !0), r.atomic === void 0 && (r.atomic = !r.usePolling);
		let i = process.env.CHOKIDAR_USEPOLLING;
		if (i !== void 0) {
			let e = i.toLowerCase();
			e === "false" || e === "0" ? r.usePolling = !1 : e === "true" || e === "1" ? r.usePolling = !0 : r.usePolling = !!e;
		}
		let a = process.env.CHOKIDAR_INTERVAL;
		a && (r.interval = Number.parseInt(a, 10));
		let o = 0;
		this._emitReady = () => {
			o++, o >= this._readyCount && (this._emitReady = rt, this._readyEmitted = !0, process.nextTick(() => this.emit(C.READY)));
		}, this._emitRaw = (...e) => this.emit(C.RAW, ...e), this._boundRemove = this._remove.bind(this), this.options = r, this._nodeFsHandler = new Dt(this), Object.freeze(r);
	}
	_addIgnoredPath(e) {
		if (Rt(e)) {
			for (let t of this._ignoredPaths) if (Rt(t) && t.path === e.path && t.recursive === e.recursive) return;
		}
		this._ignoredPaths.add(e);
	}
	_removeIgnoredPath(e) {
		if (this._ignoredPaths.delete(e), typeof e == "string") for (let t of this._ignoredPaths) Rt(t) && t.path === e && this._ignoredPaths.delete(t);
	}
	add(e, t, n) {
		let { cwd: r } = this.options;
		this.closed = !1, this._closePromise = void 0;
		let a = Ut(e);
		return r && (a = a.map((e) => qt(e, r))), a.forEach((e) => {
			this._removeIgnoredPath(e);
		}), this._userIgnored = void 0, this._readyCount ||= 0, this._readyCount += a.length, Promise.all(a.map(async (e) => {
			let r = await this._nodeFsHandler._addToNodeFs(e, !n, void 0, 0, t);
			return r && this._emitReady(), r;
		})).then((e) => {
			this.closed || e.forEach((e) => {
				e && this.add(i.dirname(e), i.basename(t || e));
			});
		}), this;
	}
	unwatch(e) {
		if (this.closed) return this;
		let t = Ut(e), { cwd: n } = this.options;
		return t.forEach((e) => {
			!i.isAbsolute(e) && !this._closers.has(e) && (n && (e = i.join(n, e)), e = i.resolve(e)), this._closePath(e), this._addIgnoredPath(e), this._watched.has(e) && this._addIgnoredPath({
				path: e,
				recursive: !0
			}), this._userIgnored = void 0;
		}), this;
	}
	close() {
		if (this._closePromise) return this._closePromise;
		this.closed = !0, this.removeAllListeners();
		let e = [];
		return this._closers.forEach((t) => t.forEach((t) => {
			let n = t();
			n instanceof Promise && e.push(n);
		})), this._streams.forEach((e) => e.destroy()), this._userIgnored = void 0, this._readyCount = 0, this._readyEmitted = !1, this._watched.forEach((e) => e.dispose()), this._closers.clear(), this._watched.clear(), this._streams.clear(), this._symlinkPaths.clear(), this._throttled.clear(), this._closePromise = e.length ? Promise.all(e).then(() => void 0) : Promise.resolve(), this._closePromise;
	}
	getWatched() {
		let e = {};
		return this._watched.forEach((t, n) => {
			let r = (this.options.cwd ? i.relative(this.options.cwd, n) : n) || At;
			e[r] = t.getChildren().sort();
		}), e;
	}
	emitWithAll(e, t) {
		this.emit(e, ...t), e !== C.ERROR && this.emit(C.ALL, e, ...t);
	}
	async _emit(e, t, n) {
		if (this.closed) return;
		let r = this.options;
		at && (t = i.normalize(t)), r.cwd && (t = i.relative(r.cwd, t));
		let a = [t];
		n != null && a.push(n);
		let o = r.awaitWriteFinish, s;
		if (o && (s = this._pendingWrites.get(t))) return s.lastChange = /* @__PURE__ */ new Date(), this;
		if (r.atomic) {
			if (e === C.UNLINK) return this._pendingUnlinks.set(t, [e, ...a]), setTimeout(() => {
				this._pendingUnlinks.forEach((e, t) => {
					this.emit(...e), this.emit(C.ALL, ...e), this._pendingUnlinks.delete(t);
				});
			}, typeof r.atomic == "number" ? r.atomic : 100), this;
			e === C.ADD && this._pendingUnlinks.has(t) && (e = C.CHANGE, this._pendingUnlinks.delete(t));
		}
		if (o && (e === C.ADD || e === C.CHANGE) && this._readyEmitted) return this._awaitWriteFinish(t, o.stabilityThreshold, e, (t, n) => {
			t ? (e = C.ERROR, a[0] = t, this.emitWithAll(e, a)) : n && (a.length > 1 ? a[1] = n : a.push(n), this.emitWithAll(e, a));
		}), this;
		if (e === C.CHANGE && !this._throttle(C.CHANGE, t, 50)) return this;
		if (r.alwaysStat && n === void 0 && (e === C.ADD || e === C.ADD_DIR || e === C.CHANGE)) {
			let e = r.cwd ? i.join(r.cwd, t) : t, n;
			try {
				n = await fe(e);
			} catch {}
			if (!n || this.closed) return;
			a.push(n);
		}
		return this.emitWithAll(e, a), this;
	}
	_handleError(e) {
		let t = e && e.code;
		return e && t !== "ENOENT" && t !== "ENOTDIR" && (!this.options.ignorePermissionErrors || t !== "EPERM" && t !== "EACCES") && this.emit(C.ERROR, e), e || this.closed;
	}
	_throttle(e, t, n) {
		this._throttled.has(e) || this._throttled.set(e, /* @__PURE__ */ new Map());
		let r = this._throttled.get(e);
		if (!r) throw Error("invalid throttle");
		let i = r.get(t);
		if (i) return i.count++, !1;
		let a, o = () => {
			let e = r.get(t), n = e ? e.count : 0;
			return r.delete(t), clearTimeout(a), e && clearTimeout(e.timeoutObject), n;
		};
		a = setTimeout(o, n);
		let s = {
			timeoutObject: a,
			clear: o,
			count: 0
		};
		return r.set(t, s), s;
	}
	_incrReadyCount() {
		return this._readyCount++;
	}
	_awaitWriteFinish(e, t, n, r) {
		let a = this.options.awaitWriteFinish;
		if (typeof a != "object") return;
		let o = a.pollInterval, s, c = e;
		this.options.cwd && !i.isAbsolute(e) && (c = i.join(this.options.cwd, e));
		let l = /* @__PURE__ */ new Date(), u = this._pendingWrites;
		function d(n) {
			te(c, (i, a) => {
				if (i || !u.has(e)) {
					i && i.code !== "ENOENT" && r(i);
					return;
				}
				let c = Number(/* @__PURE__ */ new Date());
				n && a.size !== n.size && (u.get(e).lastChange = c), c - u.get(e).lastChange >= t ? (u.delete(e), r(void 0, a)) : s = setTimeout(d, o, a);
			});
		}
		u.has(e) || (u.set(e, {
			lastChange: l,
			cancelWait: () => (u.delete(e), clearTimeout(s), n)
		}), s = setTimeout(d, o));
	}
	_isIgnored(e, t) {
		if (this.options.atomic && Ft.test(e)) return !0;
		if (!this._userIgnored) {
			let { cwd: e } = this.options, t = (this.options.ignored || []).map(Kt(e)), n = [...[...this._ignoredPaths].map(Kt(e)), ...t];
			this._userIgnored = Ht(n, void 0);
		}
		return this._userIgnored(e, t);
	}
	_isntIgnored(e, t) {
		return !this._isIgnored(e, t);
	}
	_getWatchHelpers(e) {
		return new Qt(e, this.options.followSymlinks, this);
	}
	_getWatchedDir(e) {
		let t = i.resolve(e);
		return this._watched.has(t) || this._watched.set(t, new Yt(t, this._boundRemove)), this._watched.get(t);
	}
	_hasReadPermissions(e) {
		return this.options.ignorePermissionErrors ? !0 : !!(Number(e.mode) & 256);
	}
	_remove(e, t, n) {
		let r = i.join(e, t), a = i.resolve(r);
		if (n ??= this._watched.has(r) || this._watched.has(a), !this._throttle("remove", r, 100)) return;
		!n && this._watched.size === 1 && this.add(e, t, !0), this._getWatchedDir(r).getChildren().forEach((e) => this._remove(r, e));
		let o = this._getWatchedDir(e), s = o.has(t);
		o.remove(t), this._symlinkPaths.has(a) && this._symlinkPaths.delete(a);
		let c = r;
		if (this.options.cwd && (c = i.relative(this.options.cwd, r)), this.options.awaitWriteFinish && this._pendingWrites.has(c) && this._pendingWrites.get(c).cancelWait() === C.ADD) return;
		this._watched.delete(r), this._watched.delete(a);
		let l = n ? C.UNLINK_DIR : C.UNLINK;
		s && !this._isIgnored(r) && this._emit(l, r), this._closePath(r);
	}
	_closePath(e) {
		this._closeFile(e);
		let t = i.dirname(e);
		this._getWatchedDir(t).remove(i.basename(e));
	}
	_closeFile(e) {
		let t = this._closers.get(e);
		t && (t.forEach((e) => e()), this._closers.delete(e));
	}
	_addPathCloser(e, t) {
		if (!t) return;
		let n = this._closers.get(e);
		n || (n = [], this._closers.set(e, n)), n.push(t);
	}
	_readdirp(e, t) {
		if (this.closed) return;
		let n = et(e, {
			type: C.ALL,
			alwaysStat: !0,
			lstat: !0,
			...t,
			depth: 0
		});
		return this._streams.add(n), n.once(nt, () => {
			n = void 0;
		}), n.once("end", () => {
			n &&= (this._streams.delete(n), void 0);
		}), n;
	}
};
function en(e, t = {}) {
	let n = new $t(t);
	return n.add(e), n;
}
//#endregion
//#region electron/vault/vaultWatcher.ts
var D = null;
function tn(e) {
	let t = e.trim();
	return t === "true" ? !0 : t === "false" ? !1 : t.replace(/^(['"])(.*)\1$/, "$2");
}
function nn(e) {
	let t = e.replace(/^\uFEFF/, ""), n = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/.exec(t);
	if (!n) return null;
	let r = {};
	for (let e of n[1].split(/\r?\n/)) {
		if (!e.trim()) continue;
		let t = e.indexOf(":");
		if (t === -1) continue;
		let n = e.slice(0, t).trim();
		n && (r[n] = tn(e.slice(t + 1)));
	}
	return {
		frontmatter: r,
		body: n[2].replace(/^\r?\n/, "")
	};
}
function rn(e) {
	return y("SELECT uuid, description, updated_at FROM tickets WHERE uuid = ? LIMIT 1", [e])[0] ?? null;
}
function an(e, t, n) {
	let r, i;
	try {
		if (r = h.statSync(e), !r.isFile()) return !1;
		i = h.readFileSync(e, "utf8");
	} catch (t) {
		return console.warn(`Vault watcher skipped unreadable file: ${e}`, t), !1;
	}
	let a = nn(i);
	if (!a) return console.warn(`Vault watcher skipped malformed markdown: ${e}`), !1;
	let o = t ?? a.frontmatter.uuid;
	if (typeof o != "string" || !o.trim()) return console.warn(`Vault watcher skipped markdown without uuid: ${e}`), !1;
	let s = a.body;
	if (!s.trim()) return !1;
	let c = rn(o);
	return c ? r.mtime.getTime() <= c.updated_at || c.description === s ? !1 : (y("UPDATE tickets SET description = ?, updated_at = ? WHERE uuid = ?", [
		s,
		r.mtime.getTime(),
		o
	]), n?.(o), !0) : (console.warn(`Vault watcher could not find ticket for uuid: ${o}`), !1);
}
function on(e) {
	return a.extname(e).toLowerCase() === ".md";
}
function sn(e, t) {
	on(e) && an(e, void 0, t);
}
function cn(e, t) {
	return ln(), D = en(e, {
		ignoreInitial: !0,
		awaitWriteFinish: {
			stabilityThreshold: 100,
			pollInterval: 25
		},
		ignored: (e, t) => t?.isFile() ? !on(e) : !1
	}), D.on("add", (e) => sn(e, t)), D.on("change", (e) => sn(e, t)), D.on("error", (e) => {
		console.warn("Vault watcher error:", e);
	}), D;
}
async function ln() {
	let e = D;
	D = null, e && await e.close();
}
//#endregion
//#region electron/ipc/ticketAPI.ts
var un = /\btickets\b/i, dn = /^\s*SELECT/i, fn = /^\s*DELETE/i, pn = /DELETE\s+FROM\s+tickets\s*$/i, mn = 3e4, hn = /* @__PURE__ */ new Map();
function gn(e) {
	if (typeof e != "string") throw Error("db:ticket expects a SQL string.");
	if (!un.test(e)) throw Error("db:ticket only accepts queries on ticket tables.");
}
function _n(e) {
	return y("SELECT description FROM tickets WHERE uuid = ? LIMIT 1", [e])?.[0]?.description ?? null;
}
function vn(e) {
	hn.delete(e);
	let t = _n(e);
	t !== null && Pe(e, t);
}
function yn(e) {
	if (!e) return;
	let t = hn.get(e);
	t && clearTimeout(t), hn.set(e, setTimeout(() => vn(e), mn));
}
function bn() {
	for (let [e, t] of hn) {
		clearTimeout(t);
		let n = _n(e);
		n !== null && Pe(e, n);
	}
	hn.clear();
}
function xn(e, t = []) {
	gn(e), pn.test(e) ? He() : fn.test(e) && Ve(t[0]);
	let n = y(e, t);
	if (!dn.test(e) && !fn.test(e)) {
		let e = t[0];
		yn(e), e && Be(e);
	}
	return n;
}
function Sn() {
	n.handle("db:ticket", (e, t, n = []) => xn(t, n));
}
//#endregion
//#region electron/project/projectManager.ts
var Cn = "", wn = null, Tn = null;
function En(e, t) {
	Cn = e, Tn = t ?? null, h.mkdirSync(Dn(), { recursive: !0 });
}
function Dn() {
	return a.join(Cn, "projects");
}
function On(e) {
	return a.join(Dn(), e);
}
function kn(e) {
	return a.join(On(e), "overhead.db");
}
function An(e) {
	return a.join(On(e), "vault");
}
function jn() {
	return wn;
}
function Mn(e) {
	let t = xe(e);
	if (!t) throw Error(`Project "${e}" is not registered.`);
	let n = An(e);
	return h.mkdirSync(n, { recursive: !0 }), je(kn(e)), Ie(n), cn(n, Vn), wn = t, ke(e), Tn?.(t), t;
}
async function Nn() {
	wn && (bn(), await ln(), Ne(), Re(), wn = null, Tn?.(null));
}
async function Pn(e) {
	return await Nn(), Mn(e);
}
function Fn() {
	let e = Oe();
	if (!e) return null;
	let t = xe(e);
	return t ? h.existsSync(On(e)) ? t : (console.warn(`Project directory missing for "${t.name}" — falling back to the launcher.`), Ae(), null) : (Ae(), null);
}
function In(e, t) {
	let n = Se(e, t);
	try {
		h.mkdirSync(An(n.uuid), { recursive: !0 });
	} catch (e) {
		throw we(n.uuid), e;
	}
	return n;
}
async function Ln(e) {
	wn?.uuid === e && await Nn(), we(e), h.rmSync(On(e), {
		recursive: !0,
		force: !0
	});
}
function Rn() {
	let e = be();
	return e[0] ? e[0] : In("Overhead", "OVH");
}
var zn = null;
function Bn(e) {
	zn = e;
}
function Vn(e) {
	zn?.(e);
}
//#endregion
//#region electron/ipc/generalAPI.ts
var Hn = /\b(tickets|ticket_history|ticket_relations|pending_sync)\b/i;
function Un() {
	n.handle("db:query", (e, t, n = []) => {
		if (typeof t != "string") throw Error("db:query expects a SQL string.");
		if (Hn.test(t)) throw Error("db:query cannot access ticket tables — use db:ticket instead.");
		return y(t, n);
	});
}
//#endregion
//#region electron/ipc/historyAPI.ts
function Wn() {
	n.handle("db:history", (e, t) => {
		if (typeof t != "string") throw Error("db:history expects a ticket UUID string.");
		return Fe(t);
	}), n.handle("db:history:flush", (e, t) => {
		if (typeof t != "string") throw Error("db:history:flush expects a ticket UUID string.");
		vn(t);
	});
}
//#endregion
//#region electron/ipc/relationsAPI.ts
function Gn(e, t) {
	if (typeof e != "string" || !e) throw Error(`db:relation: ${t} must be a non-empty string.`);
	return e;
}
function Kn(e, t) {
	if (typeof e != "string") throw Error("db:relation: op must be a string.");
	if (typeof t != "object" || !t) throw Error("db:relation: payload must be an object.");
	if (e === "add") {
		let { type: e, node_a: n, node_b: r } = t;
		if (Gn(e, "type"), Gn(n, "node_a"), Gn(r, "node_b"), e !== "relates-to" && e !== "blocked-by") throw Error(`db:relation: unknown type "${e}".`);
		if (n === r) throw Error("db:relation: a ticket cannot relate to itself.");
		let [i, a] = e === "relates-to" && n > r ? [r, n] : [n, r], o = m();
		return y("INSERT INTO ticket_relations (uuid, node_a, node_b, type) VALUES (?, ?, ?, ?)", [
			o,
			i,
			a,
			e
		]), {
			uuid: o,
			node_a: i,
			node_b: a,
			type: e
		};
	}
	if (e === "remove") {
		let { uuid: e } = t;
		Gn(e, "uuid"), y("DELETE FROM ticket_relations WHERE uuid = ?", [e]);
		return;
	}
	if (e === "list") {
		let { ticketUuid: e } = t;
		return Gn(e, "ticketUuid"), y("SELECT uuid, node_a, node_b, type FROM ticket_relations WHERE node_a = ? OR node_b = ?", [e, e]);
	}
	if (e === "listAll") return y("SELECT uuid, node_a, node_b, type FROM ticket_relations", []);
	throw Error(`db:relation: unknown op "${e}".`);
}
function qn() {
	n.handle("db:relation", (e, t, n) => Kn(t, n));
}
//#endregion
//#region electron/ipc/graphAPI.ts
function O(e, t) {
	if (typeof e != "string" || !e) throw Error(`db:graph: ${t} must be a non-empty string.`);
	return e;
}
function Jn(e, t) {
	if (typeof e != "number") throw Error(`db:graph: ${t} must be a number.`);
	return e;
}
function Yn() {
	n.handle("db:graph", (e, t, n) => {
		if (typeof t != "string") throw Error("db:graph: op must be a string.");
		if (typeof n != "object" || !n) throw Error("db:graph: payload must be an object.");
		let r = n;
		if (t === "view:list") return y("SELECT uuid, name, created_at FROM graph_views ORDER BY created_at ASC", []);
		if (t === "view:create") {
			let e = O(r.name, "name"), t = m(), n = Date.now();
			return y("INSERT INTO graph_views (uuid, name, created_at) VALUES (?, ?, ?)", [
				t,
				e,
				n
			]), {
				uuid: t,
				name: e,
				created_at: n
			};
		}
		if (t === "view:rename") {
			let e = O(r.uuid, "uuid");
			y("UPDATE graph_views SET name = ? WHERE uuid = ?", [O(r.name, "name"), e]);
			return;
		}
		if (t === "view:delete") {
			y("DELETE FROM graph_views WHERE uuid = ?", [O(r.uuid, "uuid")]);
			return;
		}
		if (t === "node:list") return y("SELECT ticket_uuid, x, y FROM graph_view_nodes WHERE view_uuid = ?", [O(r.viewUuid, "viewUuid")]);
		if (t === "node:upsert") {
			y("INSERT INTO graph_view_nodes (view_uuid, ticket_uuid, x, y)\n         VALUES (?, ?, ?, ?)\n         ON CONFLICT(view_uuid, ticket_uuid) DO UPDATE SET x = excluded.x, y = excluded.y", [
				O(r.viewUuid, "viewUuid"),
				O(r.ticketUuid, "ticketUuid"),
				Jn(r.x, "x"),
				Jn(r.y, "y")
			]);
			return;
		}
		if (t === "node:remove") {
			y("DELETE FROM graph_view_nodes WHERE view_uuid = ? AND ticket_uuid = ?", [O(r.viewUuid, "viewUuid"), O(r.ticketUuid, "ticketUuid")]);
			return;
		}
		if (t === "edge:list") return y("SELECT uuid, source_uuid, target_uuid, source_handle, target_handle FROM graph_view_edges WHERE view_uuid = ?", [O(r.viewUuid, "viewUuid")]);
		if (t === "edge:create") {
			let e = O(r.viewUuid, "viewUuid"), t = O(r.sourceUuid, "sourceUuid"), n = O(r.targetUuid, "targetUuid"), i = typeof r.sourceHandle == "string" ? r.sourceHandle : null, a = typeof r.targetHandle == "string" ? r.targetHandle : null, o = m();
			return y("INSERT INTO graph_view_edges (uuid, view_uuid, source_uuid, target_uuid, source_handle, target_handle) VALUES (?, ?, ?, ?, ?, ?)", [
				o,
				e,
				t,
				n,
				i,
				a
			]), {
				uuid: o,
				source_uuid: t,
				target_uuid: n,
				source_handle: i,
				target_handle: a
			};
		}
		if (t === "edge:remove") {
			y("DELETE FROM graph_view_edges WHERE uuid = ?", [O(r.uuid, "uuid")]);
			return;
		}
		throw Error(`db:graph: unknown op "${t}".`);
	});
}
//#endregion
//#region electron/ipc/projectAPI.ts
function Xn(t) {
	for (let n of e.getAllWindows()) n.webContents.send("project:changed", t);
}
function Zn() {
	n.handle("project:list", () => be()), n.handle("project:active", () => jn()), n.handle("project:create", (e, t, n) => {
		if (typeof t != "string" || typeof n != "string") throw Error("project:create expects (name, prefix) strings.");
		return In(t, n);
	}), n.handle("project:rename", (e, t, n) => {
		if (typeof t != "string" || typeof n != "string") throw Error("project:rename expects (uuid, name) strings.");
		return Ce(t, n);
	}), n.handle("project:delete", async (e, t) => {
		if (typeof t != "string") throw Error("project:delete expects a uuid string.");
		return await Ln(t), { uuid: t };
	}), n.handle("project:switch", async (e, t) => {
		if (typeof t != "string") throw Error("project:switch expects a uuid string.");
		return Pn(t);
	});
}
//#endregion
//#region electron/ipc/notify.ts
function Qn(t) {
	for (let n of e.getAllWindows()) n.webContents.send("vault:ticket-updated", t);
}
function k() {
	for (let t of e.getAllWindows()) t.webContents.send("graph:updated");
}
function $n(e) {
	let t = p(32).toString("hex");
	return oe(o(e, "bridge.token"), t, {
		encoding: "utf8",
		mode: 384
	}), t;
}
//#endregion
//#region electron/bridge/gate.ts
function er(e, t) {
	t.caller;
}
//#endregion
//#region node_modules/zod/v4/core/core.js
var tr;
function A(e, t, n) {
	function r(n, r) {
		if (n._zod || Object.defineProperty(n, "_zod", {
			value: {
				def: r,
				constr: o,
				traits: /* @__PURE__ */ new Set()
			},
			enumerable: !1
		}), n._zod.traits.has(e)) return;
		n._zod.traits.add(e), t(n, r);
		let i = o.prototype, a = Object.keys(i);
		for (let e = 0; e < a.length; e++) {
			let t = a[e];
			t in n || (n[t] = i[t].bind(n));
		}
	}
	let i = n?.Parent ?? Object;
	class a extends i {}
	Object.defineProperty(a, "name", { value: e });
	function o(e) {
		var t;
		let i = n?.Parent ? new a() : this;
		r(i, e), (t = i._zod).deferred ?? (t.deferred = []);
		for (let e of i._zod.deferred) e();
		return i;
	}
	return Object.defineProperty(o, "init", { value: r }), Object.defineProperty(o, Symbol.hasInstance, { value: (t) => n?.Parent && t instanceof n.Parent ? !0 : t?._zod?.traits?.has(e) }), Object.defineProperty(o, "name", { value: e }), o;
}
var j = class extends Error {
	constructor() {
		super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
	}
}, nr = class extends Error {
	constructor(e) {
		super(`Encountered unidirectional transform during encode: ${e}`), this.name = "ZodEncodeError";
	}
};
(tr = globalThis).__zod_globalConfig ?? (tr.__zod_globalConfig = {});
var rr = globalThis.__zod_globalConfig;
function M(e) {
	return e && Object.assign(rr, e), rr;
}
//#endregion
//#region node_modules/zod/v4/core/util.js
function ir(e) {
	let t = Object.values(e).filter((e) => typeof e == "number");
	return Object.entries(e).filter(([e, n]) => t.indexOf(+e) === -1).map(([e, t]) => t);
}
function ar(e, t) {
	return typeof t == "bigint" ? t.toString() : t;
}
function or(e) {
	return { get value() {
		{
			let t = e();
			return Object.defineProperty(this, "value", { value: t }), t;
		}
		throw Error("cached value already set");
	} };
}
function sr(e) {
	return e == null;
}
function cr(e) {
	let t = +!!e.startsWith("^"), n = e.endsWith("$") ? e.length - 1 : e.length;
	return e.slice(t, n);
}
function lr(e, t) {
	let n = e / t, r = Math.round(n), i = 2 ** -52 * Math.max(Math.abs(n), 1);
	return Math.abs(n - r) < i ? 0 : n - r;
}
var ur = /* @__PURE__ */ Symbol("evaluating");
function N(e, t, n) {
	let r;
	Object.defineProperty(e, t, {
		get() {
			if (r !== ur) return r === void 0 && (r = ur, r = n()), r;
		},
		set(n) {
			Object.defineProperty(e, t, { value: n });
		},
		configurable: !0
	});
}
function P(e, t, n) {
	Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
}
function F(...e) {
	let t = {};
	for (let n of e) Object.assign(t, Object.getOwnPropertyDescriptors(n));
	return Object.defineProperties({}, t);
}
function dr(e) {
	return JSON.stringify(e);
}
function fr(e) {
	return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var pr = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {};
function mr(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
var hr = /* @__PURE__ */ or(() => {
	if (rr.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
	try {
		return Function(""), !0;
	} catch {
		return !1;
	}
});
function gr(e) {
	if (mr(e) === !1) return !1;
	let t = e.constructor;
	if (t === void 0 || typeof t != "function") return !0;
	let n = t.prototype;
	return !(mr(n) === !1 || Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") === !1);
}
function _r(e) {
	return gr(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
var vr = /* @__PURE__ */ new Set([
	"string",
	"number",
	"symbol"
]);
function yr(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function I(e, t, n) {
	let r = new e._zod.constr(t ?? e._zod.def);
	return (!t || n?.parent) && (r._zod.parent = e), r;
}
function L(e) {
	let t = e;
	if (!t) return {};
	if (typeof t == "string") return { error: () => t };
	if (t?.message !== void 0) {
		if (t?.error !== void 0) throw Error("Cannot specify both `message` and `error` params");
		t.error = t.message;
	}
	return delete t.message, typeof t.error == "string" ? {
		...t,
		error: () => t.error
	} : t;
}
function br(e) {
	return Object.keys(e).filter((t) => e[t]._zod.optin === "optional" && e[t]._zod.optout === "optional");
}
var xr = {
	safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function Sr(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".pick() cannot be used on object schemas containing refinements");
	return I(e, F(e._zod.def, {
		get shape() {
			let e = {};
			for (let r in t) {
				if (!(r in n.shape)) throw Error(`Unrecognized key: "${r}"`);
				t[r] && (e[r] = n.shape[r]);
			}
			return P(this, "shape", e), e;
		},
		checks: []
	}));
}
function Cr(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".omit() cannot be used on object schemas containing refinements");
	return I(e, F(e._zod.def, {
		get shape() {
			let r = { ...e._zod.def.shape };
			for (let e in t) {
				if (!(e in n.shape)) throw Error(`Unrecognized key: "${e}"`);
				t[e] && delete r[e];
			}
			return P(this, "shape", r), r;
		},
		checks: []
	}));
}
function wr(e, t) {
	if (!gr(t)) throw Error("Invalid input to extend: expected a plain object");
	let n = e._zod.def.checks;
	if (n && n.length > 0) {
		let n = e._zod.def.shape;
		for (let e in t) if (Object.getOwnPropertyDescriptor(n, e) !== void 0) throw Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return I(e, F(e._zod.def, { get shape() {
		let n = {
			...e._zod.def.shape,
			...t
		};
		return P(this, "shape", n), n;
	} }));
}
function Tr(e, t) {
	if (!gr(t)) throw Error("Invalid input to safeExtend: expected a plain object");
	return I(e, F(e._zod.def, { get shape() {
		let n = {
			...e._zod.def.shape,
			...t
		};
		return P(this, "shape", n), n;
	} }));
}
function Er(e, t) {
	if (e._zod.def.checks?.length) throw Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return I(e, F(e._zod.def, {
		get shape() {
			let n = {
				...e._zod.def.shape,
				...t._zod.def.shape
			};
			return P(this, "shape", n), n;
		},
		get catchall() {
			return t._zod.def.catchall;
		},
		checks: t._zod.def.checks ?? []
	}));
}
function Dr(e, t, n) {
	let r = t._zod.def.checks;
	if (r && r.length > 0) throw Error(".partial() cannot be used on object schemas containing refinements");
	return I(t, F(t._zod.def, {
		get shape() {
			let r = t._zod.def.shape, i = { ...r };
			if (n) for (let t in n) {
				if (!(t in r)) throw Error(`Unrecognized key: "${t}"`);
				n[t] && (i[t] = e ? new e({
					type: "optional",
					innerType: r[t]
				}) : r[t]);
			}
			else for (let t in r) i[t] = e ? new e({
				type: "optional",
				innerType: r[t]
			}) : r[t];
			return P(this, "shape", i), i;
		},
		checks: []
	}));
}
function Or(e, t, n) {
	return I(t, F(t._zod.def, { get shape() {
		let r = t._zod.def.shape, i = { ...r };
		if (n) for (let t in n) {
			if (!(t in i)) throw Error(`Unrecognized key: "${t}"`);
			n[t] && (i[t] = new e({
				type: "nonoptional",
				innerType: r[t]
			}));
		}
		else for (let t in r) i[t] = new e({
			type: "nonoptional",
			innerType: r[t]
		});
		return P(this, "shape", i), i;
	} }));
}
function R(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
	return !1;
}
function kr(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0;
	return !1;
}
function Ar(e, t) {
	return t.map((t) => {
		var n;
		return (n = t).path ?? (n.path = []), t.path.unshift(e), t;
	});
}
function jr(e) {
	return typeof e == "string" ? e : e?.message;
}
function z(e, t, n) {
	let r = e.message ? e.message : jr(e.inst?._zod.def?.error?.(e)) ?? jr(t?.error?.(e)) ?? jr(n.customError?.(e)) ?? jr(n.localeError?.(e)) ?? "Invalid input", { inst: i, continue: a, input: o, ...s } = e;
	return s.path ??= [], s.message = r, t?.reportInput && (s.input = o), s;
}
function Mr(e) {
	return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function Nr(...e) {
	let [t, n, r] = e;
	return typeof t == "string" ? {
		message: t,
		code: "custom",
		input: n,
		inst: r
	} : { ...t };
}
//#endregion
//#region node_modules/zod/v4/core/errors.js
var Pr = (e, t) => {
	e.name = "$ZodError", Object.defineProperty(e, "_zod", {
		value: e._zod,
		enumerable: !1
	}), Object.defineProperty(e, "issues", {
		value: t,
		enumerable: !1
	}), e.message = JSON.stringify(t, ar, 2), Object.defineProperty(e, "toString", {
		value: () => e.message,
		enumerable: !1
	});
}, Fr = A("$ZodError", Pr), Ir = A("$ZodError", Pr, { Parent: Error });
function Lr(e, t = (e) => e.message) {
	let n = {}, r = [];
	for (let i of e.issues) i.path.length > 0 ? (n[i.path[0]] = n[i.path[0]] || [], n[i.path[0]].push(t(i))) : r.push(t(i));
	return {
		formErrors: r,
		fieldErrors: n
	};
}
function Rr(e, t = (e) => e.message) {
	let n = { _errors: [] }, r = (e, i = []) => {
		for (let a of e.issues) if (a.code === "invalid_union" && a.errors.length) a.errors.map((e) => r({ issues: e }, [...i, ...a.path]));
		else if (a.code === "invalid_key") r({ issues: a.issues }, [...i, ...a.path]);
		else if (a.code === "invalid_element") r({ issues: a.issues }, [...i, ...a.path]);
		else {
			let e = [...i, ...a.path];
			if (e.length === 0) n._errors.push(t(a));
			else {
				let r = n, i = 0;
				for (; i < e.length;) {
					let n = e[i];
					i === e.length - 1 ? (r[n] = r[n] || { _errors: [] }, r[n]._errors.push(t(a))) : r[n] = r[n] || { _errors: [] }, r = r[n], i++;
				}
			}
		}
	};
	return r(e), n;
}
//#endregion
//#region node_modules/zod/v4/core/parse.js
var zr = (e) => (t, n, r, i) => {
	let a = r ? {
		...r,
		async: !1
	} : { async: !1 }, o = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (o instanceof Promise) throw new j();
	if (o.issues.length) {
		let t = new (i?.Err ?? e)(o.issues.map((e) => z(e, a, M())));
		throw pr(t, i?.callee), t;
	}
	return o.value;
}, Br = (e) => async (t, n, r, i) => {
	let a = r ? {
		...r,
		async: !0
	} : { async: !0 }, o = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (o instanceof Promise && (o = await o), o.issues.length) {
		let t = new (i?.Err ?? e)(o.issues.map((e) => z(e, a, M())));
		throw pr(t, i?.callee), t;
	}
	return o.value;
}, Vr = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		async: !1
	} : { async: !1 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	if (a instanceof Promise) throw new j();
	return a.issues.length ? {
		success: !1,
		error: new (e ?? Fr)(a.issues.map((e) => z(e, i, M())))
	} : {
		success: !0,
		data: a.value
	};
}, Hr = /* @__PURE__ */ Vr(Ir), Ur = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		async: !0
	} : { async: !0 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	return a instanceof Promise && (a = await a), a.issues.length ? {
		success: !1,
		error: new e(a.issues.map((e) => z(e, i, M())))
	} : {
		success: !0,
		data: a.value
	};
}, Wr = /* @__PURE__ */ Ur(Ir), Gr = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return zr(e)(t, n, i);
}, Kr = (e) => (t, n, r) => zr(e)(t, n, r), qr = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return Br(e)(t, n, i);
}, Jr = (e) => async (t, n, r) => Br(e)(t, n, r), Yr = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return Vr(e)(t, n, i);
}, Xr = (e) => (t, n, r) => Vr(e)(t, n, r), Zr = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return Ur(e)(t, n, i);
}, Qr = (e) => async (t, n, r) => Ur(e)(t, n, r), $r = /^[cC][0-9a-z]{6,}$/, ei = /^[0-9a-z]+$/, ti = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, ni = /^[0-9a-vA-V]{20}$/, ri = /^[A-Za-z0-9]{27}$/, ii = /^[a-zA-Z0-9_-]{21}$/, ai = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, oi = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, si = (e) => e ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, ci = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, li = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";
function ui() {
	return new RegExp(li, "u");
}
var di = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, fi = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, pi = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, mi = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, hi = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, gi = /^[A-Za-z0-9_-]*$/, _i = /^https?$/, vi = /^\+[1-9]\d{6,14}$/, yi = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))", bi = /* @__PURE__ */ RegExp(`^${yi}$`);
function xi(e) {
	let t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
	return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function Si(e) {
	return RegExp(`^${xi(e)}$`);
}
function Ci(e) {
	let t = xi({ precision: e.precision }), n = ["Z"];
	e.local && n.push(""), e.offset && n.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
	let r = `${t}(?:${n.join("|")})`;
	return RegExp(`^${yi}T(?:${r})$`);
}
var wi = (e) => {
	let t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ""}}` : "[\\s\\S]*";
	return RegExp(`^${t}$`);
}, Ti = /^-?\d+$/, Ei = /^-?\d+(?:\.\d+)?$/, Di = /^(?:true|false)$/i, Oi = /^[^A-Z]*$/, ki = /^[^a-z]*$/, B = /* @__PURE__ */ A("$ZodCheck", (e, t) => {
	var n;
	e._zod ??= {}, e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), Ai = {
	number: "number",
	bigint: "bigint",
	object: "date"
}, ji = /* @__PURE__ */ A("$ZodCheckLessThan", (e, t) => {
	B.init(e, t);
	let n = Ai[typeof t.value];
	e._zod.onattach.push((e) => {
		let n = e._zod.bag, r = (t.inclusive ? n.maximum : n.exclusiveMaximum) ?? Infinity;
		t.value < r && (t.inclusive ? n.maximum = t.value : n.exclusiveMaximum = t.value);
	}), e._zod.check = (r) => {
		(t.inclusive ? r.value <= t.value : r.value < t.value) || r.issues.push({
			origin: n,
			code: "too_big",
			maximum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), Mi = /* @__PURE__ */ A("$ZodCheckGreaterThan", (e, t) => {
	B.init(e, t);
	let n = Ai[typeof t.value];
	e._zod.onattach.push((e) => {
		let n = e._zod.bag, r = (t.inclusive ? n.minimum : n.exclusiveMinimum) ?? -Infinity;
		t.value > r && (t.inclusive ? n.minimum = t.value : n.exclusiveMinimum = t.value);
	}), e._zod.check = (r) => {
		(t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
			origin: n,
			code: "too_small",
			minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), Ni = /* @__PURE__ */ A("$ZodCheckMultipleOf", (e, t) => {
	B.init(e, t), e._zod.onattach.push((e) => {
		var n;
		(n = e._zod.bag).multipleOf ?? (n.multipleOf = t.value);
	}), e._zod.check = (n) => {
		if (typeof n.value != typeof t.value) throw Error("Cannot mix number and bigint in multiple_of check.");
		(typeof n.value == "bigint" ? n.value % t.value === BigInt(0) : lr(n.value, t.value) === 0) || n.issues.push({
			origin: typeof n.value,
			code: "not_multiple_of",
			divisor: t.value,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Pi = /* @__PURE__ */ A("$ZodCheckNumberFormat", (e, t) => {
	B.init(e, t), t.format = t.format || "float64";
	let n = t.format?.includes("int"), r = n ? "int" : "number", [i, a] = xr[t.format];
	e._zod.onattach.push((e) => {
		let r = e._zod.bag;
		r.format = t.format, r.minimum = i, r.maximum = a, n && (r.pattern = Ti);
	}), e._zod.check = (o) => {
		let s = o.value;
		if (n) {
			if (!Number.isInteger(s)) {
				o.issues.push({
					expected: r,
					format: t.format,
					code: "invalid_type",
					continue: !1,
					input: s,
					inst: e
				});
				return;
			}
			if (!Number.isSafeInteger(s)) {
				s > 0 ? o.issues.push({
					input: s,
					code: "too_big",
					maximum: 2 ** 53 - 1,
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					inclusive: !0,
					continue: !t.abort
				}) : o.issues.push({
					input: s,
					code: "too_small",
					minimum: -(2 ** 53 - 1),
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					inclusive: !0,
					continue: !t.abort
				});
				return;
			}
		}
		s < i && o.issues.push({
			origin: "number",
			input: s,
			code: "too_small",
			minimum: i,
			inclusive: !0,
			inst: e,
			continue: !t.abort
		}), s > a && o.issues.push({
			origin: "number",
			input: s,
			code: "too_big",
			maximum: a,
			inclusive: !0,
			inst: e,
			continue: !t.abort
		});
	};
}), Fi = /* @__PURE__ */ A("$ZodCheckMaxLength", (e, t) => {
	var n;
	B.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !sr(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.maximum ?? Infinity;
		t.maximum < n && (e._zod.bag.maximum = t.maximum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length <= t.maximum) return;
		let i = Mr(r);
		n.issues.push({
			origin: i,
			code: "too_big",
			maximum: t.maximum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), Ii = /* @__PURE__ */ A("$ZodCheckMinLength", (e, t) => {
	var n;
	B.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !sr(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.minimum ?? -Infinity;
		t.minimum > n && (e._zod.bag.minimum = t.minimum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length >= t.minimum) return;
		let i = Mr(r);
		n.issues.push({
			origin: i,
			code: "too_small",
			minimum: t.minimum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), Li = /* @__PURE__ */ A("$ZodCheckLengthEquals", (e, t) => {
	var n;
	B.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !sr(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag;
		n.minimum = t.length, n.maximum = t.length, n.length = t.length;
	}), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if (i === t.length) return;
		let a = Mr(r), o = i > t.length;
		n.issues.push({
			origin: a,
			...o ? {
				code: "too_big",
				maximum: t.length
			} : {
				code: "too_small",
				minimum: t.length
			},
			inclusive: !0,
			exact: !0,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Ri = /* @__PURE__ */ A("$ZodCheckStringFormat", (e, t) => {
	var n, r;
	B.init(e, t), e._zod.onattach.push((e) => {
		let n = e._zod.bag;
		n.format = t.format, t.pattern && (n.patterns ??= /* @__PURE__ */ new Set(), n.patterns.add(t.pattern));
	}), t.pattern ? (n = e._zod).check ?? (n.check = (n) => {
		t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: t.format,
			input: n.value,
			...t.pattern ? { pattern: t.pattern.toString() } : {},
			inst: e,
			continue: !t.abort
		});
	}) : (r = e._zod).check ?? (r.check = () => {});
}), zi = /* @__PURE__ */ A("$ZodCheckRegex", (e, t) => {
	Ri.init(e, t), e._zod.check = (n) => {
		t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: n.value,
			pattern: t.pattern.toString(),
			inst: e,
			continue: !t.abort
		});
	};
}), Bi = /* @__PURE__ */ A("$ZodCheckLowerCase", (e, t) => {
	t.pattern ??= Oi, Ri.init(e, t);
}), Vi = /* @__PURE__ */ A("$ZodCheckUpperCase", (e, t) => {
	t.pattern ??= ki, Ri.init(e, t);
}), Hi = /* @__PURE__ */ A("$ZodCheckIncludes", (e, t) => {
	B.init(e, t);
	let n = yr(t.includes), r = new RegExp(typeof t.position == "number" ? `^.{${t.position}}${n}` : n);
	t.pattern = r, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(r);
	}), e._zod.check = (n) => {
		n.value.includes(t.includes, t.position) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: t.includes,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Ui = /* @__PURE__ */ A("$ZodCheckStartsWith", (e, t) => {
	B.init(e, t);
	let n = RegExp(`^${yr(t.prefix)}.*`);
	t.pattern ??= n, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(n);
	}), e._zod.check = (n) => {
		n.value.startsWith(t.prefix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: t.prefix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Wi = /* @__PURE__ */ A("$ZodCheckEndsWith", (e, t) => {
	B.init(e, t);
	let n = RegExp(`.*${yr(t.suffix)}$`);
	t.pattern ??= n, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(n);
	}), e._zod.check = (n) => {
		n.value.endsWith(t.suffix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: t.suffix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Gi = /* @__PURE__ */ A("$ZodCheckOverwrite", (e, t) => {
	B.init(e, t), e._zod.check = (e) => {
		e.value = t.tx(e.value);
	};
}), Ki = class {
	constructor(e = []) {
		this.content = [], this.indent = 0, this && (this.args = e);
	}
	indented(e) {
		this.indent += 1, e(this), --this.indent;
	}
	write(e) {
		if (typeof e == "function") {
			e(this, { execution: "sync" }), e(this, { execution: "async" });
			return;
		}
		let t = e.split("\n").filter((e) => e), n = Math.min(...t.map((e) => e.length - e.trimStart().length)), r = t.map((e) => e.slice(n)).map((e) => " ".repeat(this.indent * 2) + e);
		for (let e of r) this.content.push(e);
	}
	compile() {
		let e = Function, t = this?.args, n = [...(this?.content ?? [""]).map((e) => `  ${e}`)];
		return new e(...t, n.join("\n"));
	}
}, qi = {
	major: 4,
	minor: 4,
	patch: 3
}, V = /* @__PURE__ */ A("$ZodType", (e, t) => {
	var n;
	e ??= {}, e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = qi;
	let r = [...e._zod.def.checks ?? []];
	e._zod.traits.has("$ZodCheck") && r.unshift(e);
	for (let t of r) for (let n of t._zod.onattach) n(e);
	if (r.length === 0) (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
		e._zod.run = e._zod.parse;
	});
	else {
		let t = (e, t, n) => {
			let r = R(e), i;
			for (let a of t) {
				if (a._zod.def.when) {
					if (kr(e) || !a._zod.def.when(e)) continue;
				} else if (r) continue;
				let t = e.issues.length, o = a._zod.check(e);
				if (o instanceof Promise && n?.async === !1) throw new j();
				if (i || o instanceof Promise) i = (i ?? Promise.resolve()).then(async () => {
					await o, e.issues.length !== t && (r ||= R(e, t));
				});
				else {
					if (e.issues.length === t) continue;
					r ||= R(e, t);
				}
			}
			return i ? i.then(() => e) : e;
		}, n = (n, i, a) => {
			if (R(n)) return n.aborted = !0, n;
			let o = t(i, r, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new j();
				return o.then((t) => e._zod.parse(t, a));
			}
			return e._zod.parse(o, a);
		};
		e._zod.run = (i, a) => {
			if (a.skipChecks) return e._zod.parse(i, a);
			if (a.direction === "backward") {
				let t = e._zod.parse({
					value: i.value,
					issues: []
				}, {
					...a,
					skipChecks: !0
				});
				return t instanceof Promise ? t.then((e) => n(e, i, a)) : n(t, i, a);
			}
			let o = e._zod.parse(i, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new j();
				return o.then((e) => t(e, r, a));
			}
			return t(o, r, a);
		};
	}
	N(e, "~standard", () => ({
		validate: (t) => {
			try {
				let n = Hr(e, t);
				return n.success ? { value: n.data } : { issues: n.error?.issues };
			} catch {
				return Wr(e, t).then((e) => e.success ? { value: e.data } : { issues: e.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
}), Ji = /* @__PURE__ */ A("$ZodString", (e, t) => {
	V.init(e, t), e._zod.pattern = [...e?._zod.bag?.patterns ?? []].pop() ?? wi(e._zod.bag), e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = String(n.value);
		} catch {}
		return typeof n.value == "string" || n.issues.push({
			expected: "string",
			code: "invalid_type",
			input: n.value,
			inst: e
		}), n;
	};
}), H = /* @__PURE__ */ A("$ZodStringFormat", (e, t) => {
	Ri.init(e, t), Ji.init(e, t);
}), Yi = /* @__PURE__ */ A("$ZodGUID", (e, t) => {
	t.pattern ??= oi, H.init(e, t);
}), Xi = /* @__PURE__ */ A("$ZodUUID", (e, t) => {
	if (t.version) {
		let e = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[t.version];
		if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`);
		t.pattern ??= si(e);
	} else t.pattern ??= si();
	H.init(e, t);
}), Zi = /* @__PURE__ */ A("$ZodEmail", (e, t) => {
	t.pattern ??= ci, H.init(e, t);
}), Qi = /* @__PURE__ */ A("$ZodURL", (e, t) => {
	H.init(e, t), e._zod.check = (n) => {
		try {
			let r = n.value.trim();
			if (!t.normalize && t.protocol?.source === _i.source && !/^https?:\/\//i.test(r)) {
				n.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid URL format",
					input: n.value,
					inst: e,
					continue: !t.abort
				});
				return;
			}
			let i = new URL(r);
			t.hostname && (t.hostname.lastIndex = 0, t.hostname.test(i.hostname) || n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: t.hostname.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			})), t.protocol && (t.protocol.lastIndex = 0, t.protocol.test(i.protocol.endsWith(":") ? i.protocol.slice(0, -1) : i.protocol) || n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: t.protocol.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			})), t.normalize ? n.value = i.href : n.value = r;
			return;
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "url",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
}), $i = /* @__PURE__ */ A("$ZodEmoji", (e, t) => {
	t.pattern ??= ui(), H.init(e, t);
}), ea = /* @__PURE__ */ A("$ZodNanoID", (e, t) => {
	t.pattern ??= ii, H.init(e, t);
}), ta = /* @__PURE__ */ A("$ZodCUID", (e, t) => {
	t.pattern ??= $r, H.init(e, t);
}), na = /* @__PURE__ */ A("$ZodCUID2", (e, t) => {
	t.pattern ??= ei, H.init(e, t);
}), ra = /* @__PURE__ */ A("$ZodULID", (e, t) => {
	t.pattern ??= ti, H.init(e, t);
}), ia = /* @__PURE__ */ A("$ZodXID", (e, t) => {
	t.pattern ??= ni, H.init(e, t);
}), aa = /* @__PURE__ */ A("$ZodKSUID", (e, t) => {
	t.pattern ??= ri, H.init(e, t);
}), oa = /* @__PURE__ */ A("$ZodISODateTime", (e, t) => {
	t.pattern ??= Ci(t), H.init(e, t);
}), sa = /* @__PURE__ */ A("$ZodISODate", (e, t) => {
	t.pattern ??= bi, H.init(e, t);
}), ca = /* @__PURE__ */ A("$ZodISOTime", (e, t) => {
	t.pattern ??= Si(t), H.init(e, t);
}), la = /* @__PURE__ */ A("$ZodISODuration", (e, t) => {
	t.pattern ??= ai, H.init(e, t);
}), ua = /* @__PURE__ */ A("$ZodIPv4", (e, t) => {
	t.pattern ??= di, H.init(e, t), e._zod.bag.format = "ipv4";
}), da = /* @__PURE__ */ A("$ZodIPv6", (e, t) => {
	t.pattern ??= fi, H.init(e, t), e._zod.bag.format = "ipv6", e._zod.check = (n) => {
		try {
			new URL(`http://[${n.value}]`);
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
}), fa = /* @__PURE__ */ A("$ZodCIDRv4", (e, t) => {
	t.pattern ??= pi, H.init(e, t);
}), pa = /* @__PURE__ */ A("$ZodCIDRv6", (e, t) => {
	t.pattern ??= mi, H.init(e, t), e._zod.check = (n) => {
		let r = n.value.split("/");
		try {
			if (r.length !== 2) throw Error();
			let [e, t] = r;
			if (!t) throw Error();
			let n = Number(t);
			if (`${n}` !== t || n < 0 || n > 128) throw Error();
			new URL(`http://[${e}]`);
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
});
function ma(e) {
	if (e === "") return !0;
	if (/\s/.test(e) || e.length % 4 != 0) return !1;
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}
var ha = /* @__PURE__ */ A("$ZodBase64", (e, t) => {
	t.pattern ??= hi, H.init(e, t), e._zod.bag.contentEncoding = "base64", e._zod.check = (n) => {
		ma(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
});
function ga(e) {
	if (!gi.test(e)) return !1;
	let t = e.replace(/[-_]/g, (e) => e === "-" ? "+" : "/");
	return ma(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
}
var _a = /* @__PURE__ */ A("$ZodBase64URL", (e, t) => {
	t.pattern ??= gi, H.init(e, t), e._zod.bag.contentEncoding = "base64url", e._zod.check = (n) => {
		ga(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), va = /* @__PURE__ */ A("$ZodE164", (e, t) => {
	t.pattern ??= vi, H.init(e, t);
});
function ya(e, t = null) {
	try {
		let n = e.split(".");
		if (n.length !== 3) return !1;
		let [r] = n;
		if (!r) return !1;
		let i = JSON.parse(atob(r));
		return !("typ" in i && i?.typ !== "JWT" || !i.alg || t && (!("alg" in i) || i.alg !== t));
	} catch {
		return !1;
	}
}
var ba = /* @__PURE__ */ A("$ZodJWT", (e, t) => {
	H.init(e, t), e._zod.check = (n) => {
		ya(n.value, t.alg) || n.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), xa = /* @__PURE__ */ A("$ZodNumber", (e, t) => {
	V.init(e, t), e._zod.pattern = e._zod.bag.pattern ?? Ei, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = Number(n.value);
		} catch {}
		let i = n.value;
		if (typeof i == "number" && !Number.isNaN(i) && Number.isFinite(i)) return n;
		let a = typeof i == "number" ? Number.isNaN(i) ? "NaN" : Number.isFinite(i) ? void 0 : "Infinity" : void 0;
		return n.issues.push({
			expected: "number",
			code: "invalid_type",
			input: i,
			inst: e,
			...a ? { received: a } : {}
		}), n;
	};
}), Sa = /* @__PURE__ */ A("$ZodNumberFormat", (e, t) => {
	Pi.init(e, t), xa.init(e, t);
}), Ca = /* @__PURE__ */ A("$ZodBoolean", (e, t) => {
	V.init(e, t), e._zod.pattern = Di, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = !!n.value;
		} catch {}
		let i = n.value;
		return typeof i == "boolean" || n.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
	};
}), wa = /* @__PURE__ */ A("$ZodUnknown", (e, t) => {
	V.init(e, t), e._zod.parse = (e) => e;
}), Ta = /* @__PURE__ */ A("$ZodNever", (e, t) => {
	V.init(e, t), e._zod.parse = (t, n) => (t.issues.push({
		expected: "never",
		code: "invalid_type",
		input: t.value,
		inst: e
	}), t);
});
function Ea(e, t, n) {
	e.issues.length && t.issues.push(...Ar(n, e.issues)), t.value[n] = e.value;
}
var Da = /* @__PURE__ */ A("$ZodArray", (e, t) => {
	V.init(e, t), e._zod.parse = (n, r) => {
		let i = n.value;
		if (!Array.isArray(i)) return n.issues.push({
			expected: "array",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
		n.value = Array(i.length);
		let a = [];
		for (let e = 0; e < i.length; e++) {
			let o = i[e], s = t.element._zod.run({
				value: o,
				issues: []
			}, r);
			s instanceof Promise ? a.push(s.then((t) => Ea(t, n, e))) : Ea(s, n, e);
		}
		return a.length ? Promise.all(a).then(() => n) : n;
	};
});
function Oa(e, t, n, r, i, a) {
	let o = n in r;
	if (e.issues.length) {
		if (i && a && !o) return;
		t.issues.push(...Ar(n, e.issues));
	}
	if (!o && !i) {
		e.issues.length || t.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [n]
		});
		return;
	}
	e.value === void 0 ? o && (t.value[n] = void 0) : t.value[n] = e.value;
}
function ka(e) {
	let t = Object.keys(e.shape);
	for (let n of t) if (!e.shape?.[n]?._zod?.traits?.has("$ZodType")) throw Error(`Invalid element at key "${n}": expected a Zod schema`);
	let n = br(e.shape);
	return {
		...e,
		keys: t,
		keySet: new Set(t),
		numKeys: t.length,
		optionalKeys: new Set(n)
	};
}
function Aa(e, t, n, r, i, a) {
	let o = [], s = i.keySet, c = i.catchall._zod, l = c.def.type, u = c.optin === "optional", d = c.optout === "optional";
	for (let i in t) {
		if (i === "__proto__" || s.has(i)) continue;
		if (l === "never") {
			o.push(i);
			continue;
		}
		let a = c.run({
			value: t[i],
			issues: []
		}, r);
		a instanceof Promise ? e.push(a.then((e) => Oa(e, n, i, t, u, d))) : Oa(a, n, i, t, u, d);
	}
	return o.length && n.issues.push({
		code: "unrecognized_keys",
		keys: o,
		input: t,
		inst: a
	}), e.length ? Promise.all(e).then(() => n) : n;
}
var ja = /* @__PURE__ */ A("$ZodObject", (e, t) => {
	if (V.init(e, t), !Object.getOwnPropertyDescriptor(t, "shape")?.get) {
		let e = t.shape;
		Object.defineProperty(t, "shape", { get: () => {
			let n = { ...e };
			return Object.defineProperty(t, "shape", { value: n }), n;
		} });
	}
	let n = or(() => ka(t));
	N(e._zod, "propValues", () => {
		let e = t.shape, n = {};
		for (let t in e) {
			let r = e[t]._zod;
			if (r.values) {
				n[t] ?? (n[t] = /* @__PURE__ */ new Set());
				for (let e of r.values) n[t].add(e);
			}
		}
		return n;
	});
	let r = mr, i = t.catchall, a;
	e._zod.parse = (t, o) => {
		a ??= n.value;
		let s = t.value;
		if (!r(s)) return t.issues.push({
			expected: "object",
			code: "invalid_type",
			input: s,
			inst: e
		}), t;
		t.value = {};
		let c = [], l = a.shape;
		for (let e of a.keys) {
			let n = l[e], r = n._zod.optin === "optional", i = n._zod.optout === "optional", a = n._zod.run({
				value: s[e],
				issues: []
			}, o);
			a instanceof Promise ? c.push(a.then((n) => Oa(n, t, e, s, r, i))) : Oa(a, t, e, s, r, i);
		}
		return i ? Aa(c, s, t, o, n.value, e) : c.length ? Promise.all(c).then(() => t) : t;
	};
}), Ma = /* @__PURE__ */ A("$ZodObjectJIT", (e, t) => {
	ja.init(e, t);
	let n = e._zod.parse, r = or(() => ka(t)), i = (e) => {
		let t = new Ki([
			"shape",
			"payload",
			"ctx"
		]), n = r.value, i = (e) => {
			let t = dr(e);
			return `shape[${t}]._zod.run({ value: input[${t}], issues: [] }, ctx)`;
		};
		t.write("const input = payload.value;");
		let a = Object.create(null), o = 0;
		for (let e of n.keys) a[e] = `key_${o++}`;
		t.write("const newResult = {};");
		for (let r of n.keys) {
			let n = a[r], o = dr(r), s = e[r], c = s?._zod?.optin === "optional", l = s?._zod?.optout === "optional";
			t.write(`const ${n} = ${i(r)};`), c && l ? t.write(`
        if (${n}.issues.length) {
          if (${o} in input) {
            payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${o}, ...iss.path] : [${o}]
            })));
          }
        }
        
        if (${n}.value === undefined) {
          if (${o} in input) {
            newResult[${o}] = undefined;
          }
        } else {
          newResult[${o}] = ${n}.value;
        }
        
      `) : c ? t.write(`
        if (${n}.issues.length) {
          payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${o}, ...iss.path] : [${o}]
          })));
        }
        
        if (${n}.value === undefined) {
          if (${o} in input) {
            newResult[${o}] = undefined;
          }
        } else {
          newResult[${o}] = ${n}.value;
        }
        
      `) : t.write(`
        const ${n}_present = ${o} in input;
        if (${n}.issues.length) {
          payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${o}, ...iss.path] : [${o}]
          })));
        }
        if (!${n}_present && !${n}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${o}]
          });
        }

        if (${n}_present) {
          if (${n}.value === undefined) {
            newResult[${o}] = undefined;
          } else {
            newResult[${o}] = ${n}.value;
          }
        }

      `);
		}
		t.write("payload.value = newResult;"), t.write("return payload;");
		let s = t.compile();
		return (t, n) => s(e, t, n);
	}, a, o = mr, s = !rr.jitless, c = s && hr.value, l = t.catchall, u;
	e._zod.parse = (d, f) => {
		u ??= r.value;
		let p = d.value;
		return o(p) ? s && c && f?.async === !1 && f.jitless !== !0 ? (a ||= i(t.shape), d = a(d, f), l ? Aa([], p, d, f, u, e) : d) : n(d, f) : (d.issues.push({
			expected: "object",
			code: "invalid_type",
			input: p,
			inst: e
		}), d);
	};
});
function Na(e, t, n, r) {
	for (let n of e) if (n.issues.length === 0) return t.value = n.value, t;
	let i = e.filter((e) => !R(e));
	return i.length === 1 ? (t.value = i[0].value, i[0]) : (t.issues.push({
		code: "invalid_union",
		input: t.value,
		inst: n,
		errors: e.map((e) => e.issues.map((e) => z(e, r, M())))
	}), t);
}
var Pa = /* @__PURE__ */ A("$ZodUnion", (e, t) => {
	V.init(e, t), N(e._zod, "optin", () => t.options.some((e) => e._zod.optin === "optional") ? "optional" : void 0), N(e._zod, "optout", () => t.options.some((e) => e._zod.optout === "optional") ? "optional" : void 0), N(e._zod, "values", () => {
		if (t.options.every((e) => e._zod.values)) return new Set(t.options.flatMap((e) => Array.from(e._zod.values)));
	}), N(e._zod, "pattern", () => {
		if (t.options.every((e) => e._zod.pattern)) {
			let e = t.options.map((e) => e._zod.pattern);
			return RegExp(`^(${e.map((e) => cr(e.source)).join("|")})$`);
		}
	});
	let n = t.options.length === 1 ? t.options[0]._zod.run : null;
	e._zod.parse = (r, i) => {
		if (n) return n(r, i);
		let a = !1, o = [];
		for (let e of t.options) {
			let t = e._zod.run({
				value: r.value,
				issues: []
			}, i);
			if (t instanceof Promise) o.push(t), a = !0;
			else {
				if (t.issues.length === 0) return t;
				o.push(t);
			}
		}
		return a ? Promise.all(o).then((t) => Na(t, r, e, i)) : Na(o, r, e, i);
	};
}), Fa = /* @__PURE__ */ A("$ZodIntersection", (e, t) => {
	V.init(e, t), e._zod.parse = (e, n) => {
		let r = e.value, i = t.left._zod.run({
			value: r,
			issues: []
		}, n), a = t.right._zod.run({
			value: r,
			issues: []
		}, n);
		return i instanceof Promise || a instanceof Promise ? Promise.all([i, a]).then(([t, n]) => La(e, t, n)) : La(e, i, a);
	};
});
function Ia(e, t) {
	if (e === t || e instanceof Date && t instanceof Date && +e == +t) return {
		valid: !0,
		data: e
	};
	if (gr(e) && gr(t)) {
		let n = Object.keys(t), r = Object.keys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		for (let n of r) {
			let r = Ia(e[n], t[n]);
			if (!r.valid) return {
				valid: !1,
				mergeErrorPath: [n, ...r.mergeErrorPath]
			};
			i[n] = r.data;
		}
		return {
			valid: !0,
			data: i
		};
	}
	if (Array.isArray(e) && Array.isArray(t)) {
		if (e.length !== t.length) return {
			valid: !1,
			mergeErrorPath: []
		};
		let n = [];
		for (let r = 0; r < e.length; r++) {
			let i = e[r], a = t[r], o = Ia(i, a);
			if (!o.valid) return {
				valid: !1,
				mergeErrorPath: [r, ...o.mergeErrorPath]
			};
			n.push(o.data);
		}
		return {
			valid: !0,
			data: n
		};
	}
	return {
		valid: !1,
		mergeErrorPath: []
	};
}
function La(e, t, n) {
	let r = /* @__PURE__ */ new Map(), i;
	for (let n of t.issues) if (n.code === "unrecognized_keys") {
		i ??= n;
		for (let e of n.keys) r.has(e) || r.set(e, {}), r.get(e).l = !0;
	} else e.issues.push(n);
	for (let t of n.issues) if (t.code === "unrecognized_keys") for (let e of t.keys) r.has(e) || r.set(e, {}), r.get(e).r = !0;
	else e.issues.push(t);
	let a = [...r].filter(([, e]) => e.l && e.r).map(([e]) => e);
	if (a.length && i && e.issues.push({
		...i,
		keys: a
	}), R(e)) return e;
	let o = Ia(t.value, n.value);
	if (!o.valid) throw Error(`Unmergable intersection. Error path: ${JSON.stringify(o.mergeErrorPath)}`);
	return e.value = o.data, e;
}
var Ra = /* @__PURE__ */ A("$ZodEnum", (e, t) => {
	V.init(e, t);
	let n = ir(t.entries), r = new Set(n);
	e._zod.values = r, e._zod.pattern = RegExp(`^(${n.filter((e) => vr.has(typeof e)).map((e) => typeof e == "string" ? yr(e) : e.toString()).join("|")})$`), e._zod.parse = (t, i) => {
		let a = t.value;
		return r.has(a) || t.issues.push({
			code: "invalid_value",
			values: n,
			input: a,
			inst: e
		}), t;
	};
}), za = /* @__PURE__ */ A("$ZodTransform", (e, t) => {
	V.init(e, t), e._zod.optin = "optional", e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new nr(e.constructor.name);
		let i = t.transform(n.value, n);
		if (r.async) return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => (n.value = e, n.fallback = !0, n));
		if (i instanceof Promise) throw new j();
		return n.value = i, n.fallback = !0, n;
	};
});
function Ba(e, t) {
	return t === void 0 && (e.issues.length || e.fallback) ? {
		issues: [],
		value: void 0
	} : e;
}
var Va = /* @__PURE__ */ A("$ZodOptional", (e, t) => {
	V.init(e, t), e._zod.optin = "optional", e._zod.optout = "optional", N(e._zod, "values", () => t.innerType._zod.values ? new Set([...t.innerType._zod.values, void 0]) : void 0), N(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${cr(e.source)})?$`) : void 0;
	}), e._zod.parse = (e, n) => {
		if (t.innerType._zod.optin === "optional") {
			let r = e.value, i = t.innerType._zod.run(e, n);
			return i instanceof Promise ? i.then((e) => Ba(e, r)) : Ba(i, r);
		}
		return e.value === void 0 ? e : t.innerType._zod.run(e, n);
	};
}), Ha = /* @__PURE__ */ A("$ZodExactOptional", (e, t) => {
	Va.init(e, t), N(e._zod, "values", () => t.innerType._zod.values), N(e._zod, "pattern", () => t.innerType._zod.pattern), e._zod.parse = (e, n) => t.innerType._zod.run(e, n);
}), Ua = /* @__PURE__ */ A("$ZodNullable", (e, t) => {
	V.init(e, t), N(e._zod, "optin", () => t.innerType._zod.optin), N(e._zod, "optout", () => t.innerType._zod.optout), N(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${cr(e.source)}|null)$`) : void 0;
	}), N(e._zod, "values", () => t.innerType._zod.values ? new Set([...t.innerType._zod.values, null]) : void 0), e._zod.parse = (e, n) => e.value === null ? e : t.innerType._zod.run(e, n);
}), Wa = /* @__PURE__ */ A("$ZodDefault", (e, t) => {
	V.init(e, t), e._zod.optin = "optional", N(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		if (e.value === void 0) return e.value = t.defaultValue, e;
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => Ga(e, t)) : Ga(r, t);
	};
});
function Ga(e, t) {
	return e.value === void 0 && (e.value = t.defaultValue), e;
}
var Ka = /* @__PURE__ */ A("$ZodPrefault", (e, t) => {
	V.init(e, t), e._zod.optin = "optional", N(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => (n.direction === "backward" || e.value === void 0 && (e.value = t.defaultValue), t.innerType._zod.run(e, n));
}), qa = /* @__PURE__ */ A("$ZodNonOptional", (e, t) => {
	V.init(e, t), N(e._zod, "values", () => {
		let e = t.innerType._zod.values;
		return e ? new Set([...e].filter((e) => e !== void 0)) : void 0;
	}), e._zod.parse = (n, r) => {
		let i = t.innerType._zod.run(n, r);
		return i instanceof Promise ? i.then((t) => Ja(t, e)) : Ja(i, e);
	};
});
function Ja(e, t) {
	return !e.issues.length && e.value === void 0 && e.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: e.value,
		inst: t
	}), e;
}
var Ya = /* @__PURE__ */ A("$ZodCatch", (e, t) => {
	V.init(e, t), e._zod.optin = "optional", N(e._zod, "optout", () => t.innerType._zod.optout), N(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((r) => (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => z(e, n, M())) },
			input: e.value
		}), e.issues = [], e.fallback = !0), e)) : (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => z(e, n, M())) },
			input: e.value
		}), e.issues = [], e.fallback = !0), e);
	};
}), Xa = /* @__PURE__ */ A("$ZodPipe", (e, t) => {
	V.init(e, t), N(e._zod, "values", () => t.in._zod.values), N(e._zod, "optin", () => t.in._zod.optin), N(e._zod, "optout", () => t.out._zod.optout), N(e._zod, "propValues", () => t.in._zod.propValues), e._zod.parse = (e, n) => {
		if (n.direction === "backward") {
			let r = t.out._zod.run(e, n);
			return r instanceof Promise ? r.then((e) => Za(e, t.in, n)) : Za(r, t.in, n);
		}
		let r = t.in._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => Za(e, t.out, n)) : Za(r, t.out, n);
	};
});
function Za(e, t, n) {
	return e.issues.length ? (e.aborted = !0, e) : t._zod.run({
		value: e.value,
		issues: e.issues,
		fallback: e.fallback
	}, n);
}
var Qa = /* @__PURE__ */ A("$ZodReadonly", (e, t) => {
	V.init(e, t), N(e._zod, "propValues", () => t.innerType._zod.propValues), N(e._zod, "values", () => t.innerType._zod.values), N(e._zod, "optin", () => t.innerType?._zod?.optin), N(e._zod, "optout", () => t.innerType?._zod?.optout), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then($a) : $a(r);
	};
});
function $a(e) {
	return e.value = Object.freeze(e.value), e;
}
var eo = /* @__PURE__ */ A("$ZodCustom", (e, t) => {
	B.init(e, t), V.init(e, t), e._zod.parse = (e, t) => e, e._zod.check = (n) => {
		let r = n.value, i = t.fn(r);
		if (i instanceof Promise) return i.then((t) => to(t, n, r, e));
		to(i, n, r, e);
	};
});
function to(e, t, n, r) {
	if (!e) {
		let e = {
			code: "custom",
			input: n,
			inst: r,
			path: [...r._zod.def.path ?? []],
			continue: !r._zod.def.abort
		};
		r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(Nr(e));
	}
}
//#endregion
//#region node_modules/zod/v4/core/registries.js
var no, ro = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
	}
	add(e, ...t) {
		let n = t[0];
		return this._map.set(e, n), n && typeof n == "object" && "id" in n && this._idmap.set(n.id, e), this;
	}
	clear() {
		return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
	}
	remove(e) {
		let t = this._map.get(e);
		return t && typeof t == "object" && "id" in t && this._idmap.delete(t.id), this._map.delete(e), this;
	}
	get(e) {
		let t = e._zod.parent;
		if (t) {
			let n = { ...this.get(t) ?? {} };
			delete n.id;
			let r = {
				...n,
				...this._map.get(e)
			};
			return Object.keys(r).length ? r : void 0;
		}
		return this._map.get(e);
	}
	has(e) {
		return this._map.has(e);
	}
};
function io() {
	return new ro();
}
(no = globalThis).__zod_globalRegistry ?? (no.__zod_globalRegistry = io());
var ao = globalThis.__zod_globalRegistry;
//#endregion
//#region node_modules/zod/v4/core/api.js
/* @__NO_SIDE_EFFECTS__ */
function oo(e, t) {
	return new e({
		type: "string",
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function so(e, t) {
	return new e({
		type: "string",
		format: "email",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function co(e, t) {
	return new e({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function lo(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function uo(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v4",
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function fo(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v6",
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function po(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v7",
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function mo(e, t) {
	return new e({
		type: "string",
		format: "url",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function ho(e, t) {
	return new e({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function go(e, t) {
	return new e({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function _o(e, t) {
	return new e({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function vo(e, t) {
	return new e({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function yo(e, t) {
	return new e({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function bo(e, t) {
	return new e({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function xo(e, t) {
	return new e({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function So(e, t) {
	return new e({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Co(e, t) {
	return new e({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function wo(e, t) {
	return new e({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function To(e, t) {
	return new e({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Eo(e, t) {
	return new e({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Do(e, t) {
	return new e({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Oo(e, t) {
	return new e({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function ko(e, t) {
	return new e({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: !1,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ao(e, t) {
	return new e({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: !1,
		local: !1,
		precision: null,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function jo(e, t) {
	return new e({
		type: "string",
		format: "date",
		check: "string_format",
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Mo(e, t) {
	return new e({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function No(e, t) {
	return new e({
		type: "string",
		format: "duration",
		check: "string_format",
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Po(e, t) {
	return new e({
		type: "number",
		checks: [],
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Fo(e, t) {
	return new e({
		type: "number",
		check: "number_format",
		abort: !1,
		format: "safeint",
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Io(e, t) {
	return new e({
		type: "boolean",
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Lo(e) {
	return new e({ type: "unknown" });
}
/* @__NO_SIDE_EFFECTS__ */
function Ro(e, t) {
	return new e({
		type: "never",
		...L(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function zo(e, t) {
	return new ji({
		check: "less_than",
		...L(t),
		value: e,
		inclusive: !1
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Bo(e, t) {
	return new ji({
		check: "less_than",
		...L(t),
		value: e,
		inclusive: !0
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Vo(e, t) {
	return new Mi({
		check: "greater_than",
		...L(t),
		value: e,
		inclusive: !1
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ho(e, t) {
	return new Mi({
		check: "greater_than",
		...L(t),
		value: e,
		inclusive: !0
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Uo(e, t) {
	return new Ni({
		check: "multiple_of",
		...L(t),
		value: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Wo(e, t) {
	return new Fi({
		check: "max_length",
		...L(t),
		maximum: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Go(e, t) {
	return new Ii({
		check: "min_length",
		...L(t),
		minimum: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ko(e, t) {
	return new Li({
		check: "length_equals",
		...L(t),
		length: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function qo(e, t) {
	return new zi({
		check: "string_format",
		format: "regex",
		...L(t),
		pattern: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Jo(e) {
	return new Bi({
		check: "string_format",
		format: "lowercase",
		...L(e)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Yo(e) {
	return new Vi({
		check: "string_format",
		format: "uppercase",
		...L(e)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Xo(e, t) {
	return new Hi({
		check: "string_format",
		format: "includes",
		...L(t),
		includes: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Zo(e, t) {
	return new Ui({
		check: "string_format",
		format: "starts_with",
		...L(t),
		prefix: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Qo(e, t) {
	return new Wi({
		check: "string_format",
		format: "ends_with",
		...L(t),
		suffix: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function U(e) {
	return new Gi({
		check: "overwrite",
		tx: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function $o(e) {
	return /* @__PURE__ */ U((t) => t.normalize(e));
}
/* @__NO_SIDE_EFFECTS__ */
function es() {
	return /* @__PURE__ */ U((e) => e.trim());
}
/* @__NO_SIDE_EFFECTS__ */
function ts() {
	return /* @__PURE__ */ U((e) => e.toLowerCase());
}
/* @__NO_SIDE_EFFECTS__ */
function ns() {
	return /* @__PURE__ */ U((e) => e.toUpperCase());
}
/* @__NO_SIDE_EFFECTS__ */
function rs() {
	return /* @__PURE__ */ U((e) => fr(e));
}
/* @__NO_SIDE_EFFECTS__ */
function is(e, t, n) {
	return new e({
		type: "array",
		element: t,
		...L(n)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function as(e, t, n) {
	return new e({
		type: "custom",
		check: "custom",
		fn: t,
		...L(n)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function os(e, t) {
	let n = /* @__PURE__ */ ss((t) => (t.addIssue = (e) => {
		if (typeof e == "string") t.issues.push(Nr(e, t.value, n._zod.def));
		else {
			let r = e;
			r.fatal && (r.continue = !1), r.code ??= "custom", r.input ??= t.value, r.inst ??= n, r.continue ??= !n._zod.def.abort, t.issues.push(Nr(r));
		}
	}, e(t.value, t)), t);
	return n;
}
/* @__NO_SIDE_EFFECTS__ */
function ss(e, t) {
	let n = new B({
		check: "custom",
		...L(t)
	});
	return n._zod.check = e, n;
}
//#endregion
//#region node_modules/zod/v4/core/to-json-schema.js
function cs(e) {
	let t = e?.target ?? "draft-2020-12";
	return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
		processors: e.processors ?? {},
		metadataRegistry: e?.metadata ?? ao,
		target: t,
		unrepresentable: e?.unrepresentable ?? "throw",
		override: e?.override ?? (() => {}),
		io: e?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		cycles: e?.cycles ?? "ref",
		reused: e?.reused ?? "inline",
		external: e?.external ?? void 0
	};
}
function W(e, t, n = {
	path: [],
	schemaPath: []
}) {
	var r;
	let i = e._zod.def, a = t.seen.get(e);
	if (a) return a.count++, n.schemaPath.includes(e) && (a.cycle = n.path), a.schema;
	let o = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: n.path
	};
	t.seen.set(e, o);
	let s = e._zod.toJSONSchema?.();
	if (s) o.schema = s;
	else {
		let r = {
			...n,
			schemaPath: [...n.schemaPath, e],
			path: n.path
		};
		if (e._zod.processJSONSchema) e._zod.processJSONSchema(t, o.schema, r);
		else {
			let n = o.schema, a = t.processors[i.type];
			if (!a) throw Error(`[toJSONSchema]: Non-representable type encountered: ${i.type}`);
			a(e, t, n, r);
		}
		let a = e._zod.parent;
		a && (o.ref ||= a, W(a, t, r), t.seen.get(a).isParent = !0);
	}
	let c = t.metadataRegistry.get(e);
	return c && Object.assign(o.schema, c), t.io === "input" && G(e) && (delete o.schema.examples, delete o.schema.default), t.io === "input" && "_prefault" in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)), delete o.schema._prefault, t.seen.get(e).schema;
}
function ls(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	let r = /* @__PURE__ */ new Map();
	for (let t of e.seen.entries()) {
		let n = e.metadataRegistry.get(t[0])?.id;
		if (n) {
			let e = r.get(n);
			if (e && e !== t[0]) throw Error(`Duplicate schema id "${n}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			r.set(n, t[0]);
		}
	}
	let i = (t) => {
		let r = e.target === "draft-2020-12" ? "$defs" : "definitions";
		if (e.external) {
			let n = e.external.registry.get(t[0])?.id, i = e.external.uri ?? ((e) => e);
			if (n) return { ref: i(n) };
			let a = t[1].defId ?? t[1].schema.id ?? `schema${e.counter++}`;
			return t[1].defId = a, {
				defId: a,
				ref: `${i("__shared")}#/${r}/${a}`
			};
		}
		if (t[1] === n) return { ref: "#" };
		let i = `#/${r}/`, a = t[1].schema.id ?? `__schema${e.counter++}`;
		return {
			defId: a,
			ref: i + a
		};
	}, a = (e) => {
		if (e[1].schema.$ref) return;
		let t = e[1], { ref: n, defId: r } = i(e);
		t.def = { ...t.schema }, r && (t.defId = r);
		let a = t.schema;
		for (let e in a) delete a[e];
		a.$ref = n;
	};
	if (e.cycles === "throw") for (let t of e.seen.entries()) {
		let e = t[1];
		if (e.cycle) throw Error(`Cycle detected: #/${e.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (let n of e.seen.entries()) {
		let r = n[1];
		if (t === n[0]) {
			a(n);
			continue;
		}
		if (e.external) {
			let r = e.external.registry.get(n[0])?.id;
			if (t !== n[0] && r) {
				a(n);
				continue;
			}
		}
		if (e.metadataRegistry.get(n[0])?.id) {
			a(n);
			continue;
		}
		if (r.cycle) {
			a(n);
			continue;
		}
		if (r.count > 1 && e.reused === "ref") {
			a(n);
			continue;
		}
	}
}
function us(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	let r = (t) => {
		let n = e.seen.get(t);
		if (n.ref === null) return;
		let i = n.def ?? n.schema, a = { ...i }, o = n.ref;
		if (n.ref = null, o) {
			r(o);
			let n = e.seen.get(o), s = n.schema;
			if (s.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (i.allOf = i.allOf ?? [], i.allOf.push(s)) : Object.assign(i, s), Object.assign(i, a), t._zod.parent === o) for (let e in i) e === "$ref" || e === "allOf" || e in a || delete i[e];
			if (s.$ref && n.def) for (let e in i) e === "$ref" || e === "allOf" || e in n.def && JSON.stringify(i[e]) === JSON.stringify(n.def[e]) && delete i[e];
		}
		let s = t._zod.parent;
		if (s && s !== o) {
			r(s);
			let t = e.seen.get(s);
			if (t?.schema.$ref && (i.$ref = t.schema.$ref, t.def)) for (let e in i) e === "$ref" || e === "allOf" || e in t.def && JSON.stringify(i[e]) === JSON.stringify(t.def[e]) && delete i[e];
		}
		e.override({
			zodSchema: t,
			jsonSchema: i,
			path: n.path ?? []
		});
	};
	for (let t of [...e.seen.entries()].reverse()) r(t[0]);
	let i = {};
	if (e.target === "draft-2020-12" ? i.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? i.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? i.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
		let n = e.external.registry.get(t)?.id;
		if (!n) throw Error("Schema is missing an `id` property");
		i.$id = e.external.uri(n);
	}
	Object.assign(i, n.def ?? n.schema);
	let a = e.metadataRegistry.get(t)?.id;
	a !== void 0 && i.id === a && delete i.id;
	let o = e.external?.defs ?? {};
	for (let t of e.seen.entries()) {
		let e = t[1];
		e.def && e.defId && (e.def.id === e.defId && delete e.def.id, o[e.defId] = e.def);
	}
	e.external || Object.keys(o).length > 0 && (e.target === "draft-2020-12" ? i.$defs = o : i.definitions = o);
	try {
		let n = JSON.parse(JSON.stringify(i));
		return Object.defineProperty(n, "~standard", {
			value: {
				...t["~standard"],
				jsonSchema: {
					input: fs(t, "input", e.processors),
					output: fs(t, "output", e.processors)
				}
			},
			enumerable: !1,
			writable: !1
		}), n;
	} catch {
		throw Error("Error converting schema to JSON.");
	}
}
function G(e, t) {
	let n = t ?? { seen: /* @__PURE__ */ new Set() };
	if (n.seen.has(e)) return !1;
	n.seen.add(e);
	let r = e._zod.def;
	if (r.type === "transform") return !0;
	if (r.type === "array") return G(r.element, n);
	if (r.type === "set") return G(r.valueType, n);
	if (r.type === "lazy") return G(r.getter(), n);
	if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault") return G(r.innerType, n);
	if (r.type === "intersection") return G(r.left, n) || G(r.right, n);
	if (r.type === "record" || r.type === "map") return G(r.keyType, n) || G(r.valueType, n);
	if (r.type === "pipe") return e._zod.traits.has("$ZodCodec") ? !0 : G(r.in, n) || G(r.out, n);
	if (r.type === "object") {
		for (let e in r.shape) if (G(r.shape[e], n)) return !0;
		return !1;
	}
	if (r.type === "union") {
		for (let e of r.options) if (G(e, n)) return !0;
		return !1;
	}
	if (r.type === "tuple") {
		for (let e of r.items) if (G(e, n)) return !0;
		return !!(r.rest && G(r.rest, n));
	}
	return !1;
}
var ds = (e, t = {}) => (n) => {
	let r = cs({
		...n,
		processors: t
	});
	return W(e, r), ls(r, e), us(r, e);
}, fs = (e, t, n = {}) => (r) => {
	let { libraryOptions: i, target: a } = r ?? {}, o = cs({
		...i ?? {},
		target: a,
		io: t,
		processors: n
	});
	return W(e, o), ls(o, e), us(o, e);
}, ps = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
}, ms = (e, t, n, r) => {
	let i = n;
	i.type = "string";
	let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l } = e._zod.bag;
	if (typeof a == "number" && (i.minLength = a), typeof o == "number" && (i.maxLength = o), s && (i.format = ps[s] ?? s, i.format === "" && delete i.format, s === "time" && delete i.format), l && (i.contentEncoding = l), c && c.size > 0) {
		let e = [...c];
		e.length === 1 ? i.pattern = e[0].source : e.length > 1 && (i.allOf = [...e.map((e) => ({
			...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: e.source
		}))]);
	}
}, hs = (e, t, n, r) => {
	let i = n, { minimum: a, maximum: o, format: s, multipleOf: c, exclusiveMaximum: l, exclusiveMinimum: u } = e._zod.bag;
	typeof s == "string" && s.includes("int") ? i.type = "integer" : i.type = "number";
	let d = typeof u == "number" && u >= (a ?? -Infinity), f = typeof l == "number" && l <= (o ?? Infinity), p = t.target === "draft-04" || t.target === "openapi-3.0";
	d ? p ? (i.minimum = u, i.exclusiveMinimum = !0) : i.exclusiveMinimum = u : typeof a == "number" && (i.minimum = a), f ? p ? (i.maximum = l, i.exclusiveMaximum = !0) : i.exclusiveMaximum = l : typeof o == "number" && (i.maximum = o), typeof c == "number" && (i.multipleOf = c);
}, gs = (e, t, n, r) => {
	n.type = "boolean";
}, _s = (e, t, n, r) => {
	n.not = {};
}, vs = (e, t, n, r) => {
	let i = e._zod.def, a = ir(i.entries);
	a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), n.enum = a;
}, ys = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Custom types cannot be represented in JSON Schema");
}, bs = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Transforms cannot be represented in JSON Schema");
}, xs = (e, t, n, r) => {
	let i = n, a = e._zod.def, { minimum: o, maximum: s } = e._zod.bag;
	typeof o == "number" && (i.minItems = o), typeof s == "number" && (i.maxItems = s), i.type = "array", i.items = W(a.element, t, {
		...r,
		path: [...r.path, "items"]
	});
}, Ss = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "object", i.properties = {};
	let o = a.shape;
	for (let e in o) i.properties[e] = W(o[e], t, {
		...r,
		path: [
			...r.path,
			"properties",
			e
		]
	});
	let s = new Set(Object.keys(o)), c = new Set([...s].filter((e) => {
		let n = a.shape[e]._zod;
		return t.io === "input" ? n.optin === void 0 : n.optout === void 0;
	}));
	c.size > 0 && (i.required = Array.from(c)), a.catchall?._zod.def.type === "never" ? i.additionalProperties = !1 : a.catchall ? a.catchall && (i.additionalProperties = W(a.catchall, t, {
		...r,
		path: [...r.path, "additionalProperties"]
	})) : t.io === "output" && (i.additionalProperties = !1);
}, Cs = (e, t, n, r) => {
	let i = e._zod.def, a = i.inclusive === !1, o = i.options.map((e, n) => W(e, t, {
		...r,
		path: [
			...r.path,
			a ? "oneOf" : "anyOf",
			n
		]
	}));
	a ? n.oneOf = o : n.anyOf = o;
}, ws = (e, t, n, r) => {
	let i = e._zod.def, a = W(i.left, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			0
		]
	}), o = W(i.right, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			1
		]
	}), s = (e) => "allOf" in e && Object.keys(e).length === 1;
	n.allOf = [...s(a) ? a.allOf : [a], ...s(o) ? o.allOf : [o]];
}, Ts = (e, t, n, r) => {
	let i = e._zod.def, a = W(i.innerType, t, r), o = t.seen.get(e);
	t.target === "openapi-3.0" ? (o.ref = i.innerType, n.nullable = !0) : n.anyOf = [a, { type: "null" }];
}, Es = (e, t, n, r) => {
	let i = e._zod.def;
	W(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Ds = (e, t, n, r) => {
	let i = e._zod.def;
	W(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.default = JSON.parse(JSON.stringify(i.defaultValue));
}, Os = (e, t, n, r) => {
	let i = e._zod.def;
	W(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, t.io === "input" && (n._prefault = JSON.parse(JSON.stringify(i.defaultValue)));
}, ks = (e, t, n, r) => {
	let i = e._zod.def;
	W(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o;
	try {
		o = i.catchValue(void 0);
	} catch {
		throw Error("Dynamic catch values are not supported in JSON Schema");
	}
	n.default = o;
}, As = (e, t, n, r) => {
	let i = e._zod.def, a = i.in._zod.traits.has("$ZodTransform"), o = t.io === "input" ? a ? i.out : i.in : i.out;
	W(o, t, r);
	let s = t.seen.get(e);
	s.ref = o;
}, js = (e, t, n, r) => {
	let i = e._zod.def;
	W(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.readOnly = !0;
}, Ms = (e, t, n, r) => {
	let i = e._zod.def;
	W(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Ns = /* @__PURE__ */ A("ZodISODateTime", (e, t) => {
	oa.init(e, t), Y.init(e, t);
});
function Ps(e) {
	return /* @__PURE__ */ Ao(Ns, e);
}
var Fs = /* @__PURE__ */ A("ZodISODate", (e, t) => {
	sa.init(e, t), Y.init(e, t);
});
function Is(e) {
	return /* @__PURE__ */ jo(Fs, e);
}
var Ls = /* @__PURE__ */ A("ZodISOTime", (e, t) => {
	ca.init(e, t), Y.init(e, t);
});
function Rs(e) {
	return /* @__PURE__ */ Mo(Ls, e);
}
var zs = /* @__PURE__ */ A("ZodISODuration", (e, t) => {
	la.init(e, t), Y.init(e, t);
});
function Bs(e) {
	return /* @__PURE__ */ No(zs, e);
}
var K = /* @__PURE__ */ A("ZodError", (e, t) => {
	Fr.init(e, t), e.name = "ZodError", Object.defineProperties(e, {
		format: { value: (t) => Rr(e, t) },
		flatten: { value: (t) => Lr(e, t) },
		addIssue: { value: (t) => {
			e.issues.push(t), e.message = JSON.stringify(e.issues, ar, 2);
		} },
		addIssues: { value: (t) => {
			e.issues.push(...t), e.message = JSON.stringify(e.issues, ar, 2);
		} },
		isEmpty: { get() {
			return e.issues.length === 0;
		} }
	});
}, { Parent: Error }), Vs = /* @__PURE__ */ zr(K), Hs = /* @__PURE__ */ Br(K), Us = /* @__PURE__ */ Vr(K), Ws = /* @__PURE__ */ Ur(K), Gs = /* @__PURE__ */ Gr(K), Ks = /* @__PURE__ */ Kr(K), qs = /* @__PURE__ */ qr(K), Js = /* @__PURE__ */ Jr(K), Ys = /* @__PURE__ */ Yr(K), Xs = /* @__PURE__ */ Xr(K), Zs = /* @__PURE__ */ Zr(K), Qs = /* @__PURE__ */ Qr(K), $s = /* @__PURE__ */ new WeakMap();
function ec(e, t, n) {
	let r = Object.getPrototypeOf(e), i = $s.get(r);
	if (i || (i = /* @__PURE__ */ new Set(), $s.set(r, i)), !i.has(t)) {
		i.add(t);
		for (let e in n) {
			let t = n[e];
			Object.defineProperty(r, e, {
				configurable: !0,
				enumerable: !1,
				get() {
					let n = t.bind(this);
					return Object.defineProperty(this, e, {
						configurable: !0,
						writable: !0,
						enumerable: !0,
						value: n
					}), n;
				},
				set(t) {
					Object.defineProperty(this, e, {
						configurable: !0,
						writable: !0,
						enumerable: !0,
						value: t
					});
				}
			});
		}
	}
}
var q = /* @__PURE__ */ A("ZodType", (e, t) => (V.init(e, t), Object.assign(e["~standard"], { jsonSchema: {
	input: fs(e, "input"),
	output: fs(e, "output")
} }), e.toJSONSchema = ds(e, {}), e.def = t, e.type = t.type, Object.defineProperty(e, "_def", { value: t }), e.parse = (t, n) => Vs(e, t, n, { callee: e.parse }), e.safeParse = (t, n) => Us(e, t, n), e.parseAsync = async (t, n) => Hs(e, t, n, { callee: e.parseAsync }), e.safeParseAsync = async (t, n) => Ws(e, t, n), e.spa = e.safeParseAsync, e.encode = (t, n) => Gs(e, t, n), e.decode = (t, n) => Ks(e, t, n), e.encodeAsync = async (t, n) => qs(e, t, n), e.decodeAsync = async (t, n) => Js(e, t, n), e.safeEncode = (t, n) => Ys(e, t, n), e.safeDecode = (t, n) => Xs(e, t, n), e.safeEncodeAsync = async (t, n) => Zs(e, t, n), e.safeDecodeAsync = async (t, n) => Qs(e, t, n), ec(e, "ZodType", {
	check(...e) {
		let t = this.def;
		return this.clone(F(t, { checks: [...t.checks ?? [], ...e.map((e) => typeof e == "function" ? { _zod: {
			check: e,
			def: { check: "custom" },
			onattach: []
		} } : e)] }), { parent: !0 });
	},
	with(...e) {
		return this.check(...e);
	},
	clone(e, t) {
		return I(this, e, t);
	},
	brand() {
		return this;
	},
	register(e, t) {
		return e.add(this, t), this;
	},
	refine(e, t) {
		return this.check(sl(e, t));
	},
	superRefine(e, t) {
		return this.check(cl(e, t));
	},
	overwrite(e) {
		return this.check(/* @__PURE__ */ U(e));
	},
	optional() {
		return Uc(this);
	},
	exactOptional() {
		return Gc(this);
	},
	nullable() {
		return qc(this);
	},
	nullish() {
		return Uc(qc(this));
	},
	nonoptional(e) {
		return $c(this, e);
	},
	array() {
		return Mc(this);
	},
	or(e) {
		return Fc([this, e]);
	},
	and(e) {
		return Lc(this, e);
	},
	transform(e) {
		return rl(this, Vc(e));
	},
	default(e) {
		return Yc(this, e);
	},
	prefault(e) {
		return Zc(this, e);
	},
	catch(e) {
		return tl(this, e);
	},
	pipe(e) {
		return rl(this, e);
	},
	readonly() {
		return al(this);
	},
	describe(e) {
		let t = this.clone();
		return ao.add(t, { description: e }), t;
	},
	meta(...e) {
		if (e.length === 0) return ao.get(this);
		let t = this.clone();
		return ao.add(t, e[0]), t;
	},
	isOptional() {
		return this.safeParse(void 0).success;
	},
	isNullable() {
		return this.safeParse(null).success;
	},
	apply(e) {
		return e(this);
	}
}), Object.defineProperty(e, "description", {
	get() {
		return ao.get(e)?.description;
	},
	configurable: !0
}), e)), tc = /* @__PURE__ */ A("_ZodString", (e, t) => {
	Ji.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => ms(e, t, n, r);
	let n = e._zod.bag;
	e.format = n.format ?? null, e.minLength = n.minimum ?? null, e.maxLength = n.maximum ?? null, ec(e, "_ZodString", {
		regex(...e) {
			return this.check(/* @__PURE__ */ qo(...e));
		},
		includes(...e) {
			return this.check(/* @__PURE__ */ Xo(...e));
		},
		startsWith(...e) {
			return this.check(/* @__PURE__ */ Zo(...e));
		},
		endsWith(...e) {
			return this.check(/* @__PURE__ */ Qo(...e));
		},
		min(...e) {
			return this.check(/* @__PURE__ */ Go(...e));
		},
		max(...e) {
			return this.check(/* @__PURE__ */ Wo(...e));
		},
		length(...e) {
			return this.check(/* @__PURE__ */ Ko(...e));
		},
		nonempty(...e) {
			return this.check(/* @__PURE__ */ Go(1, ...e));
		},
		lowercase(e) {
			return this.check(/* @__PURE__ */ Jo(e));
		},
		uppercase(e) {
			return this.check(/* @__PURE__ */ Yo(e));
		},
		trim() {
			return this.check(/* @__PURE__ */ es());
		},
		normalize(...e) {
			return this.check(/* @__PURE__ */ $o(...e));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ ts());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ ns());
		},
		slugify() {
			return this.check(/* @__PURE__ */ rs());
		}
	});
}), nc = /* @__PURE__ */ A("ZodString", (e, t) => {
	Ji.init(e, t), tc.init(e, t), e.email = (t) => e.check(/* @__PURE__ */ so(rc, t)), e.url = (t) => e.check(/* @__PURE__ */ mo(oc, t)), e.jwt = (t) => e.check(/* @__PURE__ */ ko(xc, t)), e.emoji = (t) => e.check(/* @__PURE__ */ ho(sc, t)), e.guid = (t) => e.check(/* @__PURE__ */ co(ic, t)), e.uuid = (t) => e.check(/* @__PURE__ */ lo(ac, t)), e.uuidv4 = (t) => e.check(/* @__PURE__ */ uo(ac, t)), e.uuidv6 = (t) => e.check(/* @__PURE__ */ fo(ac, t)), e.uuidv7 = (t) => e.check(/* @__PURE__ */ po(ac, t)), e.nanoid = (t) => e.check(/* @__PURE__ */ go(cc, t)), e.guid = (t) => e.check(/* @__PURE__ */ co(ic, t)), e.cuid = (t) => e.check(/* @__PURE__ */ _o(lc, t)), e.cuid2 = (t) => e.check(/* @__PURE__ */ vo(uc, t)), e.ulid = (t) => e.check(/* @__PURE__ */ yo(dc, t)), e.base64 = (t) => e.check(/* @__PURE__ */ Eo(vc, t)), e.base64url = (t) => e.check(/* @__PURE__ */ Do(yc, t)), e.xid = (t) => e.check(/* @__PURE__ */ bo(fc, t)), e.ksuid = (t) => e.check(/* @__PURE__ */ xo(pc, t)), e.ipv4 = (t) => e.check(/* @__PURE__ */ So(mc, t)), e.ipv6 = (t) => e.check(/* @__PURE__ */ Co(hc, t)), e.cidrv4 = (t) => e.check(/* @__PURE__ */ wo(gc, t)), e.cidrv6 = (t) => e.check(/* @__PURE__ */ To(_c, t)), e.e164 = (t) => e.check(/* @__PURE__ */ Oo(bc, t)), e.datetime = (t) => e.check(Ps(t)), e.date = (t) => e.check(Is(t)), e.time = (t) => e.check(Rs(t)), e.duration = (t) => e.check(Bs(t));
});
function J(e) {
	return /* @__PURE__ */ oo(nc, e);
}
var Y = /* @__PURE__ */ A("ZodStringFormat", (e, t) => {
	H.init(e, t), tc.init(e, t);
}), rc = /* @__PURE__ */ A("ZodEmail", (e, t) => {
	Zi.init(e, t), Y.init(e, t);
}), ic = /* @__PURE__ */ A("ZodGUID", (e, t) => {
	Yi.init(e, t), Y.init(e, t);
}), ac = /* @__PURE__ */ A("ZodUUID", (e, t) => {
	Xi.init(e, t), Y.init(e, t);
}), oc = /* @__PURE__ */ A("ZodURL", (e, t) => {
	Qi.init(e, t), Y.init(e, t);
}), sc = /* @__PURE__ */ A("ZodEmoji", (e, t) => {
	$i.init(e, t), Y.init(e, t);
}), cc = /* @__PURE__ */ A("ZodNanoID", (e, t) => {
	ea.init(e, t), Y.init(e, t);
}), lc = /* @__PURE__ */ A("ZodCUID", (e, t) => {
	ta.init(e, t), Y.init(e, t);
}), uc = /* @__PURE__ */ A("ZodCUID2", (e, t) => {
	na.init(e, t), Y.init(e, t);
}), dc = /* @__PURE__ */ A("ZodULID", (e, t) => {
	ra.init(e, t), Y.init(e, t);
}), fc = /* @__PURE__ */ A("ZodXID", (e, t) => {
	ia.init(e, t), Y.init(e, t);
}), pc = /* @__PURE__ */ A("ZodKSUID", (e, t) => {
	aa.init(e, t), Y.init(e, t);
}), mc = /* @__PURE__ */ A("ZodIPv4", (e, t) => {
	ua.init(e, t), Y.init(e, t);
}), hc = /* @__PURE__ */ A("ZodIPv6", (e, t) => {
	da.init(e, t), Y.init(e, t);
}), gc = /* @__PURE__ */ A("ZodCIDRv4", (e, t) => {
	fa.init(e, t), Y.init(e, t);
}), _c = /* @__PURE__ */ A("ZodCIDRv6", (e, t) => {
	pa.init(e, t), Y.init(e, t);
}), vc = /* @__PURE__ */ A("ZodBase64", (e, t) => {
	ha.init(e, t), Y.init(e, t);
}), yc = /* @__PURE__ */ A("ZodBase64URL", (e, t) => {
	_a.init(e, t), Y.init(e, t);
}), bc = /* @__PURE__ */ A("ZodE164", (e, t) => {
	va.init(e, t), Y.init(e, t);
}), xc = /* @__PURE__ */ A("ZodJWT", (e, t) => {
	ba.init(e, t), Y.init(e, t);
}), Sc = /* @__PURE__ */ A("ZodNumber", (e, t) => {
	xa.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => hs(e, t, n, r), ec(e, "ZodNumber", {
		gt(e, t) {
			return this.check(/* @__PURE__ */ Vo(e, t));
		},
		gte(e, t) {
			return this.check(/* @__PURE__ */ Ho(e, t));
		},
		min(e, t) {
			return this.check(/* @__PURE__ */ Ho(e, t));
		},
		lt(e, t) {
			return this.check(/* @__PURE__ */ zo(e, t));
		},
		lte(e, t) {
			return this.check(/* @__PURE__ */ Bo(e, t));
		},
		max(e, t) {
			return this.check(/* @__PURE__ */ Bo(e, t));
		},
		int(e) {
			return this.check(wc(e));
		},
		safe(e) {
			return this.check(wc(e));
		},
		positive(e) {
			return this.check(/* @__PURE__ */ Vo(0, e));
		},
		nonnegative(e) {
			return this.check(/* @__PURE__ */ Ho(0, e));
		},
		negative(e) {
			return this.check(/* @__PURE__ */ zo(0, e));
		},
		nonpositive(e) {
			return this.check(/* @__PURE__ */ Bo(0, e));
		},
		multipleOf(e, t) {
			return this.check(/* @__PURE__ */ Uo(e, t));
		},
		step(e, t) {
			return this.check(/* @__PURE__ */ Uo(e, t));
		},
		finite() {
			return this;
		}
	});
	let n = e._zod.bag;
	e.minValue = Math.max(n.minimum ?? -Infinity, n.exclusiveMinimum ?? -Infinity) ?? null, e.maxValue = Math.min(n.maximum ?? Infinity, n.exclusiveMaximum ?? Infinity) ?? null, e.isInt = (n.format ?? "").includes("int") || Number.isSafeInteger(n.multipleOf ?? .5), e.isFinite = !0, e.format = n.format ?? null;
});
function X(e) {
	return /* @__PURE__ */ Po(Sc, e);
}
var Cc = /* @__PURE__ */ A("ZodNumberFormat", (e, t) => {
	Sa.init(e, t), Sc.init(e, t);
});
function wc(e) {
	return /* @__PURE__ */ Fo(Cc, e);
}
var Tc = /* @__PURE__ */ A("ZodBoolean", (e, t) => {
	Ca.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => gs(e, t, n, r);
});
function Ec(e) {
	return /* @__PURE__ */ Io(Tc, e);
}
var Dc = /* @__PURE__ */ A("ZodUnknown", (e, t) => {
	wa.init(e, t), q.init(e, t), e._zod.processJSONSchema = (e, t, n) => void 0;
});
function Oc() {
	return /* @__PURE__ */ Lo(Dc);
}
var kc = /* @__PURE__ */ A("ZodNever", (e, t) => {
	Ta.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => _s(e, t, n, r);
});
function Ac(e) {
	return /* @__PURE__ */ Ro(kc, e);
}
var jc = /* @__PURE__ */ A("ZodArray", (e, t) => {
	Da.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => xs(e, t, n, r), e.element = t.element, ec(e, "ZodArray", {
		min(e, t) {
			return this.check(/* @__PURE__ */ Go(e, t));
		},
		nonempty(e) {
			return this.check(/* @__PURE__ */ Go(1, e));
		},
		max(e, t) {
			return this.check(/* @__PURE__ */ Wo(e, t));
		},
		length(e, t) {
			return this.check(/* @__PURE__ */ Ko(e, t));
		},
		unwrap() {
			return this.element;
		}
	});
});
function Mc(e, t) {
	return /* @__PURE__ */ is(jc, e, t);
}
var Nc = /* @__PURE__ */ A("ZodObject", (e, t) => {
	Ma.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ss(e, t, n, r), N(e, "shape", () => t.shape), ec(e, "ZodObject", {
		keyof() {
			return zc(Object.keys(this._zod.def.shape));
		},
		catchall(e) {
			return this.clone({
				...this._zod.def,
				catchall: e
			});
		},
		passthrough() {
			return this.clone({
				...this._zod.def,
				catchall: Oc()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: Oc()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: Ac()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(e) {
			return wr(this, e);
		},
		safeExtend(e) {
			return Tr(this, e);
		},
		merge(e) {
			return Er(this, e);
		},
		pick(e) {
			return Sr(this, e);
		},
		omit(e) {
			return Cr(this, e);
		},
		partial(...e) {
			return Dr(Hc, this, e[0]);
		},
		required(...e) {
			return Or(Qc, this, e[0]);
		}
	});
});
function Z(e, t) {
	return new Nc({
		type: "object",
		shape: e ?? {},
		...L(t)
	});
}
var Pc = /* @__PURE__ */ A("ZodUnion", (e, t) => {
	Pa.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => Cs(e, t, n, r), e.options = t.options;
});
function Fc(e, t) {
	return new Pc({
		type: "union",
		options: e,
		...L(t)
	});
}
var Ic = /* @__PURE__ */ A("ZodIntersection", (e, t) => {
	Fa.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => ws(e, t, n, r);
});
function Lc(e, t) {
	return new Ic({
		type: "intersection",
		left: e,
		right: t
	});
}
var Rc = /* @__PURE__ */ A("ZodEnum", (e, t) => {
	Ra.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => vs(e, t, n, r), e.enum = t.entries, e.options = Object.values(t.entries);
	let n = new Set(Object.keys(t.entries));
	e.extract = (e, r) => {
		let i = {};
		for (let r of e) if (n.has(r)) i[r] = t.entries[r];
		else throw Error(`Key ${r} not found in enum`);
		return new Rc({
			...t,
			checks: [],
			...L(r),
			entries: i
		});
	}, e.exclude = (e, r) => {
		let i = { ...t.entries };
		for (let t of e) if (n.has(t)) delete i[t];
		else throw Error(`Key ${t} not found in enum`);
		return new Rc({
			...t,
			checks: [],
			...L(r),
			entries: i
		});
	};
});
function zc(e, t) {
	return new Rc({
		type: "enum",
		entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
		...L(t)
	});
}
var Bc = /* @__PURE__ */ A("ZodTransform", (e, t) => {
	za.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => bs(e, t, n, r), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new nr(e.constructor.name);
		n.addIssue = (r) => {
			if (typeof r == "string") n.issues.push(Nr(r, n.value, t));
			else {
				let t = r;
				t.fatal && (t.continue = !1), t.code ??= "custom", t.input ??= n.value, t.inst ??= e, n.issues.push(Nr(t));
			}
		};
		let i = t.transform(n.value, n);
		return i instanceof Promise ? i.then((e) => (n.value = e, n.fallback = !0, n)) : (n.value = i, n.fallback = !0, n);
	};
});
function Vc(e) {
	return new Bc({
		type: "transform",
		transform: e
	});
}
var Hc = /* @__PURE__ */ A("ZodOptional", (e, t) => {
	Va.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ms(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Uc(e) {
	return new Hc({
		type: "optional",
		innerType: e
	});
}
var Wc = /* @__PURE__ */ A("ZodExactOptional", (e, t) => {
	Ha.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ms(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Gc(e) {
	return new Wc({
		type: "optional",
		innerType: e
	});
}
var Kc = /* @__PURE__ */ A("ZodNullable", (e, t) => {
	Ua.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ts(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function qc(e) {
	return new Kc({
		type: "nullable",
		innerType: e
	});
}
var Jc = /* @__PURE__ */ A("ZodDefault", (e, t) => {
	Wa.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ds(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function Yc(e, t) {
	return new Jc({
		type: "default",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : _r(t);
		}
	});
}
var Xc = /* @__PURE__ */ A("ZodPrefault", (e, t) => {
	Ka.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => Os(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Zc(e, t) {
	return new Xc({
		type: "prefault",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : _r(t);
		}
	});
}
var Qc = /* @__PURE__ */ A("ZodNonOptional", (e, t) => {
	qa.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => Es(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function $c(e, t) {
	return new Qc({
		type: "nonoptional",
		innerType: e,
		...L(t)
	});
}
var el = /* @__PURE__ */ A("ZodCatch", (e, t) => {
	Ya.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => ks(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function tl(e, t) {
	return new el({
		type: "catch",
		innerType: e,
		catchValue: typeof t == "function" ? t : () => t
	});
}
var nl = /* @__PURE__ */ A("ZodPipe", (e, t) => {
	Xa.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => As(e, t, n, r), e.in = t.in, e.out = t.out;
});
function rl(e, t) {
	return new nl({
		type: "pipe",
		in: e,
		out: t
	});
}
var il = /* @__PURE__ */ A("ZodReadonly", (e, t) => {
	Qa.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => js(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function al(e) {
	return new il({
		type: "readonly",
		innerType: e
	});
}
var ol = /* @__PURE__ */ A("ZodCustom", (e, t) => {
	eo.init(e, t), q.init(e, t), e._zod.processJSONSchema = (t, n, r) => ys(e, t, n, r);
});
function sl(e, t = {}) {
	return /* @__PURE__ */ as(ol, e, t);
}
function cl(e, t) {
	return /* @__PURE__ */ os(e, t);
}
//#endregion
//#region electron/bridge/tickets.ts
var ll = zc([
	"Explore",
	"Feature",
	"Execute"
]), ul = {
	Execute: "Draft",
	Explore: "Open",
	Feature: "Idea"
}, dl = "\n  INSERT INTO tickets (uuid, id, title, type, status, backlog, description, archived, created_at, updated_at)\n  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n  ON CONFLICT(uuid) DO UPDATE SET\n    id          = excluded.id,\n    title       = excluded.title,\n    type        = excluded.type,\n    status      = excluded.status,\n    backlog     = excluded.backlog,\n    description = excluded.description,\n    archived    = excluded.archived,\n    updated_at  = excluded.updated_at\n", fl = "counter", pl = "OVH";
function ml() {
	let e = y("SELECT value FROM settings WHERE key = ?", [fl]), t = (e?.[0]?.value ? parseInt(e[0].value, 10) : 0) + 1;
	return y("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [fl, String(t)]), `${pl}-${String(t).padStart(3, "0")}`;
}
function hl(e) {
	return {
		...e,
		backlog: e.backlog === 1,
		archived: e.archived === 1
	};
}
function gl(e) {
	return xn("SELECT * FROM tickets WHERE uuid = ? LIMIT 1", [e])[0] ?? null;
}
function _l(e) {
	xn(dl, [
		e.uuid,
		e.id,
		e.title,
		e.type,
		e.status,
		+!!e.backlog,
		e.description,
		+!!e.archived,
		e.created_at,
		e.updated_at
	]), Qn(e.uuid);
}
var vl = Z({
	title: J().min(1),
	type: ll,
	status: J().min(1).optional(),
	description: J().default(""),
	backlog: Ec().default(!1)
}), yl = Z({
	uuid: J().min(1),
	patch: Z({
		title: J().min(1).optional(),
		status: J().min(1).optional(),
		description: J().optional(),
		backlog: Ec().optional(),
		archived: Ec().optional()
	})
}), bl = Z({ uuid: J().min(1) });
function xl(e) {
	let t = vl.parse(e), n = Date.now(), r = {
		uuid: m(),
		id: ml(),
		title: t.title,
		type: t.type,
		status: t.status ?? ul[t.type],
		backlog: t.backlog,
		description: t.description,
		archived: !1,
		created_at: n,
		updated_at: n
	};
	return _l(r), r;
}
function Sl(e) {
	let { uuid: t } = bl.parse(e), n = gl(t);
	return n ? hl(n) : null;
}
function Cl() {
	return xn("SELECT * FROM tickets ORDER BY created_at ASC", []).map(hl);
}
function wl(e) {
	let { uuid: t, patch: n } = yl.parse(e), r = gl(t);
	if (!r) throw Error(`bridge: ticket "${t}" not found.`);
	let i = {
		...hl(r),
		...n,
		updated_at: Date.now()
	};
	return _l(i), i;
}
function Tl(e) {
	let { uuid: t } = bl.parse(e);
	return xn("DELETE FROM tickets WHERE uuid = ?", [t]), Qn(t), { uuid: t };
}
//#endregion
//#region electron/bridge/relations.ts
var El = Z({
	a: J().min(1),
	b: J().min(1)
}), Dl = Z({
	blocked: J().min(1),
	blocker: J().min(1)
}), Ol = Z({ uuid: J().min(1) }), kl = Z({ ticketUuid: J().min(1) });
function Al(e) {
	let { a: t, b: n } = El.parse(e), r = Kn("add", {
		type: "relates-to",
		node_a: t,
		node_b: n
	});
	return k(), r;
}
function jl(e) {
	let { blocked: t, blocker: n } = Dl.parse(e), r = Kn("add", {
		type: "blocked-by",
		node_a: t,
		node_b: n
	});
	return k(), r;
}
function Ml(e) {
	let { uuid: t } = Ol.parse(e), n = Kn("remove", { uuid: t });
	return k(), n;
}
function Nl(e) {
	let { ticketUuid: t } = kl.parse(e);
	return Kn("list", { ticketUuid: t });
}
//#endregion
//#region electron/bridge/views.ts
var Pl = Z({ name: J().min(1) }), Fl = Z({ uuid: J().min(1) }), Il = Z({
	uuid: J().min(1),
	name: J().min(1)
}), Ll = Z({ viewUuid: J().min(1) }), Rl = Z({
	viewUuid: J().min(1),
	ticketUuid: J().min(1),
	x: X(),
	y: X()
}), zl = Z({
	viewUuid: J().min(1),
	ticketUuid: J().min(1)
}), Bl = Z({ viewUuid: J().min(1) }), Vl = zc([
	"left",
	"right",
	"top",
	"bottom"
]), Hl = Z({
	viewUuid: J().min(1),
	sourceUuid: J().min(1),
	targetUuid: J().min(1),
	sourceHandle: Vl.optional(),
	targetHandle: Vl.optional()
}), Ul = Z({ uuid: J().min(1) }), Wl = Z({
	x: X(),
	y: X()
}), Gl = Z({
	dx: X(),
	dy: X()
}), Kl = Z({
	viewUuid: J().min(1),
	ticketUuid: J().min(1)
}), ql = Z({
	viewUuid: J().min(1),
	ticketUuid: J().min(1),
	...Wl.shape
}), Jl = Z({
	viewUuid: J().min(1),
	ticketUuid: J().min(1),
	...Gl.shape
});
function Yl() {
	return y("SELECT uuid, name, created_at FROM graph_views ORDER BY created_at ASC", []);
}
function Xl(e) {
	let { name: t } = Pl.parse(e), n = m(), r = Date.now();
	return y("INSERT INTO graph_views (uuid, name, created_at) VALUES (?, ?, ?)", [
		n,
		t,
		r
	]), k(), {
		uuid: n,
		name: t,
		created_at: r
	};
}
function Zl(e) {
	let { uuid: t, name: n } = Il.parse(e), r = y("SELECT uuid, name, created_at FROM graph_views WHERE uuid = ?", [t]);
	if (!r[0]) throw Error(`bridge: view "${t}" not found.`);
	return y("UPDATE graph_views SET name = ? WHERE uuid = ?", [n, t]), k(), {
		...r[0],
		name: n
	};
}
function Ql(e) {
	let { uuid: t } = Fl.parse(e);
	return y("DELETE FROM graph_views WHERE uuid = ?", [t]), k(), { uuid: t };
}
function $l(e) {
	let { viewUuid: t } = Ll.parse(e);
	return y("SELECT n.ticket_uuid, t.id, t.title, t.type, t.status, n.x, n.y\n     FROM graph_view_nodes n\n     JOIN tickets t ON t.uuid = n.ticket_uuid\n     WHERE n.view_uuid = ?\n     ORDER BY t.created_at ASC", [t]);
}
function eu(e) {
	let { viewUuid: t, ticketUuid: n } = Kl.parse(e);
	return y("SELECT n.ticket_uuid, t.id, t.title, t.type, t.status, n.x, n.y\n     FROM graph_view_nodes n\n     JOIN tickets t ON t.uuid = n.ticket_uuid\n     WHERE n.view_uuid = ? AND n.ticket_uuid = ?", [t, n])[0] ?? null;
}
function tu(e) {
	let { viewUuid: t } = Ll.parse(e), n = y("SELECT uuid, name, created_at FROM graph_views WHERE uuid = ?", [t]);
	if (!n[0]) throw Error(`bridge: view "${t}" not found.`);
	let r = y("SELECT n.ticket_uuid, t.id, t.title, t.type, t.status, n.x, n.y\n     FROM graph_view_nodes n\n     JOIN tickets t ON t.uuid = n.ticket_uuid\n     WHERE n.view_uuid = ?\n     ORDER BY t.created_at ASC", [t]), i = y("SELECT uuid, source_uuid, target_uuid, source_handle, target_handle FROM graph_view_edges WHERE view_uuid = ?", [t]);
	return {
		view: n[0],
		nodes: r,
		edges: i
	};
}
function nu(e) {
	let { viewUuid: t, ticketUuid: n, x: r, y: i } = ql.parse(e), a = eu({
		viewUuid: t,
		ticketUuid: n
	});
	if (!a) throw Error(`bridge: node "${n}" not found in view "${t}".`);
	return y("UPDATE graph_view_nodes SET x = ?, y = ? WHERE view_uuid = ? AND ticket_uuid = ?", [
		r,
		i,
		t,
		n
	]), k(), {
		...a,
		x: r,
		y: i
	};
}
function ru(e) {
	let { viewUuid: t, ticketUuid: n, dx: r, dy: i } = Jl.parse(e), a = eu({
		viewUuid: t,
		ticketUuid: n
	});
	if (!a) throw Error(`bridge: node "${n}" not found in view "${t}".`);
	let o = a.x + r, s = a.y + i;
	return y("UPDATE graph_view_nodes SET x = ?, y = ? WHERE view_uuid = ? AND ticket_uuid = ?", [
		o,
		s,
		t,
		n
	]), k(), {
		...a,
		x: o,
		y: s
	};
}
function iu(e) {
	let { viewUuid: t, ticketUuid: n, x: r, y: i } = Rl.parse(e);
	y("INSERT INTO graph_view_nodes (view_uuid, ticket_uuid, x, y)\n     VALUES (?, ?, ?, ?)\n     ON CONFLICT(view_uuid, ticket_uuid) DO UPDATE SET x = excluded.x, y = excluded.y", [
		t,
		n,
		r,
		i
	]), k();
}
function au(e) {
	let { viewUuid: t, ticketUuid: n } = zl.parse(e);
	y("DELETE FROM graph_view_nodes WHERE view_uuid = ? AND ticket_uuid = ?", [t, n]), k();
}
function ou(e) {
	let { viewUuid: t } = Bl.parse(e);
	return y("SELECT uuid, source_uuid, target_uuid, source_handle, target_handle FROM graph_view_edges WHERE view_uuid = ?", [t]);
}
function su(e) {
	let { viewUuid: t, sourceUuid: n, targetUuid: r, sourceHandle: i, targetHandle: a } = Hl.parse(e), o = m(), s = i ?? null, c = a ?? null;
	return y("INSERT INTO graph_view_edges (uuid, view_uuid, source_uuid, target_uuid, source_handle, target_handle) VALUES (?, ?, ?, ?, ?, ?)", [
		o,
		t,
		n,
		r,
		s,
		c
	]), k(), {
		uuid: o,
		source_uuid: n,
		target_uuid: r,
		source_handle: s,
		target_handle: c
	};
}
function cu(e) {
	let { uuid: t } = Ul.parse(e);
	return y("DELETE FROM graph_view_edges WHERE uuid = ?", [t]), k(), { uuid: t };
}
//#endregion
//#region electron/bridge/index.ts
var lu = {
	createTicket: xl,
	getTicket: Sl,
	listTickets: Cl,
	updateTicket: wl,
	deleteTicket: Tl,
	relate: Al,
	blockBy: jl,
	unrelate: Ml,
	listRelations: Nl,
	listViews: Yl,
	createView: Xl,
	renameView: Zl,
	deleteView: Ql,
	listViewNodes: $l,
	addViewNode: iu,
	removeViewNode: au,
	getViewNode: eu,
	getViewMap: tu,
	moveViewNode: nu,
	nudgeViewNode: ru,
	listViewEdges: ou,
	createViewEdge: su,
	removeViewEdge: cu
};
function uu(e, t, n = {}) {
	let r = lu[e];
	if (!r) throw Error(`bridge: unknown method "${e}".`);
	return er(e, n), r(t);
}
//#endregion
//#region electron/transports/http.ts
var du = 49152, fu = null;
function pu(e) {
	return JSON.stringify(e);
}
function mu() {
	fu = he((e, t) => {
		if (t.setHeader("Content-Type", "application/json"), e.method !== "POST" || e.url !== "/invoke") {
			t.writeHead(404).end(pu({ error: "Not found. Use POST /invoke." }));
			return;
		}
		let n = [];
		e.on("data", (e) => n.push(e)), e.on("end", () => {
			try {
				let e = JSON.parse(Buffer.concat(n).toString()), r = uu(e.method, e.args ?? null);
				t.writeHead(200).end(pu({ result: r }));
			} catch (e) {
				t.writeHead(400).end(pu({ error: e.message }));
			}
		});
	}), fu.on("error", (e) => {
		e.code === "EADDRINUSE" ? console.warn(`[bridge] port ${du} already in use — another instance is running. HTTP transport disabled for this process.`) : console.error("[bridge] HTTP server error:", e), fu = null;
	}), fu.listen(du, "127.0.0.1", () => {
		console.log(`[bridge] HTTP server listening on 127.0.0.1:${du}`);
	});
}
function hu() {
	fu?.close(), fu = null;
}
//#endregion
//#region electron/transports/unix.ts
var gu = null, Q = null;
function _u(e) {
	if (Q = o(e, "bridge.sock"), ee(Q)) try {
		ne(Q);
	} catch {}
	gu = ge((e) => {
		e.setEncoding("utf8");
		let t = "";
		e.on("data", (n) => {
			t += n;
			let r = t.indexOf("\n");
			if (r === -1) return;
			let i = t.slice(0, r);
			t = t.slice(r + 1);
			let a;
			try {
				let e = JSON.parse(i), t = uu(e.method, e.args ?? null, { caller: "unix" });
				a = JSON.stringify({ result: t });
			} catch (e) {
				a = JSON.stringify({ error: e.message });
			}
			e.end(a + "\n");
		}), e.on("error", (e) => {
			console.error("[bridge:unix] socket error:", e);
		});
	}), gu.on("error", (e) => {
		console.error("[bridge:unix] server error:", e), gu = null;
	}), gu.listen({
		path: Q,
		readableAll: !1,
		writableAll: !1
	}, () => {
		console.log(`[bridge] unix socket at ${Q}`);
	});
}
function vu() {
	if (gu?.close(), gu = null, Q && ee(Q)) try {
		ne(Q);
	} catch {}
	Q = null;
}
//#endregion
//#region electron/main.ts
var yu = a.dirname(u(import.meta.url));
process.env.APP_ROOT = a.join(yu, "..");
var bu = process.env.VITE_DEV_SERVER_URL, xu = a.join(process.env.APP_ROOT, "dist"), Su = "window.bounds", Cu = {
	width: 1200,
	height: 800
}, $ = null;
function wu() {
	let e = Te(Su);
	if (!e) return null;
	try {
		let t = JSON.parse(e);
		return r.getAllDisplays().some((e) => {
			let n = e.workArea;
			return t.x < n.x + n.width && t.x + t.width > n.x && t.y < n.y + n.height && t.y + t.height > n.y;
		}) ? t : null;
	} catch {
		return null;
	}
}
function Tu() {
	if (!$ || $.isDestroyed() || $.isMinimized()) return;
	let { x: e, y: t, width: n, height: r } = $.getBounds();
	Ee(Su, JSON.stringify({
		x: e,
		y: t,
		width: n,
		height: r
	}));
}
function Eu() {
	let t = wu();
	$ = new e({
		...Cu,
		...t ?? {},
		webPreferences: {
			preload: a.join(yu, "preload.js"),
			sandbox: !1
		}
	}), t || $.center(), $.on("resized", Tu), $.on("moved", Tu), bu ? $.loadURL(bu) : $.loadFile(a.join(xu, "index.html"));
}
t.requestSingleInstanceLock() ? (t.on("second-instance", () => {
	$ && ($.isMinimized() && $.restore(), $.focus());
}), t.whenReady().then(() => {
	let e = t.getPath("userData");
	ve(a.join(e, "global.db")), En(e, Xn), Bn(Qn), Mn((Fn() ?? Rn()).uuid), Un(), Sn(), Wn(), qn(), Yn(), Zn(), $n(e), mu(), _u(e), Eu();
})) : t.quit(), t.on("before-quit", () => {
	Tu(), bn(), hu(), vu(), Nn(), ye();
}), t.on("window-all-closed", () => {
	process.platform !== "darwin" && t.quit(), $ = null;
}), t.on("activate", () => {
	e.getAllWindows().length === 0 && Eu();
});
//#endregion
