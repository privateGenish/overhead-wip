// @vitest-environment jsdom
/**
 * Booting with no project open.
 *
 * `resolveBootProject()` returns null whenever the pointer is stale or the
 * project directory has moved, and the renderer used to build its ticket store
 * regardless — against no database, so every view threw on first read. The
 * launcher is the whole app in that state, and it must come up without a store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/** Records store construction so the test can prove it did not happen. */
const steps = vi.hoisted(() => [] as string[])

vi.mock('@/lib/ticketStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ticketStore')>()),
  initTicketStore: () => { steps.push('initTicketStore') },
}))

import App from './App'
import { hasTicketStore } from '@/lib/ticketStore'
import type { Project } from '@/types/electron'

const alpha: Project = { uuid: 'u-alpha', name: 'Alpha', prefix: 'ALP', created_at: 1 }

function installProjectsApi(active: Project | null) {
  ;(window as unknown as { projects: unknown }).projects = {
    list: async () => [alpha],
    active: async () => active,
    create: async () => alpha,
    rename: async () => alpha,
    remove: async (uuid: string) => ({ uuid }),
    switch: async () => alpha,
  }
}

describe('App — no project open', () => {
  beforeEach(() => {
    steps.length = 0
    installProjectsApi(null)
  })

  it('renders the projects launcher instead of the shell', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
    // The launcher is usable: the existing projects are listed and creating
    // one is offered.
    expect(await screen.findByRole('button', { name: 'Open Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    // No shell: the navbar's views have no database to read.
    expect(screen.queryByRole('button', { name: 'Execute' })).toBeNull()
  })

  it('builds no ticket store', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Projects' })

    expect(steps).not.toContain('initTicketStore')
    expect(hasTicketStore()).toBe(false)
  })
})
