/**
 * Cover for the two cross-cutting guards on the bridge.
 *
 * Both were documented as working and were not: the HTTP transport's file
 * header described bearer-token enforcement while nothing read the header, and
 * `throttle` was a `// TODO` that every call passed straight through.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { throttle, __resetThrottleForTests } from './gate'
import { initToken, validateToken } from '../transports/token'

describe('throttle', () => {
  beforeEach(() => { __resetThrottleForTests() })
  afterEach(() => { __resetThrottleForTests() })

  it('allows ordinary use without complaint', () => {
    for (let i = 0; i < 50; i++) {
      expect(() => throttle('listTickets', { caller: 'unix' })).not.toThrow()
    }
  })

  it('stops a runaway caller', () => {
    // A stuck retry loop is the case this exists for: every call downstream is
    // a synchronous SQL write plus a vault file write on the main thread.
    expect(() => {
      for (let i = 0; i < 500; i++) throttle('createTicket', { caller: 'http' })
    }).toThrow(/rate limit/i)
  })

  it('counts callers separately', () => {
    for (let i = 0; i < 101; i++) {
      try { throttle('createTicket', { caller: 'http' }) } catch { /* expected */ }
    }
    // A different transport is not punished for HTTP's behaviour.
    expect(() => throttle('listTickets', { caller: 'unix' })).not.toThrow()
  })
})

describe('token validation', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-token-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('accepts the minted token and rejects everything else', () => {
    const token = initToken(dir)

    expect(validateToken(token)).toBe(true)
    expect(validateToken('')).toBe(false)
    expect(validateToken('wrong')).toBe(false)
    // Same length, different content — the case a length check alone misses.
    expect(validateToken('f'.repeat(token.length))).toBe(false)
  })

  it('writes the token owner-readable only', () => {
    initToken(dir)
    const mode = fs.statSync(path.join(dir, 'bridge.token')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('mints a fresh token per session', () => {
    const first = initToken(dir)
    const second = initToken(dir)
    expect(second).not.toBe(first)
    expect(validateToken(first)).toBe(false) // the old one stops working
  })
})
