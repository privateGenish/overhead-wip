import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'

let db: DatabaseSync | null = null

export function initSqlite(file: string): void {
  if (db) return
  db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      uuid        TEXT PRIMARY KEY,
      id          TEXT NOT NULL,
      title       TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('Explore', 'Feature', 'Execute')),
      status      TEXT NOT NULL,
      backlog     INTEGER NOT NULL DEFAULT 0,
      pinned      INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS notes (
      uuid       TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Backlinks extracted from markdown (@OVH-123). A projection of document
    -- content, never a source of truth: rebuilding it by re-parsing every
    -- ticket and note must always be safe.
    CREATE TABLE IF NOT EXISTS mentions (
      source_type TEXT NOT NULL CHECK(source_type IN ('ticket', 'note')),
      source_uuid TEXT NOT NULL,
      target_uuid TEXT NOT NULL REFERENCES tickets(uuid) ON DELETE CASCADE,
      PRIMARY KEY (source_type, source_uuid, target_uuid)
    );

    CREATE INDEX IF NOT EXISTS idx_mentions_target ON mentions(target_uuid);
  `)
}

function ready(): DatabaseSync {
  if (!db) {
    throw new Error('No project database is open — open a project first.')
  }
  return db
}

/** True when a project database is currently open. */
export function isSqliteOpen(): boolean {
  return db !== null
}

/** Closes the active project database. Safe to call when none is open. */
export function closeSqlite(): void {
  db?.close()
  db = null
}

export function __resetSqliteForTests(): void {
  closeSqlite()
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface TicketRow {
  uuid: string
  id: string
  title: string
  type: string
  status: string
  backlog: 0 | 1
  pinned: 0 | 1
  description: string
  archived: 0 | 1
  created_at: number
  updated_at: number
}

export interface NoteRow {
  uuid: string
  title: string
  body: string
  created_at: number
  updated_at: number
}

// ---------------------------------------------------------------------------
// History ops (main-process only — not exposed via IPC)
// ---------------------------------------------------------------------------

/**
 * Snapshots a ticket's description into history, but only if it differs from
 * the most recent snapshot. Dedup is by content hash, so identical descriptions
 * never produce duplicate versions.
 */
export function historyInsert(ticketUuid: string, description: string): void {
  if (!description.trim()) return

  const hash = createHash('sha256').update(description).digest('hex')

  const last = ready()
    .prepare('SELECT hash FROM ticket_history WHERE ticket_uuid = ? ORDER BY ts DESC LIMIT 1')
    .get(ticketUuid) as { hash: string } | undefined

  if (last?.hash === hash) return // unchanged since last snapshot — skip

  const ts = Math.floor(Date.now() / 1000)
  ready().prepare(
    'INSERT OR REPLACE INTO ticket_history (ticket_uuid, ts, description, hash) VALUES (?, ?, ?, ?)',
  ).run(ticketUuid, ts, description, hash)
}

export function historyGet(ticketUuid: string): { ts: number; description: string }[] {
  return ready()
    .prepare('SELECT ts, description FROM ticket_history WHERE ticket_uuid = ? ORDER BY ts DESC')
    .all(ticketUuid) as { ts: number; description: string }[]
}

// ---------------------------------------------------------------------------
// Generic SQL execution (used by IPC handlers)
// ---------------------------------------------------------------------------

export function runSql(sql: string, params: unknown[] = []): unknown {
  const stmt = ready().prepare(sql)
  if (/^\s*SELECT/i.test(sql)) return stmt.all(...(params as [])) as unknown[]
  return stmt.run(...(params as []))
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

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
