import { useSyncExternalStore } from 'react'
import {
  Ticket,
  ExecuteTicket,
  ExploreTicket,
  FeatureTicket,
} from '@/shared/types'
import type { TicketType } from '@/shared/types'
import { loadTickets } from './tickets'
import { ticketClient } from './ticketClient'
import { generalClient } from './generalClient'
import { Counter } from './counter'

const factories = {
  Execute: ExecuteTicket,
  Explore: ExploreTicket,
  Feature: FeatureTicket,
} as const

/**
 * Pure collection: tracks which tickets exist and notifies list subscribers.
 * Each ticket manages its own state — the store is just one of its subscribers,
 * listening so the list view stays fresh when a ticket mutates or deletes itself.
 */
export class TicketStore {
  #tickets: Ticket[] = []
  #active: Ticket[] = []    // stable non-archived ref for useSyncExternalStore
  #archived: Ticket[] = []  // stable archived ref for useSyncExternalStore
  #listeners = new Set<() => void>()
  #unsubscribes = new Map<Ticket, () => void>()

  constructor() {
    // Wire the ticket model's service hooks — persistence lives behind these.
    Ticket.setCreateHook((ticket) => ticketClient.upsert(ticket.toJSON()))
    Ticket.setSaveHook((ticket) => ticketClient.upsert(ticket.toJSON()))
    Ticket.setDeleteHook((ticket) => ticketClient.delete(ticket.uuid))
    Ticket.setGenerateIdHook(() => Counter.next())
    void this.#hydrate()
  }

  async #hydrate(): Promise<void> {
    const tickets = await loadTickets()
    for (const ticket of tickets) this.#track(ticket)
    this.#tickets = tickets
    this.#notify()
  }

  /** Subscribes the store to a ticket so list rows stay fresh. */
  #track(ticket: Ticket): void {
    const unsubscribe = ticket.subscribe(() => {
      if (ticket.deleted) {
        this.#untrack(ticket)
        this.#tickets = this.#tickets.filter((t) => t !== ticket)
      } else {
        this.#tickets = [...this.#tickets]
      }
      this.#notify()
    })
    this.#unsubscribes.set(ticket, unsubscribe)
  }

  #untrack(ticket: Ticket): void {
    this.#unsubscribes.get(ticket)?.()
    this.#unsubscribes.delete(ticket)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  getSnapshot = (): Ticket[] => this.#tickets

  getActiveSnapshot = (): Ticket[] => this.#active

  getArchivedSnapshot = (): Ticket[] => this.#archived

  #notify(): void {
    this.#active = this.#tickets.filter((t) => !t.archived)
    this.#archived = this.#tickets.filter((t) => t.archived)
    for (const listener of this.#listeners) listener()
  }

  getByUuid(uuid: string): Ticket | undefined {
    return this.#tickets.find((t) => t.uuid === uuid)
  }

  async create(type: TicketType, title: string): Promise<Ticket> {
    const ticket = await factories[type].create(title)
    this.#track(ticket)
    this.#tickets = [...this.#tickets, ticket]
    this.#notify()
    return ticket
  }

  async deleteAll(): Promise<void> {
    for (const ticket of this.#tickets) this.#untrack(ticket)
    await ticketClient.deleteAll()
    await generalClient.settingDelete('counter')
    this.#tickets = []
    this.#active = []
    this.#archived = []
    this.#notify()
  }
}

export const ticketStore = new TicketStore()

/** Binds React to the active (non-archived) ticket list. */
export function useTickets(): Ticket[] {
  return useSyncExternalStore(ticketStore.subscribe, ticketStore.getActiveSnapshot)
}

/** Binds React to the archived ticket list. */
export function useArchivedTickets(): Ticket[] {
  return useSyncExternalStore(ticketStore.subscribe, ticketStore.getArchivedSnapshot)
}

/** Binds React to a single ticket — re-renders only when that ticket mutates. */
export function useTicket(ticket: Ticket): number {
  return useSyncExternalStore(ticket.subscribe, ticket.getVersion)
}
