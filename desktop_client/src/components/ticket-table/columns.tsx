import { type ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { PinButton } from '@/components/PinButton'
import { getTicketStore } from '@/lib/ticketStore'
import { type TicketRow } from './schema'
import { DataTableColumnHeader } from './data-table-column-header'
import { DataTableRowActions } from './data-table-row-actions'

export const columns: ColumnDef<TicketRow>[] = [
  {
    id: 'pin',
    // Looked up live rather than read off the row — pinning needs the actual
    // Ticket instance (setPinned, the store's cap check), not the row's
    // plain snapshot of it.
    cell: ({ row }) => {
      const ticket = getTicketStore().getByUuid(row.original.uuid)
      if (!ticket) return null
      return <PinButton ticket={ticket} variant="icon" />
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={
          table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
        className="translate-y-[2px]"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
        className="translate-y-[2px]"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="ID" />
    ),
    cell: ({ row, table }) => (
      <button
        className="w-[80px] text-left font-mono text-xs hover:underline"
        onClick={() => table.options.meta?.onOpenTicket?.(row.original.uuid)}
      >
        {row.getValue('id')}
      </button>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'title',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Title" />
    ),
    cell: ({ row, table }) => (
      <button
        className="block max-w-[400px] truncate text-left font-medium hover:underline"
        onClick={() => table.options.meta?.onOpenTicket?.(row.original.uuid)}
      >
        {row.getValue('title')}
      </button>
    ),
  },
  {
    accessorKey: 'type',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Type" />
    ),
    cell: ({ row }) => (
      <Badge variant="outline">{row.getValue('type')}</Badge>
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: 'status',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <span className="text-sm">{row.getValue('status')}</span>
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: 'backlog',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Backlog" />
    ),
    cell: ({ row }) => (
      <Badge variant={row.getValue('backlog') ? 'secondary' : 'outline'}>
        {row.getValue('backlog') ? 'Backlog' : '—'}
      </Badge>
    ),
    filterFn: (row, id, value) => value.includes(String(row.getValue(id))),
  },
  {
    id: 'actions',
    cell: ({ row }) => <DataTableRowActions row={row} />,
  },
]
