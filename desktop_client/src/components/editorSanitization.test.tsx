// @vitest-environment jsdom
/**
 * Verifies the precondition `SECURITY-renderer-raw-sql.md` has carried as
 * UNVERIFIED since it was written: "rich text is sanitized — no script
 * execution from ticket content".
 *
 * Why it matters here more than in most apps: the renderer holds an
 * arbitrary-SQL primitive (`window.db.ticket(sql)`), and that trade-off is
 * documented as acceptable *only while* content cannot execute script. Ticket
 * and note bodies are not all typed by the user — the vault watcher ingests
 * markdown edited by anything on disk, so this is a genuine untrusted-input
 * path, not a hypothetical one.
 *
 * The protection is structural rather than a filter: `tiptap-markdown` renders
 * markdown to HTML, and ProseMirror parses that against the editor's schema.
 * Anything the schema does not define — script, iframe, event handlers — has
 * nowhere to land and is dropped. These tests assert that, so the claim in the
 * doc rests on something.
 */
import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { EditorRoot, EditorContent, StarterKit } from 'novel'
import type { EditorInstance } from 'novel'
import { Markdown } from 'tiptap-markdown'

const extensions = [StarterKit, Markdown]

/** Loads `content` into a real editor and returns what survived. */
async function loadIntoEditor(content: string): Promise<{ html: string; text: string }> {
  let editor: EditorInstance | null = null

  render(
    <EditorRoot>
      <EditorContent
        extensions={extensions}
        onCreate={({ editor: created }) => {
          created.commands.setContent(content, false)
          editor = created
        }}
      />
    </EditorRoot>,
  )

  await waitFor(() => { expect(editor).not.toBeNull() })
  const live = editor as unknown as EditorInstance
  return { html: live.getHTML(), text: live.getText() }
}

describe('editor content sanitization', () => {
  it('drops a script tag hidden in ingested markdown', async () => {
    const { html } = await loadIntoEditor(
      'Looks ordinary.\n\n<script>window.__pwned = true</script>',
    )

    expect(html).not.toContain('<script')
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('drops inline event handlers', async () => {
    const { html } = await loadIntoEditor('<p onclick="window.__pwned = true">Click me</p>')

    expect(html).not.toContain('onclick')
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('drops an iframe', async () => {
    const { html } = await loadIntoEditor('<iframe src="https://example.com"></iframe>')
    expect(html).not.toContain('<iframe')
  })

  it('drops an img with an onerror handler — the classic no-script vector', async () => {
    const { html } = await loadIntoEditor('<img src="x" onerror="window.__pwned = true">')

    expect(html).not.toContain('onerror')
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('keeps ordinary formatting — the schema is a whitelist, not a wrecking ball', async () => {
    const { html, text } = await loadIntoEditor('# Title\n\nSome **bold** text.')

    expect(html).toContain('<h1')
    expect(html).toContain('<strong>')
    expect(text).toContain('Some bold text.')
  })

  it('keeps a mention as plain text through the same path', async () => {
    // Mentions arrive as literal text (§2.1); sanitization must not eat them.
    const { text } = await loadIntoEditor('Blocked by @OVH-123.')
    expect(text).toContain('@OVH-123')
  })
})
