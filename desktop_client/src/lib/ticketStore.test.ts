// @vitest-environment jsdom
/**
 * Integration cover for the debounced write path.
 *
 * `persistQueue.test.ts` proves the queue in isolation; this proves the store
 * is actually wired through it — that a burst of edits reaching the real save
 * hook produces one SQL write rather than one per keystroke.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `ticketStore` constructs a singleton at import time that reaches straight for
// window.db, so the stub has to exist before the module is evaluated.
const sqlLog = vi.hoisted(() => {
  const log: string[] = []
  const db = {
    ticket: async (sql: string) => {
      log.push(sql)
      return sql.trimStart().toUpperCase().startsWith('SELECT') ? [] : undefined
    },
    query: async (sql: string) => (
      sql.trimStart().toUpperCase().startsWith('SELECT') ? [] : undefined
    ),
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

import { TicketStore } from './ticketStore'
import { persistQueue, PERSIST_DEBOUNCE_MS } from './persistQueue'
import type { Ticket } from '@/shared/types'

const stub = {
  reset: () => { sqlLog.length = 0 },
  upserts: () => sqlLog.filter((s) => s.includes('INSERT INTO tickets')).length,
  deletes: () => sqlLog.filter((s) => s.startsWith('DELETE FROM tickets')).length,
}

/** Lets the store's async hydrate/create chains settle. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

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
    const ticket = await store.create('Execute', 'Test ticket')
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
