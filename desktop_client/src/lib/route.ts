/**
 * Where the app is — as one serializable value.
 *
 * Navigation used to be two opaque `useState`s, which no link could describe.
 * A `Route` is the same information in a form a URL can carry, so the shell and
 * an `overhead://` link produce the same thing.
 *
 * Two deliberate asymmetries:
 *
 * - A route is **never persisted**. The last-opened *project* is remembered;
 *   the page inside it is not, so every launch starts on Home.
 * - A link names a ticket by its **human id** (`OVH-123`), a route by its uuid.
 *   The id is what a person can see and paste; the uuid is what the app stores.
 *   Resolving one to the other needs the database, so it happens outside this
 *   module — everything here is pure and dependency-free.
 */

export const PAGES = [
  'home', 'product', 'explore', 'execute', 'backlog', 'all', 'graph',
] as const
export type Page = (typeof PAGES)[number]

export const OVERLAYS = ['settings', 'archived', 'projects'] as const
export type Overlay = (typeof OVERLAYS)[number]

export type Route =
  | { kind: 'page'; page: Page }
  | { kind: 'ticket'; uuid: string }
  | { kind: 'view'; viewUuid: string }
  | { kind: 'overlay'; overlay: Overlay }

/** Where the app lands with nothing else to go on. */
export const HOME_ROUTE: Route = { kind: 'page', page: 'home' }

/** What a link points at inside a project. */
export type LinkTarget =
  | { kind: 'page'; page: Page }
  | { kind: 'ticket'; ticketId: string }
  | { kind: 'view'; viewUuid: string }

/** A parsed `overhead://` link: one project, one thing to open in it. */
export interface DeepLink {
  projectUuid: string
  target: LinkTarget
}

export type ParsedDeepLink =
  | { ok: true; link: DeepLink }
  | { ok: false; reason: string }

export const DEEP_LINK_SCHEME = 'overhead://'

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * Parses `overhead://project/<project-uuid>/<kind>/<value>`.
 *
 * The project is named by uuid rather than name because names are renameable
 * and uuids are not — a link keeps working after a rename.
 *
 * Never throws: anything unreadable comes back as `{ ok: false }` carrying a
 * sentence fit to show a person. A link arrives from outside the app, so
 * malformed input is expected rather than exceptional.
 */
export function parseDeepLink(raw: string): ParsedDeepLink {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text.toLowerCase().startsWith(DEEP_LINK_SCHEME)) {
    return { ok: false, reason: `Not an Overhead link: “${text || String(raw)}”.` }
  }

  // Query and fragment are not part of the address; nothing here reads them.
  const body = text.slice(DEEP_LINK_SCHEME.length).split(/[?#]/)[0]

  let segments: string[]
  try {
    segments = body.split('/').filter((part) => part !== '').map(decodeURIComponent)
  } catch {
    return { ok: false, reason: `That link is not readable text: “${text}”.` }
  }

  // The scheme's host is the literal word `project`; some platforms hand it
  // back lowercased, so compare that way throughout.
  if (segments[0]?.toLowerCase() !== 'project' || !segments[1]) {
    return { ok: false, reason: `That link does not name a project: “${text}”.` }
  }
  const projectUuid = segments[1]

  const kind = segments[2]?.toLowerCase()
  const value = segments[3]
  if (!kind || !value) {
    return { ok: false, reason: `That link does not name anything to open: “${text}”.` }
  }
  if (segments.length > 4) {
    return { ok: false, reason: `That link has more in it than Overhead understands: “${text}”.` }
  }

  switch (kind) {
    case 'ticket':
      // Ids are uppercase by construction (`OVH-12`); normalising here means a
      // link that was lowercased in transit still finds its ticket.
      return { ok: true, link: { projectUuid, target: { kind: 'ticket', ticketId: value.toUpperCase() } } }

    case 'page': {
      const page = value.toLowerCase()
      if (!isPage(page)) {
        return { ok: false, reason: `“${value}” is not a page in Overhead.` }
      }
      return { ok: true, link: { projectUuid, target: { kind: 'page', page } } }
    }

    case 'view':
      return { ok: true, link: { projectUuid, target: { kind: 'view', viewUuid: value } } }

    default:
      return {
        ok: false,
        reason: `An Overhead link can open a ticket, a page or a view — not “${segments[2]}”.`,
      }
  }
}

/** The inverse of `parseDeepLink`. */
export function formatDeepLink({ projectUuid, target }: DeepLink): string {
  const tail =
    target.kind === 'ticket' ? `ticket/${encodeURIComponent(target.ticketId)}`
    : target.kind === 'page' ? `page/${target.page}`
    : `view/${encodeURIComponent(target.viewUuid)}`
  return `${DEEP_LINK_SCHEME}project/${encodeURIComponent(projectUuid)}/${tail}`
}

// ---------------------------------------------------------------------------
// Navbar labels
// ---------------------------------------------------------------------------

export function isPage(value: string): value is Page {
  return (PAGES as readonly string[]).includes(value)
}

export function isOverlay(value: string): value is Overlay {
  return (OVERLAYS as readonly string[]).includes(value)
}

/** `'home'` → `'Home'`. The navbar's labels are the route names, title-cased. */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * The navbar tab a route lights up. A ticket is opened from the All view and a
 * graph view from Graph, so both report their host tab rather than nothing.
 */
export function navLabelForRoute(route: Route): string {
  switch (route.kind) {
    case 'page':    return titleCase(route.page)
    case 'ticket':  return 'All'
    case 'view':    return 'Graph'
    case 'overlay': return titleCase(route.overlay)
  }
}

/** The route behind a navbar label, or null when the label names neither. */
export function routeForNavLabel(label: string): Route | null {
  const name = label.toLowerCase()
  if (isPage(name)) return { kind: 'page', page: name }
  if (isOverlay(name)) return { kind: 'overlay', overlay: name }
  return null
}
