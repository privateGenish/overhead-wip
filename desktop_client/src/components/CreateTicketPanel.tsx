import { useEffect, useRef, useState } from 'react'
import { EditorRoot, EditorContent, StarterKit, Placeholder } from 'novel'
import { Markdown } from 'tiptap-markdown'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getTicketStore } from '@/lib/ticketStore'
import { TICKET_TYPES, type Ticket, type TicketType } from '@/shared/types'
import { Maximize2, X } from 'lucide-react'
import './ticket-editor.css'

const extensions = [
  StarterKit,
  Placeholder.configure({ placeholder: 'Add description…' }),
  Markdown,
]

interface CreateTicketPanelProps {
  fixedType?: TicketType
  /**
   * Hands the new ticket to the host so it can open it. Creation is meant to
   * drop you into the detail view to keep writing, and the host owns which
   * ticket is open.
   */
  onCreated?: (ticket: Ticket) => void
}

type Mode = 'collapsed' | 'expanded' | 'fullPage'

export function CreateTicketPanel({ fixedType, onCreated }: CreateTicketPanelProps) {
  const [mode, setMode] = useState<Mode>('collapsed')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<TicketType | ''>(fixedType ?? '')
  const [backlog, setBacklog] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)

  // Focus title when expanding
  useEffect(() => {
    if (mode !== 'collapsed') {
      setTimeout(() => titleRef.current?.focus(), 0)
    }
  }, [mode])

  function collapse() {
    setMode('collapsed')
    setTitle('')
    setDescription('')
    if (!fixedType) setType('')
    setBacklog(false)
  }

  /**
   * Everything the form collected goes in as one piece and the ticket comes
   * back out — no hunting for what was just written, and no field left behind
   * (the backlog flag used to be).
   */
  async function create() {
    const trimmed = title.trim()
    if (!trimmed || !type) return
    const created = await getTicketStore().create({
      type,
      title: trimmed,
      description: description.trim() ? description : '',
      backlog,
    })
    collapse()
    onCreated?.(created)
  }

  function onTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void create()
    }
  }

  // -------------------------------------------------------------------------
  // Collapsed — the original slim bar
  // -------------------------------------------------------------------------
  if (mode === 'collapsed') {
    return (
      <div
        className="flex items-center rounded-md border border-input bg-background px-2 gap-1 focus-within:ring-1 focus-within:ring-ring cursor-text"
        onClick={() => setMode('expanded')}
      >
        {/* Type pill — still functional when collapsed */}
        {!fixedType && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="h-8 px-1 text-sm text-muted-foreground hover:text-foreground shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                {type || 'Type'}
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {TICKET_TYPES.map((t) => (
                  <DropdownMenuItem key={t} onClick={() => setType(t)}>
                    {t}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="w-px h-4 bg-border" />
          </>
        )}
        <span className="py-2 px-2 text-sm text-muted-foreground flex-1 select-none">
          Create new ticket…
        </span>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Shared expanded content (used by both 'expanded' and 'fullPage')
  // -------------------------------------------------------------------------
  const content = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="text-xs text-muted-foreground font-medium">New ticket</span>
        <div className="flex items-center gap-1">
          {mode === 'expanded' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setMode('fullPage')}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={collapse}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Title */}
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onTitleKeyDown}
        placeholder="Ticket title"
        className="px-5 text-xl font-semibold bg-transparent outline-none placeholder:text-muted-foreground/50 w-full"
      />

      {/* Description — Novel editor */}
      <div className="flex-1 overflow-y-auto px-5 py-2 min-h-[80px]">
        <EditorRoot>
          <EditorContent
            extensions={extensions}
            editable
            onUpdate={({ editor }) => {
              const markdown = (
                editor.storage.markdown as { getMarkdown: () => string }
              ).getMarkdown()
              setDescription(markdown)
            }}
            editorProps={{
              attributes: { class: 'ticket-prose focus:outline-none' },
            }}
          />
        </EditorRoot>
      </div>

      {/* Metadata pills */}
      <div className="flex items-center gap-2 px-5 py-3 border-t">
        {/* Type */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Badge
                variant="outline"
                className="cursor-pointer hover:bg-accent text-xs font-normal"
              >
                {type || 'Type'}
              </Badge>
            }
          />
          <DropdownMenuContent>
            {TICKET_TYPES.map((t) => (
              <DropdownMenuItem
                key={t}
                onClick={() => setType(t)}
                className={type === t ? 'font-medium' : ''}
              >
                {t}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Backlog */}
        <Badge
          variant={backlog ? 'secondary' : 'outline'}
          className="cursor-pointer hover:bg-accent text-xs font-normal"
          onClick={() => setBacklog((b) => !b)}
        >
          Backlog
        </Badge>

        {/* Create button */}
        <div className="ml-auto">
          <Button
            size="sm"
            disabled={!title.trim() || !type}
            onClick={() => void create()}
          >
            Create ticket
          </Button>
        </div>
      </div>
    </div>
  )

  // -------------------------------------------------------------------------
  // Full page — takes over the whole view area
  // -------------------------------------------------------------------------
  if (mode === 'fullPage') {
    return (
      <div
        className="flex h-full flex-col bg-background"
        onKeyDown={(e) => { if (e.key === 'Escape') collapse() }}
        tabIndex={-1}
      >
        {content}
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Expanded — floating card above the list.
  // Dismissed via Escape or the X button only (no outside-click collapse —
  // backdrop z-index fights with Radix portals and causes type selection to reset).
  // Escape is handled on the panel div so Radix's stopPropagation during
  // dropdown keyboard interactions prevents accidental collapse.
  // -------------------------------------------------------------------------
  return (
    <div
      className="rounded-lg border bg-background shadow-lg"
      onKeyDown={(e) => { if (e.key === 'Escape') collapse() }}
      tabIndex={-1}
    >
      {content}
    </div>
  )
}
