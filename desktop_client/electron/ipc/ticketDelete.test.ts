/**
 * Risk cover for permanent deletion.
 *
 * Deleting a ticket is now reachable from the UI (the Archived view), so the
 * rows hanging off it have to go with it. Relations, history and graph rows
 * carry `ON DELETE CASCADE`; `mentions` only cascades on the side that points
 * *at* the ticket, and the side that points *out of* it has no foreign key to
 * cascade through. This drives real SQLite so the answer comes from the
 * database rather than from reading the schema.
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
}))

import { initSqlite, runSql, __resetSqliteForTests } from '../db/sqlite'
import { registerTicketAPI } from './ticketAPI'

const DOOMED = 'ticket-doomed'
const SURVIVOR = 'ticket-survivor'

let tmp: string

function insertTicket(uuid: string, id: string): void {
  runSql(
    `INSERT INTO tickets (uuid, id, title, type, status, backlog, pinned, description, archived, created_at, updated_at)
     VALUES (?, ?, 'Archived ticket', 'Execute', 'Draft', 0, 0, 'body', 1, 1000, 1000)`,
    [uuid, id],
  )
}

/** Deletes through the shared write path — the one both doors use. */
function deleteTicket(uuid: string): void {
  handlers.get('db:ticket')!(null, 'DELETE FROM tickets WHERE uuid = ?', [uuid])
}

function count(table: string): number {
  return (runSql(`SELECT * FROM ${table}`) as unknown[]).length
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-delete-'))
  __resetSqliteForTests()
  initSqlite(path.join(tmp, 'overhead.db'))
  handlers.clear()
  registerTicketAPI()

  insertTicket(DOOMED, 'OVH-001')
  insertTicket(SURVIVOR, 'OVH-002')

  runSql(
    `INSERT INTO ticket_relations (uuid, node_a, node_b, type) VALUES ('r1', ?, ?, 'blocked-by')`,
    [DOOMED, SURVIVOR],
  )
  runSql(
    `INSERT INTO ticket_history (ticket_uuid, ts, description, hash) VALUES (?, 1, 'v1', 'h1')`,
    [DOOMED],
  )
  runSql(`INSERT INTO graph_views (uuid, name, created_at) VALUES ('v1', 'View', 1)`)
  runSql(
    `INSERT INTO graph_view_nodes (view_uuid, ticket_uuid, x, y) VALUES ('v1', ?, 0, 0)`,
    [DOOMED],
  )
  runSql(
    `INSERT INTO graph_view_edges (uuid, view_uuid, source_uuid, target_uuid) VALUES ('e1', 'v1', ?, ?)`,
    [DOOMED, SURVIVOR],
  )
  // Both directions: the doomed ticket mentions another, and is mentioned.
  runSql(
    `INSERT INTO mentions (source_type, source_uuid, target_uuid) VALUES ('ticket', ?, ?)`,
    [DOOMED, SURVIVOR],
  )
  runSql(
    `INSERT INTO mentions (source_type, source_uuid, target_uuid) VALUES ('ticket', ?, ?)`,
    [SURVIVOR, DOOMED],
  )
  runSql(
    `INSERT INTO mentions (source_type, source_uuid, target_uuid) VALUES ('note', 'note-1', ?)`,
    [DOOMED],
  )
})

afterEach(() => {
  __resetSqliteForTests()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('deleting a ticket', () => {
  it('clears its relations, history and graph rows', () => {
    deleteTicket(DOOMED)

    expect(count('tickets')).toBe(1)
    expect(count('ticket_relations')).toBe(0)
    expect(count('ticket_history')).toBe(0)
    expect(count('graph_view_nodes')).toBe(0)
    expect(count('graph_view_edges')).toBe(0)
    // The graph view itself is not the ticket's to take down.
    expect(count('graph_views')).toBe(1)
  })

  it('clears its mentions in both directions', () => {
    deleteTicket(DOOMED)

    // Nothing may point at a ticket that no longer exists, and nothing may
    // point out of one either.
    expect(count('mentions')).toBe(0)
  })

  it('leaves the surviving ticket untouched', () => {
    runSql(
      `INSERT INTO mentions (source_type, source_uuid, target_uuid) VALUES ('note', 'note-2', ?)`,
      [SURVIVOR],
    )

    deleteTicket(DOOMED)

    const rows = runSql('SELECT source_uuid FROM mentions') as { source_uuid: string }[]
    expect(rows).toEqual([{ source_uuid: 'note-2' }])
  })

  it('clears every ticket mention when all tickets are deleted', () => {
    handlers.get('db:ticket')!(null, 'DELETE FROM tickets', [])

    expect(count('tickets')).toBe(0)
    expect(count('mentions')).toBe(0)
  })
})
