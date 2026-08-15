import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorInstance } from 'novel'
import { formatMention } from '@/shared/mentions'
import { hasTicketStore, useTickets } from '@/lib/ticketStore'
import { mentionQueryAt, rankMentionCandidates, type MentionCandidate } from '@/lib/mentionSuggest'

/**
 * The `@` autocomplete for both markdown editors.
 *
 * **Why this and not a TipTap Mention node.** A mention node is an atom in the
 * document, and what it serializes to is decided by whatever markdown rules the
 * node ships with — typically a link or an HTML span. §2.1 requires the exact
 * opposite: the vault is the interchange format, so a reference has to reach
 * the file as literal `@OVH-123` and come back out of a plain text editor
 * intact. This menu therefore inserts a **plain text node** and owns no schema
 * at all. Nothing about the document changes; the only new thing in the app is
 * a list that helps you type an id you already meant to type.
 *
 * That also means there is nothing to undo specially, nothing to migrate, and
 * no way for a mention to survive in the document but not in the markdown.
 *
 * Read UI for backlinks is deliberately absent — data this round, presentation
 * later (**C10**).
 */

/** How many tickets the menu shows at once. */
const MAX_ITEMS = 8

interface MentionMenuProps {
  /** The live editor, or null before it has been created. */
  editor: EditorInstance | null
}

/**
 * Candidates come from the active project's ticket store, so there is nothing
 * to offer without one. The check happens before any hook runs, and the store's
 * existence is fixed for a mount — a project switch rebuilds the tree.
 */
export function MentionMenu({ editor }: MentionMenuProps) {
  if (!editor || !hasTicketStore()) return null
  return <MentionMenuInner editor={editor} />
}

/** Where the menu sits, in viewport coordinates. */
interface MenuAnchor {
  left: number
  top: number
}

interface MenuState {
  query: string
  /** Document positions of the `@…` token being replaced. */
  from: number
  to: number
  anchor: MenuAnchor
}

/**
 * Screen position of a document position.
 *
 * Measurement can fail — `coordsAtPos` throws for a position the view has not
 * laid out, and needs layout APIs a test environment does not have. Failing
 * back to the corner keeps the menu usable from the keyboard, which is better
 * than a feature that silently does not appear.
 */
function anchorFor(editor: EditorInstance, pos: number): MenuAnchor {
  try {
    const coords = editor.view.coordsAtPos(pos)
    return { left: coords.left, top: coords.bottom + 4 }
  } catch {
    return { left: 0, top: 0 }
  }
}

function MentionMenuInner({ editor }: { editor: EditorInstance }) {
  const tickets = useTickets()
  const [state, setState] = useState<MenuState | null>(null)
  const [index, setIndex] = useState(0)

  /**
   * The caret position an insertion just left behind. Without it the menu
   * reopens on the id it has only now finished writing, since `@OVH-123` is a
   * perfectly good open token.
   */
  const suppressedAt = useRef<number | null>(null)

  const candidates = useMemo<MentionCandidate[]>(
    () => tickets.map((ticket) => ({ uuid: ticket.uuid, id: ticket.id, title: ticket.title })),
    [tickets],
  )

  const items = useMemo(
    () => (state ? rankMentionCandidates(candidates, state.query, MAX_ITEMS) : []),
    [candidates, state],
  )

  /**
   * The `@…` token the menu is currently open on, as `from:query`.
   *
   * Compared rather than derived from state because `refresh` runs on an
   * editor event, outside React's render — reading the state it closed over
   * would be reading a value one render old.
   */
  const openToken = useRef<string | null>(null)

  // Recompute the open token after every transaction — typing, clicking
  // elsewhere and undo all arrive the same way.
  useEffect(() => {
    const refresh = () => {
      const close = () => {
        openToken.current = null
        setState(null)
      }

      const selection = editor.state.selection
      if (!editor.isEditable || !selection.empty) {
        close()
        return
      }
      if (suppressedAt.current === selection.from) {
        close()
        return
      }
      suppressedAt.current = null

      const $from = selection.$from
      // Code blocks are excluded from extraction, so completing inside one
      // would offer a link the parser then refuses to make.
      if ($from.parent.type.spec.code) {
        close()
        return
      }

      const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
      const hit = mentionQueryAt(textBefore)
      if (!hit) {
        close()
        return
      }

      const next: MenuState = {
        query: hit.query,
        from: selection.from - (textBefore.length - hit.start),
        to: selection.from,
        anchor: anchorFor(editor, selection.from),
      }

      // The highlight belongs to the token, not to the transaction. Resetting
      // it on every transaction would undo an arrow keypress, because moving
      // the caret is itself a transaction — the highlight would visibly move
      // and Enter would still insert the first ticket.
      const token = `${next.from}:${next.query}`
      if (openToken.current !== token) {
        openToken.current = token
        setIndex(0)
      }
      setState(next)
    }

    editor.on('transaction', refresh)
    return () => { editor.off('transaction', refresh) }
  }, [editor])

  const select = useCallback((candidate: MentionCandidate) => {
    if (!state) return
    const text = formatMention(candidate.id)

    // An explicit text node, not an HTML string: whatever the editor is asked
    // to parse, this can only ever become characters.
    editor
      .chain()
      .focus()
      .insertContentAt({ from: state.from, to: state.to }, [{ type: 'text', text }])
      .run()

    suppressedAt.current = state.from + text.length
    openToken.current = null
    setState(null)
  }, [editor, state])

  const open = state !== null && items.length > 0

  // Arrow keys and Enter belong to the menu while it is open. The listener is
  // attached in the capture phase on the editor's own node, which runs before
  // ProseMirror's handler on that same node — so no keymap has to be rewired.
  useEffect(() => {
    if (!open) return
    const dom = editor.view.dom

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          setIndex((current) => (current + 1) % items.length)
          break
        case 'ArrowUp':
          setIndex((current) => (current - 1 + items.length) % items.length)
          break
        case 'Enter':
        case 'Tab':
          select(items[index] ?? items[0])
          break
        case 'Escape':
          suppressedAt.current = editor.state.selection.from
          openToken.current = null
          setState(null)
          break
        default:
          return // everything else is the editor's
      }
      event.preventDefault()
      event.stopPropagation()
    }

    dom.addEventListener('keydown', onKeyDown, true)
    return () => { dom.removeEventListener('keydown', onKeyDown, true) }
  }, [editor, open, items, index, select])

  if (!open || !state) return null

  return (
    <ul
      role="listbox"
      aria-label="Mention a ticket"
      style={{ left: state.anchor.left, top: state.anchor.top }}
      className="fixed z-50 max-h-72 w-80 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.map((candidate, position) => (
        <li key={candidate.uuid}>
          <button
            type="button"
            role="option"
            aria-selected={position === index}
            // mousedown, not click: the editor must not lose the selection the
            // insertion is about to replace.
            onMouseDown={(event) => {
              event.preventDefault()
              select(candidate)
            }}
            onMouseEnter={() => setIndex(position)}
            className={`flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
              position === index ? 'bg-accent text-accent-foreground' : ''
            }`}
          >
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{candidate.id}</span>
            <span className="truncate">{candidate.title}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
