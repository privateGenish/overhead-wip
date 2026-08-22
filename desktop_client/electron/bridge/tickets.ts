/**
 * Governed ticket methods for the bridge (Door 2).
 *
 * Callers pass plain data — never SQL. Each method validates its input with Zod,
 * then routes writes through `runTicketSql` so vault mirroring and history
 * snapshots stay identical to the renderer's raw path. IDs, uuids and initial
 * status are minted here, server-side, mirroring the renderer's Ticket factories.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { runSql } from '../db/sqlite'
import { runTicketSql } from '../ipc/ticketAPI'
import { notifyTicketUpdated } from '../ipc/notify'
import { getActiveProject } from '../project/projectManager'

/** The bench holds at most this many tickets — see docs/SCHEMA-CHANGES.md. */
export const MAX_BENCH_TICKETS = 4

const ticketTypeSchema = z.enum(['Explore', 'Feature', 'Execute'])
type TicketType = z.infer<typeof ticketTypeSchema>

/** Initial status seeded per type — mirrors the subclass create() factories. */
const INITIAL_STATUS: Record<TicketType, string> = {
  Execute: 'Draft',
  Explore: 'Open',
  Feature: 'Idea',
}

/** Plain ticket shape returned to callers (booleans, not 0/1). */
export interface BridgeTicket {
  uuid: string
  id: string
  title: string
  type: TicketType
  status: string
  backlog: boolean
  pinned: boolean
  description: string
  archived: boolean
  created_at: number
  updated_at: number
}

interface TicketRow {
  uuid: string
  id: string
  title: string
  type: TicketType
  status: string
  backlog: 0 | 1
  pinned: 0 | 1
  description: string
  archived: 0 | 1
  created_at: number
  updated_at: number
}

const UPSERT_SQL = `
  INSERT INTO tickets (uuid, id, title, type, status, backlog, pinned, description, archived, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(uuid) DO UPDATE SET
    id          = excluded.id,
    title       = excluded.title,
    type        = excluded.type,
    status      = excluded.status,
    backlog     = excluded.backlog,
    pinned      = excluded.pinned,
    description = excluded.description,
    archived    = excluded.archived,
    updated_at  = excluded.updated_at
`

const COUNTER_KEY = 'counter'
const FALLBACK_PREFIX = 'OVH'

/**
 * Mints the next human-readable id, mirroring the renderer's Counter.
 *
 * The prefix comes from the open project rather than a constant: prefixes are
 * per-project now, so a hardcoded `OVH` would stamp every project's tickets
 * with another project's identity — and make `@OVH-1` mentions ambiguous, the
 * exact thing the unique-prefix constraint exists to prevent.
 */
function nextId(): string {
  const rows = runSql('SELECT value FROM settings WHERE key = ?', [COUNTER_KEY]) as
    | { value: string }[]
    | undefined
  const next = (rows?.[0]?.value ? parseInt(rows[0].value, 10) : 0) + 1
  runSql(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [COUNTER_KEY, String(next)],
  )
  const prefix = getActiveProject()?.prefix ?? FALLBACK_PREFIX
  return `${prefix}-${String(next).padStart(3, '0')}`
}

function rowToTicket(row: TicketRow): BridgeTicket {
  return { ...row, backlog: row.backlog === 1, pinned: row.pinned === 1, archived: row.archived === 1 }
}

function readRow(uuid: string): TicketRow | null {
  const rows = runTicketSql('SELECT * FROM tickets WHERE uuid = ? LIMIT 1', [uuid]) as TicketRow[]
  return rows[0] ?? null
}

/**
 * Writes a full ticket row via the shared write path. params[0] is the uuid, so
 * the vault mirror + history snapshot in runTicketSql target the right ticket.
 */
function writeTicket(t: BridgeTicket): void {
  runTicketSql(UPSERT_SQL, [
    t.uuid, t.id, t.title, t.type, t.status,
    t.backlog ? 1 : 0, t.pinned ? 1 : 0, t.description, t.archived ? 1 : 0,
    t.created_at, t.updated_at,
  ])
  notifyTicketUpdated(t.uuid)
}

// --- Method input schemas ---

const createSchema = z.object({
  title: z.string().min(1),
  type: ticketTypeSchema,
  status: z.string().min(1).optional(),
  description: z.string().default(''),
  backlog: z.boolean().default(false),
})

// `pinned` is deliberately absent here — it has its own bridge methods
// (pinTicket/unpinTicket) that enforce the 4-slot bench cap. A free-form
// patch would let a caller pin straight past it.
const updateSchema = z.object({
  uuid: z.string().min(1),
  patch: z.object({
    title: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    description: z.string().optional(),
    backlog: z.boolean().optional(),
    archived: z.boolean().optional(),
  }),
})

const uuidSchema = z.object({ uuid: z.string().min(1) })

// --- Methods ---

export function createTicket(input: unknown): BridgeTicket {
  const data = createSchema.parse(input)
  const now = Date.now()
  const ticket: BridgeTicket = {
    uuid: randomUUID(),
    id: nextId(),
    title: data.title,
    type: data.type,
    status: data.status ?? INITIAL_STATUS[data.type],
    backlog: data.backlog,
    pinned: false,
    description: data.description,
    archived: false,
    created_at: now,
    updated_at: now,
  }
  writeTicket(ticket)
  return ticket
}

export function getTicket(input: unknown): BridgeTicket | null {
  const { uuid } = uuidSchema.parse(input)
  const row = readRow(uuid)
  return row ? rowToTicket(row) : null
}

export function listTickets(): BridgeTicket[] {
  const rows = runTicketSql('SELECT * FROM tickets ORDER BY created_at ASC', []) as TicketRow[]
  return rows.map(rowToTicket)
}

/** Read-modify-write upsert so side effects (vault/history) target by uuid. */
export function updateTicket(input: unknown): BridgeTicket {
  const { uuid, patch } = updateSchema.parse(input)
  const row = readRow(uuid)
  if (!row) throw new Error(`bridge: ticket "${uuid}" not found.`)
  const updated: BridgeTicket = { ...rowToTicket(row), ...patch, updated_at: Date.now() }
  writeTicket(updated)
  return updated
}

export function deleteTicket(input: unknown): { uuid: string } {
  const { uuid } = uuidSchema.parse(input)
  runTicketSql('DELETE FROM tickets WHERE uuid = ?', [uuid])
  notifyTicketUpdated(uuid)
  return { uuid }
}

interface BenchSlotRow {
  ticket_uuid: string
  slot: number
}

/** Current bench, ordered by slot. */
function benchSlots(): BenchSlotRow[] {
  return runSql('SELECT ticket_uuid, slot FROM bench_slots ORDER BY slot', []) as BenchSlotRow[]
}

/** Lowest slot not currently occupied. Assumes the caller already checked room exists. */
function nextFreeSlot(taken: Set<number>): number {
  let slot = 0
  while (taken.has(slot)) slot++
  return slot
}

/**
 * Pins a ticket onto the bench. Idempotent if already pinned.
 *
 * Throws when the bench is full — the cap is enforced here, not by the
 * `pinned` boolean, which nothing else in this file lets a caller set
 * directly any more. The error names the current bench so a caller (a
 * person or an agent) can decide what to swap out instead of retrying blind.
 *
 * Not wrapped in `transact()`: `writeTicket` already opens one internally
 * (via `syncMentions`), and this module's `transact` doesn't nest. Nothing
 * here awaits, so the two statements run back-to-back with no interleaving
 * possible in this single-threaded process — the same guarantee a SQL
 * transaction would give, without needing one.
 */
export function pinTicket(input: unknown): BridgeTicket {
  const { uuid } = uuidSchema.parse(input)
  const row = readRow(uuid)
  if (!row) throw new Error(`bridge: ticket "${uuid}" not found.`)
  if (row.pinned === 1) return rowToTicket(row)

  const slots = benchSlots()
  if (slots.length >= MAX_BENCH_TICKETS) {
    const benched = slots
      .map((s) => readRow(s.ticket_uuid))
      .filter((r): r is TicketRow => r !== null)
      .map((r) => `${r.id} ${r.title}`)
      .join('; ')
    throw new Error(
      `bridge: the bench is full (${MAX_BENCH_TICKETS}/${MAX_BENCH_TICKETS}) — ${benched}. ` +
      `Unpin one before pinning another.`,
    )
  }
  runSql('INSERT INTO bench_slots (ticket_uuid, slot) VALUES (?, ?)', [
    uuid, nextFreeSlot(new Set(slots.map((s) => s.slot))),
  ])
  const updated = { ...rowToTicket(row), pinned: true, updated_at: Date.now() }
  writeTicket(updated)
  return updated
}

/** Unpins a ticket, freeing its slot. Idempotent if not pinned. See {@link pinTicket} on transactions. */
export function unpinTicket(input: unknown): BridgeTicket {
  const { uuid } = uuidSchema.parse(input)
  const row = readRow(uuid)
  if (!row) throw new Error(`bridge: ticket "${uuid}" not found.`)
  if (row.pinned === 0) return rowToTicket(row)

  runSql('DELETE FROM bench_slots WHERE ticket_uuid = ?', [uuid])
  const updated = { ...rowToTicket(row), pinned: false, updated_at: Date.now() }
  writeTicket(updated)
  return updated
}

/** The bench, ordered by slot — tickets in full, not just uuids. */
export function listBench(): BridgeTicket[] {
  return benchSlots()
    .map((s) => readRow(s.ticket_uuid))
    .filter((r): r is TicketRow => r !== null)
    .map(rowToTicket)
}
