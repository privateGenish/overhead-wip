import { ipcMain } from 'electron'
import { runSql } from '../db/sqlite'

const TICKET_TABLE_RE = /\b(tickets|ticket_history|pending_sync)\b/i

export function registerGeneralAPI(): void {
  ipcMain.handle('db:query', (_e, sql: string, params: unknown[] = []) => {
    if (typeof sql !== 'string') throw new Error('db:query expects a SQL string.')
    if (TICKET_TABLE_RE.test(sql)) {
      throw new Error('db:query cannot access ticket tables — use db:ticket instead.')
    }
    return runSql(sql, params)
  })
}
