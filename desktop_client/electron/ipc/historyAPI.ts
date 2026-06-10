import { ipcMain } from 'electron'
import { historyGet } from '../db/sqlite'
import { snapshotTicket } from './ticketAPI'

export function registerHistoryAPI(): void {
  ipcMain.handle('db:history', (_e, ticketUuid: unknown) => {
    if (typeof ticketUuid !== 'string') {
      throw new Error('db:history expects a ticket UUID string.')
    }
    return historyGet(ticketUuid)
  })

  /** Immediately snapshots a ticket, bypassing the debounce. Called on edit→view. */
  ipcMain.handle('db:history:flush', (_e, ticketUuid: unknown) => {
    if (typeof ticketUuid !== 'string') {
      throw new Error('db:history:flush expects a ticket UUID string.')
    }
    snapshotTicket(ticketUuid)
  })
}
