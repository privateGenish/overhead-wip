import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FSWatcher } from 'chokidar'

// Capture the db:ticket handler so we can drive it exactly like the renderer,
// without a real Electron process.
const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
}))

import {
  initSqlite,
  __resetSqliteForTests,
  runSql,
  type TicketRow,
} from '../db/sqlite'
import { initVault, __resetVaultForTests } from './vaultManager'
import {
  initVaultWatcher,
  parseMarkdown,
  stopVaultWatcher,
  syncMarkdownToSqlite,
} from './vaultWatcher'
import { registerTicketAPI } from '../ipc/ticketAPI'

let vaultDir: string

/** Upserts a ticket through the IPC handler, mirroring the renderer's UPSERT_SQL. */
function upsert(fields: {
  uuid: string
  id?: string
  title?: string
  type?: string
  status?: string
  backlog?: 0 | 1
  description?: string
  archived?: 0 | 1
}): void {
  const {
    uuid,
    id = 'OVH-001',
    title = 'My Feature',
    type = 'Execute',
    status = 'Draft',
    backlog = 0,
    description = '',
    archived = 0,
  } = fields
  handlers.get('db:ticket')!(
    null,
    `INSERT INTO tickets (uuid, id, title, type, status, backlog, description, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uuid) DO UPDATE SET
       id=excluded.id, title=excluded.title, type=excluded.type,
       status=excluded.status, backlog=excluded.backlog,
       description=excluded.description, archived=excluded.archived,
       updated_at=excluded.updated_at`,
    [uuid, id, title, type, status, backlog, description, archived, 1000, 1000],
  )
}

/** Deletes a single ticket through the IPC handler. */
function deleteOne(uuid: string): void {
  handlers.get('db:ticket')!(null, 'DELETE FROM tickets WHERE uuid = ?', [uuid])
}

/** Deletes all tickets through the IPC handler. */
function deleteAll(): void {
  handlers.get('db:ticket')!(null, 'DELETE FROM tickets', [])
}

function read(filename: string): string {
  return fs.readFileSync(path.join(vaultDir, filename), 'utf8')
}

function exists(filename: string): boolean {
  return fs.existsSync(path.join(vaultDir, filename))
}

function filePath(filename: string): string {
  return path.join(vaultDir, filename)
}

function writeMarkdown(filename: string, content: string, mtimeMs = 5_000): string {
  const fullPath = filePath(filename)
  fs.writeFileSync(fullPath, content, 'utf8')
  const mtime = new Date(mtimeMs)
  fs.utimesSync(fullPath, mtime, mtime)
  return fullPath
}

function row(uuid = 't1'): TicketRow {
  const rows = runSql(
    'SELECT * FROM tickets WHERE uuid = ? LIMIT 1',
    [uuid],
  ) as TicketRow[]
  const ticket = rows[0]
  if (!ticket) throw new Error(`Missing test ticket: ${uuid}`)
  return ticket
}

function waitForWatcherReady(activeWatcher: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
    activeWatcher.once('ready', resolve)
    activeWatcher.once('error', reject)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Waits for the watcher to land a description, polling until it does.
 *
 * The deadline is deliberately generous. What is being asserted is *that* the
 * sync happens, never how quickly: chokidar sits behind a 100ms
 * `awaitWriteFinish` window, and when the rest of the suite is running in
 * parallel the filesystem event can arrive well after that. A 2s ceiling made
 * this the one intermittently-red test in the suite — and a suite that reddens
 * at random is worth less than the seconds a longer ceiling could cost, which
 * is none, because the loop returns the moment the value appears.
 */
async function expectDescriptionWritten(expected: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (row().description === expected) return
    await sleep(25)
  }
  expect(row().description).toBe(expected)
}

function markdown(fields: {
  uuid?: string
  id?: string
  title?: string
  type?: string
  status?: string
  backlog?: boolean
  body?: string
} = {}): string {
  const {
    uuid = 't1',
    id = 'OVH-001',
    title = 'My Feature',
    type = 'Execute',
    status = 'Draft',
    backlog = false,
    body = 'Updated from markdown',
  } = fields
  return [
    '---',
    `uuid: ${uuid}`,
    `id: ${id}`,
    `title: ${title}`,
    `type: ${type}`,
    `status: ${status}`,
    `backlog: ${backlog}`,
    '---',
    '',
    body,
  ].join('\n')
}

describe('SQL → markdown vault flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetSqliteForTests()
    __resetVaultForTests()
    initSqlite(':memory:')
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overhead-vault-'))
    initVault(vaultDir)
    handlers.clear()
    registerTicketAPI()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await stopVaultWatcher()
    __resetSqliteForTests()
    __resetVaultForTests()
    fs.rmSync(vaultDir, { recursive: true, force: true })
  })

  it('creates a .md file with frontmatter and body immediately on write', () => {
    upsert({ uuid: 't1', title: 'My Feature', description: 'Hello world' })

    expect(exists('OVH-001.md')).toBe(true) // eager — no flush needed
    const content = read('OVH-001.md')
    expect(content).toContain('uuid: t1')
    expect(content).toContain('id: OVH-001')
    expect(content).toContain('title: My Feature')
    expect(content).toContain('type: Execute')
    expect(content).toContain('status: Draft')
    expect(content).toContain('backlog: false')
    expect(content).toContain('Hello world')
  })

  it('writes a file even on creation with an empty description', () => {
    upsert({ uuid: 't1', title: 'Fresh Ticket', description: '' })
    expect(exists('OVH-001.md')).toBe(true)
  })

  it('updates the file body when the description changes', () => {
    upsert({ uuid: 't1', title: 'My Feature', description: 'v1' })
    expect(read('OVH-001.md')).toContain('v1')

    upsert({ uuid: 't1', title: 'My Feature', description: 'v2' })
    const content = read('OVH-001.md')
    expect(content).toContain('v2')
    expect(content).not.toContain('v1')
  })

  it('title changes do not rename the file (ID is stable)', () => {
    upsert({ uuid: 't1', title: 'Old Title', description: 'body' })
    expect(exists('OVH-001.md')).toBe(true)

    upsert({ uuid: 't1', title: 'New Title', description: 'body' })
    expect(exists('OVH-001.md')).toBe(true) // filename stays the same
    expect(read('OVH-001.md')).toContain('New Title') // but frontmatter updates
  })

  it('deletes the file when the ticket is archived', () => {
    upsert({ uuid: 't1', title: 'My Feature', description: 'body' })
    expect(exists('OVH-001.md')).toBe(true)

    upsert({ uuid: 't1', title: 'My Feature', description: 'body', archived: 1 })
    expect(exists('OVH-001.md')).toBe(false)
  })

  it('removes the file when a single ticket is deleted', () => {
    upsert({ uuid: 't1', title: 'My Feature', description: 'body' })
    expect(exists('OVH-001.md')).toBe(true)

    deleteOne('t1')
    expect(exists('OVH-001.md')).toBe(false)
  })

  it('deletes a pre-existing file on archive after a restart (rebuilds index from disk)', () => {
    upsert({ uuid: 't1', title: 'My Feature', description: 'body' })
    expect(exists('OVH-001.md')).toBe(true)

    // Simulate an app restart: in-memory map is lost, but the file remains.
    __resetVaultForTests()
    initVault(vaultDir)

    upsert({ uuid: 't1', title: 'My Feature', description: 'body', archived: 1 })
    expect(exists('OVH-001.md')).toBe(false)
  })

  it('clears the vault when all tickets are deleted', () => {
    upsert({ uuid: 't1', id: 'OVH-001', title: 'First', description: 'a' })
    upsert({ uuid: 't2', id: 'OVH-002', title: 'Second', description: 'b' })
    expect(exists('OVH-001.md')).toBe(true)
    expect(exists('OVH-002.md')).toBe(true)

    deleteAll()
    expect(exists('OVH-001.md')).toBe(false)
    expect(exists('OVH-002.md')).toBe(false)
  })
})

describe('markdown vault → SQL flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetSqliteForTests()
    __resetVaultForTests()
    initSqlite(':memory:')
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overhead-vault-'))
    initVault(vaultDir)
    handlers.clear()
    registerTicketAPI()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await stopVaultWatcher()
    __resetSqliteForTests()
    __resetVaultForTests()
    fs.rmSync(vaultDir, { recursive: true, force: true })
  })

  it('parses vault markdown frontmatter and body', () => {
    const parsed = parseMarkdown(markdown({ body: 'Body\n\ntext' }))

    expect(parsed).not.toBeNull()
    expect(parsed?.frontmatter.uuid).toBe('t1')
    expect(parsed?.frontmatter.backlog).toBe(false)
    expect(parsed?.body).toBe('Body\n\ntext')
  })

  it('syncs a manually-created markdown file into SQLite', () => {
    upsert({ uuid: 't1', title: 'My Feature', description: 'old' })
    const filename = writeMarkdown('OVH-001.md', markdown({ body: 'manual body' }))

    expect(syncMarkdownToSqlite(filename)).toBe(true)
    expect(row().description).toBe('manual body')
  })

  it('syncs later markdown body edits into SQLite', () => {
    upsert({ uuid: 't1', title: 'My Feature', description: 'v1' })
    const filename = writeMarkdown('OVH-001.md', markdown({ body: 'v2' }), 5_000)
    expect(syncMarkdownToSqlite(filename)).toBe(true)

    writeMarkdown('OVH-001.md', markdown({ body: 'v3' }), 6_000)
    expect(syncMarkdownToSqlite(filename)).toBe(true)

    expect(row().description).toBe('v3')
  })

  it('ignores title and status frontmatter changes', () => {
    upsert({
      uuid: 't1',
      title: 'Original Title',
      status: 'Draft',
      description: 'old',
    })
    const filename = writeMarkdown(
      'OVH-001.md',
      markdown({
        title: 'Changed Title',
        status: 'Done',
        body: 'new description',
      }),
    )

    expect(syncMarkdownToSqlite(filename)).toBe(true)
    const ticket = row()
    expect(ticket.title).toBe('Original Title')
    expect(ticket.status).toBe('Draft')
    expect(ticket.description).toBe('new description')
  })

  it('skips markdown when SQLite has the newer timestamp', () => {
    upsert({ uuid: 't1', title: 'My Feature', description: 'sqlite newer' })
    runSql('UPDATE tickets SET updated_at = ? WHERE uuid = ?', [10_000, 't1'])
    const filename = writeMarkdown('OVH-001.md', markdown({ body: 'older markdown' }), 5_000)

    expect(syncMarkdownToSqlite(filename)).toBe(false)
    expect(row().description).toBe('sqlite newer')
  })

  it('handles non-existent, malformed, and unknown-ticket files without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const malformed = writeMarkdown('broken.md', 'not frontmatter')
    const unknown = writeMarkdown('unknown.md', markdown({ uuid: 'missing' }))

    expect(syncMarkdownToSqlite(filePath('missing.md'))).toBe(false)
    expect(syncMarkdownToSqlite(malformed)).toBe(false)
    expect(syncMarkdownToSqlite(unknown)).toBe(false)
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })

  it('skips empty markdown descriptions', () => {
    upsert({ uuid: 't1', title: 'My Feature', description: 'keep me' })
    const filename = writeMarkdown('OVH-001.md', markdown({ body: '' }))

    expect(syncMarkdownToSqlite(filename)).toBe(false)
    expect(row().description).toBe('keep me')
  })

  it('starts and stops the watcher cleanly', async () => {
    vi.useRealTimers()
    const activeWatcher = initVaultWatcher(vaultDir)
    await waitForWatcherReady(activeWatcher)
    await expect(stopVaultWatcher()).resolves.toBeUndefined()
    await expect(stopVaultWatcher()).resolves.toBeUndefined()
  })
})

describe('vault watcher event → SQL write', () => {
  beforeEach(() => {
    vi.useRealTimers()
    __resetSqliteForTests()
    __resetVaultForTests()
    initSqlite(':memory:')
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overhead-vault-'))
    initVault(vaultDir)
    handlers.clear()
    registerTicketAPI()
  })

  afterEach(async () => {
    await stopVaultWatcher()
    __resetSqliteForTests()
    __resetVaultForTests()
    fs.rmSync(vaultDir, { recursive: true, force: true })
  })

  it('writes SQLite when a watched markdown file is saved', async () => {
    upsert({ uuid: 't1', title: 'My Feature', description: 'before save' })
    const syncedUuids: string[] = []
    const activeWatcher = initVaultWatcher(vaultDir, (uuid) => {
      syncedUuids.push(uuid)
    })
    await waitForWatcherReady(activeWatcher)

    writeMarkdown('OVH-001.md', markdown({ body: 'saved through watcher' }))

    await expectDescriptionWritten('saved through watcher')
    expect(syncedUuids).toContain('t1')
    // Timeout raised past vitest's 5s default so the generous poll deadline in
    // `expectDescriptionWritten` is what governs, rather than being cut short.
  }, 20_000)

  // Inbound sync is a ticket-only path: it resolves a frontmatter uuid against
  // the tickets table. A note landing in notes/ must be ignored outright rather
  // than run through that lookup — this file names a real ticket's uuid, so a
  // watcher that did not exclude the directory would overwrite it.
  it('ignores markdown under notes/ instead of syncing it as a ticket', async () => {
    upsert({ uuid: 't1', title: 'My Feature', description: 'untouched' })
    const activeWatcher = initVaultWatcher(vaultDir)
    await waitForWatcherReady(activeWatcher)

    const notesDir = path.join(vaultDir, 'notes')
    fs.mkdirSync(notesDir, { recursive: true })
    fs.writeFileSync(
      path.join(notesDir, 'a-note.md'),
      '---\nuuid: t1\ntitle: A note\n---\n\nNOTE BODY',
      'utf8',
    )
    await sleep(400)

    expect(row().description).toBe('untouched')
  })
})
