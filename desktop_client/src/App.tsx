import { useState } from 'react'
import { Navbar } from '@/components/Navbar'
import { Home } from '@/views/Home'
import { Execute } from '@/views/Execute'
import { Explore } from '@/views/Explore'
import { Product } from '@/views/Product'
import { Backlog } from '@/views/Backlog'
import { All } from '@/views/All'

const VIEWS: Record<string, React.ReactNode> = {
  'Home': <Home />,
  'Execute': <Execute />,
  'Explore': <Explore />,
  'Product': <Product />,
  'Backlog': <Backlog />,
  'All': <All />,
}

function App() {
  const [active, setActive] = useState('Home')

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Navbar active={active} onSelect={setActive} />
      <main className="flex-1 min-h-0">{VIEWS[active]}</main>
    </div>
  )
}

export default App
