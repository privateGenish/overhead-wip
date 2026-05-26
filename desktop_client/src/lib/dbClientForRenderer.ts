/**
 * Renderer-side client for the local SQLite store.
 *
 * Wraps `window.db.query()` (the raw IPC bridge) with convenience methods
 * so callers don't deal with batch arrays directly. Generic — knows nothing
 * about tickets; callers validate the shapes they read.
 */

import type { DbOp } from '@/types/electron'
import type { Ticket } from '@/shared/types'

/** Any record in the store — must have a string `uuid` as its key. */
export type StoredRecord = { uuid: string } & Record<string, unknown>

export class DbClientForRenderer {
  /** Run a batch of up to 10 ops atomically. */
  batch(ops: DbOp[]): Promise<unknown[]> {
    return window.db.query(ops)
  }

  /** Fetch one record by uuid. Returns `null` if not found. */
  async get<T = StoredRecord>(uuid: string): Promise<T | null> {
    const [row] = await this.batch([{ get: uuid }])
    return (row as T | null) ?? null
  }

  /** Fetch every record in the store. */
  async all<T = StoredRecord>(): Promise<T[]> {
    const [rows] = await this.batch([{ all: null }])
    return rows as T[]
  }

  /** Insert or replace a record (generic — no schema validation). */
  async put(record: StoredRecord): Promise<void> {
    await this.batch([{ put: record }])
  }

  /**
   * Insert or replace a ticket. Calls `ticket.toJSON()` and tags the payload
   * with `resourceType: 'ticket'` so the main process validates it against
   * `ticketDataSchema` before writing to SQLite.
   */
  async putTicket(ticket: Ticket): Promise<void> {
    await this.batch([{ put: { ...ticket.toJSON(), resourceType: 'ticket' } }])
  }

  /** Remove by uuid. No-op if not found. */
  async delete(uuid: string): Promise<void> {
    await this.batch([{ delete: uuid }])
  }
}

export const dbClientForRenderer = new DbClientForRenderer()
