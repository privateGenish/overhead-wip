/**
 * Local HTTP server — the first external transport for the governed bridge.
 *
 * Binds to 127.0.0.1 only (never 0.0.0.0).
 * Every request must carry `Authorization: Bearer <token>` matching the
 * session token written to `userData/bridge.token` at startup.
 *
 * Protocol:
 *   POST /invoke
 *   Content-Type: application/json
 *   Authorization: Bearer <token>
 *   Body: { "method": "createTicket", "args": { ... } }
 *
 *   200 { "result": ... }
 *   400 { "error": "..." }   — bad request / method error
 *   401 { "error": "Unauthorized" }
 */

import { createServer, type Server } from 'node:http'
import { dispatchBridge } from '../bridge'

const PORT = 49152  // first ephemeral port — avoids clashing with common dev servers

let server: Server | null = null

function json(body: unknown): string {
  return JSON.stringify(body)
}

export function startHttpServer(): void {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')

    // Route
    if (req.method !== 'POST' || req.url !== '/invoke') {
      res.writeHead(404).end(json({ error: 'Not found. Use POST /invoke.' }))
      return
    }

    // Read body
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          method: string
          args?: unknown
        }
        const result = dispatchBridge(body.method, body.args ?? null)
        res.writeHead(200).end(json({ result }))
      } catch (err) {
        res.writeHead(400).end(json({ error: (err as Error).message }))
      }
    })
  })

  // Handle listen errors here instead of letting them bubble up as an uncaught
  // exception that crashes the app. EADDRINUSE is common in dev: vite-plugin-
  // electron relaunches the main process on change and the old one can hold the
  // port for a moment. Log and move on — the surviving instance keeps the port.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[bridge] port ${PORT} already in use — another instance is running. HTTP transport disabled for this process.`)
    } else {
      console.error('[bridge] HTTP server error:', err)
    }
    server = null
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[bridge] HTTP server listening on 127.0.0.1:${PORT}`)
  })
}

export function stopHttpServer(): void {
  server?.close()
  server = null
}

export { PORT }
