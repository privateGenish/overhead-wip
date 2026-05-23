import { ipcMain } from 'electron'

export function registerLocalStorageAPI(): void {
  ipcMain.handle('db:query', (_e, { action, payload }: { action: string; payload?: unknown }) => {
    switch (action) {
      case 'tickets:all':    return // TODO
      case 'tickets:get':    return // TODO
      case 'tickets:upsert': return // TODO
      case 'tickets:delete': return // TODO

      case 'relations:all':    return // TODO
      case 'relations:add':    return // TODO
      case 'relations:remove': return // TODO
      case 'relations:of':     return // TODO

      default:
        throw new Error(`Unknown db action: "${action}"`)
    }
  })
}
