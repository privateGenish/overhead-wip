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
//#region electron/db/sqlite.ts
var g = null;
function _e(e) {
	if (!g) {
		g = new d(e), g.exec("PRAGMA foreign_keys = ON"), g.exec("\n    CREATE TABLE IF NOT EXISTS tickets (\n      uuid        TEXT PRIMARY KEY,\n      id          TEXT NOT NULL,\n      title       TEXT NOT NULL,\n      type        TEXT NOT NULL CHECK(type IN ('Explore', 'Feature', 'Execute')),\n      status      TEXT NOT NULL,\n      backlog     INTEGER NOT NULL DEFAULT 0,\n      description TEXT NOT NULL DEFAULT '',\n      archived    INTEGER NOT NULL DEFAULT 0,\n      created_at  INTEGER NOT NULL,\n      updated_at  INTEGER NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS settings (\n      key   TEXT PRIMARY KEY,\n      value TEXT NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS ticket_history (\n      ticket_uuid  TEXT    NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,\n      ts           INTEGER NOT NULL,\n      description  TEXT    NOT NULL,\n      hash         TEXT    NOT NULL,\n      PRIMARY KEY (ticket_uuid, ts)\n    );\n\n    CREATE TABLE IF NOT EXISTS ticket_relations (\n      uuid   TEXT NOT NULL UNIQUE,\n      node_a TEXT NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,\n      node_b TEXT NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,\n      type   TEXT NOT NULL CHECK(type IN ('relates-to', 'blocked-by')),\n      PRIMARY KEY (node_a, node_b, type),\n      CHECK (type != 'relates-to' OR node_a < node_b)\n    );\n\n    CREATE TABLE IF NOT EXISTS graph_views (\n      uuid       TEXT PRIMARY KEY,\n      name       TEXT NOT NULL,\n      created_at INTEGER NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS graph_view_nodes (\n      view_uuid   TEXT NOT NULL REFERENCES graph_views(uuid) ON DELETE CASCADE,\n      ticket_uuid TEXT NOT NULL REFERENCES tickets(uuid)     ON DELETE CASCADE,\n      x           REAL NOT NULL DEFAULT 0,\n      y           REAL NOT NULL DEFAULT 0,\n      PRIMARY KEY (view_uuid, ticket_uuid)\n    );\n\n    CREATE TABLE IF NOT EXISTS graph_view_edges (\n      uuid          TEXT PRIMARY KEY,\n      view_uuid     TEXT NOT NULL REFERENCES graph_views(uuid) ON DELETE CASCADE,\n      source_uuid   TEXT NOT NULL REFERENCES tickets(uuid)     ON DELETE CASCADE,\n      target_uuid   TEXT NOT NULL REFERENCES tickets(uuid)     ON DELETE CASCADE,\n      source_handle TEXT,\n      target_handle TEXT\n    );\n\n  ");
		try {
			g.exec("ALTER TABLE graph_view_edges ADD COLUMN source_handle TEXT");
		} catch {}
		try {
			g.exec("ALTER TABLE graph_view_edges ADD COLUMN target_handle TEXT");
		} catch {}
	}
}
function ve() {
	if (!g) throw Error("SQLite not initialised — call initSqlite() first.");
	return g;
}
function ye(e, t) {
	if (!t.trim()) return;
	let n = f("sha256").update(t).digest("hex");
	if (ve().prepare("SELECT hash FROM ticket_history WHERE ticket_uuid = ? ORDER BY ts DESC LIMIT 1").get(e)?.hash === n) return;
	let r = Math.floor(Date.now() / 1e3);
	ve().prepare("INSERT OR REPLACE INTO ticket_history (ticket_uuid, ts, description, hash) VALUES (?, ?, ?, ?)").run(e, r, t, n);
}
function be(e) {
	return ve().prepare("SELECT ts, description FROM ticket_history WHERE ticket_uuid = ? ORDER BY ts DESC").all(e);
}
function _(e, t = []) {
	let n = ve().prepare(e);
	return /^\s*SELECT/i.test(e) ? n.all(...t) : n.run(...t);
}
//#endregion
//#region electron/vault/vaultManager.ts
var v = "", y = /* @__PURE__ */ new Map();
function xe(e) {
	v = e, h.mkdirSync(e, { recursive: !0 }), Ce();
}
function Se() {
	return v;
}
function Ce() {
	y.clear();
	for (let e of h.readdirSync(v)) {
		if (!e.endsWith(".md")) continue;
		let t = h.readFileSync(a.join(v, e), "utf8").match(/^uuid:\s*(.+)$/m);
		t && y.set(t[1].trim(), e);
	}
}
function we(e) {
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
function Te(e) {
	if (!v) return;
	let t = _("SELECT * FROM tickets WHERE uuid = ? LIMIT 1", [e])[0];
	if (!t || t.archived === 1) {
		Ee(e);
		return;
	}
	let n = `${t.id}.md`, r = a.join(v, n), i = y.get(e);
	i && i !== n && h.rmSync(a.join(v, i), { force: !0 });
	let o = `${we(t)}\n\n${t.description}`;
	h.writeFileSync(r, o, "utf8"), y.set(e, n);
}
function Ee(e) {
	if (!v) return;
	let t = y.get(e);
	t && (h.rmSync(a.join(v, t), { force: !0 }), y.delete(e));
}
function De() {
	v && (h.rmSync(v, {
		recursive: !0,
		force: !0
	}), h.mkdirSync(v, { recursive: !0 }), y.clear());
}
//#endregion
//#region node_modules/readdirp/index.js
var b = {
	FILE_TYPE: "files",
	DIR_TYPE: "directories",
	FILE_DIR_TYPE: "files_directories",
	EVERYTHING_TYPE: "all"
}, Oe = {
	root: ".",
	fileFilter: (e) => !0,
	directoryFilter: (e) => !0,
	type: b.FILE_TYPE,
	lstat: !1,
	depth: 2147483648,
	alwaysStat: !1,
	highWaterMark: 4096
};
Object.freeze(Oe);
var ke = "READDIRP_RECURSIVE_ERROR", Ae = new Set([
	"ENOENT",
	"EPERM",
	"EACCES",
	"ELOOP",
	ke
]), je = [
	b.DIR_TYPE,
	b.EVERYTHING_TYPE,
	b.FILE_DIR_TYPE,
	b.FILE_TYPE
], Me = new Set([
	b.DIR_TYPE,
	b.EVERYTHING_TYPE,
	b.FILE_DIR_TYPE
]), Ne = new Set([
	b.EVERYTHING_TYPE,
	b.FILE_DIR_TYPE,
	b.FILE_TYPE
]), Pe = (e) => Ae.has(e.code), Fe = process.platform === "win32", Ie = (e) => !0, Le = (e) => {
	if (e === void 0) return Ie;
	if (typeof e == "function") return e;
	if (typeof e == "string") {
		let t = e.trim();
		return (e) => e.basename === t;
	}
	if (Array.isArray(e)) {
		let t = e.map((e) => e.trim());
		return (e) => t.some((t) => e.basename === t);
	}
	return Ie;
}, Re = class extends pe {
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
			...Oe,
			...e
		}, { root: n, type: r } = t;
		this._fileFilter = Le(t.fileFilter), this._directoryFilter = Le(t.directoryFilter);
		let i = t.lstat ? ce : fe;
		Fe ? this._stat = (e) => i(e, { bigint: !0 }) : this._stat = i, this._maxDepth = t.depth != null && Number.isSafeInteger(t.depth) ? t.depth : Oe.depth, this._wantsDir = r ? Me.has(r) : !1, this._wantsFile = r ? Ne.has(r) : !1, this._wantsEverything = r === b.EVERYTHING_TYPE, this._root = c(n), this._isDirent = !t.alwaysStat, this._statsProp = this._isDirent ? "dirent" : "stats", this._rdOptions = {
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
		Pe(e) && !this.destroyed ? this.emit("warn", e) : this.destroy(e);
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
						return n.code = ke, this._onError(n);
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
function ze(e, t = {}) {
	let n = t.entryType || t.type;
	if (n === "both" && (n = b.FILE_DIR_TYPE), n && (t.type = n), !e) throw Error("readdirp: root argument is required. Usage: readdirp(root, options)");
	if (typeof e != "string") throw TypeError("readdirp: root argument must be a string. Usage: readdirp(root, options)");
	if (n && !je.includes(n)) throw Error(`readdirp: Invalid type passed. Use one of ${je.join(", ")}`);
	return t.root = e, new Re(t);
}
//#endregion
//#region node_modules/chokidar/handler.js
var Be = "data", Ve = "close", He = () => {}, Ue = process.platform, We = Ue === "win32", Ge = Ue === "darwin", Ke = Ue === "linux", qe = Ue === "freebsd", Je = me() === "OS400", x = {
	ALL: "all",
	READY: "ready",
	ADD: "add",
	CHANGE: "change",
	ADD_DIR: "addDir",
	UNLINK: "unlink",
	UNLINK_DIR: "unlinkDir",
	RAW: "raw",
	ERROR: "error"
}, S = x, Ye = "watch", Xe = {
	lstat: ce,
	stat: fe
}, C = "listeners", Ze = "errHandlers", w = "rawEmitters", Qe = [
	C,
	Ze,
	w
], $e = new Set(/* @__PURE__ */ "3dm.3ds.3g2.3gp.7z.a.aac.adp.afdesign.afphoto.afpub.ai.aif.aiff.alz.ape.apk.appimage.ar.arj.asf.au.avi.bak.baml.bh.bin.bk.bmp.btif.bz2.bzip2.cab.caf.cgm.class.cmx.cpio.cr2.cur.dat.dcm.deb.dex.djvu.dll.dmg.dng.doc.docm.docx.dot.dotm.dra.DS_Store.dsk.dts.dtshd.dvb.dwg.dxf.ecelp4800.ecelp7470.ecelp9600.egg.eol.eot.epub.exe.f4v.fbs.fh.fla.flac.flatpak.fli.flv.fpx.fst.fvt.g3.gh.gif.graffle.gz.gzip.h261.h263.h264.icns.ico.ief.img.ipa.iso.jar.jpeg.jpg.jpgv.jpm.jxr.key.ktx.lha.lib.lvp.lz.lzh.lzma.lzo.m3u.m4a.m4v.mar.mdi.mht.mid.midi.mj2.mka.mkv.mmr.mng.mobi.mov.movie.mp3.mp4.mp4a.mpeg.mpg.mpga.mxu.nef.npx.numbers.nupkg.o.odp.ods.odt.oga.ogg.ogv.otf.ott.pages.pbm.pcx.pdb.pdf.pea.pgm.pic.png.pnm.pot.potm.potx.ppa.ppam.ppm.pps.ppsm.ppsx.ppt.pptm.pptx.psd.pya.pyc.pyo.pyv.qt.rar.ras.raw.resources.rgb.rip.rlc.rmf.rmvb.rpm.rtf.rz.s3m.s7z.scpt.sgi.shar.snap.sil.sketch.slk.smv.snk.so.stl.suo.sub.swf.tar.tbz.tbz2.tga.tgz.thmx.tif.tiff.tlz.ttc.ttf.txz.udf.uvh.uvi.uvm.uvp.uvs.uvu.viv.vob.war.wav.wax.wbmp.wdp.weba.webm.webp.whl.wim.wm.wma.wmv.wmx.woff.woff2.wrm.wvx.xbm.xif.xla.xlam.xls.xlsb.xlsm.xlsx.xlt.xltm.xltx.xm.xmind.xpi.xpm.xwd.xz.z.zip.zipx".split(".")), et = (e) => $e.has(i.extname(e).slice(1).toLowerCase()), tt = (e, t) => {
	e instanceof Set ? e.forEach(t) : t(e);
}, nt = (e, t, n) => {
	let r = e[t];
	r instanceof Set || (e[t] = r = new Set([r])), r.add(n);
}, rt = (e) => (t) => {
	let n = e[t];
	n instanceof Set ? n.clear() : delete e[t];
}, T = (e, t, n) => {
	let r = e[t];
	r instanceof Set ? r.delete(n) : r === n && delete e[t];
}, it = (e) => e instanceof Set ? e.size === 0 : !e, at = /* @__PURE__ */ new Map();
function ot(e, t, n, r, a) {
	let o = (t, r) => {
		n(e), a(t, r, { watchedPath: e }), r && e !== r && st(i.resolve(e, r), C, i.join(e, r));
	};
	try {
		return ie(e, { persistent: t.persistent }, o);
	} catch (e) {
		r(e);
		return;
	}
}
var st = (e, t, n, r, i) => {
	let a = at.get(e);
	a && tt(a[t], (e) => {
		e(n, r, i);
	});
}, ct = (e, t, n, r) => {
	let { listener: i, errHandler: a, rawEmitter: o } = r, s = at.get(t), c;
	if (!n.persistent) return c = ot(e, n, i, a, o), c ? c.close.bind(c) : void 0;
	if (s) nt(s, C, i), nt(s, Ze, a), nt(s, w, o);
	else {
		if (c = ot(e, n, st.bind(null, t, C), a, st.bind(null, t, w)), !c) return;
		c.on(S.ERROR, async (n) => {
			let r = st.bind(null, t, Ze);
			if (s && (s.watcherUnusable = !0), We && n.code === "EPERM") try {
				await (await le(e, "r")).close(), r(n);
			} catch {}
			else r(n);
		}), s = {
			listeners: i,
			errHandlers: a,
			rawEmitters: o,
			watcher: c
		}, at.set(t, s);
	}
	return () => {
		T(s, C, i), T(s, Ze, a), T(s, w, o), it(s.listeners) && (s.watcher.close(), at.delete(t), Qe.forEach(rt(s)), s.watcher = void 0, Object.freeze(s));
	};
}, lt = /* @__PURE__ */ new Map(), ut = (e, t, n, r) => {
	let { listener: i, rawEmitter: a } = r, o = lt.get(t), s = o && o.options;
	return s && (s.persistent < n.persistent || s.interval > n.interval) && (re(t), o = void 0), o ? (nt(o, C, i), nt(o, w, a)) : (o = {
		listeners: i,
		rawEmitters: a,
		options: n,
		watcher: ae(t, n, (n, r) => {
			tt(o.rawEmitters, (e) => {
				e(S.CHANGE, t, {
					curr: n,
					prev: r
				});
			});
			let i = n.mtimeMs;
			(n.size !== r.size || i > r.mtimeMs || i === 0) && tt(o.listeners, (t) => t(e, n));
		})
	}, lt.set(t, o)), () => {
		T(o, C, i), T(o, w, a), it(o.listeners) && (lt.delete(t), re(t), o.options = o.watcher = void 0, Object.freeze(o));
	};
}, dt = class {
	fsw;
	_boundHandleError;
	constructor(e) {
		this.fsw = e, this._boundHandleError = (t) => e._handleError(t);
	}
	_watchWithNodeFs(e, t) {
		let n = this.fsw.options, r = i.dirname(e), a = i.basename(e);
		this.fsw._getWatchedDir(r).add(a);
		let o = i.resolve(e), s = { persistent: n.persistent };
		t ||= He;
		let c;
		return n.usePolling ? (s.interval = n.interval !== n.binaryInterval && et(a) ? n.binaryInterval : n.interval, c = ut(e, o, s, {
			listener: t,
			rawEmitter: this.fsw._emitRaw
		})) : c = ct(e, o, s, {
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
			if (this.fsw._throttle(Ye, e, 5)) {
				if (!n || n.mtimeMs === 0) try {
					let n = await fe(e);
					if (this.fsw.closed) return;
					let r = n.atimeMs, i = n.mtimeMs;
					if ((!r || r <= i || i !== s.mtimeMs) && this.fsw._emit(S.CHANGE, e, n), (Ge || Ke || qe) && s.ino !== n.ino) {
						this.fsw._closeFile(t), s = n;
						let r = this._watchWithNodeFs(e, c);
						r && this.fsw._addPathCloser(t, r);
					} else s = n;
				} catch {
					this.fsw._remove(r, a);
				}
				else if (o.has(a)) {
					let t = n.atimeMs, r = n.mtimeMs;
					(!t || t <= r || r !== s.mtimeMs) && this.fsw._emit(S.CHANGE, e, n), s = n;
				}
			}
		}, l = this._watchWithNodeFs(e, c);
		if (!(n && this.fsw.options.ignoreInitial) && this.fsw._isntIgnored(e)) {
			if (!this.fsw._throttle(S.ADD, e, 0)) return;
			this.fsw._emit(S.ADD, e, t);
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
			return this.fsw.closed ? void 0 : (a.has(r) ? this.fsw._symlinkPaths.get(i) !== t && (this.fsw._symlinkPaths.set(i, t), this.fsw._emit(S.CHANGE, n, e.stats)) : (a.add(r), this.fsw._symlinkPaths.set(i, t), this.fsw._emit(S.ADD, n, e.stats)), this.fsw._emitReady(), !0);
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
		if (d) return d.on(Be, async (s) => {
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
		}).on(S.ERROR, this._boundHandleError), new Promise((t, i) => {
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
		!(n && this.fsw.options.ignoreInitial) && !a && !l && this.fsw._emit(S.ADD_DIR, e, t), c.add(i.basename(e)), this.fsw._getWatchedDir(e);
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
			let n = await Xe[s.statMethod](s.watchPath);
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
				if (this.fsw._getWatchedDir(o).add(s.watchPath), this.fsw._emit(S.ADD, s.watchPath, n), l = await this._handleDir(o, n, t, r, e, s, a), this.fsw.closed) return;
				a !== void 0 && this.fsw._symlinkPaths.set(i.resolve(e), a);
			} else l = this._handleFile(s.watchPath, n, t);
			return o(), l && this.fsw._addPathCloser(e, l), !1;
		} catch (t) {
			if (this.fsw._handleError(t)) return o(), e;
		}
	}
}, ft = "/", pt = "//", mt = ".", ht = "..", gt = "string", _t = /\\/g, vt = /\/\//g, yt = /\..*\.(sw[px])$|~$|\.subl.*\.tmp/, bt = /^\.[/\\]/;
function xt(e) {
	return Array.isArray(e) ? e : [e];
}
var St = (e) => typeof e == "object" && !!e && !(e instanceof RegExp);
function Ct(e) {
	return typeof e == "function" ? e : typeof e == "string" ? (t) => e === t : e instanceof RegExp ? (t) => e.test(t) : typeof e == "object" && e ? (t) => {
		if (e.path === t) return !0;
		if (e.recursive) {
			let n = i.relative(e.path, t);
			return n ? !n.startsWith("..") && !i.isAbsolute(n) : !1;
		}
		return !1;
	} : () => !1;
}
function wt(e) {
	if (typeof e != "string") throw Error("string expected");
	e = i.normalize(e), e = e.replace(/\\/g, "/");
	let t = !1;
	return e.startsWith("//") && (t = !0), e = e.replace(vt, "/"), t && (e = "/" + e), e;
}
function Tt(e, t, n) {
	let r = wt(t);
	for (let t = 0; t < e.length; t++) {
		let i = e[t];
		if (i(r, n)) return !0;
	}
	return !1;
}
function Et(e, t) {
	if (e == null) throw TypeError("anymatch: specify first argument");
	let n = xt(e).map((e) => Ct(e));
	return t == null ? (e, t) => Tt(n, e, t) : Tt(n, t);
}
var Dt = (e) => {
	let t = xt(e).flat();
	if (!t.every((e) => typeof e === gt)) throw TypeError(`Non-string provided as watch path: ${t}`);
	return t.map(kt);
}, Ot = (e) => {
	let t = e.replace(_t, ft), n = !1;
	return t.startsWith(pt) && (n = !0), t = t.replace(vt, ft), n && (t = ft + t), t;
}, kt = (e) => Ot(i.normalize(Ot(e))), At = (e = "") => (t) => typeof t == "string" ? kt(i.isAbsolute(t) ? t : i.join(e, t)) : t, jt = (e, t) => i.isAbsolute(e) ? e : i.join(t, e), Mt = Object.freeze(/* @__PURE__ */ new Set()), Nt = class {
	path;
	_removeWatcher;
	items;
	constructor(e, t) {
		this.path = e, this._removeWatcher = t, this.items = /* @__PURE__ */ new Set();
	}
	add(e) {
		let { items: t } = this;
		t && e !== mt && e !== ht && t.add(e);
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
		this.items.clear(), this.path = "", this._removeWatcher = He, this.items = Mt, Object.freeze(this);
	}
}, Pt = "stat", Ft = "lstat", It = class {
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
		this.path = e = e.replace(bt, ""), this.watchPath = r, this.fullWatchPath = i.resolve(r), this.dirParts = [], this.dirParts.forEach((e) => {
			e.length > 1 && e.pop();
		}), this.followSymlinks = t, this.statMethod = t ? Pt : Ft;
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
}, Lt = class extends se {
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
			ignored: e.ignored ? xt(e.ignored) : xt([]),
			awaitWriteFinish: t === !0 ? n : typeof t == "object" ? {
				...n,
				...t
			} : !1
		};
		Je && (r.usePolling = !0), r.atomic === void 0 && (r.atomic = !r.usePolling);
		let i = process.env.CHOKIDAR_USEPOLLING;
		if (i !== void 0) {
			let e = i.toLowerCase();
			e === "false" || e === "0" ? r.usePolling = !1 : e === "true" || e === "1" ? r.usePolling = !0 : r.usePolling = !!e;
		}
		let a = process.env.CHOKIDAR_INTERVAL;
		a && (r.interval = Number.parseInt(a, 10));
		let o = 0;
		this._emitReady = () => {
			o++, o >= this._readyCount && (this._emitReady = He, this._readyEmitted = !0, process.nextTick(() => this.emit(x.READY)));
		}, this._emitRaw = (...e) => this.emit(x.RAW, ...e), this._boundRemove = this._remove.bind(this), this.options = r, this._nodeFsHandler = new dt(this), Object.freeze(r);
	}
	_addIgnoredPath(e) {
		if (St(e)) {
			for (let t of this._ignoredPaths) if (St(t) && t.path === e.path && t.recursive === e.recursive) return;
		}
		this._ignoredPaths.add(e);
	}
	_removeIgnoredPath(e) {
		if (this._ignoredPaths.delete(e), typeof e == "string") for (let t of this._ignoredPaths) St(t) && t.path === e && this._ignoredPaths.delete(t);
	}
	add(e, t, n) {
		let { cwd: r } = this.options;
		this.closed = !1, this._closePromise = void 0;
		let a = Dt(e);
		return r && (a = a.map((e) => jt(e, r))), a.forEach((e) => {
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
		let t = Dt(e), { cwd: n } = this.options;
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
			let r = (this.options.cwd ? i.relative(this.options.cwd, n) : n) || mt;
			e[r] = t.getChildren().sort();
		}), e;
	}
	emitWithAll(e, t) {
		this.emit(e, ...t), e !== x.ERROR && this.emit(x.ALL, e, ...t);
	}
	async _emit(e, t, n) {
		if (this.closed) return;
		let r = this.options;
		We && (t = i.normalize(t)), r.cwd && (t = i.relative(r.cwd, t));
		let a = [t];
		n != null && a.push(n);
		let o = r.awaitWriteFinish, s;
		if (o && (s = this._pendingWrites.get(t))) return s.lastChange = /* @__PURE__ */ new Date(), this;
		if (r.atomic) {
			if (e === x.UNLINK) return this._pendingUnlinks.set(t, [e, ...a]), setTimeout(() => {
				this._pendingUnlinks.forEach((e, t) => {
					this.emit(...e), this.emit(x.ALL, ...e), this._pendingUnlinks.delete(t);
				});
			}, typeof r.atomic == "number" ? r.atomic : 100), this;
			e === x.ADD && this._pendingUnlinks.has(t) && (e = x.CHANGE, this._pendingUnlinks.delete(t));
		}
		if (o && (e === x.ADD || e === x.CHANGE) && this._readyEmitted) return this._awaitWriteFinish(t, o.stabilityThreshold, e, (t, n) => {
			t ? (e = x.ERROR, a[0] = t, this.emitWithAll(e, a)) : n && (a.length > 1 ? a[1] = n : a.push(n), this.emitWithAll(e, a));
		}), this;
		if (e === x.CHANGE && !this._throttle(x.CHANGE, t, 50)) return this;
		if (r.alwaysStat && n === void 0 && (e === x.ADD || e === x.ADD_DIR || e === x.CHANGE)) {
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
		return e && t !== "ENOENT" && t !== "ENOTDIR" && (!this.options.ignorePermissionErrors || t !== "EPERM" && t !== "EACCES") && this.emit(x.ERROR, e), e || this.closed;
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
		if (this.options.atomic && yt.test(e)) return !0;
		if (!this._userIgnored) {
			let { cwd: e } = this.options, t = (this.options.ignored || []).map(At(e)), n = [...[...this._ignoredPaths].map(At(e)), ...t];
			this._userIgnored = Et(n, void 0);
		}
		return this._userIgnored(e, t);
	}
	_isntIgnored(e, t) {
		return !this._isIgnored(e, t);
	}
	_getWatchHelpers(e) {
		return new It(e, this.options.followSymlinks, this);
	}
	_getWatchedDir(e) {
		let t = i.resolve(e);
		return this._watched.has(t) || this._watched.set(t, new Nt(t, this._boundRemove)), this._watched.get(t);
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
		if (this.options.cwd && (c = i.relative(this.options.cwd, r)), this.options.awaitWriteFinish && this._pendingWrites.has(c) && this._pendingWrites.get(c).cancelWait() === x.ADD) return;
		this._watched.delete(r), this._watched.delete(a);
		let l = n ? x.UNLINK_DIR : x.UNLINK;
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
		let n = ze(e, {
			type: x.ALL,
			alwaysStat: !0,
			lstat: !0,
			...t,
			depth: 0
		});
		return this._streams.add(n), n.once(Ve, () => {
			n = void 0;
		}), n.once("end", () => {
			n &&= (this._streams.delete(n), void 0);
		}), n;
	}
};
function Rt(e, t = {}) {
	let n = new Lt(t);
	return n.add(e), n;
}
//#endregion
//#region electron/vault/vaultWatcher.ts
var E = null;
function zt(e) {
	let t = e.trim();
	return t === "true" ? !0 : t === "false" ? !1 : t.replace(/^(['"])(.*)\1$/, "$2");
}
function Bt(e) {
	let t = e.replace(/^\uFEFF/, ""), n = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/.exec(t);
	if (!n) return null;
	let r = {};
	for (let e of n[1].split(/\r?\n/)) {
		if (!e.trim()) continue;
		let t = e.indexOf(":");
		if (t === -1) continue;
		let n = e.slice(0, t).trim();
		n && (r[n] = zt(e.slice(t + 1)));
	}
	return {
		frontmatter: r,
		body: n[2].replace(/^\r?\n/, "")
	};
}
function Vt(e) {
	return _("SELECT uuid, description, updated_at FROM tickets WHERE uuid = ? LIMIT 1", [e])[0] ?? null;
}
function Ht(e, t, n) {
	let r, i;
	try {
		if (r = h.statSync(e), !r.isFile()) return !1;
		i = h.readFileSync(e, "utf8");
	} catch (t) {
		return console.warn(`Vault watcher skipped unreadable file: ${e}`, t), !1;
	}
	let a = Bt(i);
	if (!a) return console.warn(`Vault watcher skipped malformed markdown: ${e}`), !1;
	let o = t ?? a.frontmatter.uuid;
	if (typeof o != "string" || !o.trim()) return console.warn(`Vault watcher skipped markdown without uuid: ${e}`), !1;
	let s = a.body;
	if (!s.trim()) return !1;
	let c = Vt(o);
	return c ? r.mtime.getTime() <= c.updated_at || c.description === s ? !1 : (_("UPDATE tickets SET description = ?, updated_at = ? WHERE uuid = ?", [
		s,
		r.mtime.getTime(),
		o
	]), n?.(o), !0) : (console.warn(`Vault watcher could not find ticket for uuid: ${o}`), !1);
}
function Ut(e) {
	return a.extname(e).toLowerCase() === ".md";
}
function Wt(e, t) {
	Ut(e) && Ht(e, void 0, t);
}
function Gt(e, t) {
	return Kt(), E = Rt(e, {
		ignoreInitial: !0,
		awaitWriteFinish: {
			stabilityThreshold: 100,
			pollInterval: 25
		},
		ignored: (e, t) => t?.isFile() ? !Ut(e) : !1
	}), E.on("add", (e) => Wt(e, t)), E.on("change", (e) => Wt(e, t)), E.on("error", (e) => {
		console.warn("Vault watcher error:", e);
	}), E;
}
async function Kt() {
	let e = E;
	E = null, e && await e.close();
}
//#endregion
//#region electron/ipc/generalAPI.ts
var qt = /\b(tickets|ticket_history|ticket_relations|pending_sync)\b/i;
function Jt() {
	n.handle("db:query", (e, t, n = []) => {
		if (typeof t != "string") throw Error("db:query expects a SQL string.");
		if (qt.test(t)) throw Error("db:query cannot access ticket tables — use db:ticket instead.");
		return _(t, n);
	});
}
//#endregion
//#region electron/ipc/ticketAPI.ts
var Yt = /\btickets\b/i, Xt = /^\s*SELECT/i, Zt = /^\s*DELETE/i, Qt = /DELETE\s+FROM\s+tickets\s*$/i, $t = 3e4, en = /* @__PURE__ */ new Map();
function tn(e) {
	if (typeof e != "string") throw Error("db:ticket expects a SQL string.");
	if (!Yt.test(e)) throw Error("db:ticket only accepts queries on ticket tables.");
}
function nn(e) {
	return _("SELECT description FROM tickets WHERE uuid = ? LIMIT 1", [e])?.[0]?.description ?? null;
}
function rn(e) {
	en.delete(e);
	let t = nn(e);
	t !== null && ye(e, t);
}
function an(e) {
	if (!e) return;
	let t = en.get(e);
	t && clearTimeout(t), en.set(e, setTimeout(() => rn(e), $t));
}
function on() {
	for (let [e, t] of en) {
		clearTimeout(t);
		let n = nn(e);
		n !== null && ye(e, n);
	}
	en.clear();
}
function sn(e, t = []) {
	tn(e), Qt.test(e) ? De() : Zt.test(e) && Ee(t[0]);
	let n = _(e, t);
	if (!Xt.test(e) && !Zt.test(e)) {
		let e = t[0];
		an(e), e && Te(e);
	}
	return n;
}
function cn() {
	n.handle("db:ticket", (e, t, n = []) => sn(t, n));
}
//#endregion
//#region electron/ipc/historyAPI.ts
function ln() {
	n.handle("db:history", (e, t) => {
		if (typeof t != "string") throw Error("db:history expects a ticket UUID string.");
		return be(t);
	}), n.handle("db:history:flush", (e, t) => {
		if (typeof t != "string") throw Error("db:history:flush expects a ticket UUID string.");
		rn(t);
	});
}
//#endregion
//#region electron/ipc/relationsAPI.ts
function un(e, t) {
	if (typeof e != "string" || !e) throw Error(`db:relation: ${t} must be a non-empty string.`);
	return e;
}
function dn(e, t) {
	if (typeof e != "string") throw Error("db:relation: op must be a string.");
	if (typeof t != "object" || !t) throw Error("db:relation: payload must be an object.");
	if (e === "add") {
		let { type: e, node_a: n, node_b: r } = t;
		if (un(e, "type"), un(n, "node_a"), un(r, "node_b"), e !== "relates-to" && e !== "blocked-by") throw Error(`db:relation: unknown type "${e}".`);
		if (n === r) throw Error("db:relation: a ticket cannot relate to itself.");
		let [i, a] = e === "relates-to" && n > r ? [r, n] : [n, r], o = m();
		return _("INSERT INTO ticket_relations (uuid, node_a, node_b, type) VALUES (?, ?, ?, ?)", [
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
		un(e, "uuid"), _("DELETE FROM ticket_relations WHERE uuid = ?", [e]);
		return;
	}
	if (e === "list") {
		let { ticketUuid: e } = t;
		return un(e, "ticketUuid"), _("SELECT uuid, node_a, node_b, type FROM ticket_relations WHERE node_a = ? OR node_b = ?", [e, e]);
	}
	if (e === "listAll") return _("SELECT uuid, node_a, node_b, type FROM ticket_relations", []);
	throw Error(`db:relation: unknown op "${e}".`);
}
function fn() {
	n.handle("db:relation", (e, t, n) => dn(t, n));
}
//#endregion
//#region electron/ipc/graphAPI.ts
function D(e, t) {
	if (typeof e != "string" || !e) throw Error(`db:graph: ${t} must be a non-empty string.`);
	return e;
}
function pn(e, t) {
	if (typeof e != "number") throw Error(`db:graph: ${t} must be a number.`);
	return e;
}
function mn() {
	n.handle("db:graph", (e, t, n) => {
		if (typeof t != "string") throw Error("db:graph: op must be a string.");
		if (typeof n != "object" || !n) throw Error("db:graph: payload must be an object.");
		let r = n;
		if (t === "view:list") return _("SELECT uuid, name, created_at FROM graph_views ORDER BY created_at ASC", []);
		if (t === "view:create") {
			let e = D(r.name, "name"), t = m(), n = Date.now();
			return _("INSERT INTO graph_views (uuid, name, created_at) VALUES (?, ?, ?)", [
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
			let e = D(r.uuid, "uuid");
			_("UPDATE graph_views SET name = ? WHERE uuid = ?", [D(r.name, "name"), e]);
			return;
		}
		if (t === "view:delete") {
			_("DELETE FROM graph_views WHERE uuid = ?", [D(r.uuid, "uuid")]);
			return;
		}
		if (t === "node:list") return _("SELECT ticket_uuid, x, y FROM graph_view_nodes WHERE view_uuid = ?", [D(r.viewUuid, "viewUuid")]);
		if (t === "node:upsert") {
			_("INSERT INTO graph_view_nodes (view_uuid, ticket_uuid, x, y)\n         VALUES (?, ?, ?, ?)\n         ON CONFLICT(view_uuid, ticket_uuid) DO UPDATE SET x = excluded.x, y = excluded.y", [
				D(r.viewUuid, "viewUuid"),
				D(r.ticketUuid, "ticketUuid"),
				pn(r.x, "x"),
				pn(r.y, "y")
			]);
			return;
		}
		if (t === "node:remove") {
			_("DELETE FROM graph_view_nodes WHERE view_uuid = ? AND ticket_uuid = ?", [D(r.viewUuid, "viewUuid"), D(r.ticketUuid, "ticketUuid")]);
			return;
		}
		if (t === "edge:list") return _("SELECT uuid, source_uuid, target_uuid, source_handle, target_handle FROM graph_view_edges WHERE view_uuid = ?", [D(r.viewUuid, "viewUuid")]);
		if (t === "edge:create") {
			let e = D(r.viewUuid, "viewUuid"), t = D(r.sourceUuid, "sourceUuid"), n = D(r.targetUuid, "targetUuid"), i = typeof r.sourceHandle == "string" ? r.sourceHandle : null, a = typeof r.targetHandle == "string" ? r.targetHandle : null, o = m();
			return _("INSERT INTO graph_view_edges (uuid, view_uuid, source_uuid, target_uuid, source_handle, target_handle) VALUES (?, ?, ?, ?, ?, ?)", [
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
			_("DELETE FROM graph_view_edges WHERE uuid = ?", [D(r.uuid, "uuid")]);
			return;
		}
		throw Error(`db:graph: unknown op "${t}".`);
	});
}
//#endregion
//#region electron/ipc/notify.ts
function hn(t) {
	for (let n of e.getAllWindows()) n.webContents.send("vault:ticket-updated", t);
}
function O() {
	for (let t of e.getAllWindows()) t.webContents.send("graph:updated");
}
function gn(e) {
	let t = p(32).toString("hex");
	return oe(o(e, "bridge.token"), t, {
		encoding: "utf8",
		mode: 384
	}), t;
}
//#endregion
//#region electron/bridge/gate.ts
function _n(e, t) {
	t.caller;
}
//#endregion
//#region node_modules/zod/v4/core/core.js
var vn;
function k(e, t, n) {
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
var A = class extends Error {
	constructor() {
		super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
	}
}, yn = class extends Error {
	constructor(e) {
		super(`Encountered unidirectional transform during encode: ${e}`), this.name = "ZodEncodeError";
	}
};
(vn = globalThis).__zod_globalConfig ?? (vn.__zod_globalConfig = {});
var bn = globalThis.__zod_globalConfig;
function j(e) {
	return e && Object.assign(bn, e), bn;
}
//#endregion
//#region node_modules/zod/v4/core/util.js
function xn(e) {
	let t = Object.values(e).filter((e) => typeof e == "number");
	return Object.entries(e).filter(([e, n]) => t.indexOf(+e) === -1).map(([e, t]) => t);
}
function Sn(e, t) {
	return typeof t == "bigint" ? t.toString() : t;
}
function Cn(e) {
	return { get value() {
		{
			let t = e();
			return Object.defineProperty(this, "value", { value: t }), t;
		}
		throw Error("cached value already set");
	} };
}
function wn(e) {
	return e == null;
}
function Tn(e) {
	let t = +!!e.startsWith("^"), n = e.endsWith("$") ? e.length - 1 : e.length;
	return e.slice(t, n);
}
function En(e, t) {
	let n = e / t, r = Math.round(n), i = 2 ** -52 * Math.max(Math.abs(n), 1);
	return Math.abs(n - r) < i ? 0 : n - r;
}
var Dn = /* @__PURE__ */ Symbol("evaluating");
function M(e, t, n) {
	let r;
	Object.defineProperty(e, t, {
		get() {
			if (r !== Dn) return r === void 0 && (r = Dn, r = n()), r;
		},
		set(n) {
			Object.defineProperty(e, t, { value: n });
		},
		configurable: !0
	});
}
function N(e, t, n) {
	Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
}
function P(...e) {
	let t = {};
	for (let n of e) Object.assign(t, Object.getOwnPropertyDescriptors(n));
	return Object.defineProperties({}, t);
}
function On(e) {
	return JSON.stringify(e);
}
function kn(e) {
	return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var An = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {};
function jn(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
var Mn = /* @__PURE__ */ Cn(() => {
	if (bn.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
	try {
		return Function(""), !0;
	} catch {
		return !1;
	}
});
function Nn(e) {
	if (jn(e) === !1) return !1;
	let t = e.constructor;
	if (t === void 0 || typeof t != "function") return !0;
	let n = t.prototype;
	return !(jn(n) === !1 || Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") === !1);
}
function Pn(e) {
	return Nn(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
var Fn = /* @__PURE__ */ new Set([
	"string",
	"number",
	"symbol"
]);
function In(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function F(e, t, n) {
	let r = new e._zod.constr(t ?? e._zod.def);
	return (!t || n?.parent) && (r._zod.parent = e), r;
}
function I(e) {
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
function Ln(e) {
	return Object.keys(e).filter((t) => e[t]._zod.optin === "optional" && e[t]._zod.optout === "optional");
}
var Rn = {
	safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function zn(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".pick() cannot be used on object schemas containing refinements");
	return F(e, P(e._zod.def, {
		get shape() {
			let e = {};
			for (let r in t) {
				if (!(r in n.shape)) throw Error(`Unrecognized key: "${r}"`);
				t[r] && (e[r] = n.shape[r]);
			}
			return N(this, "shape", e), e;
		},
		checks: []
	}));
}
function Bn(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".omit() cannot be used on object schemas containing refinements");
	return F(e, P(e._zod.def, {
		get shape() {
			let r = { ...e._zod.def.shape };
			for (let e in t) {
				if (!(e in n.shape)) throw Error(`Unrecognized key: "${e}"`);
				t[e] && delete r[e];
			}
			return N(this, "shape", r), r;
		},
		checks: []
	}));
}
function Vn(e, t) {
	if (!Nn(t)) throw Error("Invalid input to extend: expected a plain object");
	let n = e._zod.def.checks;
	if (n && n.length > 0) {
		let n = e._zod.def.shape;
		for (let e in t) if (Object.getOwnPropertyDescriptor(n, e) !== void 0) throw Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return F(e, P(e._zod.def, { get shape() {
		let n = {
			...e._zod.def.shape,
			...t
		};
		return N(this, "shape", n), n;
	} }));
}
function Hn(e, t) {
	if (!Nn(t)) throw Error("Invalid input to safeExtend: expected a plain object");
	return F(e, P(e._zod.def, { get shape() {
		let n = {
			...e._zod.def.shape,
			...t
		};
		return N(this, "shape", n), n;
	} }));
}
function Un(e, t) {
	if (e._zod.def.checks?.length) throw Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return F(e, P(e._zod.def, {
		get shape() {
			let n = {
				...e._zod.def.shape,
				...t._zod.def.shape
			};
			return N(this, "shape", n), n;
		},
		get catchall() {
			return t._zod.def.catchall;
		},
		checks: t._zod.def.checks ?? []
	}));
}
function Wn(e, t, n) {
	let r = t._zod.def.checks;
	if (r && r.length > 0) throw Error(".partial() cannot be used on object schemas containing refinements");
	return F(t, P(t._zod.def, {
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
			return N(this, "shape", i), i;
		},
		checks: []
	}));
}
function Gn(e, t, n) {
	return F(t, P(t._zod.def, { get shape() {
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
		return N(this, "shape", i), i;
	} }));
}
function L(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
	return !1;
}
function Kn(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0;
	return !1;
}
function qn(e, t) {
	return t.map((t) => {
		var n;
		return (n = t).path ?? (n.path = []), t.path.unshift(e), t;
	});
}
function Jn(e) {
	return typeof e == "string" ? e : e?.message;
}
function R(e, t, n) {
	let r = e.message ? e.message : Jn(e.inst?._zod.def?.error?.(e)) ?? Jn(t?.error?.(e)) ?? Jn(n.customError?.(e)) ?? Jn(n.localeError?.(e)) ?? "Invalid input", { inst: i, continue: a, input: o, ...s } = e;
	return s.path ??= [], s.message = r, t?.reportInput && (s.input = o), s;
}
function Yn(e) {
	return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function Xn(...e) {
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
var Zn = (e, t) => {
	e.name = "$ZodError", Object.defineProperty(e, "_zod", {
		value: e._zod,
		enumerable: !1
	}), Object.defineProperty(e, "issues", {
		value: t,
		enumerable: !1
	}), e.message = JSON.stringify(t, Sn, 2), Object.defineProperty(e, "toString", {
		value: () => e.message,
		enumerable: !1
	});
}, Qn = k("$ZodError", Zn), $n = k("$ZodError", Zn, { Parent: Error });
function er(e, t = (e) => e.message) {
	let n = {}, r = [];
	for (let i of e.issues) i.path.length > 0 ? (n[i.path[0]] = n[i.path[0]] || [], n[i.path[0]].push(t(i))) : r.push(t(i));
	return {
		formErrors: r,
		fieldErrors: n
	};
}
function tr(e, t = (e) => e.message) {
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
var nr = (e) => (t, n, r, i) => {
	let a = r ? {
		...r,
		async: !1
	} : { async: !1 }, o = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (o instanceof Promise) throw new A();
	if (o.issues.length) {
		let t = new (i?.Err ?? e)(o.issues.map((e) => R(e, a, j())));
		throw An(t, i?.callee), t;
	}
	return o.value;
}, rr = (e) => async (t, n, r, i) => {
	let a = r ? {
		...r,
		async: !0
	} : { async: !0 }, o = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (o instanceof Promise && (o = await o), o.issues.length) {
		let t = new (i?.Err ?? e)(o.issues.map((e) => R(e, a, j())));
		throw An(t, i?.callee), t;
	}
	return o.value;
}, ir = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		async: !1
	} : { async: !1 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	if (a instanceof Promise) throw new A();
	return a.issues.length ? {
		success: !1,
		error: new (e ?? Qn)(a.issues.map((e) => R(e, i, j())))
	} : {
		success: !0,
		data: a.value
	};
}, ar = /* @__PURE__ */ ir($n), or = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		async: !0
	} : { async: !0 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	return a instanceof Promise && (a = await a), a.issues.length ? {
		success: !1,
		error: new e(a.issues.map((e) => R(e, i, j())))
	} : {
		success: !0,
		data: a.value
	};
}, sr = /* @__PURE__ */ or($n), cr = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return nr(e)(t, n, i);
}, lr = (e) => (t, n, r) => nr(e)(t, n, r), ur = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return rr(e)(t, n, i);
}, dr = (e) => async (t, n, r) => rr(e)(t, n, r), fr = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return ir(e)(t, n, i);
}, pr = (e) => (t, n, r) => ir(e)(t, n, r), mr = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return or(e)(t, n, i);
}, hr = (e) => async (t, n, r) => or(e)(t, n, r), gr = /^[cC][0-9a-z]{6,}$/, _r = /^[0-9a-z]+$/, vr = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, yr = /^[0-9a-vA-V]{20}$/, br = /^[A-Za-z0-9]{27}$/, xr = /^[a-zA-Z0-9_-]{21}$/, Sr = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, Cr = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, wr = (e) => e ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, Tr = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, Er = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";
function Dr() {
	return new RegExp(Er, "u");
}
var Or = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, kr = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, Ar = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, jr = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, Mr = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, Nr = /^[A-Za-z0-9_-]*$/, Pr = /^https?$/, Fr = /^\+[1-9]\d{6,14}$/, Ir = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))", Lr = /* @__PURE__ */ RegExp(`^${Ir}$`);
function Rr(e) {
	let t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
	return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function zr(e) {
	return RegExp(`^${Rr(e)}$`);
}
function Br(e) {
	let t = Rr({ precision: e.precision }), n = ["Z"];
	e.local && n.push(""), e.offset && n.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
	let r = `${t}(?:${n.join("|")})`;
	return RegExp(`^${Ir}T(?:${r})$`);
}
var Vr = (e) => {
	let t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ""}}` : "[\\s\\S]*";
	return RegExp(`^${t}$`);
}, Hr = /^-?\d+$/, Ur = /^-?\d+(?:\.\d+)?$/, Wr = /^(?:true|false)$/i, Gr = /^[^A-Z]*$/, Kr = /^[^a-z]*$/, z = /* @__PURE__ */ k("$ZodCheck", (e, t) => {
	var n;
	e._zod ??= {}, e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), qr = {
	number: "number",
	bigint: "bigint",
	object: "date"
}, Jr = /* @__PURE__ */ k("$ZodCheckLessThan", (e, t) => {
	z.init(e, t);
	let n = qr[typeof t.value];
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
}), Yr = /* @__PURE__ */ k("$ZodCheckGreaterThan", (e, t) => {
	z.init(e, t);
	let n = qr[typeof t.value];
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
}), Xr = /* @__PURE__ */ k("$ZodCheckMultipleOf", (e, t) => {
	z.init(e, t), e._zod.onattach.push((e) => {
		var n;
		(n = e._zod.bag).multipleOf ?? (n.multipleOf = t.value);
	}), e._zod.check = (n) => {
		if (typeof n.value != typeof t.value) throw Error("Cannot mix number and bigint in multiple_of check.");
		(typeof n.value == "bigint" ? n.value % t.value === BigInt(0) : En(n.value, t.value) === 0) || n.issues.push({
			origin: typeof n.value,
			code: "not_multiple_of",
			divisor: t.value,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Zr = /* @__PURE__ */ k("$ZodCheckNumberFormat", (e, t) => {
	z.init(e, t), t.format = t.format || "float64";
	let n = t.format?.includes("int"), r = n ? "int" : "number", [i, a] = Rn[t.format];
	e._zod.onattach.push((e) => {
		let r = e._zod.bag;
		r.format = t.format, r.minimum = i, r.maximum = a, n && (r.pattern = Hr);
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
}), Qr = /* @__PURE__ */ k("$ZodCheckMaxLength", (e, t) => {
	var n;
	z.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !wn(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.maximum ?? Infinity;
		t.maximum < n && (e._zod.bag.maximum = t.maximum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length <= t.maximum) return;
		let i = Yn(r);
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
}), $r = /* @__PURE__ */ k("$ZodCheckMinLength", (e, t) => {
	var n;
	z.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !wn(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.minimum ?? -Infinity;
		t.minimum > n && (e._zod.bag.minimum = t.minimum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length >= t.minimum) return;
		let i = Yn(r);
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
}), ei = /* @__PURE__ */ k("$ZodCheckLengthEquals", (e, t) => {
	var n;
	z.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !wn(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag;
		n.minimum = t.length, n.maximum = t.length, n.length = t.length;
	}), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if (i === t.length) return;
		let a = Yn(r), o = i > t.length;
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
}), ti = /* @__PURE__ */ k("$ZodCheckStringFormat", (e, t) => {
	var n, r;
	z.init(e, t), e._zod.onattach.push((e) => {
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
}), ni = /* @__PURE__ */ k("$ZodCheckRegex", (e, t) => {
	ti.init(e, t), e._zod.check = (n) => {
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
}), ri = /* @__PURE__ */ k("$ZodCheckLowerCase", (e, t) => {
	t.pattern ??= Gr, ti.init(e, t);
}), ii = /* @__PURE__ */ k("$ZodCheckUpperCase", (e, t) => {
	t.pattern ??= Kr, ti.init(e, t);
}), ai = /* @__PURE__ */ k("$ZodCheckIncludes", (e, t) => {
	z.init(e, t);
	let n = In(t.includes), r = new RegExp(typeof t.position == "number" ? `^.{${t.position}}${n}` : n);
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
}), oi = /* @__PURE__ */ k("$ZodCheckStartsWith", (e, t) => {
	z.init(e, t);
	let n = RegExp(`^${In(t.prefix)}.*`);
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
}), si = /* @__PURE__ */ k("$ZodCheckEndsWith", (e, t) => {
	z.init(e, t);
	let n = RegExp(`.*${In(t.suffix)}$`);
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
}), ci = /* @__PURE__ */ k("$ZodCheckOverwrite", (e, t) => {
	z.init(e, t), e._zod.check = (e) => {
		e.value = t.tx(e.value);
	};
}), li = class {
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
}, ui = {
	major: 4,
	minor: 4,
	patch: 3
}, B = /* @__PURE__ */ k("$ZodType", (e, t) => {
	var n;
	e ??= {}, e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = ui;
	let r = [...e._zod.def.checks ?? []];
	e._zod.traits.has("$ZodCheck") && r.unshift(e);
	for (let t of r) for (let n of t._zod.onattach) n(e);
	if (r.length === 0) (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
		e._zod.run = e._zod.parse;
	});
	else {
		let t = (e, t, n) => {
			let r = L(e), i;
			for (let a of t) {
				if (a._zod.def.when) {
					if (Kn(e) || !a._zod.def.when(e)) continue;
				} else if (r) continue;
				let t = e.issues.length, o = a._zod.check(e);
				if (o instanceof Promise && n?.async === !1) throw new A();
				if (i || o instanceof Promise) i = (i ?? Promise.resolve()).then(async () => {
					await o, e.issues.length !== t && (r ||= L(e, t));
				});
				else {
					if (e.issues.length === t) continue;
					r ||= L(e, t);
				}
			}
			return i ? i.then(() => e) : e;
		}, n = (n, i, a) => {
			if (L(n)) return n.aborted = !0, n;
			let o = t(i, r, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new A();
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
				if (a.async === !1) throw new A();
				return o.then((e) => t(e, r, a));
			}
			return t(o, r, a);
		};
	}
	M(e, "~standard", () => ({
		validate: (t) => {
			try {
				let n = ar(e, t);
				return n.success ? { value: n.data } : { issues: n.error?.issues };
			} catch {
				return sr(e, t).then((e) => e.success ? { value: e.data } : { issues: e.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
}), di = /* @__PURE__ */ k("$ZodString", (e, t) => {
	B.init(e, t), e._zod.pattern = [...e?._zod.bag?.patterns ?? []].pop() ?? Vr(e._zod.bag), e._zod.parse = (n, r) => {
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
}), V = /* @__PURE__ */ k("$ZodStringFormat", (e, t) => {
	ti.init(e, t), di.init(e, t);
}), fi = /* @__PURE__ */ k("$ZodGUID", (e, t) => {
	t.pattern ??= Cr, V.init(e, t);
}), pi = /* @__PURE__ */ k("$ZodUUID", (e, t) => {
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
		t.pattern ??= wr(e);
	} else t.pattern ??= wr();
	V.init(e, t);
}), mi = /* @__PURE__ */ k("$ZodEmail", (e, t) => {
	t.pattern ??= Tr, V.init(e, t);
}), hi = /* @__PURE__ */ k("$ZodURL", (e, t) => {
	V.init(e, t), e._zod.check = (n) => {
		try {
			let r = n.value.trim();
			if (!t.normalize && t.protocol?.source === Pr.source && !/^https?:\/\//i.test(r)) {
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
}), gi = /* @__PURE__ */ k("$ZodEmoji", (e, t) => {
	t.pattern ??= Dr(), V.init(e, t);
}), _i = /* @__PURE__ */ k("$ZodNanoID", (e, t) => {
	t.pattern ??= xr, V.init(e, t);
}), vi = /* @__PURE__ */ k("$ZodCUID", (e, t) => {
	t.pattern ??= gr, V.init(e, t);
}), yi = /* @__PURE__ */ k("$ZodCUID2", (e, t) => {
	t.pattern ??= _r, V.init(e, t);
}), bi = /* @__PURE__ */ k("$ZodULID", (e, t) => {
	t.pattern ??= vr, V.init(e, t);
}), xi = /* @__PURE__ */ k("$ZodXID", (e, t) => {
	t.pattern ??= yr, V.init(e, t);
}), Si = /* @__PURE__ */ k("$ZodKSUID", (e, t) => {
	t.pattern ??= br, V.init(e, t);
}), Ci = /* @__PURE__ */ k("$ZodISODateTime", (e, t) => {
	t.pattern ??= Br(t), V.init(e, t);
}), wi = /* @__PURE__ */ k("$ZodISODate", (e, t) => {
	t.pattern ??= Lr, V.init(e, t);
}), Ti = /* @__PURE__ */ k("$ZodISOTime", (e, t) => {
	t.pattern ??= zr(t), V.init(e, t);
}), Ei = /* @__PURE__ */ k("$ZodISODuration", (e, t) => {
	t.pattern ??= Sr, V.init(e, t);
}), Di = /* @__PURE__ */ k("$ZodIPv4", (e, t) => {
	t.pattern ??= Or, V.init(e, t), e._zod.bag.format = "ipv4";
}), Oi = /* @__PURE__ */ k("$ZodIPv6", (e, t) => {
	t.pattern ??= kr, V.init(e, t), e._zod.bag.format = "ipv6", e._zod.check = (n) => {
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
}), ki = /* @__PURE__ */ k("$ZodCIDRv4", (e, t) => {
	t.pattern ??= Ar, V.init(e, t);
}), Ai = /* @__PURE__ */ k("$ZodCIDRv6", (e, t) => {
	t.pattern ??= jr, V.init(e, t), e._zod.check = (n) => {
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
function ji(e) {
	if (e === "") return !0;
	if (/\s/.test(e) || e.length % 4 != 0) return !1;
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}
var Mi = /* @__PURE__ */ k("$ZodBase64", (e, t) => {
	t.pattern ??= Mr, V.init(e, t), e._zod.bag.contentEncoding = "base64", e._zod.check = (n) => {
		ji(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
});
function Ni(e) {
	if (!Nr.test(e)) return !1;
	let t = e.replace(/[-_]/g, (e) => e === "-" ? "+" : "/");
	return ji(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
}
var Pi = /* @__PURE__ */ k("$ZodBase64URL", (e, t) => {
	t.pattern ??= Nr, V.init(e, t), e._zod.bag.contentEncoding = "base64url", e._zod.check = (n) => {
		Ni(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Fi = /* @__PURE__ */ k("$ZodE164", (e, t) => {
	t.pattern ??= Fr, V.init(e, t);
});
function Ii(e, t = null) {
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
var Li = /* @__PURE__ */ k("$ZodJWT", (e, t) => {
	V.init(e, t), e._zod.check = (n) => {
		Ii(n.value, t.alg) || n.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Ri = /* @__PURE__ */ k("$ZodNumber", (e, t) => {
	B.init(e, t), e._zod.pattern = e._zod.bag.pattern ?? Ur, e._zod.parse = (n, r) => {
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
}), zi = /* @__PURE__ */ k("$ZodNumberFormat", (e, t) => {
	Zr.init(e, t), Ri.init(e, t);
}), Bi = /* @__PURE__ */ k("$ZodBoolean", (e, t) => {
	B.init(e, t), e._zod.pattern = Wr, e._zod.parse = (n, r) => {
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
}), Vi = /* @__PURE__ */ k("$ZodUnknown", (e, t) => {
	B.init(e, t), e._zod.parse = (e) => e;
}), Hi = /* @__PURE__ */ k("$ZodNever", (e, t) => {
	B.init(e, t), e._zod.parse = (t, n) => (t.issues.push({
		expected: "never",
		code: "invalid_type",
		input: t.value,
		inst: e
	}), t);
});
function Ui(e, t, n) {
	e.issues.length && t.issues.push(...qn(n, e.issues)), t.value[n] = e.value;
}
var Wi = /* @__PURE__ */ k("$ZodArray", (e, t) => {
	B.init(e, t), e._zod.parse = (n, r) => {
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
			s instanceof Promise ? a.push(s.then((t) => Ui(t, n, e))) : Ui(s, n, e);
		}
		return a.length ? Promise.all(a).then(() => n) : n;
	};
});
function Gi(e, t, n, r, i, a) {
	let o = n in r;
	if (e.issues.length) {
		if (i && a && !o) return;
		t.issues.push(...qn(n, e.issues));
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
function Ki(e) {
	let t = Object.keys(e.shape);
	for (let n of t) if (!e.shape?.[n]?._zod?.traits?.has("$ZodType")) throw Error(`Invalid element at key "${n}": expected a Zod schema`);
	let n = Ln(e.shape);
	return {
		...e,
		keys: t,
		keySet: new Set(t),
		numKeys: t.length,
		optionalKeys: new Set(n)
	};
}
function qi(e, t, n, r, i, a) {
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
		a instanceof Promise ? e.push(a.then((e) => Gi(e, n, i, t, u, d))) : Gi(a, n, i, t, u, d);
	}
	return o.length && n.issues.push({
		code: "unrecognized_keys",
		keys: o,
		input: t,
		inst: a
	}), e.length ? Promise.all(e).then(() => n) : n;
}
var Ji = /* @__PURE__ */ k("$ZodObject", (e, t) => {
	if (B.init(e, t), !Object.getOwnPropertyDescriptor(t, "shape")?.get) {
		let e = t.shape;
		Object.defineProperty(t, "shape", { get: () => {
			let n = { ...e };
			return Object.defineProperty(t, "shape", { value: n }), n;
		} });
	}
	let n = Cn(() => Ki(t));
	M(e._zod, "propValues", () => {
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
	let r = jn, i = t.catchall, a;
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
			a instanceof Promise ? c.push(a.then((n) => Gi(n, t, e, s, r, i))) : Gi(a, t, e, s, r, i);
		}
		return i ? qi(c, s, t, o, n.value, e) : c.length ? Promise.all(c).then(() => t) : t;
	};
}), Yi = /* @__PURE__ */ k("$ZodObjectJIT", (e, t) => {
	Ji.init(e, t);
	let n = e._zod.parse, r = Cn(() => Ki(t)), i = (e) => {
		let t = new li([
			"shape",
			"payload",
			"ctx"
		]), n = r.value, i = (e) => {
			let t = On(e);
			return `shape[${t}]._zod.run({ value: input[${t}], issues: [] }, ctx)`;
		};
		t.write("const input = payload.value;");
		let a = Object.create(null), o = 0;
		for (let e of n.keys) a[e] = `key_${o++}`;
		t.write("const newResult = {};");
		for (let r of n.keys) {
			let n = a[r], o = On(r), s = e[r], c = s?._zod?.optin === "optional", l = s?._zod?.optout === "optional";
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
	}, a, o = jn, s = !bn.jitless, c = s && Mn.value, l = t.catchall, u;
	e._zod.parse = (d, f) => {
		u ??= r.value;
		let p = d.value;
		return o(p) ? s && c && f?.async === !1 && f.jitless !== !0 ? (a ||= i(t.shape), d = a(d, f), l ? qi([], p, d, f, u, e) : d) : n(d, f) : (d.issues.push({
			expected: "object",
			code: "invalid_type",
			input: p,
			inst: e
		}), d);
	};
});
function Xi(e, t, n, r) {
	for (let n of e) if (n.issues.length === 0) return t.value = n.value, t;
	let i = e.filter((e) => !L(e));
	return i.length === 1 ? (t.value = i[0].value, i[0]) : (t.issues.push({
		code: "invalid_union",
		input: t.value,
		inst: n,
		errors: e.map((e) => e.issues.map((e) => R(e, r, j())))
	}), t);
}
var Zi = /* @__PURE__ */ k("$ZodUnion", (e, t) => {
	B.init(e, t), M(e._zod, "optin", () => t.options.some((e) => e._zod.optin === "optional") ? "optional" : void 0), M(e._zod, "optout", () => t.options.some((e) => e._zod.optout === "optional") ? "optional" : void 0), M(e._zod, "values", () => {
		if (t.options.every((e) => e._zod.values)) return new Set(t.options.flatMap((e) => Array.from(e._zod.values)));
	}), M(e._zod, "pattern", () => {
		if (t.options.every((e) => e._zod.pattern)) {
			let e = t.options.map((e) => e._zod.pattern);
			return RegExp(`^(${e.map((e) => Tn(e.source)).join("|")})$`);
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
		return a ? Promise.all(o).then((t) => Xi(t, r, e, i)) : Xi(o, r, e, i);
	};
}), Qi = /* @__PURE__ */ k("$ZodIntersection", (e, t) => {
	B.init(e, t), e._zod.parse = (e, n) => {
		let r = e.value, i = t.left._zod.run({
			value: r,
			issues: []
		}, n), a = t.right._zod.run({
			value: r,
			issues: []
		}, n);
		return i instanceof Promise || a instanceof Promise ? Promise.all([i, a]).then(([t, n]) => ea(e, t, n)) : ea(e, i, a);
	};
});
function $i(e, t) {
	if (e === t || e instanceof Date && t instanceof Date && +e == +t) return {
		valid: !0,
		data: e
	};
	if (Nn(e) && Nn(t)) {
		let n = Object.keys(t), r = Object.keys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		for (let n of r) {
			let r = $i(e[n], t[n]);
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
			let i = e[r], a = t[r], o = $i(i, a);
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
function ea(e, t, n) {
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
	}), L(e)) return e;
	let o = $i(t.value, n.value);
	if (!o.valid) throw Error(`Unmergable intersection. Error path: ${JSON.stringify(o.mergeErrorPath)}`);
	return e.value = o.data, e;
}
var ta = /* @__PURE__ */ k("$ZodEnum", (e, t) => {
	B.init(e, t);
	let n = xn(t.entries), r = new Set(n);
	e._zod.values = r, e._zod.pattern = RegExp(`^(${n.filter((e) => Fn.has(typeof e)).map((e) => typeof e == "string" ? In(e) : e.toString()).join("|")})$`), e._zod.parse = (t, i) => {
		let a = t.value;
		return r.has(a) || t.issues.push({
			code: "invalid_value",
			values: n,
			input: a,
			inst: e
		}), t;
	};
}), na = /* @__PURE__ */ k("$ZodTransform", (e, t) => {
	B.init(e, t), e._zod.optin = "optional", e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new yn(e.constructor.name);
		let i = t.transform(n.value, n);
		if (r.async) return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => (n.value = e, n.fallback = !0, n));
		if (i instanceof Promise) throw new A();
		return n.value = i, n.fallback = !0, n;
	};
});
function ra(e, t) {
	return t === void 0 && (e.issues.length || e.fallback) ? {
		issues: [],
		value: void 0
	} : e;
}
var ia = /* @__PURE__ */ k("$ZodOptional", (e, t) => {
	B.init(e, t), e._zod.optin = "optional", e._zod.optout = "optional", M(e._zod, "values", () => t.innerType._zod.values ? new Set([...t.innerType._zod.values, void 0]) : void 0), M(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${Tn(e.source)})?$`) : void 0;
	}), e._zod.parse = (e, n) => {
		if (t.innerType._zod.optin === "optional") {
			let r = e.value, i = t.innerType._zod.run(e, n);
			return i instanceof Promise ? i.then((e) => ra(e, r)) : ra(i, r);
		}
		return e.value === void 0 ? e : t.innerType._zod.run(e, n);
	};
}), aa = /* @__PURE__ */ k("$ZodExactOptional", (e, t) => {
	ia.init(e, t), M(e._zod, "values", () => t.innerType._zod.values), M(e._zod, "pattern", () => t.innerType._zod.pattern), e._zod.parse = (e, n) => t.innerType._zod.run(e, n);
}), oa = /* @__PURE__ */ k("$ZodNullable", (e, t) => {
	B.init(e, t), M(e._zod, "optin", () => t.innerType._zod.optin), M(e._zod, "optout", () => t.innerType._zod.optout), M(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${Tn(e.source)}|null)$`) : void 0;
	}), M(e._zod, "values", () => t.innerType._zod.values ? new Set([...t.innerType._zod.values, null]) : void 0), e._zod.parse = (e, n) => e.value === null ? e : t.innerType._zod.run(e, n);
}), sa = /* @__PURE__ */ k("$ZodDefault", (e, t) => {
	B.init(e, t), e._zod.optin = "optional", M(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		if (e.value === void 0) return e.value = t.defaultValue, e;
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => ca(e, t)) : ca(r, t);
	};
});
function ca(e, t) {
	return e.value === void 0 && (e.value = t.defaultValue), e;
}
var la = /* @__PURE__ */ k("$ZodPrefault", (e, t) => {
	B.init(e, t), e._zod.optin = "optional", M(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => (n.direction === "backward" || e.value === void 0 && (e.value = t.defaultValue), t.innerType._zod.run(e, n));
}), ua = /* @__PURE__ */ k("$ZodNonOptional", (e, t) => {
	B.init(e, t), M(e._zod, "values", () => {
		let e = t.innerType._zod.values;
		return e ? new Set([...e].filter((e) => e !== void 0)) : void 0;
	}), e._zod.parse = (n, r) => {
		let i = t.innerType._zod.run(n, r);
		return i instanceof Promise ? i.then((t) => da(t, e)) : da(i, e);
	};
});
function da(e, t) {
	return !e.issues.length && e.value === void 0 && e.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: e.value,
		inst: t
	}), e;
}
var fa = /* @__PURE__ */ k("$ZodCatch", (e, t) => {
	B.init(e, t), e._zod.optin = "optional", M(e._zod, "optout", () => t.innerType._zod.optout), M(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((r) => (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => R(e, n, j())) },
			input: e.value
		}), e.issues = [], e.fallback = !0), e)) : (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => R(e, n, j())) },
			input: e.value
		}), e.issues = [], e.fallback = !0), e);
	};
}), pa = /* @__PURE__ */ k("$ZodPipe", (e, t) => {
	B.init(e, t), M(e._zod, "values", () => t.in._zod.values), M(e._zod, "optin", () => t.in._zod.optin), M(e._zod, "optout", () => t.out._zod.optout), M(e._zod, "propValues", () => t.in._zod.propValues), e._zod.parse = (e, n) => {
		if (n.direction === "backward") {
			let r = t.out._zod.run(e, n);
			return r instanceof Promise ? r.then((e) => ma(e, t.in, n)) : ma(r, t.in, n);
		}
		let r = t.in._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => ma(e, t.out, n)) : ma(r, t.out, n);
	};
});
function ma(e, t, n) {
	return e.issues.length ? (e.aborted = !0, e) : t._zod.run({
		value: e.value,
		issues: e.issues,
		fallback: e.fallback
	}, n);
}
var ha = /* @__PURE__ */ k("$ZodReadonly", (e, t) => {
	B.init(e, t), M(e._zod, "propValues", () => t.innerType._zod.propValues), M(e._zod, "values", () => t.innerType._zod.values), M(e._zod, "optin", () => t.innerType?._zod?.optin), M(e._zod, "optout", () => t.innerType?._zod?.optout), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then(ga) : ga(r);
	};
});
function ga(e) {
	return e.value = Object.freeze(e.value), e;
}
var _a = /* @__PURE__ */ k("$ZodCustom", (e, t) => {
	z.init(e, t), B.init(e, t), e._zod.parse = (e, t) => e, e._zod.check = (n) => {
		let r = n.value, i = t.fn(r);
		if (i instanceof Promise) return i.then((t) => va(t, n, r, e));
		va(i, n, r, e);
	};
});
function va(e, t, n, r) {
	if (!e) {
		let e = {
			code: "custom",
			input: n,
			inst: r,
			path: [...r._zod.def.path ?? []],
			continue: !r._zod.def.abort
		};
		r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(Xn(e));
	}
}
//#endregion
//#region node_modules/zod/v4/core/registries.js
var ya, ba = class {
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
function xa() {
	return new ba();
}
(ya = globalThis).__zod_globalRegistry ?? (ya.__zod_globalRegistry = xa());
var Sa = globalThis.__zod_globalRegistry;
//#endregion
//#region node_modules/zod/v4/core/api.js
/* @__NO_SIDE_EFFECTS__ */
function Ca(e, t) {
	return new e({
		type: "string",
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function wa(e, t) {
	return new e({
		type: "string",
		format: "email",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ta(e, t) {
	return new e({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ea(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Da(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v4",
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Oa(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v6",
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function ka(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v7",
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Aa(e, t) {
	return new e({
		type: "string",
		format: "url",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function ja(e, t) {
	return new e({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ma(e, t) {
	return new e({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Na(e, t) {
	return new e({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Pa(e, t) {
	return new e({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Fa(e, t) {
	return new e({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ia(e, t) {
	return new e({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function La(e, t) {
	return new e({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ra(e, t) {
	return new e({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function za(e, t) {
	return new e({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ba(e, t) {
	return new e({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Va(e, t) {
	return new e({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ha(e, t) {
	return new e({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ua(e, t) {
	return new e({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Wa(e, t) {
	return new e({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ga(e, t) {
	return new e({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: !1,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ka(e, t) {
	return new e({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: !1,
		local: !1,
		precision: null,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function qa(e, t) {
	return new e({
		type: "string",
		format: "date",
		check: "string_format",
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ja(e, t) {
	return new e({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Ya(e, t) {
	return new e({
		type: "string",
		format: "duration",
		check: "string_format",
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Xa(e, t) {
	return new e({
		type: "number",
		checks: [],
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Za(e, t) {
	return new e({
		type: "number",
		check: "number_format",
		abort: !1,
		format: "safeint",
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Qa(e, t) {
	return new e({
		type: "boolean",
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function $a(e) {
	return new e({ type: "unknown" });
}
/* @__NO_SIDE_EFFECTS__ */
function eo(e, t) {
	return new e({
		type: "never",
		...I(t)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function to(e, t) {
	return new Jr({
		check: "less_than",
		...I(t),
		value: e,
		inclusive: !1
	});
}
/* @__NO_SIDE_EFFECTS__ */
function no(e, t) {
	return new Jr({
		check: "less_than",
		...I(t),
		value: e,
		inclusive: !0
	});
}
/* @__NO_SIDE_EFFECTS__ */
function ro(e, t) {
	return new Yr({
		check: "greater_than",
		...I(t),
		value: e,
		inclusive: !1
	});
}
/* @__NO_SIDE_EFFECTS__ */
function io(e, t) {
	return new Yr({
		check: "greater_than",
		...I(t),
		value: e,
		inclusive: !0
	});
}
/* @__NO_SIDE_EFFECTS__ */
function ao(e, t) {
	return new Xr({
		check: "multiple_of",
		...I(t),
		value: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function oo(e, t) {
	return new Qr({
		check: "max_length",
		...I(t),
		maximum: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function so(e, t) {
	return new $r({
		check: "min_length",
		...I(t),
		minimum: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function co(e, t) {
	return new ei({
		check: "length_equals",
		...I(t),
		length: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function lo(e, t) {
	return new ni({
		check: "string_format",
		format: "regex",
		...I(t),
		pattern: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function uo(e) {
	return new ri({
		check: "string_format",
		format: "lowercase",
		...I(e)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function fo(e) {
	return new ii({
		check: "string_format",
		format: "uppercase",
		...I(e)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function po(e, t) {
	return new ai({
		check: "string_format",
		format: "includes",
		...I(t),
		includes: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function mo(e, t) {
	return new oi({
		check: "string_format",
		format: "starts_with",
		...I(t),
		prefix: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function ho(e, t) {
	return new si({
		check: "string_format",
		format: "ends_with",
		...I(t),
		suffix: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function H(e) {
	return new ci({
		check: "overwrite",
		tx: e
	});
}
/* @__NO_SIDE_EFFECTS__ */
function go(e) {
	return /* @__PURE__ */ H((t) => t.normalize(e));
}
/* @__NO_SIDE_EFFECTS__ */
function _o() {
	return /* @__PURE__ */ H((e) => e.trim());
}
/* @__NO_SIDE_EFFECTS__ */
function vo() {
	return /* @__PURE__ */ H((e) => e.toLowerCase());
}
/* @__NO_SIDE_EFFECTS__ */
function yo() {
	return /* @__PURE__ */ H((e) => e.toUpperCase());
}
/* @__NO_SIDE_EFFECTS__ */
function bo() {
	return /* @__PURE__ */ H((e) => kn(e));
}
/* @__NO_SIDE_EFFECTS__ */
function xo(e, t, n) {
	return new e({
		type: "array",
		element: t,
		...I(n)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function So(e, t, n) {
	return new e({
		type: "custom",
		check: "custom",
		fn: t,
		...I(n)
	});
}
/* @__NO_SIDE_EFFECTS__ */
function Co(e, t) {
	let n = /* @__PURE__ */ wo((t) => (t.addIssue = (e) => {
		if (typeof e == "string") t.issues.push(Xn(e, t.value, n._zod.def));
		else {
			let r = e;
			r.fatal && (r.continue = !1), r.code ??= "custom", r.input ??= t.value, r.inst ??= n, r.continue ??= !n._zod.def.abort, t.issues.push(Xn(r));
		}
	}, e(t.value, t)), t);
	return n;
}
/* @__NO_SIDE_EFFECTS__ */
function wo(e, t) {
	let n = new z({
		check: "custom",
		...I(t)
	});
	return n._zod.check = e, n;
}
//#endregion
//#region node_modules/zod/v4/core/to-json-schema.js
function To(e) {
	let t = e?.target ?? "draft-2020-12";
	return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
		processors: e.processors ?? {},
		metadataRegistry: e?.metadata ?? Sa,
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
function U(e, t, n = {
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
		a && (o.ref ||= a, U(a, t, r), t.seen.get(a).isParent = !0);
	}
	let c = t.metadataRegistry.get(e);
	return c && Object.assign(o.schema, c), t.io === "input" && W(e) && (delete o.schema.examples, delete o.schema.default), t.io === "input" && "_prefault" in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)), delete o.schema._prefault, t.seen.get(e).schema;
}
function Eo(e, t) {
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
function Do(e, t) {
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
					input: ko(t, "input", e.processors),
					output: ko(t, "output", e.processors)
				}
			},
			enumerable: !1,
			writable: !1
		}), n;
	} catch {
		throw Error("Error converting schema to JSON.");
	}
}
function W(e, t) {
	let n = t ?? { seen: /* @__PURE__ */ new Set() };
	if (n.seen.has(e)) return !1;
	n.seen.add(e);
	let r = e._zod.def;
	if (r.type === "transform") return !0;
	if (r.type === "array") return W(r.element, n);
	if (r.type === "set") return W(r.valueType, n);
	if (r.type === "lazy") return W(r.getter(), n);
	if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault") return W(r.innerType, n);
	if (r.type === "intersection") return W(r.left, n) || W(r.right, n);
	if (r.type === "record" || r.type === "map") return W(r.keyType, n) || W(r.valueType, n);
	if (r.type === "pipe") return e._zod.traits.has("$ZodCodec") ? !0 : W(r.in, n) || W(r.out, n);
	if (r.type === "object") {
		for (let e in r.shape) if (W(r.shape[e], n)) return !0;
		return !1;
	}
	if (r.type === "union") {
		for (let e of r.options) if (W(e, n)) return !0;
		return !1;
	}
	if (r.type === "tuple") {
		for (let e of r.items) if (W(e, n)) return !0;
		return !!(r.rest && W(r.rest, n));
	}
	return !1;
}
var Oo = (e, t = {}) => (n) => {
	let r = To({
		...n,
		processors: t
	});
	return U(e, r), Eo(r, e), Do(r, e);
}, ko = (e, t, n = {}) => (r) => {
	let { libraryOptions: i, target: a } = r ?? {}, o = To({
		...i ?? {},
		target: a,
		io: t,
		processors: n
	});
	return U(e, o), Eo(o, e), Do(o, e);
}, Ao = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
}, jo = (e, t, n, r) => {
	let i = n;
	i.type = "string";
	let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l } = e._zod.bag;
	if (typeof a == "number" && (i.minLength = a), typeof o == "number" && (i.maxLength = o), s && (i.format = Ao[s] ?? s, i.format === "" && delete i.format, s === "time" && delete i.format), l && (i.contentEncoding = l), c && c.size > 0) {
		let e = [...c];
		e.length === 1 ? i.pattern = e[0].source : e.length > 1 && (i.allOf = [...e.map((e) => ({
			...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: e.source
		}))]);
	}
}, Mo = (e, t, n, r) => {
	let i = n, { minimum: a, maximum: o, format: s, multipleOf: c, exclusiveMaximum: l, exclusiveMinimum: u } = e._zod.bag;
	typeof s == "string" && s.includes("int") ? i.type = "integer" : i.type = "number";
	let d = typeof u == "number" && u >= (a ?? -Infinity), f = typeof l == "number" && l <= (o ?? Infinity), p = t.target === "draft-04" || t.target === "openapi-3.0";
	d ? p ? (i.minimum = u, i.exclusiveMinimum = !0) : i.exclusiveMinimum = u : typeof a == "number" && (i.minimum = a), f ? p ? (i.maximum = l, i.exclusiveMaximum = !0) : i.exclusiveMaximum = l : typeof o == "number" && (i.maximum = o), typeof c == "number" && (i.multipleOf = c);
}, No = (e, t, n, r) => {
	n.type = "boolean";
}, Po = (e, t, n, r) => {
	n.not = {};
}, Fo = (e, t, n, r) => {
	let i = e._zod.def, a = xn(i.entries);
	a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), n.enum = a;
}, Io = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Custom types cannot be represented in JSON Schema");
}, Lo = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Transforms cannot be represented in JSON Schema");
}, Ro = (e, t, n, r) => {
	let i = n, a = e._zod.def, { minimum: o, maximum: s } = e._zod.bag;
	typeof o == "number" && (i.minItems = o), typeof s == "number" && (i.maxItems = s), i.type = "array", i.items = U(a.element, t, {
		...r,
		path: [...r.path, "items"]
	});
}, zo = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "object", i.properties = {};
	let o = a.shape;
	for (let e in o) i.properties[e] = U(o[e], t, {
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
	c.size > 0 && (i.required = Array.from(c)), a.catchall?._zod.def.type === "never" ? i.additionalProperties = !1 : a.catchall ? a.catchall && (i.additionalProperties = U(a.catchall, t, {
		...r,
		path: [...r.path, "additionalProperties"]
	})) : t.io === "output" && (i.additionalProperties = !1);
}, Bo = (e, t, n, r) => {
	let i = e._zod.def, a = i.inclusive === !1, o = i.options.map((e, n) => U(e, t, {
		...r,
		path: [
			...r.path,
			a ? "oneOf" : "anyOf",
			n
		]
	}));
	a ? n.oneOf = o : n.anyOf = o;
}, Vo = (e, t, n, r) => {
	let i = e._zod.def, a = U(i.left, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			0
		]
	}), o = U(i.right, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			1
		]
	}), s = (e) => "allOf" in e && Object.keys(e).length === 1;
	n.allOf = [...s(a) ? a.allOf : [a], ...s(o) ? o.allOf : [o]];
}, Ho = (e, t, n, r) => {
	let i = e._zod.def, a = U(i.innerType, t, r), o = t.seen.get(e);
	t.target === "openapi-3.0" ? (o.ref = i.innerType, n.nullable = !0) : n.anyOf = [a, { type: "null" }];
}, Uo = (e, t, n, r) => {
	let i = e._zod.def;
	U(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Wo = (e, t, n, r) => {
	let i = e._zod.def;
	U(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.default = JSON.parse(JSON.stringify(i.defaultValue));
}, Go = (e, t, n, r) => {
	let i = e._zod.def;
	U(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, t.io === "input" && (n._prefault = JSON.parse(JSON.stringify(i.defaultValue)));
}, Ko = (e, t, n, r) => {
	let i = e._zod.def;
	U(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o;
	try {
		o = i.catchValue(void 0);
	} catch {
		throw Error("Dynamic catch values are not supported in JSON Schema");
	}
	n.default = o;
}, qo = (e, t, n, r) => {
	let i = e._zod.def, a = i.in._zod.traits.has("$ZodTransform"), o = t.io === "input" ? a ? i.out : i.in : i.out;
	U(o, t, r);
	let s = t.seen.get(e);
	s.ref = o;
}, Jo = (e, t, n, r) => {
	let i = e._zod.def;
	U(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.readOnly = !0;
}, Yo = (e, t, n, r) => {
	let i = e._zod.def;
	U(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, Xo = /* @__PURE__ */ k("ZodISODateTime", (e, t) => {
	Ci.init(e, t), J.init(e, t);
});
function Zo(e) {
	return /* @__PURE__ */ Ka(Xo, e);
}
var Qo = /* @__PURE__ */ k("ZodISODate", (e, t) => {
	wi.init(e, t), J.init(e, t);
});
function $o(e) {
	return /* @__PURE__ */ qa(Qo, e);
}
var es = /* @__PURE__ */ k("ZodISOTime", (e, t) => {
	Ti.init(e, t), J.init(e, t);
});
function ts(e) {
	return /* @__PURE__ */ Ja(es, e);
}
var ns = /* @__PURE__ */ k("ZodISODuration", (e, t) => {
	Ei.init(e, t), J.init(e, t);
});
function rs(e) {
	return /* @__PURE__ */ Ya(ns, e);
}
var G = /* @__PURE__ */ k("ZodError", (e, t) => {
	Qn.init(e, t), e.name = "ZodError", Object.defineProperties(e, {
		format: { value: (t) => tr(e, t) },
		flatten: { value: (t) => er(e, t) },
		addIssue: { value: (t) => {
			e.issues.push(t), e.message = JSON.stringify(e.issues, Sn, 2);
		} },
		addIssues: { value: (t) => {
			e.issues.push(...t), e.message = JSON.stringify(e.issues, Sn, 2);
		} },
		isEmpty: { get() {
			return e.issues.length === 0;
		} }
	});
}, { Parent: Error }), is = /* @__PURE__ */ nr(G), as = /* @__PURE__ */ rr(G), os = /* @__PURE__ */ ir(G), ss = /* @__PURE__ */ or(G), cs = /* @__PURE__ */ cr(G), ls = /* @__PURE__ */ lr(G), us = /* @__PURE__ */ ur(G), ds = /* @__PURE__ */ dr(G), fs = /* @__PURE__ */ fr(G), ps = /* @__PURE__ */ pr(G), ms = /* @__PURE__ */ mr(G), hs = /* @__PURE__ */ hr(G), gs = /* @__PURE__ */ new WeakMap();
function _s(e, t, n) {
	let r = Object.getPrototypeOf(e), i = gs.get(r);
	if (i || (i = /* @__PURE__ */ new Set(), gs.set(r, i)), !i.has(t)) {
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
var K = /* @__PURE__ */ k("ZodType", (e, t) => (B.init(e, t), Object.assign(e["~standard"], { jsonSchema: {
	input: ko(e, "input"),
	output: ko(e, "output")
} }), e.toJSONSchema = Oo(e, {}), e.def = t, e.type = t.type, Object.defineProperty(e, "_def", { value: t }), e.parse = (t, n) => is(e, t, n, { callee: e.parse }), e.safeParse = (t, n) => os(e, t, n), e.parseAsync = async (t, n) => as(e, t, n, { callee: e.parseAsync }), e.safeParseAsync = async (t, n) => ss(e, t, n), e.spa = e.safeParseAsync, e.encode = (t, n) => cs(e, t, n), e.decode = (t, n) => ls(e, t, n), e.encodeAsync = async (t, n) => us(e, t, n), e.decodeAsync = async (t, n) => ds(e, t, n), e.safeEncode = (t, n) => fs(e, t, n), e.safeDecode = (t, n) => ps(e, t, n), e.safeEncodeAsync = async (t, n) => ms(e, t, n), e.safeDecodeAsync = async (t, n) => hs(e, t, n), _s(e, "ZodType", {
	check(...e) {
		let t = this.def;
		return this.clone(P(t, { checks: [...t.checks ?? [], ...e.map((e) => typeof e == "function" ? { _zod: {
			check: e,
			def: { check: "custom" },
			onattach: []
		} } : e)] }), { parent: !0 });
	},
	with(...e) {
		return this.check(...e);
	},
	clone(e, t) {
		return F(this, e, t);
	},
	brand() {
		return this;
	},
	register(e, t) {
		return e.add(this, t), this;
	},
	refine(e, t) {
		return this.check(wc(e, t));
	},
	superRefine(e, t) {
		return this.check(Tc(e, t));
	},
	overwrite(e) {
		return this.check(/* @__PURE__ */ H(e));
	},
	optional() {
		return oc(this);
	},
	exactOptional() {
		return cc(this);
	},
	nullable() {
		return uc(this);
	},
	nullish() {
		return oc(uc(this));
	},
	nonoptional(e) {
		return gc(this, e);
	},
	array() {
		return Ys(this);
	},
	or(e) {
		return Qs([this, e]);
	},
	and(e) {
		return ec(this, e);
	},
	transform(e) {
		return bc(this, ic(e));
	},
	default(e) {
		return fc(this, e);
	},
	prefault(e) {
		return mc(this, e);
	},
	catch(e) {
		return vc(this, e);
	},
	pipe(e) {
		return bc(this, e);
	},
	readonly() {
		return Sc(this);
	},
	describe(e) {
		let t = this.clone();
		return Sa.add(t, { description: e }), t;
	},
	meta(...e) {
		if (e.length === 0) return Sa.get(this);
		let t = this.clone();
		return Sa.add(t, e[0]), t;
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
		return Sa.get(e)?.description;
	},
	configurable: !0
}), e)), vs = /* @__PURE__ */ k("_ZodString", (e, t) => {
	di.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => jo(e, t, n, r);
	let n = e._zod.bag;
	e.format = n.format ?? null, e.minLength = n.minimum ?? null, e.maxLength = n.maximum ?? null, _s(e, "_ZodString", {
		regex(...e) {
			return this.check(/* @__PURE__ */ lo(...e));
		},
		includes(...e) {
			return this.check(/* @__PURE__ */ po(...e));
		},
		startsWith(...e) {
			return this.check(/* @__PURE__ */ mo(...e));
		},
		endsWith(...e) {
			return this.check(/* @__PURE__ */ ho(...e));
		},
		min(...e) {
			return this.check(/* @__PURE__ */ so(...e));
		},
		max(...e) {
			return this.check(/* @__PURE__ */ oo(...e));
		},
		length(...e) {
			return this.check(/* @__PURE__ */ co(...e));
		},
		nonempty(...e) {
			return this.check(/* @__PURE__ */ so(1, ...e));
		},
		lowercase(e) {
			return this.check(/* @__PURE__ */ uo(e));
		},
		uppercase(e) {
			return this.check(/* @__PURE__ */ fo(e));
		},
		trim() {
			return this.check(/* @__PURE__ */ _o());
		},
		normalize(...e) {
			return this.check(/* @__PURE__ */ go(...e));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ vo());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ yo());
		},
		slugify() {
			return this.check(/* @__PURE__ */ bo());
		}
	});
}), ys = /* @__PURE__ */ k("ZodString", (e, t) => {
	di.init(e, t), vs.init(e, t), e.email = (t) => e.check(/* @__PURE__ */ wa(bs, t)), e.url = (t) => e.check(/* @__PURE__ */ Aa(Cs, t)), e.jwt = (t) => e.check(/* @__PURE__ */ Ga(Rs, t)), e.emoji = (t) => e.check(/* @__PURE__ */ ja(ws, t)), e.guid = (t) => e.check(/* @__PURE__ */ Ta(xs, t)), e.uuid = (t) => e.check(/* @__PURE__ */ Ea(Ss, t)), e.uuidv4 = (t) => e.check(/* @__PURE__ */ Da(Ss, t)), e.uuidv6 = (t) => e.check(/* @__PURE__ */ Oa(Ss, t)), e.uuidv7 = (t) => e.check(/* @__PURE__ */ ka(Ss, t)), e.nanoid = (t) => e.check(/* @__PURE__ */ Ma(Ts, t)), e.guid = (t) => e.check(/* @__PURE__ */ Ta(xs, t)), e.cuid = (t) => e.check(/* @__PURE__ */ Na(Es, t)), e.cuid2 = (t) => e.check(/* @__PURE__ */ Pa(Ds, t)), e.ulid = (t) => e.check(/* @__PURE__ */ Fa(Os, t)), e.base64 = (t) => e.check(/* @__PURE__ */ Ha(Fs, t)), e.base64url = (t) => e.check(/* @__PURE__ */ Ua(Is, t)), e.xid = (t) => e.check(/* @__PURE__ */ Ia(ks, t)), e.ksuid = (t) => e.check(/* @__PURE__ */ La(As, t)), e.ipv4 = (t) => e.check(/* @__PURE__ */ Ra(js, t)), e.ipv6 = (t) => e.check(/* @__PURE__ */ za(Ms, t)), e.cidrv4 = (t) => e.check(/* @__PURE__ */ Ba(Ns, t)), e.cidrv6 = (t) => e.check(/* @__PURE__ */ Va(Ps, t)), e.e164 = (t) => e.check(/* @__PURE__ */ Wa(Ls, t)), e.datetime = (t) => e.check(Zo(t)), e.date = (t) => e.check($o(t)), e.time = (t) => e.check(ts(t)), e.duration = (t) => e.check(rs(t));
});
function q(e) {
	return /* @__PURE__ */ Ca(ys, e);
}
var J = /* @__PURE__ */ k("ZodStringFormat", (e, t) => {
	V.init(e, t), vs.init(e, t);
}), bs = /* @__PURE__ */ k("ZodEmail", (e, t) => {
	mi.init(e, t), J.init(e, t);
}), xs = /* @__PURE__ */ k("ZodGUID", (e, t) => {
	fi.init(e, t), J.init(e, t);
}), Ss = /* @__PURE__ */ k("ZodUUID", (e, t) => {
	pi.init(e, t), J.init(e, t);
}), Cs = /* @__PURE__ */ k("ZodURL", (e, t) => {
	hi.init(e, t), J.init(e, t);
}), ws = /* @__PURE__ */ k("ZodEmoji", (e, t) => {
	gi.init(e, t), J.init(e, t);
}), Ts = /* @__PURE__ */ k("ZodNanoID", (e, t) => {
	_i.init(e, t), J.init(e, t);
}), Es = /* @__PURE__ */ k("ZodCUID", (e, t) => {
	vi.init(e, t), J.init(e, t);
}), Ds = /* @__PURE__ */ k("ZodCUID2", (e, t) => {
	yi.init(e, t), J.init(e, t);
}), Os = /* @__PURE__ */ k("ZodULID", (e, t) => {
	bi.init(e, t), J.init(e, t);
}), ks = /* @__PURE__ */ k("ZodXID", (e, t) => {
	xi.init(e, t), J.init(e, t);
}), As = /* @__PURE__ */ k("ZodKSUID", (e, t) => {
	Si.init(e, t), J.init(e, t);
}), js = /* @__PURE__ */ k("ZodIPv4", (e, t) => {
	Di.init(e, t), J.init(e, t);
}), Ms = /* @__PURE__ */ k("ZodIPv6", (e, t) => {
	Oi.init(e, t), J.init(e, t);
}), Ns = /* @__PURE__ */ k("ZodCIDRv4", (e, t) => {
	ki.init(e, t), J.init(e, t);
}), Ps = /* @__PURE__ */ k("ZodCIDRv6", (e, t) => {
	Ai.init(e, t), J.init(e, t);
}), Fs = /* @__PURE__ */ k("ZodBase64", (e, t) => {
	Mi.init(e, t), J.init(e, t);
}), Is = /* @__PURE__ */ k("ZodBase64URL", (e, t) => {
	Pi.init(e, t), J.init(e, t);
}), Ls = /* @__PURE__ */ k("ZodE164", (e, t) => {
	Fi.init(e, t), J.init(e, t);
}), Rs = /* @__PURE__ */ k("ZodJWT", (e, t) => {
	Li.init(e, t), J.init(e, t);
}), zs = /* @__PURE__ */ k("ZodNumber", (e, t) => {
	Ri.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Mo(e, t, n, r), _s(e, "ZodNumber", {
		gt(e, t) {
			return this.check(/* @__PURE__ */ ro(e, t));
		},
		gte(e, t) {
			return this.check(/* @__PURE__ */ io(e, t));
		},
		min(e, t) {
			return this.check(/* @__PURE__ */ io(e, t));
		},
		lt(e, t) {
			return this.check(/* @__PURE__ */ to(e, t));
		},
		lte(e, t) {
			return this.check(/* @__PURE__ */ no(e, t));
		},
		max(e, t) {
			return this.check(/* @__PURE__ */ no(e, t));
		},
		int(e) {
			return this.check(Vs(e));
		},
		safe(e) {
			return this.check(Vs(e));
		},
		positive(e) {
			return this.check(/* @__PURE__ */ ro(0, e));
		},
		nonnegative(e) {
			return this.check(/* @__PURE__ */ io(0, e));
		},
		negative(e) {
			return this.check(/* @__PURE__ */ to(0, e));
		},
		nonpositive(e) {
			return this.check(/* @__PURE__ */ no(0, e));
		},
		multipleOf(e, t) {
			return this.check(/* @__PURE__ */ ao(e, t));
		},
		step(e, t) {
			return this.check(/* @__PURE__ */ ao(e, t));
		},
		finite() {
			return this;
		}
	});
	let n = e._zod.bag;
	e.minValue = Math.max(n.minimum ?? -Infinity, n.exclusiveMinimum ?? -Infinity) ?? null, e.maxValue = Math.min(n.maximum ?? Infinity, n.exclusiveMaximum ?? Infinity) ?? null, e.isInt = (n.format ?? "").includes("int") || Number.isSafeInteger(n.multipleOf ?? .5), e.isFinite = !0, e.format = n.format ?? null;
});
function Y(e) {
	return /* @__PURE__ */ Xa(zs, e);
}
var Bs = /* @__PURE__ */ k("ZodNumberFormat", (e, t) => {
	zi.init(e, t), zs.init(e, t);
});
function Vs(e) {
	return /* @__PURE__ */ Za(Bs, e);
}
var Hs = /* @__PURE__ */ k("ZodBoolean", (e, t) => {
	Bi.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => No(e, t, n, r);
});
function Us(e) {
	return /* @__PURE__ */ Qa(Hs, e);
}
var Ws = /* @__PURE__ */ k("ZodUnknown", (e, t) => {
	Vi.init(e, t), K.init(e, t), e._zod.processJSONSchema = (e, t, n) => void 0;
});
function Gs() {
	return /* @__PURE__ */ $a(Ws);
}
var Ks = /* @__PURE__ */ k("ZodNever", (e, t) => {
	Hi.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Po(e, t, n, r);
});
function qs(e) {
	return /* @__PURE__ */ eo(Ks, e);
}
var Js = /* @__PURE__ */ k("ZodArray", (e, t) => {
	Wi.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ro(e, t, n, r), e.element = t.element, _s(e, "ZodArray", {
		min(e, t) {
			return this.check(/* @__PURE__ */ so(e, t));
		},
		nonempty(e) {
			return this.check(/* @__PURE__ */ so(1, e));
		},
		max(e, t) {
			return this.check(/* @__PURE__ */ oo(e, t));
		},
		length(e, t) {
			return this.check(/* @__PURE__ */ co(e, t));
		},
		unwrap() {
			return this.element;
		}
	});
});
function Ys(e, t) {
	return /* @__PURE__ */ xo(Js, e, t);
}
var Xs = /* @__PURE__ */ k("ZodObject", (e, t) => {
	Yi.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => zo(e, t, n, r), M(e, "shape", () => t.shape), _s(e, "ZodObject", {
		keyof() {
			return nc(Object.keys(this._zod.def.shape));
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
				catchall: Gs()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: Gs()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: qs()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(e) {
			return Vn(this, e);
		},
		safeExtend(e) {
			return Hn(this, e);
		},
		merge(e) {
			return Un(this, e);
		},
		pick(e) {
			return zn(this, e);
		},
		omit(e) {
			return Bn(this, e);
		},
		partial(...e) {
			return Wn(ac, this, e[0]);
		},
		required(...e) {
			return Gn(hc, this, e[0]);
		}
	});
});
function X(e, t) {
	return new Xs({
		type: "object",
		shape: e ?? {},
		...I(t)
	});
}
var Zs = /* @__PURE__ */ k("ZodUnion", (e, t) => {
	Zi.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Bo(e, t, n, r), e.options = t.options;
});
function Qs(e, t) {
	return new Zs({
		type: "union",
		options: e,
		...I(t)
	});
}
var $s = /* @__PURE__ */ k("ZodIntersection", (e, t) => {
	Qi.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Vo(e, t, n, r);
});
function ec(e, t) {
	return new $s({
		type: "intersection",
		left: e,
		right: t
	});
}
var tc = /* @__PURE__ */ k("ZodEnum", (e, t) => {
	ta.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Fo(e, t, n, r), e.enum = t.entries, e.options = Object.values(t.entries);
	let n = new Set(Object.keys(t.entries));
	e.extract = (e, r) => {
		let i = {};
		for (let r of e) if (n.has(r)) i[r] = t.entries[r];
		else throw Error(`Key ${r} not found in enum`);
		return new tc({
			...t,
			checks: [],
			...I(r),
			entries: i
		});
	}, e.exclude = (e, r) => {
		let i = { ...t.entries };
		for (let t of e) if (n.has(t)) delete i[t];
		else throw Error(`Key ${t} not found in enum`);
		return new tc({
			...t,
			checks: [],
			...I(r),
			entries: i
		});
	};
});
function nc(e, t) {
	return new tc({
		type: "enum",
		entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
		...I(t)
	});
}
var rc = /* @__PURE__ */ k("ZodTransform", (e, t) => {
	na.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Lo(e, t, n, r), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new yn(e.constructor.name);
		n.addIssue = (r) => {
			if (typeof r == "string") n.issues.push(Xn(r, n.value, t));
			else {
				let t = r;
				t.fatal && (t.continue = !1), t.code ??= "custom", t.input ??= n.value, t.inst ??= e, n.issues.push(Xn(t));
			}
		};
		let i = t.transform(n.value, n);
		return i instanceof Promise ? i.then((e) => (n.value = e, n.fallback = !0, n)) : (n.value = i, n.fallback = !0, n);
	};
});
function ic(e) {
	return new rc({
		type: "transform",
		transform: e
	});
}
var ac = /* @__PURE__ */ k("ZodOptional", (e, t) => {
	ia.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Yo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function oc(e) {
	return new ac({
		type: "optional",
		innerType: e
	});
}
var sc = /* @__PURE__ */ k("ZodExactOptional", (e, t) => {
	aa.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Yo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function cc(e) {
	return new sc({
		type: "optional",
		innerType: e
	});
}
var lc = /* @__PURE__ */ k("ZodNullable", (e, t) => {
	oa.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ho(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function uc(e) {
	return new lc({
		type: "nullable",
		innerType: e
	});
}
var dc = /* @__PURE__ */ k("ZodDefault", (e, t) => {
	sa.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Wo(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function fc(e, t) {
	return new dc({
		type: "default",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : Pn(t);
		}
	});
}
var pc = /* @__PURE__ */ k("ZodPrefault", (e, t) => {
	la.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Go(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function mc(e, t) {
	return new pc({
		type: "prefault",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : Pn(t);
		}
	});
}
var hc = /* @__PURE__ */ k("ZodNonOptional", (e, t) => {
	ua.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Uo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function gc(e, t) {
	return new hc({
		type: "nonoptional",
		innerType: e,
		...I(t)
	});
}
var _c = /* @__PURE__ */ k("ZodCatch", (e, t) => {
	fa.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ko(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function vc(e, t) {
	return new _c({
		type: "catch",
		innerType: e,
		catchValue: typeof t == "function" ? t : () => t
	});
}
var yc = /* @__PURE__ */ k("ZodPipe", (e, t) => {
	pa.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => qo(e, t, n, r), e.in = t.in, e.out = t.out;
});
function bc(e, t) {
	return new yc({
		type: "pipe",
		in: e,
		out: t
	});
}
var xc = /* @__PURE__ */ k("ZodReadonly", (e, t) => {
	ha.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Jo(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Sc(e) {
	return new xc({
		type: "readonly",
		innerType: e
	});
}
var Cc = /* @__PURE__ */ k("ZodCustom", (e, t) => {
	_a.init(e, t), K.init(e, t), e._zod.processJSONSchema = (t, n, r) => Io(e, t, n, r);
});
function wc(e, t = {}) {
	return /* @__PURE__ */ So(Cc, e, t);
}
function Tc(e, t) {
	return /* @__PURE__ */ Co(e, t);
}
//#endregion
//#region electron/bridge/tickets.ts
var Ec = nc([
	"Explore",
	"Feature",
	"Execute"
]), Dc = {
	Execute: "Draft",
	Explore: "Open",
	Feature: "Idea"
}, Oc = "\n  INSERT INTO tickets (uuid, id, title, type, status, backlog, description, archived, created_at, updated_at)\n  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n  ON CONFLICT(uuid) DO UPDATE SET\n    id          = excluded.id,\n    title       = excluded.title,\n    type        = excluded.type,\n    status      = excluded.status,\n    backlog     = excluded.backlog,\n    description = excluded.description,\n    archived    = excluded.archived,\n    updated_at  = excluded.updated_at\n", kc = "counter", Ac = "OVH";
function jc() {
	let e = _("SELECT value FROM settings WHERE key = ?", [kc]), t = (e?.[0]?.value ? parseInt(e[0].value, 10) : 0) + 1;
	return _("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [kc, String(t)]), `${Ac}-${String(t).padStart(3, "0")}`;
}
function Mc(e) {
	return {
		...e,
		backlog: e.backlog === 1,
		archived: e.archived === 1
	};
}
function Nc(e) {
	return sn("SELECT * FROM tickets WHERE uuid = ? LIMIT 1", [e])[0] ?? null;
}
function Pc(e) {
	sn(Oc, [
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
	]), hn(e.uuid);
}
var Fc = X({
	title: q().min(1),
	type: Ec,
	status: q().min(1).optional(),
	description: q().default(""),
	backlog: Us().default(!1)
}), Ic = X({
	uuid: q().min(1),
	patch: X({
		title: q().min(1).optional(),
		status: q().min(1).optional(),
		description: q().optional(),
		backlog: Us().optional(),
		archived: Us().optional()
	})
}), Lc = X({ uuid: q().min(1) });
function Rc(e) {
	let t = Fc.parse(e), n = Date.now(), r = {
		uuid: m(),
		id: jc(),
		title: t.title,
		type: t.type,
		status: t.status ?? Dc[t.type],
		backlog: t.backlog,
		description: t.description,
		archived: !1,
		created_at: n,
		updated_at: n
	};
	return Pc(r), r;
}
function zc(e) {
	let { uuid: t } = Lc.parse(e), n = Nc(t);
	return n ? Mc(n) : null;
}
function Bc() {
	return sn("SELECT * FROM tickets ORDER BY created_at ASC", []).map(Mc);
}
function Vc(e) {
	let { uuid: t, patch: n } = Ic.parse(e), r = Nc(t);
	if (!r) throw Error(`bridge: ticket "${t}" not found.`);
	let i = {
		...Mc(r),
		...n,
		updated_at: Date.now()
	};
	return Pc(i), i;
}
function Hc(e) {
	let { uuid: t } = Lc.parse(e);
	return sn("DELETE FROM tickets WHERE uuid = ?", [t]), hn(t), { uuid: t };
}
//#endregion
//#region electron/bridge/relations.ts
var Uc = X({
	a: q().min(1),
	b: q().min(1)
}), Wc = X({
	blocked: q().min(1),
	blocker: q().min(1)
}), Gc = X({ uuid: q().min(1) }), Kc = X({ ticketUuid: q().min(1) });
function qc(e) {
	let { a: t, b: n } = Uc.parse(e), r = dn("add", {
		type: "relates-to",
		node_a: t,
		node_b: n
	});
	return O(), r;
}
function Jc(e) {
	let { blocked: t, blocker: n } = Wc.parse(e), r = dn("add", {
		type: "blocked-by",
		node_a: t,
		node_b: n
	});
	return O(), r;
}
function Yc(e) {
	let { uuid: t } = Gc.parse(e), n = dn("remove", { uuid: t });
	return O(), n;
}
function Xc(e) {
	let { ticketUuid: t } = Kc.parse(e);
	return dn("list", { ticketUuid: t });
}
//#endregion
//#region electron/bridge/views.ts
var Zc = X({ name: q().min(1) }), Qc = X({ uuid: q().min(1) }), $c = X({
	uuid: q().min(1),
	name: q().min(1)
}), el = X({ viewUuid: q().min(1) }), tl = X({
	viewUuid: q().min(1),
	ticketUuid: q().min(1),
	x: Y(),
	y: Y()
}), nl = X({
	viewUuid: q().min(1),
	ticketUuid: q().min(1)
}), rl = X({ viewUuid: q().min(1) }), il = nc([
	"left",
	"right",
	"top",
	"bottom"
]), al = X({
	viewUuid: q().min(1),
	sourceUuid: q().min(1),
	targetUuid: q().min(1),
	sourceHandle: il.optional(),
	targetHandle: il.optional()
}), ol = X({ uuid: q().min(1) }), sl = X({
	x: Y(),
	y: Y()
}), cl = X({
	dx: Y(),
	dy: Y()
}), ll = X({
	viewUuid: q().min(1),
	ticketUuid: q().min(1)
}), ul = X({
	viewUuid: q().min(1),
	ticketUuid: q().min(1),
	...sl.shape
}), dl = X({
	viewUuid: q().min(1),
	ticketUuid: q().min(1),
	...cl.shape
});
function fl() {
	return _("SELECT uuid, name, created_at FROM graph_views ORDER BY created_at ASC", []);
}
function pl(e) {
	let { name: t } = Zc.parse(e), n = m(), r = Date.now();
	return _("INSERT INTO graph_views (uuid, name, created_at) VALUES (?, ?, ?)", [
		n,
		t,
		r
	]), O(), {
		uuid: n,
		name: t,
		created_at: r
	};
}
function ml(e) {
	let { uuid: t, name: n } = $c.parse(e), r = _("SELECT uuid, name, created_at FROM graph_views WHERE uuid = ?", [t]);
	if (!r[0]) throw Error(`bridge: view "${t}" not found.`);
	return _("UPDATE graph_views SET name = ? WHERE uuid = ?", [n, t]), O(), {
		...r[0],
		name: n
	};
}
function hl(e) {
	let { uuid: t } = Qc.parse(e);
	return _("DELETE FROM graph_views WHERE uuid = ?", [t]), O(), { uuid: t };
}
function gl(e) {
	let { viewUuid: t } = el.parse(e);
	return _("SELECT n.ticket_uuid, t.id, t.title, t.type, t.status, n.x, n.y\n     FROM graph_view_nodes n\n     JOIN tickets t ON t.uuid = n.ticket_uuid\n     WHERE n.view_uuid = ?\n     ORDER BY t.created_at ASC", [t]);
}
function _l(e) {
	let { viewUuid: t, ticketUuid: n } = ll.parse(e);
	return _("SELECT n.ticket_uuid, t.id, t.title, t.type, t.status, n.x, n.y\n     FROM graph_view_nodes n\n     JOIN tickets t ON t.uuid = n.ticket_uuid\n     WHERE n.view_uuid = ? AND n.ticket_uuid = ?", [t, n])[0] ?? null;
}
function vl(e) {
	let { viewUuid: t } = el.parse(e), n = _("SELECT uuid, name, created_at FROM graph_views WHERE uuid = ?", [t]);
	if (!n[0]) throw Error(`bridge: view "${t}" not found.`);
	let r = _("SELECT n.ticket_uuid, t.id, t.title, t.type, t.status, n.x, n.y\n     FROM graph_view_nodes n\n     JOIN tickets t ON t.uuid = n.ticket_uuid\n     WHERE n.view_uuid = ?\n     ORDER BY t.created_at ASC", [t]), i = _("SELECT uuid, source_uuid, target_uuid, source_handle, target_handle FROM graph_view_edges WHERE view_uuid = ?", [t]);
	return {
		view: n[0],
		nodes: r,
		edges: i
	};
}
function yl(e) {
	let { viewUuid: t, ticketUuid: n, x: r, y: i } = ul.parse(e), a = _l({
		viewUuid: t,
		ticketUuid: n
	});
	if (!a) throw Error(`bridge: node "${n}" not found in view "${t}".`);
	return _("UPDATE graph_view_nodes SET x = ?, y = ? WHERE view_uuid = ? AND ticket_uuid = ?", [
		r,
		i,
		t,
		n
	]), O(), {
		...a,
		x: r,
		y: i
	};
}
function bl(e) {
	let { viewUuid: t, ticketUuid: n, dx: r, dy: i } = dl.parse(e), a = _l({
		viewUuid: t,
		ticketUuid: n
	});
	if (!a) throw Error(`bridge: node "${n}" not found in view "${t}".`);
	let o = a.x + r, s = a.y + i;
	return _("UPDATE graph_view_nodes SET x = ?, y = ? WHERE view_uuid = ? AND ticket_uuid = ?", [
		o,
		s,
		t,
		n
	]), O(), {
		...a,
		x: o,
		y: s
	};
}
function xl(e) {
	let { viewUuid: t, ticketUuid: n, x: r, y: i } = tl.parse(e);
	_("INSERT INTO graph_view_nodes (view_uuid, ticket_uuid, x, y)\n     VALUES (?, ?, ?, ?)\n     ON CONFLICT(view_uuid, ticket_uuid) DO UPDATE SET x = excluded.x, y = excluded.y", [
		t,
		n,
		r,
		i
	]), O();
}
function Sl(e) {
	let { viewUuid: t, ticketUuid: n } = nl.parse(e);
	_("DELETE FROM graph_view_nodes WHERE view_uuid = ? AND ticket_uuid = ?", [t, n]), O();
}
function Cl(e) {
	let { viewUuid: t } = rl.parse(e);
	return _("SELECT uuid, source_uuid, target_uuid, source_handle, target_handle FROM graph_view_edges WHERE view_uuid = ?", [t]);
}
function wl(e) {
	let { viewUuid: t, sourceUuid: n, targetUuid: r, sourceHandle: i, targetHandle: a } = al.parse(e), o = m(), s = i ?? null, c = a ?? null;
	return _("INSERT INTO graph_view_edges (uuid, view_uuid, source_uuid, target_uuid, source_handle, target_handle) VALUES (?, ?, ?, ?, ?, ?)", [
		o,
		t,
		n,
		r,
		s,
		c
	]), O(), {
		uuid: o,
		source_uuid: n,
		target_uuid: r,
		source_handle: s,
		target_handle: c
	};
}
function Tl(e) {
	let { uuid: t } = ol.parse(e);
	return _("DELETE FROM graph_view_edges WHERE uuid = ?", [t]), O(), { uuid: t };
}
//#endregion
//#region electron/bridge/index.ts
var El = {
	createTicket: Rc,
	getTicket: zc,
	listTickets: Bc,
	updateTicket: Vc,
	deleteTicket: Hc,
	relate: qc,
	blockBy: Jc,
	unrelate: Yc,
	listRelations: Xc,
	listViews: fl,
	createView: pl,
	renameView: ml,
	deleteView: hl,
	listViewNodes: gl,
	addViewNode: xl,
	removeViewNode: Sl,
	getViewNode: _l,
	getViewMap: vl,
	moveViewNode: yl,
	nudgeViewNode: bl,
	listViewEdges: Cl,
	createViewEdge: wl,
	removeViewEdge: Tl
};
function Dl(e, t, n = {}) {
	let r = El[e];
	if (!r) throw Error(`bridge: unknown method "${e}".`);
	return _n(e, n), r(t);
}
//#endregion
//#region electron/transports/http.ts
var Ol = 49152, Z = null;
function kl(e) {
	return JSON.stringify(e);
}
function Al() {
	Z = he((e, t) => {
		if (t.setHeader("Content-Type", "application/json"), e.method !== "POST" || e.url !== "/invoke") {
			t.writeHead(404).end(kl({ error: "Not found. Use POST /invoke." }));
			return;
		}
		let n = [];
		e.on("data", (e) => n.push(e)), e.on("end", () => {
			try {
				let e = JSON.parse(Buffer.concat(n).toString()), r = Dl(e.method, e.args ?? null);
				t.writeHead(200).end(kl({ result: r }));
			} catch (e) {
				t.writeHead(400).end(kl({ error: e.message }));
			}
		});
	}), Z.on("error", (e) => {
		e.code === "EADDRINUSE" ? console.warn(`[bridge] port ${Ol} already in use — another instance is running. HTTP transport disabled for this process.`) : console.error("[bridge] HTTP server error:", e), Z = null;
	}), Z.listen(Ol, "127.0.0.1", () => {
		console.log(`[bridge] HTTP server listening on 127.0.0.1:${Ol}`);
	});
}
function jl() {
	Z?.close(), Z = null;
}
//#endregion
//#region electron/transports/unix.ts
var Q = null, $ = null;
function Ml(e) {
	if ($ = o(e, "bridge.sock"), ee($)) try {
		ne($);
	} catch {}
	Q = ge((e) => {
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
				let e = JSON.parse(i), t = Dl(e.method, e.args ?? null, { caller: "unix" });
				a = JSON.stringify({ result: t });
			} catch (e) {
				a = JSON.stringify({ error: e.message });
			}
			e.end(a + "\n");
		}), e.on("error", (e) => {
			console.error("[bridge:unix] socket error:", e);
		});
	}), Q.on("error", (e) => {
		console.error("[bridge:unix] server error:", e), Q = null;
	}), Q.listen({
		path: $,
		readableAll: !1,
		writableAll: !1
	}, () => {
		console.log(`[bridge] unix socket at ${$}`);
	});
}
function Nl() {
	if (Q?.close(), Q = null, $ && ee($)) try {
		ne($);
	} catch {}
	$ = null;
}
//#endregion
//#region electron/main.ts
var Pl = a.dirname(u(import.meta.url));
process.env.APP_ROOT = a.join(Pl, "..");
var Fl = process.env.VITE_DEV_SERVER_URL, Il = a.join(process.env.APP_ROOT, "dist"), Ll = null;
function Rl() {
	let t = r.getAllDisplays(), n = t[1] ?? t[0], { x: i, y: o } = n.bounds;
	Ll = new e({
		width: 1200,
		height: 800,
		x: i + Math.round((n.bounds.width - 1200) / 2),
		y: o + Math.round((n.bounds.height - 800) / 2),
		webPreferences: {
			preload: a.join(Pl, "preload.js"),
			sandbox: !1
		}
	}), Fl ? Ll.loadURL(Fl) : Ll.loadFile(a.join(Il, "index.html"));
}
t.whenReady().then(() => {
	let e = t.getPath("userData");
	_e(a.join(e, "overhead.db")), xe(a.join(e, "vault")), Gt(Se(), hn), Jt(), cn(), ln(), fn(), mn(), gn(e), Al(), Ml(e), Rl();
}), t.on("before-quit", () => {
	on(), jl(), Nl(), Kt();
}), t.on("window-all-closed", () => {
	process.platform !== "darwin" && t.quit(), Ll = null;
}), t.on("activate", () => {
	e.getAllWindows().length === 0 && Rl();
});
//#endregion
