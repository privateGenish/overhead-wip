/**
 * Core ticket model.
 *
 * Zod schemas are the single source of truth for shape and validation.
 * TypeScript types are inferred from them. Concrete ticket types live in
 * `./tickets/` and extend the abstract `Ticket` class.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ticketStatusSchema = z.object({
  value: z.string(),
})

export const ticketTypeSchema = z.enum(['Explore', 'Feature', 'Execute'])

/** The plain, serializable shape of a ticket — what gets saved to storage. */
export const ticketDataSchema = z.object({
  uuid: z.string(),
  id: z.string(),
  title: z.string(),
  type: ticketTypeSchema,
  status: ticketStatusSchema,
  backlog: z.boolean(),
  description: z.string().default(''),
})

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type TicketStatus = z.infer<typeof ticketStatusSchema>
export type TicketType = z.infer<typeof ticketTypeSchema>
export type TicketData = z.infer<typeof ticketDataSchema>

/** Returns true if `raw` is a valid `TicketData` object. */
export function isTicketData(raw: unknown): raw is TicketData {
  return ticketDataSchema.safeParse(raw).success
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/** Rebuilds a concrete ticket instance from plain data. */
export type TicketLoader = (data: TicketData) => Ticket

/**
 * The store's side of the ticket ↔ store relationship.
 * A ticket calls these when it mutates so the store can re-render and save.
 */
export interface TicketHost {
  onTicketChanged(ticket: Ticket): void
  onTicketRemoved(ticket: Ticket): void
}

// ---------------------------------------------------------------------------
// Abstract base class
// ---------------------------------------------------------------------------

/**
 * Base for all ticket types (Execute, Explore, Feature).
 *
 * Can't be instantiated with `new` — use a subclass's `create()` for new
 * tickets or `Ticket.load()` to rehydrate from saved data.
 */
export abstract class Ticket {
  // --- Private statics ---

  /** Allows exactly one `new` call at a time, from within `construct()`. */
  static #constructing = false

  /**
   * Type → loader map. Each subclass registers itself in its `static {}`
   * block, avoiding a circular import back to this file.
   */
  static #loaders = new Map<TicketType, TicketLoader>()

  /**
   * Called after every `create()`. Wired by the store at startup so new
   * tickets are saved to SQLite without the model layer importing storage.
   * Not set in tests — `persist()` is a no-op there.
   */
  static #onCreated: ((ticket: Ticket) => Promise<void>) | null = null

  /**
   * Overrides `generateId()` when set. Wired by the store to `Counter.next()`.
   * Falls back to the TMP placeholder when null (e.g. in tests).
   */
  static #generateId: (() => Promise<string>) | null = null

  // --- Fields ---

  abstract readonly type: TicketType

  uuid: string        // stable machine identity, never changes
  id: string          // human-readable label e.g. OVH-009
  title: string
  status: TicketStatus
  backlog: boolean    // true = ticket is parked in the backlog
  description: string // markdown body

  #host: TicketHost | null = null

  // --- Constructor ---

  constructor(
    uuid: string,
    id: string,
    title: string,
    status: TicketStatus,
    backlog: boolean = false,
    description: string = '',
  ) {
    if (!Ticket.#constructing) {
      throw new Error('Use a subclass create() or Ticket.load() — not new.')
    }
    Ticket.#constructing = false
    this.uuid = uuid
    this.id = id
    this.title = title
    this.status = status
    this.backlog = backlog
    this.description = description
  }

  // --- Static setup (called by the store at startup) ---

  /** Registers the hook that saves a ticket to SQLite after create(). */
  static setCreateHook(hook: (ticket: Ticket) => Promise<void>): void {
    Ticket.#onCreated = hook
  }

  /** Registers the hook that generates sequential IDs (e.g. OVH-001). */
  static setGenerateIdHook(hook: () => Promise<string>): void {
    Ticket.#generateId = hook
  }

  // --- Protected helpers for subclasses ---

  /** Runs a single `new` call safely inside the construction guard. */
  protected static construct<T extends Ticket>(build: () => T): T {
    Ticket.#constructing = true
    try {
      return build()
    } finally {
      Ticket.#constructing = false
    }
  }

  /** Saves the ticket to storage via the hook set by the store. */
  protected static async persist(ticket: Ticket): Promise<void> {
    await Ticket.#onCreated?.(ticket)
  }

  /** Registers a subclass loader so `Ticket.load()` can rebuild it. */
  protected static registerType(type: TicketType, loader: TicketLoader): void {
    Ticket.#loaders.set(type, loader)
  }

  /** Returns a fresh UUID. Async so it can later come from storage. */
  protected static async generateUuid(): Promise<string> {
    return crypto.randomUUID()
  }

  /** Returns the next human-readable ID (e.g. OVH-001). Falls back to a placeholder in tests. */
  protected static async generateId(): Promise<string> {
    if (Ticket.#generateId) return Ticket.#generateId()
    return `TMP-${crypto.randomUUID().slice(0, 8)}`
  }

  // --- Public API ---

  /**
   * Rehydrates a ticket from raw (untrusted) data.
   * Validates with Zod, then dispatches to the correct subclass loader.
   *
   * @throws {z.ZodError} if the data is invalid.
   */
  static load(raw: unknown): Ticket {
    const data = ticketDataSchema.parse(raw)
    const loader = Ticket.#loaders.get(data.type)
    if (!loader) {
      throw new Error(`No loader registered for ticket type "${data.type}".`)
    }
    return loader(data)
  }

  /** Connects this ticket to the store so mutations trigger saves and re-renders. */
  bindHost(host: TicketHost): void {
    this.#host = host
  }

  // Mutations — call directly on the instance.

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

  delete(): void {
    this.#host?.onTicketRemoved(this)
    this.#host = null // make instance inert — any further mutations are no-ops
  }

  // --- Serialization ---

  /** Converts the ticket back to plain data — the inverse of `Ticket.load()`. */
  toJSON(): TicketData {
    return {
      uuid: this.uuid,
      id: this.id,
      title: this.title,
      type: this.type,
      status: this.status,
      backlog: this.backlog,
      description: this.description,
    }
  }
}
