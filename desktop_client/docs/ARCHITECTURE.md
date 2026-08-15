# Overhead — Architecture

## What the app is for

Minimising the overhead of working with coding agents. When you lean on an
agent to build, your *planning* has to be right — so the app exists to make
planning fast to produce and cheap to hand over. Two consequences run through
everything below: agents must be able to **create** structure (tickets,
relations, graphs) and to **understand** it with little prior context.

---

## The two processes

Electron runs two processes that cannot share memory.

```
┌─────────────────────────────┐     IPC      ┌──────────────────────────────┐
│        Main Process         │ ◄──────────► │      Renderer Process        │
│  (Node / full OS access)    │              │  (Chromium / React / no FS)  │
│                             │              │                              │
│  node:sqlite                │              │  ticketStore, noteClient     │
│  vault mirroring + watcher  │              │  persistQueue (debounce)     │
│  the governed bridge        │              │  route model                 │
└─────────────────────────────┘              └──────────────────────────────┘
```

The **preload script** (`electron/preload.ts`) is the only bridge between them.

### Two doors into the data

- **Door 1** — the renderer's raw-SQL path (`window.db.*`). In-process, fully
  trusted. See [SECURITY-renderer-raw-sql.md](SECURITY-renderer-raw-sql.md).
- **Door 2** — the **governed bridge**: the single validated entry point for
  everything *outside* the app (HTTP, the `ovh` CLI, the MCP server). No raw
  SQL crosses it. See **[BRIDGE.md](BRIDGE.md)**.

---

## Projects: one directory each

A project owns its data outright. There is no `project_uuid` column anywhere —
the directory *is* the scope, so no query filters by project and none can
forget to.

```
<userData>/
  global.db                      project registry · account · theme · active project
  projects/
    <project-uuid>/
      overhead.db                tickets, relations, graphs, notes, mentions, settings
      vault/                     markdown mirror
        OVH-001.md
        notes/
          some-note.md
```

`global.db` holds the only state outside a project — including the pointer
that says which project to open, which by definition cannot live inside one.
Project names and prefixes are `UNIQUE COLLATE NOCASE` at the schema level:
duplicate names make projects ambiguous, duplicate prefixes make `@OVH-123`
mentions ambiguous. A prefix is immutable once set — changing it would strand
every existing ticket id and every mention.

### Lifecycle — the order is binding

`electron/project/projectManager.ts`. Getting this wrong leaves a file watcher
writing into the *next* project's database.

```
openProject(uuid)                      closeProject()
  initSqlite(projects/<uuid>/…)          flushHistory()
  rebuildAllMentions()                   await stopVaultWatcher()   ← must await
  initVault(vault/)                      closeSqlite()
  await initVaultWatcher(vault/)         closeVault()               ← clears lastPaths
```

`closeVault()` matters: `vaultManager` keeps a module-level uuid→filename map,
and carrying it across a switch would delete the wrong project's files.

Switching is renderer-initiated because the main process cannot drain the
renderer's write queue:

```
persistQueue.flushAll() → disposeTicketStore() → projects.switch(uuid)
  → initTicketStore() → remount the tree keyed on the project uuid
```

---

## Persistence: mutate now, write later

Typing used to cost a synchronous SQL write **and** a whole-file vault write
per keystroke, on the main process's only thread.

```
ticket.setDescription(md)
  ├── in-memory update + notify        immediate — the UI never waits
  └── persistQueue.schedule(uuid, …)   trailing debounce, ~400ms
        └── ticketClient.upsert → IPC → runTicketSql
              ├── SQL UPSERT
              ├── vaultWrite(uuid)     markdown mirror
              ├── syncMentions(…)      backlink projection
              └── history snapshot     (debounced separately, in main)
```

Timing policy lives at the persistence boundary, never in the model. `flush()`
is required before anything that reads what was written — notably the history
snapshot, which would otherwise record the *previous* text. Flush points:
edit→view, ticket switch, unmount, window blur, `beforeunload`, project close.

---

## The ticket model

```
Ticket  (abstract — src/shared/types/ticket.ts)
  │  uuid, id, title, status, backlog, pinned, description, archived
  │
  ├── ExecuteTicket   Draft → Ready → In Progress → Done / Failed / Rejected
  ├── ExploreTicket   Open → In Progress → Concluded / Not Needed
  └── FeatureTicket   Idea → Scoped → In Progress → Built / Canceled
```

Deliberately absent: priority, assignee, due dates, tags, labels, and any
parent/child hierarchy. One developer, no coordination problem to solve.
Structure is expressed through **relations** (`relates-to`, `blocked-by`) —
which record dependencies the developer actually found — never through a tree
that imposes an order on them.

---

## Graphs

Two things draw as lines and they are not the same:

- **Relations** live in `ticket_relations` and are true of the tickets
  everywhere.
- **Hand-drawn edges** live in `graph_view_edges` and belong to one canvas.

Relations are **not** materialised per view: that would mean cleaning up N
copies on delete and guessing which views a new relation joins. The bridge
unifies them at the *read* surface instead — `getViewMap` returns one edge
list where each entry is typed `blocked-by`, `relates-to` or `visual`, so an
agent sees what a line *means* without knowing which table it came from.

---

## Notes and mentions

Notes are titled markdown documents, project-scoped, mirrored to
`vault/notes/`. Inbound sync is ticket-only — the watcher ignores `notes/`.

`@OVH-123` in any markdown is extracted into the `mentions` table. That table
is **a projection of document content, never a source of truth**: rebuilding it
by re-parsing every ticket and note is always safe, and happens on every
project open. Extraction runs on in-app writes *and* on inbound vault edits,
or externally-edited files would silently desync it. No read UI ships yet —
the data is captured, the presentation is deliberately deferred.

---

## Routing and deep links

Navigation is one serializable `Route` (`src/lib/route.ts`), which is what
makes it addressable:

```
overhead://project/<project-uuid>/ticket/OVH-123
overhead://project/<project-uuid>/page/execute
overhead://project/<project-uuid>/view/<view-uuid>
```

Projects are named by uuid (names are renameable, uuids are not, so links
survive a rename); tickets by human id (that is what a person can see and
paste). A link naming another project switches into it **first**, then routes —
the target lives in that project's database. The route itself is never
persisted: the last-opened *project* is remembered, the page inside it is not.

---

## File map

| File | What it owns |
|---|---|
| `electron/db/globalDb.ts` | Project registry, app-wide settings, active-project pointer |
| `electron/db/sqlite.ts` | Per-project schema, `runSql`, `transact` |
| `electron/db/mentions.ts` | Backlink projection — sync + full rebuild |
| `electron/project/projectManager.ts` | Open / close / switch lifecycle |
| `electron/vault/vaultManager.ts` | Markdown mirror + uuid→filename index |
| `electron/vault/vaultWatcher.ts` | Inbound sync from externally-edited files |
| `electron/ipc/*.ts` | Door 1 channels — tickets, notes, history, relations, graph, projects, app settings |
| `electron/bridge/*.ts` | Door 2 — method registry, gate, project context |
| `electron/deepLink.ts` | `overhead://` from OS to renderer, buffered until a renderer listens |
| `src/lib/persistQueue.ts` | Debounced writes + flush contract |
| `src/lib/ticketStore.ts` | Live ticket collection, explicitly initialised per project |
| `src/lib/route.ts` | Route model, link parse/format |
| `src/shared/mentions.ts` | `@OVH-123` extraction, shared by both processes |
