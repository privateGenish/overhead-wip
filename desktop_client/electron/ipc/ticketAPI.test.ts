import { describe, it, expect } from 'vitest'
import { validateTicketSql } from './ticketAPI'

describe('validateTicketSql', () => {
  it('allows queries on the tickets table', () => {
    expect(() => validateTicketSql('SELECT * FROM tickets')).not.toThrow()
    expect(() => validateTicketSql('INSERT INTO tickets (uuid) VALUES (?)')).not.toThrow()
    expect(() => validateTicketSql('DELETE FROM tickets WHERE uuid = ?')).not.toThrow()
  })

  it('rejects queries on unrelated tables', () => {
    expect(() => validateTicketSql('SELECT * FROM settings')).toThrow('db:ticket only accepts queries on ticket tables.')
    expect(() => validateTicketSql('DELETE FROM settings WHERE key = ?')).toThrow()
    expect(() => validateTicketSql('SELECT * FROM some_other_table')).toThrow()
  })

  it('rejects non-string input', () => {
    expect(() => validateTicketSql(null as unknown as string)).toThrow('db:ticket expects a SQL string.')
    expect(() => validateTicketSql(42 as unknown as string)).toThrow()
  })
})
