/**
 * Project lifecycle — opening, closing and switching the active project.
 *
 * Each project owns a directory holding its own database and vault:
 *
 *   <userData>/projects/<project-uuid>/overhead.db
 *   <userData>/projects/<project-uuid>/vault/
 *
 * Because a connection only ever addresses one project, isolation is
 * structural: no query can reach another project's data, so none of them need
 * to filter by project.
 *
 * The teardown order in `closeProject()` is binding. A half-torn-down project
 * leaves a file watcher writing into the database of the next one.
 */

import fs from 'node:fs'
import path from 'node:path'
import { closeSqlite, initSqlite } from '../db/sqlite'
import { rebuildAllMentions } from '../db/mentions'
import {
  getProject,
  listProjects,
  createProject,
  deleteProject,
  getActiveProjectUuid,
  setActiveProjectUuid,
  clearActiveProjectUuid,
  type ProjectRow,
} from '../db/globalDb'
import { closeVault, initVault, writeAgentGuide } from '../vault/vaultManager'
import { initVaultWatcher, stopVaultWatcher } from '../vault/vaultWatcher'
import { flushHistory } from '../ipc/ticketAPI'

/** Root under which every project directory lives. Set once at boot. */
let userDataDir = ''

/** The project currently open, or null when none is (launcher state). */
let active: ProjectRow | null = null

/** Notified after a project is opened or closed, so the renderer can reload. */
type ProjectChangeListener = (project: ProjectRow | null) => void
let onChange: ProjectChangeListener | null = null

export function initProjectManager(userData: string, listener?: ProjectChangeListener): void {
  userDataDir = userData
  onChange = listener ?? null
  fs.mkdirSync(projectsRoot(), { recursive: true })
}

export function projectsRoot(): string {
  return path.join(userDataDir, 'projects')
}

export function projectDir(uuid: string): string {
  return path.join(projectsRoot(), uuid)
}

export function projectDbPath(uuid: string): string {
  return path.join(projectDir(uuid), 'overhead.db')
}

export function projectVaultDir(uuid: string): string {
  return path.join(projectDir(uuid), 'vault')
}

export function getActiveProject(): ProjectRow | null {
  return active
}

/**
 * Opens `uuid`, creating its directory and database on first use.
 *
 * @throws if the project is not in the registry.
 */
export async function openProject(uuid: string): Promise<ProjectRow> {
  const project = getProject(uuid)
  if (!project) throw new Error(`Project "${uuid}" is not registered.`)

  const vaultDir = projectVaultDir(uuid)
  fs.mkdirSync(vaultDir, { recursive: true })

  initSqlite(projectDbPath(uuid))
  // The mentions table is a projection, so opening a project is a free chance
  // to re-derive it from the documents themselves. It repairs the one case
  // incremental extraction cannot: a mention written before its target ticket
  // existed, whose target exists now.
  rebuildAllMentions()
  initVault(vaultDir)
  writeAgentGuide(vaultDir)
  // Awaited: the watcher releases a native handle on close, and starting the
  // next one before that lands can take the new event stream down with it.
  await initVaultWatcher(vaultDir, notifyVaultTicket)

  active = project
  setActiveProjectUuid(uuid)
  onChange?.(project)
  return project
}

/**
 * Closes the active project. Order is binding:
 *
 * 1. flush pending history snapshots (renderer-side write debounce is flushed
 *    by the renderer *before* it asks to switch — see `switchProject`)
 * 2. stop the watcher, awaited — chokidar's close is async, and an unawaited
 *    close can still deliver an event into the next project's database
 * 3. close the database
 * 4. clear the vault's uuid→filename cache
 */
export async function closeProject(): Promise<void> {
  if (!active) return

  flushHistory()
  await stopVaultWatcher()
  closeSqlite()
  closeVault()

  active = null
  onChange?.(null)
}

/**
 * Switches projects. Callers in the renderer MUST flush their pending writes
 * before invoking this — the main process cannot drain the renderer's queue.
 */
export async function switchProject(uuid: string): Promise<ProjectRow> {
  await closeProject()
  return await openProject(uuid)
}

/**
 * Resolves which project to open at boot, or null for the launcher.
 *
 * Returns null when nothing is registered, when the pointer is stale, or when
 * the directory has been moved or deleted behind the app's back — a missing
 * folder must land on the launcher, never crash the boot.
 */
export function resolveBootProject(): ProjectRow | null {
  const uuid = getActiveProjectUuid()
  if (!uuid) return null

  const project = getProject(uuid)
  if (!project) {
    clearActiveProjectUuid()
    return null
  }

  if (!fs.existsSync(projectDir(uuid))) {
    console.warn(`Project directory missing for "${project.name}" — falling back to the launcher.`)
    clearActiveProjectUuid()
    return null
  }

  return project
}

/**
 * Creates a project: registry row first, then its directory. If the directory
 * cannot be created the registry row is rolled back, so a project never exists
 * on paper without a home on disk.
 */
export function createProjectWithDir(name: string, prefix: string): ProjectRow {
  const project = createProject(name, prefix)
  try {
    fs.mkdirSync(projectVaultDir(project.uuid), { recursive: true })
  } catch (err) {
    deleteProject(project.uuid)
    throw err
  }
  return project
}

/** Deletes a project and everything on disk. Closes it first if it is open. */
export async function deleteProjectAndDir(uuid: string): Promise<void> {
  if (active?.uuid === uuid) await closeProject()
  deleteProject(uuid)
  fs.rmSync(projectDir(uuid), { recursive: true, force: true })
}

/**
 * First-run bootstrap: guarantees at least one project exists so the app is
 * usable before the launcher UI lands. Adopts the historical `OVH` prefix.
 */
export function ensureDefaultProject(): ProjectRow {
  const existing = listProjects()
  if (existing[0]) return existing[0]
  return createProjectWithDir('Overhead', 'OVH')
}

export function __resetProjectManagerForTests(): void {
  active = null
  onChange = null
  userDataDir = ''
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Set by main.ts so vault edits reach the renderer. */
let vaultTicketListener: ((uuid: string) => void) | null = null

export function setVaultTicketListener(listener: (uuid: string) => void): void {
  vaultTicketListener = listener
}

function notifyVaultTicket(uuid: string): void {
  vaultTicketListener?.(uuid)
}
