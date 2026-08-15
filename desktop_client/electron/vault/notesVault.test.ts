/**
 * Notes ↔ vault mirroring.
 *
 * The load-bearing assertion is the round trip: what a note holds in SQLite is
 * what the markdown file says, character for character. The vault is the
 * interchange format, so a body that survives the trip only approximately is a
 * body an external editor will corrupt.
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

import { initSqlite, runSql, __resetSqliteForTests } from '../db/sqlite'
import {
  initVault,
  getNotesDir,
  __noteVaultIndexSize,
  __resetVaultForTests,
  NOTES_DIRNAME,
} from './vaultManager'
import { parseMarkdown } from './vaultWatcher'
import { registerNoteAPI } from '../ipc/noteAPI'
import { registerTicketAPI } from '../ipc/ticketAPI'

const UPSERT_SQL = `
  INSERT INTO notes (uuid, title, body, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(uuid) DO UPDATE SET
    title = excluded.title, body = excluded.body, updated_at = excluded.updated_at
`

let vaultDir: string

/** Writes a note through the IPC handler, exactly as `noteClient` does. */
function upsert(uuid: string, title: string, body: string): void {
  handlers.get('db:note')!(null, UPSERT_SQL, [uuid, title, body, 1000, 1000])
}

function deleteNote(uuid: string): void {
  handlers.get('db:note')!(null, 'DELETE FROM notes WHERE uuid = ?', [uuid])
}

function noteFiles(): string[] {
  return fs.readdirSync(getNotesDir()).filter((name) => name.endsWith('.md')).sort()
}

function readNote(filename: string): string {
  return fs.readFileSync(path.join(getNotesDir(), filename), 'utf8')
}

beforeEach(() => {
  __resetSqliteForTests()
  __resetVaultForTests()
  initSqlite(':memory:')
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overhead-notes-'))
  initVault(vaultDir)
  handlers.clear()
  registerNoteAPI()
  registerTicketAPI()
})

afterEach(() => {
  __resetSqliteForTests()
  __resetVaultForTests()
  fs.rmSync(vaultDir, { recursive: true, force: true })
})

describe('notes → vault', () => {
  it('mirrors into notes/, never alongside the tickets', () => {
    upsert('n1', 'Monetization', 'Some thinking.')

    expect(fs.existsSync(path.join(vaultDir, NOTES_DIRNAME))).toBe(true)
    expect(noteFiles()).toEqual(['monetization.md'])
    // Nothing landed at the vault's top level, where OVH-###.md lives.
    expect(fs.readdirSync(vaultDir).filter((name) => name.endsWith('.md'))).toEqual([])
  })

  it('round-trips a note through the vault unchanged', () => {
    const body = [
      '# Income streams',
      '',
      'Talk to a friend about this.',
      '',
      '- consulting',
      '- a product',
      '',
      'Ends here.',
    ].join('\n')

    upsert('n1', 'Monetization model', body)

    const parsed = parseMarkdown(readNote('monetization-model.md'))
    expect(parsed).not.toBeNull()
    expect(parsed?.frontmatter.uuid).toBe('n1')
    expect(parsed?.frontmatter.title).toBe('Monetization model')
    expect(parsed?.body).toBe(body)
  })

  it('rewrites the body in place on the next write', () => {
    upsert('n1', 'Idea', 'v1')
    upsert('n1', 'Idea', 'v2')

    expect(noteFiles()).toEqual(['idea.md'])
    expect(readNote('idea.md')).toContain('v2')
    expect(readNote('idea.md')).not.toContain('v1')
  })

  it('moves the file when the title changes, leaving no orphan', () => {
    upsert('n1', 'Old name', 'body')
    expect(noteFiles()).toEqual(['old-name.md'])

    upsert('n1', 'New name', 'body')
    expect(noteFiles()).toEqual(['new-name.md'])
  })

  it('keeps two same-titled notes in separate files', () => {
    upsert('n1', 'Untitled note', 'first')
    upsert('n2', 'Untitled note', 'second')

    expect(noteFiles()).toHaveLength(2)
    expect(__noteVaultIndexSize()).toBe(2)
  })

  it('deletes the file when the note is deleted', () => {
    upsert('n1', 'Doomed', 'body')
    expect(noteFiles()).toEqual(['doomed.md'])

    deleteNote('n1')
    expect(noteFiles()).toEqual([])
    expect(__noteVaultIndexSize()).toBe(0)
  })

  it('clears the mentions a deleted note made', () => {
    runSql(
      `INSERT INTO tickets (uuid, id, title, type, status, backlog, description, archived, created_at, updated_at)
       VALUES ('t1', 'OVH-001', 'Target', 'Execute', 'Draft', 0, '', 0, 1, 1)`,
    )
    upsert('n1', 'Mentions one', 'about @OVH-001')
    runSql(`INSERT INTO mentions (source_type, source_uuid, target_uuid) VALUES ('note', 'n1', 't1')`)

    deleteNote('n1')

    expect(runSql('SELECT source_uuid FROM mentions')).toEqual([])
  })

  it('finds a note written by a previous session, index rebuilt from disk', () => {
    upsert('n1', 'Persisted', 'body')

    // Simulate a restart: the in-memory index is gone, the file is not.
    __resetVaultForTests()
    initVault(vaultDir)
    expect(__noteVaultIndexSize()).toBe(1)

    upsert('n1', 'Renamed', 'body')
    expect(noteFiles()).toEqual(['renamed.md'])
  })

  it('leaves notes alone when every ticket is deleted', () => {
    upsert('n1', 'Survivor', 'body')
    handlers.get('db:ticket')!(null, 'DELETE FROM tickets', [])

    expect(noteFiles()).toEqual(['survivor.md'])
  })
})

describe('the notes channel is its own', () => {
  it('refuses a statement that does not name notes', () => {
    expect(() => handlers.get('db:note')!(null, 'SELECT * FROM tickets', []))
      .toThrow(/only accepts queries on the notes table/i)
  })

  it('does not widen the ticket channel to notes', () => {
    expect(() => handlers.get('db:ticket')!(null, 'SELECT * FROM notes', []))
      .toThrow(/only accepts queries on ticket tables/i)
  })
})
