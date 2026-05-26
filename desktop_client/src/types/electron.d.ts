/**
 * Shape of the `window.db` bridge exposed by the Electron preload script.
 *
 * The protocol is defined by the IPC handler in
 * `electron/ipc/localStorageAPI.ts`. One channel — all SQLite operations
 * go through `window.db.query(ops)`.
 */

/** One op in a batch — exactly one key. */
export type DbOp =
  | { get: string }
  | { all: null }
  | { put: { uuid: string } & Record<string, unknown> }
  | { delete: string }

export interface DbBridge {
  /**
   * Run a batch of up to 10 operations atomically. Response is parallel to
   * request: writes resolve to `undefined`, reads resolve to the record
   * (or `null` for missing `get`, array for `all`).
   */
  query: (ops: DbOp[]) => Promise<unknown[]>
}

declare global {
  interface Window {
    db: DbBridge
  }
}
