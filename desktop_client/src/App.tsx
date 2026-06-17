import { useState } from 'react'
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
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

const VIEWS: Record<string, React.ReactNode> = {
  Home: <Home />,
  Execute: <Execute />,
  Explore: <Explore />,
  Product: <Product />,
  Backlog: <Backlog />,
  All: <All />,
  Graph: <Graph />,
}

const OVERLAY_VIEWS: Record<string, { label: string; view: React.ReactNode }> = {
  Settings: { label: 'Settings', view: <Settings /> },
  Archived: { label: 'Archived Tickets', view: <Archived /> },
}

function App() {
  const [active, setActive] = useState('Home')
  const [overlay, setOverlay] = useState<string | null>(null)

  function openOverlay(name: string) {
    setOverlay(name)
  }

  function closeOverlay() {
    setOverlay(null)
  }

  if (overlay && OVERLAY_VIEWS[overlay]) {
    const { label, view } = OVERLAY_VIEWS[overlay]
    return (
      <div className="h-screen bg-background flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-background">
          <Button variant="ghost" size="sm" onClick={closeOverlay} className="gap-1 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <main className="flex-1 min-h-0">{view}</main>
      </div>
    )
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Navbar active={active} onSelect={(tab) => {
        if (tab in OVERLAY_VIEWS) {
          openOverlay(tab)
        } else {
          setActive(tab)
        }
      }} />
      <main className="flex-1 min-h-0">{VIEWS[active]}</main>
    </div>
  )
}

export default App
