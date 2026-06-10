import { Ticket } from '../ticket'
import type { TicketStatus } from '../ticket'

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
          ),
      ),
    )
  }

  /**
   * Creates a brand-new Explore ticket. Generates `uuid`/`id` and seeds the
   * initial status to `Open`.
   *
   * @param title  Free-text title.
   */
  static async create(title: string): Promise<ExploreTicket> {
    const uuid = await Ticket.generateUuid()
    const id = await Ticket.generateId()
    const ticket = Ticket.construct(
      () => new ExploreTicket(uuid, id, title, { value: 'Open' }),
    )
    await Ticket.persist(ticket)
    return ticket
  }
}
