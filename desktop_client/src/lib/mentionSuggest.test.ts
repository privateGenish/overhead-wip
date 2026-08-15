/**
 * The `@` autocomplete's decisions, without an editor.
 *
 * The trigger deliberately mirrors the parser: the menu must never offer to
 * complete a reference that `extractMentions` would then refuse to see.
 */
import { describe, it, expect } from 'vitest'
import { mentionQueryAt, rankMentionCandidates, type MentionCandidate } from './mentionSuggest'

const tickets: MentionCandidate[] = [
  { uuid: 'u1', id: 'OVH-1', title: 'Vault round-trip' },
  { uuid: 'u2', id: 'OVH-10', title: 'Ticket mentions' },
  { uuid: 'u3', id: 'OVH-11', title: 'Overlay routing' },
  { uuid: 'u4', id: 'SHOP-2', title: 'Vault watcher noise' },
]

const ids = (list: MentionCandidate[]) => list.map((candidate) => candidate.id)

describe('mentionQueryAt', () => {
  it('opens on a bare @ at the start of a block', () => {
    expect(mentionQueryAt('@')).toEqual({ query: '', start: 0 })
  })

  it('opens on @ after a space, and reports where it started', () => {
    expect(mentionQueryAt('blocked by @OV')).toEqual({ query: 'OV', start: 11 })
  })

  it('opens after opening punctuation', () => {
    expect(mentionQueryAt('(@OVH')).toEqual({ query: 'OVH', start: 1 })
    expect(mentionQueryAt('"@a')).toEqual({ query: 'a', start: 1 })
  })

  it('stays closed mid-word — an email is not a mention', () => {
    expect(mentionQueryAt('someone@OVH')).toBeNull()
    expect(mentionQueryAt('a@')).toBeNull()
  })

  it('closes once the token ends', () => {
    expect(mentionQueryAt('@OVH-1 and then')).toBeNull()
    expect(mentionQueryAt('nothing here')).toBeNull()
  })

  it('closes rather than trail a whole sentence behind one stray @', () => {
    expect(mentionQueryAt(`@${'x'.repeat(25)}`)).toBeNull()
  })

  it('reads the last @ when there are several', () => {
    expect(mentionQueryAt('@OVH-1 then @SH')).toEqual({ query: 'SH', start: 12 })
  })
})

describe('rankMentionCandidates', () => {
  it('offers everything, capped, before anything is typed', () => {
    expect(ids(rankMentionCandidates(tickets, '', 2))).toEqual(['OVH-1', 'OVH-10'])
  })

  it('matches ids case-insensitively', () => {
    expect(ids(rankMentionCandidates(tickets, 'shop', 8))).toEqual(['SHOP-2'])
  })

  it('puts an exact id first, ahead of the ids that merely start with it', () => {
    expect(ids(rankMentionCandidates(tickets, 'OVH-1', 8))).toEqual(['OVH-1', 'OVH-10', 'OVH-11'])
  })

  it('falls back to titles, after every id match', () => {
    expect(ids(rankMentionCandidates(tickets, 'vault', 8))).toEqual(['OVH-1', 'SHOP-2'])
  })

  it('drops candidates that match nowhere — an empty menu is a closed menu', () => {
    expect(rankMentionCandidates(tickets, 'zzz', 8)).toEqual([])
  })

  it('honours the limit', () => {
    expect(rankMentionCandidates(tickets, 'ovh', 2)).toHaveLength(2)
  })
})
