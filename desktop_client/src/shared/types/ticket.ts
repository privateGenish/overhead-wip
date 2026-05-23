/**
 * Core ticket model.
 *
 * Zod schemas are the single source of truth — the TypeScript types are
 * inferred from them, and the same schemas validate untrusted JSON. Concrete
 * ticket kinds live in `./tickets/` and extend the abstract `Ticket`.
 */

import { z } from 'zod'

// --- Schemas (source of truth) ---

export const ticketStatusSchema = z.object({
  value: z.string(),
})

export const ticketTypeSchema = z.enum(['Explore', 'Feature', 'Execute'])

/** The plain, serializable shape of a ticket — what gets persisted as JSON. */
export const ticketDataSchema = z.object({
  uuid: z.string(),
  id: z.string(),
  title: z.string(),
  type: ticketTypeSchema,
  status: ticketStatusSchema,
  backlog: z.boolean(),
  description: z.string().default(''), // markdown body
})

// --- Inferred types ---

export type TicketStatus = z.infer<typeof ticketStatusSchema>
export type TicketType = z.infer<typeof ticketTypeSchema>
export type TicketData = z.infer<typeof ticketDataSchema>

/** Rebuilds a concrete ticket from its plain JSON. */
type TicketLoader = (data: TicketData) => Ticket

/**
 * The collection a ticket belongs to (implemented by the ticket store).
 * A ticket calls these so its self-mutations propagate to the store/UI.
 */
export interface TicketHost {
  /** A ticket's field changed — refresh the collection. */
  onTicketChanged(ticket: Ticket): void
  /** A ticket asked to be removed from the collection. */
  onTicketRemoved(ticket: Ticket): void
}

/** Boolean validator — thin wrapper over `ticketDataSchema`. */
export function isTicketData(raw: unknown): raw is TicketData {
  return ticketDataSchema.safeParse(raw).success
}

/**
 * Abstract base for all tickets.
 *
 * Not constructible via `new` — the constructor throws unless reached through
 * a subclass's static `create()` (new ticket) or `Ticket.load()` (rehydrated).
 */
export abstract class Ticket {
  /** Guard: only `true` for the duration of a sanctioned `new` call. */
  static #constructing = false

  /**
   * Maps each type to its loader. Subclasses register themselves (see their
   * `static {}` blocks) so the base never imports them — that would be a
   * fatal circular import.
   */
  static #loaders = new Map<TicketType, TicketLoader>()

  /** Fixed by each concrete subclass. */
  abstract readonly type: TicketType

  /** Stable machine identity; used by relations. Never changes. */
  uuid: string
  /** Human-readable label (e.g. `OVH-009`). Not the key. */
  id: string
  title: string
  status: TicketStatus
  /** Overrides the status chronology — a ticket can be backlogged at any status. */
  backlog: boolean
  /** Markdown body. */
  description: string

  /** The collection this ticket belongs to. Set by the store via `bindHost`. */
  #host: TicketHost | null = null

  /** @throws If called via `new` outside a `create()` / `load()` factory. */
  constructor(
    uuid: string,
    id: string,
    title: string,
    status: TicketStatus,
    backlog: boolean = false,
    description: string = '',
  ) {
    if (!Ticket.#constructing) {
      throw new Error(
        'Tickets must be created via create() or Ticket.load(), not `new`.',
      )
    }
    Ticket.#constructing = false

    this.uuid = uuid
    this.id = id
    this.title = title
    this.status = status
    this.backlog = backlog
    this.description = description
  }

  // --- Construction ---

  /** Runs one `new` call inside the guard window. For use by factories. */
  protected static construct<T extends Ticket>(build: () => T): T {
    Ticket.#constructing = true
    try {
      return build()
    } finally {
      Ticket.#constructing = false
    }
  }

  /** Registers a subclass's loader. Called from each subclass's `static {}`. */
  protected static registerType(type: TicketType, loader: TicketLoader): void {
    Ticket.#loaders.set(type, loader)
  }

  /**
   * Rebuilds a ticket from a plain, untrusted object — the trust boundary.
   * Validates against `ticketDataSchema`, then dispatches on `type`. Restores
   * the existing identity; does not generate a new one.
   *
   * @throws {z.ZodError} If `raw` is not valid ticket data.
   */
  static load(raw: unknown): Ticket {
    const data = ticketDataSchema.parse(raw)
    const loader = Ticket.#loaders.get(data.type)
    if (!loader) {
      throw new Error(`No loader registered for ticket type "${data.type}".`)
    }
    return loader(data)
  }

  /** Generates a fresh uuid. Async so it can later sync with storage. */
  protected static async generateUuid(): Promise<string> {
    return crypto.randomUUID()
  }

  /**
   * Generates the next human-readable id. Async so it can later read/update
   * the id counter in the mock DB.
   *
   * @todo Read + increment the counter from the mock DB. Currently a placeholder.
   */
  protected static async generateId(): Promise<string> {
    return `TMP-${crypto.randomUUID().slice(0, 8)}`
  }

  // --- Collection link ---

  /** Wires this ticket to its store so mutations propagate. Called by the store. */
  bindHost(host: TicketHost): void {
    this.#host = host
  }

  // --- Mutations (call directly on the instance) ---

  setTitle(title: string): void {
    this.title = title
    this.#host?.onTicketChanged(this)
  }

  setStatus(status: TicketStatus): void {
    this.status = status
    this.#host?.onTicketChanged(this)
  }

  setBacklog(backlog: boolean): void {
    this.backlog = backlog
    this.#host?.onTicketChanged(this)
  }

  setDescription(description: string): void {
    this.description = description
    this.#host?.onTicketChanged(this)
  }

  /** Removes this ticket from its store. */
  delete(): void {
    this.#host?.onTicketRemoved(this)
  }
}
