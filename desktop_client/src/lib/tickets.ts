import { Ticket } from '@/shared/types'
import { ticketClient } from './ticketClient'
import type { TicketRow } from '@/components/ticket-table/schema'

export async function loadTickets(): Promise<Ticket[]> {
  const ticketDataList = await ticketClient.all()
  return ticketDataList.map((data) => Ticket.load(data))
}

export function toRows(tickets: Ticket[]): TicketRow[] {
  return tickets.map((t) => ({
    uuid: t.uuid,
    id: t.id,
    title: t.title,
    type: t.type,
    status: t.status.value,
    backlog: t.backlog,
  }))
}
