/**
 * IPC surface for **global** app settings.
 *
 * Deliberately separate from `db:query`, which speaks to the *active project's*
 * database. Theme and account are properties of the person using the app, not
 * of the project they happen to have open, so they live in `global.db` and
 * survive a project switch — see §1.6.
 *
 * The renderer names a key rather than writing SQL: there is one table with two
 * columns behind this, and nothing outside `globalDb` needs to know that.
 */

import { ipcMain } from 'electron'
import { getAppSetting, setAppSetting } from '../db/globalDb'

/**
 * Keys the renderer may touch.
 *
 * `activeProject` and `window.bounds` also live in `app_settings`, and both are
 * main-process business — the renderer switching projects by writing a pointer
 * behind `projectManager`'s back is exactly the corruption this list prevents.
 */
const RENDERER_KEYS = new Set(['theme', 'account.name'])

function checkKey(key: unknown): string {
  if (typeof key !== 'string' || !RENDERER_KEYS.has(key)) {
    throw new Error(`"${String(key)}" is not a renderer-writable app setting.`)
  }
  return key
}

export function registerAppSettingsAPI(): void {
  ipcMain.handle('app-setting:get', (_e, key: unknown) => getAppSetting(checkKey(key)))

  ipcMain.handle('app-setting:set', (_e, key: unknown, value: unknown) => {
    if (typeof value !== 'string') throw new Error('app-setting:set expects a string value.')
    setAppSetting(checkKey(key), value)
  })
}
