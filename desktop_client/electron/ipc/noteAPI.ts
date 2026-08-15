import { ipcMain } from 'electron'
import { runSql } from '../db/sqlite'
import { syncMentions, clearMentionsFrom } from '../db/mentions'
import { noteVaultWrite, noteVaultDelete } from '../vault/vaultManager'

const NOTE_TABLE_RE = /\bnotes\b/i
const SELECT_RE = /^\s*SELECT/i
const DELETE_RE = /^\s*DELETE/i

/**
 * Notes get their own guarded channel rather than a widened `db:ticket`.
 *
 * `validateTicketSql` admits only statements naming the ticket tables, which is
 * the whole point of it — relaxing that regex to let notes through would open
 * the ticket channel to every other table at the same time.
 */
export function validateNoteSql(sql: string): void {
  if (typeof sql !== 'string') throw new Error('db:note expects a SQL string.')
  if (!NOTE_TABLE_RE.test(sql)) {
    throw new Error('db:note only accepts queries on the notes table.')
  }
}

/**
 * Drops the mentions a note *makes*.
 *
 * `mentions.source_uuid` spans tickets and notes, so it carries no foreign key
 * and nothing cascades from this side. Without this, deleting a note strands
 * backlinks pointing out of a document that no longer exists.
 */
function clearOutboundMentions(uuid: string | undefined): void {
  if (!uuid) return
  clearMentionsFrom('note', uuid)
}

/** Reads a note's current body straight from SQLite. */
function currentBody(uuid: string): string | null {
  const rows = runSql('SELECT body FROM notes WHERE uuid = ? LIMIT 1', [uuid]) as
    | { body: string }[]
    | undefined
  return rows?.[0]?.body ?? null
}

/**
 * Runs a notes SQL statement and keeps the markdown mirror in sync.
 *
 * Mirrors `runTicketSql`, minus history: notes are not versioned this round.
 * Every write is expected to carry the note's uuid as its first parameter —
 * that is what the vault mirror addresses.
 */
export function runNoteSql(sql: string, params: unknown[] = []): unknown {
  validateNoteSql(sql)

  const uuid = params[0] as string | undefined
  if (DELETE_RE.test(sql) && uuid) {
    noteVaultDelete(uuid)
    clearOutboundMentions(uuid)
  }

  const result = runSql(sql, params)

  if (!SELECT_RE.test(sql) && !DELETE_RE.test(sql) && uuid) {
    noteVaultWrite(uuid) // eager markdown mirror — the renderer already debounced
    syncMentions('note', uuid, currentBody(uuid) ?? '') // §2.1: notes mention too
  }
  return result
}

export function registerNoteAPI(): void {
  ipcMain.handle('db:note', (_e, sql: string, params: unknown[] = []) => runNoteSql(sql, params))
}
