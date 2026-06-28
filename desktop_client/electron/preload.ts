import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('db', {
  query:   (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query',  sql, params ?? []),
  ticket:  (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:ticket', sql, params ?? []),
  history:      (ticketUuid: string) => ipcRenderer.invoke('db:history', ticketUuid),
  historyFlush: (ticketUuid: string) => ipcRenderer.invoke('db:history:flush', ticketUuid),
  relation: (op: string, payload: unknown) => ipcRenderer.invoke('db:relation', op, payload),
  graph: (op: string, payload?: unknown) => ipcRenderer.invoke('db:graph', op, payload ?? {}),
  onVaultTicketUpdated: (callback: (ticketUuid: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ticketUuid: string) => {
      callback(ticketUuid)
    }
    ipcRenderer.on('vault:ticket-updated', listener)
    return () => {
      ipcRenderer.removeListener('vault:ticket-updated', listener)
    }
  },
  onGraphUpdated: (callback: () => void) => {
    const listener = () => { callback() }
    ipcRenderer.on('graph:updated', listener)
    return () => {
      ipcRenderer.removeListener('graph:updated', listener)
    }
  },
})
