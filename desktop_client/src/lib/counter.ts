/**
 * Simple persistent counter backed by the local blob store.
 *
 * Stores one record: { uuid: 'COUNTER', value: number }
 * Each call to `Counter.next()` reads the current value, increments it,
 * saves it back, and returns the formatted ticket ID.
 */

import { dbClientForRenderer } from './dbClientForRenderer'

const COUNTER_UUID = 'COUNTER'
const ID_PREFIX = 'OVH'

interface CounterRecord {
  uuid: typeof COUNTER_UUID
  value: number
}

export class Counter {
  /** Returns the next ID in sequence, e.g. OVH-001, OVH-002, … */
  static async next(): Promise<string> {
    const record = await dbClientForRenderer.get<CounterRecord>(COUNTER_UUID)
    const next = (record?.value ?? 0) + 1
    await dbClientForRenderer.put({ uuid: COUNTER_UUID, value: next })
    return `${ID_PREFIX}-${String(next).padStart(3, '0')}`
  }

}
