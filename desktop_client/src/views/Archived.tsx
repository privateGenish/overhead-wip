import { useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { useArchivedTickets } from '@/lib/ticketStore'
import type { Ticket } from '@/shared/types'

/**
 * Fuzzy match: every character of the query appears in order, not necessarily
 * adjacently. Loose enough that `ovh12` finds `OVH-123` and `arcsrch` finds
 * "archive search", which is the point — the ⌘K palette deliberately skips
 * archived tickets, so this field is the only way to find one.
 */
function fuzzyMatch(haystack: string, needle: string): boolean {
  let at = 0
  for (const char of needle) {
    at = haystack.indexOf(char, at)
    if (at === -1) return false
    at++
  }
  return true
}

/** Archived tickets are searched by the two things a person remembers. */
function matchesArchivedQuery(
  ticket: Pick<Ticket, 'id' | 'title'>,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    fuzzyMatch(ticket.id.toLowerCase(), needle) ||
    fuzzyMatch(ticket.title.toLowerCase(), needle)
  )
}

function ArchivedTicketRow({ ticket }: { ticket: Ticket }) {
  const [confirming, setConfirming] = useState(false)

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
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => ticket.setArchived(false)}
        >
          <ArchiveRestore className="size-3.5" />
          Restore
        </Button>
        {/* The only way to permanently delete a single ticket in the app —
            archiving first is the required step, and this is the second. */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${ticket.id}`}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete {ticket.id}?</DialogTitle>
            <DialogDescription>
              This permanently deletes “{ticket.title || 'Untitled'}” along with its
              relations, version history, graph placements and mentions. There is no
              way to recover it after confirmation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={() => ticket.delete()}>
              Yes, delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function Archived() {
  const archived = useArchivedTickets()
  const [query, setQuery] = useState('')

  const results = useMemo(
    () => archived.filter((ticket) => matchesArchivedQuery(ticket, query)),
    [archived, query],
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl flex flex-col gap-6 p-8">
        <div>
          <h2 className="text-xl font-semibold mb-1">Archived Tickets</h2>
          <p className="text-sm text-muted-foreground">
            Tickets you've archived are hidden from your views. Restore one to bring it back,
            or delete it for good.
          </p>
        </div>

        {archived.length > 0 && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search archived tickets by title or ID…"
            aria-label="Search archived tickets"
          />
        )}

        {archived.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 flex flex-col items-center justify-center text-center gap-2">
            <Archive className="size-6 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">No archived tickets.</p>
          </div>
        ) : results.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 flex flex-col items-center justify-center text-center gap-2">
            <p className="text-sm text-muted-foreground">
              No archived ticket matches “{query.trim()}”.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {results.map((ticket) => (
              <ArchivedTicketRow key={ticket.uuid} ticket={ticket} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
