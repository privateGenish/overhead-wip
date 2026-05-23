import { describe, it, expect } from 'vitest'
import { Ticket } from './ticket'
import { ExecuteTicket } from './tickets/execute'
import { ExploreTicket } from './tickets/explore'
import { FeatureTicket } from './tickets/feature'

/**
 * Tests for `Ticket.load()` — the JSON → instance trust boundary.
 * Importing the three subclasses above triggers their `static {}` blocks,
 * registering each loader with the base.
 */

const validData = {
  Execute: {
    uuid: 'uuid-exec',
    id: 'OVH-001',
    title: 'Wire up the API',
    type: 'Execute',
    status: { value: 'In Progress' },
    backlog: false,
  },
  Explore: {
    uuid: 'uuid-expl',
    id: 'OVH-002',
    title: 'Research graph libraries',
    type: 'Explore',
    status: { value: 'Open' },
    backlog: true,
  },
  Feature: {
    uuid: 'uuid-feat',
    id: 'OVH-003',
    title: 'Ticket relationships',
    type: 'Feature',
    status: { value: 'Idea' },
    backlog: false,
  },
} as const

describe('Ticket.load — pass', () => {
  it('rebuilds an ExecuteTicket', () => {
    const t = Ticket.load(validData.Execute)
    expect(t).toBeInstanceOf(ExecuteTicket)
    expect(t.type).toBe('Execute')
    expect(t.uuid).toBe('uuid-exec')
    expect(t.id).toBe('OVH-001')
    expect(t.title).toBe('Wire up the API')
    expect(t.status).toEqual({ value: 'In Progress' })
    expect(t.backlog).toBe(false)
  })

  it('rebuilds an ExploreTicket', () => {
    const t = Ticket.load(validData.Explore)
    expect(t).toBeInstanceOf(ExploreTicket)
    expect(t.type).toBe('Explore')
    expect(t.uuid).toBe('uuid-expl')
    expect(t.backlog).toBe(true)
  })

  it('rebuilds a FeatureTicket', () => {
    const t = Ticket.load(validData.Feature)
    expect(t).toBeInstanceOf(FeatureTicket)
    expect(t.type).toBe('Feature')
    expect(t.id).toBe('OVH-003')
    expect(t.status).toEqual({ value: 'Idea' })
  })
})

describe('Ticket.load — fail', () => {
  it('throws on a missing field (no title)', () => {
    const { title: _omitted, ...noTitle } = validData.Execute
    void _omitted
    expect(() => Ticket.load(noTitle)).toThrow()
  })

  it('throws on a wrong-typed field (backlog as string)', () => {
    expect(() =>
      Ticket.load({ ...validData.Explore, backlog: 'nope' }),
    ).toThrow()
  })

  it('throws on an unknown ticket type', () => {
    expect(() =>
      Ticket.load({ ...validData.Feature, type: 'Banana' }),
    ).toThrow()
  })

  it('throws on a malformed status (missing value)', () => {
    expect(() =>
      Ticket.load({ ...validData.Execute, status: {} }),
    ).toThrow()
  })

  it('throws on non-object input', () => {
    expect(() => Ticket.load(null)).toThrow()
    expect(() => Ticket.load('not a ticket')).toThrow()
  })
})
