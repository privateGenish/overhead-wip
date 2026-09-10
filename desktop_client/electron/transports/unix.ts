/**
 * Unix socket transport for the governed bridge (CLI entry point).
 *
 * The app creates a socket at `<userData>/bridge.sock` on startup.
 * The CLI connects, sends one newline-terminated JSON request, receives one
 * newline-terminated JSON response, then disconnects.
 *
 * No auth token is required — the socket is owned by the current user (mode
 * 0o600), so filesystem permissions serve as the auth boundary. A separate,
 * unrelated "brief token" (see `bridge/briefing.ts`) proves the caller has
 * seen the current agent guide; it travels in the same request/response.
 *
 * Protocol:
 *   → { "method": "createTicket", "args": { ... }, "token"?: "<brief-token>" }\n
 *   ← { "result": ..., "guide"?: "...", "token"?: "<brief-token>" }\n   on success
 *   ← { "error": "..." }\n                                             on failure
 *   ← { "error": "...", "guide": "...", "token": "<brief-token>" }\n   unbriefed caller
 */

import { createServer, type Server } from 'node:net'
import { unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dispatchBridgeExternal, activeProjectStamp, BriefingRequiredError } from '../bridge'

let server: Server | null = null
let socketPath: string | null = null

/**
 * The dispatch-and-serialize step, pulled out as a pure function so the
 * response-shape logic (guide/token injection) is unit-testable without a
 * real socket.
 */
export function handleInvoke(req: { method: string; args?: unknown; token?: string }): string {
  try {
    const { result, guide, token } = dispatchBridgeExternal(req.method, req.args ?? null, {
      caller: 'unix',
      briefToken: req.token,
    })
    return JSON.stringify({
      result,
      project: activeProjectStamp(),
      ...(guide && { guide }),
      ...(token && { token }),
    })
  } catch (err) {
    if (err instanceof BriefingRequiredError) {
      return JSON.stringify({ error: err.message, guide: err.guide, token: err.token })
    }
    return JSON.stringify({ error: (err as Error).message })
  }
}

export function startUnixServer(userData: string): void {
  socketPath = join(userData, 'bridge.sock')

  // Clean up a stale socket from a previous run.
  if (existsSync(socketPath)) {
    try { unlinkSync(socketPath) } catch { /* ignore */ }
  }

  server = createServer((socket) => {
    socket.setEncoding('utf8')
    let buf = ''

    socket.on('data', (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl === -1) return

      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)

      let response: string
      try {
        const req = JSON.parse(line) as { method: string; args?: unknown; token?: string }
        response = handleInvoke(req)
      } catch (err) {
        response = JSON.stringify({ error: (err as Error).message })
      }

      socket.end(response + '\n')
    })

    socket.on('error', (err) => {
      console.error('[bridge:unix] socket error:', err)
    })
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error('[bridge:unix] server error:', err)
    server = null
  })

  // 0o600 so only the owning user can connect.
  server.listen({ path: socketPath, readableAll: false, writableAll: false }, () => {
    console.log(`[bridge] unix socket at ${socketPath}`)
  })
}

export function stopUnixServer(): void {
  server?.close()
  server = null
  if (socketPath && existsSync(socketPath)) {
    try { unlinkSync(socketPath) } catch { /* ignore */ }
  }
  socketPath = null
}

export { socketPath as getSocketPath }
