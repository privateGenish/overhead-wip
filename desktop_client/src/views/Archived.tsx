import { Archive, ArchiveRestore } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useArchivedTickets } from '@/lib/ticketStore'
import type { Ticket } from '@/shared/types'

function ArchivedTicketRow({ ticket }: { ticket: Ticket }) {
  return (
    <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{ticket.type}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{ticket.id}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{ticket.status.value}</span>
        </div>
        <p className="text-sm font-medium mt-1 truncate">{ticket.title || 'Untitled'}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 shrink-0"
        onClick={() => ticket.setArchived(false)}
      >
        <ArchiveRestore className="size-3.5" />
        Restore
      </Button>
    </div>
  )
}

export function Archived() {
  const archived = useArchivedTickets()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl flex flex-col gap-6 p-8">
        <div>
          <h2 className="text-xl font-semibold mb-1">Archived Tickets</h2>
          <p className="text-sm text-muted-foreground">
            Tickets you've archived are hidden from your views. Restore one to bring it back.
          </p>
        </div>

        {archived.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 flex flex-col items-center justify-center text-center gap-2">
            <Archive className="size-6 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">No archived tickets.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {archived.map((ticket) => (
              <ArchivedTicketRow key={ticket.uuid} ticket={ticket} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
