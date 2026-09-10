import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// index.ts imports ipcMain at module load — stub it so the bridge can be
// imported in the node test env. The tests drive dispatchBridge directly.
vi.mock('electron', () => ({
  ipcMain: { handle: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { initSqlite, __resetSqliteForTests } from '../db/sqlite'
import { dispatchBridge, dispatchBridgeExternal, BriefingRequiredError } from './index'
import { __resetThrottleForTests } from './gate'
import { __resetBriefingForTests } from './briefing'
import type { BridgeTicket } from './tickets'
import type { TicketRelation } from '../../src/types/electron'

const create = (input: unknown) => dispatchBridge('createTicket', input) as BridgeTicket

describe('bridge — tickets', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
  })
  afterEach(() => __resetSqliteForTests())

  it('creates a ticket with a uuid, sequential id, and type-correct initial status', () => {
    const t = create({ title: 'First', type: 'Execute' })
    expect(t.uuid).toBeTruthy()
    expect(t.id).toBe('OVH-001')
    expect(t.status).toBe('Draft')
    expect(t.backlog).toBe(false)
    expect(t.archived).toBe(false)
  })

  it('seeds the initial status per type', () => {
    expect(create({ title: 'a', type: 'Explore' }).status).toBe('Open')
    expect(create({ title: 'b', type: 'Feature' }).status).toBe('Idea')
  })

  it('mints sequential human ids', () => {
    expect(create({ title: 'a', type: 'Execute' }).id).toBe('OVH-001')
    expect(create({ title: 'b', type: 'Execute' }).id).toBe('OVH-002')
  })

  it('persists — getTicket returns the created ticket', () => {
    const t = create({ title: 'Persisted', type: 'Feature' })
    const got = dispatchBridge('getTicket', { uuid: t.uuid }) as BridgeTicket | null
    expect(got?.title).toBe('Persisted')
  })

  it('getTicket returns null for an unknown uuid', () => {
    expect(dispatchBridge('getTicket', { uuid: 'nope' })).toBeNull()
  })

  it('lists tickets in creation order', () => {
    create({ title: 'one', type: 'Execute' })
    create({ title: 'two', type: 'Execute' })
    const all = dispatchBridge('listTickets', undefined) as BridgeTicket[]
    expect(all.map((t) => t.title)).toEqual(['one', 'two'])
  })

  it('updates a ticket via patch and bumps updated_at', () => {
    const t = create({ title: 'old', type: 'Execute' })
    const updated = dispatchBridge('updateTicket', {
      uuid: t.uuid,
      patch: { title: 'new', status: 'Done', backlog: true },
    }) as BridgeTicket
    expect(updated.title).toBe('new')
    expect(updated.status).toBe('Done')
    expect(updated.backlog).toBe(true)
    expect(updated.updated_at).toBeGreaterThanOrEqual(t.updated_at)
  })

  it('updateTicket throws when the ticket is missing', () => {
    expect(() => dispatchBridge('updateTicket', { uuid: 'nope', patch: {} })).toThrow('not found')
  })

  it('deletes a ticket', () => {
    const t = create({ title: 'doomed', type: 'Execute' })
    dispatchBridge('deleteTicket', { uuid: t.uuid })
    expect(dispatchBridge('getTicket', { uuid: t.uuid })).toBeNull()
  })

  it('rejects invalid input (no SQL, no bad shapes)', () => {
    expect(() => create({ title: '', type: 'Execute' })).toThrow()
    expect(() => create({ title: 'x', type: 'Nope' })).toThrow()
    expect(() => create('DROP TABLE tickets')).toThrow()
  })

  it('createTicket and updateTicket ignore a caller-supplied `pinned` — only pinTicket sets it', () => {
    const t = create({ title: 'sneaky', type: 'Execute', pinned: true } as unknown as object)
    expect(t.pinned).toBe(false)

    const updated = dispatchBridge('updateTicket', {
      uuid: t.uuid,
      patch: { pinned: true },
    }) as BridgeTicket
    expect(updated.pinned).toBe(false)
  })
})

describe('bridge — the bench', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
  })
  afterEach(() => __resetSqliteForTests())

  const pin = (uuid: string) => dispatchBridge('pinTicket', { uuid }) as BridgeTicket
  const unpin = (uuid: string) => dispatchBridge('unpinTicket', { uuid }) as BridgeTicket

  it('pins a ticket, and unpins it back', () => {
    const t = create({ title: 'benched', type: 'Execute' })
    expect(pin(t.uuid).pinned).toBe(true)
    expect((dispatchBridge('getTicket', { uuid: t.uuid }) as BridgeTicket).pinned).toBe(true)

    expect(unpin(t.uuid).pinned).toBe(false)
    expect((dispatchBridge('getTicket', { uuid: t.uuid }) as BridgeTicket).pinned).toBe(false)
  })

  it('is idempotent — pinning twice or unpinning an unpinned ticket is a no-op, not an error', () => {
    const t = create({ title: 'idempotent', type: 'Execute' })
    pin(t.uuid)
    expect(pin(t.uuid).pinned).toBe(true)

    const other = create({ title: 'never pinned', type: 'Execute' })
    expect(unpin(other.uuid).pinned).toBe(false)
  })

  it('refuses a 5th pin and names the current bench in the error', () => {
    const bench = [0, 1, 2, 3].map((i) => create({ title: `bench-${i}`, type: 'Execute' }))
    for (const t of bench) pin(t.uuid)

    const fifth = create({ title: 'one too many', type: 'Execute' })
    expect(() => pin(fifth.uuid)).toThrow(/bench is full \(4\/4\)/)
    expect(() => pin(fifth.uuid)).toThrow(bench[0].title)
    // The attempt made no change.
    expect((dispatchBridge('getTicket', { uuid: fifth.uuid }) as BridgeTicket).pinned).toBe(false)
  })

  it('frees a slot on unpin, so a 5th pin succeeds afterward', () => {
    const bench = [0, 1, 2, 3].map((i) => create({ title: `bench-${i}`, type: 'Execute' }))
    for (const t of bench) pin(t.uuid)
    unpin(bench[0].uuid)

    const fifth = create({ title: 'now fits', type: 'Execute' })
    expect(pin(fifth.uuid).pinned).toBe(true)
  })

  it('pinTicket throws for an unknown uuid', () => {
    expect(() => pin('nope')).toThrow('not found')
  })

  it('getProjectContext reports the bench in pin order', () => {
    const a = create({ title: 'a', type: 'Execute' })
    const b = create({ title: 'b', type: 'Execute' })
    pin(a.uuid)
    pin(b.uuid)

    const ctx = dispatchBridge('getProjectContext', undefined) as { bench: BridgeTicket[] }
    expect(ctx.bench.map((t) => t.title)).toEqual(['a', 'b'])
  })
})

describe('bridge — relations', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
  })
  afterEach(() => __resetSqliteForTests())

  it('relates two tickets and lists the relation', () => {
    const a = create({ title: 'a', type: 'Execute' })
    const b = create({ title: 'b', type: 'Execute' })
    dispatchBridge('relate', { a: a.uuid, b: b.uuid })
    const rels = dispatchBridge('listRelations', { ticketUuid: a.uuid }) as TicketRelation[]
    expect(rels).toHaveLength(1)
    expect(rels[0].type).toBe('relates-to')
  })

  it('records blockBy directionality (node_a blocked, node_b blocker)', () => {
    const a = create({ title: 'a', type: 'Execute' })
    const b = create({ title: 'b', type: 'Execute' })
    const rel = dispatchBridge('blockBy', { blocked: a.uuid, blocker: b.uuid }) as TicketRelation
    expect(rel.node_a).toBe(a.uuid)
    expect(rel.node_b).toBe(b.uuid)
    expect(rel.type).toBe('blocked-by')
  })

  it('unrelates by uuid', () => {
    const a = create({ title: 'a', type: 'Execute' })
    const b = create({ title: 'b', type: 'Execute' })
    const rel = dispatchBridge('relate', { a: a.uuid, b: b.uuid }) as TicketRelation
    dispatchBridge('unrelate', { uuid: rel.uuid })
    expect(dispatchBridge('listRelations', { ticketUuid: a.uuid })).toHaveLength(0)
  })
})

describe('bridge — views', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
  })
  afterEach(() => __resetSqliteForTests())

  it('creates a view and lists it', () => {
    const v = dispatchBridge('createView', { name: 'Sprint board' }) as { uuid: string; name: string }
    expect(v.uuid).toBeTruthy()
    expect(v.name).toBe('Sprint board')
    const all = dispatchBridge('listViews', undefined) as { uuid: string; name: string }[]
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('Sprint board')
  })

  it('renames a view', () => {
    const v = dispatchBridge('createView', { name: 'Old' }) as { uuid: string; name: string }
    const renamed = dispatchBridge('renameView', { uuid: v.uuid, name: 'New' }) as { uuid: string; name: string }
    expect(renamed.name).toBe('New')
  })

  it('renameView throws for unknown uuid', () => {
    expect(() => dispatchBridge('renameView', { uuid: 'nope', name: 'x' })).toThrow('not found')
  })

  it('deletes a view', () => {
    const v = dispatchBridge('createView', { name: 'doomed' }) as { uuid: string }
    dispatchBridge('deleteView', { uuid: v.uuid })
    expect(dispatchBridge('listViews', undefined)).toHaveLength(0)
  })

  it('adds, lists, and removes nodes on a view', () => {
    const v = dispatchBridge('createView', { name: 'v' }) as { uuid: string }
    const t = create({ title: 'ticket', type: 'Execute' })

    dispatchBridge('addViewNode', { viewUuid: v.uuid, ticketUuid: t.uuid, x: 100, y: 200 })
    const nodes = dispatchBridge('listViewNodes', { viewUuid: v.uuid }) as { ticket_uuid: string; x: number; y: number }[]
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ ticket_uuid: t.uuid, x: 100, y: 200 })

    // Upsert same node to new position
    dispatchBridge('addViewNode', { viewUuid: v.uuid, ticketUuid: t.uuid, x: 300, y: 400 })
    const updated = dispatchBridge('listViewNodes', { viewUuid: v.uuid }) as { x: number; y: number }[]
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ x: 300, y: 400 })

    dispatchBridge('removeViewNode', { viewUuid: v.uuid, ticketUuid: t.uuid })
    expect(dispatchBridge('listViewNodes', { viewUuid: v.uuid })).toHaveLength(0)
  })

  it('creates, lists, and removes visual edges on a view', () => {
    const v = dispatchBridge('createView', { name: 'v' }) as { uuid: string }
    const a = create({ title: 'a', type: 'Execute' })
    const b = create({ title: 'b', type: 'Execute' })
    dispatchBridge('addViewNode', { viewUuid: v.uuid, ticketUuid: a.uuid, x: 0, y: 0 })
    dispatchBridge('addViewNode', { viewUuid: v.uuid, ticketUuid: b.uuid, x: 200, y: 0 })

    const edge = dispatchBridge('createViewEdge', {
      viewUuid: v.uuid, sourceUuid: a.uuid, targetUuid: b.uuid,
      sourceHandle: 'right', targetHandle: 'left',
    }) as { uuid: string; source_uuid: string; target_uuid: string }
    expect(edge.uuid).toBeTruthy()
    expect(edge.source_uuid).toBe(a.uuid)

    const edges = dispatchBridge('listViewEdges', { viewUuid: v.uuid }) as { uuid: string }[]
    expect(edges).toHaveLength(1)

    dispatchBridge('removeViewEdge', { uuid: edge.uuid })
    expect(dispatchBridge('listViewEdges', { viewUuid: v.uuid })).toHaveLength(0)
  })

  it('rejects invalid input', () => {
    expect(() => dispatchBridge('createView', { name: '' })).toThrow()
    expect(() => dispatchBridge('addViewNode', { viewUuid: 'x', ticketUuid: 'y', x: 'bad', y: 0 })).toThrow()
  })
})

describe('bridge — dispatch', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
  })
  afterEach(() => __resetSqliteForTests())

  it('rejects an unknown method', () => {
    expect(() => dispatchBridge('dropEverything', {})).toThrow('unknown method')
  })
})

describe('bridge — proposeTicket', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
    __resetThrottleForTests() // this file's earlier describes share the throttle's call log
  })
  afterEach(() => __resetSqliteForTests())

  const propose = (input: unknown) => dispatchBridge('proposeTicket', input) as {
    uuid: string
    title: string
    type: string
    description: string
    created_at: number
  }

  it('inserts a draft and returns it, with no id minted', () => {
    const draft = propose({ title: 'Investigate slow query', type: 'Explore' })
    expect(draft.uuid).toBeTruthy()
    expect(draft.title).toBe('Investigate slow query')
    expect(draft.type).toBe('Explore')
    expect(draft).not.toHaveProperty('id')
    expect(draft).not.toHaveProperty('status')
  })

  it('defaults description to an empty string', () => {
    expect(propose({ title: 'a', type: 'Execute' }).description).toBe('')
  })

  it('rejects an invalid type', () => {
    expect(() => propose({ title: 'a', type: 'Nope' })).toThrow()
    expect(() => propose({ title: '', type: 'Execute' })).toThrow()
  })

  it('never lands in the tickets table', () => {
    propose({ title: 'a', type: 'Execute' })
    expect(dispatchBridge('listTickets', undefined)).toHaveLength(0)
  })

  it('does not touch the id counter', () => {
    propose({ title: 'a', type: 'Execute' })
    const t = dispatchBridge('createTicket', { title: 'real one', type: 'Execute' }) as { id: string }
    expect(t.id).toBe('OVH-001') // still the first ticket ever actually created
  })

  it('has no approve or reject method on the bridge, on any transport', () => {
    expect(() => dispatchBridge('approveTicket', {})).toThrow('unknown method')
    expect(() => dispatchBridge('rejectTicket', {})).toThrow('unknown method')
    expect(() => dispatchBridge('listPendingTickets', {})).toThrow('unknown method')
  })
})

describe('bridge — briefing', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
    __resetBriefingForTests()
  })
  afterEach(() => {
    __resetSqliteForTests()
    __resetBriefingForTests()
  })

  it('any call with no ctx (the default across this whole file) never triggers a briefing gate', () => {
    // Regression guard: ensureBriefed only ever applies to external callers
    // that set ctx.caller. Every other describe block in this file calls
    // dispatchBridge with no ctx at all and must keep working unchanged.
    for (let i = 0; i < 30; i++) {
      expect(() => dispatchBridge('createTicket', { title: `t${i}`, type: 'Execute' })).not.toThrow()
    }
  })

  it('a fresh external caller is rejected via dispatchBridge, carrying guide + token', () => {
    try {
      dispatchBridge('createTicket', { title: 'a', type: 'Execute' }, { caller: 'http' })
      throw new Error('expected a BriefingRequiredError')
    } catch (err) {
      expect(err).toBeInstanceOf(BriefingRequiredError)
      const briefErr = err as BriefingRequiredError
      expect(typeof briefErr.guide).toBe('string')
      expect(briefErr.token).toBeTruthy()
    }
  })

  it('dispatchBridgeExternal returns a bare {result} once briefed, with no refresh due', () => {
    let token: string
    try {
      dispatchBridgeExternal('createTicket', { title: 'a', type: 'Execute' }, { caller: 'http' })
      throw new Error('expected a BriefingRequiredError')
    } catch (err) {
      if (!(err instanceof BriefingRequiredError)) throw err
      token = err.token
    }

    const res = dispatchBridgeExternal('createTicket', { title: 'small', type: 'Execute' }, {
      caller: 'http', briefToken: token,
    })
    expect((res.result as BridgeTicket).title).toBe('small')
    expect(res.guide).toBeUndefined()
    expect(res.token).toBeUndefined()
  })

  it('dispatchBridgeExternal rides a guide+token refresh on a success response once the burst crosses threshold', () => {
    let token: string
    try {
      dispatchBridgeExternal('createTicket', { title: 'a', type: 'Execute' }, { caller: 'http' })
      throw new Error('expected a BriefingRequiredError')
    } catch (err) {
      if (!(err instanceof BriefingRequiredError)) throw err
      token = err.token
    }

    const bigWrite = { title: 'x'.repeat(50), type: 'Execute', description: 'y'.repeat(200) }
    let refreshed: { guide?: string; token?: string } | undefined
    for (let i = 0; i < 20 && !refreshed?.guide; i++) {
      const res = dispatchBridgeExternal('createTicket', bigWrite, { caller: 'http', briefToken: token })
      if (res.token) token = res.token // keep using the latest token, same as a real caller would
      if (res.guide) refreshed = res
    }
    expect(refreshed?.guide).toBeTruthy()
    expect(refreshed?.token).toBeTruthy()
  })
})
