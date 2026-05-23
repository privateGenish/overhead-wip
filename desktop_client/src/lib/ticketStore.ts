/**
 * App-level store of live `Ticket` instances — the runtime source of truth.
 *
 * Observable via `subscribe` / `getSnapshot`, so components bind to it with
 * `useSyncExternalStore`. The store owns the *collection* (load, create, the
 * list); per-ticket edits are made directly on the instances, which call back
 * into the store via the `TicketHost` interface so React re-renders.
 *
 * The tickets array reference is replaced on every mutation (never mutated in
 * place) so React's snapshot comparison detects the change.
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

/** Maps each ticket type to its concrete subclass factory. */
const factories = {
  Execute: ExecuteTicket,
  Explore: ExploreTicket,
  Feature: FeatureTicket,
} as const

class TicketStore implements TicketHost {
  #tickets: Ticket[]
  #listeners = new Set<() => void>()

  constructor() {
    this.#tickets = loadTickets()
    for (const ticket of this.#tickets) ticket.bindHost(this)
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

  /** Create a new ticket of the given type and append it. */
  async create(type: TicketType, title: string): Promise<Ticket> {
    const ticket = await factories[type].create(title)
    ticket.bindHost(this)
    this.#tickets = [...this.#tickets, ticket]
    this.#notify()
    return ticket
  }

  // --- TicketHost: callbacks invoked by the ticket instances themselves ---

  /** A ticket's field changed — replace the array reference and re-render. */
  onTicketChanged(): void {
    this.#tickets = [...this.#tickets]
    this.#notify()
  }

  /** A ticket asked to be removed — drop it from the collection. */
  onTicketRemoved(ticket: Ticket): void {
    this.#tickets = this.#tickets.filter((t) => t !== ticket)
    this.#notify()
  }
}

/** The single app-wide ticket store. */
export const ticketStore = new TicketStore()

/** React hook — subscribes a component to the ticket store. */
export function useTickets(): Ticket[] {
  return useSyncExternalStore(ticketStore.subscribe, ticketStore.getSnapshot)
}
