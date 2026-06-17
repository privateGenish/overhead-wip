import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { runSql } from '../db/sqlite'

function assertString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`db:graph: ${name} must be a non-empty string.`)
  return v
}

function assertNumber(v: unknown, name: string): number {
  if (typeof v !== 'number') throw new Error(`db:graph: ${name} must be a number.`)
  return v
}

export function registerGraphAPI(): void {
  ipcMain.handle('db:graph', (_e, op: unknown, payload: unknown) => {
    if (typeof op !== 'string') throw new Error('db:graph: op must be a string.')
    if (typeof payload !== 'object' || payload === null) throw new Error('db:graph: payload must be an object.')

    const p = payload as Record<string, unknown>

    if (op === 'view:list') {
      return runSql('SELECT uuid, name, created_at FROM graph_views ORDER BY created_at ASC', [])
    }

    if (op === 'view:create') {
      const name = assertString(p.name, 'name')
      const uuid = randomUUID()
      const created_at = Date.now()
      runSql('INSERT INTO graph_views (uuid, name, created_at) VALUES (?, ?, ?)', [uuid, name, created_at])
      return { uuid, name, created_at }
    }

    if (op === 'view:rename') {
      const uuid = assertString(p.uuid, 'uuid')
      const name = assertString(p.name, 'name')
      runSql('UPDATE graph_views SET name = ? WHERE uuid = ?', [name, uuid])
      return
    }

    if (op === 'view:delete') {
      const uuid = assertString(p.uuid, 'uuid')
      runSql('DELETE FROM graph_views WHERE uuid = ?', [uuid])
      return
    }

    if (op === 'node:list') {
      const viewUuid = assertString(p.viewUuid, 'viewUuid')
      return runSql('SELECT ticket_uuid, x, y FROM graph_view_nodes WHERE view_uuid = ?', [viewUuid])
    }

    if (op === 'node:upsert') {
      const viewUuid   = assertString(p.viewUuid,   'viewUuid')
      const ticketUuid = assertString(p.ticketUuid, 'ticketUuid')
      const x          = assertNumber(p.x, 'x')
      const y          = assertNumber(p.y, 'y')
      runSql(
        `INSERT INTO graph_view_nodes (view_uuid, ticket_uuid, x, y)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(view_uuid, ticket_uuid) DO UPDATE SET x = excluded.x, y = excluded.y`,
        [viewUuid, ticketUuid, x, y],
      )
      return
    }

    if (op === 'node:remove') {
      const viewUuid   = assertString(p.viewUuid,   'viewUuid')
      const ticketUuid = assertString(p.ticketUuid, 'ticketUuid')
      runSql('DELETE FROM graph_view_nodes WHERE view_uuid = ? AND ticket_uuid = ?', [viewUuid, ticketUuid])
      return
    }

    if (op === 'edge:list') {
      const viewUuid = assertString(p.viewUuid, 'viewUuid')
      return runSql(
        'SELECT uuid, source_uuid, target_uuid, source_handle, target_handle FROM graph_view_edges WHERE view_uuid = ?',
        [viewUuid],
      )
    }

    if (op === 'edge:create') {
      const viewUuid     = assertString(p.viewUuid,    'viewUuid')
      const sourceUuid   = assertString(p.sourceUuid,  'sourceUuid')
      const targetUuid   = assertString(p.targetUuid,  'targetUuid')
      const sourceHandle = typeof p.sourceHandle === 'string' ? p.sourceHandle : null
      const targetHandle = typeof p.targetHandle === 'string' ? p.targetHandle : null
      const uuid = randomUUID()
      runSql(
        'INSERT INTO graph_view_edges (uuid, view_uuid, source_uuid, target_uuid, source_handle, target_handle) VALUES (?, ?, ?, ?, ?, ?)',
        [uuid, viewUuid, sourceUuid, targetUuid, sourceHandle, targetHandle],
      )
      return { uuid, source_uuid: sourceUuid, target_uuid: targetUuid, source_handle: sourceHandle, target_handle: targetHandle }
    }

    if (op === 'edge:remove') {
      const uuid = assertString(p.uuid, 'uuid')
      runSql('DELETE FROM graph_view_edges WHERE uuid = ?', [uuid])
      return
    }

    throw new Error(`db:graph: unknown op "${op as string}".`)
  })
}
