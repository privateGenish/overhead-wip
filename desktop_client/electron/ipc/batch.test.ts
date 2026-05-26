/**
 * Unit tests for the local storage API batch dispatcher.
 *
 * Each test starts with a fresh in-memory SQLite database via
 * `initSqlite(':memory:')` + `__resetSqliteForTests()` — no Electron runtime
 * required.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { runBatch, MAX_OPS_PER_BATCH } from './batch'
import { __resetSqliteForTests, initSqlite } from '../db/sqlite'

const recordA = { uuid: 'a', title: 'A', n: 1 }
const recordB = { uuid: 'b', title: 'B', n: 2 }

beforeEach(() => {
  __resetSqliteForTests()
  initSqlite(':memory:')
})

describe('runBatch — basic CRUD', () => {
  it('get on empty store returns null', () => {
    expect(runBatch([{ get: 'missing' }])).toEqual([null])
  })

  it('all on empty store returns []', () => {
    expect(runBatch([{ all: null }])).toEqual([[]])
  })

  it('put then get returns the same record', () => {
    runBatch([{ put: recordA }])
    expect(runBatch([{ get: 'a' }])).toEqual([recordA])
  })

  it('put then all returns the record', () => {
    runBatch([{ put: recordA }])
    expect(runBatch([{ all: null }])).toEqual([[recordA]])
  })

  it('put with same uuid upserts (update)', () => {
    runBatch([{ put: recordA }])
    runBatch([{ put: { ...recordA, title: 'A-updated' } }])
    expect(runBatch([{ get: 'a' }])).toEqual([
      { uuid: 'a', title: 'A-updated', n: 1 },
    ])
    // Still only one row.
    expect((runBatch([{ all: null }])[0] as unknown[]).length).toBe(1)
  })

  it('delete removes the record', () => {
    runBatch([{ put: recordA }])
    runBatch([{ delete: 'a' }])
    expect(runBatch([{ get: 'a' }])).toEqual([null])
  })

  it('delete on missing uuid is a no-op (does not throw)', () => {
    expect(() => runBatch([{ delete: 'missing' }])).not.toThrow()
  })
})

describe('runBatch — batch semantics', () => {
  it('returns one result per op, in order', () => {
    runBatch([{ put: recordA }, { put: recordB }])
    const out = runBatch([{ get: 'a' }, { get: 'missing' }, { get: 'b' }])
    expect(out).toEqual([recordA, null, recordB])
  })

  it('writes inside a batch resolve to undefined', () => {
    const out = runBatch([{ put: recordA }, { delete: 'a' }])
    expect(out).toEqual([undefined, undefined])
  })

  it('read-your-writes: a get sees an earlier put in the same batch', () => {
    const out = runBatch([{ put: recordA }, { get: 'a' }])
    expect(out[1]).toEqual(recordA)
  })

  it('mixed reads + writes are allowed in one batch', () => {
    runBatch([{ put: recordA }])
    const out = runBatch([
      { get: 'a' },
      { put: recordB },
      { delete: 'a' },
      { all: null },
    ])
    expect(out[0]).toEqual(recordA)
    expect(out[1]).toBeUndefined()
    expect(out[2]).toBeUndefined()
    expect(out[3]).toEqual([recordB])
  })

  it('empty batch returns []', () => {
    expect(runBatch([])).toEqual([])
  })
})

describe('runBatch — transactional rollback', () => {
  it('a failing op rolls back all earlier writes in the same batch', () => {
    runBatch([{ put: recordA }])
    expect(() =>
      runBatch([
        { put: recordB },        // would add B
        { delete: 'a' },         // would remove A
        { get: 123 as unknown as string }, // invalid → throws
      ]),
    ).toThrow()
    // A is still there, B was never inserted.
    expect(runBatch([{ get: 'a' }])).toEqual([recordA])
    expect(runBatch([{ get: 'b' }])).toEqual([null])
  })
})

describe('runBatch — input validation', () => {
  it('non-array input throws', () => {
    expect(() => runBatch({ get: 'a' } as unknown)).toThrow(/array/)
  })

  it('batch over the limit throws', () => {
    const ops = Array.from({ length: MAX_OPS_PER_BATCH + 1 }, () => ({
      get: 'x',
    }))
    expect(() => runBatch(ops)).toThrow(/Batch too large/)
  })

  it('a batch of exactly the limit is accepted', () => {
    const ops = Array.from({ length: MAX_OPS_PER_BATCH }, () => ({
      get: 'x',
    }))
    expect(runBatch(ops)).toHaveLength(MAX_OPS_PER_BATCH)
  })

  it('op with zero keys throws', () => {
    expect(() => runBatch([{}])).toThrow(/exactly one key/)
  })

  it('op with multiple keys throws', () => {
    expect(() => runBatch([{ get: 'a', delete: 'b' }])).toThrow(/exactly one key/)
  })

  it('unknown op kind throws', () => {
    expect(() => runBatch([{ patch: 'a' } as unknown])).toThrow(/Unknown op/)
  })

  it('get with non-string payload throws', () => {
    expect(() => runBatch([{ get: 42 as unknown as string }])).toThrow(/uuid string/)
  })

  it('delete with non-string payload throws', () => {
    expect(() => runBatch([{ delete: null as unknown as string }])).toThrow(/uuid string/)
  })

  it('put without a uuid field throws', () => {
    expect(() =>
      runBatch([{ put: { title: 'no uuid' } as unknown as { uuid: string } }]),
    ).toThrow(/uuid/)
  })

  it('put with non-string uuid throws', () => {
    expect(() =>
      runBatch([{ put: { uuid: 42 } as unknown as { uuid: string } }]),
    ).toThrow(/uuid/)
  })

  it('non-object op throws', () => {
    expect(() => runBatch(['not an op' as unknown])).toThrow()
    expect(() => runBatch([null as unknown])).toThrow()
  })
})

describe('runBatch — typed put (resourceType: ticket)', () => {
  const validTicket = {
    resourceType: 'ticket',
    uuid: 'ticket-1',
    id: 'OVH-001',
    title: 'My ticket',
    type: 'Execute' as const,
    status: { value: 'Draft' },
    backlog: false,
    description: '',
  }

  it('a valid ticket put is stored and retrievable', () => {
    runBatch([{ put: validTicket }])
    // `resourceType` is the IPC routing discriminator — Zod strips it before
    // storage, so only the clean TicketData shape is persisted.
    const { resourceType: _r, ...stored } = validTicket
    expect(runBatch([{ get: 'ticket-1' }])).toEqual([stored])
  })

  it('a ticket put with a missing required field throws (Zod)', () => {
    const { title: _omit, ...noTitle } = validTicket
    expect(() =>
      runBatch([{ put: noTitle as unknown as typeof validTicket }]),
    ).toThrow()
  })

  it('a ticket put with an invalid type enum value throws (Zod)', () => {
    expect(() =>
      runBatch([{ put: { ...validTicket, type: 'INVALID' } }]),
    ).toThrow()
  })

  it('a ticket put with a missing status.value throws (Zod)', () => {
    expect(() =>
      runBatch([{ put: { ...validTicket, status: {} } }]),
    ).toThrow()
  })

  it('a generic put without resourceType bypasses validation and is stored as-is', () => {
    const generic = { uuid: 'generic-1', anything: true }
    runBatch([{ put: generic }])
    expect(runBatch([{ get: 'generic-1' }])).toEqual([generic])
  })

  it('an unknown resourceType bypasses validation and is stored as-is', () => {
    const note = { uuid: 'note-1', resourceType: 'note', body: 'hello' }
    runBatch([{ put: note }])
    expect(runBatch([{ get: 'note-1' }])).toEqual([note])
  })

  it('a failed ticket validation rolls back the whole batch', () => {
    const invalid = { ...validTicket, uuid: 'ticket-2', type: 'BAD' }
    expect(() =>
      runBatch([
        { put: validTicket },
        { put: invalid as unknown as typeof validTicket },
      ]),
    ).toThrow()
    expect(runBatch([{ get: 'ticket-1' }])).toEqual([null])
  })
})
