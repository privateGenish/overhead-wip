import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Capture the handler that registerTicketAPI registers, so the test can invoke
// the db:ticket channel directly without a real Electron process.
const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
}))

import {
  initSqlite,
  __resetSqliteForTests,
  historyGet,
} from '../db/sqlite'
import { registerTicketAPI, flushHistory } from './ticketAPI'

const UUID = 'ticket-1'

/**
 * Upserts the ticket through the IPC handler exactly as the renderer does:
 * uuid is params[0] (the debounce key), description is what gets snapshotted.
 */
function upsert(description: string): void {
  handlers.get('db:ticket')!(
    null,
    `INSERT INTO tickets (uuid, id, title, type, status, backlog, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uuid) DO UPDATE SET description = excluded.description`,
    [UUID, 'OVH-001', 'T', 'Execute', 'Draft', 0, description, 1000, 1000],
  )
}

describe('ticket history debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetSqliteForTests()
    initSqlite(':memory:')
    handlers.clear()
    registerTicketAPI()
  })

  afterEach(() => {
    vi.useRealTimers()
    __resetSqliteForTests()
  })

  it('snapshots the description only after the debounce window', () => {
    upsert('v1')
    expect(historyGet(UUID)).toHaveLength(0) // timer pending, nothing written yet

    vi.advanceTimersByTime(30_000)
    const rows = historyGet(UUID)
    expect(rows).toHaveLength(1)
    expect(rows[0].description).toBe('v1')
  })

  it('resets the timer on each edit — only the final value is saved', () => {
    upsert('a')
    vi.advanceTimersByTime(20_000)
    upsert('b')
    vi.advanceTimersByTime(20_000) // 40s elapsed, but only 20s since the last edit
    expect(historyGet(UUID)).toHaveLength(0)

    vi.advanceTimersByTime(10_000) // now 30s since the last edit
    const rows = historyGet(UUID)
    expect(rows).toHaveLength(1)
    expect(rows[0].description).toBe('b')
  })

  it('dedups identical descriptions by hash', () => {
    upsert('same')
    vi.advanceTimersByTime(30_000)
    expect(historyGet(UUID)).toHaveLength(1)

    upsert('same') // unchanged — no new version
    vi.advanceTimersByTime(30_000)
    expect(historyGet(UUID)).toHaveLength(1)

    upsert('changed') // changed — new version
    vi.advanceTimersByTime(30_000)
    expect(historyGet(UUID)).toHaveLength(2)
  })

  it('flushHistory fires pending snapshots immediately', () => {
    upsert('flushed')
    expect(historyGet(UUID)).toHaveLength(0) // timer still pending

    flushHistory()
    const rows = historyGet(UUID)
    expect(rows).toHaveLength(1)
    expect(rows[0].description).toBe('flushed')
  })
})
