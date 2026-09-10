import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { pendingClient, type PendingTicket } from '@/lib/pendingClient'
import { readableError } from '@/lib/ipcError'

interface PendingCardProps {
  ticket: PendingTicket
  onApprove: () => void
  onReject: () => void
}

function PendingCard({ ticket, onApprove, onReject }: PendingCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">{ticket.title}</h3>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline">{ticket.type}</Badge>
          </div>
          {ticket.description && (
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{ticket.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={onReject}>Reject</Button>
          <Button size="sm" onClick={onApprove}>Approve</Button>
        </div>
      </div>
    </div>
  )
}

/**
 * "Pending (N)" — a collapsible tray of AI-proposed ticket drafts, above the
 * Bench on Home. One card, one decision: approve promotes the draft through
 * the normal ticket-creation path; reject deletes the row outright, no
 * confirmation — there is nothing at stake to protect, by design. No bulk
 * actions, no edit-in-place. Renders nothing when there's nothing pending —
 * this is a tray for decisions waiting on you, not a permanent fixture.
 */
export function PendingTray() {
  const [pending, setPending] = useState<PendingTicket[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const refetch = useCallback(() => {
    void pendingClient.list()
      .then((rows) => setPending(rows))
      .catch((err: unknown) => { setError(readableError(err)); setPending([]) })
  }, [])

  useEffect(() => {
    let alive = true
    void pendingClient.list()
      .then((rows) => { if (alive) setPending(rows) })
      .catch((err: unknown) => { if (alive) { setError(readableError(err)); setPending([]) } })
    const unsubscribe = window.db.onPendingUpdated?.(refetch)
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [refetch])

  if (!pending?.length) return null

  return (
    <div>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="mb-3 flex w-full items-center gap-1.5 text-left"
      >
        {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        <h2 className="text-lg font-semibold">Pending ({pending.length})</h2>
      </button>

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

      {!collapsed && (
        <div className="flex flex-col gap-3">
          {pending.map((ticket) => (
            <PendingCard
              key={ticket.uuid}
              ticket={ticket}
              onApprove={() => void pendingClient.approve(ticket.uuid)}
              onReject={() => void pendingClient.reject(ticket.uuid)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
