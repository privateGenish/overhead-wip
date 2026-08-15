import { Ticket } from '../ticket'
import type { TicketInit, TicketStatus } from '../ticket'

/** Status flow for Execute tickets. */
export interface ExecuteStatus extends TicketStatus {
  value: 'Draft' | 'Ready' | 'In Progress' | 'Done' | 'Failed' | 'Rejected'
}

/** A ticket representing concrete implementation work. */
export class ExecuteTicket extends Ticket {
  readonly type = 'Execute' as const

  /** Register this type's loader with the base so `Ticket.load()` can rebuild it. */
  static {
    Ticket.registerType('Execute', (data) =>
      Ticket.construct(
        () =>
          new ExecuteTicket(
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
   * Creates a brand-new Execute ticket. Generates `uuid`/`id` and seeds the
   * initial status to `Draft`.
   *
   * @param init  The state the ticket starts with — persisted in one write.
   */
  static async create(init: TicketInit): Promise<ExecuteTicket> {
    const uuid = await Ticket.generateUuid()
    const id = await Ticket.generateId()
    const ticket = Ticket.construct(
      () => new ExecuteTicket(
        uuid, id, init.title, { value: 'Draft' },
        init.backlog ?? false, init.description ?? '', false, init.pinned ?? false,
      ),
    )
    await Ticket.persist(ticket)
    return ticket
  }
}
