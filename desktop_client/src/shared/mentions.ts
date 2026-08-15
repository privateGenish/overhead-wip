/**
 * Ticket mentions in markdown — `@OVH-123`.
 *
 * A mention is **plain text and nothing else**. The vault is the interchange
 * format, so a reference has to survive being read, edited and re-saved in any
 * plain text editor; anything richer than the literal characters would not.
 * Extraction is therefore a pure text operation, and this module is imported by
 * both processes — the renderer's editor affordance and the main process's
 * projection into the `mentions` table read the same rules.
 *
 * **What counts as a mention.** `@` immediately followed by an uppercase ticket
 * id: a prefix (`OVH`, `SHOP`), a hyphen, and a number. Prefixes are uppercase
 * by construction — `createProject` upper-cases them — so matching is
 * case-sensitive. That is deliberate: `@shop-1` in prose is far more likely to
 * be a handle or a filename than a ticket.
 *
 * **False positives, and how far this goes.** Silently inventing a backlink is
 * worse than missing one, so three exclusions are applied on purpose:
 *
 * 1. **Not mid-word.** The `@` must not follow a word character, `.`, `-` or a
 *    second `@`, and the id must not run on into more word characters. This is
 *    what rejects email addresses — `a@OVH-1.com` has a local part before the
 *    `@` — and `@OVH-12abc`, which is not an id.
 * 2. **Not in a fenced code block.** ```` ``` ````/`~~~` blocks are dropped
 *    before matching. A ticket id inside a shell snippet is a quotation, not a
 *    reference.
 * 3. **Not in an inline code span.** `` `@OVH-1` `` is the way to *write about*
 *    the syntax without linking, which this document itself relies on.
 *
 * Three known limits, accepted rather than overlooked: indented (four-space)
 * code blocks are treated as prose, because indentation inside lists is far
 * more common than indented code; inline spans are matched within a single
 * line, not across the line breaks CommonMark permits; and a bare
 * `@OVH-1.example.com` with no local part is read as a mention followed by a
 * domain, since it is not an email address either.
 *
 * Ids that no ticket owns are still returned. Extraction is text; resolution
 * happens against the database, one layer up.
 */

/** `@` + uppercase prefix + `-` + number, standing on its own. */
const MENTION_RE = /(?<![\w.@-])@([A-Z][A-Z0-9]*-\d+)(?![\w-])/g

/** An id on its own, with no `@` — for validating what an editor inserted. */
const TICKET_ID_RE = /^[A-Z][A-Z0-9]*-\d+$/

/** Opening and closing fences, allowing CommonMark's three-space indent. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

/** A backtick-delimited span: a run of backticks, content, the same run again. */
const INLINE_CODE_RE = /(`+)(?:(?!\1)[\s\S])*\1/g

/** Blanks out inline code spans, leaving the rest of the line alone. */
function withoutInlineCode(line: string): string {
  return line.replace(INLINE_CODE_RE, ' ')
}

/**
 * Blanks out every code region, keeping the document's line count so callers
 * that care about position still line up.
 */
function withoutCode(markdown: string): string {
  const out: string[] = []
  let fence: string | null = null

  for (const line of markdown.split('\n')) {
    const marker = FENCE_RE.exec(line)?.[1]

    if (fence !== null) {
      // A closing fence is the same character, at least as long as the opener.
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
      out.push('')
      continue
    }

    if (marker) {
      fence = marker
      out.push('')
      continue
    }

    out.push(withoutInlineCode(line))
  }

  return out.join('\n')
}

/**
 * Every distinct ticket id mentioned in a markdown document, in the order it
 * first appears.
 *
 * @param markdown the document body as it is stored — a ticket description or
 * a note body.
 * @returns human ids (`OVH-123`), which may or may not name an existing ticket.
 */
export function extractMentions(markdown: string): string[] {
  if (!markdown) return []

  const found = new Set<string>()
  for (const match of withoutCode(markdown).matchAll(MENTION_RE)) {
    found.add(match[1])
  }
  return [...found]
}

/** True for a well-formed ticket id — `OVH-123`, with no `@`. */
export function isTicketId(value: string): boolean {
  return TICKET_ID_RE.test(value)
}

/** The text a mention of `id` serializes to. The whole serialization contract. */
export function formatMention(id: string): string {
  return `@${id}`
}
