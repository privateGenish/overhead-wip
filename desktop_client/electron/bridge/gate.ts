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
  /** Identifies the caller (e.g. 'http'). Used for auth and throttling. */
  caller?: string
  /** Pre-validated auth token, extracted by the transport layer. */
  token?: string
}

/** Authorizes a method call. HTTP callers must supply a valid session token. */
export function authorize(_method: string, ctx: BridgeContext): void {
  if (ctx.caller === 'http') {
    // Token is validated by the HTTP layer before dispatchBridge is called,
    // so by the time we're here it's already clean. This hook is the place to
    // add per-method capability checks (e.g. read-only callers) in the future.
  }
}

/** Rate-limits a method call for the given caller. No-op for now. */
export function throttle(_method: string, _ctx: BridgeContext): void {
  // TODO: per-caller throttling
}
