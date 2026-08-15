/**
 * The mentions projection, against real SQLite.
 *
 * The claim under test is the one §0.3 makes: `mentions` is derived from
 * document content and never a source of truth. If that holds, throwing the
 * table away and re-parsing every ticket and note must land on exactly the same
 * rows — twice, and after the documents change.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { initSqlite, runSql, __resetSqliteForTests } from './sqlite'
import { syncMentions, rebuildAllMentions, clearMentionsFrom } from './mentions'

let tmp: string

interface MentionRow {
  source_type: string
  source_uuid: string
  target_uuid: string
}

function insertTicket(uuid: string, id: string, description: string): void {
  runSql(
    `INSERT INTO tickets (uuid, id, title, type, status, backlog, pinned, description, archived, created_at, updated_at)
     VALUES (?, ?, ?, 'Execute', 'Draft', 0, 0, ?, 0, 1000, 1000)`,
    [uuid, id, `Ticket ${id}`, description],
  )
}

function insertNote(uuid: string, body: string): void {
  runSql(
    `INSERT INTO notes (uuid, title, body, created_at, updated_at) VALUES (?, ?, ?, 1000, 1000)`,
    [uuid, `Note ${uuid}`, body],
  )
}

/** Every row, in a stable order so two snapshots can be compared directly. */
function allMentions(): MentionRow[] {
  return runSql(
    'SELECT source_type, source_uuid, target_uuid FROM mentions ORDER BY source_type, source_uuid, target_uuid',
  ) as MentionRow[]
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-mentions-'))
  __resetSqliteForTests()
  initSqlite(path.join(tmp, 'overhead.db'))
})

afterEach(() => {
  __resetSqliteForTests()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('syncMentions', () => {
  it('resolves ids to ticket uuids', () => {
    insertTicket('u-1', 'OVH-1', '')
    insertTicket('u-2', 'OVH-2', 'Blocked until @OVH-1 lands.')

    syncMentions('ticket', 'u-2', 'Blocked until @OVH-1 lands.')

    expect(allMentions()).toEqual([
      { source_type: 'ticket', source_uuid: 'u-2', target_uuid: 'u-1' },
    ])
  })

  it('stores nothing for an id no ticket owns', () => {
    insertTicket('u-1', 'OVH-1', '')

    syncMentions('ticket', 'u-1', 'See @TYPO-9 and @OVH-404.')

    // A backlink to nothing is not a backlink — and extraction still did not
    // throw on the unknown ids.
    expect(allMentions()).toEqual([])
  })

  it('skips a ticket mentioning itself', () => {
    insertTicket('u-1', 'OVH-1', '')
    insertTicket('u-2', 'OVH-2', '')

    syncMentions('ticket', 'u-1', 'This is @OVH-1, which relates to @OVH-2.')

    expect(allMentions()).toEqual([
      { source_type: 'ticket', source_uuid: 'u-1', target_uuid: 'u-2' },
    ])
  })

  it('replaces the previous rows rather than adding to them', () => {
    insertTicket('u-1', 'OVH-1', '')
    insertTicket('u-2', 'OVH-2', '')
    insertTicket('u-3', 'OVH-3', '')

    syncMentions('ticket', 'u-3', 'Needs @OVH-1 and @OVH-2.')
    expect(allMentions()).toHaveLength(2)

    syncMentions('ticket', 'u-3', 'Actually only @OVH-2.')

    expect(allMentions()).toEqual([
      { source_type: 'ticket', source_uuid: 'u-3', target_uuid: 'u-2' },
    ])
  })

  it('keeps notes and tickets apart, even on the same uuid', () => {
    insertTicket('u-1', 'OVH-1', '')
    // Contrived, but the primary key spans two tables and has to prove it.
    syncMentions('ticket', 'shared-uuid', 'see @OVH-1')
    syncMentions('note', 'shared-uuid', 'see @OVH-1')

    expect(allMentions()).toHaveLength(2)

    clearMentionsFrom('note', 'shared-uuid')

    expect(allMentions()).toEqual([
      { source_type: 'ticket', source_uuid: 'shared-uuid', target_uuid: 'u-1' },
    ])
  })

  it('writes nothing when the text has no mentions', () => {
    insertTicket('u-1', 'OVH-1', '')
    syncMentions('ticket', 'u-1', 'Just prose.')
    expect(allMentions()).toEqual([])
  })
})

describe('rebuildAllMentions — the projection claim', () => {
  beforeEach(() => {
    insertTicket('u-1', 'OVH-1', 'The root of it all.')
    insertTicket('u-2', 'OVH-2', 'Follows @OVH-1, and also @OVH-3.')
    insertTicket('u-3', 'OVH-3', 'Mentions @OVH-1 twice: @OVH-1. And `@OVH-2` in code, which does not count.')
    insertNote('n-1', '# Thinking\n\nBoth @OVH-1 and @OVH-2 are in play. @GONE-9 is not.')
    insertNote('n-2', 'No references here.')
  })

  it('derives every row from the documents alone', () => {
    rebuildAllMentions()

    expect(allMentions()).toEqual([
      { source_type: 'note', source_uuid: 'n-1', target_uuid: 'u-1' },
      { source_type: 'note', source_uuid: 'n-1', target_uuid: 'u-2' },
      { source_type: 'ticket', source_uuid: 'u-2', target_uuid: 'u-1' },
      { source_type: 'ticket', source_uuid: 'u-2', target_uuid: 'u-3' },
      { source_type: 'ticket', source_uuid: 'u-3', target_uuid: 'u-1' },
    ])
  })

  it('is idempotent — running it twice changes nothing', () => {
    rebuildAllMentions()
    const first = allMentions()

    rebuildAllMentions()

    expect(allMentions()).toEqual(first)
  })

  it('discards rows that no document justifies', () => {
    // A row nothing wrote — the state a bug or a stale build would leave.
    runSql(
      `INSERT INTO mentions (source_type, source_uuid, target_uuid) VALUES ('ticket', 'u-1', 'u-2')`,
    )

    rebuildAllMentions()

    const fabricated = allMentions().filter((row) => row.source_uuid === 'u-1')
    expect(fabricated).toEqual([])
  })

  it('follows the text when a description changes', () => {
    rebuildAllMentions()

    runSql('UPDATE tickets SET description = ? WHERE uuid = ?', ['Now points at @OVH-3 only.', 'u-2'])
    rebuildAllMentions()

    expect(allMentions().filter((row) => row.source_uuid === 'u-2')).toEqual([
      { source_type: 'ticket', source_uuid: 'u-2', target_uuid: 'u-3' },
    ])
  })

  it('agrees with incremental extraction — a rebuild is never a correction', () => {
    // Sync each document one at a time, the way the write paths do…
    syncMentions('ticket', 'u-2', 'Follows @OVH-1, and also @OVH-3.')
    syncMentions('ticket', 'u-3', 'Mentions @OVH-1 twice: @OVH-1. And `@OVH-2` in code, which does not count.')
    syncMentions('note', 'n-1', '# Thinking\n\nBoth @OVH-1 and @OVH-2 are in play. @GONE-9 is not.')
    const incremental = allMentions()

    // …then throw it all away and re-derive it in one pass.
    rebuildAllMentions()

    expect(allMentions()).toEqual(incremental)
  })

  it('picks up a mention whose target did not exist when it was written', () => {
    syncMentions('ticket', 'u-1', 'Waiting on @OVH-42, which is not a ticket yet.')
    expect(allMentions().filter((row) => row.source_uuid === 'u-1')).toEqual([])

    insertTicket('u-42', 'OVH-42', '')
    runSql('UPDATE tickets SET description = ? WHERE uuid = ?', [
      'Waiting on @OVH-42, which is not a ticket yet.', 'u-1',
    ])
    rebuildAllMentions()

    expect(allMentions().filter((row) => row.source_uuid === 'u-1')).toEqual([
      { source_type: 'ticket', source_uuid: 'u-1', target_uuid: 'u-42' },
    ])
  })
})
