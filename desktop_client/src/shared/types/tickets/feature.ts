import { Ticket } from '../ticket'
import type { TicketInit, TicketStatus } from '../ticket'

/** Status flow for Feature tickets. */
export interface FeatureStatus extends TicketStatus {
  value: 'Idea' | 'Scoped' | 'In Progress' | 'Built' | 'Canceled'
}

/** A ticket representing a user-facing product feature. */
export class FeatureTicket extends Ticket {
  readonly type = 'Feature' as const

  /** Register this type's loader with the base so `Ticket.load()` can rebuild it. */
  static {
    Ticket.registerType('Feature', (data) =>
      Ticket.construct(
        () =>
          new FeatureTicket(
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
   * Creates a brand-new Feature ticket. Generates `uuid`/`id` and seeds the
   * initial status to `Idea`.
   *
   * @param init  The state the ticket starts with — persisted in one write.
   */
  static async create(init: TicketInit): Promise<FeatureTicket> {
    const uuid = await Ticket.generateUuid()
    const id = await Ticket.generateId()
    const ticket = Ticket.construct(
      () => new FeatureTicket(
        uuid, id, init.title, { value: 'Idea' },
        init.backlog ?? false, init.description ?? '', false, init.pinned ?? false,
      ),
    )
    await Ticket.persist(ticket)
    return ticket
  }
}
