import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getTicketStore, useTickets } from '@/lib/ticketStore'
import { Badge } from '@/components/ui/badge'

export function TicketNode({ id, data }: NodeProps) {
  // Subscribe to the ticket list so node content stays fresh when a ticket's
  // title/status changes or it gets replaced (e.g. type change).
  useTickets()
  const ticket = getTicketStore().getByUuid(id)
  // Arrives through node data because xyflow constructs nodes itself — props
  // cannot be handed down from the view that owns navigation.
  const onOpen = (data as { onOpen?: (uuid: string) => void } | undefined)?.onOpen

  if (!ticket) {
    return (
      <div className="rounded-lg border bg-card shadow-sm px-3 py-2 w-44 opacity-50">
        <span className="text-xs text-muted-foreground font-mono">Unknown</span>
      </div>
    )
  }

  return (
    <div
      className="rounded-lg border bg-card shadow-sm px-3 py-2 w-44 select-none cursor-pointer"
      // Double-click, not single: a single click selects the node and starts a
      // drag, which is how you arrange a canvas. Opening on it would make the
      // graph unusable as a graph.
      onDoubleClick={() => onOpen?.(id)}
      title={onOpen ? 'Double-click to open' : undefined}
    >
      <Handle id="left"   type="source" position={Position.Left}   className="!bg-border" />
      <Handle id="right"  type="source" position={Position.Right}  className="!bg-border" />
      <Handle id="top"    type="source" position={Position.Top}    className="!bg-border" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="!bg-border" />

      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs font-mono text-muted-foreground">{ticket.id}</span>
        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{ticket.type}</Badge>
      </div>
      <p className="text-sm font-medium leading-tight truncate">{ticket.title}</p>
      <div className="mt-1">
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{ticket.status.value}</Badge>
      </div>
    </div>
  )
}
