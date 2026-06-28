/**
 * Sends `vault:ticket-updated` to all renderer windows.
 *
 * Called by the vault watcher (external file edits) and by the bridge
 * (writes from external transports) so the renderer's TicketStore always
 * stays in sync regardless of which path mutated the ticket.
 */

import { BrowserWindow } from 'electron'

export function notifyTicketUpdated(uuid: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('vault:ticket-updated', uuid)
  }
}

/** Tells all renderer windows that a graph view/node/edge was mutated externally. */
export function notifyGraphUpdated(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('graph:updated')
  }
}
