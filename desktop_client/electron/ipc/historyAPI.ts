import { ipcMain } from 'electron'
import { historyGet } from '../db/sqlite'

export function registerHistoryAPI(): void {
  ipcMain.handle('db:history', (_e, ticketUuid: unknown) => {
    if (typeof ticketUuid !== 'string') {
      throw new Error('db:history expects a ticket UUID string.')
    }
    return historyGet(ticketUuid)
  })
}
