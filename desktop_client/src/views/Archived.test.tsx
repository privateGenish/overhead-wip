// @vitest-environment jsdom
/**
 * The archived list is the only place an archived ticket can be found (the ⌘K
 * palette skips them) and the only place one can be permanently deleted. Both
 * of those are covered here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Ticket } from '@/shared/types'

const tickets = vi.hoisted(() => [] as Ticket[])

vi.mock('@/lib/ticketStore', () => ({
  useArchivedTickets: () => tickets,
}))

import { Archived } from './Archived'

function fakeTicket(id: string, title: string): Ticket {
  return {
    uuid: `uuid-${id}`,
    id,
    title,
    type: 'Execute',
    status: { value: 'Draft' },
    setArchived: vi.fn(),
    delete: vi.fn(),
  } as unknown as Ticket
}

/** Which tickets the list is currently showing, by id. */
function visibleIds(): string[] {
  return screen.getAllByRole('button', { name: /^Delete / })
    .map((button) => button.getAttribute('aria-label')!.replace('Delete ', ''))
}

describe('Archived — inline search', () => {
  beforeEach(() => {
    tickets.length = 0
    tickets.push(
      fakeTicket('OVH-001', 'Rework the vault watcher'),
      fakeTicket('OVH-042', 'Ticket relations panel'),
      fakeTicket('SHOP-007', 'Checkout flow research'),
    )
  })

  it('filters by title', async () => {
    render(<Archived />)
    expect(visibleIds()).toHaveLength(3)

    await userEvent.type(screen.getByLabelText('Search archived tickets'), 'checkout')

    expect(visibleIds()).toEqual(['SHOP-007'])
  })

  it('filters by ticket id', async () => {
    render(<Archived />)

    await userEvent.type(screen.getByLabelText('Search archived tickets'), 'ovh-042')

    expect(visibleIds()).toEqual(['OVH-042'])
  })

  it('says so when nothing matches, rather than showing an empty page', async () => {
    render(<Archived />)

    await userEvent.type(screen.getByLabelText('Search archived tickets'), 'zzzz')

    expect(screen.queryAllByRole('button', { name: /^Delete / })).toHaveLength(0)
    expect(screen.getByText(/No archived ticket matches/)).toBeInTheDocument()
  })
})

describe('Archived — permanent delete', () => {
  beforeEach(() => {
    tickets.length = 0
    tickets.push(fakeTicket('OVH-001', 'Rework the vault watcher'))
  })

  it('deletes only after the confirmation is accepted', async () => {
    render(<Archived />)
    const ticket = tickets[0]

    await userEvent.click(screen.getByRole('button', { name: 'Delete OVH-001' }))
    expect(await screen.findByText('Delete OVH-001?')).toBeInTheDocument()
    expect(ticket.delete).not.toHaveBeenCalled() // opening the dialog deletes nothing

    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete permanently' }))
    expect(ticket.delete).toHaveBeenCalledTimes(1)
  })

  it('leaves the ticket alone when the confirmation is dismissed', async () => {
    render(<Archived />)
    const ticket = tickets[0]

    await userEvent.click(screen.getByRole('button', { name: 'Delete OVH-001' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(ticket.delete).not.toHaveBeenCalled()
  })
})
