// @vitest-environment jsdom
/**
 * Backlog is opt-in on every view now.
 *
 * The All view used to list backlog tickets *and* withhold the control that
 * would take them away — the default filter and the toggle were both gated on
 * a view having a fixed type. Backlog itself is the one exception, since
 * backlog tickets are that view's entire content.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Ticket } from '@/shared/types'

function fakeTicket(id: string, title: string, backlog: boolean): Ticket {
  return {
    uuid: `uuid-${id}`,
    id,
    title,
    type: 'Execute',
    status: { value: 'Draft' },
    backlog,
  } as unknown as Ticket
}

const tickets = vi.hoisted(() => [] as Ticket[])

vi.mock('@/lib/ticketStore', () => ({
  useTickets: () => tickets,
  getTicketStore: () => ({ create: vi.fn() }),
}))

import { TicketView } from './TicketView'

tickets.push(
  fakeTicket('OVH-001', 'Active work', false),
  fakeTicket('OVH-002', 'Parked idea', true),
)

describe('TicketView — backlog visibility', () => {
  it('hides backlog tickets on an unscoped view, and offers the toggle', async () => {
    render(<TicketView />)

    expect(screen.getByText('Active work')).toBeInTheDocument()
    expect(screen.queryByText('Parked idea')).toBeNull()

    await userEvent.click(screen.getByLabelText('Show backlog tickets'))

    expect(screen.getByText('Parked idea')).toBeInTheDocument()
    expect(screen.getByText('Active work')).toBeInTheDocument()
  })

  it('shows backlog tickets on the Backlog view without touching the toggle', () => {
    render(<TicketView filter={(row) => row.backlog} showsBacklog />)

    expect(screen.getByText('Parked idea')).toBeInTheDocument()
    expect(screen.queryByText('Active work')).toBeNull()
  })
})
