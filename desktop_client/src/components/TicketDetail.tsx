import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getTicketStore } from '@/lib/ticketStore'
import type { TicketRow } from '@/components/ticket-table/schema'
import { TicketEditor } from './TicketEditor'
import { cn } from '@/lib/utils'

interface TicketDetailProps {
  /** The current tab's tickets — the sidebar list. */
  rows: TicketRow[]
  selectedUuid: string
  onSelect: (uuid: string) => void
  onClose: () => void
}

/**
 * Ticket detail view: a sidebar listing the current tab's tickets, and a main
 * panel with the selected ticket's markdown editor.
 */
export function TicketDetail({
  rows,
  selectedUuid,
  onSelect,
  onClose,
}: TicketDetailProps) {
  const ticket = getTicketStore().getByUuid(selectedUuid)

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r">
        <div className="border-b p-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs text-muted-foreground"
          >
            <ChevronLeft className="size-3" /> Back to list
          </Button>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {rows.map((row) => (
            <button
              key={row.uuid}
              onClick={() => onSelect(row.uuid)}
              className={cn(
                'rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50',
                row.uuid === selectedUuid && 'bg-muted',
              )}
            >
              <div className="font-mono text-xs text-muted-foreground">
                {row.id}
              </div>
              <div className="truncate text-sm">{row.title}</div>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main panel */}
      <main className="min-w-0 flex-1">
        {ticket ? (
          <TicketEditor ticket={ticket} onArchived={onClose} />
        ) : (
          <div className="p-6 text-muted-foreground">Ticket not found.</div>
        )}
      </main>
    </div>
  )
}
