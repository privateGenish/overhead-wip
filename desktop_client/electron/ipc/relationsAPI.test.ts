import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
}))

import { initSqlite, __resetSqliteForTests, runSql } from '../db/sqlite'
import { registerRelationsAPI } from './relationsAPI'
import type { TicketRelation } from '../../src/types/electron'

const TICKET_A = 'aaaa-0000'
const TICKET_B = 'bbbb-0000'
const TICKET_C = 'cccc-0000'

function invoke(op: string, payload: unknown): unknown {
  return handlers.get('db:relation')!(null, op, payload)
}

function add(type: string, node_a: string, node_b: string): TicketRelation {
  return invoke('add', { type, node_a, node_b }) as TicketRelation
}

function remove(uuid: string): void {
  invoke('remove', { uuid })
}

function list(ticketUuid: string): TicketRelation[] {
  return invoke('list', { ticketUuid }) as TicketRelation[]
}

function seedTicket(uuid: string): void {
  runSql(
    `INSERT INTO tickets (uuid, id, title, type, status, backlog, description, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, '', 0, 0, 0)`,
    [uuid, uuid.slice(0, 7), 'Test ticket', 'Execute', 'Draft'],
  )
}

describe('db:relation — add (relates-to)', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
    handlers.clear()
    registerRelationsAPI()
    seedTicket(TICKET_A)
    seedTicket(TICKET_B)
    seedTicket(TICKET_C)
  })

  afterEach(() => {
    __resetSqliteForTests()
  })

  it('inserts a relates-to relation and returns it with a uuid', () => {
    const rel = add('relates-to', TICKET_A, TICKET_B)
    expect(rel.uuid).toBeTruthy()
    expect(rel.type).toBe('relates-to')
    expect([rel.node_a, rel.node_b]).toEqual(expect.arrayContaining([TICKET_A, TICKET_B]))
  })

  it('enforces canonical ordering — stores smaller uuid as node_a regardless of input order', () => {
    const ab = add('relates-to', TICKET_A, TICKET_B)
    expect(ab.node_a < ab.node_b).toBe(true)

    __resetSqliteForTests()
    initSqlite(':memory:')
    seedTicket(TICKET_A)
    seedTicket(TICKET_B)

    const ba = add('relates-to', TICKET_B, TICKET_A)
    expect(ba.node_a).toBe(ab.node_a)
    expect(ba.node_b).toBe(ab.node_b)
  })

  it('prevents duplicate relates-to relations (PK constraint)', () => {
    add('relates-to', TICKET_A, TICKET_B)
    expect(() => add('relates-to', TICKET_A, TICKET_B)).toThrow()
    expect(() => add('relates-to', TICKET_B, TICKET_A)).toThrow()
  })

  it('rejects self-relations', () => {
    expect(() => add('relates-to', TICKET_A, TICKET_A)).toThrow('cannot relate to itself')
  })
})

describe('db:relation — add (blocked-by)', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
    handlers.clear()
    registerRelationsAPI()
    seedTicket(TICKET_A)
    seedTicket(TICKET_B)
  })

  afterEach(() => {
    __resetSqliteForTests()
  })

  it('inserts with correct directionality — node_a is blocked, node_b is blocker', () => {
    const rel = add('blocked-by', TICKET_A, TICKET_B)
    expect(rel.node_a).toBe(TICKET_A)
    expect(rel.node_b).toBe(TICKET_B)
    expect(rel.type).toBe('blocked-by')
  })

  it('does NOT swap order for blocked-by', () => {
    const rel = add('blocked-by', TICKET_B, TICKET_A)
    expect(rel.node_a).toBe(TICKET_B)
    expect(rel.node_b).toBe(TICKET_A)
  })

  it('allows A-blocked-by-B and B-blocked-by-A as distinct relations', () => {
    expect(() => {
      add('blocked-by', TICKET_A, TICKET_B)
      add('blocked-by', TICKET_B, TICKET_A)
    }).not.toThrow()
  })

  it('prevents exact duplicate blocked-by relations', () => {
    add('blocked-by', TICKET_A, TICKET_B)
    expect(() => add('blocked-by', TICKET_A, TICKET_B)).toThrow()
  })
})

describe('db:relation — remove', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
    handlers.clear()
    registerRelationsAPI()
    seedTicket(TICKET_A)
    seedTicket(TICKET_B)
  })

  afterEach(() => {
    __resetSqliteForTests()
  })

  it('removes a relation by uuid', () => {
    const rel = add('relates-to', TICKET_A, TICKET_B)
    remove(rel.uuid)
    expect(list(TICKET_A)).toHaveLength(0)
  })

  it('silently succeeds when uuid does not exist', () => {
    expect(() => remove('non-existent-uuid')).not.toThrow()
  })
})

describe('db:relation — list', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
    handlers.clear()
    registerRelationsAPI()
    seedTicket(TICKET_A)
    seedTicket(TICKET_B)
    seedTicket(TICKET_C)
  })

  afterEach(() => {
    __resetSqliteForTests()
  })

  it('returns empty array for a ticket with no relations', () => {
    expect(list(TICKET_A)).toEqual([])
  })

  it('returns relations where the ticket is node_a', () => {
    add('relates-to', TICKET_A, TICKET_B)
    const rels = list(TICKET_A)
    expect(rels).toHaveLength(1)
    expect(rels[0].type).toBe('relates-to')
  })

  it('returns relations where the ticket is node_b', () => {
    add('relates-to', TICKET_A, TICKET_B)
    const rels = list(TICKET_B)
    expect(rels).toHaveLength(1)
  })

  it('returns all relation types for a ticket', () => {
    add('relates-to', TICKET_A, TICKET_B)
    add('blocked-by', TICKET_A, TICKET_C)
    const rels = list(TICKET_A)
    expect(rels).toHaveLength(2)
    const types = rels.map((r) => r.type)
    expect(types).toContain('relates-to')
    expect(types).toContain('blocked-by')
  })

  it('does not return relations for unrelated tickets', () => {
    add('relates-to', TICKET_A, TICKET_B)
    expect(list(TICKET_C)).toHaveLength(0)
  })
})

describe('db:relation — cascade delete', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
    handlers.clear()
    registerRelationsAPI()
    seedTicket(TICKET_A)
    seedTicket(TICKET_B)
  })

  afterEach(() => {
    __resetSqliteForTests()
  })

  it('deletes relations when a ticket is deleted', () => {
    add('relates-to', TICKET_A, TICKET_B)
    expect(list(TICKET_A)).toHaveLength(1)

    runSql('DELETE FROM tickets WHERE uuid = ?', [TICKET_A])
    expect(list(TICKET_B)).toHaveLength(0)
  })
})

describe('db:relation — validation', () => {
  beforeEach(() => {
    __resetSqliteForTests()
    initSqlite(':memory:')
    handlers.clear()
    registerRelationsAPI()
    seedTicket(TICKET_A)
    seedTicket(TICKET_B)
  })

  afterEach(() => {
    __resetSqliteForTests()
  })

  it('rejects unknown op', () => {
    expect(() => invoke('explode', {})).toThrow('unknown op')
  })

  it('rejects unknown relation type', () => {
    expect(() => add('friends-with', TICKET_A, TICKET_B)).toThrow('unknown type')
  })

  it('rejects non-object payload', () => {
    expect(() => handlers.get('db:relation')!(null, 'add', 'bad')).toThrow('payload must be an object')
  })

  it('rejects missing fields in add', () => {
    expect(() => invoke('add', { type: 'relates-to', node_a: TICKET_A })).toThrow()
  })

  it('rejects missing uuid in remove', () => {
    expect(() => invoke('remove', { uuid: '' })).toThrow()
  })

  it('rejects missing ticketUuid in list', () => {
    expect(() => invoke('list', { ticketUuid: '' })).toThrow()
  })
})
