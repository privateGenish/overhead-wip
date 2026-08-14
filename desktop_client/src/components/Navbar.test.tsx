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

  it('labels the dropdown with the open project', () => {
    render(<Navbar active="Home" onSelect={() => {}} projectName="Shop" />)
    expect(screen.getByRole('button', { name: 'Shop' })).toBeInTheDocument()
    expect(screen.queryByText('Project Name')).toBeNull()
  })

  it('says so when no project is open', () => {
    render(<Navbar active="Home" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'No project' })).toBeInTheDocument()
  })

  it('renders no nameless + button', () => {
    render(<Navbar active="Home" onSelect={() => {}} projectName="Shop" />)
    // Seven tabs, Notes, and the project dropdown trigger. The dead `+` used to
    // sit alongside them with no onClick and no accessible name.
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(9)
    for (const button of buttons) {
      expect(button).toHaveAccessibleName()
    }
  })

  it('opens the launcher from the project dropdown', async () => {
    const onSelect = vi.fn()
    render(<Navbar active="Home" onSelect={onSelect} projectName="Shop" />)
    await userEvent.click(screen.getByRole('button', { name: 'Shop' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Projects' }))
    expect(onSelect).toHaveBeenCalledWith('Projects')
  })
})
