import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PersistQueue } from './persistQueue'

const DELAY = 400

describe('PersistQueue', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  // --- Risk: a burst of typing must not write once per keystroke ---------

  it('collapses a burst of schedules into a single write', async () => {
    const queue = new PersistQueue(DELAY)
    const write = vi.fn(async () => {})

    for (let i = 0; i < 25; i++) queue.schedule('ticket-1', write)
    expect(write).not.toHaveBeenCalled() // nothing before the idle window

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('persists the latest state, not the first', async () => {
    const queue = new PersistQueue(DELAY)
    const written: string[] = []

    for (const text of ['a', 'ab', 'abc']) {
      queue.schedule('ticket-1', async () => { written.push(text) })
    }
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(written).toEqual(['abc'])
  })

  it('keys writes separately per ticket', async () => {
    const queue = new PersistQueue(DELAY)
    const a = vi.fn(async () => {})
    const b = vi.fn(async () => {})

    queue.schedule('ticket-a', a)
    queue.schedule('ticket-b', b)
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('starts a new idle window on each schedule', async () => {
    const queue = new PersistQueue(DELAY)
    const write = vi.fn(async () => {})

    queue.schedule('ticket-1', write)
    await vi.advanceTimersByTimeAsync(DELAY - 50)
    queue.schedule('ticket-1', write) // still typing — window restarts
    await vi.advanceTimersByTimeAsync(DELAY - 50)
    expect(write).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(50)
    expect(write).toHaveBeenCalledTimes(1)
  })

  // --- Risk: history must never snapshot stale text ----------------------

  it('flush() runs the pending write immediately and awaits it', async () => {
    const queue = new PersistQueue(DELAY)
    let landed = false
    queue.schedule('ticket-1', async () => {
      await Promise.resolve()
      landed = true
    })

    await queue.flush('ticket-1')

    expect(landed).toBe(true) // resolved before flush returned — no timer wait
    expect(queue.hasPending('ticket-1')).toBe(false)
  })

  it('orders the write before the history snapshot', async () => {
    const queue = new PersistQueue(DELAY)
    const order: string[] = []

    queue.schedule('ticket-1', async () => {
      await Promise.resolve()
      order.push('write')
    })

    // Mirrors TicketEditor's commit(): flush, then snapshot.
    await queue.flush('ticket-1')
    order.push('history-flush')

    expect(order).toEqual(['write', 'history-flush'])
  })

  it('flush() with nothing pending still awaits an in-flight write', async () => {
    const queue = new PersistQueue(DELAY)
    const order: string[] = []
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => { release = resolve })

    queue.schedule('ticket-1', async () => {
      await blocked
      order.push('write')
    })

    await vi.advanceTimersByTimeAsync(DELAY) // timer fires; write hangs
    expect(queue.hasPending('ticket-1')).toBe(false)

    const flushed = queue.flush('ticket-1').then(() => { order.push('flushed') })
    release?.()
    await flushed

    expect(order).toEqual(['write', 'flushed'])
  })

  it('flushAll() drains every key', async () => {
    const queue = new PersistQueue(DELAY)
    const a = vi.fn(async () => {})
    const b = vi.fn(async () => {})

    queue.schedule('ticket-a', a)
    queue.schedule('ticket-b', b)
    await queue.flushAll()

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  // --- Risk: a queued write must not resurrect a deleted row -------------

  it('cancel() drops the pending write without running it', async () => {
    const queue = new PersistQueue(DELAY)
    const write = vi.fn(async () => {})

    queue.schedule('ticket-1', write)
    await queue.cancel('ticket-1')
    await vi.advanceTimersByTimeAsync(DELAY * 2)

    expect(write).not.toHaveBeenCalled()
  })
})
