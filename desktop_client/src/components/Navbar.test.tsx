// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Navbar } from './Navbar'

describe('Navbar', () => {
  it('renders every nav tab', () => {
    render(<Navbar active="Home" onSelect={() => {}} />)
    for (const tab of ['Home', 'Product', 'Explore', 'Execute', 'Backlog', 'All', 'Graph']) {
      expect(screen.getByRole('button', { name: tab })).toBeInTheDocument()
    }
  })

  it('marks the active tab', () => {
    render(<Navbar active="Execute" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Execute' })).toHaveClass('font-medium')
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveClass('font-medium')
  })

  it('reports the clicked tab through onSelect', async () => {
    const onSelect = vi.fn()
    render(<Navbar active="Home" onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: 'Backlog' }))
    expect(onSelect).toHaveBeenCalledWith('Backlog')
  })
})
