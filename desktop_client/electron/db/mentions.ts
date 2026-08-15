/**
 * The `mentions` table — a projection of document content.
 *
 * Every row here is derived from markdown someone wrote. Nothing else may write
 * to this table, and nothing that lives only here matters: dropping it and
 * re-parsing every ticket and note must produce exactly the same rows. That is
 * what `rebuildAllMentions` is for, and it runs on every project open so the
 * projection self-heals rather than drifting.
 *
 * Resolution is scoped to the active project for free — one project, one open
 * database, so `SELECT … FROM tickets` cannot see another project's ids.
 *
 * Two deliberate omissions:
 *
 * - **Unresolvable ids are not stored.** `@TYPO-1` and a mention of a deleted
 *   ticket leave no row. A backlink to nothing is not a backlink, and the
 *   foreign key on `target_uuid` would refuse it anyway.
 * - **A ticket never mentions itself.** `@OVH-1` written inside `OVH-1` is a
 *   person naming the thing they are already in, not a link between two
 *   documents. Notes have no such case — a note cannot be a mention target.
 */

import { runSql, transact } from './sqlite'
import { extractMentions } from '../../src/shared/mentions'

/** Which table `source_uuid` points into. Matches the schema's CHECK. */
export type MentionSource = 'ticket' | 'note'

interface TicketIdRow {
  uuid: string
  id: string
}

/**
 * Maps human ids onto ticket uuids, dropping the ones no ticket owns. Order
 * follows the ids as given, so the rows a document produces are stable.
 */
function resolveTargets(ids: string[]): string[] {
  if (ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(', ')
  const rows = runSql(
    `SELECT uuid, id FROM tickets WHERE id IN (${placeholders})`,
    ids,
  ) as TicketIdRow[]

  const byId = new Map(rows.map((row) => [row.id, row.uuid]))
  const resolved: string[] = []
  for (const id of ids) {
    const uuid = byId.get(id)
    if (uuid) resolved.push(uuid)
  }
  return resolved
}

/**
 * Replaces one source's rows. Not transactional on its own — callers wrap it,
 * because `rebuildAllMentions` runs it hundreds of times inside one transaction
 * and SQLite has no nested `BEGIN`.
 */
function writeMentions(sourceType: MentionSource, sourceUuid: string, markdown: string): void {
  runSql(
    'DELETE FROM mentions WHERE source_type = ? AND source_uuid = ?',
    [sourceType, sourceUuid],
  )

  for (const target of resolveTargets(extractMentions(markdown))) {
    if (sourceType === 'ticket' && target === sourceUuid) continue // self-mention
    runSql(
      'INSERT INTO mentions (source_type, source_uuid, target_uuid) VALUES (?, ?, ?)',
      [sourceType, sourceUuid, target],
    )
  }
}

/**
 * Re-derives the backlinks one document makes, atomically.
 *
 * Delete-then-insert rather than a diff: the document's current text is the
 * whole truth, so the previous rows carry no information worth preserving.
 * Call it after *every* write that can change the text — in-app edits, bridge
 * calls and inbound vault edits alike. A path that forgets desyncs silently.
 *
 * @param markdown the source's text as it now stands in the database.
 */
export function syncMentions(
  sourceType: MentionSource,
  sourceUuid: string,
  markdown: string,
): void {
  transact(() => writeMentions(sourceType, sourceUuid, markdown))
}

/** Drops every row a source owns — for a document that no longer exists. */
export function clearMentionsFrom(sourceType: MentionSource, sourceUuid: string): void {
  runSql(
    'DELETE FROM mentions WHERE source_type = ? AND source_uuid = ?',
    [sourceType, sourceUuid],
  )
}

/**
 * Rebuilds the whole table from every ticket description and note body.
 *
 * This is the projection claim made executable: running it twice must leave the
 * database in the same state as running it once. It also repairs the one case
 * incremental extraction cannot see — a document mentioning an id that did not
 * exist yet when it was written, and does now.
 */
export function rebuildAllMentions(): void {
  const tickets = runSql('SELECT uuid, description FROM tickets') as
    { uuid: string; description: string }[]
  const notes = runSql('SELECT uuid, body FROM notes') as
    { uuid: string; body: string }[]

  transact(() => {
    runSql('DELETE FROM mentions')
    for (const ticket of tickets) writeMentions('ticket', ticket.uuid, ticket.description)
    for (const note of notes) writeMentions('note', note.uuid, note.body)
  })
}
