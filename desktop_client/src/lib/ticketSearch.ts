/**
 * Finding a ticket by the two things a person remembers: its title and its id.
 *
 * Deliberately shallow — descriptions and note bodies are **not** searched.
 * The palette is a jump-to-ticket tool, and a body index would make it a
 * different, slower feature. That line is a decision, not an omission.
 *
 * Pure and storage-free: the archived list and the ⌘K palette both search the
 * same way, over whichever tickets their caller hands in.
 */

/** The shape searching needs — anything with a title and an id qualifies. */
export interface SearchableTicket {
  id: string
  title: string
}

/** How many results the palette will show before it stops being a shortcut. */
export const SEARCH_RESULT_LIMIT = 25

/**
 * Fuzzy match: every character of the query appears in order, not necessarily
 * adjacently. Loose enough that `ovh12` finds `OVH-123` and `arcsrch` finds
 * "archive search", which is the point — you type what you half-remember.
 *
 * Both arguments are expected lowercased; callers normalise once rather than
 * per candidate.
 */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  let at = 0
  for (const char of needle) {
    at = haystack.indexOf(char, at)
    if (at === -1) return false
    at++
  }
  return true
}

/** True when the ticket answers the query at all. Empty query matches all. */
export function matchesTicketQuery(ticket: SearchableTicket, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return rank(ticket, needle) !== null
}

/**
 * How well a ticket answers the query — lower is better, `null` is no match.
 *
 * The order encodes what a person means by typing: an id they typed out beats
 * a title that merely contains those letters, and anything literal beats a
 * fuzzy subsequence. Without it `OVH-1` sorts arbitrarily among every ticket
 * whose title happens to contain an o, a v and an h.
 */
function rank(ticket: SearchableTicket, needle: string): number | null {
  const id = ticket.id.toLowerCase()
  const title = ticket.title.toLowerCase()

  if (id.startsWith(needle)) return 0
  if (title.startsWith(needle)) return 1
  if (id.includes(needle)) return 2
  if (title.includes(needle)) return 3
  if (fuzzyMatch(id, needle)) return 4
  if (fuzzyMatch(title, needle)) return 5
  return null
}

/**
 * The tickets that answer `query`, best first, capped at `limit`.
 *
 * An empty query returns the head of the list untouched — the palette opens
 * showing something rather than an empty box, and the caller's order (the
 * store's, which is creation order) is the closest thing to a sensible default
 * ranking that costs nothing.
 */
export function searchTickets<T extends SearchableTicket>(
  tickets: readonly T[],
  query: string,
  limit: number = SEARCH_RESULT_LIMIT,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return tickets.slice(0, limit)

  return tickets
    .map((ticket) => ({ ticket, at: rank(ticket, needle) }))
    .filter((scored): scored is { ticket: T; at: number } => scored.at !== null)
    // Array#sort is stable, so equally-ranked tickets keep the caller's order.
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map((scored) => scored.ticket)
}
