import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// index.ts imports ipcMain at module load — stub it so the bridge can be
// imported in the node test env. The tests drive dispatchBridge directly.
vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))

import { initSqlite, __resetSqliteForTests } from '../db/sqlite'
import { dispatchBridge } from './index'
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
