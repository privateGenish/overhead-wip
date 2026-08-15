/**
 * The logic behind the editor's `@` autocomplete, kept out of the component.
 *
 * Detecting the trigger and ranking the candidates are both pure functions of
 * text, so they are testable without a ProseMirror instance — which is most of
 * why they live here. What the menu *inserts* is not decided here at all: it is
 * always `formatMention(id)`, plain text, per §2.1.
 */

/** A ticket the menu can offer. Enough to show a row and insert a reference. */
export interface MentionCandidate {
  uuid: string
  id: string
  title: string
}

/** An open `@…` token: what has been typed, and where the `@` sits. */
export interface MentionQuery {
  /** The characters after `@`, possibly empty. */
  query: string
  /** Offset of the `@` within the text that was searched. */
  start: number
}

/**
 * The trigger. `@` must open a word — the same rule the parser applies, so the
 * menu never offers to complete something extraction would then ignore.
 */
const TRIGGER_RE = /(?:^|[\s([{<"'])@([A-Za-z0-9-]*)$/

/**
 * Past this many characters the `@` was almost certainly not a mention, and
 * leaving the menu open across a whole sentence is worse than closing it.
 */
const MAX_QUERY = 24

/**
 * Finds the mention being typed at the end of `textBefore` — the text from the
 * start of the current block up to the caret.
 *
 * The query is matched case-insensitively downstream, so `@ov` narrows as
 * happily as `@OV`; the id that gets inserted is always the ticket's own
 * uppercase one.
 *
 * @returns the open token, or null when the caret is not in one.
 */
export function mentionQueryAt(textBefore: string): MentionQuery | null {
  const match = TRIGGER_RE.exec(textBefore)
  if (!match) return null

  const query = match[1]
  if (query.length > MAX_QUERY) return null

  return { query, start: textBefore.length - query.length - 1 }
}

/**
 * Orders candidates for a query: id matches before title matches, prefixes
 * before mid-string hits, and the caller's order preserved within each band.
 *
 * Anything that matches nowhere is dropped, so an empty result means "close the
 * menu" rather than "show everything".
 */
export function rankMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  limit: number,
): MentionCandidate[] {
  const needle = query.trim().toLowerCase()

  // With nothing typed yet, the whole list is the answer — most recent first is
  // not knowable here, so the caller's order stands.
  if (!needle) return candidates.slice(0, limit)

  const scored: { candidate: MentionCandidate; score: number }[] = []
  for (const candidate of candidates) {
    const id = candidate.id.toLowerCase()
    const title = candidate.title.toLowerCase()

    // Exact first, or typing `@OVH-1` in full would still offer `OVH-10` ahead
    // of the ticket the person plainly meant.
    const score =
      id === needle ? 0
      : id.startsWith(needle) ? 1
      : id.includes(needle) ? 2
      : title.startsWith(needle) ? 3
      : title.includes(needle) ? 4
      : -1

    if (score >= 0) scored.push({ candidate, score })
  }

  return scored
    .map((entry, order) => ({ ...entry, order }))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.candidate)
}
