import { useMemo, useState } from 'react'
import { DataTable } from '@/components/ticket-table/data-table'
import { columns } from '@/components/ticket-table/columns'
import { TicketDetail } from '@/components/TicketDetail'
import { toRows } from '@/lib/tickets'
import { useTickets, ticketStore } from '@/lib/ticketStore'
import type { TicketType } from '@/shared/types'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TicketRow } from '@/components/ticket-table/schema'

interface TicketViewProps {
  filter?: (ticket: TicketRow) => boolean
  fixedType?: TicketRow['type']
}

export function TicketView({ filter, fixedType }: TicketViewProps) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState(fixedType ?? '')
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null)

  // Live Ticket instances from the store — the runtime source of truth.
  const tickets = useTickets()
  // Flat rows projected from those instances, for the table to render.
  const rows = useMemo(() => toRows(tickets), [tickets])
  const data = filter ? rows.filter(filter) : rows

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const trimmed = title.trim()
    if (!trimmed || !type) return
    ticketStore.create(type as TicketType, trimmed)
    setTitle('')
    if (!fixedType) setType('')
  }

  // Detail view — clicking a ticket's id/title opens this.
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

  // List view.
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-center rounded-md border border-input bg-background px-2 gap-1 focus-within:ring-1 focus-within:ring-ring">
        <Select value={type} onValueChange={setType} disabled={!!fixedType}>
          <SelectTrigger className="h-8 w-fit gap-1 border-none shadow-none focus:ring-0 text-muted-foreground text-sm px-1">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Explore">Explore</SelectItem>
            <SelectItem value="Feature">Feature</SelectItem>
            <SelectItem value="Execute">Execute</SelectItem>
          </SelectContent>
        </Select>
        <div className="w-px h-4 bg-border" />
        <Input
          placeholder="Create new ticket..."
          className="border-none shadow-none focus-visible:ring-0 h-9 px-2 flex-1"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <DataTable columns={columns} data={data} onOpenTicket={setSelectedUuid} />
    </div>
  )
}
