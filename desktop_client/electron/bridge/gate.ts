/**
 * Cross-cutting gate for the governed bridge (Door 2).
 *
 * Every bridge method passes through here before it runs, so authorization and
 * throttling live in exactly one place regardless of which transport the call
 * arrived on (renderer IPC today; external sockets/MCP/CLI later).
 *
 * Auth + throttle are deliberate pass-throughs for now — step 3 fills them in.
 * Per-method *input* validation is not here; each method validates its own
 * payload with Zod, since the shape differs per method.
 */

export interface BridgeContext {
  /** Identifies the caller once transports/auth land (e.g. 'renderer', a plugin id). */
  caller?: string
}

/** Authorizes a method call for the given caller. No-op until step 3. */
export function authorize(_method: string, _ctx: BridgeContext): void {
  // TODO(step 3): per-method capability checks keyed off ctx.caller
}

/** Rate-limits a method call for the given caller. No-op until step 3. */
export function throttle(_method: string, _ctx: BridgeContext): void {
  // TODO(step 3): per-caller throttling
}
