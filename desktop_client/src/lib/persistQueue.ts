/**
 * Per-key trailing debounce for persistence.
 *
 * Mutations stay synchronous and in-memory; only the *write* is deferred.
 * Without this, every keystroke in the ticket editor costs a synchronous SQL
 * UPSERT plus a whole-file vault write on the main process's only thread.
 *
 * Timing policy lives here — at the persistence boundary — deliberately, so
 * the model layer (`Ticket`) never owns it.
 */

/** How long a key must sit idle before its pending write runs. */
export const PERSIST_DEBOUNCE_MS = 400

export class PersistQueue {
  readonly #delay: number

  /** One timer per key. Re-armed on every schedule() while input continues. */
  #timers = new Map<string, ReturnType<typeof setTimeout>>()

  /** The latest task per key — earlier ones are superseded, never run. */
  #pending = new Map<string, () => Promise<void>>()

  /** Writes currently running, so flush() can await one already in progress. */
  #inflight = new Map<string, Promise<void>>()

  constructor(delay: number = PERSIST_DEBOUNCE_MS) {
    this.#delay = delay
  }

  /**
   * Queues `task` for `key`, replacing any task already waiting and restarting
   * the idle window. A burst of calls therefore results in a single run.
   */
  schedule(key: string, task: () => Promise<void>): void {
    this.#pending.set(key, task)

    const existing = this.#timers.get(key)
    if (existing) clearTimeout(existing)

    this.#timers.set(key, setTimeout(() => {
      this.#timers.delete(key)
      void this.#run(key)
    }, this.#delay))
  }

  /** True if `key` has a write waiting on its timer. */
  hasPending(key: string): boolean {
    return this.#pending.has(key)
  }

  /**
   * Runs `key`'s pending write immediately and resolves once it has landed.
   *
   * Callers depending on write ordering — notably the history snapshot, which
   * would otherwise capture stale text — must await this first.
   */
  async flush(key: string): Promise<void> {
    const timer = this.#timers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.#timers.delete(key)
    }
    if (this.#pending.has(key)) {
      await this.#run(key)
      return
    }
    // Nothing queued, but a write may still be settling from an earlier run.
    await this.#inflight.get(key)
  }

  /**
   * Discards `key`'s pending write, then waits for any in-flight one to
   * settle. Use before a delete — running the queued write would otherwise
   * re-insert the row after it was removed.
   */
  async cancel(key: string): Promise<void> {
    const timer = this.#timers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.#timers.delete(key)
    }
    this.#pending.delete(key)
    await this.#inflight.get(key)
  }

  /** Flushes every key. Use on teardown — unmount, project switch, quit. */
  async flushAll(): Promise<void> {
    const keys = new Set([...this.#pending.keys(), ...this.#inflight.keys()])
    await Promise.all([...keys].map((key) => this.flush(key)))
  }

  /** Drops pending work without running it. Tests only. */
  __resetForTests(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer)
    this.#timers.clear()
    this.#pending.clear()
    this.#inflight.clear()
  }

  async #run(key: string): Promise<void> {
    const task = this.#pending.get(key)
    if (!task) return
    this.#pending.delete(key)

    // Chain behind any in-flight write for this key so two runs can't
    // interleave and land out of order.
    const previous = this.#inflight.get(key)
    const run = (async () => {
      if (previous) await previous.catch(() => {})
      await task()
    })()

    this.#inflight.set(key, run)
    try {
      await run
    } finally {
      if (this.#inflight.get(key) === run) this.#inflight.delete(key)
    }
  }
}

/** The app-wide queue. Ticket writes are keyed by uuid. */
export const persistQueue = new PersistQueue()
