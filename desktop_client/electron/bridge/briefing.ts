/**
 * The context-token briefing gate + burst-decay drift detector.
 *
 * A caller without a valid briefing token is rejected — but the rejection
 * itself carries the guide text and a fresh token, so failing IS the
 * briefing; no separate round trip is needed. Once briefed, `noteBurst`
 * tracks how much authored text a caller has pushed through an unbroken run
 * of calls and, past a threshold, rides a guide refresh on an otherwise-
 * successful response. This is a soft nudge, never a block — a caller that
 * ignores the guide and keeps writing pays an ever-cheaper-to-trigger
 * reminder, not a rejected call.
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { BridgeContext } from './gate'

const GUIDE_PATH = path.join(process.env.APP_ROOT ?? '', 'shared', 'agent-guide.md')
let cachedGuide: string | null = null

function guideText(): string {
  if (cachedGuide === null) {
    try {
      cachedGuide = fs.readFileSync(GUIDE_PATH, 'utf8')
    } catch (err) {
      // Fail open, not loud-blocking — an empty guide never stops a call from
      // succeeding. But this almost always means agent-guide.md was left out
      // of a packaged build (see electron-builder.yml), so it must be loud
      // somewhere: the app log is where a packaging regression gets noticed.
      console.error('[bridge] could not read agent-guide.md — briefing/gate will be a no-op:', err)
      cachedGuide = ''
    }
  }
  return cachedGuide
}

/** Thrown when a caller has not proven it has seen the current guide. */
export class BriefingRequiredError extends Error {
  guide: string
  token: string
  constructor(guide: string, token: string) {
    super('bridge: this caller has not been briefed. See "guide"; retry the same call with "token".')
    this.guide = guide
    this.token = token
  }
}

interface CallerState {
  token: string
  lastCallAt: number
  /** Index of the call within the current unbroken burst. Reset only by an idle gap. */
  t: number
  /** Accumulated drift weight. Reset only by crossing THRESHOLD. */
  f: number
}

const state = new Map<string, CallerState>()

/** Idle gap that ends a burst. Placeholder — tune from observed usage. */
const HANGOUT_MS = 5 * 60_000
/** Chosen so the 8th write in an unbroken burst carries ~2x the weight of the 1st (1.1^8 ≈ 2.14). */
const BURST_BASE = 1.1
/** Placeholder — tune from observed usage, not derived. */
const THRESHOLD = 500

function mintToken(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Hard gate. No-ops when `ctx.caller` is unset, mirroring `authorize()`'s
 * convention — this keeps every internal call to `dispatchBridge` (and every
 * existing test, which passes no `ctx` at all) unaffected. Only external
 * transports, which always set `caller`, are ever briefed or gated.
 */
export function ensureBriefed(_method: string, ctx: BridgeContext): void {
  if (!ctx.caller) return
  const existing = state.get(ctx.caller)
  if (existing && ctx.briefToken === existing.token) return

  const token = mintToken()
  state.set(ctx.caller, { token, lastCallAt: Date.now(), t: 0, f: 0 })
  throw new BriefingRequiredError(guideText(), token)
}

/**
 * Per-method authored-text length ("L") — the free text the agent itself
 * wrote in this specific call, not the ticket's total stored size. Anything
 * not listed here (relate/blockBy/unrelate, pin/unpinTicket, deleteTicket,
 * every *ViewNode/*ViewEdge method) carries no authored text and defaults to
 * 0 — those calls still inflate `t` (and so raise `BURST_BASE^t` for whatever
 * comes next) but never add to `f` directly.
 */
type AuthoredLengthExtractor = (args: Record<string, unknown> | null | undefined) => number

function stringLength(value: unknown): number {
  return typeof value === 'string' ? value.length : 0
}

const AUTHORED_LENGTH: Record<string, AuthoredLengthExtractor> = {
  createTicket: (a) => stringLength(a?.title) + stringLength(a?.description),
  proposeTicket: (a) => stringLength(a?.title) + stringLength(a?.description),
  updateTicket: (a) => {
    const patch = a?.patch as Record<string, unknown> | undefined
    return stringLength(patch?.title) + stringLength(patch?.description)
  },
  createView: (a) => stringLength(a?.name),
  renameView: (a) => stringLength(a?.name),
}

function authoredLength(method: string, args: unknown): number {
  const extractor = AUTHORED_LENGTH[method]
  if (!extractor) return 0
  return extractor(args as Record<string, unknown> | null | undefined)
}

/**
 * Non-blocking drift detector. Only ever called after a method has already
 * succeeded — it never throws, and its return value is purely additive on
 * top of a normal response.
 */
export function noteBurst(
  method: string,
  args: unknown,
  ctx: BridgeContext,
): { guide: string; token: string } | undefined {
  if (!ctx.caller) return undefined

  const now = Date.now()
  const s = state.get(ctx.caller) ?? { token: mintToken(), lastCallAt: now, t: 0, f: 0 }

  // An idle "hangout" gap ends the burst — t resets. f is untouched by idle;
  // it only ever resets by crossing the threshold below.
  if (now - s.lastCallAt > HANGOUT_MS) s.t = 0
  s.lastCallAt = now

  const t = s.t
  s.t += 1
  s.f += Math.pow(BURST_BASE, t) * authoredLength(method, args)

  let refresh: { guide: string; token: string } | undefined
  if (s.f > THRESHOLD) {
    s.token = mintToken()
    s.f = 0
    // t deliberately keeps climbing — this is what makes refreshes come
    // faster the deeper an agent goes into a single burst.
    refresh = { guide: guideText(), token: s.token }
  }

  state.set(ctx.caller, s)
  return refresh
}

/** Clears all briefing/burst state. Tests only. */
export function __resetBriefingForTests(): void {
  state.clear()
  cachedGuide = null
}
