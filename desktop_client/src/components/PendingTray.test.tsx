// @vitest-environment jsdom
/**
 * The pending-ticket tray: what it shows, and that a decision (approve or
 * reject) reaches the data layer with no confirmation step in between —
 * there's nothing at stake here to protect against, by design.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PendingTicket } from '@/lib/pendingClient'

const calls = vi.hoisted(() => ({ approved: [] as string[], rejected: [] as string[] }))
const stored = vi.hoisted(() => [] as PendingTicket[])
const listeners = vi.hoisted(() => new Set<() => void>())

vi.mock('@/lib/pendingClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pendingClient')>()),
  pendingClient: {
    list: async () => [...stored],
    approve: async (uuid: string) => { calls.approved.push(uuid) },
    reject: async (uuid: string) => { calls.rejected.push(uuid) },
  },
}))

import { PendingTray } from './PendingTray'

function draft(uuid: string, title: string, type: PendingTicket['type'], description = ''): PendingTicket {
  return { uuid, title, type, description, created_at: 1 }
}

beforeEach(() => {
  calls.approved.length = 0
  calls.rejected.length = 0
  stored.length = 0
  listeners.clear()
  ;(window as unknown as { db: unknown }).db = {
    onPendingUpdated: (cb: () => void) => {
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
  }
})

describe('PendingTray', () => {
  it('renders nothing when there are no proposals', async () => {
    const { container } = render(<PendingTray />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders a header and one card per proposal, in FIFO order', async () => {
    stored.push(
      draft('p1', 'First idea', 'Explore', 'Worth looking into'),
      draft('p2', 'Second idea', 'Feature'),
    )
    render(<PendingTray />)

    expect(await screen.findByText('Pending (2)')).toBeInTheDocument()
    const titles = (await screen.findAllByRole('heading', { level: 3 })).map((el) => el.textContent)
    expect(titles).toEqual(['First idea', 'Second idea'])
    expect(screen.getByText('Explore')).toBeInTheDocument()
    expect(screen.getByText('Worth looking into')).toBeInTheDocument()
  })

  it('approve calls the client with the right uuid, no confirmation dialog', async () => {
    stored.push(draft('p1', 'First idea', 'Explore'))
    render(<PendingTray />)
    await screen.findByText('First idea')

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(calls.approved).toEqual(['p1']))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reject calls the client with the right uuid, no confirmation dialog', async () => {
    stored.push(draft('p1', 'First idea', 'Explore'))
    render(<PendingTray />)
    await screen.findByText('First idea')

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await waitFor(() => expect(calls.rejected).toEqual(['p1']))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('collapses to just the header on click', async () => {
    stored.push(draft('p1', 'First idea', 'Explore'))
    render(<PendingTray />)
    await screen.findByText('First idea')

    fireEvent.click(screen.getByText('Pending (1)'))

    expect(screen.queryByText('First idea')).not.toBeInTheDocument()
    expect(screen.getByText('Pending (1)')).toBeInTheDocument()
  })

  it('refetches when the main process pushes an update', async () => {
    stored.push(draft('p1', 'First idea', 'Explore'))
    render(<PendingTray />)
    await screen.findByText('Pending (1)')

    stored.push(draft('p2', 'Second idea', 'Feature'))
    listeners.forEach((cb) => cb())

    await screen.findByText('Pending (2)')
    expect(await screen.findByText('Second idea')).toBeInTheDocument()
  })
})
