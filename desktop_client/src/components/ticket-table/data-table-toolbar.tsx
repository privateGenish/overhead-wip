import { type ColumnFiltersState, type Table } from '@tanstack/react-table'
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
  /** The view's starting filters — what Reset goes back to, not nothing. */
  defaultColumnFilters?: ColumnFiltersState
  fixedType?: TicketType
}

/** Order-insensitive comparison — filters arrive in interaction order. */
function sameFilters(a: ColumnFiltersState, b: ColumnFiltersState): boolean {
  if (a.length !== b.length) return false
  return a.every((filter) => {
    const other = b.find((candidate) => candidate.id === filter.id)
    return other !== undefined && JSON.stringify(other.value) === JSON.stringify(filter.value)
  })
}

export function DataTableToolbar<TData>({
  table,
  hideTypeFilter = false,
  defaultColumnFilters = [],
  fixedType,
}: DataTableToolbarProps<TData>) {
  const columnFilters = table.getState().columnFilters
  const backlogColumn = table.getColumn('backlog')
  const backlogFilter = backlogColumn?.getFilterValue() as string[] | undefined
  const showBacklog = !backlogFilter?.includes('false')
  // "Filtered" means "away from where this view starts", so a view whose
  // default already hides backlog does not offer a Reset that does nothing.
  const isFiltered = !sameFilters(columnFilters, defaultColumnFilters)

  const statusOptions = fixedType ? statusOptionsByType[fixedType] : allStatusOptions

  function resetFilters() {
    table.setColumnFilters(defaultColumnFilters)
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
      {/* Every view gets the toggle — the All view used to show backlog
          tickets with no control to take them away. */}
      {backlogColumn && (
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
