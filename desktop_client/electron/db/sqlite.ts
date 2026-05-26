/**
 * SQLite handle for the Electron main process.
 *
 * One generic uuid-keyed JSON blob store — the schema is intentionally
 * minimal so any record shape (tickets, notes, settings, …) can live here.
 * Application code at the renderer side owns the actual shapes and validates
 * on read.
 *
 * Uses `node:sqlite` (built into Node 24, which Electron 42 ships with) —
 * no native compilation, no extra dependency.
 */

import { DatabaseSync } from 'node:sqlite'

let db: DatabaseSync | null = null
let getStmt: ReturnType<DatabaseSync['prepare']> | null = null
let allStmt: ReturnType<DatabaseSync['prepare']> | null = null
let putStmt: ReturnType<DatabaseSync['prepare']> | null = null
let delStmt: ReturnType<DatabaseSync['prepare']> | null = null

/**
 * One-time init. Caller resolves the file path (use `':memory:'` for tests).
 * Repeated calls after the first are no-ops.
 */
export function initSqlite(file: string): void {
  if (db) return
  db = new DatabaseSync(file)

  db.exec(`
    CREATE TABLE IF NOT EXISTS store (
      uuid TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `)

  getStmt = db.prepare('SELECT data FROM store WHERE uuid = ?')
  allStmt = db.prepare('SELECT data FROM store')
  putStmt = db.prepare(`
    INSERT INTO store (uuid, data) VALUES (?, ?)
    ON CONFLICT(uuid) DO UPDATE SET data = excluded.data
  `)
  delStmt = db.prepare('DELETE FROM store WHERE uuid = ?')
}

/** @throws if `initSqlite` hasn't been called yet. */
function ready(): DatabaseSync {
  if (!db) throw new Error('SQLite not initialised — call initSqlite() first.')
  return db
}

/**
 * Tears down the singleton so a subsequent `initSqlite()` opens a fresh
 * database. Intended for tests — production never calls this.
 */
export function __resetSqliteForTests(): void {
  db?.close()
  db = null
  getStmt = null
  allStmt = null
  putStmt = null
  delStmt = null
}

// --- Single-op primitives (used by the IPC handler) ---

export function dbGet(uuid: string): unknown | null {
  ready()
  const row = getStmt!.get(uuid) as { data: string } | undefined
  return row ? JSON.parse(row.data) : null
}

export function dbAll(): unknown[] {
  ready()
  const rows = allStmt!.all() as { data: string }[]
  return rows.map((r) => JSON.parse(r.data))
}

export function dbPut(record: { uuid: string } & Record<string, unknown>): void {
  ready()
  putStmt!.run(record.uuid, JSON.stringify(record))
}

export function dbDelete(uuid: string): void {
  ready()
  delStmt!.run(uuid)
}

// --- Transactions ---

/** Runs `fn` inside a SQLite transaction. Rolls back on throw. */
export function transact<T>(fn: () => T): T {
  const handle = ready()
  handle.exec('BEGIN')
  try {
    const out = fn()
    handle.exec('COMMIT')
    return out
  } catch (err) {
    handle.exec('ROLLBACK')
    throw err
  }
}
