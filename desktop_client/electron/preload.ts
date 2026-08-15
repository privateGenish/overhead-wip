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

contextBridge.exposeInMainWorld('deepLink', {
  /**
   * Subscribes to `overhead://` links. Subscribing also tells the main process
   * a renderer is listening, which releases anything buffered during boot —
   * the link that launched the app arrives before this renderer exists.
   */
  onOpen: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => {
      callback(url)
    }
    ipcRenderer.on('deep-link:open', listener)
    ipcRenderer.send('deep-link:ready')
    return () => {
      ipcRenderer.removeListener('deep-link:open', listener)
    }
  },
})

contextBridge.exposeInMainWorld('projects', {
  list:   () => ipcRenderer.invoke('project:list'),
  active: () => ipcRenderer.invoke('project:active'),
  create: (name: string, prefix: string) => ipcRenderer.invoke('project:create', name, prefix),
  rename: (uuid: string, name: string) => ipcRenderer.invoke('project:rename', uuid, name),
  remove: (uuid: string) => ipcRenderer.invoke('project:delete', uuid),
  switch: (uuid: string) => ipcRenderer.invoke('project:switch', uuid),
  onChanged: (callback: (project: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, project: unknown) => {
      callback(project)
    }
    ipcRenderer.on('project:changed', listener)
    return () => {
      ipcRenderer.removeListener('project:changed', listener)
    }
  },
})
