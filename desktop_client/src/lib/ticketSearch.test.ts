/**
 * Ranking is the part worth pinning: matching by subsequence alone puts
 * `OVH-1` behind any title that happens to contain an o, a v and an h.
 */
import { describe, it, expect } from 'vitest'
import { fuzzyMatch, matchesTicketQuery, searchTickets } from './ticketSearch'

const tickets = [
  { id: 'OVH-001', title: 'Rework the vault watcher' },
  { id: 'OVH-042', title: 'Ticket relations panel' },
  { id: 'SHOP-007', title: 'Checkout flow research' },
]

describe('fuzzyMatch', () => {
  it('matches characters in order, not necessarily adjacent', () => {
    expect(fuzzyMatch('ovh-123', 'ovh12')).toBe(true)
    expect(fuzzyMatch('archive search', 'arcsrch')).toBe(true)
  })

  it('rejects characters out of order', () => {
    expect(fuzzyMatch('ovh-123', '21')).toBe(false)
    expect(fuzzyMatch('ovh-123', 'ovhx')).toBe(false)
  })

  it('matches everything against an empty needle', () => {
    expect(fuzzyMatch('anything', '')).toBe(true)
  })
})

describe('searchTickets', () => {
  it('finds a ticket by title', () => {
    expect(searchTickets(tickets, 'checkout').map((t) => t.id)).toEqual(['SHOP-007'])
  })

  it('finds a ticket by id, case-insensitively', () => {
    expect(searchTickets(tickets, 'ovh-042').map((t) => t.id)).toEqual(['OVH-042'])
  })

  it('ranks an id match above a title that merely contains the letters', () => {
    const found = searchTickets(tickets, 'ovh-0')
    expect(found.map((t) => t.id)).toEqual(['OVH-001', 'OVH-042'])
  })

  it('never matches on anything but title and id', () => {
    const withBody = [{ id: 'OVH-001', title: 'Vault', description: 'monetization' }]
    expect(searchTickets(withBody, 'monetization')).toEqual([])
  })

  it('returns the head of the list for an empty query', () => {
    expect(searchTickets(tickets, '   ')).toHaveLength(3)
  })

  it('caps the result count', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `OVH-${i}`, title: 'x' }))
    expect(searchTickets(many, 'ovh')).toHaveLength(25)
    expect(searchTickets(many, 'ovh', 5)).toHaveLength(5)
  })
})

describe('matchesTicketQuery', () => {
  it('accepts everything when the query is blank', () => {
    expect(matchesTicketQuery(tickets[0], '')).toBe(true)
  })

  it('rejects a query that answers neither field', () => {
    expect(matchesTicketQuery(tickets[0], 'zzz')).toBe(false)
  })
})
