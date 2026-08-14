import { useSyncExternalStore } from 'react'
import {
  Ticket,
  ExecuteTicket,
  ExploreTicket,
  FeatureTicket,
} from '@/shared/types'
import type { TicketType } from '@/shared/types'
import { statusForType } from '@/shared/types'
import { loadTickets } from './tickets'
import { ticketClient } from './ticketClient'
import { generalClient } from './generalClient'
import { Counter } from './counter'
import { persistQueue } from './persistQueue'

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
    // Creates and deletes write eagerly; only mutations are debounced, since
    // those are what a burst of typing produces.
    Ticket.setCreateHook((ticket) => ticketClient.upsert(ticket.toJSON()))
    Ticket.setSaveHook(async (ticket) => {
      persistQueue.schedule(ticket.uuid, () => ticketClient.upsert(ticket.toJSON()))
    })
    Ticket.setDeleteHook(async (ticket) => {
      // Drop any queued write first — it would resurrect the row after DELETE.
      await persistQueue.cancel(ticket.uuid)
      await ticketClient.delete(ticket.uuid)
    })
    Ticket.setGenerateIdHook(() => Counter.next())
    window.db.onVaultTicketUpdated?.((uuid) => {
      void this.syncFromStorage(uuid)
    })

    // Last line of defence for the debounce window: quitting mid-edit must not
    // drop the pending write. These can't await, but ipcRenderer.invoke posts
    // the message synchronously, so the main process still receives it.
    const flushOnExit = () => { void persistQueue.flushAll() }
    window.addEventListener('beforeunload', flushOnExit)
    window.addEventListener('pagehide', flushOnExit)

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

  #replaceTicket(existing: Ticket, replacement: Ticket): void {
    this.#untrack(existing)
    this.#tickets = this.#tickets.map((ticket) => (
      ticket === existing ? replacement : ticket
    ))
    this.#track(replacement)
    this.#notify()
  }

  async create(type: TicketType, title: string): Promise<Ticket> {
    const ticket = await factories[type].create(title)
    this.#track(ticket)
    this.#tickets = [...this.#tickets, ticket]
    this.#notify()
    return ticket
  }

  async setTicketType(ticket: Ticket, type: TicketType): Promise<Ticket> {
    if (ticket.type === type) return ticket

    // Land any queued edit before swapping instances — once replaced, the old
    // instance is detached and a late write would persist stale fields.
    await persistQueue.flush(ticket.uuid)

    const data = {
      ...ticket.toJSON(),
      type,
      status: statusForType(type, ticket.status),
    }
    await ticketClient.upsert(data)

    const replacement = Ticket.load(data)
    this.#replaceTicket(ticket, replacement)
    return replacement
  }

  async syncFromStorage(uuid: string): Promise<void> {
    // Same reason as setTicketType: flush before the instance is replaced.
    await persistQueue.flush(uuid)

    const data = await ticketClient.get(uuid)
    const existing = this.getByUuid(uuid)

    if (!data) {
      if (!existing) return
      this.#untrack(existing)
      this.#tickets = this.#tickets.filter((ticket) => ticket !== existing)
      this.#notify()
      return
    }

    const synced = Ticket.load(data)
    if (existing) {
      this.#replaceTicket(existing, synced)
    } else {
      this.#tickets = [...this.#tickets, synced]
      this.#track(synced)
      this.#notify()
    }
  }

  async deleteAll(): Promise<void> {
    for (const ticket of this.#tickets) this.#untrack(ticket)
    for (const ticket of this.#tickets) await persistQueue.cancel(ticket.uuid)
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
