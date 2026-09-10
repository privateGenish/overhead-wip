// @vitest-environment jsdom
/**
 * Home's one structural contract worth pinning: anything waiting on a
 * decision leads, above the bench. Child components are stubbed — their own
 * behavior is covered by their own tests; this only protects placement.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/PendingTray', () => ({
  PendingTray: () => <div data-testid="pending-tray">pending</div>,
}))
vi.mock('@/components/Bench', () => ({
  Bench: () => <div data-testid="bench">bench</div>,
}))
vi.mock('@/components/Rail', () => ({
  Rail: () => <div data-testid="rail">rail</div>,
}))

import { Home } from './Home'

describe('Home', () => {
  it('renders the pending tray above the bench', () => {
    render(<Home onOpenTicket={() => {}} onOpenNotes={() => {}} />)

    const tray = screen.getByTestId('pending-tray')
    const bench = screen.getByTestId('bench')
    // DOCUMENT_POSITION_FOLLOWING means `bench` comes after `tray` in the DOM.
    expect(tray.compareDocumentPosition(bench) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders the rail alongside the main column', () => {
    render(<Home onOpenTicket={() => {}} onOpenNotes={() => {}} />)
    expect(screen.getByTestId('rail')).toBeInTheDocument()
  })
})
