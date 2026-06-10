import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('db', {
  query:   (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query',  sql, params ?? []),
  ticket:  (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:ticket', sql, params ?? []),
  history:      (ticketUuid: string) => ipcRenderer.invoke('db:history', ticketUuid),
  historyFlush: (ticketUuid: string) => ipcRenderer.invoke('db:history:flush', ticketUuid),
})
