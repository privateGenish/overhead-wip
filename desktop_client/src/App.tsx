import { useCallback, useEffect, useRef, useState } from 'react'
import { Navbar } from '@/components/Navbar'
import { Home } from '@/views/Home'
import { Execute } from '@/views/Execute'
import { Explore } from '@/views/Explore'
import { Product } from '@/views/Product'
import { Backlog } from '@/views/Backlog'
import { All } from '@/views/All'
import { Graph } from '@/views/Graph'
import { Settings } from '@/views/Settings'
import { Archived } from '@/views/Archived'
import { Projects } from '@/views/Projects'
import { TicketView } from '@/components/TicketView'
import { ChevronLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { initTicketStore } from '@/lib/ticketStore'
import { resolveDeepLink } from '@/lib/deepLinkRouter'
import { readableError } from '@/lib/ipcError'
import {
  HOME_ROUTE,
  navLabelForRoute,
  routeForNavLabel,
  type Overlay,
  type Page,
  type Route,
} from '@/lib/route'
import type { Project } from '@/types/electron'

const PAGE_VIEWS: Record<Page, React.ReactNode> = {
  home: <Home />,
  product: <Product />,
  explore: <Explore />,
  execute: <Execute />,
  backlog: <Backlog />,
  all: <All />,
  graph: <Graph />,
}

/** What an overlay view needs from the shell to render. */
interface OverlayContext {
  project: Project | null
  onEntered: (project: Project) => void
  onRegistryChanged: () => void
}

/**
 * Overlays replace the whole shell rather than float above it. They take a
 * factory instead of a ready-made element because the launcher needs the
 * shell's project state; the two that do not simply ignore the argument.
 */
const OVERLAY_VIEWS: Record<Overlay, { label: string; view: (ctx: OverlayContext) => React.ReactNode }> = {
  settings: { label: 'Settings', view: () => <Settings /> },
  archived: { label: 'Archived Tickets', view: () => <Archived /> },
  projects: {
    label: 'Projects',
    view: (ctx) => (
      <Projects
        activeProject={ctx.project}
        onEntered={ctx.onEntered}
        onRegistryChanged={ctx.onRegistryChanged}
      />
    ),
  },
}

/** The one thing a deep link can produce that the user must be told about. */
function LinkMessage({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <span className="flex-1">{message}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss message"
        onClick={onDismiss}
        className="text-destructive"
      >
        <X />
      </Button>
    </div>
  )
}

interface AppShellProps extends OverlayContext {
  project: Project
  route: Route
  onRoute: (route: Route) => void
  linkError: string | null
  onDismissLink: () => void
}

/**
 * The shell, scoped to one project.
 *
 * `App` remounts this on every project change. That is the point: every view
 * below holds state derived from the project that just closed, and remounting
 * invalidates all of it at once instead of leaving each view to notice for
 * itself.
 *
 * The route is owned by `App` rather than here, because a deep link can change
 * project and route in the same step and the two must land together.
 */
function AppShell({
  project, route, onRoute, linkError, onDismissLink, onEntered, onRegistryChanged,
}: AppShellProps) {
  // Overlays replace the screen, so "Back" has to know what it covered.
  const covered = useRef<Route>(HOME_ROUTE)
  useEffect(() => {
    if (route.kind !== 'overlay') covered.current = route
  }, [route])

  if (route.kind === 'overlay') {
    const { label, view } = OVERLAY_VIEWS[route.overlay]
    return (
      <div className="h-screen bg-background flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-background">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRoute(covered.current)}
            className="gap-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <LinkMessage message={linkError} onDismiss={onDismissLink} />
        <main className="flex-1 min-h-0">
          {view({ project, onEntered, onRegistryChanged })}
        </main>
      </div>
    )
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Navbar
        active={navLabelForRoute(route)}
        projectName={project.name}
        onSelect={(label) => {
          const next = routeForNavLabel(label)
          if (next) onRoute(next)
        }}
      />
      <LinkMessage message={linkError} onDismiss={onDismissLink} />
      <main className="flex-1 min-h-0">{renderRoute(route)}</main>
    </div>
  )
}

/**
 * A ticket and a graph view are addresses in their own right, so they render
 * directly rather than by driving the host page's internal state. Both are
 * keyed on their target: following a second link replaces the view instead of
 * reconciling it against the first one's state.
 */
function renderRoute(route: Route): React.ReactNode {
  switch (route.kind) {
    case 'page':   return PAGE_VIEWS[route.page]
    case 'ticket': return <TicketView key={route.uuid} initialTicketUuid={route.uuid} />
    case 'view':   return <Graph key={route.viewUuid} initialViewUuid={route.viewUuid} />
    case 'overlay': return null // handled above — overlays own the whole frame
  }
}

function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [resolved, setResolved] = useState(false)
  // Deliberately not persisted: A1 remembers the last project, never the page.
  const [route, setRoute] = useState<Route>(HOME_ROUTE)
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.projects.active().then((open) => {
      if (!alive) return
      // The ticket store is scoped to a project's database. With none open
      // there is nothing to build it against, so the launcher renders instead
      // and the store stays absent rather than broken.
      if (open) initTicketStore()
      setProject(open)
      setResolved(true)
    })
    return () => { alive = false }
  }, [])

  // Deep links are handled outside React's data flow, so the handler reads the
  // open project through a ref rather than closing over a stale render.
  const openProjectRef = useRef<Project | null>(null)
  useEffect(() => { openProjectRef.current = project }, [project])

  const openLink = useCallback(async (url: string) => {
    try {
      const outcome = await resolveDeepLink(url, openProjectRef.current?.uuid ?? null)
      if (outcome.entered) setProject(outcome.entered)
      if (outcome.route) setRoute(outcome.route)
      setLinkError(outcome.error)
    } catch (err) {
      // A failed switch leaves the app with no store and possibly no project;
      // re-read the truth from main rather than guessing at it.
      setProject(await window.projects.active())
      setRoute(HOME_ROUTE)
      setLinkError(readableError(err))
    }
  }, [])

  useEffect(() => window.deepLink?.onOpen((url) => { void openLink(url) }), [openLink])

  /** Entering a project is a fresh start: new tree, default page, no message. */
  const enterProject = useCallback((entered: Project) => {
    setProject(entered)
    setRoute(HOME_ROUTE)
    setLinkError(null)
  }, [])

  /** A rename leaves the uuid alone, so this refreshes without remounting. */
  const refresh = useCallback(() => {
    void window.projects.active().then(setProject)
  }, [])

  // Hold the frame until the active project is known. Rendering the shell
  // first would mount every view, then remount them all once the uuid keyed
  // below arrives — a full teardown for nothing.
  if (!resolved) return <div className="h-screen bg-background" />

  // No project — a stale pointer, a moved directory, or a deleted last project.
  // The launcher is the whole app in that state: there is no database for the
  // navbar's views to read, so none of them are offered.
  if (!project) {
    return (
      <div className="h-screen bg-background flex flex-col overflow-hidden">
        <LinkMessage message={linkError} onDismiss={() => setLinkError(null)} />
        <main className="flex-1 min-h-0">
          <Projects
            activeProject={null}
            onEntered={enterProject}
            onRegistryChanged={refresh}
          />
        </main>
      </div>
    )
  }

  return (
    <AppShell
      key={project.uuid}
      project={project}
      route={route}
      onRoute={setRoute}
      linkError={linkError}
      onDismissLink={() => setLinkError(null)}
      onEntered={enterProject}
      onRegistryChanged={refresh}
    />
  )
}

export default App
