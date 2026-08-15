import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// The ticket store is built by `App`, once it knows a project is actually open.
// Building it here was unconditional, which meant a boot with no project (a
// stale pointer, or a directory moved behind the app's back) constructed a
// store against no database and every view threw on first read.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
