import { useState } from 'react'
import { Navbar } from '@/components/Navbar'
import { Home } from '@/views/Home'
import { Execute } from '@/views/Execute'
import { RnD } from '@/views/RnD'
import { Vision } from '@/views/Vision'
import { Features } from '@/views/Features'
import { Backlog } from '@/views/Backlog'
import { All } from '@/views/All'

const VIEWS: Record<string, React.ReactNode> = {
  'Home': <Home />,
  'Execute': <Execute />,
  'R&D': <RnD />,
  'Vision': <Vision />,
  'Features': <Features />,
  'Backlog': <Backlog />,
  'All': <All />,
}

function App() {
  const [active, setActive] = useState('Home')

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar active={active} onSelect={setActive} />
      {VIEWS[active]}
    </div>
  )
}

export default App
