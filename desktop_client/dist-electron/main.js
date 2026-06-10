import { BrowserWindow as e, app as t, ipcMain as n } from "electron";
import * as r from "node:path";
import i, { join as a, relative as o, resolve as s, sep as c } from "node:path";
import { fileURLToPath as l } from "node:url";
import { DatabaseSync as u } from "node:sqlite";
import { createHash as d } from "node:crypto";
import f, { stat as ee, unwatchFile as te, watch as ne, watchFile as re } from "node:fs";
import { EventEmitter as ie } from "node:events";
import { lstat as p, open as ae, readdir as m, realpath as h, stat as g } from "node:fs/promises";
import { Readable as oe } from "node:stream";
import { type as se } from "node:os";
//#region electron/db/sqlite.ts
var _ = null;
function ce(e) {
	_ || (_ = new u(e), _.exec("PRAGMA foreign_keys = ON"), _.exec("\n    CREATE TABLE IF NOT EXISTS tickets (\n      uuid        TEXT PRIMARY KEY,\n      id          TEXT NOT NULL,\n      title       TEXT NOT NULL,\n      type        TEXT NOT NULL CHECK(type IN ('Explore', 'Feature', 'Execute')),\n      status      TEXT NOT NULL,\n      backlog     INTEGER NOT NULL DEFAULT 0,\n      description TEXT NOT NULL DEFAULT '',\n      archived    INTEGER NOT NULL DEFAULT 0,\n      created_at  INTEGER NOT NULL,\n      updated_at  INTEGER NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS settings (\n      key   TEXT PRIMARY KEY,\n      value TEXT NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS ticket_history (\n      ticket_uuid  TEXT    NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,\n      ts           INTEGER NOT NULL,\n      description  TEXT    NOT NULL,\n      hash         TEXT    NOT NULL,\n      PRIMARY KEY (ticket_uuid, ts)\n    );\n\n  "));
}
function v() {
	if (!_) throw Error("SQLite not initialised — call initSqlite() first.");
	return _;
}
function y(e, t) {
	if (!t.trim()) return;
	let n = d("sha256").update(t).digest("hex");
	if (v().prepare("SELECT hash FROM ticket_history WHERE ticket_uuid = ? ORDER BY ts DESC LIMIT 1").get(e)?.hash === n) return;
	let r = Math.floor(Date.now() / 1e3);
	v().prepare("INSERT OR REPLACE INTO ticket_history (ticket_uuid, ts, description, hash) VALUES (?, ?, ?, ?)").run(e, r, t, n);
}
function le(e) {
	return v().prepare("SELECT ts, description FROM ticket_history WHERE ticket_uuid = ? ORDER BY ts DESC").all(e);
}
function b(e, t = []) {
	let n = v().prepare(e);
	return /^\s*SELECT/i.test(e) ? n.all(...t) : n.run(...t);
}
//#endregion
//#region electron/vault/vaultManager.ts
var x = "", S = /* @__PURE__ */ new Map();
function ue(e) {
	x = e, f.mkdirSync(e, { recursive: !0 }), fe();
}
function de() {
	return x;
}
function fe() {
	S.clear();
	for (let e of f.readdirSync(x)) {
		if (!e.endsWith(".md")) continue;
		let t = f.readFileSync(i.join(x, e), "utf8").match(/^uuid:\s*(.+)$/m);
		t && S.set(t[1].trim(), e);
	}
}
function pe(e) {
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
function me(e) {
	if (!x) return;
	let t = b("SELECT * FROM tickets WHERE uuid = ? LIMIT 1", [e])[0];
	if (!t || t.archived === 1) {
		C(e);
		return;
	}
	let n = `${t.id}.md`, r = i.join(x, n), a = S.get(e);
	a && a !== n && f.rmSync(i.join(x, a), { force: !0 });
	let o = `${pe(t)}\n\n${t.description}`;
	f.writeFileSync(r, o, "utf8"), S.set(e, n);
}
function C(e) {
	if (!x) return;
	let t = S.get(e);
	t && (f.rmSync(i.join(x, t), { force: !0 }), S.delete(e));
}
function he() {
	x && (f.rmSync(x, {
		recursive: !0,
		force: !0
	}), f.mkdirSync(x, { recursive: !0 }), S.clear());
}
//#endregion
//#region node_modules/readdirp/index.js
var w = {
	FILE_TYPE: "files",
	DIR_TYPE: "directories",
	FILE_DIR_TYPE: "files_directories",
	EVERYTHING_TYPE: "all"
}, T = {
	root: ".",
	fileFilter: (e) => !0,
	directoryFilter: (e) => !0,
	type: w.FILE_TYPE,
	lstat: !1,
	depth: 2147483648,
	alwaysStat: !1,
	highWaterMark: 4096
};
Object.freeze(T);
var ge = "READDIRP_RECURSIVE_ERROR", _e = new Set([
	"ENOENT",
	"EPERM",
	"EACCES",
	"ELOOP",
	ge
]), E = [
	w.DIR_TYPE,
	w.EVERYTHING_TYPE,
	w.FILE_DIR_TYPE,
	w.FILE_TYPE
], ve = new Set([
	w.DIR_TYPE,
	w.EVERYTHING_TYPE,
	w.FILE_DIR_TYPE
]), ye = new Set([
	w.EVERYTHING_TYPE,
	w.FILE_DIR_TYPE,
	w.FILE_TYPE
]), be = (e) => _e.has(e.code), xe = process.platform === "win32", D = (e) => !0, O = (e) => {
	if (e === void 0) return D;
	if (typeof e == "function") return e;
	if (typeof e == "string") {
		let t = e.trim();
		return (e) => e.basename === t;
	}
	if (Array.isArray(e)) {
		let t = e.map((e) => e.trim());
		return (e) => t.some((t) => e.basename === t);
	}
	return D;
}, Se = class extends oe {
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
			...T,
			...e
		}, { root: n, type: r } = t;
		this._fileFilter = O(t.fileFilter), this._directoryFilter = O(t.directoryFilter);
		let i = t.lstat ? p : g;
		xe ? this._stat = (e) => i(e, { bigint: !0 }) : this._stat = i, this._maxDepth = t.depth != null && Number.isSafeInteger(t.depth) ? t.depth : T.depth, this._wantsDir = r ? ve.has(r) : !1, this._wantsFile = r ? ye.has(r) : !1, this._wantsEverything = r === w.EVERYTHING_TYPE, this._root = s(n), this._isDirent = !t.alwaysStat, this._statsProp = this._isDirent ? "dirent" : "stats", this._rdOptions = {
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
			n = await m(e, this._rdOptions);
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
			let i = s(a(t, r));
			n = {
				path: o(this._root, i),
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
		be(e) && !this.destroyed ? this.emit("warn", e) : this.destroy(e);
	}
	async _getEntryType(e) {
		if (!e && this._statsProp in e) return "";
		let t = e[this._statsProp];
		if (t.isFile()) return "file";
		if (t.isDirectory()) return "directory";
		if (t && t.isSymbolicLink()) {
			let t = e.fullPath;
			try {
				let e = await h(t), n = await p(e);
				if (n.isFile()) return "file";
				if (n.isDirectory()) {
					let n = e.length;
					if (t.startsWith(e) && t.substr(n, 1) === c) {
						let n = /* @__PURE__ */ Error(`Circular symlink detected: "${t}" points to "${e}"`);
						return n.code = ge, this._onError(n);
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
function Ce(e, t = {}) {
	let n = t.entryType || t.type;
	if (n === "both" && (n = w.FILE_DIR_TYPE), n && (t.type = n), !e) throw Error("readdirp: root argument is required. Usage: readdirp(root, options)");
	if (typeof e != "string") throw TypeError("readdirp: root argument must be a string. Usage: readdirp(root, options)");
	if (n && !E.includes(n)) throw Error(`readdirp: Invalid type passed. Use one of ${E.join(", ")}`);
	return t.root = e, new Se(t);
}
//#endregion
//#region node_modules/chokidar/handler.js
var we = "data", Te = "close", k = () => {}, A = process.platform, j = A === "win32", Ee = A === "darwin", De = A === "linux", Oe = A === "freebsd", ke = se() === "OS400", M = {
	ALL: "all",
	READY: "ready",
	ADD: "add",
	CHANGE: "change",
	ADD_DIR: "addDir",
	UNLINK: "unlink",
	UNLINK_DIR: "unlinkDir",
	RAW: "raw",
	ERROR: "error"
}, N = M, Ae = "watch", je = {
	lstat: p,
	stat: g
}, P = "listeners", F = "errHandlers", I = "rawEmitters", Me = [
	P,
	F,
	I
], Ne = new Set(/* @__PURE__ */ "3dm.3ds.3g2.3gp.7z.a.aac.adp.afdesign.afphoto.afpub.ai.aif.aiff.alz.ape.apk.appimage.ar.arj.asf.au.avi.bak.baml.bh.bin.bk.bmp.btif.bz2.bzip2.cab.caf.cgm.class.cmx.cpio.cr2.cur.dat.dcm.deb.dex.djvu.dll.dmg.dng.doc.docm.docx.dot.dotm.dra.DS_Store.dsk.dts.dtshd.dvb.dwg.dxf.ecelp4800.ecelp7470.ecelp9600.egg.eol.eot.epub.exe.f4v.fbs.fh.fla.flac.flatpak.fli.flv.fpx.fst.fvt.g3.gh.gif.graffle.gz.gzip.h261.h263.h264.icns.ico.ief.img.ipa.iso.jar.jpeg.jpg.jpgv.jpm.jxr.key.ktx.lha.lib.lvp.lz.lzh.lzma.lzo.m3u.m4a.m4v.mar.mdi.mht.mid.midi.mj2.mka.mkv.mmr.mng.mobi.mov.movie.mp3.mp4.mp4a.mpeg.mpg.mpga.mxu.nef.npx.numbers.nupkg.o.odp.ods.odt.oga.ogg.ogv.otf.ott.pages.pbm.pcx.pdb.pdf.pea.pgm.pic.png.pnm.pot.potm.potx.ppa.ppam.ppm.pps.ppsm.ppsx.ppt.pptm.pptx.psd.pya.pyc.pyo.pyv.qt.rar.ras.raw.resources.rgb.rip.rlc.rmf.rmvb.rpm.rtf.rz.s3m.s7z.scpt.sgi.shar.snap.sil.sketch.slk.smv.snk.so.stl.suo.sub.swf.tar.tbz.tbz2.tga.tgz.thmx.tif.tiff.tlz.ttc.ttf.txz.udf.uvh.uvi.uvm.uvp.uvs.uvu.viv.vob.war.wav.wax.wbmp.wdp.weba.webm.webp.whl.wim.wm.wma.wmv.wmx.woff.woff2.wrm.wvx.xbm.xif.xla.xlam.xls.xlsb.xlsm.xlsx.xlt.xltm.xltx.xm.xmind.xpi.xpm.xwd.xz.z.zip.zipx".split(".")), Pe = (e) => Ne.has(r.extname(e).slice(1).toLowerCase()), L = (e, t) => {
	e instanceof Set ? e.forEach(t) : t(e);
}, R = (e, t, n) => {
	let r = e[t];
	r instanceof Set || (e[t] = r = new Set([r])), r.add(n);
}, Fe = (e) => (t) => {
	let n = e[t];
	n instanceof Set ? n.clear() : delete e[t];
}, z = (e, t, n) => {
	let r = e[t];
	r instanceof Set ? r.delete(n) : r === n && delete e[t];
}, B = (e) => e instanceof Set ? e.size === 0 : !e, V = /* @__PURE__ */ new Map();
function H(e, t, n, i, a) {
	let o = (t, i) => {
		n(e), a(t, i, { watchedPath: e }), i && e !== i && U(r.resolve(e, i), P, r.join(e, i));
	};
	try {
		return ne(e, { persistent: t.persistent }, o);
	} catch (e) {
		i(e);
		return;
	}
}
var U = (e, t, n, r, i) => {
	let a = V.get(e);
	a && L(a[t], (e) => {
		e(n, r, i);
	});
}, Ie = (e, t, n, r) => {
	let { listener: i, errHandler: a, rawEmitter: o } = r, s = V.get(t), c;
	if (!n.persistent) return c = H(e, n, i, a, o), c ? c.close.bind(c) : void 0;
	if (s) R(s, P, i), R(s, F, a), R(s, I, o);
	else {
		if (c = H(e, n, U.bind(null, t, P), a, U.bind(null, t, I)), !c) return;
		c.on(N.ERROR, async (n) => {
			let r = U.bind(null, t, F);
			if (s && (s.watcherUnusable = !0), j && n.code === "EPERM") try {
				await (await ae(e, "r")).close(), r(n);
			} catch {}
			else r(n);
		}), s = {
			listeners: i,
			errHandlers: a,
			rawEmitters: o,
			watcher: c
		}, V.set(t, s);
	}
	return () => {
		z(s, P, i), z(s, F, a), z(s, I, o), B(s.listeners) && (s.watcher.close(), V.delete(t), Me.forEach(Fe(s)), s.watcher = void 0, Object.freeze(s));
	};
}, W = /* @__PURE__ */ new Map(), Le = (e, t, n, r) => {
	let { listener: i, rawEmitter: a } = r, o = W.get(t), s = o && o.options;
	return s && (s.persistent < n.persistent || s.interval > n.interval) && (te(t), o = void 0), o ? (R(o, P, i), R(o, I, a)) : (o = {
		listeners: i,
		rawEmitters: a,
		options: n,
		watcher: re(t, n, (n, r) => {
			L(o.rawEmitters, (e) => {
				e(N.CHANGE, t, {
					curr: n,
					prev: r
				});
			});
			let i = n.mtimeMs;
			(n.size !== r.size || i > r.mtimeMs || i === 0) && L(o.listeners, (t) => t(e, n));
		})
	}, W.set(t, o)), () => {
		z(o, P, i), z(o, I, a), B(o.listeners) && (W.delete(t), te(t), o.options = o.watcher = void 0, Object.freeze(o));
	};
}, Re = class {
	fsw;
	_boundHandleError;
	constructor(e) {
		this.fsw = e, this._boundHandleError = (t) => e._handleError(t);
	}
	_watchWithNodeFs(e, t) {
		let n = this.fsw.options, i = r.dirname(e), a = r.basename(e);
		this.fsw._getWatchedDir(i).add(a);
		let o = r.resolve(e), s = { persistent: n.persistent };
		t ||= k;
		let c;
		return n.usePolling ? (s.interval = n.interval !== n.binaryInterval && Pe(a) ? n.binaryInterval : n.interval, c = Le(e, o, s, {
			listener: t,
			rawEmitter: this.fsw._emitRaw
		})) : c = Ie(e, o, s, {
			listener: t,
			errHandler: this._boundHandleError,
			rawEmitter: this.fsw._emitRaw
		}), c;
	}
	_handleFile(e, t, n) {
		if (this.fsw.closed) return;
		let i = r.dirname(e), a = r.basename(e), o = this.fsw._getWatchedDir(i), s = t;
		if (o.has(a)) return;
		let c = async (t, n) => {
			if (this.fsw._throttle(Ae, e, 5)) {
				if (!n || n.mtimeMs === 0) try {
					let n = await g(e);
					if (this.fsw.closed) return;
					let r = n.atimeMs, i = n.mtimeMs;
					if ((!r || r <= i || i !== s.mtimeMs) && this.fsw._emit(N.CHANGE, e, n), (Ee || De || Oe) && s.ino !== n.ino) {
						this.fsw._closeFile(t), s = n;
						let r = this._watchWithNodeFs(e, c);
						r && this.fsw._addPathCloser(t, r);
					} else s = n;
				} catch {
					this.fsw._remove(i, a);
				}
				else if (o.has(a)) {
					let t = n.atimeMs, r = n.mtimeMs;
					(!t || t <= r || r !== s.mtimeMs) && this.fsw._emit(N.CHANGE, e, n), s = n;
				}
			}
		}, l = this._watchWithNodeFs(e, c);
		if (!(n && this.fsw.options.ignoreInitial) && this.fsw._isntIgnored(e)) {
			if (!this.fsw._throttle(N.ADD, e, 0)) return;
			this.fsw._emit(N.ADD, e, t);
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
				t = await h(n);
			} catch {
				return this.fsw._emitReady(), !0;
			}
			return this.fsw.closed ? void 0 : (a.has(r) ? this.fsw._symlinkPaths.get(i) !== t && (this.fsw._symlinkPaths.set(i, t), this.fsw._emit(N.CHANGE, n, e.stats)) : (a.add(r), this.fsw._symlinkPaths.set(i, t), this.fsw._emit(N.ADD, n, e.stats)), this.fsw._emitReady(), !0);
		}
		if (this.fsw._symlinkPaths.has(i)) return !0;
		this.fsw._symlinkPaths.set(i, !0);
	}
	_handleRead(e, t, n, i, a, o, s) {
		e = r.join(e, "");
		let c = i ? `${e}:${i}` : e;
		if (s = this.fsw._throttle("readdir", c, 1e3), !s) return;
		let l = this.fsw._getWatchedDir(n.path), u = /* @__PURE__ */ new Set(), d = this.fsw._readdirp(e, {
			fileFilter: (e) => n.filterPath(e),
			directoryFilter: (e) => n.filterDir(e)
		});
		if (d) return d.on(we, async (s) => {
			if (this.fsw.closed) {
				d = void 0;
				return;
			}
			let c = s.path, f = r.join(e, c);
			if (u.add(c), !(s.stats.isSymbolicLink() && await this._handleSymlink(s, e, f, c))) {
				if (this.fsw.closed) {
					d = void 0;
					return;
				}
				(c === i || !i && !l.has(c)) && (this.fsw._incrReadyCount(), f = r.join(a, r.relative(a, f)), this._addToNodeFs(f, t, n, o + 1));
			}
		}).on(N.ERROR, this._boundHandleError), new Promise((t, r) => {
			if (!d) return r();
			d.once("end", () => {
				if (this.fsw.closed) {
					d = void 0;
					return;
				}
				let r = s ? s.clear() : !1;
				t(void 0), l.getChildren().filter((t) => t !== e && !u.has(t)).forEach((t) => {
					this.fsw._remove(e, t);
				}), d = void 0, r && this._handleRead(e, !1, n, i, a, o, s);
			});
		});
	}
	async _handleDir(e, t, n, i, a, o, s) {
		let c = this.fsw._getWatchedDir(r.dirname(e)), l = c.has(r.basename(e));
		!(n && this.fsw.options.ignoreInitial) && !a && !l && this.fsw._emit(N.ADD_DIR, e, t), c.add(r.basename(e)), this.fsw._getWatchedDir(e);
		let u, d = this.fsw.options.depth;
		if ((d == null || i <= d) && !this.fsw._symlinkPaths.has(s)) {
			if (!a && (await this._handleRead(e, n, o, a, e, i, void 0), this.fsw.closed)) return;
			u = this._watchWithNodeFs(e, (t, n) => {
				n && n.mtimeMs === 0 || this._handleRead(t, !1, o, a, e, i, void 0);
			});
		}
		return u;
	}
	async _addToNodeFs(e, t, n, i, a) {
		let o = this.fsw._emitReady;
		if (this.fsw._isIgnored(e) || this.fsw.closed) return o(), !1;
		let s = this.fsw._getWatchHelpers(e);
		n && (s.filterPath = (e) => n.filterPath(e), s.filterDir = (e) => n.filterDir(e));
		try {
			let n = await je[s.statMethod](s.watchPath);
			if (this.fsw.closed) return;
			if (this.fsw._isIgnored(s.watchPath, n)) return o(), !1;
			let c = this.fsw.options.followSymlinks, l;
			if (n.isDirectory()) {
				let o = r.resolve(e), u = c ? await h(e) : e;
				if (this.fsw.closed || (l = await this._handleDir(s.watchPath, n, t, i, a, s, u), this.fsw.closed)) return;
				o !== u && u !== void 0 && this.fsw._symlinkPaths.set(o, u);
			} else if (n.isSymbolicLink()) {
				let a = c ? await h(e) : e;
				if (this.fsw.closed) return;
				let o = r.dirname(s.watchPath);
				if (this.fsw._getWatchedDir(o).add(s.watchPath), this.fsw._emit(N.ADD, s.watchPath, n), l = await this._handleDir(o, n, t, i, e, s, a), this.fsw.closed) return;
				a !== void 0 && this.fsw._symlinkPaths.set(r.resolve(e), a);
			} else l = this._handleFile(s.watchPath, n, t);
			return o(), l && this.fsw._addPathCloser(e, l), !1;
		} catch (t) {
			if (this.fsw._handleError(t)) return o(), e;
		}
	}
}, G = "/", ze = "//", K = ".", Be = "..", Ve = "string", He = /\\/g, q = /\/\//g, Ue = /\..*\.(sw[px])$|~$|\.subl.*\.tmp/, We = /^\.[/\\]/;
function J(e) {
	return Array.isArray(e) ? e : [e];
}
var Y = (e) => typeof e == "object" && !!e && !(e instanceof RegExp);
function Ge(e) {
	return typeof e == "function" ? e : typeof e == "string" ? (t) => e === t : e instanceof RegExp ? (t) => e.test(t) : typeof e == "object" && e ? (t) => {
		if (e.path === t) return !0;
		if (e.recursive) {
			let n = r.relative(e.path, t);
			return n ? !n.startsWith("..") && !r.isAbsolute(n) : !1;
		}
		return !1;
	} : () => !1;
}
function Ke(e) {
	if (typeof e != "string") throw Error("string expected");
	e = r.normalize(e), e = e.replace(/\\/g, "/");
	let t = !1;
	return e.startsWith("//") && (t = !0), e = e.replace(q, "/"), t && (e = "/" + e), e;
}
function qe(e, t, n) {
	let r = Ke(t);
	for (let t = 0; t < e.length; t++) {
		let i = e[t];
		if (i(r, n)) return !0;
	}
	return !1;
}
function Je(e, t) {
	if (e == null) throw TypeError("anymatch: specify first argument");
	let n = J(e).map((e) => Ge(e));
	return t == null ? (e, t) => qe(n, e, t) : qe(n, t);
}
var Ye = (e) => {
	let t = J(e).flat();
	if (!t.every((e) => typeof e === Ve)) throw TypeError(`Non-string provided as watch path: ${t}`);
	return t.map(Ze);
}, Xe = (e) => {
	let t = e.replace(He, G), n = !1;
	return t.startsWith(ze) && (n = !0), t = t.replace(q, G), n && (t = G + t), t;
}, Ze = (e) => Xe(r.normalize(Xe(e))), Qe = (e = "") => (t) => typeof t == "string" ? Ze(r.isAbsolute(t) ? t : r.join(e, t)) : t, $e = (e, t) => r.isAbsolute(e) ? e : r.join(t, e), et = Object.freeze(/* @__PURE__ */ new Set()), tt = class {
	path;
	_removeWatcher;
	items;
	constructor(e, t) {
		this.path = e, this._removeWatcher = t, this.items = /* @__PURE__ */ new Set();
	}
	add(e) {
		let { items: t } = this;
		t && e !== K && e !== Be && t.add(e);
	}
	async remove(e) {
		let { items: t } = this;
		if (!t || (t.delete(e), t.size > 0)) return;
		let n = this.path;
		try {
			await m(n);
		} catch {
			this._removeWatcher && this._removeWatcher(r.dirname(n), r.basename(n));
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
		this.items.clear(), this.path = "", this._removeWatcher = k, this.items = et, Object.freeze(this);
	}
}, nt = "stat", rt = "lstat", it = class {
	fsw;
	path;
	watchPath;
	fullWatchPath;
	dirParts;
	followSymlinks;
	statMethod;
	constructor(e, t, n) {
		this.fsw = n;
		let i = e;
		this.path = e = e.replace(We, ""), this.watchPath = i, this.fullWatchPath = r.resolve(i), this.dirParts = [], this.dirParts.forEach((e) => {
			e.length > 1 && e.pop();
		}), this.followSymlinks = t, this.statMethod = t ? nt : rt;
	}
	entryPath(e) {
		return r.join(this.watchPath, r.relative(this.watchPath, e.fullPath));
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
}, at = class extends ie {
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
			ignored: e.ignored ? J(e.ignored) : J([]),
			awaitWriteFinish: t === !0 ? n : typeof t == "object" ? {
				...n,
				...t
			} : !1
		};
		ke && (r.usePolling = !0), r.atomic === void 0 && (r.atomic = !r.usePolling);
		let i = process.env.CHOKIDAR_USEPOLLING;
		if (i !== void 0) {
			let e = i.toLowerCase();
			e === "false" || e === "0" ? r.usePolling = !1 : e === "true" || e === "1" ? r.usePolling = !0 : r.usePolling = !!e;
		}
		let a = process.env.CHOKIDAR_INTERVAL;
		a && (r.interval = Number.parseInt(a, 10));
		let o = 0;
		this._emitReady = () => {
			o++, o >= this._readyCount && (this._emitReady = k, this._readyEmitted = !0, process.nextTick(() => this.emit(M.READY)));
		}, this._emitRaw = (...e) => this.emit(M.RAW, ...e), this._boundRemove = this._remove.bind(this), this.options = r, this._nodeFsHandler = new Re(this), Object.freeze(r);
	}
	_addIgnoredPath(e) {
		if (Y(e)) {
			for (let t of this._ignoredPaths) if (Y(t) && t.path === e.path && t.recursive === e.recursive) return;
		}
		this._ignoredPaths.add(e);
	}
	_removeIgnoredPath(e) {
		if (this._ignoredPaths.delete(e), typeof e == "string") for (let t of this._ignoredPaths) Y(t) && t.path === e && this._ignoredPaths.delete(t);
	}
	add(e, t, n) {
		let { cwd: i } = this.options;
		this.closed = !1, this._closePromise = void 0;
		let a = Ye(e);
		return i && (a = a.map((e) => $e(e, i))), a.forEach((e) => {
			this._removeIgnoredPath(e);
		}), this._userIgnored = void 0, this._readyCount ||= 0, this._readyCount += a.length, Promise.all(a.map(async (e) => {
			let r = await this._nodeFsHandler._addToNodeFs(e, !n, void 0, 0, t);
			return r && this._emitReady(), r;
		})).then((e) => {
			this.closed || e.forEach((e) => {
				e && this.add(r.dirname(e), r.basename(t || e));
			});
		}), this;
	}
	unwatch(e) {
		if (this.closed) return this;
		let t = Ye(e), { cwd: n } = this.options;
		return t.forEach((e) => {
			!r.isAbsolute(e) && !this._closers.has(e) && (n && (e = r.join(n, e)), e = r.resolve(e)), this._closePath(e), this._addIgnoredPath(e), this._watched.has(e) && this._addIgnoredPath({
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
			let i = (this.options.cwd ? r.relative(this.options.cwd, n) : n) || K;
			e[i] = t.getChildren().sort();
		}), e;
	}
	emitWithAll(e, t) {
		this.emit(e, ...t), e !== M.ERROR && this.emit(M.ALL, e, ...t);
	}
	async _emit(e, t, n) {
		if (this.closed) return;
		let i = this.options;
		j && (t = r.normalize(t)), i.cwd && (t = r.relative(i.cwd, t));
		let a = [t];
		n != null && a.push(n);
		let o = i.awaitWriteFinish, s;
		if (o && (s = this._pendingWrites.get(t))) return s.lastChange = /* @__PURE__ */ new Date(), this;
		if (i.atomic) {
			if (e === M.UNLINK) return this._pendingUnlinks.set(t, [e, ...a]), setTimeout(() => {
				this._pendingUnlinks.forEach((e, t) => {
					this.emit(...e), this.emit(M.ALL, ...e), this._pendingUnlinks.delete(t);
				});
			}, typeof i.atomic == "number" ? i.atomic : 100), this;
			e === M.ADD && this._pendingUnlinks.has(t) && (e = M.CHANGE, this._pendingUnlinks.delete(t));
		}
		if (o && (e === M.ADD || e === M.CHANGE) && this._readyEmitted) return this._awaitWriteFinish(t, o.stabilityThreshold, e, (t, n) => {
			t ? (e = M.ERROR, a[0] = t, this.emitWithAll(e, a)) : n && (a.length > 1 ? a[1] = n : a.push(n), this.emitWithAll(e, a));
		}), this;
		if (e === M.CHANGE && !this._throttle(M.CHANGE, t, 50)) return this;
		if (i.alwaysStat && n === void 0 && (e === M.ADD || e === M.ADD_DIR || e === M.CHANGE)) {
			let e = i.cwd ? r.join(i.cwd, t) : t, n;
			try {
				n = await g(e);
			} catch {}
			if (!n || this.closed) return;
			a.push(n);
		}
		return this.emitWithAll(e, a), this;
	}
	_handleError(e) {
		let t = e && e.code;
		return e && t !== "ENOENT" && t !== "ENOTDIR" && (!this.options.ignorePermissionErrors || t !== "EPERM" && t !== "EACCES") && this.emit(M.ERROR, e), e || this.closed;
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
	_awaitWriteFinish(e, t, n, i) {
		let a = this.options.awaitWriteFinish;
		if (typeof a != "object") return;
		let o = a.pollInterval, s, c = e;
		this.options.cwd && !r.isAbsolute(e) && (c = r.join(this.options.cwd, e));
		let l = /* @__PURE__ */ new Date(), u = this._pendingWrites;
		function d(n) {
			ee(c, (r, a) => {
				if (r || !u.has(e)) {
					r && r.code !== "ENOENT" && i(r);
					return;
				}
				let c = Number(/* @__PURE__ */ new Date());
				n && a.size !== n.size && (u.get(e).lastChange = c), c - u.get(e).lastChange >= t ? (u.delete(e), i(void 0, a)) : s = setTimeout(d, o, a);
			});
		}
		u.has(e) || (u.set(e, {
			lastChange: l,
			cancelWait: () => (u.delete(e), clearTimeout(s), n)
		}), s = setTimeout(d, o));
	}
	_isIgnored(e, t) {
		if (this.options.atomic && Ue.test(e)) return !0;
		if (!this._userIgnored) {
			let { cwd: e } = this.options, t = (this.options.ignored || []).map(Qe(e)), n = [...[...this._ignoredPaths].map(Qe(e)), ...t];
			this._userIgnored = Je(n, void 0);
		}
		return this._userIgnored(e, t);
	}
	_isntIgnored(e, t) {
		return !this._isIgnored(e, t);
	}
	_getWatchHelpers(e) {
		return new it(e, this.options.followSymlinks, this);
	}
	_getWatchedDir(e) {
		let t = r.resolve(e);
		return this._watched.has(t) || this._watched.set(t, new tt(t, this._boundRemove)), this._watched.get(t);
	}
	_hasReadPermissions(e) {
		return this.options.ignorePermissionErrors ? !0 : !!(Number(e.mode) & 256);
	}
	_remove(e, t, n) {
		let i = r.join(e, t), a = r.resolve(i);
		if (n ??= this._watched.has(i) || this._watched.has(a), !this._throttle("remove", i, 100)) return;
		!n && this._watched.size === 1 && this.add(e, t, !0), this._getWatchedDir(i).getChildren().forEach((e) => this._remove(i, e));
		let o = this._getWatchedDir(e), s = o.has(t);
		o.remove(t), this._symlinkPaths.has(a) && this._symlinkPaths.delete(a);
		let c = i;
		if (this.options.cwd && (c = r.relative(this.options.cwd, i)), this.options.awaitWriteFinish && this._pendingWrites.has(c) && this._pendingWrites.get(c).cancelWait() === M.ADD) return;
		this._watched.delete(i), this._watched.delete(a);
		let l = n ? M.UNLINK_DIR : M.UNLINK;
		s && !this._isIgnored(i) && this._emit(l, i), this._closePath(i);
	}
	_closePath(e) {
		this._closeFile(e);
		let t = r.dirname(e);
		this._getWatchedDir(t).remove(r.basename(e));
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
		let n = Ce(e, {
			type: M.ALL,
			alwaysStat: !0,
			lstat: !0,
			...t,
			depth: 0
		});
		return this._streams.add(n), n.once(Te, () => {
			n = void 0;
		}), n.once("end", () => {
			n &&= (this._streams.delete(n), void 0);
		}), n;
	}
};
function ot(e, t = {}) {
	let n = new at(t);
	return n.add(e), n;
}
//#endregion
//#region electron/vault/vaultWatcher.ts
var X = null;
function st(e) {
	let t = e.trim();
	return t === "true" ? !0 : t === "false" ? !1 : t.replace(/^(['"])(.*)\1$/, "$2");
}
function ct(e) {
	let t = e.replace(/^\uFEFF/, ""), n = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/.exec(t);
	if (!n) return null;
	let r = {};
	for (let e of n[1].split(/\r?\n/)) {
		if (!e.trim()) continue;
		let t = e.indexOf(":");
		if (t === -1) continue;
		let n = e.slice(0, t).trim();
		n && (r[n] = st(e.slice(t + 1)));
	}
	return {
		frontmatter: r,
		body: n[2].replace(/^\r?\n/, "")
	};
}
function lt(e) {
	return b("SELECT uuid, description, updated_at FROM tickets WHERE uuid = ? LIMIT 1", [e])[0] ?? null;
}
function ut(e, t, n) {
	let r, i;
	try {
		if (r = f.statSync(e), !r.isFile()) return !1;
		i = f.readFileSync(e, "utf8");
	} catch (t) {
		return console.warn(`Vault watcher skipped unreadable file: ${e}`, t), !1;
	}
	let a = ct(i);
	if (!a) return console.warn(`Vault watcher skipped malformed markdown: ${e}`), !1;
	let o = t ?? a.frontmatter.uuid;
	if (typeof o != "string" || !o.trim()) return console.warn(`Vault watcher skipped markdown without uuid: ${e}`), !1;
	let s = a.body;
	if (!s.trim()) return !1;
	let c = lt(o);
	return c ? r.mtime.getTime() <= c.updated_at || c.description === s ? !1 : (b("UPDATE tickets SET description = ?, updated_at = ? WHERE uuid = ?", [
		s,
		r.mtime.getTime(),
		o
	]), n?.(o), !0) : (console.warn(`Vault watcher could not find ticket for uuid: ${o}`), !1);
}
function dt(e) {
	return i.extname(e).toLowerCase() === ".md";
}
function ft(e, t) {
	dt(e) && ut(e, void 0, t);
}
function pt(e, t) {
	return Z(), X = ot(e, {
		ignoreInitial: !0,
		awaitWriteFinish: {
			stabilityThreshold: 100,
			pollInterval: 25
		},
		ignored: (e, t) => t?.isFile() ? !dt(e) : !1
	}), X.on("add", (e) => ft(e, t)), X.on("change", (e) => ft(e, t)), X.on("error", (e) => {
		console.warn("Vault watcher error:", e);
	}), X;
}
async function Z() {
	let e = X;
	X = null, e && await e.close();
}
//#endregion
//#region electron/ipc/generalAPI.ts
var mt = /\b(tickets|ticket_history|pending_sync)\b/i;
function ht() {
	n.handle("db:query", (e, t, n = []) => {
		if (typeof t != "string") throw Error("db:query expects a SQL string.");
		if (mt.test(t)) throw Error("db:query cannot access ticket tables — use db:ticket instead.");
		return b(t, n);
	});
}
//#endregion
//#region electron/ipc/ticketAPI.ts
var gt = /\btickets\b/i, _t = /^\s*SELECT/i, vt = /^\s*DELETE/i, yt = /DELETE\s+FROM\s+tickets\s*$/i, bt = 3e4, Q = /* @__PURE__ */ new Map();
function xt(e) {
	if (typeof e != "string") throw Error("db:ticket expects a SQL string.");
	if (!gt.test(e)) throw Error("db:ticket only accepts queries on ticket tables.");
}
function St(e) {
	return b("SELECT description FROM tickets WHERE uuid = ? LIMIT 1", [e])?.[0]?.description ?? null;
}
function Ct(e) {
	Q.delete(e);
	let t = St(e);
	t !== null && y(e, t);
}
function wt(e) {
	if (!e) return;
	let t = Q.get(e);
	t && clearTimeout(t), Q.set(e, setTimeout(() => Ct(e), bt));
}
function Tt() {
	for (let [e, t] of Q) {
		clearTimeout(t);
		let n = St(e);
		n !== null && y(e, n);
	}
	Q.clear();
}
function Et() {
	n.handle("db:ticket", (e, t, n = []) => {
		xt(t), yt.test(t) ? he() : vt.test(t) && C(n[0]);
		let r = b(t, n);
		if (!_t.test(t) && !vt.test(t)) {
			let e = n[0];
			wt(e), e && me(e);
		}
		return r;
	});
}
//#endregion
//#region electron/ipc/historyAPI.ts
function Dt() {
	n.handle("db:history", (e, t) => {
		if (typeof t != "string") throw Error("db:history expects a ticket UUID string.");
		return le(t);
	}), n.handle("db:history:flush", (e, t) => {
		if (typeof t != "string") throw Error("db:history:flush expects a ticket UUID string.");
		Ct(t);
	});
}
//#endregion
//#region electron/main.ts
var Ot = i.dirname(l(import.meta.url));
process.env.APP_ROOT = i.join(Ot, "..");
var kt = process.env.VITE_DEV_SERVER_URL, At = i.join(process.env.APP_ROOT, "dist"), $ = null;
function jt(t) {
	for (let n of e.getAllWindows()) n.webContents.send("vault:ticket-updated", t);
}
function Mt() {
	$ = new e({
		width: 1200,
		height: 800,
		webPreferences: {
			preload: i.join(Ot, "preload.js"),
			sandbox: !1
		}
	}), kt ? $.loadURL(kt) : $.loadFile(i.join(At, "index.html"));
}
t.whenReady().then(() => {
	let e = t.getPath("userData");
	ce(i.join(e, "overhead.db")), ue(i.join(e, "vault")), pt(de(), jt), ht(), Et(), Dt(), Mt();
}), t.on("before-quit", () => {
	Tt(), Z();
}), t.on("window-all-closed", () => {
	process.platform !== "darwin" && t.quit(), $ = null;
}), t.on("activate", () => {
	e.getAllWindows().length === 0 && Mt();
});
//#endregion
