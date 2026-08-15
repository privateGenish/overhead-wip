import { Ticket } from '../ticket'
import type { TicketInit, TicketStatus } from '../ticket'

/** Status flow for Explore tickets. */
export interface ExploreStatus extends TicketStatus {
  value: 'Open' | 'In Progress' | 'Concluded' | 'Not Needed'
}

/** A ticket representing research, design, or prototyping work. */
export class ExploreTicket extends Ticket {
  readonly type = 'Explore' as const

  /** Register this type's loader with the base so `Ticket.load()` can rebuild it. */
  static {
    Ticket.registerType('Explore', (data) =>
      Ticket.construct(
        () =>
          new ExploreTicket(
            data.uuid,
            data.id,
            data.title,
            data.status,
            data.backlog,
            data.description,
            data.archived,
            data.pinned,
          ),
      ),
    )
  }

  /**
   * Creates a brand-new Explore ticket. Generates `uuid`/`id` and seeds the
   * initial status to `Open`.
   *
   * @param init  The state the ticket starts with — persisted in one write.
   */
  static async create(init: TicketInit): Promise<ExploreTicket> {
    const uuid = await Ticket.generateUuid()
    const id = await Ticket.generateId()
    const ticket = Ticket.construct(
      () => new ExploreTicket(
        uuid, id, init.title, { value: 'Open' },
        init.backlog ?? false, init.description ?? '', false, init.pinned ?? false,
      ),
    )
    await Ticket.persist(ticket)
    return ticket
  }
}
