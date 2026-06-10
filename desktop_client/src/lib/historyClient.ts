export interface TicketVersion {
  ts: number
  description: string
}

class HistoryClient {
  /** Fetches a ticket's description snapshots, newest first. */
  async list(uuid: string): Promise<TicketVersion[]> {
    return window.db.history(uuid)
  }
}

export const historyClient = new HistoryClient()
