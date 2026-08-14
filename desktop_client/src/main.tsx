import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTicketStore } from '@/lib/ticketStore'

// The store is scoped to the active project, so it is built here — after the
// main process has opened one — rather than at import time. Project switching
// rebuilds it against the new database.
initTicketStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
