#!/usr/bin/env node
/**
 * ovh — CLI transport for the Overhead bridge (Door 2).
 *
 * Connects directly to the unix socket the app exposes at startup.
 * No token needed — socket ownership restricts access to the current user.
 *
 * Usage:
 *   ovh context
 *
 *   ovh tickets list
 *   ovh tickets create <title> <type>  [--status S] [--description D] [--backlog]
 *   ovh tickets get <uuid>
 *   ovh tickets update <uuid>  [--title T] [--status S] [--description D] [--backlog] [--archived]
 *   ovh tickets delete <uuid>
 *
 *   ovh relations list <ticket-uuid>
 *   ovh relations relate <uuid-a> <uuid-b>
 *   ovh relations block <blocked-uuid> <blocker-uuid>
 *   ovh relations unrelate <relation-uuid>
 *
 *   ovh views list
 *   ovh views create <name>
 *   ovh views rename <uuid> <name>
 *   ovh views delete <uuid>
 *   ovh views nodes list <view-uuid>
 *   ovh views nodes add <view-uuid> <ticket-uuid> <x> <y>
 *   ovh views nodes remove <view-uuid> <ticket-uuid>
 *   ovh views edges list <view-uuid>
 *   ovh views edges create <view-uuid> <source-uuid> <target-uuid>  [--source-handle H] [--target-handle H]
 *   ovh views edges remove <edge-uuid>
 *
 * Socket: ~/Library/Application Support/desktop_client/bridge.sock
 * Override: --socket <path>
 * Output:  pretty JSON. Use --raw for minified.
 */

import { createConnection } from 'node:net'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_SOCKET = join(
  homedir(),
  'Library',
  'Application Support',
  'desktop_client',
  'bridge.sock',
)

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

function pullFlag(args, flag, hasValue = true) {
  const i = args.indexOf(flag)
  if (i === -1) return [undefined, args]
  if (!hasValue) return [true, [...args.slice(0, i), ...args.slice(i + 1)]]
  const value = args[i + 1]
  return [value, [...args.slice(0, i), ...args.slice(i + 2)]]
}

function parseFlags(args) {
  const flags = {}
  const positionals = []
  let i = 0
  while (i < args.length) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        flags[key] = true
        i++
      } else {
        flags[key] = args[i + 1]
        i += 2
      }
    } else {
      positionals.push(args[i])
      i++
    }
  }
  return [flags, positionals]
}

// ---------------------------------------------------------------------------
// Unix socket invoke
// ---------------------------------------------------------------------------

function invoke(socketPath, method, args) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
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
// CLI entry
// ---------------------------------------------------------------------------

async function main() {
  let args = process.argv.slice(2)

  let socketPath
  ;[socketPath, args] = pullFlag(args, '--socket')
  let raw
  ;[raw, args] = pullFlag(args, '--raw', false)

  const sock = socketPath ?? DEFAULT_SOCKET

  const [flags, positionals] = parseFlags(args)
  const [group, sub, ...rest] = positionals

  let result

  if (group === 'tickets') {
    if (sub === 'list') {
      result = await invoke(sock, 'listTickets', null)

    } else if (sub === 'get') {
      const [uuid] = rest
      need(uuid, 'uuid')
      result = await invoke(sock, 'getTicket', { uuid })

    } else if (sub === 'create') {
      const [title, type] = rest
      need(title, 'title')
      need(type, 'type  (Explore | Feature | Execute)')
      result = await invoke(sock, 'createTicket', {
        title,
        type,
        ...(flags.status      ? { status: flags.status }          : {}),
        ...(flags.description ? { description: flags.description } : {}),
        ...(flags.backlog     ? { backlog: true }                  : {}),
      })

    } else if (sub === 'update') {
      const [uuid] = rest
      need(uuid, 'uuid')
      const patch = {}
      if (flags.title       !== undefined) patch.title       = flags.title
      if (flags.status      !== undefined) patch.status      = flags.status
      if (flags.description !== undefined) patch.description = flags.description
      if (flags.backlog     !== undefined) patch.backlog     = flags.backlog === true || flags.backlog === 'true'
      if (flags.archived    !== undefined) patch.archived    = flags.archived === true || flags.archived === 'true'
      result = await invoke(sock, 'updateTicket', { uuid, patch })

    } else if (sub === 'delete') {
      const [uuid] = rest
      need(uuid, 'uuid')
      result = await invoke(sock, 'deleteTicket', { uuid })

    } else {
      usageTickets()
    }

  } else if (group === 'context') {
    // No subcommand: the project's intent is one thing, not a group.
    result = await invoke(sock, 'getProjectContext', {})

  } else if (group === 'relations') {
    if (sub === 'list') {
      const [ticketUuid] = rest
      need(ticketUuid, 'ticket-uuid')
      result = await invoke(sock, 'listRelations', { ticketUuid })

    } else if (sub === 'relate') {
      const [a, b] = rest
      need(a, 'uuid-a'); need(b, 'uuid-b')
      result = await invoke(sock, 'relate', { a, b })

    } else if (sub === 'block') {
      const [blocked, blocker] = rest
      need(blocked, 'blocked-uuid'); need(blocker, 'blocker-uuid')
      result = await invoke(sock, 'blockBy', { blocked, blocker })

    } else if (sub === 'unrelate') {
      const [uuid] = rest
      need(uuid, 'relation-uuid')
      result = await invoke(sock, 'unrelate', { uuid })

    } else {
      usageRelations()
    }

  } else if (group === 'views') {
    if (sub === 'list') {
      result = await invoke(sock, 'listViews', null)

    } else if (sub === 'create') {
      const [name] = rest
      need(name, 'name')
      result = await invoke(sock, 'createView', { name })

    } else if (sub === 'rename') {
      const [uuid, name] = rest
      need(uuid, 'uuid'); need(name, 'name')
      result = await invoke(sock, 'renameView', { uuid, name })

    } else if (sub === 'delete') {
      const [uuid] = rest
      need(uuid, 'uuid')
      result = await invoke(sock, 'deleteView', { uuid })

    } else if (sub === 'map') {
      const [viewUuid] = rest
      need(viewUuid, 'view-uuid')
      result = await invoke(sock, 'getViewMap', { viewUuid })

    } else if (sub === 'nodes') {
      const [cmd, ...r] = rest
      if (cmd === 'list') {
        const [viewUuid] = r
        need(viewUuid, 'view-uuid')
        result = await invoke(sock, 'listViewNodes', { viewUuid })

      } else if (cmd === 'get') {
        const [viewUuid, ticketUuid] = r
        need(viewUuid, 'view-uuid'); need(ticketUuid, 'ticket-uuid')
        result = await invoke(sock, 'getViewNode', { viewUuid, ticketUuid })

      } else if (cmd === 'add') {
        const [viewUuid, ticketUuid, xStr, yStr] = r
        need(viewUuid, 'view-uuid'); need(ticketUuid, 'ticket-uuid')
        need(xStr, 'x'); need(yStr, 'y')
        result = await invoke(sock, 'addViewNode', { viewUuid, ticketUuid, x: Number(xStr), y: Number(yStr) })

      } else if (cmd === 'move') {
        const [viewUuid, ticketUuid, xStr, yStr] = r
        need(viewUuid, 'view-uuid'); need(ticketUuid, 'ticket-uuid')
        need(xStr, 'x'); need(yStr, 'y')
        result = await invoke(sock, 'moveViewNode', { viewUuid, ticketUuid, x: Number(xStr), y: Number(yStr) })

      } else if (cmd === 'nudge') {
        const [viewUuid, ticketUuid, dxStr, dyStr] = r
        need(viewUuid, 'view-uuid'); need(ticketUuid, 'ticket-uuid')
        need(dxStr, 'dx'); need(dyStr, 'dy')
        result = await invoke(sock, 'nudgeViewNode', { viewUuid, ticketUuid, dx: Number(dxStr), dy: Number(dyStr) })

      } else if (cmd === 'remove') {
        const [viewUuid, ticketUuid] = r
        need(viewUuid, 'view-uuid'); need(ticketUuid, 'ticket-uuid')
        result = await invoke(sock, 'removeViewNode', { viewUuid, ticketUuid })

      } else { usageViews() }

    } else if (sub === 'edges') {
      const [cmd, ...r] = rest
      if (cmd === 'list') {
        const [viewUuid] = r
        need(viewUuid, 'view-uuid')
        result = await invoke(sock, 'listViewEdges', { viewUuid })

      } else if (cmd === 'create') {
        const [viewUuid, sourceUuid, targetUuid] = r
        need(viewUuid, 'view-uuid'); need(sourceUuid, 'source-uuid'); need(targetUuid, 'target-uuid')
        result = await invoke(sock, 'createViewEdge', {
          viewUuid, sourceUuid, targetUuid,
          ...(flags['source-handle'] ? { sourceHandle: flags['source-handle'] } : {}),
          ...(flags['target-handle'] ? { targetHandle: flags['target-handle'] } : {}),
        })

      } else if (cmd === 'remove') {
        const [uuid] = r
        need(uuid, 'edge-uuid')
        result = await invoke(sock, 'removeViewEdge', { uuid })

      } else { usageViews() }

    } else {
      usageViews()
    }

  } else {
    usageMain()
  }

  if (result !== undefined) {
    process.stdout.write(raw ? JSON.stringify(result) : JSON.stringify(result, null, 2))
    process.stdout.write('\n')
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function need(val, name) {
  if (val == null || val === '') die(`Missing required argument: <${name}>`)
}

function die(msg) {
  process.stderr.write(`error: ${msg}\n`)
  process.exit(1)
}

function usageMain() {
  process.stderr.write(`
Usage: ovh <group> <command> [args]

Groups:
  context   Show the project's north star and vision (what an agent should steer by)
  tickets   Create and manage tickets
  relations Link tickets together
  views     Manage graph views and their nodes/edges

Global flags:
  --socket <path>   Override socket path (default: ~/Library/Application Support/desktop_client/bridge.sock)
  --raw             Print minified JSON instead of pretty-printed

Run "ovh <group>" for group-level help.
`.trimStart())
  process.exit(1)
}

function usageTickets() {
  process.stderr.write(`
Usage: ovh tickets <command>

Commands:
  list
  get    <uuid>
  create <title> <type>  [--status S] [--description D] [--backlog]
  update <uuid>          [--title T] [--status S] [--description D] [--backlog] [--archived]
  delete <uuid>

Types: Explore | Feature | Execute
`.trimStart())
  process.exit(1)
}

function usageRelations() {
  process.stderr.write(`
Usage: ovh relations <command>

Commands:
  list     <ticket-uuid>
  relate   <uuid-a> <uuid-b>
  block    <blocked-uuid> <blocker-uuid>
  unrelate <relation-uuid>
`.trimStart())
  process.exit(1)
}

function usageViews() {
  process.stderr.write(`
Usage: ovh views <command>

Commands:
  list
  create <name>
  rename <uuid> <name>
  delete <uuid>
  map    <view-uuid>

  nodes list   <view-uuid>
  nodes get    <view-uuid> <ticket-uuid>
  nodes add    <view-uuid> <ticket-uuid> <x> <y>
  nodes move   <view-uuid> <ticket-uuid> <x> <y>
  nodes nudge  <view-uuid> <ticket-uuid> <dx> <dy>
  nodes remove <view-uuid> <ticket-uuid>

  edges list   <view-uuid>
  edges create <view-uuid> <source-uuid> <target-uuid>  [--source-handle H] [--target-handle H]
  edges remove <edge-uuid>

Handles (H): left | right | top | bottom  — which port on each node the edge attaches to.
`.trimStart())
  process.exit(1)
}

// ---------------------------------------------------------------------------

main().catch((err) => {
  process.stderr.write(`error: ${err.message}\n`)
  process.exit(1)
})
