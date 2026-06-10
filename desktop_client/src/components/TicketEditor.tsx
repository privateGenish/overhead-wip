import { useState } from 'react'
import { EditorRoot, EditorContent, StarterKit, Placeholder } from 'novel'
import { Markdown } from 'tiptap-markdown'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTicket } from '@/lib/ticketStore'
import { TicketHistory } from '@/components/TicketHistory'
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
}

/**
 * The ticket detail's main panel: a Novel (TipTap) markdown editor with an
 * Edit / View toggle. Edits are saved to the store on every change; the
 * ticket's `description` holds markdown.
 */
export function TicketEditor({ ticket }: TicketEditorProps) {
  const [editing, setEditing] = useState(false) // default: View (read-only)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  useTicket(ticket) // re-render when this ticket mutates

  function handleRestore(description: string) {
    ticket.setDescription(description)
    void window.db.historyFlush(ticket.uuid) // snapshot the restored version immediately
    setEditorKey((k) => k + 1) // force Novel editor to remount with new content
  }

  return (
    <div className="flex h-full flex-col">
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

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <EditorRoot>
          <EditorContent
            // Remount on ticket change or mode toggle — reloads content
            // (latest markdown) and applies the new editable state.
            key={`${ticket.uuid}:${editing}:${editorKey}`}
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

      <TicketHistory
        ticketUuid={ticket.uuid}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestore={handleRestore}
      />
    </div>
  )
}
