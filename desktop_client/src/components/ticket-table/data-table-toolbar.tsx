import { type Table } from '@tanstack/react-table'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { DataTableFacetedFilter } from './data-table-faceted-filter'
import type { TicketType } from '@/shared/types'

const typeOptions = [
  { label: 'Explore', value: 'Explore' },
  { label: 'Feature', value: 'Feature' },
  { label: 'Execute', value: 'Execute' },
]

const statusOptionsByType: Record<TicketType, Array<{ label: string; value: string }>> = {
  Explore: [
    { label: 'Open', value: 'Open' },
    { label: 'In Progress', value: 'In Progress' },
    { label: 'Concluded', value: 'Concluded' },
    { label: 'Not Needed', value: 'Not Needed' },
  ],
  Feature: [
    { label: 'Idea', value: 'Idea' },
    { label: 'Scoped', value: 'Scoped' },
    { label: 'In Progress', value: 'In Progress' },
    { label: 'Built', value: 'Built' },
    { label: 'Canceled', value: 'Canceled' },
  ],
  Execute: [
    { label: 'Draft', value: 'Draft' },
    { label: 'Ready', value: 'Ready' },
    { label: 'In Progress', value: 'In Progress' },
    { label: 'Done', value: 'Done' },
    { label: 'Failed', value: 'Failed' },
    { label: 'Rejected', value: 'Rejected' },
  ],
}

const allStatusOptions = [
  { label: 'Open', value: 'Open' },
  { label: 'In Progress', value: 'In Progress' },
  { label: 'Concluded', value: 'Concluded' },
  { label: 'Not Needed', value: 'Not Needed' },
  { label: 'Idea', value: 'Idea' },
  { label: 'Scoped', value: 'Scoped' },
  { label: 'Built', value: 'Built' },
  { label: 'Canceled', value: 'Canceled' },
  { label: 'Draft', value: 'Draft' },
  { label: 'Ready', value: 'Ready' },
  { label: 'Done', value: 'Done' },
  { label: 'Failed', value: 'Failed' },
  { label: 'Rejected', value: 'Rejected' },
]

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  hideTypeFilter?: boolean
  showBacklogFilter?: boolean
  fixedType?: TicketType
}

export function DataTableToolbar<TData>({
  table,
  hideTypeFilter = false,
  showBacklogFilter = false,
  fixedType,
}: DataTableToolbarProps<TData>) {
  const columnFilters = table.getState().columnFilters
  const backlogColumn = table.getColumn('backlog')
  const backlogFilter = backlogColumn?.getFilterValue() as string[] | undefined
  const showBacklog = !backlogFilter?.includes('false')
  const hasDefaultBacklogFilter =
    showBacklogFilter &&
    backlogFilter?.length === 1 &&
    backlogFilter[0] === 'false'
  const isFiltered =
    columnFilters.length > 0 &&
    !(columnFilters.length === 1 && hasDefaultBacklogFilter)

  const statusOptions = fixedType ? statusOptionsByType[fixedType] : allStatusOptions

  function resetFilters() {
    table.resetColumnFilters()
    if (showBacklogFilter) backlogColumn?.setFilterValue(['false'])
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center gap-2">
        <Input
          placeholder="Filter tickets..."
          value={(table.getColumn('id')?.getFilterValue() as string) ?? ''}
          onChange={(e) => table.getColumn('id')?.setFilterValue(e.target.value)}
          className="h-8 w-[150px] lg:w-[250px]"
        />
        {!hideTypeFilter && table.getColumn('type') && (
          <DataTableFacetedFilter column={table.getColumn('type')} title="Type" options={typeOptions} />
        )}
        {table.getColumn('status') && (
          <DataTableFacetedFilter column={table.getColumn('status')} title="Status" options={statusOptions} />
        )}
        {isFiltered && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Reset <X />
          </Button>
        )}
      </div>
      {showBacklogFilter && backlogColumn && (
        <label className="ml-4 flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-sm">
          <Switch
            checked={showBacklog}
            onCheckedChange={(checked) => {
              backlogColumn.setFilterValue(checked ? undefined : ['false'])
            }}
            aria-label="Show backlog tickets"
          />
          <span className="text-muted-foreground">Show backlog</span>
        </label>
      )}
    </div>
  )
}
