// @vitest-environment jsdom
/**
 * Settings stopped being four placeholders and one real section. What is
 * pinned here is the shape that replaced them: a theme toggle that persists,
 * an account name that persists, no Notifications section at all, and an About
 * that reads as deliberately empty rather than unfinished.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { __resetThemeForTests, initTheme } from '@/lib/theme'

vi.mock('@/lib/ticketStore', () => ({
  getTicketStore: () => ({ deleteAll: vi.fn() }),
}))

import { Settings } from './Settings'

const store = new Map<string, string>()
const appSettings = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
}

/** Moves to a section in the sidebar. */
async function open(section: string) {
  await userEvent.click(screen.getByRole('button', { name: section }))
}

describe('Settings', () => {
  beforeEach(async () => {
    __resetThemeForTests()
    store.clear()
    appSettings.set.mockClear()
    document.documentElement.classList.remove('dark')
    ;(window as unknown as { appSettings: unknown }).appSettings = appSettings
    window.matchMedia = (() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    await initTheme()
  })

  it('has no Notifications section', () => {
    render(<Settings />)
    expect(screen.queryByRole('button', { name: 'Notifications' })).toBeNull()
  })

  it('offers the three theme choices in General', () => {
    render(<Settings />)
    for (const choice of ['Light', 'Dark', 'System']) {
      expect(screen.getByRole('button', { name: choice })).toBeInTheDocument()
    }
    // Nothing stored, so the default is the one marked.
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('persists the theme choice and applies it at once', async () => {
    render(<Settings />)

    await userEvent.click(screen.getByRole('button', { name: 'Dark' }))

    expect(appSettings.set).toHaveBeenCalledWith('theme', 'dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('persists the account name when the field is left', async () => {
    render(<Settings />)
    await open('Account')

    const field = await screen.findByLabelText('Name')
    await userEvent.type(field, 'Ada Lovelace')
    await userEvent.tab()

    expect(appSettings.set).toHaveBeenCalledWith('account.name', 'Ada Lovelace')
  })

  it('reads a stored account name back', async () => {
    store.set('account.name', 'Ada Lovelace')
    render(<Settings />)
    await open('Account')

    expect(await screen.findByLabelText('Name')).toHaveValue('Ada Lovelace')
  })

  it('says About is empty rather than pretending it is coming', async () => {
    render(<Settings />)
    await open('About')

    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument()
    expect(screen.queryByText(/settings will go here/)).toBeNull()
  })
})
