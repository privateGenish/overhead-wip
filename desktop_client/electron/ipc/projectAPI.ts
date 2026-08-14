/**
 * IPC surface for project management.
 *
 * Switching is deliberately renderer-initiated: the renderer must flush its
 * pending debounced writes *before* asking the main process to switch, because
 * main cannot drain a queue that lives in the other process.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { listProjects, type ProjectRow } from '../db/globalDb'
import {
  createProjectWithDir,
  deleteProjectAndDir,
  getActiveProject,
  switchProject,
} from '../project/projectManager'
import { renameProject } from '../db/globalDb'

/** Tells every window the active project changed, so they reload wholesale. */
export function notifyProjectChanged(project: ProjectRow | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('project:changed', project)
  }
}

export function registerProjectAPI(): void {
  ipcMain.handle('project:list', () => listProjects())

  ipcMain.handle('project:active', () => getActiveProject())

  ipcMain.handle('project:create', (_e, name: unknown, prefix: unknown) => {
    if (typeof name !== 'string' || typeof prefix !== 'string') {
      throw new Error('project:create expects (name, prefix) strings.')
    }
    return createProjectWithDir(name, prefix)
  })

  ipcMain.handle('project:rename', (_e, uuid: unknown, name: unknown) => {
    if (typeof uuid !== 'string' || typeof name !== 'string') {
      throw new Error('project:rename expects (uuid, name) strings.')
    }
    return renameProject(uuid, name)
  })

  ipcMain.handle('project:delete', async (_e, uuid: unknown) => {
    if (typeof uuid !== 'string') throw new Error('project:delete expects a uuid string.')
    await deleteProjectAndDir(uuid)
    return { uuid }
  })

  ipcMain.handle('project:switch', async (_e, uuid: unknown) => {
    if (typeof uuid !== 'string') throw new Error('project:switch expects a uuid string.')
    return switchProject(uuid)
  })
}
