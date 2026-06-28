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

export interface EnrichedNode {
  ticket_uuid: string
  id: string
  title: string
  type: string
  status: string
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

export interface BridgeViewMap {
  view: BridgeView
  nodes: EnrichedNode[]
  edges: BridgeViewEdge[]
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

/** The four connection ports a TicketNode exposes (see TicketNode.tsx). */
const handleSchema = z.enum(['left', 'right', 'top', 'bottom'])

const createEdgeSchema = z.object({
  viewUuid: z.string().min(1),
  sourceUuid: z.string().min(1),
  targetUuid: z.string().min(1),
  sourceHandle: handleSchema.optional(),
  targetHandle: handleSchema.optional(),
})

const edgeUuidSchema = z.object({
  uuid: z.string().min(1),
})

const coordSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const deltaSchema = z.object({
  dx: z.number(),
  dy: z.number(),
})

const getNodeSchema = z.object({
  viewUuid: z.string().min(1),
  ticketUuid: z.string().min(1),
})

const moveNodeSchema = z.object({
  viewUuid: z.string().min(1),
  ticketUuid: z.string().min(1),
  ...coordSchema.shape,
})

const nudgeNodeSchema = z.object({
  viewUuid: z.string().min(1),
  ticketUuid: z.string().min(1),
  ...deltaSchema.shape,
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

export function listViewNodes(input: unknown): EnrichedNode[] {
  const { viewUuid } = listNodesSchema.parse(input)
  return runSql(
    `SELECT n.ticket_uuid, t.id, t.title, t.type, t.status, n.x, n.y
     FROM graph_view_nodes n
     JOIN tickets t ON t.uuid = n.ticket_uuid
     WHERE n.view_uuid = ?
     ORDER BY t.created_at ASC`,
    [viewUuid],
  ) as EnrichedNode[]
}

export function getViewNode(input: unknown): EnrichedNode | null {
  const { viewUuid, ticketUuid } = getNodeSchema.parse(input)
  const rows = runSql(
    `SELECT n.ticket_uuid, t.id, t.title, t.type, t.status, n.x, n.y
     FROM graph_view_nodes n
     JOIN tickets t ON t.uuid = n.ticket_uuid
     WHERE n.view_uuid = ? AND n.ticket_uuid = ?`,
    [viewUuid, ticketUuid],
  ) as EnrichedNode[]
  return rows[0] ?? null
}

export function getViewMap(input: unknown): BridgeViewMap {
  const { viewUuid } = listNodesSchema.parse(input)
  const viewRows = runSql('SELECT uuid, name, created_at FROM graph_views WHERE uuid = ?', [viewUuid]) as BridgeView[]
  if (!viewRows[0]) throw new Error(`bridge: view "${viewUuid}" not found.`)
  const nodes = runSql(
    `SELECT n.ticket_uuid, t.id, t.title, t.type, t.status, n.x, n.y
     FROM graph_view_nodes n
     JOIN tickets t ON t.uuid = n.ticket_uuid
     WHERE n.view_uuid = ?
     ORDER BY t.created_at ASC`,
    [viewUuid],
  ) as EnrichedNode[]
  const edges = runSql(
    'SELECT uuid, source_uuid, target_uuid, source_handle, target_handle FROM graph_view_edges WHERE view_uuid = ?',
    [viewUuid],
  ) as BridgeViewEdge[]
  return { view: viewRows[0], nodes, edges }
}

export function moveViewNode(input: unknown): EnrichedNode {
  const { viewUuid, ticketUuid, x, y } = moveNodeSchema.parse(input)
  const existing = getViewNode({ viewUuid, ticketUuid })
  if (!existing) throw new Error(`bridge: node "${ticketUuid}" not found in view "${viewUuid}".`)
  runSql(
    'UPDATE graph_view_nodes SET x = ?, y = ? WHERE view_uuid = ? AND ticket_uuid = ?',
    [x, y, viewUuid, ticketUuid],
  )
  notifyGraphUpdated()
  return { ...existing, x, y }
}

export function nudgeViewNode(input: unknown): EnrichedNode {
  const { viewUuid, ticketUuid, dx, dy } = nudgeNodeSchema.parse(input)
  const existing = getViewNode({ viewUuid, ticketUuid })
  if (!existing) throw new Error(`bridge: node "${ticketUuid}" not found in view "${viewUuid}".`)
  const newX = existing.x + dx
  const newY = existing.y + dy
  runSql(
    'UPDATE graph_view_nodes SET x = ?, y = ? WHERE view_uuid = ? AND ticket_uuid = ?',
    [newX, newY, viewUuid, ticketUuid],
  )
  notifyGraphUpdated()
  return { ...existing, x: newX, y: newY }
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
