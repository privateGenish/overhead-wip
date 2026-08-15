/**
 * Pulling the link out of an argv — the Windows/Linux arrival path.
 *
 * The URL is appended after the app's own arguments, which in dev include the
 * entry script and Electron's own switches, so this scans from the end.
 */
import { describe, it, expect } from 'vitest'
import { extractDeepLink } from './deepLink'

describe('extractDeepLink', () => {
  it('finds the link in a packaged launch argv', () => {
    expect(extractDeepLink(['/Applications/Overhead.app/Overhead', 'overhead://project/p-1/page/execute']))
      .toBe('overhead://project/p-1/page/execute')
  })

  it('finds the link in a dev launch argv, past the entry script', () => {
    expect(extractDeepLink([
      '/path/to/electron', '.', '--inspect', 'overhead://project/p-1/ticket/OVH-3',
    ])).toBe('overhead://project/p-1/ticket/OVH-3')
  })

  it('takes the last link when several are present', () => {
    expect(extractDeepLink(['app', 'overhead://project/p-1/page/home', 'overhead://project/p-2/page/all']))
      .toBe('overhead://project/p-2/page/all')
  })

  it('accepts the scheme in any case, and trims it', () => {
    expect(extractDeepLink(['app', '  OVERHEAD://project/p-1/page/home  ']))
      .toBe('OVERHEAD://project/p-1/page/home')
  })

  it('returns null when the argv holds no link', () => {
    expect(extractDeepLink(['/path/to/electron', '.'])).toBeNull()
    expect(extractDeepLink([])).toBeNull()
    expect(extractDeepLink(['app', 'https://example.com'])).toBeNull()
  })
})
