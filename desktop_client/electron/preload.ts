import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('db', {
  query: (request: { action: string; payload?: unknown }) =>
    ipcRenderer.invoke('db:query', request),
})
