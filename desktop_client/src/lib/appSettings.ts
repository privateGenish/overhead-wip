/**
 * The global settings a person carries between projects.
 *
 * Two stores exist and they are not interchangeable (§1.6): a project's
 * `settings` table holds `vision.*` and its id counter, while these live in
 * `global.db/app_settings` and survive a project switch.
 *
 * Access is typed against a defaults registry rather than free string keys —
 * the key count roughly doubled this round, and `settingGet('thmee')` fails
 * silently by returning null forever.
 */

/** Every global key, with the value to use when nothing is stored yet. */
export const GLOBAL_DEFAULTS = {
  theme: 'system',
  'account.name': '',
} as const satisfies Record<string, string>

export type GlobalSettingKey = keyof typeof GLOBAL_DEFAULTS

/**
 * Reads a global setting, falling back to its default.
 *
 * Tolerates the bridge being absent — a non-Electron host (tests, `vite dev`
 * alone) gets defaults rather than a crash, which matters because the theme is
 * read during boot.
 */
export async function getGlobalSetting(key: GlobalSettingKey): Promise<string> {
  const stored = await window.appSettings?.get(key)
  return stored ?? GLOBAL_DEFAULTS[key]
}

/** Writes a global setting. Silently does nothing without the bridge. */
export async function setGlobalSetting(key: GlobalSettingKey, value: string): Promise<void> {
  await window.appSettings?.set(key, value)
}
