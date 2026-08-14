import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  ConnectionMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { graphClient } from '@/lib/graphClient'
import { relationsClient } from '@/lib/relationsClient'
import { useTickets, ticketStore } from '@/lib/ticketStore'
import { layoutCluster } from '@/lib/graphLayout'
import { TICKET_TYPES } from '@/shared/types/ticketOptions'
import type { GraphView, GraphViewEdge, TicketRelation } from '@/types/electron'
import { TicketNode } from '@/components/graph/TicketNode'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, ChevronDown, Pencil, Trash2 } from 'lucide-react'

const nodeTypes = { ticket: TicketNode }

// Grid bounds — nodes and viewport are constrained to this area.
const GRID_SIZE = 20
const GRID_EXTENT = 5000
const NODE_EXTENT: [[number, number], [number, number]] = [
  [-GRID_EXTENT, -GRID_EXTENT],
  [GRID_EXTENT, GRID_EXTENT],
]
const TRANSLATE_EXTENT: [[number, number], [number, number]] = [
  [-GRID_EXTENT - 200, -GRID_EXTENT - 200],
  [GRID_EXTENT + 200, GRID_EXTENT + 200],
]

// ---------------------------------------------------------------------------
// Edge helpers
// ---------------------------------------------------------------------------

/** Canonical (order-independent) key for a pair of node ids. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/** Visual/typed styling for an edge. Colors use the app's CSS tokens directly
 *  (the theme is oklch-based, so `hsl(var(--…))` would be invalid). */
function styleForRelation(rel: TicketRelation | null): Partial<Edge> {
  if (!rel) return { style: { stroke: 'var(--border)', strokeWidth: 1.5 } }
  if (rel.type === 'blocked-by') {
    return {
      style: { stroke: 'var(--destructive)', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--destructive)', width: 16, height: 16 },
    }
  }
  return { style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5, strokeDasharray: '6 4' } }
}

function visualEdge(e: GraphViewEdge): Edge {
  return {
    id: e.uuid,
    source: e.source_uuid,
    target: e.target_uuid,
    sourceHandle: e.source_handle ?? undefined,
    targetHandle: e.target_handle ?? undefined,
    data: { visualId: e.uuid },
    ...styleForRelation(null),
  }
}

/** Pick source/target handle ids based on relative node positions. */
function inferHandles(
  srcPos: { x: number; y: number },
  tgtPos: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  const dx = tgtPos.x - srcPos.x
  const dy = tgtPos.y - srcPos.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: 'right', targetHandle: 'left' }
      : { sourceHandle: 'left',  targetHandle: 'right' }
  }
  return dy >= 0
    ? { sourceHandle: 'bottom', targetHandle: 'top' }
    : { sourceHandle: 'top',    targetHandle: 'bottom' }
}

/** Derives the rendered edge for a relation. For blocked-by the arrow points
 *  blocker→blocked, so source = node_b (blocker), target = node_a (blocked). */
function typedEdge(
  r: TicketRelation,
  positions: Map<string, { x: number; y: number }>,
): Edge {
  const source = r.type === 'blocked-by' ? r.node_b : r.node_a
  const target = r.type === 'blocked-by' ? r.node_a : r.node_b
  const { sourceHandle, targetHandle } = inferHandles(
    positions.get(source) ?? { x: 0, y: 0 },
    positions.get(target) ?? { x: 0, y: 0 },
  )
  return {
    id: r.uuid,
    source,
    target,
    sourceHandle,
    targetHandle,
    data: { relationUuid: r.uuid, relationType: r.type },
    ...styleForRelation(r),
  }
}

// ---------------------------------------------------------------------------
// Inner canvas (needs ReactFlow context)
// ---------------------------------------------------------------------------

interface CanvasProps {
  viewUuid: string
  relations: TicketRelation[]
  refreshRelations: () => Promise<void>
  onNodeIdsChange: (ids: Set<string>) => void
}

function Canvas({ viewUuid, relations, refreshRelations, onNodeIdsChange }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const { screenToFlowPosition, getNodes } = useReactFlow()
  const activeTickets = useTickets()

  // Stable string signatures so membership-driven effects don't fire on every
  // position change during a drag.
  const nodeIdKey = useMemo(
    () => nodes.map((n) => n.id).sort().join('|'),
    [nodes],
  )
  const activeIdKey = useMemo(
    () => activeTickets.map((t) => t.uuid).sort().join('|'),
    [activeTickets],
  )

  // ---- Load nodes + visual edges from DB on mount / view change ----
  const [loadKey, setLoadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    async function load() {
      const [dbNodes, dbEdges] = await Promise.all([
        graphClient.listNodes(viewUuid),
        graphClient.listEdges(viewUuid),
      ])
      if (cancelled) return

      const active = new Set(ticketStore.getActiveSnapshot().map((t) => t.uuid))
      const flowNodes: Node[] = dbNodes
        .filter((n) => active.has(n.ticket_uuid))
        .map((n) => ({ id: n.ticket_uuid, type: 'ticket', position: { x: n.x, y: n.y }, data: {} }))

      const nodeSet = new Set(flowNodes.map((n) => n.id))
      const visualEdges = (dbEdges as GraphViewEdge[])
        .filter((e) => nodeSet.has(e.source_uuid) && nodeSet.has(e.target_uuid))
        .map(visualEdge)

      setNodes(flowNodes)
      setEdges(visualEdges)
    }
    void load()
    return () => { cancelled = true }
  }, [viewUuid, loadKey, setNodes, setEdges])

  // ---- Reload when bridge mutates graph data externally ----
  useEffect(() => {
    const unsub = window.db.onGraphUpdated?.(() => setLoadKey((k) => k + 1))
    return () => { unsub?.() }
  }, [])

  // ---- Drop archived/deleted tickets from the canvas live ----
  useEffect(() => {
    const active = new Set(activeTickets.map((t) => t.uuid))
    setNodes((prev) => {
      const kept = prev.filter((n) => active.has(n.id))
      return kept.length === prev.length ? prev : kept
    })
  }, [activeIdKey, activeTickets, setNodes])

  // ---- Report canvas node IDs to parent so sidebar can filter them out ----
  useEffect(() => {
    onNodeIdsChange(new Set(nodes.map((n) => n.id)))
  }, [nodeIdKey, nodes, onNodeIdsChange])

  // ---- Reconcile typed edges whenever relations or canvas membership change.
  // Single source of truth: `edges` state holds both visual edges (data.visualId)
  // and derived typed edges (data.relationUuid). Visual edges are preserved across
  // reconciles (keeping their selection); typed edges are rebuilt fresh. A visual
  // edge is dropped when its pair becomes a typed relation, or when an endpoint
  // leaves the canvas. ----
  useEffect(() => {
    const onCanvas = new Set(nodeIdKey ? nodeIdKey.split('|') : [])
    const positions = new Map(getNodes().map((n) => [n.id, n.position]))
    setEdges((prev) => {
      // Preserve connection ports from any existing edge covering the same pair —
      // this keeps handles stable across type changes (plain↔typed, relates-to↔blocked-by).
      // We track the previous source node so we can detect direction flips and swap handles
      // accordingly (relates-to canonically reorders node_a/node_b by UUID, which can flip
      // the rendered source/target even though the physical ports should stay the same).
      const prevByPair = new Map<string, { source: string; sourceHandle?: string; targetHandle?: string }>()
      for (const e of prev) {
        const key = pairKey(e.source, e.target)
        if (!prevByPair.has(key)) {
          prevByPair.set(key, {
            source: e.source,
            sourceHandle: e.sourceHandle ?? undefined,
            targetHandle: e.targetHandle ?? undefined,
          })
        }
      }

      const typed = relations
        .filter((r) => onCanvas.has(r.node_a) && onCanvas.has(r.node_b))
        .map((r) => {
          const edge = typedEdge(r, positions)
          const saved = prevByPair.get(pairKey(edge.source, edge.target))
          if (saved?.sourceHandle && saved?.targetHandle) {
            if (saved.source === edge.source) {
              // Same direction — reuse handles directly.
              return { ...edge, sourceHandle: saved.sourceHandle, targetHandle: saved.targetHandle }
            } else {
              // Direction flipped (e.g. canonical reorder) — swap so the same physical
              // ports on each node are preserved.
              return { ...edge, sourceHandle: saved.targetHandle, targetHandle: saved.sourceHandle }
            }
          }
          return edge
        })
      const typedPairs = new Set(typed.map((e) => pairKey(e.source, e.target)))
      const visualKept = prev.filter(
        (e) =>
          e.data?.visualId &&
          onCanvas.has(e.source) &&
          onCanvas.has(e.target) &&
          !typedPairs.has(pairKey(e.source, e.target)),
      )
      return [...visualKept, ...typed]
    })
  }, [relations, nodeIdKey, setEdges, getNodes])

  // ---- Node context menu ----
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const closeNodeMenu = () => setNodeMenu(null)

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    setNodeMenu({ nodeId: node.id, x: event.clientX, y: event.clientY })
  }, [])

  const removeNodeFromBoard = useCallback(async () => {
    if (!nodeMenu) return
    const { nodeId } = nodeMenu
    closeNodeMenu()
    try { await graphClient.removeNode(viewUuid, nodeId) } catch { /* */ }
    setNodes((nds) => nds.filter((n) => n.id !== nodeId))
  }, [nodeMenu, viewUuid, setNodes])

  // ---- Edge type menu ----
  const [edgeMenu, setEdgeMenu] = useState<{
    edgeId: string
    sourceId: string
    targetId: string
    sourceHandle?: string
    targetHandle?: string
    isTyped: boolean
    relationUuid?: string
    relationType?: string
    x: number
    y: number
  } | null>(null)
  const closeEdgeMenu = () => setEdgeMenu(null)

  // ---- Draw a new visual edge ----
  const onConnect = useCallback(
    async (connection: Connection) => {
      const { source, target } = connection
      if (!source || !target || source === target) return

      // A typed relation already represents this pair — leave it to derivation.
      const relationExists = relations.some(
        (r) => pairKey(r.node_a, r.node_b) === pairKey(source, target),
      )
      if (relationExists) return

      // Don't create a duplicate visual edge.
      const visualExists = edges.some(
        (e) => e.data?.visualId && pairKey(e.source, e.target) === pairKey(source, target),
      )
      if (visualExists) return

      try {
        const { sourceHandle, targetHandle } = connection
        const created = await graphClient.createEdge(
          viewUuid, source, target,
          sourceHandle ?? undefined,
          targetHandle ?? undefined,
        )
        setEdges((eds) => [...eds, visualEdge(created)])
      } catch { /* ignore */ }
    },
    [viewUuid, relations, edges, setEdges],
  )

  const deleteEdge = useCallback(async () => {
    if (!edgeMenu) return
    const { edgeId, isTyped, relationUuid } = edgeMenu
    closeEdgeMenu()
    if (isTyped && relationUuid) {
      try { await relationsClient.remove(relationUuid) } catch { /* */ }
      await refreshRelations()
    } else {
      try { await graphClient.removeEdge(edgeId) } catch { /* */ }
      setEdges((eds) => eds.filter((e) => e.id !== edgeId))
    }
  }, [edgeMenu, refreshRelations, setEdges])

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation()
    setEdgeMenu({
      edgeId: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      isTyped: Boolean(edge.data?.relationUuid),
      relationUuid: edge.data?.relationUuid as string | undefined,
      relationType: edge.data?.relationType as string | undefined,
      x: event.clientX,
      y: event.clientY,
    })
  }, [])

  const assignEdgeType = useCallback(
    async (kind: 'relates-to' | 'blocked-by' | 'plain') => {
      if (!edgeMenu) return
      const { edgeId, sourceId, targetId, isTyped, relationUuid, relationType } = edgeMenu
      try {
        if (kind === 'plain') {
          if (isTyped && relationUuid) {
            await relationsClient.remove(relationUuid)
            const { sourceHandle, targetHandle } = edgeMenu
            const created = await graphClient.createEdge(
              viewUuid, sourceId, targetId,
              sourceHandle, targetHandle,
            )
            setEdges((eds) => [...eds, visualEdge(created)])
          }
        } else if (kind === 'relates-to') {
          if (!isTyped) await graphClient.removeEdge(edgeId)
          else if (relationUuid && relationType !== 'relates-to') await relationsClient.remove(relationUuid)
          await relationsClient.relate(sourceId, targetId)
        } else {
          // blocked-by: drawn source = blocker, target = blocked.
          if (!isTyped) await graphClient.removeEdge(edgeId)
          else if (relationUuid) await relationsClient.remove(relationUuid)
          await relationsClient.blockBy(/*blocked*/ targetId, /*blocker*/ sourceId)
        }
      } catch { /* swallow duplicate / canonical-conflict errors */ }
      closeEdgeMenu()
      await refreshRelations()
    },
    [edgeMenu, viewUuid, setEdges, refreshRelations],
  )

  // ---- Delete edges (select + Backspace) ----
  const onEdgesDelete = useCallback(
    async (deleted: Edge[]) => {
      let touchedRelation = false
      for (const edge of deleted) {
        if (edge.data?.relationUuid) {
          touchedRelation = true
          try { await relationsClient.remove(edge.data.relationUuid as string) } catch { /* */ }
        } else if (edge.data?.visualId) {
          try { await graphClient.removeEdge(edge.data.visualId as string) } catch { /* */ }
        }
      }
      if (touchedRelation) await refreshRelations()
    },
    [refreshRelations],
  )

  // ---- Persist node position on drag stop ----
  const onNodeDragStop: OnNodeDrag = useCallback(
    async (_event, node) => {
      try { await graphClient.upsertNode(viewUuid, node.id, node.position.x, node.position.y) } catch { /* */ }
    },
    [viewUuid],
  )

  const onNodesDelete = useCallback(
    async (deleted: Node[]) => {
      for (const node of deleted) {
        try { await graphClient.removeNode(viewUuid, node.id) } catch { /* */ }
      }
    },
    [viewUuid],
  )

  // ---- Drag-and-drop from sidebar ----
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const existing = new Set(getNodes().map((n) => n.id))

      const singleUuid = e.dataTransfer.getData('application/ovh-ticket')
      if (singleUuid) {
        if (existing.has(singleUuid)) return // already on canvas — leave it put
        try {
          await graphClient.upsertNode(viewUuid, singleUuid, pos.x, pos.y)
          setNodes((nds) => [...nds, { id: singleUuid, type: 'ticket', position: pos, data: {} }])
        } catch { /* */ }
        return
      }

      const clusterJson = e.dataTransfer.getData('application/ovh-cluster')
      if (clusterJson) {
        const uuids = JSON.parse(clusterJson) as string[]
        // Only place members not already on the canvas; reuse existing positions.
        const newUuids = uuids.filter((uuid) => !existing.has(uuid))
        if (newUuids.length === 0) return
        const clusterRelations = relations.filter(
          (r) => uuids.includes(r.node_a) && uuids.includes(r.node_b),
        )
        const positions = layoutCluster(uuids, clusterRelations, pos)
        for (const uuid of newUuids) {
          const p = positions[uuid] ?? pos
          try { await graphClient.upsertNode(viewUuid, uuid, p.x, p.y) } catch { /* */ }
        }
        setNodes((nds) => [
          ...nds,
          ...newUuids.map((uuid) => ({ id: uuid, type: 'ticket' as const, position: positions[uuid] ?? pos, data: {} })),
        ])
      }
    },
    [viewUuid, relations, screenToFlowPosition, getNodes, setNodes],
  )

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
        onEdgesDelete={onEdgesDelete}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => { closeEdgeMenu(); closeNodeMenu() }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        connectionMode={ConnectionMode.Loose}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        snapToGrid
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        nodeExtent={NODE_EXTENT}
        translateExtent={TRANSLATE_EXTENT}
      >
        <Background gap={GRID_SIZE} />
        <Controls />
      </ReactFlow>

      {nodeMenu && (
        <div style={{ position: 'fixed', left: nodeMenu.x, top: nodeMenu.y, zIndex: 1000 }}>
          <div className="bg-popover border rounded-md shadow-md p-1 flex flex-col gap-0.5 min-w-36">
            <button className="text-sm px-2 py-1 rounded hover:bg-accent text-left text-destructive" onClick={() => void removeNodeFromBoard()}>
              Remove from board
            </button>
            <button className="text-sm px-2 py-1 rounded hover:bg-accent text-left text-muted-foreground" onClick={closeNodeMenu}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {edgeMenu && (
        <div style={{ position: 'fixed', left: edgeMenu.x, top: edgeMenu.y, zIndex: 1000 }}>
          <div className="bg-popover border rounded-md shadow-md p-1 flex flex-col gap-0.5 min-w-28">
            <button className="text-sm px-2 py-1 rounded hover:bg-accent text-left" onClick={() => void assignEdgeType('relates-to')}>
              Related
            </button>
            <button className="text-sm px-2 py-1 rounded hover:bg-accent text-left" onClick={() => void assignEdgeType('blocked-by')}>
              Blocks
            </button>
            <button className="text-sm px-2 py-1 rounded hover:bg-accent text-left" onClick={() => void assignEdgeType('plain')}>
              Plain
            </button>
            <hr className="my-0.5 border-border" />
            <button className="text-sm px-2 py-1 rounded hover:bg-accent text-left text-destructive" onClick={() => void deleteEdge()}>
              Delete
            </button>
            <button className="text-sm px-2 py-1 rounded hover:bg-accent text-left text-muted-foreground" onClick={closeEdgeMenu}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Tickets sidebar tab
// ---------------------------------------------------------------------------

function TicketsSidebar({ canvasNodeIds }: { canvasNodeIds: Set<string> }) {
  const tickets = useTickets()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set())

  const toggleType = (t: string) =>
    setTypeFilter((prev) => { const next = new Set(prev); next.has(t) ? next.delete(t) : next.add(t); return next })

  const q = search.toLowerCase()
  const filtered = tickets.filter((t) => {
    if (canvasNodeIds.has(t.uuid)) return false
    if (typeFilter.size > 0 && !typeFilter.has(t.type)) return false
    if (q && !t.title.toLowerCase().includes(q) && !t.id.toLowerCase().includes(q)) return false
    return true
  })

  return (
    <div className="flex flex-col gap-2 h-full">
      <Input
        placeholder="Search tickets…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-7 text-sm"
      />

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-1">
        {TICKET_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => toggleType(t)}
            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
              typeFilter.has(t)
                ? 'bg-foreground text-background border-foreground'
                : 'bg-transparent text-muted-foreground border-border hover:border-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1">
        {filtered.map((ticket) => (
          <div
            key={ticket.uuid}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/ovh-ticket', ticket.uuid)
              e.dataTransfer.effectAllowed = 'move'
            }}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-card hover:bg-accent cursor-grab text-sm"
          >
            <span className="font-mono text-xs text-muted-foreground shrink-0">{ticket.id}</span>
            <span className="truncate flex-1">{ticket.title}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">{ticket.type}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Graph root
// ---------------------------------------------------------------------------

export function Graph() {
  const [views, setViews] = useState<GraphView[]>([])
  const [activeViewUuid, setActiveViewUuid] = useState<string | null>(null)
  const [relations, setRelations] = useState<TicketRelation[]>([])
  const [canvasNodeIds, setCanvasNodeIds] = useState<Set<string>>(new Set())
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const refreshRelations = useCallback(async () => {
    setRelations(await relationsClient.listAll())
  }, [])

  // Bootstrap views (auto-create "View 1" on first ever visit) + initial relations.
  useEffect(() => {
    async function init() {
      let vs = await graphClient.listViews()
      if (vs.length === 0) vs = [await graphClient.createView('View 1')]
      setViews(vs)
      setActiveViewUuid((cur) => cur ?? vs[0].uuid)
      setRelations(await relationsClient.listAll())
    }
    void init()
  }, [])

  // Reload view list + relations when bridge mutates graph data externally.
  // Relations must refresh too: typed edges (blocked-by / relates-to) are derived
  // from this list, so an external relation write (e.g. from the CLI) won't draw
  // any edge until the relations here are reloaded.
  useEffect(() => {
    const unsub = window.db.onGraphUpdated?.(() => {
      void graphClient.listViews().then((vs) => {
        setViews(vs)
        setActiveViewUuid((cur) => {
          if (cur && vs.some((v) => v.uuid === cur)) return cur
          return vs[0]?.uuid ?? null
        })
      })
      void refreshRelations()
    })
    return () => { unsub?.() }
  }, [refreshRelations])

  async function createView() {
    const v = await graphClient.createView(`View ${views.length + 1}`)
    setViews((vs) => [...vs, v])
    setActiveViewUuid(v.uuid)
  }

  async function deleteView(uuid: string) {
    await graphClient.deleteView(uuid)
    setViews((vs) => {
      const remaining = vs.filter((v) => v.uuid !== uuid)
      setActiveViewUuid((cur) => (cur === uuid ? remaining[0]?.uuid ?? null : cur))
      return remaining
    })
  }

  async function commitRename(uuid: string) {
    const name = renameValue.trim()
    setRenameId(null)
    if (!name) return
    await graphClient.renameView(uuid, name)
    setViews((vs) => vs.map((v) => (v.uuid === uuid ? { ...v, name } : v)))
  }

  const activeView = views.find((v) => v.uuid === activeViewUuid)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* View tab bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b bg-background shrink-0">
        <div className="flex items-center gap-1 flex-1 overflow-x-auto">
          {views.map((v) => (
            <div
              key={v.uuid}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-sm shrink-0 ${
                v.uuid === activeViewUuid
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {renameId === v.uuid ? (
                <Input
                  className="h-5 text-sm px-1 w-28"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename(v.uuid)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename(v.uuid)
                    if (e.key === 'Escape') setRenameId(null)
                  }}
                />
              ) : (
                <button className="cursor-pointer" onClick={() => setActiveViewUuid(v.uuid)}>
                  {v.name}
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button className="p-0.5 rounded hover:bg-accent text-muted-foreground">
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  }
                />
                <DropdownMenuContent align="start" className="w-32">
                  <DropdownMenuItem onClick={() => { setRenameId(v.uuid); setRenameValue(v.name) }}>
                    <Pencil className="h-3.5 w-3.5" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => void deleteView(v.uuid)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => void createView()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Canvas + sidebar */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 relative">
          {activeView ? (
            <ReactFlowProvider>
              <Canvas key={activeView.uuid} viewUuid={activeView.uuid} relations={relations} refreshRelations={refreshRelations} onNodeIdsChange={setCanvasNodeIds} />
            </ReactFlowProvider>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading…</div>
          )}
        </div>

        <div className="w-56 border-l bg-background flex flex-col shrink-0 overflow-hidden">
          <div className="flex-1 overflow-hidden p-2">
            <TicketsSidebar canvasNodeIds={canvasNodeIds} />
          </div>
        </div>
      </div>
    </div>
  )
}
