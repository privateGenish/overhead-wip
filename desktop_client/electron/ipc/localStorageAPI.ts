/**
 * The renderer ↔ main bridge for local persistence.
 *
 * One channel (`db:query`) accepts a batch of up to 10 operations and runs
 * them inside a single SQLite transaction. The dispatch logic lives in
 * `./batch.ts` so it can be unit-tested without the Electron runtime.
 */

import { ipcMain } from 'electron'
import { runBatch } from './batch'

/** Registers the `db:query` IPC channel. Called once from `app.whenReady`. */
export function registerLocalStorageAPI(): void {
  ipcMain.handle('db:query', (_e, ops: unknown) => runBatch(ops))
}
