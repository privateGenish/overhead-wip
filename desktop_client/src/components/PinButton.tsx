import { useState } from 'react'
import { Pin } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getTicketStore, MAX_BENCH_TICKETS } from '@/lib/ticketStore'
import type { Ticket } from '@/shared/types'

interface PinButtonProps {
  ticket: Ticket
  /**
   * `labeled` — icon + "Pin"/"Pinned" text, for the control bar.
   * `icon` — icon only, for tight spaces like a table row.
   */
  variant?: 'labeled' | 'icon'
  className?: string
}

/**
 * The one pin control every surface shares (control bar, table row, Home).
 * Pinning past the 4-ticket cap opens a swap popover instead of failing
 * silently — the bench names who's currently on it so the choice is a click,
 * not a trip to go find out.
 */
export function PinButton({ ticket, variant = 'labeled', className }: PinButtonProps) {
  const [fullBench, setFullBench] = useState<Ticket[] | null>(null)

  async function toggle() {
    const store = getTicketStore()
    if (ticket.pinned) {
      await store.unpinTicket(ticket)
      return
    }
    const result = await store.pinTicket(ticket)
    if (!result.ok) setFullBench(result.bench)
  }

  async function swap(outgoing: Ticket) {
    await getTicketStore().swapTicket(outgoing, ticket)
    setFullBench(null)
  }

  const icon = <Pin className={cn('size-3.5', ticket.pinned && 'fill-current')} />
  const label = ticket.pinned ? 'Unpin ticket' : 'Pin ticket'

  const trigger = variant === 'labeled' ? (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={ticket.pinned}
      aria-label={label}
      title={label}
      onClick={() => void toggle()}
      className={cn('gap-1.5', ticket.pinned ? 'text-foreground' : 'text-muted-foreground', className)}
    >
      {icon}
      {ticket.pinned ? 'Pinned' : 'Pin'}
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={ticket.pinned}
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); void toggle() }}
      className={cn(ticket.pinned ? 'text-copper' : 'text-muted-foreground/50 hover:text-muted-foreground', className)}
    >
      {icon}
    </Button>
  )

  return (
    <Popover open={fullBench !== null} onOpenChange={(open) => { if (!open) setFullBench(null) }}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-64">
        <p className="text-xs font-medium">
          The bench is full ({MAX_BENCH_TICKETS}/{MAX_BENCH_TICKETS})
        </p>
        <p className="text-xs text-muted-foreground">
          Swap one out to pin “{ticket.title}”.
        </p>
        <div className="flex flex-col gap-0.5 pt-1">
          {fullBench?.map((benched) => (
            <button
              key={benched.uuid}
              onClick={() => void swap(benched)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted transition-colors"
            >
              <span className="font-mono text-muted-foreground shrink-0">{benched.id}</span>
              <span className="truncate flex-1">{benched.title}</span>
              <span className="text-muted-foreground shrink-0">Swap</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
