// @vitest-environment jsdom
/**
 * Storage keeps every snapshot; the sheet does not. This pins the display cap,
 * and the fact that it applies *after* the newest entry is dropped — that entry
 * is the ticket's current text, not a version to return to.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TicketVersion } from '@/lib/historyClient'

const versions = vi.hoisted(() => [] as TicketVersion[])

vi.mock('@/lib/historyClient', () => ({
  historyClient: { list: async () => versions },
}))

import { TicketHistory, HISTORY_DISPLAY_LIMIT } from './TicketHistory'

/** Newest first, as the client returns them. */
function seed(count: number): void {
  versions.length = 0
  for (let i = count; i > 0; i--) {
    versions.push({ ts: 1_700_000_000 + i, description: `version ${i}` })
  }
}

function renderSheet() {
  render(
    <TicketHistory
      open
      onOpenChange={() => {}}
      ticketUuid="uuid-1"
      onRestore={() => {}}
    />,
  )
}

describe('TicketHistory display cap', () => {
  it('shows at most 50 versions however many are stored', async () => {
    seed(200)
    renderSheet()

    const entries = await screen.findAllByRole('button', { name: 'Restore' })
    expect(entries).toHaveLength(HISTORY_DISPLAY_LIMIT)
    expect(HISTORY_DISPLAY_LIMIT).toBe(50)
    expect(screen.getByText(/Showing the 50 most recent versions/)).toBeInTheDocument()
  })

  it('drops the current state first, then caps what is left', async () => {
    seed(HISTORY_DISPLAY_LIMIT + 1) // 51 stored → 50 shown, exactly at the cap
    renderSheet()

    const entries = await screen.findAllByRole('button', { name: 'Restore' })
    expect(entries).toHaveLength(HISTORY_DISPLAY_LIMIT)
    // The newest snapshot is the ticket as it stands, so it is not offered.
    expect(screen.queryByText(`version ${HISTORY_DISPLAY_LIMIT + 1}`)).toBeNull()
    expect(screen.getByText(`version ${HISTORY_DISPLAY_LIMIT}`)).toBeInTheDocument()
    // Nothing was cut, so the truncation note stays away.
    expect(screen.queryByText(/Showing the 50 most recent versions/)).toBeNull()
  })

  it('shows every version when there are fewer than the cap', async () => {
    seed(4)
    renderSheet()

    const entries = await screen.findAllByRole('button', { name: 'Restore' })
    expect(entries).toHaveLength(3) // 4 stored, newest is the current state
  })
})
