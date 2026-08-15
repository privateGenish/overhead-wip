import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useTickets } from '@/lib/ticketStore'
import { searchTickets } from '@/lib/ticketSearch'

/**
 * ⌘K — jump to a ticket.
 *
 * Hidden behind the shortcut on purpose: search is a thing you reach for, not
 * a bar that sits on screen taking up room. Scope is deliberately narrow —
 * the **active project's non-archived tickets**, matched on title and id only.
 * Archived tickets have their own field in the Archived view, and notes are
 * not in this index at all.
 *
 * The list comes from `useTickets()`, which is the store's active snapshot, so
 * archived tickets are excluded by construction rather than by a filter here
 * that could drift.
 */

/** The shortcut, written the way each platform writes it. */
function shortcutLabel(): string {
  const mac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
  return mac ? '⌘K' : 'Ctrl K'
}

interface SearchPaletteProps {
  /** Called with the chosen ticket's uuid. The shell turns it into a route. */
  onOpenTicket: (uuid: string) => void
}

export function SearchPalette({ onOpenTicket }: SearchPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const tickets = useTickets()
  const results = useMemo(() => searchTickets(tickets, query), [tickets, query])

  // One listener for the whole app, registered here rather than in the shell
  // so the palette owns its own trigger. `metaKey || ctrlKey` covers both
  // platforms without sniffing for one — Ctrl+K is dead weight on macOS and ⌘K
  // is unreachable elsewhere, so accepting both costs nothing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k') return
      if (!event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      setOpen((wasOpen) => !wasOpen)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [])

  // Every open starts from an empty box: the palette is for the search you are
  // making now, not the one you made last time.
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) setQuery('')
  }, [])

  const choose = useCallback((uuid: string) => {
    handleOpenChange(false)
    onOpenTicket(uuid)
  }, [handleOpenChange, onOpenTicket])

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Search tickets"
      description="Jump to a ticket by title or ID."
    >
      {/* Filtering is ours, not cmdk's: the scope of a match — title and id,
          never descriptions — is a product decision, so it lives in one
          tested function shared with the archived list. */}
      <Command shouldFilter={false} label="Search tickets">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search tickets by title or ID…"
        />
        <CommandList>
          <CommandEmpty>
            <span className="text-muted-foreground">No ticket matches “{query.trim()}”.</span>
          </CommandEmpty>
          {results.map((ticket) => (
            <CommandItem
              key={ticket.uuid}
              value={ticket.uuid}
              onSelect={() => choose(ticket.uuid)}
            >
              <span className="font-mono text-xs text-muted-foreground">{ticket.id}</span>
              <span className="truncate">{ticket.title || 'Untitled'}</span>
            </CommandItem>
          ))}
        </CommandList>
        <div className="flex justify-end px-2 py-1 text-[11px] text-muted-foreground">
          {shortcutLabel()} to close
        </div>
      </Command>
    </CommandDialog>
  )
}
