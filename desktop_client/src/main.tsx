import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTheme } from '@/lib/theme'

// The ticket store is built by `App`, once it knows a project is actually open.
// Building it here was unconditional, which meant a boot with no project (a
// stale pointer, or a directory moved behind the app's back) constructed a
// store against no database and every view threw on first read.

// The theme decides what the first paint looks like, so it is read before
// there is anything to repaint. `finally`, not `then`: a settings read that
// fails leaves the default theme standing rather than a blank window.
void initTheme().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
