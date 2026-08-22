/**
 * The bench's slot tables (`bench_slots`, `pinned_notes`) — raw SQL, same
 * trust level as `ticketClient`/`noteClient`. These tables are the source of
 * truth for the pin cap and pin order; `tickets.pinned` is a synced display
 * flag kept alongside them by `ticketStore`, not read here.
 *
 * No timestamp lives in either table by design — order is "which slot was
 * free when you pinned it", not recency.
 */

export const MAX_BENCH_TICKETS = 4
export const MAX_PINNED_NOTES = 2

export interface Slot {
  uuid: string
  slot: number
}

async function slots(table: string, column: string): Promise<Slot[]> {
  const rows = await window.db.query(
    `SELECT ${column} as uuid, slot FROM ${table} ORDER BY slot`,
    [],
  ) as Slot[]
  return rows
}

function nextFreeSlot(taken: Slot[]): number {
  const used = new Set(taken.map((s) => s.slot))
  let slot = 0
  while (used.has(slot)) slot++
  return slot
}

class BenchClient {
  // --- Tickets ---

  listTicketSlots(): Promise<Slot[]> {
    return slots('bench_slots', 'ticket_uuid')
  }

  /** Adds a ticket to the first free slot. Caller must have already checked room exists. */
  async pinTicket(uuid: string, current: Slot[]): Promise<void> {
    await window.db.query('INSERT INTO bench_slots (ticket_uuid, slot) VALUES (?, ?)', [
      uuid, nextFreeSlot(current),
    ])
  }

  async unpinTicket(uuid: string): Promise<void> {
    await window.db.query('DELETE FROM bench_slots WHERE ticket_uuid = ?', [uuid])
  }

  /** Replaces one bench ticket with another, in the same slot. */
  async swapTicket(outUuid: string, inUuid: string, current: Slot[]): Promise<void> {
    const slot = current.find((s) => s.uuid === outUuid)?.slot
    if (slot === undefined) return
    await window.db.query('DELETE FROM bench_slots WHERE ticket_uuid = ?', [outUuid])
    await window.db.query('INSERT INTO bench_slots (ticket_uuid, slot) VALUES (?, ?)', [inUuid, slot])
  }

  // --- Notes ---

  listNoteSlots(): Promise<Slot[]> {
    return slots('pinned_notes', 'note_uuid')
  }

  async pinNote(uuid: string, current: Slot[]): Promise<void> {
    await window.db.query('INSERT INTO pinned_notes (note_uuid, slot) VALUES (?, ?)', [
      uuid, nextFreeSlot(current),
    ])
  }

  async unpinNote(uuid: string): Promise<void> {
    await window.db.query('DELETE FROM pinned_notes WHERE note_uuid = ?', [uuid])
  }

  async swapNote(outUuid: string, inUuid: string, current: Slot[]): Promise<void> {
    const slot = current.find((s) => s.uuid === outUuid)?.slot
    if (slot === undefined) return
    await window.db.query('DELETE FROM pinned_notes WHERE note_uuid = ?', [outUuid])
    await window.db.query('INSERT INTO pinned_notes (note_uuid, slot) VALUES (?, ?)', [inUuid, slot])
  }
}

export const benchClient = new BenchClient()
