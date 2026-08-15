import { useMemo, useState } from 'react'
import { DataTable } from '@/components/ticket-table/data-table'
import { columns } from '@/components/ticket-table/columns'
import { TicketDetail } from '@/components/TicketDetail'
import { CreateTicketPanel } from '@/components/CreateTicketPanel'
import { toRows } from '@/lib/tickets'
import { useTickets } from '@/lib/ticketStore'
import type { TicketType } from '@/shared/types'
import type { TicketRow } from '@/components/ticket-table/schema'

interface TicketViewProps {
  filter?: (ticket: TicketRow) => boolean
  fixedType?: TicketType
  /**
   * Opens straight into this ticket — a deep link's landing point. Seeds the
   * selection rather than controlling it, so closing the detail still returns
   * to the list; the shell keys this component on the uuid, so a second link
   * mounts a fresh one instead of reviving a stale seed.
   */
  initialTicketUuid?: string
}

export function TicketView({ filter, fixedType, initialTicketUuid }: TicketViewProps) {
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
      <CreateTicketPanel fixedType={fixedType} />
      <DataTable
        columns={columns}
        data={data}
        defaultColumnFilters={fixedType ? [
          { id: 'backlog', value: ['false'] },
        ] : []}
        hideTypeFilter={Boolean(fixedType)}
        showBacklogFilter={Boolean(fixedType)}
        fixedType={fixedType}
        onOpenTicket={setSelectedUuid}
      />
    </div>
  )
}
