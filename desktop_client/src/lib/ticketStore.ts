/**
 * App-level store of live `Ticket` instances — the runtime source of truth.
 *
 * Observable via `subscribe` / `getSnapshot`, so components bind to it with
 * `useSyncExternalStore`. The store owns the *collection* (load, create, the
 * list); per-ticket edits are made directly on the instances, which call back
 * into the store via the `TicketHost` interface so React re-renders and the
 * mutation is persisted to the local SQLite store.
 *
 * Loading is async — the store starts empty and replaces its array once
 * `loadTickets()` resolves. The tickets array reference is replaced on every
 * mutation (never mutated in place) so React's snapshot comparison detects
 * the change.
 */

import { useSyncExternalStore } from 'react'
import {
  Ticket,
  ExecuteTicket,
  ExploreTicket,
  FeatureTicket,
} from '@/shared/types'
import type { TicketType, TicketHost } from '@/shared/types'
import { loadTickets } from './tickets'
import { dbClientForRenderer } from './dbClientForRenderer'
import { Counter } from './counter'

/** Maps each ticket type to its concrete subclass factory. */
const factories = {
  Execute: ExecuteTicket,
  Explore: ExploreTicket,
  Feature: FeatureTicket,
} as const

export class TicketStore implements TicketHost {
  #tickets: Ticket[] = []
  #listeners = new Set<() => void>()

  constructor() {
    // Wire persistence and ID generation into every subclass create() factory.
    Ticket.setCreateHook((ticket) => dbClientForRenderer.putTicket(ticket))
    Ticket.setGenerateIdHook(() => Counter.next())
    // Fire-and-forget hydration from SQLite. The UI renders empty until this
    // resolves, then the store notifies and components re-fetch their snapshot.
    void this.#hydrate()
  }

  async #hydrate(): Promise<void> {
    const tickets = await loadTickets()
    for (const ticket of tickets) ticket.bindHost(this)
    this.#tickets = tickets
    this.#notify()
  }

  /** Subscribe to store changes. Returns an unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Current tickets. Reference is stable until a mutation replaces it. */
  getSnapshot = (): Ticket[] => this.#tickets

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }

  /** Find one ticket by its uuid. */
  getByUuid(uuid: string): Ticket | undefined {
    return this.#tickets.find((t) => t.uuid === uuid)
  }

  /** Create a new ticket of the given type, persist it, and append it. */
  async create(type: TicketType, title: string): Promise<Ticket> {
    // factories[type].create() constructs + persists via Ticket.persist()
    const ticket = await factories[type].create(title)
    ticket.bindHost(this)
    this.#tickets = [...this.#tickets, ticket]
    this.#notify()
    return ticket
  }

  // --- TicketHost: callbacks invoked by the ticket instances themselves ---

  /** A ticket's field changed — persist and re-render. */
  onTicketChanged(ticket: Ticket): void {
    // Fire-and-forget; the in-memory state is already the source of truth for
    // the UI. A failed write surfaces in the main-process console for now.
    void dbClientForRenderer.putTicket(ticket)
    this.#tickets = [...this.#tickets]
    this.#notify()
  }

  /** A ticket asked to be removed — drop from store and DB. */
  onTicketRemoved(ticket: Ticket): void {
    void dbClientForRenderer.delete(ticket.uuid)
    this.#tickets = this.#tickets.filter((t) => t !== ticket)
    this.#notify()
  }

  /** Delete every ticket from the store and DB, and reset the counter. */
  async deleteAll(): Promise<void> {
    const uuids = this.#tickets.map((t) => t.uuid)
    for (const t of this.#tickets) t.delete()
    await Promise.all(uuids.map((uuid) => dbClientForRenderer.delete(uuid)))
    await dbClientForRenderer.delete('COUNTER')
    this.#tickets = []
    this.#notify()
  }
}

/** The single app-wide ticket store. */
export const ticketStore = new TicketStore()

/** React hook — subscribes a component to the ticket store. */
export function useTickets(): Ticket[] {
  return useSyncExternalStore(ticketStore.subscribe, ticketStore.getSnapshot)
}
