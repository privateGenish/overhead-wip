// @vitest-environment jsdom
/**
 * Integration cover for the store's two storage-facing contracts: the debounced
 * write path, and what `create()` actually writes.
 *
 * `persistQueue.test.ts` proves the queue in isolation; this proves the store
 * is actually wired through it — that a burst of edits reaching the real save
 * hook produces one SQL write rather than one per keystroke.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `bench_slots` is the one non-ticket table the store's own methods touch
// (via benchClient) — a real in-memory table, not just a stub, so pin/unpin/
// swap tests can assert on what the store thinks the bench actually is.
const benchSlots = vi.hoisted(() => [] as { uuid: string; slot: number }[])

// `ticketStore` constructs a singleton at import time that reaches straight for
// window.db, so the stub has to exist before the module is evaluated.
const sqlLog = vi.hoisted(() => {
  const log: { sql: string; params: unknown[] }[] = []
  const db = {
    ticket: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params })
      return sql.trimStart().toUpperCase().startsWith('SELECT') ? [] : undefined
    },
    query: async (sql: string, params: unknown[] = []) => {
      const s = sql.trim()
      if (/^SELECT .* FROM bench_slots/i.test(s)) {
        return [...benchSlots].sort((a, b) => a.slot - b.slot)
      }
      if (/^INSERT INTO bench_slots/i.test(s)) {
        const [uuid, slot] = params as [string, number]
        benchSlots.push({ uuid, slot })
        return undefined
      }
      if (/^DELETE FROM bench_slots/i.test(s)) {
        const [uuid] = params as [string]
        const i = benchSlots.findIndex((r) => r.uuid === uuid)
        if (i >= 0) benchSlots.splice(i, 1)
        return undefined
      }
      return s.toUpperCase().startsWith('SELECT') ? [] : undefined
    },
    history: async () => [],
    historyFlush: async () => {},
    relation: async () => [],
    graph: async () => [],
    onVaultTicketUpdated: () => () => {},
    onGraphUpdated: () => () => {},
  }
  ;(globalThis as unknown as { window: { db: typeof db } }).window ??= { db }
  ;(globalThis as unknown as { window: { db: typeof db } }).window.db = db
  return log
})

import { TicketStore, MAX_BENCH_TICKETS } from './ticketStore'
import { persistQueue, PERSIST_DEBOUNCE_MS } from './persistQueue'
import type { Ticket } from '@/shared/types'

const stub = {
  reset: () => { sqlLog.length = 0; benchSlots.length = 0 },
  upserts: () => sqlLog.filter((c) => c.sql.includes('INSERT INTO tickets')).length,
  deletes: () => sqlLog.filter((c) => c.sql.startsWith('DELETE FROM tickets')).length,
  /** The row bound to the most recent upsert, keyed by column name. */
  lastUpsertRow: (): Record<string, unknown> => {
    const call = [...sqlLog].reverse().find((c) => c.sql.includes('INSERT INTO tickets'))
    if (!call) throw new Error('No ticket upsert was issued.')
    const columns = /INSERT INTO tickets \(([^)]+)\)/.exec(call.sql)![1]
      .split(',').map((name) => name.trim())
    return Object.fromEntries(columns.map((name, i) => [name, call.params[i]]))
  },
}

/** Lets the store's async hydrate/create chains settle. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('TicketStore.create', () => {
  beforeEach(() => {
    stub.reset()
    persistQueue.__resetForTests()
  })

  afterEach(() => {
    persistQueue.__resetForTests()
  })

  // The regression: the form collected a backlog flag and the store threw it
  // away, because create() only ever took a type and a title.
  it('persists the backlog flag the caller supplied', async () => {
    const store = new TicketStore()
    await settle()

    const ticket = await store.create({
      type: 'Explore',
      title: 'Parked idea',
      description: 'later',
      backlog: true,
    })
    await settle()

    expect(ticket.backlog).toBe(true)
    const row = stub.lastUpsertRow()
    expect(row.backlog).toBe(1)
    expect(row.description).toBe('later')
    // One write: the initial state went in whole rather than being patched on.
    expect(stub.upserts()).toBe(1)
  })

  it('returns the ticket it created — no last-element lookup needed', async () => {
    const store = new TicketStore()
    await settle()

    const first = await store.create({ type: 'Execute', title: 'First' })
    const second = await store.create({ type: 'Feature', title: 'Second' })
    await settle()

    expect(second.title).toBe('Second')
    expect(second.type).toBe('Feature')
    expect(store.getByUuid(second.uuid)).toBe(second)
    // Identity, not position: the returned ticket is the tracked instance even
    // when it is not the last thing the snapshot happens to hold.
    expect(store.getByUuid(first.uuid)).toBe(first)
    expect(first.uuid).not.toBe(second.uuid)
  })

  it('defaults the optional state rather than leaving it undefined', async () => {
    const store = new TicketStore()
    await settle()

    const ticket = await store.create({ type: 'Execute', title: 'Bare' })
    await settle()

    expect(ticket.backlog).toBe(false)
    expect(ticket.pinned).toBe(false)
    expect(ticket.description).toBe('')
  })
})

describe('TicketStore persistence wiring', () => {
  beforeEach(() => {
    stub.reset()
    persistQueue.__resetForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    persistQueue.__resetForTests()
  })

  async function makeStore(): Promise<{ store: TicketStore; ticket: Ticket }> {
    const store = new TicketStore()
    await settle()
    const ticket = await store.create({ type: 'Execute', title: 'Test ticket' })
    await settle()
    return { store, ticket }
  }

  it('writes once for a burst of description edits, not once per keystroke', async () => {
    const { ticket } = await makeStore()

    const beforeTyping = stub.upserts() // the eager create write
    vi.useFakeTimers()

    const text = 'Typing a fairly long description one character at a time'
    for (let i = 1; i <= text.length; i++) ticket.setDescription(text.slice(0, i))

    // Still nothing written — the model updated in memory only.
    expect(stub.upserts()).toBe(beforeTyping)
    expect(ticket.description).toBe(text) // ...but the model is already current

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS)

    expect(stub.upserts()).toBe(beforeTyping + 1)
  })

  it('flush lands the pending edit before a caller continues', async () => {
    const { ticket } = await makeStore()
    const beforeTyping = stub.upserts()

    ticket.setDescription('unsaved edit')
    expect(stub.upserts()).toBe(beforeTyping)

    await persistQueue.flush(ticket.uuid)

    expect(stub.upserts()).toBe(beforeTyping + 1)
  })

  it('does not resurrect a deleted ticket with a queued write', async () => {
    const { ticket } = await makeStore()

    ticket.setDescription('edit that must never land')
    ticket.delete()
    await settle()

    const upsertsAfterDelete = stub.upserts()
    await persistQueue.flushAll()

    expect(stub.deletes()).toBe(1)
    expect(stub.upserts()).toBe(upsertsAfterDelete) // no write after the DELETE
  })
})

describe('TicketStore — the bench', () => {
  beforeEach(() => {
    stub.reset()
    persistQueue.__resetForTests()
  })

  afterEach(() => {
    persistQueue.__resetForTests()
  })

  it('pinning adds to the bench in order; unpinning removes it', async () => {
    const store = new TicketStore()
    await settle()
    const a = await store.create({ type: 'Execute', title: 'a' })
    const b = await store.create({ type: 'Execute', title: 'b' })
    await settle()

    expect((await store.pinTicket(a)).ok).toBe(true)
    expect((await store.pinTicket(b)).ok).toBe(true)
    expect(store.getBenchSnapshot().map((t) => t.title)).toEqual(['a', 'b'])
    expect(a.pinned).toBe(true)

    await store.unpinTicket(a)
    expect(store.getBenchSnapshot().map((t) => t.title)).toEqual(['b'])
    expect(a.pinned).toBe(false)
  })

  it(`refuses a ${MAX_BENCH_TICKETS + 1}th pin and hands back the current bench`, async () => {
    const store = new TicketStore()
    await settle()
    const bench: Ticket[] = []
    for (let i = 0; i < MAX_BENCH_TICKETS; i++) {
      const t = await store.create({ type: 'Execute', title: `bench-${i}` })
      await store.pinTicket(t)
      bench.push(t)
    }
    const overflow = await store.create({ type: 'Execute', title: 'overflow' })
    await settle()

    const result = await store.pinTicket(overflow)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.bench.map((t) => t.title)).toEqual(bench.map((t) => t.title))
    expect(overflow.pinned).toBe(false) // the attempt made no change
  })

  it('swapTicket replaces one bench ticket with another in the same slot', async () => {
    const store = new TicketStore()
    await settle()
    const bench: Ticket[] = []
    for (let i = 0; i < MAX_BENCH_TICKETS; i++) {
      const t = await store.create({ type: 'Execute', title: `bench-${i}` })
      await store.pinTicket(t)
      bench.push(t)
    }
    const incoming = await store.create({ type: 'Execute', title: 'incoming' })
    await settle()

    await store.swapTicket(bench[0], incoming)

    expect(bench[0].pinned).toBe(false)
    expect(incoming.pinned).toBe(true)
    // Swap keeps the vacated slot rather than appending — incoming takes
    // bench[0]'s old (first) position instead of landing last.
    expect(store.getBenchSnapshot().map((t) => t.title)).toEqual(['incoming', 'bench-1', 'bench-2', 'bench-3'])
  })
})
