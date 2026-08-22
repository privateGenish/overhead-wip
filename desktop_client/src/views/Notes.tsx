import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorRoot, EditorContent, StarterKit, Placeholder } from 'novel'
import type { EditorInstance } from 'novel'
import { Markdown } from 'tiptap-markdown'
import { ChevronLeft, Pin, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { persistQueue } from '@/lib/persistQueue'
import { noteClient, noteKey, type NoteData } from '@/lib/noteClient'
import { benchClient, MAX_PINNED_NOTES } from '@/lib/benchClient'
import { readableError } from '@/lib/ipcError'
import { MentionMenu } from '@/components/MentionMenu'
import { cn } from '@/lib/utils'
import '@/components/ticket-editor.css'

/** Editor extensions — the same set the ticket editor uses. */
const extensions = [
  StarterKit,
  Placeholder.configure({ placeholder: 'Start writing…' }),
  Markdown,
]

/** What a brand-new note is called before anyone renames it. */
const UNTITLED = 'Untitled note'

/** How much of the body a card shows. */
const PREVIEW_LENGTH = 180

/**
 * Notes — a grid of titled markdown documents.
 *
 * Deliberately plain: no tags, no grouping, no filtering. A note is a place to
 * think, and the grid is the whole index.
 *
 * Edits are held in memory and written through `persistQueue`, so typing costs
 * no SQL and no vault write until it stops — the same contract the ticket
 * editor works under.
 */
export function Notes() {
  const [notes, setNotes] = useState<NoteData[] | null>(null)
  const [openUuid, setOpenUuid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pinnedUuids, setPinnedUuids] = useState<string[]>([])
  // Set when pinning would exceed MAX_PINNED_NOTES — names the note trying
  // to get on, so the swap dialog can offer it a slot.
  const [pinConflict, setPinConflict] = useState<{ pendingUuid: string; current: NoteData[] } | null>(null)

  // The list is edited from callbacks that must see the *current* note to
  // persist it, not the one captured when they were created.
  const notesRef = useRef<NoteData[]>([])

  const publish = useCallback((next: NoteData[]) => {
    notesRef.current = next
    setNotes(next)
  }, [])

  useEffect(() => {
    let alive = true
    void noteClient.all()
      .then((loaded) => { if (alive) publish(loaded) })
      .catch((err: unknown) => { if (alive) { setError(readableError(err)); publish([]) } })
    void benchClient.listNoteSlots()
      .then((slots) => { if (alive) setPinnedUuids(slots.map((s) => s.uuid)) })
    return () => { alive = false }
  }, [publish])

  /** Pins, unpins, or — if the bench is full — opens the swap dialog. */
  const togglePin = useCallback(async (uuid: string) => {
    if (pinnedUuids.includes(uuid)) {
      await benchClient.unpinNote(uuid)
      setPinnedUuids((prev) => prev.filter((u) => u !== uuid))
      return
    }
    const slots = await benchClient.listNoteSlots()
    if (slots.length >= MAX_PINNED_NOTES) {
      const current = notesRef.current.filter((n) => slots.some((s) => s.uuid === n.uuid))
      setPinConflict({ pendingUuid: uuid, current })
      return
    }
    await benchClient.pinNote(uuid, slots)
    setPinnedUuids((prev) => [...prev, uuid])
  }, [pinnedUuids])

  const resolveSwap = useCallback(async (outUuid: string) => {
    if (!pinConflict) return
    const slots = await benchClient.listNoteSlots()
    await benchClient.swapNote(outUuid, pinConflict.pendingUuid, slots)
    setPinnedUuids((prev) => [...prev.filter((u) => u !== outUuid), pinConflict.pendingUuid])
    setPinConflict(null)
  }, [pinConflict])

  // Leaving the window is a commit point, and so is leaving the view — a
  // pending edit must never be stranded by navigating away.
  useEffect(() => {
    const onBlur = () => { void persistQueue.flushAll() }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      void persistQueue.flushAll()
    }
  }, [])

  /** Applies an edit in memory at once, and queues the write behind it. */
  const edit = useCallback((uuid: string, patch: Partial<Pick<NoteData, 'title' | 'body'>>) => {
    const next = notesRef.current.map((note) => (
      note.uuid === uuid ? { ...note, ...patch, updated_at: Date.now() } : note
    ))
    publish(next)

    const edited = next.find((note) => note.uuid === uuid)
    if (!edited) return
    persistQueue.schedule(noteKey(uuid), () => noteClient.upsert(edited))
  }, [publish])

  /**
   * Creates a note and opens it. The row is written eagerly rather than queued:
   * an unsaved note the user is already typing into has nothing to fall back on.
   */
  const create = useCallback(async () => {
    const now = Date.now()
    const note: NoteData = {
      uuid: crypto.randomUUID(),
      title: UNTITLED,
      body: '',
      created_at: now,
      updated_at: now,
    }
    publish([note, ...notesRef.current])
    setOpenUuid(note.uuid)
    try {
      await noteClient.upsert(note)
    } catch (err) {
      setError(readableError(err))
    }
  }, [publish])

  const remove = useCallback(async (uuid: string) => {
    // Drop the queued write first — running it would re-insert the row.
    await persistQueue.cancel(noteKey(uuid))
    setOpenUuid(null)
    publish(notesRef.current.filter((note) => note.uuid !== uuid))
    setPinnedUuids((prev) => prev.filter((u) => u !== uuid)) // pinned_notes row cascades on its own
    try {
      await noteClient.delete(uuid)
    } catch (err) {
      setError(readableError(err))
    }
  }, [publish])

  const close = useCallback((uuid: string) => {
    setOpenUuid(null)
    void persistQueue.flush(noteKey(uuid))
  }, [])

  if (notes === null) {
    return <p className="p-8 text-sm text-muted-foreground">Loading…</p>
  }

  const open = notes.find((note) => note.uuid === openUuid) ?? null

  if (open) {
    return (
      <NoteEditor
        key={open.uuid}
        note={open}
        onChange={(patch) => edit(open.uuid, patch)}
        onClose={() => close(open.uuid)}
        onDelete={() => void remove(open.uuid)}
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl flex flex-col gap-6 p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold mb-1">Notes</h2>
            <p className="text-sm text-muted-foreground">
              Markdown documents that belong to this project. Everything here mirrors to the
              vault's <span className="font-mono">notes/</span> folder.
            </p>
          </div>
          <Button size="sm" className="gap-1.5 shrink-0" onClick={() => void create()}>
            <Plus className="size-3.5" />
            New note
          </Button>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No notes yet. The first one is a click away.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {notes.map((note) => (
              <NoteCard
                key={note.uuid}
                note={note}
                pinned={pinnedUuids.includes(note.uuid)}
                onOpen={() => setOpenUuid(note.uuid)}
                onTogglePin={() => void togglePin(note.uuid)}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog open={pinConflict !== null} onOpenChange={(open) => { if (!open) setPinConflict(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Only {MAX_PINNED_NOTES} notes can be pinned</DialogTitle>
            <DialogDescription>
              Swap one out to make room on the Home rail.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            {pinConflict?.current.map((n) => (
              <button
                key={n.uuid}
                onClick={() => void resolveSwap(n.uuid)}
                className="flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
              >
                <span className="truncate">{n.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">Swap</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/** Markdown reads badly at card size, so the preview is flattened to prose. */
function preview(body: string): string {
  const flat = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>[\]()#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat
}

interface NoteCardProps {
  note: NoteData
  pinned: boolean
  onOpen: () => void
  onTogglePin: () => void
}

/**
 * The pin button sits above a full-cover "open" button rather than nesting a
 * button in a button — the body text carries `pointer-events-none` so clicks
 * pass through to Open everywhere except the pin corner.
 */
function NoteCard({ note, pinned, onOpen, onTogglePin }: NoteCardProps) {
  const body = preview(note.body)
  return (
    <div className="relative h-40 rounded-lg border p-4 flex flex-col gap-2 transition-colors hover:bg-accent/40">
      <button
        onClick={onOpen}
        aria-label={`Open ${note.title}`}
        className="absolute inset-0 cursor-pointer rounded-lg"
      />
      <div className="relative flex items-start justify-between gap-2 pointer-events-none">
        <span className="font-medium truncate">{note.title}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin() }}
          aria-pressed={pinned}
          aria-label={pinned ? 'Unpin note' : 'Pin note'}
          title={pinned ? 'Unpin note' : 'Pin note'}
          className={cn(
            'pointer-events-auto shrink-0 rounded p-0.5 transition-colors',
            pinned ? 'text-copper' : 'text-muted-foreground/40 hover:text-muted-foreground',
          )}
        >
          <Pin className={cn('size-3.5', pinned && 'fill-current')} />
        </button>
      </div>
      <span className="relative text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap pointer-events-none">
        {body || 'Empty note'}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

interface NoteEditorProps {
  note: NoteData
  onChange: (patch: Partial<Pick<NoteData, 'title' | 'body'>>) => void
  onClose: () => void
  onDelete: () => void
}

function NoteEditor({ note, onChange, onClose, onDelete }: NoteEditorProps) {
  const [confirming, setConfirming] = useState(false)
  // Held only so the mention menu has something to attach to — the body itself
  // is driven by `onUpdate`, as before.
  const [editor, setEditor] = useState<EditorInstance | null>(null)

  // The title is uncontrolled for the same reason the ticket title is: the
  // value round-trips through the parent's state, and re-imposing it on every
  // keystroke fights the caret.
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="gap-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          All notes
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete ${note.title}`}
          onClick={() => setConfirming(true)}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-6 flex flex-col gap-4">
          <input
            defaultValue={note.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="Note title"
            aria-label="Note title"
            className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/60"
          />

          <EditorRoot>
            <EditorContent
              extensions={extensions}
              onCreate={({ editor }) => {
                editor.commands.setContent(note.body, false)
                setEditor(editor)
              }}
              onUpdate={({ editor }) => {
                const markdown = (
                  editor.storage.markdown as { getMarkdown: () => string }
                ).getMarkdown()
                onChange({ body: markdown })
              }}
              editorProps={{
                attributes: { class: 'ticket-prose focus:outline-none' },
              }}
            />
          </EditorRoot>
          {/* A note can mention tickets too — the same plain-text reference. */}
          <MentionMenu editor={editor} />
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete “{note.title}”?</DialogTitle>
            <DialogDescription>
              This removes the note from the database and deletes its markdown file from the
              vault. There is no way to recover it after confirmation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={onDelete}>
              Yes, delete it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
