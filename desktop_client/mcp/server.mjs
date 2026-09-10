#!/usr/bin/env node
/**
 * Overhead MCP server — an MCP transport for the governed bridge (Door 2).
 *
 * Like the CLI, this is a standalone process: it can't import the bridge
 * directly (that lives inside Electron's main process), so it forwards every
 * tool call to the running app over the same unix socket the CLI uses.
 *
 *   MCP host (Claude Desktop, etc.)
 *        │  stdio (JSON-RPC 2.0, newline-delimited)
 *        ▼
 *   mcp/server.mjs  ──unix socket──►  dispatchBridge()
 *
 * Each bridge method is exposed 1:1 as an MCP tool (tool name == method name).
 *
 * Wire it into an MCP host config, e.g. Claude Desktop:
 *   {
 *     "mcpServers": {
 *       "overhead": { "command": "node", "args": ["<abs>/desktop_client/mcp/server.mjs"] }
 *     }
 *   }
 *
 * Socket: ~/Library/Application Support/desktop_client/bridge.sock
 * Override with the OVH_SOCKET env var.
 */

import { createConnection } from 'node:net'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// Bridge transport (unix socket — identical protocol to the CLI)
// ---------------------------------------------------------------------------

const SOCKET = process.env.OVH_SOCKET ?? join(
  homedir(), 'Library', 'Application Support', 'desktop_client', 'bridge.sock',
)

function invoke(method, args) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET)
    let buf = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      socket.write(JSON.stringify({ method, args: args ?? null }) + '\n')
    })
    socket.on('data', (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      try {
        const msg = JSON.parse(buf.slice(0, nl))
        if ('error' in msg) reject(new Error(msg.error))
        else resolve(msg.result)
      } catch {
        reject(new Error('Malformed response from bridge'))
      }
      socket.destroy()
    })
    socket.on('error', (err) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED')
        reject(new Error('Cannot connect to Overhead — is the app running?'))
      else reject(err)
    })
  })
}

// ---------------------------------------------------------------------------
// Tool definitions (JSON Schema mirrors each method's Zod schema)
// ---------------------------------------------------------------------------

const str = (description) => ({ type: 'string', description })
const num = (description) => ({ type: 'number', description })
const bool = (description) => ({ type: 'boolean', description })
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

const TICKET_TYPE = { type: 'string', enum: ['Explore', 'Feature', 'Execute'], description: 'Ticket type' }
const HANDLE = { type: 'string', enum: ['left', 'right', 'top', 'bottom'], description: 'Which port on the node the edge attaches to' }

/** name == bridge method. Order grouped for readability in tools/list. */
const TOOLS = [
  // --- Project context ---
  {
    name: 'getProjectContext',
    // Written to be reached for, not merely available. Delivery is opt-in, so
    // this description is the whole mechanism by which an agent learns the
    // project's intent before it decides something on the user's behalf.
    description:
      "The project's stated intent: its north star and vision, as the user wrote them. " +
      'Call this BEFORE making judgment calls a ticket does not settle on its own — ' +
      'which approach to take, what to prioritise, where to draw a line. ' +
      'It is how the user steers work they are not watching.',
    inputSchema: schema({}),
  },

  // --- Tickets ---
  { name: 'listTickets', description: 'List all tickets.', inputSchema: schema({}) },
  { name: 'getTicket', description: 'Get one ticket by uuid.', inputSchema: schema({ uuid: str('Ticket uuid') }, ['uuid']) },
  {
    name: 'createTicket',
    description: 'Create a ticket. Status defaults per type (Execute→Draft, Explore→Open, Feature→Idea).',
    inputSchema: schema({
      title: str('Ticket title'),
      type: TICKET_TYPE,
      status: str('Optional initial status; defaults per type'),
      description: str('Optional markdown description'),
      backlog: bool('Optional; place in backlog'),
    }, ['title', 'type']),
  },
  {
    name: 'proposeTicket',
    description:
      'Propose a ticket draft for human approval — use instead of createTicket when the ticket ' +
      'originates from your own judgment (the user is dwelling on a question, describing a ' +
      'capability) rather than an explicit instruction to create one. The draft is not a real ' +
      'ticket until a human approves it in the app; it has no id and cannot be read, updated, ' +
      'or deleted through this tool.',
    inputSchema: schema({
      title: str('Ticket title'),
      type: TICKET_TYPE,
      description: str('Optional markdown description'),
    }, ['title', 'type']),
  },
  {
    name: 'updateTicket',
    description: 'Patch a ticket. Only provided fields change.',
    inputSchema: schema({
      uuid: str('Ticket uuid'),
      patch: schema({
        title: str('New title'),
        status: str('New status'),
        description: str('New description'),
        backlog: bool('Backlog flag'),
        archived: bool('Archived flag'),
      }),
    }, ['uuid', 'patch']),
  },
  { name: 'deleteTicket', description: 'Delete a ticket by uuid.', inputSchema: schema({ uuid: str('Ticket uuid') }, ['uuid']) },

  // --- Relations ---
  { name: 'relate', description: 'Symmetrically relate two tickets (relates-to).', inputSchema: schema({ a: str('Ticket A uuid'), b: str('Ticket B uuid') }, ['a', 'b']) },
  { name: 'blockBy', description: 'Mark `blocked` as blocked by `blocker`.', inputSchema: schema({ blocked: str('Blocked ticket uuid'), blocker: str('Blocker ticket uuid') }, ['blocked', 'blocker']) },
  { name: 'unrelate', description: 'Remove a relation by its uuid.', inputSchema: schema({ uuid: str('Relation uuid') }, ['uuid']) },
  { name: 'listRelations', description: 'List every relation touching a ticket.', inputSchema: schema({ ticketUuid: str('Ticket uuid') }, ['ticketUuid']) },

  // --- Views ---
  { name: 'listViews', description: 'List all graph views.', inputSchema: schema({}) },
  { name: 'createView', description: 'Create a graph view.', inputSchema: schema({ name: str('View name') }, ['name']) },
  { name: 'renameView', description: 'Rename a graph view.', inputSchema: schema({ uuid: str('View uuid'), name: str('New name') }, ['uuid', 'name']) },
  { name: 'deleteView', description: 'Delete a graph view.', inputSchema: schema({ uuid: str('View uuid') }, ['uuid']) },
  {
    name: 'getViewMap',
    description:
      'Full snapshot of a graph view: { view, nodes, edges }. Nodes carry the ticket id, ' +
      'title, type and status. Every edge is typed: "blocked-by" points blocker to blocked ' +
      'and is how the graph says what must come first; "relates-to" couples tickets into ' +
      'one piece of work; "visual" is a hand-drawn line carrying no meaning. ' +
      'Read this to understand the order of work before planning it.',
    inputSchema: schema({ viewUuid: str('View uuid') }, ['viewUuid']),
  },

  // --- View nodes ---
  { name: 'listViewNodes', description: 'List nodes in a view, enriched with ticket id/title/type/status and x,y.', inputSchema: schema({ viewUuid: str('View uuid') }, ['viewUuid']) },
  { name: 'getViewNode', description: 'Get one node (enriched) by view + ticket uuid; null if absent.', inputSchema: schema({ viewUuid: str('View uuid'), ticketUuid: str('Ticket uuid') }, ['viewUuid', 'ticketUuid']) },
  { name: 'addViewNode', description: 'Place a ticket on the canvas at (x,y). Upserts if already present.', inputSchema: schema({ viewUuid: str('View uuid'), ticketUuid: str('Ticket uuid'), x: num('X coordinate'), y: num('Y coordinate') }, ['viewUuid', 'ticketUuid', 'x', 'y']) },
  { name: 'moveViewNode', description: 'Move a node to an absolute (x,y). Errors if the node is not on the view.', inputSchema: schema({ viewUuid: str('View uuid'), ticketUuid: str('Ticket uuid'), x: num('New X'), y: num('New Y') }, ['viewUuid', 'ticketUuid', 'x', 'y']) },
  { name: 'nudgeViewNode', description: 'Move a node by a relative (dx,dy). Errors if the node is not on the view.', inputSchema: schema({ viewUuid: str('View uuid'), ticketUuid: str('Ticket uuid'), dx: num('Delta X'), dy: num('Delta Y') }, ['viewUuid', 'ticketUuid', 'dx', 'dy']) },
  { name: 'removeViewNode', description: 'Remove a ticket from the canvas.', inputSchema: schema({ viewUuid: str('View uuid'), ticketUuid: str('Ticket uuid') }, ['viewUuid', 'ticketUuid']) },

  // --- View edges ---
  { name: 'listViewEdges', description: 'List stored (plain) edges in a view.', inputSchema: schema({ viewUuid: str('View uuid') }, ['viewUuid']) },
  {
    name: 'createViewEdge',
    description: 'Create a plain edge between two nodes. Optional handles pin which ports it attaches to; for a related pair this anchors the derived typed edge.',
    inputSchema: schema({
      viewUuid: str('View uuid'),
      sourceUuid: str('Source ticket uuid'),
      targetUuid: str('Target ticket uuid'),
      sourceHandle: HANDLE,
      targetHandle: HANDLE,
    }, ['viewUuid', 'sourceUuid', 'targetUuid']),
  },
  { name: 'removeViewEdge', description: 'Remove a stored edge by uuid.', inputSchema: schema({ uuid: str('Edge uuid') }, ['uuid']) },
]

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name))

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 over stdio (newline-delimited, per MCP stdio transport)
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = { name: 'overhead-bridge', version: '0.1.0' }

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(req) {
  const { id, method, params } = req

  // Notifications (no id) get no response.
  const isNotification = id === undefined || id === null

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      })
      return

    case 'ping':
      reply(id, {})
      return

    case 'tools/list':
      reply(id, { tools: TOOLS })
      return

    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments ?? {}
      if (!TOOL_NAMES.has(name)) {
        reply(id, { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] })
        return
      }
      try {
        const result = await invoke(name, args)
        reply(id, { content: [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }] })
      } catch (err) {
        reply(id, { isError: true, content: [{ type: 'text', text: `error: ${err.message}` }] })
      }
      return
    }

    default:
      if (isNotification) return // ignore unknown notifications (e.g. notifications/initialized)
      replyError(id, -32601, `Method not found: ${method}`)
  }
}

// ---------------------------------------------------------------------------
// stdin loop
// ---------------------------------------------------------------------------

// Track in-flight tool calls so a closing stdin doesn't kill a pending bridge
// round-trip before its response is written.
const inflight = new Set()
let ended = false
function track(p) {
  inflight.add(p)
  p.finally(() => {
    inflight.delete(p)
    if (ended && inflight.size === 0) process.exit(0)
  })
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    let req
    try {
      req = JSON.parse(line)
    } catch {
      // Can't recover an id from unparseable input — log and skip.
      process.stderr.write(`[overhead-mcp] skipping non-JSON line\n`)
      continue
    }
    track(handle(req))
  }
})

process.stdin.on('end', () => {
  ended = true
  if (inflight.size === 0) process.exit(0)
})

process.stderr.write(`[overhead-mcp] ready — ${TOOLS.length} tools, socket ${SOCKET}\n`)
