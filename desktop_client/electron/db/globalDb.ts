/**
 * The global database — the only state that lives outside a project.
 *
 * Holds the project registry plus app-wide settings (account, theme) and the
 * pointer to the active project. That pointer selects which project database
 * to open, so by definition it cannot live inside one.
 */

import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

export interface ProjectRow {
  uuid: string
  name: string
  prefix: string
  created_at: number
}

/** Where the active-project pointer is stored in `app_settings`. */
const ACTIVE_PROJECT_KEY = 'activeProject'

let gdb: DatabaseSync | null = null

export function initGlobalDb(file: string): void {
  if (gdb) return
  gdb = new DatabaseSync(file)
  gdb.exec('PRAGMA foreign_keys = ON')
  gdb.exec(`
    -- Names and prefixes are unique at the schema level, not just in the UI:
    -- duplicate names make projects ambiguous, duplicate prefixes make
    -- @OVH-123 mentions ambiguous across vaults.
    CREATE TABLE IF NOT EXISTS projects (
      uuid       TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      prefix     TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

function ready(): DatabaseSync {
  if (!gdb) throw new Error('Global database not initialised — call initGlobalDb() first.')
  return gdb
}

export function closeGlobalDb(): void {
  gdb?.close()
  gdb = null
}

export function __resetGlobalDbForTests(): void {
  closeGlobalDb()
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function listProjects(): ProjectRow[] {
  return ready()
    .prepare('SELECT uuid, name, prefix, created_at FROM projects ORDER BY created_at ASC')
    .all() as unknown as ProjectRow[]
}

export function getProject(uuid: string): ProjectRow | null {
  const row = ready()
    .prepare('SELECT uuid, name, prefix, created_at FROM projects WHERE uuid = ?')
    .get(uuid) as unknown as ProjectRow | undefined
  return row ?? null
}

/**
 * Registers a project. The prefix is immutable once set — changing it would
 * strand every existing ticket id and every markdown mention — so there is
 * deliberately no `setPrefix`.
 *
 * @throws if the name or prefix is already taken (case-insensitively).
 */
export function createProject(name: string, prefix: string): ProjectRow {
  const trimmedName = name.trim()
  const trimmedPrefix = prefix.trim().toUpperCase()
  if (!trimmedName) throw new Error('Project name cannot be empty.')
  if (!trimmedPrefix) throw new Error('Project prefix cannot be empty.')

  const row: ProjectRow = {
    uuid: randomUUID(),
    name: trimmedName,
    prefix: trimmedPrefix,
    created_at: Date.now(),
  }

  try {
    ready()
      .prepare('INSERT INTO projects (uuid, name, prefix, created_at) VALUES (?, ?, ?, ?)')
      .run(row.uuid, row.name, row.prefix, row.created_at)
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      throw new Error(`A project named "${trimmedName}" or using prefix "${trimmedPrefix}" already exists.`)
    }
    throw err
  }

  return row
}

/** @throws if the new name collides with another project. */
export function renameProject(uuid: string, name: string): ProjectRow {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Project name cannot be empty.')
  if (!getProject(uuid)) throw new Error(`Project "${uuid}" not found.`)

  try {
    ready().prepare('UPDATE projects SET name = ? WHERE uuid = ?').run(trimmed, uuid)
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      throw new Error(`A project named "${trimmed}" already exists.`)
    }
    throw err
  }

  return getProject(uuid)!
}

/** Removes the registry row only — the caller deletes the directory. */
export function deleteProject(uuid: string): void {
  ready().prepare('DELETE FROM projects WHERE uuid = ?').run(uuid)
  if (getActiveProjectUuid() === uuid) clearActiveProjectUuid()
}

// ---------------------------------------------------------------------------
// App settings
// ---------------------------------------------------------------------------

export function getAppSetting(key: string): string | null {
  const row = ready()
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setAppSetting(key: string, value: string): void {
  ready().prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

export function deleteAppSetting(key: string): void {
  ready().prepare('DELETE FROM app_settings WHERE key = ?').run(key)
}

export function getActiveProjectUuid(): string | null {
  return getAppSetting(ACTIVE_PROJECT_KEY)
}

export function setActiveProjectUuid(uuid: string): void {
  setAppSetting(ACTIVE_PROJECT_KEY, uuid)
}

export function clearActiveProjectUuid(): void {
  deleteAppSetting(ACTIVE_PROJECT_KEY)
}
