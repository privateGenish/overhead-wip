import { useCallback, useEffect, useState } from 'react'
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
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Project } from '@/types/electron'

const VIEWS: Record<string, React.ReactNode> = {
  Home: <Home />,
  Execute: <Execute />,
  Explore: <Explore />,
  Product: <Product />,
  Backlog: <Backlog />,
  All: <All />,
  Graph: <Graph />,
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
const OVERLAY_VIEWS: Record<string, { label: string; view: (ctx: OverlayContext) => React.ReactNode }> = {
  Settings: { label: 'Settings', view: () => <Settings /> },
  Archived: { label: 'Archived Tickets', view: () => <Archived /> },
  Projects: {
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

/**
 * The shell, scoped to one project.
 *
 * `App` remounts this on every project change. That is the point: `active`,
 * `overlay` and every view below them hold state derived from the project that
 * just closed, and remounting invalidates all of it at once instead of leaving
 * each view to notice for itself.
 */
function AppShell({ project, onEntered, onRegistryChanged }: OverlayContext) {
  const [active, setActive] = useState('Home')
  const [overlay, setOverlay] = useState<string | null>(null)

  if (overlay && OVERLAY_VIEWS[overlay]) {
    const { label, view } = OVERLAY_VIEWS[overlay]
    return (
      <div className="h-screen bg-background flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-background">
          <Button variant="ghost" size="sm" onClick={() => setOverlay(null)} className="gap-1 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <main className="flex-1 min-h-0">
          {view({ project, onEntered, onRegistryChanged })}
        </main>
      </div>
    )
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Navbar
        active={active}
        projectName={project?.name}
        onSelect={(tab) => {
          if (tab in OVERLAY_VIEWS) {
            setOverlay(tab)
          } else {
            setActive(tab)
          }
        }}
      />
      <main className="flex-1 min-h-0">{VIEWS[active]}</main>
    </div>
  )
}

function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    let alive = true
    void window.projects.active().then((open) => {
      if (!alive) return
      setProject(open)
      setResolved(true)
    })
    return () => { alive = false }
  }, [])

  /** A rename leaves the uuid alone, so this refreshes without remounting. */
  const refresh = useCallback(() => {
    void window.projects.active().then(setProject)
  }, [])

  // Hold the frame until the active project is known. Rendering the shell
  // first would mount every view, then remount them all once the uuid keyed
  // below arrives — a full teardown for nothing.
  if (!resolved) return <div className="h-screen bg-background" />

  return (
    <AppShell
      key={project?.uuid ?? 'no-project'}
      project={project}
      onEntered={setProject}
      onRegistryChanged={refresh}
    />
  )
}

export default App
