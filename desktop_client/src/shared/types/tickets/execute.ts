import { Ticket } from '../ticket'
import type { TicketStatus } from '../ticket'

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
          ),
      ),
    )
  }

  /**
   * Creates a brand-new Execute ticket. Generates `uuid`/`id` and seeds the
   * initial status to `Draft`.
   *
   * @param title  Free-text title.
   */
  static async create(title: string): Promise<ExecuteTicket> {
    const uuid = await Ticket.generateUuid()
    const id = await Ticket.generateId()
    return Ticket.construct(
      () => new ExecuteTicket(uuid, id, title, { value: 'Draft' }),
    )
  }
}
