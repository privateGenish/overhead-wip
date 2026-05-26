/**
 * Pure batch dispatcher for the local storage API. Validates an incoming
 * `db:query` payload, runs every op inside one SQLite transaction, and
 * returns a result array parallel to the request.
 *
 * Kept free of Electron imports so it can be unit-tested directly against
 * an in-memory SQLite database.
 *
 * ## Typed puts
 *
 * A `put` payload with a `resourceType` field is validated against a
 * registered schema before it reaches SQLite. Unknown `resourceType` values
 * fall through as generic blobs.
 *
 *   { put: { resourceType: 'ticket', uuid: '…', title: '…', … } }
 *
 * Add future resource types to `PUT_VALIDATORS` below.
 */

import { ticketDataSchema } from '../../src/shared/types/ticket'
import { dbAll, dbDelete, dbGet, dbPut, transact } from '../db/sqlite'

export const MAX_OPS_PER_BATCH = 10

// --- Typed put registry ---

/**
 * Maps `resourceType` strings to their Zod validators. Each validator
 * receives the full put payload and returns the (possibly Zod-coerced)
 * record to store.
 *
 * To add a new resource type: import its schema and add an entry here.
 */
const PUT_VALIDATORS: Record<string, (data: unknown) => { uuid: string } & Record<string, unknown>> = {
  ticket: (data) => ticketDataSchema.parse(data) as { uuid: string } & Record<string, unknown>,
}

// --- Types ---

/** One op in a batch — exactly one key. */
export type DbOp =
  | { get: string }
  | { all: null }
  | { put: { uuid: string; resourceType?: string } & Record<string, unknown> }
  | { delete: string }

// --- Public API ---

/**
 * Validate, dispatch, and atomically apply a batch of ops. Throws on any
 * validation or DB error; the SQLite transaction rolls back on throw.
 */
export function runBatch(ops: unknown): unknown[] {
  if (!Array.isArray(ops)) {
    throw new Error('db:query expects an array of operations.')
  }
  if (ops.length === 0) return []
  if (ops.length > MAX_OPS_PER_BATCH) {
    throw new Error(
      `Batch too large: ${ops.length} ops > limit of ${MAX_OPS_PER_BATCH}.`,
    )
  }
  return transact(() => ops.map(execute))
}

// --- Private ---

/** Dispatches a single op to its prepared statement. */
function execute(op: unknown): unknown {
  if (!op || typeof op !== 'object') {
    throw new Error('Each op must be an object with a single key.')
  }
  const entries = Object.entries(op as Record<string, unknown>)
  if (entries.length !== 1) {
    throw new Error('Each op must have exactly one key (get | all | put | delete).')
  }
  const [kind, payload] = entries[0]
  switch (kind) {
    case 'get':
      assertString(payload, 'get')
      return dbGet(payload)
    case 'all':
      return dbAll()
    case 'put':
      assertRecord(payload)
      dbPut(validatePut(payload))
      return undefined
    case 'delete':
      assertString(payload, 'delete')
      dbDelete(payload)
      return undefined
    default:
      throw new Error(`Unknown op: "${kind}".`)
  }
}

/**
 * If the payload declares a `resourceType` with a registered validator,
 * parse it through the validator (throws on invalid shape). Otherwise
 * passes through as a generic blob.
 */
function validatePut(
  payload: { uuid: string } & Record<string, unknown>,
): { uuid: string } & Record<string, unknown> {
  const resourceType = payload.resourceType
  if (typeof resourceType === 'string' && resourceType in PUT_VALIDATORS) {
    return PUT_VALIDATORS[resourceType](payload)
  }
  return payload
}

function assertString(v: unknown, op: string): asserts v is string {
  if (typeof v !== 'string') {
    throw new Error(`Op "${op}" expects a uuid string.`)
  }
}

function assertRecord(
  v: unknown,
): asserts v is { uuid: string } & Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    typeof (v as { uuid: unknown }).uuid !== 'string'
  ) {
    throw new Error('Op "put" expects an object with a string `uuid` field.')
  }
}
