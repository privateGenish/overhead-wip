/**
 * Mentions across the vault boundary.
 *
 * Two risks live here. The first is the one §2.1 names outright: a description
 * edited in Obsidian never touches `runTicketSql`, so a path that forgets to
 * re-extract leaves the projection describing text that is no longer in the
 * file. The second is serialization — a mention is only worth having if it
 * survives a trip through a plain markdown file unchanged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FSWatcher } from 'chokidar'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
}))

import { initSqlite, runSql, __resetSqliteForTests } from '../db/sqlite'
import { initVault, __resetVaultForTests } from './vaultManager'
import { initVaultWatcher, stopVaultWatcher, parseMarkdown, syncMarkdownToSqlite } from './vaultWatcher'
import { registerTicketAPI } from '../ipc/ticketAPI'
import { registerNoteAPI } from '../ipc/noteAPI'

let vaultDir: string

const UPSERT_SQL = `
  INSERT INTO tickets (uuid, id, title, type, status, backlog, pinned, description, archived, created_at, updated_at)
  VALUES (?, ?, ?, 'Execute', 'Draft', 0, 0, ?, 0, 1000, 1000)
  ON CONFLICT(uuid) DO UPDATE SET
    id=excluded.id, title=excluded.title, description=excluded.description,
    updated_at=excluded.updated_at
`

/** Writes a ticket through the shared write path — the one both doors use. */
function upsert(uuid: string, id: string, description: string): void {
  handlers.get('db:ticket')!(null, UPSERT_SQL, [uuid, id, `Ticket ${id}`, description])
}

const NOTE_UPSERT_SQL = `
  INSERT INTO notes (uuid, title, body, created_at, updated_at)
  VALUES (?, 'A note', ?, 1000, 1000)
  ON CONFLICT(uuid) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at
`

/** Writes a note through its own guarded channel. */
function upsertNote(uuid: string, body: string): void {
  handlers.get('db:note')!(null, NOTE_UPSERT_SQL, [uuid, body])
}

function deleteNote(uuid: string): void {
  handlers.get('db:note')!(null, 'DELETE FROM notes WHERE uuid = ?', [uuid])
}

function mentionTargets(sourceUuid: string): string[] {
  const rows = runSql(
    'SELECT target_uuid FROM mentions WHERE source_uuid = ? ORDER BY target_uuid',
    [sourceUuid],
  ) as { target_uuid: string }[]
  return rows.map((row) => row.target_uuid)
}

function readVault(filename: string): string {
  return fs.readFileSync(path.join(vaultDir, filename), 'utf8')
}

function writeVault(filename: string, content: string, mtimeMs = 9_000): string {
  const full = path.join(vaultDir, filename)
  fs.writeFileSync(full, content, 'utf8')
  const mtime = new Date(mtimeMs)
  fs.utimesSync(full, mtime, mtime)
  return full
}

function markdownFile(uuid: string, id: string, body: string): string {
  return [
    '---',
    `uuid: ${uuid}`,
    `id: ${id}`,
    `title: Ticket ${id}`,
    'type: Execute',
    'status: Draft',
    'backlog: false',
    'pinned: false',
    '---',
    '',
    body,
  ].join('\n')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForWatcherReady(active: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
    active.once('ready', resolve)
    active.once('error', reject)
  })
}

/** Polls until the expected backlink lands. Generous, for the same reason the
 *  vault suite's poll is: chokidar's write-finish window plus a busy suite. */
async function expectMentionWritten(sourceUuid: string, targets: string[]): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (JSON.stringify(mentionTargets(sourceUuid)) === JSON.stringify(targets)) return
    await sleep(25)
  }
  expect(mentionTargets(sourceUuid)).toEqual(targets)
}

beforeEach(() => {
  __resetSqliteForTests()
  __resetVaultForTests()
  initSqlite(':memory:')
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-mentions-vault-'))
  initVault(vaultDir)
  handlers.clear()
  registerTicketAPI()
  registerNoteAPI()
})

afterEach(async () => {
  await stopVaultWatcher()
  __resetSqliteForTests()
  __resetVaultForTests()
  fs.rmSync(vaultDir, { recursive: true, force: true })
})

describe('extraction on the in-app write path', () => {
  it('records a backlink as soon as a description is saved', () => {
    upsert('t1', 'OVH-001', 'The target.')
    upsert('t2', 'OVH-002', 'Waits for @OVH-001.')

    expect(mentionTargets('t2')).toEqual(['t1'])
  })

  it('follows the text when the description is rewritten', () => {
    upsert('t1', 'OVH-001', '')
    upsert('t2', 'OVH-002', '')
    upsert('t3', 'OVH-003', 'Needs @OVH-001 and @OVH-002.')
    expect(mentionTargets('t3')).toEqual(['t1', 't2'])

    upsert('t3', 'OVH-003', 'Actually just @OVH-002.')

    expect(mentionTargets('t3')).toEqual(['t2'])
  })
})

describe('extraction on inbound vault edits (§2.1)', () => {
  it('records a backlink from a file edited outside the app', {
    timeout: 20_000,
    // Same contention as the watcher test in vault.test.ts: this is the only
    // case here that waits on the OS to deliver a filesystem notification, and
    // under a full parallel run it is sometimes simply not delivered. The
    // extraction itself is covered directly elsewhere in this file without a
    // watcher; what is unique here is that the inbound path calls it at all.
    retry: 3,
  }, async () => {
    upsert('t1', 'OVH-001', 'The target.')
    upsert('t2', 'OVH-002', 'No references yet.')
    expect(mentionTargets('t2')).toEqual([])

    const active = await initVaultWatcher(vaultDir, undefined, { usePolling: true })
    await waitForWatcherReady(active)

    // An editor that knows nothing about Overhead saves the file.
    writeVault('OVH-002.md', markdownFile('t2', 'OVH-002', 'Now blocked by @OVH-001.'))

    await expectMentionWritten('t2', ['t1'])
  })

  it('drops a backlink the external edit removed', () => {
    upsert('t1', 'OVH-001', 'The target.')
    upsert('t2', 'OVH-002', 'Blocked by @OVH-001.')
    expect(mentionTargets('t2')).toEqual(['t1'])

    // Straight through the sync function — the watcher's event is the only
    // thing being skipped, and the previous test covers that.
    const file = writeVault('OVH-002.md', markdownFile('t2', 'OVH-002', 'Never mind.'), 20_000)
    expect(syncMarkdownToSqlite(file)).toBe(true)

    expect(mentionTargets('t2')).toEqual([])
  })

  it('tolerates a mention of an id no ticket owns', () => {
    upsert('t1', 'OVH-001', 'Solo.')
    const file = writeVault('OVH-001.md', markdownFile('t1', 'OVH-001', 'See @OVH-404.'), 20_000)

    expect(syncMarkdownToSqlite(file)).toBe(true)
    expect(mentionTargets('t1')).toEqual([])
    expect(runSql('SELECT description FROM tickets WHERE uuid = ?', ['t1'])).toEqual([
      { description: 'See @OVH-404.' },
    ])
  })
})

describe('markdown round-trip', () => {
  const BODY = [
    '# Plan',
    '',
    'Blocked by @OVH-001, and relates to @OVH-003.',
    '',
    'Not a link: `@OVH-002`, and not an email either: a@OVH-001.com.',
  ].join('\n')

  it('writes a mention to the vault as plain text', () => {
    upsert('t1', 'OVH-001', '')
    upsert('t2', 'OVH-002', BODY)

    const file = readVault('OVH-002.md')
    // The literal characters, with no wrapper, link or escape around them.
    expect(file).toContain('Blocked by @OVH-001, and relates to @OVH-003.')
  })

  it('reads back byte-identical through the vault', () => {
    upsert('t1', 'OVH-001', '')
    upsert('t2', 'OVH-002', BODY)

    const parsed = parseMarkdown(readVault('OVH-002.md'))

    expect(parsed?.body).toBe(BODY)
  })

  it('survives an external save unchanged, and re-extracts the same rows', () => {
    upsert('t1', 'OVH-001', '')
    upsert('t2', 'OVH-002', BODY)
    const before = mentionTargets('t2')
    expect(before).toEqual(['t1'])

    // Round-trip the file: read what was written, save it back verbatim with a
    // newer mtime, and let the inbound path have it.
    const content = readVault('OVH-002.md')
    const file = writeVault('OVH-002.md', `${content}\n`, 20_000)
    expect(syncMarkdownToSqlite(file)).toBe(true)

    const rows = runSql('SELECT description FROM tickets WHERE uuid = ?', ['t2']) as
      { description: string }[]
    expect(rows[0].description.trimEnd()).toBe(BODY)
    expect(mentionTargets('t2')).toEqual(before)
  })
})

describe('notes as a mention source', () => {
  it('extracts from a note body on write, and drops the rows on delete', () => {
    upsert('t1', 'OVH-001', 'The target.')
    upsertNote('n1', 'Both @OVH-001 and @OVH-404 are on my mind.')

    // The note's one resolvable mention, and only that one.
    expect(mentionTargets('n1')).toEqual(['t1'])

    deleteNote('n1')

    // `source_uuid` spans two tables, so nothing cascades from this side.
    expect(runSql('SELECT * FROM mentions')).toEqual([])
  })
})

describe('deletion, end to end', () => {
  it('takes both directions of a ticket’s extracted mentions with it', () => {
    // Written in the order a person could actually write them — you cannot
    // mention a ticket before it exists, so t1 gains its reference on a later
    // save. (`rebuildAllMentions` is what covers the other order.)
    upsert('t1', 'OVH-001', 'Nothing yet.')
    upsert('t2', 'OVH-002', 'Mentions @OVH-001 back.')
    upsert('t1', 'OVH-001', 'Mentions @OVH-002.')
    upsertNote('n1', 'A note about @OVH-001.')

    expect(mentionTargets('t1')).toEqual(['t2'])
    expect(mentionTargets('t2')).toEqual(['t1'])
    expect(mentionTargets('n1')).toEqual(['t1'])

    handlers.get('db:ticket')!(null, 'DELETE FROM tickets WHERE uuid = ?', ['t1'])

    // Outbound rows have no foreign key to cascade through; inbound ones do.
    // Both have to be gone — including the note's, which is neither.
    expect(runSql('SELECT * FROM mentions')).toEqual([])
  })
})
