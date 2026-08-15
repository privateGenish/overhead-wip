/**
 * The mention parser.
 *
 * Extraction feeds a stored projection, so a false positive is not a cosmetic
 * problem: it writes a backlink between two documents that never referenced
 * each other. These tests are mostly about what must *not* match.
 */
import { describe, it, expect } from 'vitest'
import { extractMentions, isTicketId, formatMention } from './mentions'

describe('extractMentions — what counts', () => {
  it('finds a mention in prose', () => {
    expect(extractMentions('Blocked until @OVH-123 lands.')).toEqual(['OVH-123'])
  })

  it('accepts any uppercase project prefix, and single-digit numbers', () => {
    expect(extractMentions('@OVH-1 and @SHOP-42 and @A1-7')).toEqual(['OVH-1', 'SHOP-42', 'A1-7'])
  })

  it('collapses duplicates, keeping first appearance order', () => {
    expect(extractMentions('@OVH-2 then @OVH-1 then @OVH-2 again')).toEqual(['OVH-2', 'OVH-1'])
  })

  it('reads mentions wrapped in punctuation and markdown emphasis', () => {
    expect(extractMentions('(@OVH-1), **@OVH-2**, "@OVH-3" — and @OVH-4.')).toEqual([
      'OVH-1', 'OVH-2', 'OVH-3', 'OVH-4',
    ])
  })

  it('reads a mention at the very start and very end of the document', () => {
    expect(extractMentions('@OVH-1')).toEqual(['OVH-1'])
  })

  it('reads mentions inside list items and headings', () => {
    const markdown = '# Plan for @OVH-9\n\n- depends on @OVH-10\n- see also @OVH-11\n'
    expect(extractMentions(markdown)).toEqual(['OVH-9', 'OVH-10', 'OVH-11'])
  })

  it('tolerates ids no ticket owns — resolution is not its job', () => {
    expect(extractMentions('@OVH-99999 was deleted, @TYPO-1 never existed')).toEqual([
      'OVH-99999', 'TYPO-1',
    ])
  })

  it('returns nothing for empty or mention-free text', () => {
    expect(extractMentions('')).toEqual([])
    expect(extractMentions('Nothing to see here.')).toEqual([])
  })
})

describe('extractMentions — what must not count', () => {
  it('ignores an email address', () => {
    expect(extractMentions('Mail a@OVH-1.com about it')).toEqual([])
    expect(extractMentions('someone@OVH-123')).toEqual([])
  })

  it('ignores a mention glued to the end of a word', () => {
    expect(extractMentions('re:@OVH-1 is fine but foo@OVH-2 is not')).toEqual(['OVH-1'])
  })

  it('ignores an id that runs on into more word characters', () => {
    expect(extractMentions('@OVH-12abc @OVH-1_2 @OVH-1-2')).toEqual([])
  })

  it('ignores lowercase and mixed-case handles', () => {
    expect(extractMentions('@ovh-1 @Ovh-2 @user-3')).toEqual([])
  })

  it('ignores shapes that are not ids at all', () => {
    expect(extractMentions('@OVH @OVH- @-1 @ OVH-1 @123')).toEqual([])
  })

  it('ignores a doubled @', () => {
    expect(extractMentions('@@OVH-1')).toEqual([])
  })

  it('ignores mentions inside a fenced code block', () => {
    const markdown = [
      'Before @OVH-1',
      '',
      '```sh',
      'grep @OVH-2 vault/',
      '```',
      '',
      'After @OVH-3',
    ].join('\n')
    expect(extractMentions(markdown)).toEqual(['OVH-1', 'OVH-3'])
  })

  it('ignores mentions inside a tilde fence, and inside a nested backtick run', () => {
    const markdown = '~~~\n@OVH-1\n````\n@OVH-2\n````\n~~~\nreal @OVH-3'
    expect(extractMentions(markdown)).toEqual(['OVH-3'])
  })

  it('treats an unterminated fence as code all the way down', () => {
    expect(extractMentions('ok @OVH-1\n```\n@OVH-2\n@OVH-3')).toEqual(['OVH-1'])
  })

  it('ignores mentions inside an inline code span', () => {
    expect(extractMentions('write `@OVH-1` to link @OVH-2')).toEqual(['OVH-2'])
  })

  it('keeps reading after an unmatched backtick', () => {
    expect(extractMentions('a ` stray tick and @OVH-1')).toEqual(['OVH-1'])
  })
})

describe('id helpers', () => {
  it('recognises a well-formed id, and only that', () => {
    expect(isTicketId('OVH-123')).toBe(true)
    expect(isTicketId('@OVH-123')).toBe(false)
    expect(isTicketId('ovh-123')).toBe(false)
    expect(isTicketId('OVH-')).toBe(false)
  })

  it('serializes a mention as plain text — the whole contract', () => {
    expect(formatMention('OVH-123')).toBe('@OVH-123')
    // What it writes must be what it reads.
    expect(extractMentions(formatMention('OVH-123'))).toEqual(['OVH-123'])
  })
})
