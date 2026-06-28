/**
 * Governed relation methods for the bridge (Door 2).
 *
 * Thin, validated wrappers over `runRelationOp` — they expose intent-named
 * operations (relate / blockBy / unrelate / listRelations) instead of the raw
 * op+payload protocol, and never let the caller pick a relation type freely.
 */

import { z } from 'zod'
import { runRelationOp } from '../ipc/relationsAPI'
import { notifyGraphUpdated } from '../ipc/notify'

const pairSchema = z.object({ a: z.string().min(1), b: z.string().min(1) })
const blockSchema = z.object({ blocked: z.string().min(1), blocker: z.string().min(1) })
const uuidSchema = z.object({ uuid: z.string().min(1) })
const ticketUuidSchema = z.object({ ticketUuid: z.string().min(1) })

/** Symmetric link between two tickets. Order doesn't matter (canonicalized downstream). */
export function relate(input: unknown): unknown {
  const { a, b } = pairSchema.parse(input)
  const result = runRelationOp('add', { type: 'relates-to', node_a: a, node_b: b })
  notifyGraphUpdated()
  return result
}

/** Marks `blocked` as blocked by `blocker`. */
export function blockBy(input: unknown): unknown {
  const { blocked, blocker } = blockSchema.parse(input)
  const result = runRelationOp('add', { type: 'blocked-by', node_a: blocked, node_b: blocker })
  notifyGraphUpdated()
  return result
}

/** Removes a relation by its uuid. */
export function unrelate(input: unknown): unknown {
  const { uuid } = uuidSchema.parse(input)
  const result = runRelationOp('remove', { uuid })
  notifyGraphUpdated()
  return result
}

/** Lists every relation touching a ticket. */
export function listRelations(input: unknown): unknown {
  const { ticketUuid } = ticketUuidSchema.parse(input)
  return runRelationOp('list', { ticketUuid })
}
