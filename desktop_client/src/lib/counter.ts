import { generalClient } from './generalClient'

const COUNTER_KEY = 'counter'
const ID_PREFIX = 'OVH'

export class Counter {
  static async next(): Promise<string> {
    const raw = await generalClient.settingGet(COUNTER_KEY)
    const next = (raw ? parseInt(raw, 10) : 0) + 1
    await generalClient.settingSet(COUNTER_KEY, String(next))
    return `${ID_PREFIX}-${String(next).padStart(3, '0')}`
  }
}
