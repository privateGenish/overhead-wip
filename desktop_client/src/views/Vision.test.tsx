// @vitest-environment jsdom
/**
 * The Vision tab was restyled from a two-box form into a page. Presentation is
 * not what this pins — where the two sections *save to* is. Both still write to
 * the same per-project settings keys they always have.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const calls = vi.hoisted(() => ({ read: [] as string[], written: [] as [string, string][] }))

vi.mock('@/lib/generalClient', () => ({
  generalClient: {
    settingGet: async (key: string) => { calls.read.push(key); return '' },
    settingSet: async (key: string, value: string) => { calls.written.push([key, value]) },
  },
}))

// ProseMirror is not what is under test; this stands in for it as a plain
// textbox that reports markdown the same way the real editor does.
vi.mock('novel', () => ({
  EditorRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  EditorContent: ({ onUpdate }: {
    onUpdate?: (arg: { editor: { storage: { markdown: { getMarkdown: () => string } } } }) => void
  }) => (
    <textarea
      onChange={(event) => onUpdate?.({
        editor: { storage: { markdown: { getMarkdown: () => event.target.value } } },
      })}
    />
  ),
  StarterKit: {},
  Placeholder: { configure: () => ({}) },
}))

import { Vision } from './Vision'

beforeEach(() => {
  calls.read.length = 0
  calls.written.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Vision', () => {
  it('keeps both sections, reading the same two keys', async () => {
    render(<Vision />)

    expect(screen.getByText('North Star')).toBeInTheDocument()
    expect(screen.getByText('Vision')).toBeInTheDocument()
    await waitFor(() => {
      expect(calls.read).toEqual(['vision.northStar', 'vision.body'])
    })
  })

  it('still saves what is typed, to the key that section owns', async () => {
    render(<Vision />)
    const [northStar, body] = await screen.findAllByRole('textbox')

    vi.useFakeTimers()
    fireEvent.change(northStar, { target: { value: 'Minimize overhead.' } })
    fireEvent.change(body, { target: { value: 'Everything else.' } })
    vi.advanceTimersByTime(500)

    expect(calls.written).toEqual([
      ['vision.northStar', 'Minimize overhead.'],
      ['vision.body', 'Everything else.'],
    ])
  })
})
