import { useMemo, useState } from 'react'
import { DataTable } from '@/components/ticket-table/data-table'
import { columns } from '@/components/ticket-table/columns'
import { TicketDetail } from '@/components/TicketDetail'
import { CreateTicketPanel } from '@/components/CreateTicketPanel'
import { toRows } from '@/lib/tickets'
import { useTickets } from '@/lib/ticketStore'
import type { TicketType } from '@/shared/types'
import type { TicketRow } from '@/components/ticket-table/schema'
import type { ColumnFiltersState } from '@tanstack/react-table'

/** Backlog is opt-in everywhere: hidden until the toggle asks for it. */
const HIDE_BACKLOG: ColumnFiltersState = [{ id: 'backlog', value: ['false'] }]

interface TicketViewProps {
  filter?: (ticket: TicketRow) => boolean
  fixedType?: TicketType
  /**
   * Opts out of the backlog-hidden default. Only the Backlog view sets it —
   * backlog tickets are that view's entire content, so hiding them by default
   * would leave it empty.
   */
  showsBacklog?: boolean
  /**
   * Opens straight into this ticket — a deep link's landing point. Seeds the
   * selection rather than controlling it, so closing the detail still returns
   * to the list; the shell keys this component on the uuid, so a second link
   * mounts a fresh one instead of reviving a stale seed.
   */
  initialTicketUuid?: string
}

export function TicketView({
  filter, fixedType, showsBacklog = false, initialTicketUuid,
}: TicketViewProps) {
  const [selectedUuid, setSelectedUuid] = useState<string | null>(initialTicketUuid ?? null)

  const tickets = useTickets()
  const rows = useMemo(() => toRows(tickets), [tickets])
  const data = filter ? rows.filter(filter) : rows

  if (selectedUuid) {
    return (
      <TicketDetail
        rows={data}
        selectedUuid={selectedUuid}
        onSelect={setSelectedUuid}
        onClose={() => setSelectedUuid(null)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      {/* Creating opens the ticket, through the same selection a row click
          drives — the detail view is where the thought gets fleshed out. */}
      <CreateTicketPanel
        fixedType={fixedType}
        onCreated={(ticket) => setSelectedUuid(ticket.uuid)}
      />
      <DataTable
        columns={columns}
        data={data}
        defaultColumnFilters={showsBacklog ? [] : HIDE_BACKLOG}
        hideTypeFilter={Boolean(fixedType)}
        fixedType={fixedType}
        onOpenTicket={setSelectedUuid}
      />
    </div>
  )
}
