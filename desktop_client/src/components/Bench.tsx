import { useEffect, useState } from 'react'
import { Pin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PinButton } from '@/components/PinButton'
import { relationsClient } from '@/lib/relationsClient'
import { getTicketStore, useBench, MAX_BENCH_TICKETS } from '@/lib/ticketStore'
import type { Ticket } from '@/shared/types'
import type { TicketRelation } from '@/types/electron'
import { cn } from '@/lib/utils'

interface BenchProps {
  onOpenTicket: (uuid: string) => void
}

/** The shared "live" status across all three ticket types. */
function isActive(ticket: Ticket): boolean {
  return ticket.status.value === 'In Progress'
}

function StatusLine({ ticket }: { ticket: Ticket }) {
  if (isActive(ticket)) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-foreground">
        <span className="size-1.5 rounded-full bg-copper shadow-[0_0_6px_var(--color-copper)]" />
        {ticket.status.value}
      </span>
    )
  }
  return <span className="text-xs text-muted-foreground">{ticket.status.value}</span>
}

/** A secondary-tier relation line: id, title, status. Blocked-by reads heavier. */
function RelatedLine({
  ticket, label, warn, onOpen,
}: { ticket: Ticket; label: string; warn?: boolean; onOpen: (uuid: string) => void }) {
  return (
    <button
      onClick={() => onOpen(ticket.uuid)}
      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-muted/50"
    >
      <span className={cn('shrink-0 uppercase tracking-wide', warn ? 'text-copper' : 'text-muted-foreground/60')}>
        {label}
      </span>
      <span className="shrink-0 font-mono text-muted-foreground/70">{ticket.id}</span>
      <span className={cn('flex-1 truncate', warn ? 'text-foreground/90' : 'text-muted-foreground')}>
        {ticket.title}
      </span>
      <span className="shrink-0 text-muted-foreground/60">{ticket.status.value}</span>
    </button>
  )
}

function BenchRow({ ticket, relations, onOpen }: {
  ticket: Ticket
  relations: TicketRelation[]
  onOpen: (uuid: string) => void
}) {
  const store = getTicketStore()

  const blockedBy = relations
    .filter((r) => r.type === 'blocked-by' && r.node_a === ticket.uuid)
    .map((r) => store.getByUuid(r.node_b))
    .filter((t): t is Ticket => t !== undefined)

  const blocking = relations
    .filter((r) => r.type === 'blocked-by' && r.node_b === ticket.uuid)
    .map((r) => store.getByUuid(r.node_a))
    .filter((t): t is Ticket => t !== undefined)

  const related = relations
    .filter((r) => r.type === 'relates-to' && (r.node_a === ticket.uuid || r.node_b === ticket.uuid))
    .map((r) => store.getByUuid(r.node_a === ticket.uuid ? r.node_b : r.node_a))
    .filter((t): t is Ticket => t !== undefined)

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <button onClick={() => onOpen(ticket.uuid)} className="text-left hover:underline">
            <h3 className="truncate text-lg font-semibold">{ticket.title}</h3>
          </button>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{ticket.id}</span>
            <Badge variant="outline">{ticket.type}</Badge>
            <StatusLine ticket={ticket} />
          </div>
        </div>
        <PinButton ticket={ticket} variant="icon" />
      </div>

      {(blockedBy.length > 0 || related.length > 0) && (
        <div className="flex flex-col">
          {blockedBy.map((t) => (
            <RelatedLine key={t.uuid} ticket={t} label="Blocked by" warn onOpen={onOpen} />
          ))}
          {related.map((t) => (
            <RelatedLine key={t.uuid} ticket={t} label="Related" onOpen={onOpen} />
          ))}
        </div>
      )}

      {blocking.length > 0 && (
        <p className="pl-1 text-[11px] uppercase tracking-wide text-muted-foreground/60">
          Blocks {blocking.map((t) => t.id).join(', ')}
        </p>
      )}
    </div>
  )
}

function EmptySlot() {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed p-4 text-xs text-muted-foreground/50">
      Open slot
    </div>
  )
}

function EmptyBench() {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-10 text-center">
      <Pin className="mb-1 size-5 text-muted-foreground/40" />
      <p className="text-sm font-medium">Nothing on the bench</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Open a ticket and hit Pin to put it here — up to {MAX_BENCH_TICKETS} at a time.
      </p>
    </div>
  )
}

/** "N of 4 pinned", plus a blocked count when any bench ticket is waiting on something. */
function BenchHeader({ pinnedCount, blockedCount }: { pinnedCount: number; blockedCount: number }) {
  const bits = [`${pinnedCount} of ${MAX_BENCH_TICKETS} pinned`]
  if (blockedCount > 0) bits.push(`${blockedCount} blocked`)

  return (
    <div className="mb-3">
      <h2 className="text-lg font-semibold">Bench</h2>
      <p className="text-xs text-muted-foreground">{bits.join(' · ')}</p>
    </div>
  )
}

/**
 * The bench: pinned tickets, capped at {@link MAX_BENCH_TICKETS}. This is
 * Home's whole "get back to work" surface — no phases, no progress bars, no
 * durations. What you're on, what's blocking it, what it blocks.
 */
export function Bench({ onOpenTicket }: BenchProps) {
  const bench = useBench()
  const [relations, setRelations] = useState<TicketRelation[]>([])

  useEffect(() => {
    let alive = true
    void relationsClient.listAll().then((rels) => { if (alive) setRelations(rels) })
    return () => { alive = false }
  }, [])

  const blockedCount = bench.filter((t) => (
    relations.some((r) => r.type === 'blocked-by' && r.node_a === t.uuid)
  )).length

  if (bench.length === 0) {
    return (
      <div>
        <BenchHeader pinnedCount={0} blockedCount={0} />
        <EmptyBench />
      </div>
    )
  }

  const openSlots = MAX_BENCH_TICKETS - bench.length

  return (
    <div>
      <BenchHeader pinnedCount={bench.length} blockedCount={blockedCount} />
      <div className="flex flex-col gap-3">
        {bench.map((ticket) => (
          <BenchRow key={ticket.uuid} ticket={ticket} relations={relations} onOpen={onOpenTicket} />
        ))}
        {Array.from({ length: openSlots }).map((_, i) => <EmptySlot key={i} />)}
      </div>
    </div>
  )
}
