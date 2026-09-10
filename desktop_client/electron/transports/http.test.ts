/**
 * `handleInvoke` is the dispatch-and-serialize step of `POST /invoke`, pulled
 * out as a pure function specifically so the guide/token response-shape
 * logic can be unit-tested without standing up a real HTTP server.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// createTicket notifies the renderer on success — stub electron so that
// notification doesn't crash outside a real Electron process.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

import { initSqlite, __resetSqliteForTests } from '../db/sqlite'
import { __resetBriefingForTests } from '../bridge/briefing'
import { handleInvoke } from './http'

describe('http handleInvoke', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
    __resetBriefingForTests()
  })
  afterEach(() => {
    __resetSqliteForTests()
    __resetBriefingForTests()
  })

  it('an unbriefed caller gets 400 with a guide and a token', () => {
    const res = handleInvoke({ method: 'createTicket', args: { title: 'a', type: 'Execute' } })
    expect(res.status).toBe(400)
    expect(typeof res.body.guide).toBe('string')
    expect(res.body.token).toBeTruthy()
  })

  it('a briefed caller gets 200 with the result and the active project, no guide/token noise', () => {
    const first = handleInvoke({ method: 'createTicket', args: { title: 'a', type: 'Execute' } })
    const token = first.body.token as string

    const res = handleInvoke({ method: 'createTicket', args: { title: 'b', type: 'Execute' }, token })
    expect(res.status).toBe(200)
    expect((res.body.result as { title: string }).title).toBe('b')
    expect(res.body.guide).toBeUndefined()
    expect(res.body.token).toBeUndefined()
  })

  it('an ordinary method error still returns a plain 400 error, no guide/token', () => {
    const first = handleInvoke({ method: 'createTicket', args: { title: 'a', type: 'Execute' } })
    const token = first.body.token as string

    const res = handleInvoke({ method: 'getTicket', args: { uuid: 'x' }, token })
    // getTicket returns null for an unknown uuid rather than throwing.
    expect(res.status).toBe(200)
    expect(res.body.result).toBeNull()

    const bad = handleInvoke({ method: 'updateTicket', args: { uuid: 'nope', patch: {} }, token })
    expect(bad.status).toBe(400)
    expect(bad.body.guide).toBeUndefined()
  })

  it('an unknown method is a plain 400 error', () => {
    const first = handleInvoke({ method: 'createTicket', args: { title: 'a', type: 'Execute' } })
    const token = first.body.token as string
    const res = handleInvoke({ method: 'dropEverything', token })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unknown method/)
  })
})
