import type { TicketData } from '@/shared/types/ticket'

interface TicketRowResponse {
  uuid: string
  id: string
  title: string
  type: string
  status: string
  backlog: 0 | 1
  description: string
  created_at: number
  updated_at: number
}

function rowToTicketData(row: TicketRowResponse): TicketData {
  return {
    uuid: row.uuid,
    id: row.id,
    title: row.title,
    type: row.type as TicketData['type'],
    status: { value: row.status },
    backlog: row.backlog === 1,
    description: row.description,
  }
}

const UPSERT_SQL = `
  INSERT INTO tickets (uuid, id, title, type, status, backlog, description, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(uuid) DO UPDATE SET
    id          = excluded.id,
    title       = excluded.title,
    type        = excluded.type,
    status      = excluded.status,
    backlog     = excluded.backlog,
    description = excluded.description,
    updated_at  = excluded.updated_at
`

class TicketClient {
  async upsert(data: TicketData): Promise<void> {
    const now = Date.now()
    await window.db.ticket(UPSERT_SQL, [
      data.uuid, data.id, data.title, data.type,
      data.status.value, data.backlog ? 1 : 0,
      data.description, now, now,
    ])
  }

  async all(): Promise<TicketData[]> {
    const rows = await window.db.ticket(
      'SELECT * FROM tickets ORDER BY created_at ASC',
    ) as TicketRowResponse[]
    return rows.map(rowToTicketData)
  }

  async get(uuid: string): Promise<TicketData | null> {
    const rows = await window.db.ticket(
      'SELECT * FROM tickets WHERE uuid = ? LIMIT 1',
      [uuid],
    ) as TicketRowResponse[]
    return rows[0] ? rowToTicketData(rows[0]) : null
  }

  async delete(uuid: string): Promise<void> {
    await window.db.ticket('DELETE FROM tickets WHERE uuid = ?', [uuid])
  }

  async deleteAll(): Promise<void> {
    await window.db.ticket('DELETE FROM tickets')
  }

}

export const ticketClient = new TicketClient()
