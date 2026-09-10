/**
 * The pending-ticket approve/reject boundary, driven through real SQLite and
 * a real vault directory — the thing worth proving isn't the SQL, it's that
 * a proposal leaves no trace until approved, and that approval promotes it
 * through the exact same path a normal ticket takes (vault file included).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { initSqlite, runSql, __resetSqliteForTests } from '../db/sqlite'
import { initVault, __resetVaultForTests } from '../vault/vaultManager'
import { registerPendingAPI } from './pendingAPI'
import type { PendingTicketRow } from './pendingAPI'
import type { BridgeTicket } from '../bridge/tickets'

let vaultDir: string

function invoke(op: string, payload?: unknown): unknown {
  return handlers.get('db:pending')!(null, op, payload)
}

function propose(title: string, type: string, description = ''): PendingTicketRow {
  const uuid = `pending-${title}`
  runSql(
    'INSERT INTO pending_tickets (uuid, title, type, description, created_at) VALUES (?, ?, ?, ?, ?)',
    [uuid, title, type, description, Date.now()],
  )
  return { uuid, title, type: type as PendingTicketRow['type'], description, created_at: Date.now() }
}

function vaultFileFor(id: string): string {
  return path.join(vaultDir, `${id}.md`)
}

beforeEach(() => {
  __resetSqliteForTests()
  initSqlite(':memory:')
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overhead-pending-'))
  initVault(vaultDir)
  handlers.clear()
  registerPendingAPI()
})

afterEach(() => {
  __resetSqliteForTests()
  __resetVaultForTests()
})

describe('db:pending — list / hasAny', () => {
  it('lists proposals in FIFO order (oldest first)', () => {
    runSql('INSERT INTO pending_tickets (uuid, title, type, description, created_at) VALUES (?, ?, ?, ?, ?)',
      ['p1', 'first', 'Execute', '', 100])
    runSql('INSERT INTO pending_tickets (uuid, title, type, description, created_at) VALUES (?, ?, ?, ?, ?)',
      ['p2', 'second', 'Execute', '', 200])

    const rows = invoke('list') as PendingTicketRow[]
    expect(rows.map((r) => r.title)).toEqual(['first', 'second'])
  })

  it('hasAny is false on an empty table, true after a proposal', () => {
    expect(invoke('hasAny')).toBe(false)
    propose('draft', 'Execute')
    expect(invoke('hasAny')).toBe(true)
  })
})

describe('db:pending — approve', () => {
  it('throws for an unknown uuid', () => {
    expect(() => invoke('approve', { uuid: 'nope' })).toThrow('not found')
  })

  it('mints a real ticket with the correct id and initial status per type, and removes the pending row', () => {
    const draft = propose('Investigate slow query', 'Explore', 'Backlog page is slow')

    const ticket = invoke('approve', { uuid: draft.uuid }) as BridgeTicket
    expect(ticket.id).toBe('OVH-001')
    expect(ticket.uuid).not.toBe(draft.uuid) // a fresh identity, not the draft's
    expect(ticket.title).toBe('Investigate slow query')
    expect(ticket.type).toBe('Explore')
    expect(ticket.status).toBe('Open') // Explore's initial status
    expect(ticket.description).toBe('Backlog page is slow')

    expect((invoke('list') as PendingTicketRow[])).toHaveLength(0)
  })

  it('writes a vault file only after approval, not before', () => {
    const draft = propose('needs a file', 'Execute')
    expect(fs.existsSync(vaultFileFor('OVH-001'))).toBe(false) // proposing alone writes nothing

    invoke('approve', { uuid: draft.uuid })
    expect(fs.existsSync(vaultFileFor('OVH-001'))).toBe(true)
  })
})

describe('db:pending — reject', () => {
  it('deletes the row and leaves the tickets table untouched', () => {
    const draft = propose('unwanted', 'Feature')
    const result = invoke('reject', { uuid: draft.uuid }) as { uuid: string }
    expect(result.uuid).toBe(draft.uuid)
    expect((invoke('list') as PendingTicketRow[])).toHaveLength(0)
    expect((runSql('SELECT * FROM tickets') as unknown[])).toHaveLength(0)
  })

  it('does not throw for an unknown uuid', () => {
    expect(() => invoke('reject', { uuid: 'nope' })).not.toThrow()
  })
})

describe('db:pending — validation', () => {
  it('rejects an unknown op', () => {
    expect(() => invoke('explode')).toThrow('unknown op')
  })
})
