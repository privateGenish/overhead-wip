// @vitest-environment jsdom
/**
 * Two things are easy to get wrong here and both are pinned below: that the
 * choice is read back from global storage at boot, and that "System" keeps
 * following the OS afterwards rather than sampling it once at launch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initTheme, setTheme, resolveTheme, __resetThemeForTests } from './theme'

/** A `matchMedia` whose answer the test controls, and can change. */
function installMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    matches: dark,
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener) },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener) },
  }
  window.matchMedia = (() => query) as unknown as typeof window.matchMedia
  return {
    /** The OS flips. */
    change(next: boolean) {
      query.matches = next
      for (const listener of listeners) listener()
    },
  }
}

const store = new Map<string, string>()
const appSettings = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
}

function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

describe('theme', () => {
  beforeEach(() => {
    __resetThemeForTests()
    store.clear()
    appSettings.get.mockClear()
    appSettings.set.mockClear()
    document.documentElement.classList.remove('dark')
    ;(window as unknown as { appSettings: unknown }).appSettings = appSettings
    installMatchMedia(false)
  })

  it('defaults to following the system when nothing is stored', async () => {
    await initTheme()
    expect(isDark()).toBe(false)
  })

  it('persists the choice globally', async () => {
    await initTheme()
    await setTheme('dark')

    expect(appSettings.set).toHaveBeenCalledWith('theme', 'dark')
    expect(store.get('theme')).toBe('dark')
    expect(isDark()).toBe(true)
  })

  it('reads the stored choice back at boot', async () => {
    store.set('theme', 'dark')
    await initTheme()

    expect(isDark()).toBe(true)
  })

  it('ignores a stored value that is not a theme', async () => {
    store.set('theme', 'obsidian')
    await initTheme()

    expect(resolveTheme()).toBe('light') // fell back to system, which is light
  })

  it('follows the OS live while set to System', async () => {
    const os = installMatchMedia(false)
    await initTheme()
    expect(isDark()).toBe(false)

    os.change(true)

    expect(isDark()).toBe(true)
  })

  it('stops following the OS once a mode is chosen', async () => {
    const os = installMatchMedia(false)
    await initTheme()
    await setTheme('light')

    os.change(true)

    expect(isDark()).toBe(false)
  })

  it('starts dark when the OS is dark and the choice is System', async () => {
    installMatchMedia(true)
    await initTheme()

    expect(isDark()).toBe(true)
  })
})
