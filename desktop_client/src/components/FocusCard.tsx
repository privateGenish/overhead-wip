import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SubTicket {
  id: string
  title: string
  status: 'Done' | 'Live' | 'Open' | 'Ready' | 'Answered'
}

interface Phase {
  label: string
  done: number
  total: number
  items: SubTicket[]
}

const phases: Phase[] = [
  {
    label: 'Research',
    done: 1,
    total: 3,
    items: [
      { id: 'OVH-004', title: 'Should status options be locked per type?', status: 'Answered' },
      { id: 'OVH-005', title: 'Markdown editor library — TipTap vs Lexical vs textarea?', status: 'Live' },
      { id: 'OVH-013', title: 'Where exactly should the type accent color appear?', status: 'Open' },
    ],
  },
  {
    label: 'Execute',
    done: 2,
    total: 5,
    items: [
      { id: 'OVH-011', title: 'Define the type tokens (color, emoji, statuses)', status: 'Done' },
      { id: 'OVH-007', title: 'Build collapsible section component for dashboard', status: 'Done' },
      { id: 'OVH-006', title: 'Implement ticket auto-save with 800ms debounce', status: 'Live' },
      { id: 'OVH-012', title: 'Wire OVH-### reference autocomplete in editor', status: 'Ready' },
      { id: 'OVH-014', title: 'Render the type accent on status badges (1px ring)', status: 'Ready' },
    ],
  },
]

function ProgressDots({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-2 w-2 rounded-full',
            i < done ? 'bg-primary' : 'bg-muted'
          )}
        />
      ))}
    </div>
  )
}

function StatusLabel({ status }: { status: SubTicket['status'] }) {
  if (status === 'Done' || status === 'Answered') {
    return <span className="text-xs uppercase tracking-wide text-muted-foreground">{status}</span>
  }
  if (status === 'Live') {
    return (
      <span className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Live
      </span>
    )
  }
  return <span className="text-xs uppercase tracking-wide text-muted-foreground">{status}</span>
}

export function FocusCard() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <Card className="p-6 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Feature</Badge>
          <Badge variant="outline">In Progress</Badge>
          <span className="text-xs text-muted-foreground ml-2">On bench · 3 days ago</span>
        </div>
        <Button variant="ghost" size="sm" className="text-xs">
          Open Ticket <ChevronRight />
        </Button>
      </div>

      {/* Title */}
      <h2 className="text-2xl font-semibold tracking-tight">
        Five ticket types with type-specific status flows
      </h2>

      {/* Progress trackers */}
      <div className="flex items-center gap-6">
        {phases.map((p) => (
          <div key={p.label} className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{p.label}</span>
            <ProgressDots done={p.done} total={p.total} />
            <span className="text-xs text-muted-foreground tabular-nums">
              {p.done}/{p.total}
            </span>
          </div>
        ))}
      </div>

      {/* Sub-tickets */}
      {!collapsed && (
        <div className="flex flex-col gap-4">
          {phases.map((phase) => (
            <div key={phase.label} className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                  {phase.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {phase.done} of {phase.total}
                </span>
                <Separator className="flex-1" />
              </div>
              <div className="flex flex-col">
                {phase.items.map((item) => {
                  const isDone = item.status === 'Done' || item.status === 'Answered'
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 py-1.5 px-1 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox checked={isDone} />
                      <span className="text-xs font-mono text-muted-foreground w-16 shrink-0">{item.id}</span>
                      <span
                        className={cn(
                          'text-sm flex-1',
                          isDone && 'line-through text-muted-foreground'
                        )}
                      >
                        {item.title}
                      </span>
                      <StatusLabel status={item.status} />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Collapse toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-xs text-muted-foreground"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? 'Show details' : 'Collapse details'}
        <ChevronDown className={cn('size-3 transition-transform', collapsed && '-rotate-90')} />
      </Button>
    </Card>
  )
}
