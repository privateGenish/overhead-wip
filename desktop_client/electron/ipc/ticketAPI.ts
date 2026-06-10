import { ipcMain } from 'electron'
import { runSql, historyInsert } from '../db/sqlite'
import { vaultWrite, vaultDelete, vaultClear } from '../vault/vaultManager'

const TICKET_TABLE_RE = /\btickets\b/i
const SELECT_RE = /^\s*SELECT/i
const DELETE_RE = /^\s*DELETE/i
const DELETE_ALL_RE = /DELETE\s+FROM\s+tickets\s*$/i

/** How long a ticket must sit unchanged before its description is snapshotted. */
const HISTORY_DEBOUNCE_MS = 30_000

/** Pending description snapshots, keyed by ticket uuid. One timer per ticket. */
const debounceTimers = new Map<string, NodeJS.Timeout>()

export function validateTicketSql(sql: string): void {
  if (typeof sql !== 'string') throw new Error('db:ticket expects a SQL string.')
  if (!TICKET_TABLE_RE.test(sql)) {
    throw new Error('db:ticket only accepts queries on ticket tables.')
  }
}

/** Reads a ticket's current description straight from SQLite. */
function currentDescription(uuid: string): string | null {
  const rows = runSql('SELECT description FROM tickets WHERE uuid = ? LIMIT 1', [uuid]) as
    | { description: string }[]
    | undefined
  return rows?.[0]?.description ?? null
}

/** Snapshots a ticket's current description into history, clearing its timer. */
export function snapshotTicket(uuid: string): void {
  debounceTimers.delete(uuid)
  const description = currentDescription(uuid)
  if (description !== null) historyInsert(uuid, description)
}

/** Called after every ticket mutation — (re)arms the per-ticket debounce. */
function onTicketWritten(uuid: string | undefined): void {
  if (!uuid) return
  const existing = debounceTimers.get(uuid)
  if (existing) clearTimeout(existing)
  debounceTimers.set(uuid, setTimeout(() => snapshotTicket(uuid), HISTORY_DEBOUNCE_MS))
}

/** Fires every pending snapshot immediately — call before the app quits. */
export function flushHistory(): void {
  for (const [uuid, timer] of debounceTimers) {
    clearTimeout(timer)
    const description = currentDescription(uuid)
    if (description !== null) historyInsert(uuid, description)
  }
  debounceTimers.clear()
}

export function registerTicketAPI(): void {
  ipcMain.handle('db:ticket', (_e, sql: string, params: unknown[] = []) => {
    validateTicketSql(sql)
    if (DELETE_ALL_RE.test(sql)) {
      vaultClear()
    } else if (DELETE_RE.test(sql)) {
      vaultDelete(params[0] as string)
    }
    const result = runSql(sql, params)
    if (!SELECT_RE.test(sql) && !DELETE_RE.test(sql)) {
      const uuid = params[0] as string | undefined
      onTicketWritten(uuid)      // debounced history snapshot
      if (uuid) vaultWrite(uuid) // eager markdown mirror — reflects current state at once
    }
    return result
  })
}
