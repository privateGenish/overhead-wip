import { Pin } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getTicketStore } from '@/lib/ticketStore'
import {
  TICKET_STATUS_OPTIONS,
  TICKET_TYPES,
  type Ticket,
  type TicketType,
} from '@/shared/types'

interface TicketControlBarProps {
  ticket: Ticket
}

export function TicketControlBar({ ticket }: TicketControlBarProps) {
  function changeType(type: TicketType | null) {
    if (!type) return
    void getTicketStore().setTicketType(ticket, type)
  }

  function changeStatus(status: string | null) {
    if (!status) return
    ticket.setStatus({ value: status })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-6 py-2">
      <Select value={ticket.type} onValueChange={changeType}>
        <SelectTrigger size="sm" className="w-[120px]" aria-label="Ticket type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          {TICKET_TYPES.map((type) => (
            <SelectItem key={type} value={type}>{type}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={ticket.status.value} onValueChange={changeStatus}>
        <SelectTrigger size="sm" className="w-[150px]" aria-label="Ticket status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          {TICKET_STATUS_OPTIONS[ticket.type].map((status) => (
            <SelectItem key={status} value={status}>{status}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Pin lives here rather than in the side panel so it is reachable
          without scrolling. Nothing consumes it yet — the focus surface that
          will is deferred; the flag and its affordance ship first. */}
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={ticket.pinned}
        aria-label={ticket.pinned ? 'Unpin ticket' : 'Pin ticket'}
        title={ticket.pinned ? 'Unpin ticket' : 'Pin ticket'}
        onClick={() => ticket.setPinned(!ticket.pinned)}
        className={cn(
          'gap-1.5',
          ticket.pinned ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <Pin className={cn('size-3.5', ticket.pinned && 'fill-current')} />
        {ticket.pinned ? 'Pinned' : 'Pin'}
      </Button>
    </div>
  )
}
