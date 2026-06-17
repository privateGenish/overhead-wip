import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorRoot, EditorContent, StarterKit, Placeholder } from 'novel'
import { Markdown } from 'tiptap-markdown'
import { Archive, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTicket } from '@/lib/ticketStore'
import { Switch } from '@/components/ui/switch'
import { TicketControlBar } from '@/components/TicketControlBar'
import { TicketHistory } from '@/components/TicketHistory'
import { TicketRelations } from '@/components/TicketRelations'
import type { Ticket } from '@/shared/types'
import './ticket-editor.css'

/** Editor extensions: rich-text basics + placeholder + markdown round-trip. */
const extensions = [
  StarterKit,
  Placeholder.configure({ placeholder: "Write the ticket's description…" }),
  Markdown,
]

interface TicketEditorProps {
  ticket: Ticket
  onArchived?: () => void
}

/**
 * The ticket detail's main panel: a Novel (TipTap) markdown editor with an
 * Edit / View toggle. Edits are saved to the store on every change; the
 * ticket's `description` holds markdown.
 */
const SIDE_MIN = 160
const SIDE_MAX = 480
const SIDE_DEFAULT = 240

export function TicketEditor({ ticket, onArchived }: TicketEditorProps) {
  const [editing, setEditing] = useState(false) // default: View (read-only)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [sideWidth, setSideWidth] = useState(SIDE_DEFAULT)
  const dragging = useRef(false)
  const previousTicketRef = useRef(ticket)

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startW = sideWidth

    function onMouseMove(ev: MouseEvent) {
      if (!dragging.current) return
      const delta = startX - ev.clientX
      setSideWidth(Math.min(SIDE_MAX, Math.max(SIDE_MIN, startW + delta)))
    }
    function onMouseUp() {
      dragging.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [sideWidth])
  useTicket(ticket) // re-render when this ticket mutates
  const contentKey = editing ? 'editing' : ticket.description

  useEffect(() => {
    if (previousTicketRef.current === ticket) return
    previousTicketRef.current = ticket
    setEditorKey((key) => key + 1)
  }, [ticket])

  function handleRestore(description: string) {
    ticket.setDescription(description)
    void window.db.historyFlush(ticket.uuid) // snapshot the restored version immediately
    setEditorKey((k) => k + 1) // force Novel editor to remount with new content
  }

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-muted-foreground">{ticket.id}</div>
          {editing ? (
            <input
              defaultValue={ticket.title}
              onChange={(e) => ticket.setTitle(e.target.value)}
              placeholder="Ticket title"
              className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/60"
            />
          ) : (
            <h1 className="truncate text-lg font-semibold">{ticket.title}</h1>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="size-3.5" />
              History
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (editing) void window.db.historyFlush(ticket.uuid)
              setEditing((e) => !e)
            }}
          >
            {editing ? 'View' : 'Edit'}
          </Button>
        </div>
      </header>

      <TicketControlBar ticket={ticket} />

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <EditorRoot>
            <EditorContent
              // Remount on ticket change or mode toggle — reloads content
              // (latest markdown) and applies the new editable state.
              key={`${ticket.uuid}:${editing}:${editorKey}:${contentKey}`}
              extensions={extensions}
              editable={editing}
              onCreate={({ editor }) => {
                editor.commands.setContent(ticket.description, false)
              }}
              onUpdate={({ editor }) => {
                const markdown = (
                  editor.storage.markdown as { getMarkdown: () => string }
                ).getMarkdown()
                ticket.setDescription(markdown)
              }}
              editorProps={{
                attributes: { class: 'ticket-prose focus:outline-none' },
              }}
            />
          </EditorRoot>
        </div>

        {/* Drag divider */}
        <div
          onMouseDown={onDividerMouseDown}
          className="w-px shrink-0 bg-border cursor-col-resize hover:bg-foreground/20 active:bg-foreground/30 transition-colors"
        />

        <aside
          style={{ width: sideWidth }}
          className="shrink-0 overflow-y-auto px-4 py-5 flex flex-col gap-5"
        >
          <label className="flex items-center justify-between text-sm cursor-pointer">
            <span className={ticket.backlog ? 'text-foreground' : 'text-muted-foreground'}>Backlog</span>
            <Switch
              checked={ticket.backlog}
              onCheckedChange={(checked) => ticket.setBacklog(checked)}
            />
          </label>
          <div className="border-t" />
          <TicketRelations ticket={ticket} />
        </aside>
      </div>

      {/* Floating archive button — bottom-right corner */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          ticket.setArchived(true)
          onArchived?.()
        }}
        title="Archive ticket"
        className="absolute right-4 bottom-4 gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <Archive className="size-3.5" />
        Archive
      </Button>

      <TicketHistory
        ticketUuid={ticket.uuid}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestore={handleRestore}
      />
    </div>
  )
}
