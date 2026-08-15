// @vitest-environment jsdom
/**
 * The `@` affordance, against a real TipTap editor.
 *
 * The assertion that matters is the last one in each case: what the editor is
 * holding afterwards. A mention has to reach the markdown as the literal text
 * `@OVH-123` — that is the whole reason this menu inserts a text node instead
 * of a mention node (§2.1), and a stubbed editor could not prove it.
 */
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { EditorRoot, EditorContent, StarterKit } from 'novel'
import type { EditorInstance } from 'novel'
import { Markdown } from 'tiptap-markdown'
import type { Ticket } from '@/shared/types'

function fakeTicket(uuid: string, id: string, title: string): Ticket {
  return { uuid, id, title } as unknown as Ticket
}

const tickets = vi.hoisted(() => [] as unknown[])

vi.mock('@/lib/ticketStore', () => ({
  hasTicketStore: () => true,
  useTickets: () => tickets,
}))

import { MentionMenu } from './MentionMenu'

tickets.push(
  fakeTicket('u1', 'OVH-1', 'Vault round-trip'),
  fakeTicket('u2', 'OVH-10', 'Ticket mentions'),
  fakeTicket('u3', 'SHOP-2', 'Something else'),
)

/** The editor instance the current test is driving. */
let editor: EditorInstance | null = null

/**
 * Read through a function, not directly: `onCreate` assigns from a callback
 * control flow analysis cannot see, so a direct read narrows to `null`.
 */
function currentEditor(): EditorInstance | null {
  return editor
}

function Harness() {
  const [instance, setInstance] = useState<EditorInstance | null>(null)
  return (
    <>
      <EditorRoot>
        <EditorContent
          extensions={[StarterKit, Markdown]}
          onCreate={({ editor: created }) => {
            editor = created
            setInstance(created)
          }}
        />
      </EditorRoot>
      <MentionMenu editor={instance} />
    </>
  )
}

/** Renders the editor and waits for it to exist. */
async function mount(): Promise<EditorInstance> {
  editor = null
  render(<Harness />)
  await waitFor(() => expect(currentEditor()).not.toBeNull())
  const instance = currentEditor()
  if (!instance) throw new Error('The editor never came up.')
  instance.commands.focus()
  return instance
}

/** Types text through the editor, the way a person's keystrokes arrive. */
function type(instance: EditorInstance, text: string): void {
  instance.commands.insertContent(text)
}

/** Sends a key to the editor's DOM node, where the menu is listening. */
function press(instance: EditorInstance, key: string): void {
  fireEvent.keyDown(instance.view.dom, { key })
}

function markdown(instance: EditorInstance): string {
  return (instance.storage.markdown as { getMarkdown: () => string }).getMarkdown()
}

describe('MentionMenu', () => {
  it('opens on @ and lists the project’s tickets', async () => {
    const instance = await mount()

    type(instance, 'blocked by @')

    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveTextContent('OVH-1')
    expect(options[0]).toHaveTextContent('Vault round-trip')
  })

  it('narrows as the query is typed, matching id or title', async () => {
    const instance = await mount()

    type(instance, '@shop')

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(screen.getByRole('option')).toHaveTextContent('SHOP-2')
  })

  it('stays shut mid-word, so an email address is not an autocomplete', async () => {
    const instance = await mount()

    type(instance, 'mail me@')

    await waitFor(() => expect(instance.getText()).toContain('me@'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('inserts plain `@OVH-1` text — no node, no link, no markup', async () => {
    const instance = await mount()

    type(instance, 'blocked by @OVH')
    await screen.findAllByRole('option')
    press(instance, 'Enter')

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())

    // The document holds characters…
    expect(instance.getText()).toBe('blocked by @OVH-1')
    // …the markdown holds the same characters, unescaped and unwrapped…
    expect(markdown(instance)).toBe('blocked by @OVH-1')
    // …and nothing custom made it into the document's structure.
    const json = JSON.stringify(instance.getJSON())
    expect(json).toContain('"text":"blocked by @OVH-1"')
    expect(json).not.toContain('mention')
  })

  it('replaces the typed query rather than appending to it', async () => {
    const instance = await mount()

    type(instance, 'see @OVH-1')
    await screen.findAllByRole('option')
    press(instance, 'Enter')

    await waitFor(() => expect(instance.getText()).toBe('see @OVH-1'))
  })

  it('moves the highlight with the arrow keys and inserts the chosen one', async () => {
    const instance = await mount()

    type(instance, '@OVH')
    await screen.findAllByRole('option')

    press(instance, 'ArrowDown')
    await waitFor(() => expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true'))

    press(instance, 'Enter')

    await waitFor(() => expect(instance.getText()).toBe('@OVH-10'))
  })

  it('inserts on click without stealing the selection first', async () => {
    const instance = await mount()

    type(instance, '@OVH')
    const options = await screen.findAllByRole('option')
    fireEvent.mouseDown(options[0])

    await waitFor(() => expect(instance.getText()).toBe('@OVH-1'))
  })

  it('does not reopen on the id it just inserted', async () => {
    const instance = await mount()

    type(instance, '@OVH')
    await screen.findAllByRole('option')
    press(instance, 'Enter')

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    // Still closed a tick later — the inserted text is itself a valid token.
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on Escape and leaves the typing alone', async () => {
    const instance = await mount()

    type(instance, '@OVH')
    await screen.findAllByRole('option')
    press(instance, 'Escape')

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(instance.getText()).toBe('@OVH')
  })

  it('offers nothing inside a code block, where mentions do not count', async () => {
    const instance = await mount()

    instance.commands.setCodeBlock()
    type(instance, '@OVH')

    await waitFor(() => expect(instance.getText()).toContain('@OVH'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
