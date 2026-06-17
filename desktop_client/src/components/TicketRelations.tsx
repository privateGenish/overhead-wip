import { useEffect, useRef, useState } from 'react'
import { X, Plus } from 'lucide-react'
import { relationsClient } from '@/lib/relationsClient'
import { ticketStore, useTickets } from '@/lib/ticketStore'
import type { TicketRelation } from '@/types/electron'
import type { Ticket, TicketType } from '@/shared/types'
import { cn } from '@/lib/utils'

const TICKET_TYPES: TicketType[] = ['Execute', 'Explore', 'Feature']

type AddingFor = 'blocked-by' | 'blocking' | 'relates-to'

interface RelationChipProps {
  uuid: string
  relationUuid: string
  onRemove: (relationUuid: string) => void
}

function RelationChip({ uuid, relationUuid, onRemove }: RelationChipProps) {
  const ticket = ticketStore.getByUuid(uuid)
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-0.5 text-xs">
      <span className="font-mono text-muted-foreground">{ticket?.id ?? '…'}</span>
      <span className="max-w-[160px] truncate">{ticket?.title ?? uuid}</span>
      <button
        onClick={() => onRemove(relationUuid)}
        className="text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Remove relation"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

interface RelationGroupProps {
  label: string
  relations: TicketRelation[]
  getOtherUuid: (rel: TicketRelation) => string
  addingFor: AddingFor | null
  groupKey: AddingFor
  search: string
  onSearch: (v: string) => void
  onStartAdding: (key: AddingFor) => void
  onAdd: (ticket: Ticket) => void
  onCancel: () => void
  onRemove: (relationUuid: string) => void
  excludedUuids: Set<string>
  allTickets: Ticket[]
}

function RelationGroup({
  label,
  relations,
  getOtherUuid,
  addingFor,
  groupKey,
  search,
  onSearch,
  onStartAdding,
  onAdd,
  onCancel,
  onRemove,
  excludedUuids,
  allTickets,
}: RelationGroupProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isAdding = addingFor === groupKey
  const [typeFilter, setTypeFilter] = useState<Set<TicketType>>(new Set())

  useEffect(() => {
    if (isAdding) inputRef.current?.focus()
    else setTypeFilter(new Set())
  }, [isAdding])

  function toggleType(type: TicketType) {
    setTypeFilter((prev) => {
      const next = new Set(prev)
      next.has(type) ? next.delete(type) : next.add(type)
      return next
    })
  }

  const filtered = allTickets.filter((t) => {
    if (excludedUuids.has(t.uuid)) return false
    if (typeFilter.size > 0 && !typeFilter.has(t.type as TicketType)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {relations.map((rel) => (
          <RelationChip
            key={rel.uuid}
            uuid={getOtherUuid(rel)}
            relationUuid={rel.uuid}
            onRemove={onRemove}
          />
        ))}
        <button
          onClick={() => onStartAdding(groupKey)}
          className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          <Plus className="size-3" /> Add
        </button>
      </div>

      {isAdding && (
        // stopPropagation on mousedown prevents the document-level outside-click
        // handler from firing before onClick on the list items, which would
        // unmount the dropdown and swallow the click.
        <div
          className="rounded-md border bg-popover shadow-md w-full"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onCancel()}
            placeholder="Search tickets…"
            className="w-full bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex gap-1 border-t px-2 py-1.5">
            {TICKET_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={cn(
                  'rounded px-2 py-0.5 text-xs transition-colors',
                  typeFilter.has(type)
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {type}
              </button>
            ))}
          </div>
          <div className="border-t max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No tickets found.</p>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.uuid}
                  onClick={() => onAdd(t)}
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-muted transition-colors"
                >
                  <div className="flex flex-col shrink-0">
                    <span className="text-[10px] text-muted-foreground/60 leading-tight">{t.type}</span>
                    <span className="font-mono text-xs text-muted-foreground">{t.id}</span>
                  </div>
                  <span className="truncate text-sm pt-2.5">{t.title}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface TicketRelationsProps {
  ticket: Ticket
}

export function TicketRelations({ ticket }: TicketRelationsProps) {
  const [relations, setRelations] = useState<TicketRelation[]>([])
  const [addingFor, setAddingFor] = useState<AddingFor | null>(null)
  const [search, setSearch] = useState('')
  const allTickets = useTickets()

  useEffect(() => {
    relationsClient.list(ticket.uuid).then(setRelations)
  }, [ticket.uuid])

  // Close search panel on outside click
  useEffect(() => {
    if (!addingFor) return
    function handle(e: MouseEvent) {
      const target = e.target as Element
      if (!target.closest('[data-relations-panel]')) cancel()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [addingFor])

  const blockedBy = relations.filter((r) => r.type === 'blocked-by' && r.node_a === ticket.uuid)
  const blocking  = relations.filter((r) => r.type === 'blocked-by' && r.node_b === ticket.uuid)
  const related   = relations.filter((r) => r.type === 'relates-to')

  // All UUIDs already related to this ticket (for excluding from search)
  const relatedUuids = new Set<string>([
    ticket.uuid,
    ...blockedBy.map((r) => r.node_b),
    ...blocking.map((r) => r.node_a),
    ...related.map((r) => r.node_a === ticket.uuid ? r.node_b : r.node_a),
  ])

  async function handleBlockBy(blocked: string, blocker: string) {
    const rel = await relationsClient.blockBy(blocked, blocker)
    setRelations((prev) => [...prev, rel])
    cancel()
  }

  async function handleRelate(a: string, b: string) {
    const rel = await relationsClient.relate(a, b)
    setRelations((prev) => [...prev, rel])
    cancel()
  }

  async function handleRemove(relationUuid: string) {
    await relationsClient.remove(relationUuid)
    setRelations((prev) => prev.filter((r) => r.uuid !== relationUuid))
  }

  function cancel() {
    setAddingFor(null)
    setSearch('')
  }

  function startAdding(key: AddingFor) {
    setAddingFor(key)
    setSearch('')
  }

  return (
    <div className="space-y-4" data-relations-panel>
      <RelationGroup
        label="Blocked by"
        relations={blockedBy}
        getOtherUuid={(r) => r.node_b}
        addingFor={addingFor}
        groupKey="blocked-by"
        search={search}
        onSearch={setSearch}
        onStartAdding={startAdding}
        onAdd={(t) => handleBlockBy(ticket.uuid, t.uuid)}
        onCancel={cancel}
        onRemove={handleRemove}
        excludedUuids={relatedUuids}
        allTickets={allTickets}
      />
      <RelationGroup
        label="Blocking"
        relations={blocking}
        getOtherUuid={(r) => r.node_a}
        addingFor={addingFor}
        groupKey="blocking"
        search={search}
        onSearch={setSearch}
        onStartAdding={startAdding}
        onAdd={(t) => handleBlockBy(t.uuid, ticket.uuid)}
        onCancel={cancel}
        onRemove={handleRemove}
        excludedUuids={relatedUuids}
        allTickets={allTickets}
      />
      <RelationGroup
        label="Related"
        relations={related}
        getOtherUuid={(r) => r.node_a === ticket.uuid ? r.node_b : r.node_a}
        addingFor={addingFor}
        groupKey="relates-to"
        search={search}
        onSearch={setSearch}
        onStartAdding={startAdding}
        onAdd={(t) => handleRelate(ticket.uuid, t.uuid)}
        onCancel={cancel}
        onRemove={handleRemove}
        excludedUuids={relatedUuids}
        allTickets={allTickets}
      />
    </div>
  )
}
