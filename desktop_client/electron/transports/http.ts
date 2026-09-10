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
 *   Body: { "method": "createTicket", "args": { ... }, "token"?: "<brief-token>" }
 *
 *   200 { "result": ..., "guide"?: "...", "token"?: "<brief-token>" }
 *   400 { "error": "..." }   — bad request / method error
 *   400 { "error": "...", "guide": "...", "token": "<brief-token>" } — unbriefed caller
 *   401 { "error": "Unauthorized" }
 *
 * The `token` field above is a separate concept from the `Authorization`
 * bearer token: it proves the caller has seen the current agent guide (see
 * `bridge/briefing.ts`), not that it's allowed to call the bridge at all.
 */

import { createServer, type Server } from 'node:http'
import { dispatchBridgeExternal, activeProjectStamp, BriefingRequiredError } from '../bridge'
import { validateToken } from './token'

const PORT = 49152  // first ephemeral port — avoids clashing with common dev servers

let server: Server | null = null

function json(body: unknown): string {
  return JSON.stringify(body)
}

/**
 * Extracts and checks the bearer token.
 *
 * Until this round the header above the file described exactly this and
 * nothing performed it: the token was minted, written to disk at 0600, and
 * never read, so any local process could drive the app's data over HTTP.
 * `validateToken` does the constant-time comparison.
 */
function authenticated(header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false
  return validateToken(header.slice('Bearer '.length).trim())
}

/**
 * The dispatch-and-serialize step of `POST /invoke`, pulled out as a pure
 * function so the response-shape logic (guide/token injection on both the
 * success and unbriefed-caller paths) is unit-testable without a real
 * HTTP server.
 */
export function handleInvoke(body: { method: string; args?: unknown; token?: string })
  : { status: 200 | 400; body: Record<string, unknown> } {
  try {
    const { result, guide, token } = dispatchBridgeExternal(body.method, body.args ?? null, {
      caller: 'http',
      briefToken: body.token,
    })
    return {
      status: 200,
      body: {
        result,
        project: activeProjectStamp(),
        ...(guide && { guide }),
        ...(token && { token }),
      },
    }
  } catch (err) {
    if (err instanceof BriefingRequiredError) {
      return { status: 400, body: { error: err.message, guide: err.guide, token: err.token } }
    }
    return { status: 400, body: { error: (err as Error).message } }
  }
}

export function startHttpServer(): void {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')

    // Route
    if (req.method !== 'POST' || req.url !== '/invoke') {
      res.writeHead(404).end(json({ error: 'Not found. Use POST /invoke.' }))
      return
    }

    if (!authenticated(req.headers.authorization)) {
      res.writeHead(401).end(json({ error: 'Unauthorized' }))
      return
    }

    // Read body
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      let body: { method: string; args?: unknown; token?: string }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString())
      } catch (err) {
        res.writeHead(400).end(json({ error: (err as Error).message }))
        return
      }
      // caller: 'http' is what makes the gate's HTTP branch live — it was
      // never set before, so that branch was unreachable code.
      const { status, body: responseBody } = handleInvoke(body)
      res.writeHead(status).end(json(responseBody))
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
