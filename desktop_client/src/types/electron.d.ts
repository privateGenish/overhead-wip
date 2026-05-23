/**
 * Shape of the `window.db` bridge exposed by the Electron preload script.
 * One channel — all SQLite operations go through `window.db.query(...)`.
 */

export interface DbBridge {
  query: (request: { action: string; payload?: unknown }) => Promise<unknown>
}

declare global {
  interface Window {
    db: DbBridge
  }
}
