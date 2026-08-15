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

/**
 * Rate limit per caller, as a sliding window.
 *
 * Not a security control — the socket's file permissions and the HTTP token
 * are that. This is a guard against a runaway agent loop hammering the
 * database: a stuck retry can otherwise issue thousands of writes a second,
 * and every one of them fans out into a synchronous SQL write plus a vault
 * file write on the main process's only thread.
 *
 * The ceiling is deliberately far above anything deliberate use produces.
 */
const WINDOW_MS = 1_000
const MAX_CALLS_PER_WINDOW = 100

const recentCalls = new Map<string, number[]>()

export function throttle(_method: string, ctx: BridgeContext): void {
  const key = ctx.caller ?? 'local'
  const now = Date.now()

  const calls = (recentCalls.get(key) ?? []).filter((at) => now - at < WINDOW_MS)
  calls.push(now)
  recentCalls.set(key, calls)

  if (calls.length > MAX_CALLS_PER_WINDOW) {
    throw new Error(
      `bridge: rate limit exceeded for "${key}" — more than ${MAX_CALLS_PER_WINDOW} calls in ${WINDOW_MS}ms. ` +
      'This usually means a caller is looping; slow down and retry.',
    )
  }
}

/** Clears the rate-limit state. Tests only. */
export function __resetThrottleForTests(): void {
  recentCalls.clear()
}
