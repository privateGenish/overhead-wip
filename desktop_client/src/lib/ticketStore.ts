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
import { benchClient, MAX_BENCH_TICKETS } from './benchClient'

export { MAX_BENCH_TICKETS }

/** What pinning returns when the bench is already full. */
export interface BenchFull {
  ok: false
  bench: Ticket[]
}

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
  #bench: Ticket[] = []     // stable pinned-in-slot-order ref for useSyncExternalStore
  /** ticket uuid → bench slot. Source of truth lives in `bench_slots`; this is a cache. */
  #benchOrder = new Map<string, number>()
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
    // An externally-driven pin/unpin (the bridge, an agent) changes
    // `bench_slots` without going through this store — refresh the cached
    // order alongside the ticket sync so the bench doesn't go stale.
    const unsubscribeVault = window.db.onVaultTicketUpdated?.((uuid) => {
      void this.#refreshBenchOrder().then(() => this.syncFromStorage(uuid))
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
    this.#bench = []
    this.#benchOrder = new Map()
  }

  async #hydrate(): Promise<void> {
    const tickets = await loadTickets()
    for (const ticket of tickets) this.#track(ticket)
    this.#tickets = tickets
    await this.#refreshBenchOrder()
    this.#notify()
  }

  async #refreshBenchOrder(): Promise<void> {
    const slots = await benchClient.listTicketSlots()
    this.#benchOrder = new Map(slots.map((s) => [s.uuid, s.slot]))
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

  getBenchSnapshot = (): Ticket[] => this.#bench

  #notify(): void {
    this.#active = this.#tickets.filter((t) => !t.archived)
    this.#archived = this.#tickets.filter((t) => t.archived)
    this.#bench = this.#tickets
      .filter((t) => this.#benchOrder.has(t.uuid))
      .sort((a, b) => (this.#benchOrder.get(a.uuid) ?? 0) - (this.#benchOrder.get(b.uuid) ?? 0))
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
    this.#bench = []
    this.#benchOrder = new Map()
    this.#notify()
  }

  /**
   * Pins a ticket onto the bench. When the bench is already full, this makes
   * no change and instead hands back who is currently on it — the caller
   * (a swap dialog) decides what to do with that, rather than this method
   * guessing.
   */
  async pinTicket(ticket: Ticket): Promise<{ ok: true } | BenchFull> {
    if (this.#benchOrder.has(ticket.uuid)) return { ok: true }
    const slots = await benchClient.listTicketSlots()
    if (slots.length >= MAX_BENCH_TICKETS) {
      const bench = slots
        .map((s) => this.getByUuid(s.uuid))
        .filter((t): t is Ticket => t !== undefined)
      return { ok: false, bench }
    }
    await benchClient.pinTicket(ticket.uuid, slots)
    ticket.setPinned(true)
    await this.#refreshBenchOrder()
    this.#notify()
    return { ok: true }
  }

  async unpinTicket(ticket: Ticket): Promise<void> {
    if (!this.#benchOrder.has(ticket.uuid)) return
    await benchClient.unpinTicket(ticket.uuid)
    ticket.setPinned(false)
    await this.#refreshBenchOrder()
    this.#notify()
  }

  /** Frees `outgoing`'s slot and gives it to `incoming`, in one step. */
  async swapTicket(outgoing: Ticket, incoming: Ticket): Promise<void> {
    const slots = await benchClient.listTicketSlots()
    await benchClient.swapTicket(outgoing.uuid, incoming.uuid, slots)
    outgoing.setPinned(false)
    incoming.setPinned(true)
    await this.#refreshBenchOrder()
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

/** Binds React to the bench — pinned tickets, in slot order. At most {@link MAX_BENCH_TICKETS}. */
export function useBench(): Ticket[] {
  const s = getTicketStore()
  return useSyncExternalStore(s.subscribe, s.getBenchSnapshot)
}

/** Binds React to a single ticket — re-renders only when that ticket mutates. */
export function useTicket(ticket: Ticket): number {
  return useSyncExternalStore(ticket.subscribe, ticket.getVersion)
}
