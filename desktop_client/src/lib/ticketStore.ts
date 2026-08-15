import { useSyncExternalStore } from 'react'
import {
  Ticket,
  ExecuteTicket,
  ExploreTicket,
  FeatureTicket,
} from '@/shared/types'
import type { TicketInit, TicketType } from '@/shared/types'
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
  /** Teardown for the window/IPC listeners wired in the constructor. */
  #teardown: (() => void)[] = []

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
    const unsubscribeVault = window.db.onVaultTicketUpdated?.((uuid) => {
      void this.syncFromStorage(uuid)
    })
    if (unsubscribeVault) this.#teardown.push(unsubscribeVault)

    // Last line of defence for the debounce window: quitting mid-edit must not
    // drop the pending write. These can't await, but ipcRenderer.invoke posts
    // the message synchronously, so the main process still receives it.
    const flushOnExit = () => { void persistQueue.flushAll() }
    window.addEventListener('beforeunload', flushOnExit)
    window.addEventListener('pagehide', flushOnExit)
    this.#teardown.push(() => {
      window.removeEventListener('beforeunload', flushOnExit)
      window.removeEventListener('pagehide', flushOnExit)
    })

    void this.#hydrate()
  }

  /**
   * Releases everything this store holds. Called on project switch — without
   * it the previous project's IPC and window listeners stay live and keep
   * syncing into a store that is no longer displayed.
   */
  dispose(): void {
    for (const off of this.#teardown) off()
    this.#teardown = []
    for (const ticket of this.#tickets) this.#untrack(ticket)
    this.#listeners.clear()
    this.#tickets = []
    this.#active = []
    this.#archived = []
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

  /**
   * Creates a ticket from the state a form collected, and hands it back.
   *
   * The full initial state goes in, so the created row is complete on its first
   * write and the caller never has to go looking for what it just made. The
   * previous shape took only a type and a title, which left callers finding the
   * new ticket by taking the last element of the snapshot and patching the rest
   * onto it — fragile, and it silently dropped the backlog flag.
   */
  async create(init: TicketInit & { type: TicketType }): Promise<Ticket> {
    const ticket = await factories[init.type].create(init)
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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * The store is created explicitly rather than at import time, because it is
 * scoped to the *active project*: switching projects tears this down and builds
 * a new one against the new database. An import-time singleton could not be
 * rebuilt, and forced every consumer to exist in a world where a project was
 * always open.
 */
let store: TicketStore | null = null

/** Builds the store for the newly-opened project. Call before rendering. */
export function initTicketStore(): TicketStore {
  store?.dispose()
  store = new TicketStore()
  return store
}

/** Tears the store down — on project switch, before `initTicketStore` again. */
export function disposeTicketStore(): void {
  store?.dispose()
  store = null
}

/**
 * The active project's store.
 *
 * @throws if no project is open — callers rendering ticket UI must only do so
 * once a project has been entered.
 */
export function getTicketStore(): TicketStore {
  if (!store) {
    throw new Error('No ticket store — initTicketStore() must run after a project is opened.')
  }
  return store
}

/** True when a project's store is live. Lets shells render a launcher instead. */
export function hasTicketStore(): boolean {
  return store !== null
}

/** Binds React to the active (non-archived) ticket list. */
export function useTickets(): Ticket[] {
  const s = getTicketStore()
  return useSyncExternalStore(s.subscribe, s.getActiveSnapshot)
}

/** Binds React to the archived ticket list. */
export function useArchivedTickets(): Ticket[] {
  const s = getTicketStore()
  return useSyncExternalStore(s.subscribe, s.getArchivedSnapshot)
}

/** Binds React to a single ticket — re-renders only when that ticket mutates. */
export function useTicket(ticket: Ticket): number {
  return useSyncExternalStore(ticket.subscribe, ticket.getVersion)
}
