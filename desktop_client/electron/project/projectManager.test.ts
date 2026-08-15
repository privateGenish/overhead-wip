/**
 * Risk cover for the project lifecycle.
 *
 * The failure this guards against is the worst one available in this round: a
 * half-torn-down project leaves a file watcher alive on the previous vault,
 * which then writes into the database of whichever project is opened next.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
}))

import { initGlobalDb, __resetGlobalDbForTests, listProjects, getActiveProjectUuid } from '../db/globalDb'
import { isSqliteOpen, runSql, __resetSqliteForTests } from '../db/sqlite'
import {
  __vaultIndexSize,
  __noteVaultIndexSize,
  __resetVaultForTests,
  getVaultDir,
} from '../vault/vaultManager'
import { __isVaultWatcherActive } from '../vault/vaultWatcher'
import {
  initProjectManager,
  openProject,
  closeProject,
  switchProject,
  resolveBootProject,
  createProjectWithDir,
  deleteProjectAndDir,
  ensureDefaultProject,
  getActiveProject,
  projectDir,
  projectVaultDir,
  __resetProjectManagerForTests,
} from './projectManager'

let tmp: string

/** Chokidar needs a beat to actually attach or release its handles. */
const settle = () => new Promise((r) => setTimeout(r, 150))

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-projects-'))
  initGlobalDb(path.join(tmp, 'global.db'))
  initProjectManager(tmp)
})

afterEach(async () => {
  await closeProject()
  __resetProjectManagerForTests()
  __resetVaultForTests()
  __resetSqliteForTests()
  __resetGlobalDbForTests()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('project registry', () => {
  it('rejects a duplicate name at the schema level, not just the UI', () => {
    createProjectWithDir('Overhead', 'OVH')
    expect(() => createProjectWithDir('Overhead', 'ZZZ')).toThrow(/already exists/i)
    expect(() => createProjectWithDir('OVERHEAD', 'YYY')).toThrow(/already exists/i) // case-insensitive
  })

  it('rejects a duplicate prefix — mentions must stay unambiguous', () => {
    createProjectWithDir('Overhead', 'OVH')
    expect(() => createProjectWithDir('Other', 'ovh')).toThrow(/already exists/i)
  })

  it('rolls the registry row back when the directory cannot be created', () => {
    const spy = vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied')
    })

    expect(() => createProjectWithDir('Doomed', 'DOO')).toThrow(/EACCES/)
    // A project must never exist on paper without a home on disk.
    expect(listProjects()).toHaveLength(0)

    spy.mockRestore()
  })
})

describe('open / close', () => {
  it('creates the project directory and database on first open', () => {
    const project = createProjectWithDir('Overhead', 'OVH')
    openProject(project.uuid)

    expect(fs.existsSync(path.join(projectDir(project.uuid), 'overhead.db'))).toBe(true)
    expect(fs.existsSync(projectVaultDir(project.uuid))).toBe(true)
    expect(isSqliteOpen()).toBe(true)
    expect(getActiveProject()?.uuid).toBe(project.uuid)
  })

  it('records the active project so the next boot returns to it', () => {
    const project = createProjectWithDir('Overhead', 'OVH')
    openProject(project.uuid)
    expect(getActiveProjectUuid()).toBe(project.uuid)
    expect(resolveBootProject()?.uuid).toBe(project.uuid)
  })

  it('clears the vault index on close — it is keyed by uuid and would leak', async () => {
    const project = createProjectWithDir('Overhead', 'OVH')
    openProject(project.uuid)

    runSql(
      `INSERT INTO tickets (uuid, id, title, type, status, backlog, description, archived, created_at, updated_at)
       VALUES ('u1', 'OVH-001', 'T', 'Execute', 'Draft', 0, 'body', 0, 1, 1)`,
    )
    const { vaultWrite } = await import('../vault/vaultManager')
    vaultWrite('u1')
    expect(__vaultIndexSize()).toBeGreaterThan(0)

    await closeProject()

    expect(__vaultIndexSize()).toBe(0)
    expect(isSqliteOpen()).toBe(false)
    expect(getVaultDir()).toBe('')
  })

  it('clears the notes vault index on close — the same leak, one directory down', async () => {
    const project = createProjectWithDir('Overhead', 'OVH')
    openProject(project.uuid)

    runSql(
      `INSERT INTO notes (uuid, title, body, created_at, updated_at)
       VALUES ('n1', 'A note', 'body', 1, 1)`,
    )
    const { noteVaultWrite } = await import('../vault/vaultManager')
    noteVaultWrite('n1')
    expect(__noteVaultIndexSize()).toBeGreaterThan(0)

    await closeProject()

    // Carried across, this index would delete the next project's note files.
    expect(__noteVaultIndexSize()).toBe(0)
  })

  it('is safe to close when nothing is open', async () => {
    await expect(closeProject()).resolves.toBeUndefined()
  })
})

describe('switching', () => {
  // The contract, asserted directly. Inferring it from behaviour after the
  // next open does not work: initVaultWatcher defensively stops any existing
  // watcher, so a missing stop in closeProject stays invisible end-to-end.
  it('stops the watcher when closing a project', async () => {
    const project = createProjectWithDir('Overhead', 'OVH')
    openProject(project.uuid)
    await settle()
    expect(__isVaultWatcherActive()).toBe(true)

    await closeProject()

    expect(__isVaultWatcherActive()).toBe(false)
  })

  it('holds exactly one watcher, on the newest vault, across two switches', async () => {
    const a = createProjectWithDir('One', 'ONE')
    const b = createProjectWithDir('Two', 'TWO')

    openProject(a.uuid)
    await settle()
    await switchProject(b.uuid)
    await settle()

    expect(__isVaultWatcherActive()).toBe(true)
    expect(getVaultDir()).toBe(projectVaultDir(b.uuid))
  })

  it('leaves no watcher on a previous vault after two switches', async () => {
    const a = createProjectWithDir('Alpha', 'ALP')
    const b = createProjectWithDir('Beta', 'BET')
    const c = createProjectWithDir('Gamma', 'GAM')

    openProject(a.uuid)
    await settle()
    await switchProject(b.uuid)
    await settle()
    await switchProject(c.uuid)
    await settle()

    // Only the newest project's vault is being watched.
    expect(getVaultDir()).toBe(projectVaultDir(c.uuid))

    // The real proof: writing into an earlier project's vault must not reach
    // the database that is now open. Seed a ticket in C, then drop a file into
    // A's vault claiming that uuid. A live watcher on A would sync it across.
    runSql(
      `INSERT INTO tickets (uuid, id, title, type, status, backlog, description, archived, created_at, updated_at)
       VALUES ('shared', 'GAM-001', 'In Gamma', 'Execute', 'Draft', 0, 'original', 0, 1, 1)`,
    )

    fs.writeFileSync(
      path.join(projectVaultDir(a.uuid), 'GAM-001.md'),
      `---\nuuid: shared\nid: GAM-001\ntitle: In Gamma\ntype: Execute\nstatus: Draft\nbacklog: false\n---\n\nLEAKED FROM ALPHA`,
    )
    await settle()

    const rows = runSql('SELECT description FROM tickets WHERE uuid = ?', ['shared']) as { description: string }[]
    expect(rows[0].description).toBe('original')
  })

  it('carries no rows between projects', async () => {
    const a = createProjectWithDir('Alpha', 'ALP')
    const b = createProjectWithDir('Beta', 'BET')

    openProject(a.uuid)
    runSql(
      `INSERT INTO tickets (uuid, id, title, type, status, backlog, description, archived, created_at, updated_at)
       VALUES ('only-in-a', 'ALP-001', 'Alpha ticket', 'Execute', 'Draft', 0, '', 0, 1, 1)`,
    )
    expect((runSql('SELECT uuid FROM tickets') as unknown[]).length).toBe(1)

    await switchProject(b.uuid)

    expect((runSql('SELECT uuid FROM tickets') as unknown[]).length).toBe(0)
  })
})

describe('boot resolution', () => {
  it('returns null when nothing is registered', () => {
    expect(resolveBootProject()).toBeNull()
  })

  it('falls back to the launcher when the directory has gone missing', () => {
    const project = createProjectWithDir('Overhead', 'OVH')
    openProject(project.uuid)
    // Simulate the folder being moved or deleted behind the app's back.
    fs.rmSync(projectDir(project.uuid), { recursive: true, force: true })

    expect(resolveBootProject()).toBeNull()
    expect(getActiveProjectUuid()).toBeNull() // stale pointer cleared
  })

  it('falls back to the launcher when the pointer names an unregistered project', async () => {
    const project = createProjectWithDir('Overhead', 'OVH')
    openProject(project.uuid)
    await deleteProjectAndDir(project.uuid)

    expect(resolveBootProject()).toBeNull()
  })
})

describe('bootstrap and deletion', () => {
  it('creates a default project on first run and reuses it after', () => {
    const first = ensureDefaultProject()
    expect(first.prefix).toBe('OVH') // keeps the historical id prefix
    expect(ensureDefaultProject().uuid).toBe(first.uuid)
    expect(listProjects().length).toBe(1)
  })

  it('deletes the directory along with the registry row', async () => {
    const project = createProjectWithDir('Doomed', 'DOO')
    openProject(project.uuid)

    await deleteProjectAndDir(project.uuid)

    expect(fs.existsSync(projectDir(project.uuid))).toBe(false)
    expect(listProjects()).toHaveLength(0)
    expect(isSqliteOpen()).toBe(false) // closed first, not yanked
  })
})
