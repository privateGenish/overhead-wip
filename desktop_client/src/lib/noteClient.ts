/**
 * The notes data layer.
 *
 * A note is a titled markdown document — no status, no type, no relations —
 * so it needs no model class the way a ticket does. This client is the whole
 * layer: raw SQL lives here and nowhere else, mirroring `ticketClient`.
 */

export interface NoteData {
  uuid: string
  title: string
  body: string
  created_at: number
  updated_at: number
}

/**
 * Debounce keys are shared with tickets, so notes carry a prefix. Without it a
 * note whose uuid happened to match a ticket's would supersede that ticket's
 * queued write, and the ticket edit would be silently dropped.
 */
export function noteKey(uuid: string): string {
  return `note:${uuid}`
}

const UPSERT_SQL = `
  INSERT INTO notes (uuid, title, body, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(uuid) DO UPDATE SET
    title      = excluded.title,
    body       = excluded.body,
    updated_at = excluded.updated_at
`

class NoteClient {
  /**
   * Writes a note. `created_at` is only honoured on insert — the conflict
   * clause leaves the stored value alone, so re-saving never rewrites history.
   */
  async upsert(note: NoteData): Promise<void> {
    await window.db.note(UPSERT_SQL, [
      note.uuid, note.title, note.body, note.created_at, Date.now(),
    ])
  }

  /** Every note, newest edit first — the order the grid shows them in. */
  async all(): Promise<NoteData[]> {
    return await window.db.note(
      'SELECT * FROM notes ORDER BY updated_at DESC',
    ) as NoteData[]
  }

  async get(uuid: string): Promise<NoteData | null> {
    const rows = await window.db.note(
      'SELECT * FROM notes WHERE uuid = ? LIMIT 1',
      [uuid],
    ) as NoteData[]
    return rows[0] ?? null
  }

  async delete(uuid: string): Promise<void> {
    await window.db.note('DELETE FROM notes WHERE uuid = ?', [uuid])
  }
}

export const noteClient = new NoteClient()
