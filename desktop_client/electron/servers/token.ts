/**
 * Startup token for the local HTTP server.
 *
 * A random token is generated once when the app starts and written to
 * `userData/bridge.token`. External callers (scripts, MCP, CLI) read
 * that file and include the token as `Authorization: Bearer <token>`.
 *
 * The file is readable only by the current user (mode 0o600).
 * It is regenerated on every app start, so tokens don't persist across sessions.
 */

import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

let activeToken: string | null = null
let tokenPath: string | null = null

/** Generates a token, writes it to `<userData>/bridge.token`, returns the token. */
export function initToken(userData: string): string {
  const token = randomBytes(32).toString('hex')
  const path = join(userData, 'bridge.token')
  writeFileSync(path, token, { encoding: 'utf8', mode: 0o600 })
  activeToken = token
  tokenPath = path
  return token
}

/** Returns true if the supplied token matches the active session token. */
export function validateToken(token: string): boolean {
  return activeToken !== null && token === activeToken
}

/** Where external callers can find the token file. */
export function getTokenPath(): string | null {
  return tokenPath
}
