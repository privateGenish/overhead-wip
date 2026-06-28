/**
 * Unix socket transport for the governed bridge (CLI entry point).
 *
 * The app creates a socket at `<userData>/bridge.sock` on startup.
 * The CLI connects, sends one newline-terminated JSON request, receives one
 * newline-terminated JSON response, then disconnects.
 *
 * No token is required — the socket is owned by the current user (mode 0o600),
 * so filesystem permissions serve as the auth boundary.
 *
 * Protocol:
 *   → { "method": "createTicket", "args": { ... } }\n
 *   ← { "result": ... }\n          on success
 *   ← { "error": "..." }\n         on failure
 */

import { createServer, type Server } from 'node:net'
import { unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dispatchBridge } from '../bridge'

let server: Server | null = null
let socketPath: string | null = null

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
        const req = JSON.parse(line) as { method: string; args?: unknown }
        const result = dispatchBridge(req.method, req.args ?? null, { caller: 'unix' })
        response = JSON.stringify({ result })
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
