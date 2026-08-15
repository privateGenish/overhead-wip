# Overhead — The Governed Bridge (Door 2)

The app has **two doors** into its data:

- **Door 1** — the renderer's raw SQL path (`window.db.*` over IPC). In-process,
  fully trusted, no validation. See [SECURITY-renderer-raw-sql.md](SECURITY-renderer-raw-sql.md).
- **Door 2** — the **governed bridge**: the only way *external* processes reach
  the data. No raw SQL crosses it. Callers name a **method** and pass **data**;
  each method validates its own input with Zod before touching the DB.

This document covers Door 2.

---

## One entry point, many transports

Every external call — whatever transport it arrives on — funnels through a single
function: `dispatchBridge(method, args, ctx)` in `electron/bridge/index.ts`.

```
   HTTP   ──127.0.0.1:49152──►  transports/http.ts ─┐
                                                     │
   CLI    ──bridge.sock──────►  transports/unix.ts ─┼──►  dispatchBridge()
                                                     │         │
   MCP    ──bridge.sock──────►  transports/unix.ts ─┘         ├── gate: authorize + throttle
                                                               ├── method: Zod-validate input
                                                               └── runSql / runTicketSql / runRelationOp
```

- **HTTP** runs *inside* the Electron main process (`startHttpServer`).
- **CLI** (`cli/ovh.mjs`) and **MCP** (`mcp/server.mjs`) are *standalone* Node
  processes. They cannot import the bridge (it lives in Electron's main process),
  so they reach it over the unix socket — the same protocol, the same single entry
  point. Each transport is independent; adding one never touches the others.

```
electron/
  bridge/
    index.ts       dispatchBridge() + the method registry (the public surface)
    gate.ts        authorize() + throttle() — cross-cutting, runs before every method
    tickets.ts     ticket methods
    relations.ts   relation methods
    views.ts       graph view / node / edge methods
  transports/
    http.ts        HTTP server (in-process)
    unix.ts        unix-socket server (in-process) — CLI + MCP connect here
    token.ts       per-session token (see "Auth" below)
cli/
  ovh.mjs          CLI client → unix socket
mcp/
  server.mjs       MCP server (stdio) → unix socket
```

---

## The wire protocols

### HTTP (`transports/http.ts`)

```
POST http://127.0.0.1:49152/invoke
Content-Type: application/json
Body: { "method": "createTicket", "args": { ... } }

200 { "result": ... }
400 { "error": "..." }
```

Binds to `127.0.0.1` only. `EADDRINUSE` is tolerated (a stale dev instance
holding the port just disables HTTP for the new process).

### Unix socket (`transports/unix.ts`) — used by CLI + MCP

Socket at `<userData>/bridge.sock`. One newline-terminated JSON request per
connection, one newline-terminated JSON response back:

```
→ { "method": "createTicket", "args": { ... } }\n
← { "result": ... }\n          (success)
← { "error": "..." }\n         (failure)
```

A stale socket from a previous run is unlinked on startup. The socket is created
with owner-only connect permission, so **filesystem permissions are the auth
boundary** for the CLI/MCP path.

---

## Auth & the gate (`bridge/gate.ts`)

`authorize()` and `throttle()` run before every method, for every transport. They
are the single place to add capability checks and rate limits later.

`transports/token.ts` mints a random 32-byte token at startup, writes it to
`<userData>/bridge.token` (mode `0600`, regenerated each launch), and offers
`validateToken()` — which compares in constant time.

**HTTP enforces the bearer token.** `startHttpServer` reads the `Authorization`
header, validates it, and answers `401 Unauthorized` otherwise. It also sets
`ctx.caller = 'http'`, without which the gate's HTTP branch was unreachable
code. *(This was a documented gap until 2026-08-15: the token was minted,
written to disk, and never read, so any local process could drive the app's
data. Closed.)*

The unix socket relies on filesystem permissions instead, which is a real
boundary for a single-user tool.

### Throttling

`throttle()` is a sliding window per caller (100 calls/second). Not a security
control — the token and the socket's permissions are that. It exists because a
runaway agent retry loop would otherwise issue thousands of writes a second,
and each one fans out into a synchronous SQL write plus a whole-file vault
write on the main process's only thread.

### Which project a call acts on

Scoping is **implicit**: no method takes a project argument, and every call
addresses whatever project is open. Right for a single-user tool, but it means
a caller cannot otherwise tell the user switched projects mid-task. Every
transport therefore returns the acting project alongside the result:

```
{ "result": …, "project": { "uuid": "…", "name": "Overhead" } }
```

Check it if you are doing a sequence of writes; a change means your next write
would land somewhere else.

---

## The method surface

24 methods, exposed 1:1 to every transport. All uuids are ticket/view/edge uuids
unless noted.

### Project context (`bridge/context.ts`)

| Method | Args | Returns |
|---|---|---|
| `getProjectContext` | — | `{ project, northStar, vision }` |

The project's stated intent, as the user wrote it in the Vision tab. It exists
for **steering on judgment calls**: an agent working a ticket constantly hits
thin decisions the ticket text does not settle and resolves them by its own
defaults. This is how the user's intent reaches those decisions instead.

Delivery is a method the caller invokes, deliberately, rather than context
stapled onto every ticket read — ticket responses stay lean, and the MCP tool
description is what makes an agent reach for it. The envelope is shaped to
grow: conventions, constraints and a glossary belong here eventually, and
adding them must not break callers.

### Tickets (`bridge/tickets.ts`)

| Method | Args | Returns |
|---|---|---|
| `listTickets` | — | `Ticket[]` |
| `getTicket` | `{ uuid }` | `Ticket \| null` |
| `createTicket` | `{ title, type, status?, description?, backlog? }` | `Ticket` |
| `updateTicket` | `{ uuid, patch: { title?, status?, description?, backlog?, archived? } }` | `Ticket` |
| `deleteTicket` | `{ uuid }` | `{ uuid }` |

`type` ∈ `Explore | Feature | Execute`. Status defaults per type
(Execute→`Draft`, Explore→`Open`, Feature→`Idea`). Ids (`OVH-001`) and uuids are
minted server-side. Writes route through `runTicketSql` so vault mirroring +
history snapshots match the renderer's path exactly.

### Relations (`bridge/relations.ts`)

| Method | Args | Returns |
|---|---|---|
| `relate` | `{ a, b }` | relation row |
| `blockBy` | `{ blocked, blocker }` | relation row |
| `unrelate` | `{ uuid }` | — |
| `listRelations` | `{ ticketUuid }` | relation rows |

Relation types (`relates-to`, `blocked-by`) are fixed by the method — callers
never pick a type freely. Every write fires `notifyGraphUpdated()` so the canvas
redraws live (see "Live sync").

### Graph views, nodes, edges (`bridge/views.ts`)

| Method | Args | Returns |
|---|---|---|
| `listViews` | — | `View[]` |
| `createView` | `{ name }` | `View` |
| `renameView` | `{ uuid, name }` | `View` |
| `deleteView` | `{ uuid }` | `{ uuid }` |
| `getViewMap` | `{ viewUuid }` | `{ view, nodes, edges }` — full canvas snapshot, **edges typed** |
| `listViewNodes` | `{ viewUuid }` | `EnrichedNode[]` |
| `getViewNode` | `{ viewUuid, ticketUuid }` | `EnrichedNode \| null` |
| `addViewNode` | `{ viewUuid, ticketUuid, x, y }` | — (upsert: place **or** move) |
| `moveViewNode` | `{ viewUuid, ticketUuid, x, y }` | `EnrichedNode` — absolute move, **errors if absent** |
| `nudgeViewNode` | `{ viewUuid, ticketUuid, dx, dy }` | `EnrichedNode` — relative move, **errors if absent** |
| `removeViewNode` | `{ viewUuid, ticketUuid }` | — |
| `listViewEdges` | `{ viewUuid }` | `Edge[]` |
| `createViewEdge` | `{ viewUuid, sourceUuid, targetUuid, sourceHandle?, targetHandle? }` | `Edge` |
| `removeViewEdge` | `{ uuid }` | `{ uuid }` |

**Node identity is always `ticketUuid`** — coordinates are data you read and
write, not a lookup key. `EnrichedNode` = `{ ticket_uuid, id, title, type, status,
x, y }` (joined with the ticket so output is human-readable, not bare uuids).

CRUD semantics: `addViewNode` = create-or-move (upsert); `moveViewNode` /
`nudgeViewNode` = update-only (they reject a node that isn't on the view);
`removeViewNode` = delete; `getViewNode` / `listViewNodes` / `getViewMap` = read.

### Reading a graph — one edge list, every edge typed

`getViewMap` returns **all** the view's edges in one list, each labelled:

| `type` | Meaning |
|---|---|
| `blocked-by` | Directional, pointing **blocker → blocked**. This is how the graph says what must come first. |
| `relates-to` | Undirected. Couples tickets into one piece of work. |
| `visual` | A hand-drawn line carrying **no** meaning. |

The app stores relations and hand-drawn edges in two different tables, but
which table a line came from is an implementation detail; what it *means* is
not. Relations are deliberately not materialised per view — they are true of
the tickets, not of a canvas — so the two are unified here at the read surface.

> Until 2026-08-15 this method returned only the hand-drawn edges, and edges
> had no `type` at all. An agent could build a graph it could not read back:
> the dependencies, the one thing a graph is actually for, were invisible.

**Edge handles** pin which port an edge attaches to. Valid values:
`left | right | top | bottom` (validated by an enum). For a pair that also has a
relation, the stored edge acts as a *handle anchor* — the renderer's derived typed
edge adopts its handles instead of auto-inferring from position.

---

## Live sync

External writes reflect on the open canvas in real time — no manual refresh.

- Bridge methods that mutate graph data (views, nodes, edges **and relations**)
  call `notifyGraphUpdated()`, which sends `graph:updated` to all renderer windows.
- The renderer's `Graph` view listens via `window.db.onGraphUpdated` and reloads:
  the **view list**, the **nodes/edges** (`Canvas` reload), and the **relations**
  list.

> Relations matter here because the red "blocks" arrows and dashed "relates" lines
> are **derived live from the relations list** — they are not stored edges. If the
> relations list isn't reloaded, an externally-created relation draws nothing until
> the view is re-mounted. Both halves are wired: `bridge/relations.ts` fires the
> notification, and the `Graph` root's listener calls `refreshRelations()`.

---

## The CLI — `cli/ovh.mjs`

Zero-dependency Node script. Reaches the bridge over the unix socket. Symlink it
onto your PATH (`ln -s …/cli/ovh.mjs /usr/local/bin/ovh`) or run with `node`.

```bash
ovh tickets list
ovh tickets create "My feature" Feature --status "In Review" --description "…" --backlog
ovh tickets get <uuid>
ovh tickets update <uuid> --title "New" --status Done --archived
ovh tickets delete <uuid>

ovh relations list <ticket-uuid>
ovh relations relate <uuid-a> <uuid-b>
ovh relations block <blocked-uuid> <blocker-uuid>
ovh relations unrelate <relation-uuid>

ovh views list
ovh views create "Sprint 1"
ovh views rename <uuid> "Sprint 2"
ovh views delete <uuid>
ovh views map <view-uuid>

ovh views nodes list   <view-uuid>
ovh views nodes get    <view-uuid> <ticket-uuid>
ovh views nodes add    <view-uuid> <ticket-uuid> <x> <y>
ovh views nodes move   <view-uuid> <ticket-uuid> <x> <y>
ovh views nodes nudge  <view-uuid> <ticket-uuid> <dx> <dy>
ovh views nodes remove <view-uuid> <ticket-uuid>

ovh views edges list   <view-uuid>
ovh views edges create <view-uuid> <src-uuid> <tgt-uuid> [--source-handle H] [--target-handle H]
ovh views edges remove <edge-uuid>
```

Flags: `--raw` for minified JSON, `--socket <path>` to override the socket. Handle
values `H` ∈ `left | right | top | bottom`.

---

## The MCP server — `mcp/server.mjs`

Zero-dependency MCP server speaking JSON-RPC 2.0 over stdio. Like the CLI, it's a
standalone process that forwards each tool call to the bridge over the unix socket.
All 23 bridge methods are exposed **1:1 as MCP tools** (tool name == method name),
each with a JSON Schema mirroring its Zod schema (enums included).

Register it with an MCP host, e.g. Claude Desktop:

```json
{
  "mcpServers": {
    "overhead": {
      "command": "node",
      "args": ["<abs>/desktop_client/mcp/server.mjs"]
    }
  }
}
```

Socket path defaults to `<userData>/bridge.sock`; override with the `OVH_SOCKET`
env var. Tool-execution failures (validation errors, app-not-running) come back as
`isError` tool results, not protocol-level crashes.

---

## Adding a method

1. Write + export the method in the right `bridge/*.ts` module. Validate input with
   Zod. Call `notifyGraphUpdated()` / `notifyTicketUpdated()` if it mutates data the
   renderer shows.
2. Register it in the `methods` map in `bridge/index.ts`.
3. Surface it on the clients: a subcommand in `cli/ovh.mjs` and a tool entry in
   `mcp/server.mjs` (HTTP needs nothing — it's method-name-driven).

The single registry means a new method is reachable from every transport at once.
```
