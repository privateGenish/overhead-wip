/**
 * Light, dark, or whatever the OS is doing.
 *
 * The palette for both modes has been in `index.css` since the beginning; what
 * was missing was any way to reach the other one. This is that switch.
 *
 * The choice is **global** (§1.6) — it describes the person, not the project,
 * so switching projects must not change how the app looks.
 *
 * A module-level store rather than context: the theme is read by the settings
 * form and by the graph canvas, which sit in different subtrees, and it has to
 * be applied during boot before anything renders.
 */

import { useSyncExternalStore } from 'react'
import { getGlobalSetting, setGlobalSetting } from './appSettings'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system']

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** The class `index.css`'s `dark` variant keys off. */
const DARK_CLASS = 'dark'

let choice: ThemeChoice = 'system'
let watching = false
const listeners = new Set<() => void>()

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value)
}

/** `matchMedia` is absent in jsdom and in any non-browser host — assume light. */
function systemPrefersDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? false
}

/** What `choice` means right now. Only `system` can change without a click. */
export function resolveTheme(of: ThemeChoice = choice): ResolvedTheme {
  if (of === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return of
}

function paint(): void {
  document.documentElement.classList.toggle(DARK_CLASS, resolveTheme() === 'dark')
}

function announce(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Reads the stored choice and starts following the OS. Call once, at boot,
 * before the first render — a repaint from light to dark a frame in is exactly
 * the flash this ordering avoids.
 *
 * The OS listener is attached unconditionally and stays attached: `paint()`
 * ignores it unless the choice is `system`, which is cheaper and less
 * error-prone than wiring and unwiring it on every change.
 */
export async function initTheme(): Promise<void> {
  if (!watching) {
    watching = true
    window.matchMedia?.(DARK_QUERY).addEventListener('change', () => {
      // Light and dark are decisions; only "System" is a subscription.
      if (choice !== 'system') return
      paint()
      announce()
    })
  }

  const stored = await getGlobalSetting('theme')
  choice = isThemeChoice(stored) ? stored : 'system'
  paint()
  announce()
}

/** Applies a choice immediately, then persists it. */
export async function setTheme(next: ThemeChoice): Promise<void> {
  choice = next
  paint()
  announce()
  await setGlobalSetting('theme', next)
}

/** The stored choice — `'system'` included, which is what the toggle shows. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => choice)
}

/** The mode actually on screen. For anything that must be told, not styled. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, () => resolveTheme())
}

/** Drops the module state between tests. */
export function __resetThemeForTests(): void {
  choice = 'system'
  watching = false
  listeners.clear()
}
