/**
 * Renderer-only surface for pending tickets (Door 1). `list`/`hasAny` are
 * plain reads; `approve`/`reject` are guarded, multi-step operations, which
 * is why this is an op-dispatch channel (like `db:relation`/`db:graph`)
 * rather than a raw-SQL passthrough (like `db:note`).
 *
 * There is no equivalent on the bridge (Door 2) — approving or rejecting a
 * proposal is a human action, full stop. Only `proposeTicket` reaches this
 * table from outside the app.
 */

import { ipcMain } from 'electron'
import { runSql } from '../db/sqlite'
import { createTicket, type BridgeTicket } from '../bridge/tickets'
import { notifyPendingUpdated } from './notify'

export interface PendingTicketRow {
  uuid: string
  title: string
  type: 'Explore' | 'Feature' | 'Execute'
  description: string
  created_at: number
}

function readRow(uuid: string): PendingTicketRow | null {
  const rows = runSql('SELECT * FROM pending_tickets WHERE uuid = ? LIMIT 1', [uuid]) as PendingTicketRow[]
  return rows[0] ?? null
}

/** Shared dispatch for list/approve/reject — renderer-only, unreachable from the bridge. */
export function runPendingOp(op: unknown, payload: unknown): unknown {
  if (typeof op !== 'string') throw new Error('db:pending: op must be a string.')
  const p = (payload ?? {}) as Record<string, unknown>

  if (op === 'list') {
    return runSql('SELECT * FROM pending_tickets ORDER BY created_at ASC', []) as PendingTicketRow[]
  }

  if (op === 'hasAny') {
    return (runSql('SELECT 1 FROM pending_tickets LIMIT 1', []) as unknown[]).length > 0
  }

  if (op === 'approve') {
    const uuid = p.uuid as string
    const row = readRow(uuid)
    if (!row) throw new Error(`db:pending: pending ticket "${uuid}" not found.`)
    // Promotion via the exact createTicket() path already exported from
    // bridge/tickets.ts — mints uuid+id, sets initial status per type, fires
    // vault mirror + mentions sync + notifyTicketUpdated identically to an
    // agent-created ticket. Deliberate ipc→bridge import (the first in this
    // codebase — every other IPC handler only reaches into ipc/db modules):
    // createTicket is a stable, already-public function, not bridge-internal
    // state, so importing it here is a smaller and safer diff than
    // duplicating its id-minting logic at the IPC layer.
    const ticket: BridgeTicket = createTicket({
      title: row.title,
      type: row.type,
      description: row.description,
    })
    runSql('DELETE FROM pending_tickets WHERE uuid = ?', [uuid])
    notifyPendingUpdated()
    return ticket
  }

  if (op === 'reject') {
    const uuid = p.uuid as string
    runSql('DELETE FROM pending_tickets WHERE uuid = ?', [uuid])
    notifyPendingUpdated()
    return { uuid }
  }

  throw new Error(`db:pending: unknown op "${op}".`)
}

export function registerPendingAPI(): void {
  ipcMain.handle('db:pending', (_e, op: unknown, payload: unknown) => runPendingOp(op, payload))
}
