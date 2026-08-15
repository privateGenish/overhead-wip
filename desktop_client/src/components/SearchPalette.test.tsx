// @vitest-environment jsdom
/**
 * The palette is the app's first keyboard shortcut, so both halves are pinned
 * here: that ⌘K/Ctrl+K reaches it at all, and that what it searches stays as
 * narrow as decided — active tickets, title and id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Ticket } from '@/shared/types'

const tickets = vi.hoisted(() => [] as Ticket[])

// Mirrors the real store's contract: `useTickets` is the *active* snapshot.
// A palette that reached for the full list instead would fail here.
vi.mock('@/lib/ticketStore', () => ({
  useTickets: () => tickets.filter((ticket) => !ticket.archived),
}))

import { SearchPalette } from './SearchPalette'

function fakeTicket(id: string, title: string, archived = false): Ticket {
  return {
    uuid: `uuid-${id}`,
    id,
    title,
    archived,
    type: 'Execute',
    description: 'monetization model of the thing',
    status: { value: 'Draft' },
  } as unknown as Ticket
}

/** The palette's input, once it is on screen. */
function searchBox(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Search tickets' })
}

/** The ids the palette is currently offering. */
function offeredIds(): string[] {
  // Each row leads with the ticket id, then its title.
  return screen.queryAllByRole('option').map((option) => option.querySelector('span')!.textContent!)
}

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Meta>}k{/Meta}')
  return screen.findByRole('combobox', { name: 'Search tickets' })
}

describe('SearchPalette', () => {
  beforeEach(() => {
    tickets.length = 0
    tickets.push(
      fakeTicket('OVH-001', 'Rework the vault watcher'),
      fakeTicket('OVH-042', 'Ticket relations panel'),
      fakeTicket('SHOP-007', 'Checkout flow research'),
      fakeTicket('OVH-999', 'Long forgotten idea', true),
    )
  })

  it('stays out of the way until the shortcut asks for it', () => {
    render(<SearchPalette onOpenTicket={() => {}} />)
    expect(screen.queryByRole('combobox', { name: 'Search tickets' })).toBeNull()
  })

  it('opens on ⌘K', async () => {
    const user = userEvent.setup()
    render(<SearchPalette onOpenTicket={() => {}} />)

    expect(await openPalette(user)).toBeInTheDocument()
  })

  it('opens on Ctrl+K for the platforms without a ⌘', async () => {
    const user = userEvent.setup()
    render(<SearchPalette onOpenTicket={() => {}} />)

    await user.keyboard('{Control>}k{/Control}')

    expect(await screen.findByRole('combobox', { name: 'Search tickets' })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<SearchPalette onOpenTicket={() => {}} />)
    await openPalette(user)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('combobox', { name: 'Search tickets' })).toBeNull()
  })

  it('filters by title', async () => {
    const user = userEvent.setup()
    render(<SearchPalette onOpenTicket={() => {}} />)
    await user.type(await openPalette(user), 'checkout')

    expect(offeredIds()).toEqual(['SHOP-007'])
  })

  it('filters by ticket id', async () => {
    const user = userEvent.setup()
    render(<SearchPalette onOpenTicket={() => {}} />)
    await user.type(await openPalette(user), 'ovh-042')

    expect(offeredIds()).toEqual(['OVH-042'])
  })

  it('never offers an archived ticket', async () => {
    const user = userEvent.setup()
    render(<SearchPalette onOpenTicket={() => {}} />)
    await openPalette(user)

    expect(offeredIds()).toEqual(['OVH-001', 'OVH-042', 'SHOP-007'])

    await user.type(searchBox(), 'forgotten')

    expect(offeredIds()).toEqual([])
    expect(screen.getByText(/No ticket matches/)).toBeInTheDocument()
  })

  it('opens the chosen ticket and closes itself', async () => {
    const user = userEvent.setup()
    const onOpenTicket = vi.fn()
    render(<SearchPalette onOpenTicket={onOpenTicket} />)
    await user.type(await openPalette(user), 'relations')

    await user.click(screen.getByRole('option'))

    expect(onOpenTicket).toHaveBeenCalledWith('uuid-OVH-042')
    expect(screen.queryByRole('combobox', { name: 'Search tickets' })).toBeNull()
  })
})
