/**
 * Governed graph-view methods for the bridge (Door 2).
 *
 * Lets external callers (LLM, CLI, MCP) create/manage graph views and place
 * tickets on the canvas. Each method validates its own input with Zod, then
 * routes through runSql so the same DB path is used as the renderer's IPC.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { runSql } from '../db/sqlite'
import { notifyGraphUpdated } from '../ipc/notify'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BridgeView {
  uuid: string
  name: string
  created_at: number
}

export interface BridgeViewNode {
  ticket_uuid: string
  x: number
  y: number
}

export interface BridgeViewEdge {
  uuid: string
  source_uuid: string
  target_uuid: string
  source_handle: string | null
  target_handle: string | null
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const createViewSchema = z.object({
  name: z.string().min(1),
})

const viewUuidSchema = z.object({
  uuid: z.string().min(1),
})

const renameViewSchema = z.object({
  uuid: z.string().min(1),
  name: z.string().min(1),
})

const listNodesSchema = z.object({
  viewUuid: z.string().min(1),
})

const addNodeSchema = z.object({
  viewUuid: z.string().min(1),
  ticketUuid: z.string().min(1),
  x: z.number(),
  y: z.number(),
})

const removeNodeSchema = z.object({
  viewUuid: z.string().min(1),
  ticketUuid: z.string().min(1),
})

const listEdgesSchema = z.object({
  viewUuid: z.string().min(1),
})

const createEdgeSchema = z.object({
  viewUuid: z.string().min(1),
  sourceUuid: z.string().min(1),
  targetUuid: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
})

const edgeUuidSchema = z.object({
  uuid: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

export function listViews(): BridgeView[] {
  return runSql(
    'SELECT uuid, name, created_at FROM graph_views ORDER BY created_at ASC',
    [],
  ) as BridgeView[]
}

export function createView(input: unknown): BridgeView {
  const { name } = createViewSchema.parse(input)
  const uuid = randomUUID()
  const created_at = Date.now()
  runSql(
    'INSERT INTO graph_views (uuid, name, created_at) VALUES (?, ?, ?)',
    [uuid, name, created_at],
  )
  notifyGraphUpdated()
  return { uuid, name, created_at }
}

export function renameView(input: unknown): BridgeView {
  const { uuid, name } = renameViewSchema.parse(input)
  const rows = runSql('SELECT uuid, name, created_at FROM graph_views WHERE uuid = ?', [uuid]) as BridgeView[]
  if (!rows[0]) throw new Error(`bridge: view "${uuid}" not found.`)
  runSql('UPDATE graph_views SET name = ? WHERE uuid = ?', [name, uuid])
  notifyGraphUpdated()
  return { ...rows[0], name }
}

export function deleteView(input: unknown): { uuid: string } {
  const { uuid } = viewUuidSchema.parse(input)
  runSql('DELETE FROM graph_views WHERE uuid = ?', [uuid])
  notifyGraphUpdated()
  return { uuid }
}

export function listViewNodes(input: unknown): BridgeViewNode[] {
  const { viewUuid } = listNodesSchema.parse(input)
  return runSql(
    'SELECT ticket_uuid, x, y FROM graph_view_nodes WHERE view_uuid = ?',
    [viewUuid],
  ) as BridgeViewNode[]
}

export function addViewNode(input: unknown): void {
  const { viewUuid, ticketUuid, x, y } = addNodeSchema.parse(input)
  runSql(
    `INSERT INTO graph_view_nodes (view_uuid, ticket_uuid, x, y)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(view_uuid, ticket_uuid) DO UPDATE SET x = excluded.x, y = excluded.y`,
    [viewUuid, ticketUuid, x, y],
  )
  notifyGraphUpdated()
}

export function removeViewNode(input: unknown): void {
  const { viewUuid, ticketUuid } = removeNodeSchema.parse(input)
  runSql(
    'DELETE FROM graph_view_nodes WHERE view_uuid = ? AND ticket_uuid = ?',
    [viewUuid, ticketUuid],
  )
  notifyGraphUpdated()
}

export function listViewEdges(input: unknown): BridgeViewEdge[] {
  const { viewUuid } = listEdgesSchema.parse(input)
  return runSql(
    'SELECT uuid, source_uuid, target_uuid, source_handle, target_handle FROM graph_view_edges WHERE view_uuid = ?',
    [viewUuid],
  ) as BridgeViewEdge[]
}

export function createViewEdge(input: unknown): BridgeViewEdge {
  const { viewUuid, sourceUuid, targetUuid, sourceHandle, targetHandle } = createEdgeSchema.parse(input)
  const uuid = randomUUID()
  const sh = sourceHandle ?? null
  const th = targetHandle ?? null
  runSql(
    'INSERT INTO graph_view_edges (uuid, view_uuid, source_uuid, target_uuid, source_handle, target_handle) VALUES (?, ?, ?, ?, ?, ?)',
    [uuid, viewUuid, sourceUuid, targetUuid, sh, th],
  )
  notifyGraphUpdated()
  return { uuid, source_uuid: sourceUuid, target_uuid: targetUuid, source_handle: sh, target_handle: th }
}

export function removeViewEdge(input: unknown): { uuid: string } {
  const { uuid } = edgeUuidSchema.parse(input)
  runSql('DELETE FROM graph_view_edges WHERE uuid = ?', [uuid])
  notifyGraphUpdated()
  return { uuid }
}
