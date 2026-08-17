import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorRoot, EditorContent, StarterKit, Placeholder } from 'novel'
import type { EditorInstance } from 'novel'
import { Markdown } from 'tiptap-markdown'
import { Archive, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTicket } from '@/lib/ticketStore'
import { persistQueue } from '@/lib/persistQueue'
import { Switch } from '@/components/ui/switch'
import { TicketControlBar } from '@/components/TicketControlBar'
import { TicketHistory } from '@/components/TicketHistory'
import { TicketRelations } from '@/components/TicketRelations'
import { MentionMenu } from '@/components/MentionMenu'
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
 * The ticket detail's main panel: a Novel (TipTap) markdown editor, always
 * editable. Edits are saved to the store on every change; the ticket's
 * `description` holds markdown.
 *
 * There used to be a View/Edit toggle. Clicking Edit flipped `editable` but
 * never moved DOM focus off the button just clicked, so keystrokes right
 * after entering edit mode were silently swallowed — worst on a blank
 * description, which had no placeholder text to click into as a fallback.
 * Always-editable sidesteps the whole class of bug: there's no mode switch
 * for focus to fall out of sync with.
 */
const SIDE_MIN = 160
const SIDE_MAX = 480
const SIDE_DEFAULT = 240

/** Reads the editor's current document back as markdown. */
function editorMarkdown(editor: EditorInstance): string {
  return (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown()
}

export function TicketEditor({ ticket, onArchived }: TicketEditorProps) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editor, setEditor] = useState<EditorInstance | null>(null)
  const [sideWidth, setSideWidth] = useState(SIDE_DEFAULT)
  const dragging = useRef(false)

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

  // Push external changes (vault sync, restore) into the live editor instead of
  // remounting it — a remount discards cursor, selection and undo history.
  // The guard matters: without it every notify would reset the caret mid-typing.
  useEffect(() => {
    if (!editor) return
    if (editorMarkdown(editor) === ticket.description) return
    editor.commands.setContent(ticket.description, false)
  }, [editor, ticket.description])

  /** Lands the queued description write, then snapshots. Order matters —
   *  reversed, history would record the previous text. */
  const commit = useCallback(async () => {
    await persistQueue.flush(ticket.uuid)
    await window.db.historyFlush(ticket.uuid)
  }, [ticket.uuid])

  // Flush on unmount and when switching to another ticket, so a pending edit
  // can't be stranded by navigating away. Snapshotting here (not just
  // flushing the write) is what used to happen on the Edit->View toggle —
  // there's no toggle anymore, so leaving the ticket is the new commit point.
  useEffect(() => {
    return () => { void commit() }
  }, [commit])

  // Leaving the window is a natural commit point too.
  useEffect(() => {
    const onBlur = () => { void persistQueue.flushAll() }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  function handleRestore(description: string) {
    ticket.setDescription(description)
    // The content effect above pushes this into the editor; snapshot after the
    // restored text has actually been written.
    void commit()
  }

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-muted-foreground">{ticket.id}</div>
          <input
            defaultValue={ticket.title}
            onChange={(e) => ticket.setTitle(e.target.value)}
            placeholder="Ticket title"
            className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void commit(); setHistoryOpen(true) }}
          >
            <History className="size-3.5" />
            History
          </Button>
        </div>
      </header>

      <TicketControlBar ticket={ticket} />

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <EditorRoot>
            <EditorContent
              // Keyed on identity only. Content is driven imperatively by the
              // effect above, so typing no longer rebuilds the editor on
              // every keystroke.
              key={ticket.uuid}
              extensions={extensions}
              editable
              onCreate={({ editor }) => {
                editor.commands.setContent(ticket.description, false)
                setEditor(editor)
              }}
              onUpdate={({ editor }) => {
                ticket.setDescription(editorMarkdown(editor))
              }}
              editorProps={{
                attributes: { class: 'ticket-prose focus:outline-none' },
              }}
            />
          </EditorRoot>
          {/* Typing `@` offers this project's tickets; what lands in the
              document is plain `@OVH-123` text. */}
          <MentionMenu editor={editor} />
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
