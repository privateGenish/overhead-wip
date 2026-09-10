/**
 * The context-token briefing gate and its burst-decay drift detector.
 *
 * `ensureBriefed` is the hard gate: an external caller without a valid token
 * is rejected, and the rejection carries the guide + a fresh token so
 * failing IS the briefing. `noteBurst` is the soft, non-blocking detector
 * layered on top of an already-succeeded call — it never throws, and its
 * whole job is to make guide refreshes come faster the deeper an agent goes
 * into one unbroken run of substantial writes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ensureBriefed,
  noteBurst,
  BriefingRequiredError,
  __resetBriefingForTests,
} from './briefing'

function brief(uuid: string): BriefingRequiredError {
  try {
    ensureBriefed('createTicket', { caller: uuid })
    throw new Error('expected ensureBriefed to throw')
  } catch (err) {
    if (err instanceof BriefingRequiredError) return err
    throw err
  }
}

describe('ensureBriefed', () => {
  beforeEach(() => { __resetBriefingForTests() })
  afterEach(() => { __resetBriefingForTests() })

  it('no-ops when ctx.caller is unset — every internal/test call to dispatchBridge is unaffected', () => {
    for (let i = 0; i < 50; i++) {
      expect(() => ensureBriefed('createTicket', {})).not.toThrow()
    }
  })

  it('rejects a fresh caller and hands back a non-empty guide and a token', () => {
    const err = brief('http')
    expect(typeof err.guide).toBe('string')
    expect(typeof err.token).toBe('string')
    expect(err.token.length).toBeGreaterThan(0)
  })

  it('accepts a retry that carries the token just issued', () => {
    const err = brief('http')
    expect(() => ensureBriefed('createTicket', { caller: 'http', briefToken: err.token })).not.toThrow()
  })

  it('rejects a wrong or stale token, and reissues a new one', () => {
    const first = brief('http')
    const second = brief('http') // wrong token (none supplied) — reissues
    expect(second.token).not.toBe(first.token)
    // The old (now stale) token no longer works against current state. This
    // check itself mints yet another token as a side effect, so it must be
    // the last assertion in this test — see the next test for "the newest
    // token issued is always accepted".
    expect(() => ensureBriefed('createTicket', { caller: 'http', briefToken: first.token })).toThrow(BriefingRequiredError)
  })

  it('tracks caller keys independently', () => {
    const httpErr = brief('http')
    // A different transport has never been briefed either — its own rejection,
    // unaffected by http's state.
    expect(() => ensureBriefed('createTicket', { caller: 'unix', briefToken: httpErr.token })).toThrow(BriefingRequiredError)
  })
})

describe('noteBurst', () => {
  beforeEach(() => { __resetBriefingForTests() })
  afterEach(() => { __resetBriefingForTests() })

  it('never throws, regardless of input', () => {
    expect(() => noteBurst('createTicket', { title: 'x', description: 'y' }, { caller: 'http' })).not.toThrow()
  })

  it('reads (methods with no authored text) never trigger a refresh, no matter the volume', () => {
    let refreshed = false
    for (let i = 0; i < 500; i++) {
      const r = noteBurst('listTickets', null, { caller: 'http' })
      if (r) refreshed = true
    }
    expect(refreshed).toBe(false)
  })

  it('a run of substantial writes eventually crosses the threshold and returns a refresh', () => {
    const bigWrite = { title: 'x'.repeat(50), description: 'y'.repeat(200) }
    let refresh: { guide: string; token: string } | undefined
    for (let i = 0; i < 20 && !refresh; i++) {
      refresh = noteBurst('createTicket', bigWrite, { caller: 'http' })
    }
    expect(refresh).toBeDefined()
    expect(typeof refresh?.guide).toBe('string')
    expect(typeof refresh?.token).toBe('string')
  })

  it('refreshes accelerate deeper into a burst — t is not reset by crossing the threshold', () => {
    const bigWrite = { title: 'x'.repeat(50), description: 'y'.repeat(200) }
    let callsToFirstRefresh = 0
    let refresh: { guide: string; token: string } | undefined
    while (!refresh) {
      callsToFirstRefresh++
      refresh = noteBurst('createTicket', bigWrite, { caller: 'http' })
    }

    let callsToSecondRefresh = 0
    refresh = undefined
    while (!refresh) {
      callsToSecondRefresh++
      refresh = noteBurst('createTicket', bigWrite, { caller: 'http' })
    }

    // Because t never resets on a threshold-crossing refresh, the base^t term
    // is already larger going into the second stretch, so it takes fewer
    // additional writes of the same size to cross the threshold again.
    expect(callsToSecondRefresh).toBeLessThanOrEqual(callsToFirstRefresh)
  })

  it('an idle gap resets t but does not itself trigger a refresh or touch f', () => {
    vi.useFakeTimers()
    try {
      noteBurst('createTicket', { title: 'small' }, { caller: 'http' })
      vi.advanceTimersByTime(6 * 60_000) // past the 5-minute hangout window
      const r = noteBurst('createTicket', { title: 'small' }, { caller: 'http' })
      expect(r).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('no-ops when ctx.caller is unset', () => {
    expect(noteBurst('createTicket', { title: 'x'.repeat(10_000) }, {})).toBeUndefined()
  })
})
