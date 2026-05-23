/**
 * Bridge between the JSON source database and the UI.
 *
 * `loadTickets()` turns raw JSON into live `Ticket` instances (the runtime
 * source of truth — methods/CRUD are invoked on these). `toRows()` projects
 * those instances into the flat shape the data table renders.
 */

import { Ticket } from '@/shared/types'
import { mockTicketData } from '@/mocks/mockTodoApp'
import type { TicketRow } from '@/components/ticket-table/schema'

/** Loads the JSON source database into live `Ticket` instances. */
export function loadTickets(): Ticket[] {
  return mockTicketData.map((data) => Ticket.load(data))
}

/** Projects live `Ticket` instances into flat rows for the data table. */
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
