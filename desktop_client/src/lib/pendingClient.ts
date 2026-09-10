/**
 * The pending-tickets data layer (Door 1 — renderer only).
 *
 * A pending ticket is an AI-proposed draft awaiting human approval. It is
 * explicitly NOT a Ticket — no id, no status, no backlog, no relations — so
 * it gets its own type here rather than reusing `Ticket`/`TicketData`.
 *
 * No approve/reject method exists on the bridge, on any transport — this is
 * the only place these operations can be called from, by design.
 */

export interface PendingTicket {
  uuid: string
  title: string
  type: 'Explore' | 'Feature' | 'Execute'
  description: string
  created_at: number
}

class PendingClient {
  /** FIFO — oldest proposal first, matching the tray's display order. */
  async list(): Promise<PendingTicket[]> {
    return await window.db.pending('list') as PendingTicket[]
  }

  async hasAny(): Promise<boolean> {
    return await window.db.pending('hasAny') as boolean
  }

  /** Promotes a pending ticket into a real one via the normal create path, then deletes the pending row. */
  async approve(uuid: string): Promise<unknown> {
    return await window.db.pending('approve', { uuid })
  }

  /** Deletes the pending row outright. No confirmation — nothing is at stake. */
  async reject(uuid: string): Promise<void> {
    await window.db.pending('reject', { uuid })
  }
}

export const pendingClient = new PendingClient()
