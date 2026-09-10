/**
 * `handleInvoke` is the dispatch-and-serialize step of the unix socket
 * transport, pulled out as a pure function so the guide/token response-shape
 * logic can be unit-tested without a real socket.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// createTicket notifies the renderer on success — stub electron so that
// notification doesn't crash outside a real Electron process.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

import { initSqlite, __resetSqliteForTests } from '../db/sqlite'
import { __resetBriefingForTests } from '../bridge/briefing'
import { handleInvoke } from './unix'

describe('unix handleInvoke', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
    __resetBriefingForTests()
  })
  afterEach(() => {
    __resetSqliteForTests()
    __resetBriefingForTests()
  })

  it('an unbriefed caller gets an error response carrying a guide and a token', () => {
    const res = JSON.parse(handleInvoke({ method: 'createTicket', args: { title: 'a', type: 'Execute' } }))
    expect(res.error).toBeTruthy()
    expect(typeof res.guide).toBe('string')
    expect(res.token).toBeTruthy()
  })

  it('a briefed caller gets a plain result, no guide/token noise', () => {
    const first = JSON.parse(handleInvoke({ method: 'createTicket', args: { title: 'a', type: 'Execute' } }))
    const token = first.token as string

    const res = JSON.parse(handleInvoke({ method: 'createTicket', args: { title: 'b', type: 'Execute' }, token }))
    expect(res.result.title).toBe('b')
    expect(res.guide).toBeUndefined()
    expect(res.token).toBeUndefined()
  })

  it('an ordinary method error is a plain error response, no guide/token', () => {
    const first = JSON.parse(handleInvoke({ method: 'createTicket', args: { title: 'a', type: 'Execute' } }))
    const token = first.token as string

    const res = JSON.parse(handleInvoke({ method: 'updateTicket', args: { uuid: 'nope', patch: {} }, token }))
    expect(res.error).toMatch(/not found/)
    expect(res.guide).toBeUndefined()
  })
})
