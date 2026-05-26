/**
 * Bridge between the local SQLite store and the UI.
 *
 * `loadTickets()` reads every record from the store, validates each against
 * the ticket schema (via `Ticket.load()`), and returns live `Ticket`
 * instances. Non-ticket records (future: notes, settings, …) are skipped.
 *
 * On the first ever boot the store is empty, so we seed it from the mock
 * dataset and then re-read so the rest of the app works against the
 * persistent source from the start.
 */

import { Ticket, isTicketData } from '@/shared/types'
import { mockTicketData } from '@/mocks/mockTodoApp'
import { dbClientForRenderer } from '@/lib/dbClientForRenderer'
import type { TicketRow } from '@/components/ticket-table/schema'

/** Loads the persistent store into live `Ticket` instances. */
export async function loadTickets(): Promise<Ticket[]> {
  let records = await dbClientForRenderer.all()

  // First-boot seed: populate the store from the mock dataset.
  if (records.length === 0) {
    await dbClientForRenderer.batch(mockTicketData.map((t) => ({ put: t })))
    records = await dbClientForRenderer.all()
  }

  return records.filter(isTicketData).map((data) => Ticket.load(data))
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
