// @vitest-environment jsdom
/**
 * The notes grid, and the write cadence behind it.
 *
 * The debounce test is the one with teeth: a note body is a markdown document
 * being typed into, and a write per keystroke costs a synchronous SQL upsert
 * plus a whole-file vault write on the main process's only thread.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { NoteData } from '@/lib/noteClient'

/** Every call the view makes to the data layer, in order. */
const calls = vi.hoisted(() => ({ upsert: [] as NoteData[], deleted: [] as string[] }))
const stored = vi.hoisted(() => [] as NoteData[])

vi.mock('@/lib/noteClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/noteClient')>()),
  noteClient: {
    all: async () => [...stored],
    get: async (uuid: string) => stored.find((note) => note.uuid === uuid) ?? null,
    upsert: async (note: NoteData) => { calls.upsert.push({ ...note }) },
    delete: async (uuid: string) => { calls.deleted.push(uuid) },
  },
}))

/** In-memory `pinned_notes` — the same shape the swap logic reads and writes. */
const pinnedNoteSlots = vi.hoisted(() => [] as { uuid: string; slot: number }[])

vi.mock('@/lib/benchClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/benchClient')>()),
  benchClient: {
    listNoteSlots: async () => [...pinnedNoteSlots],
    pinNote: async (uuid: string) => { pinnedNoteSlots.push({ uuid, slot: pinnedNoteSlots.length }) },
    unpinNote: async (uuid: string) => {
      const i = pinnedNoteSlots.findIndex((s) => s.uuid === uuid)
      if (i >= 0) pinnedNoteSlots.splice(i, 1)
    },
    swapNote: async (outUuid: string, inUuid: string) => {
      const i = pinnedNoteSlots.findIndex((s) => s.uuid === outUuid)
      if (i < 0) return
      const slot = pinnedNoteSlots[i].slot
      pinnedNoteSlots.splice(i, 1)
      pinnedNoteSlots.push({ uuid: inUuid, slot })
    },
  },
}))

// The markdown body editor is ProseMirror, and none of what these tests assert
// runs through it. Stubbing it keeps the grid and the write cadence in view.
vi.mock('novel', () => ({
  EditorRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  EditorContent: () => <div data-testid="note-body" />,
  StarterKit: {},
  Placeholder: { configure: () => ({}) },
}))

import { Notes } from './Notes'
import { persistQueue } from '@/lib/persistQueue'

function note(uuid: string, title: string, body: string): NoteData {
  return { uuid, title, body, created_at: 1, updated_at: 1 }
}

beforeEach(() => {
  calls.upsert.length = 0
  calls.deleted.length = 0
  stored.length = 0
  pinnedNoteSlots.length = 0
  persistQueue.__resetForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Notes grid', () => {
  it('renders a card per note, with its title and a body preview', async () => {
    stored.push(
      note('n1', 'Monetization', '# Income streams\n\nTalk to a friend.'),
      note('n2', 'Roadmap', 'Ship the vault first.'),
    )
    render(<Notes />)

    expect(await screen.findByText('Monetization')).toBeInTheDocument()
    expect(screen.getByText('Roadmap')).toBeInTheDocument()
    // The preview is flattened prose, not raw markdown.
    expect(screen.getByText(/Income streams Talk to a friend/)).toBeInTheDocument()
  })

  it('says so when there are none', async () => {
    render(<Notes />)
    expect(await screen.findByText(/No notes yet/)).toBeInTheDocument()
  })

  it('adds a card when a note is created', async () => {
    stored.push(note('n1', 'Monetization', 'body'))
    render(<Notes />)
    await screen.findByText('Monetization')

    fireEvent.click(screen.getByRole('button', { name: 'New note' }))

    // The new note opens straight into its editor…
    expect(await screen.findByLabelText('Note title')).toHaveValue('Untitled note')
    await waitFor(() => expect(calls.upsert).toHaveLength(1))

    // …and is a card once you come back out.
    fireEvent.click(screen.getByRole('button', { name: 'All notes' }))
    expect(await screen.findByText('Untitled note')).toBeInTheDocument()
    expect(screen.getByText('Monetization')).toBeInTheDocument()
  })

  it('deletes a note only after the confirmation is answered', async () => {
    stored.push(note('n1', 'Doomed', 'body'))
    render(<Notes />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open Doomed' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Doomed' }))

    // The dialog is up and nothing has been deleted yet.
    expect(await screen.findByText('Delete “Doomed”?')).toBeInTheDocument()
    expect(calls.deleted).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }))

    await waitFor(() => expect(calls.deleted).toEqual(['n1']))
    expect(await screen.findByText(/No notes yet/)).toBeInTheDocument()
  })
})

describe('Notes pinning', () => {
  it('pins a note, then unpins it', async () => {
    stored.push(note('n1', 'Monetization', 'body'))
    render(<Notes />)
    await screen.findByText('Monetization')

    fireEvent.click(screen.getByRole('button', { name: 'Pin note' }))
    expect(await screen.findByRole('button', { name: 'Unpin note' })).toBeInTheDocument()
    await waitFor(() => expect(pinnedNoteSlots).toEqual([{ uuid: 'n1', slot: 0 }]))

    fireEvent.click(screen.getByRole('button', { name: 'Unpin note' }))
    expect(await screen.findByRole('button', { name: 'Pin note' })).toBeInTheDocument()
    await waitFor(() => expect(pinnedNoteSlots).toEqual([]))
  })

  it('offers a swap instead of a third pin', async () => {
    stored.push(note('n1', 'First', 'a'), note('n2', 'Second', 'b'), note('n3', 'Third', 'c'))
    pinnedNoteSlots.push({ uuid: 'n1', slot: 0 }, { uuid: 'n2', slot: 1 })
    render(<Notes />)
    await screen.findByText('Third')

    // Only Third is unpinned, so its is the sole "Pin note" button left.
    fireEvent.click(screen.getByRole('button', { name: 'Pin note' }))

    expect(await screen.findByText('Only 2 notes can be pinned')).toBeInTheDocument()
    const swapFirst = screen.getByRole('button', { name: /First/ })
    expect(swapFirst).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Second/ })).toBeInTheDocument()
    expect(pinnedNoteSlots.map((s) => s.uuid)).toEqual(['n1', 'n2']) // unchanged until a choice is made

    fireEvent.click(swapFirst)

    await waitFor(() => expect(pinnedNoteSlots.map((s) => s.uuid)).toEqual(['n2', 'n3']))
    expect(screen.queryByText('Only 2 notes can be pinned')).not.toBeInTheDocument()
  })
})

describe('Notes persistence', () => {
  it('debounces edits into one write instead of one per keystroke', async () => {
    stored.push(note('n1', 'Draft', 'body'))
    render(<Notes />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open Draft' }))
    const title = await screen.findByLabelText('Note title')

    vi.useFakeTimers()
    for (const value of ['D', 'Dr', 'Dra', 'Draf', 'Draft ', 'Draft t', 'Draft two']) {
      fireEvent.change(title, { target: { value } })
    }

    // Still nothing written — the idle window has not elapsed.
    expect(calls.upsert).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1_000)

    expect(calls.upsert).toHaveLength(1)
    expect(calls.upsert[0].title).toBe('Draft two')
  })

  it('lands the pending write when the note is closed', async () => {
    stored.push(note('n1', 'Draft', 'body'))
    render(<Notes />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open Draft' }))
    fireEvent.change(await screen.findByLabelText('Note title'), {
      target: { value: 'Renamed' },
    })
    expect(calls.upsert).toHaveLength(0)

    // Navigating back is a commit point — the edit must not be stranded.
    fireEvent.click(screen.getByRole('button', { name: 'All notes' }))

    await waitFor(() => expect(calls.upsert).toHaveLength(1))
    expect(calls.upsert[0].title).toBe('Renamed')
  })
})
