import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { runSql } from '../db/sqlite'

type RelationType = 'relates-to' | 'blocked-by'

interface AddPayload  { type: RelationType; node_a: string; node_b: string }
interface RemovePayload { uuid: string }
interface ListPayload  { ticketUuid: string }

function assertString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`db:relation: ${name} must be a non-empty string.`)
  return v
}

/**
 * Executes a relations operation and returns its result.
 *
 * Shared dispatch for both doors: the renderer's raw `db:relation` channel
 * (registerRelationsAPI) and the governed bridge (which calls this directly,
 * post-gate). Reaching this function means the caller is already authorized —
 * it performs no auth itself, only payload validation.
 */
export function runRelationOp(op: unknown, payload: unknown): unknown {
  {
    if (typeof op !== 'string') throw new Error('db:relation: op must be a string.')
    if (typeof payload !== 'object' || payload === null) throw new Error('db:relation: payload must be an object.')

    if (op === 'add') {
      const { type, node_a, node_b } = payload as AddPayload
      assertString(type, 'type')
      assertString(node_a, 'node_a')
      assertString(node_b, 'node_b')
      if (type !== 'relates-to' && type !== 'blocked-by') {
        throw new Error(`db:relation: unknown type "${type}".`)
      }
      if (node_a === node_b) throw new Error('db:relation: a ticket cannot relate to itself.')

      // Enforce canonical ordering for symmetric relations
      const [a, b] = type === 'relates-to' && node_a > node_b
        ? [node_b, node_a]
        : [node_a, node_b]

      const uuid = randomUUID()
      runSql(
        'INSERT INTO ticket_relations (uuid, node_a, node_b, type) VALUES (?, ?, ?, ?)',
        [uuid, a, b, type],
      )
      return { uuid, node_a: a, node_b: b, type }
    }

    if (op === 'remove') {
      const { uuid } = payload as RemovePayload
      assertString(uuid, 'uuid')
      runSql('DELETE FROM ticket_relations WHERE uuid = ?', [uuid])
      return
    }

    if (op === 'list') {
      const { ticketUuid } = payload as ListPayload
      assertString(ticketUuid, 'ticketUuid')
      return runSql(
        'SELECT uuid, node_a, node_b, type FROM ticket_relations WHERE node_a = ? OR node_b = ?',
        [ticketUuid, ticketUuid],
      )
    }

    if (op === 'listAll') {
      return runSql('SELECT uuid, node_a, node_b, type FROM ticket_relations', [])
    }

    throw new Error(`db:relation: unknown op "${op as string}".`)
  }
}

export function registerRelationsAPI(): void {
  ipcMain.handle('db:relation', (_e, op: unknown, payload: unknown) => runRelationOp(op, payload))
}
