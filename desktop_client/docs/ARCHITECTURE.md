# Overhead — Architecture

## The two processes

Electron runs two completely separate processes that can't share memory.

```
┌─────────────────────────────┐     IPC      ┌──────────────────────────────┐
│        Main Process         │ ◄──────────► │      Renderer Process        │
│  (Node 24 / full OS access) │              │  (Chromium / React / no FS)  │
│                             │              │                              │
│  node:sqlite                │              │  ticketStore                 │
│  electron/db/sqlite.ts      │              │  src/lib/ticketStore.ts      │
│  electron/ipc/batch.ts      │              │                              │
└─────────────────────────────┘              └──────────────────────────────┘
```

The **preload script** (`electron/preload.ts`) is the only bridge between them.
It exposes `window.db.query(ops)` — a single function that sends a batch of
operations to the main process over IPC and returns a Promise.

---

## Data flow: startup

```
app.whenReady()
  │
  ├── initSqlite(path)           opens overhead.db, creates `store` table
  │   electron/db/sqlite.ts
  │
  └── registerLocalStorageAPI()  registers the db:query IPC handler
      electron/ipc/localStorageAPI.ts
            │
            └── runBatch(ops)
                electron/ipc/batch.ts


React mounts
  │
  └── new TicketStore()
        │
        ├── Ticket.setCreateHook(...)   wires save-on-create into every factory
        │
        └── #hydrate()
              │
              └── loadTickets()
                    │
                    ├── localDB.all()          calls window.db.query([{all:null}])
                    │                          ──IPC──► main ──► dbAll() ──► SELECT * FROM store
                    │
                    ├── (first boot only) localDB.batch([{put:...}, ...])  seeds mock data
                    │
                    └── records.filter(isTicketData).map(Ticket.load)
                              │
                              └── ticketDataSchema.parse()  validates each record
                                  then dispatches to the correct subclass loader
                                  returns live Ticket instances
```

---

## Data flow: creating a ticket

```
User types title + presses Enter
  │
  └── ticketStore.create(type, title)
        │
        └── ExecuteTicket.create(title)     (or Explore / Feature)
              │
              ├── Ticket.generateUuid()
              ├── Ticket.generateId()
              ├── Ticket.construct(...)      builds the instance (guarded new)
              │
              └── Ticket.persist(ticket)    calls the hook set by the store
                    │
                    └── localDB.putTicket(ticket)
                          │
                          ├── ticket.toJSON()             → plain TicketData
                          ├── adds { resourceType: 'ticket' }
                          └── window.db.query([{put:...}])
                                ──IPC──► main
                                  └── ticketDataSchema.parse()   validates
                                      dbPut()                    INSERT OR REPLACE
```

Back in `ticketStore.create()`:
```
ticket.bindHost(this)       wires store callbacks into the ticket
#tickets = [...#tickets, ticket]
#notify()                   React re-renders via useSyncExternalStore
```

---

## Data flow: mutating a ticket

```
ticket.setTitle('new name')        (or setStatus / setBacklog / setDescription)
  │
  ├── this.title = 'new name'      in-memory update (instant)
  │
  └── #host.onTicketChanged(this)  calls back into the store
        │
        ├── localDB.putTicket(ticket)   fire-and-forget save to SQLite
        ├── #tickets = [...#tickets]    new array reference triggers React diff
        └── #notify()                  subscribers re-render
```

---

## Data flow: deleting a ticket

```
ticket.delete()
  │
  └── #host.onTicketRemoved(this)
        │
        ├── localDB.delete(ticket.uuid)   remove from SQLite
        ├── #tickets = #tickets.filter()
        └── #notify()
```

---

## The Ticket class hierarchy

```
Ticket  (abstract — src/shared/types/ticket.ts)
  │  Fields:  uuid, id, title, status, backlog, description
  │  Static:  load(), setCreateHook(), construct(), persist(), registerType()
  │  Instance: setTitle(), setStatus(), setBacklog(), setDescription(), delete(), toJSON()
  │
  ├── ExecuteTicket   status: Draft → Ready → In Progress → Done / Failed / Rejected
  ├── ExploreTicket   status: Open → In Progress → Concluded / Not Needed
  └── FeatureTicket   status: Idea → Scoped → In Progress → Built / Canceled
```

Each subclass:
- Registers its own loader in a `static {}` block (so `Ticket.load()` can rebuild it)
- Has a `static create(title)` factory that calls `Ticket.persist()` before returning

---

## The two injection patterns

Both solve the same problem: **how does the model layer talk to infrastructure
without importing it?**

### TicketHost — for mutations

```
TicketHost interface (defined in ticket.ts)
  ↑ implemented by
TicketStore
  ↓ injected via
ticket.bindHost(store)
  ↓ called via
this.#host.onTicketChanged(this)
```

### setCreateHook — for creation

```
ticketStore constructor
  └── Ticket.setCreateHook(ticket => localDB.putTicket(ticket))

ExecuteTicket.create()
  └── Ticket.persist(ticket)   → calls the hook → localDB → IPC → SQLite
```

---

## Storage layer

```
electron/db/sqlite.ts
  initSqlite(file)   opens the DB, creates the store table, prepares statements
  dbGet(uuid)        SELECT data FROM store WHERE uuid = ?
  dbAll()            SELECT data FROM store
  dbPut(record)      INSERT OR REPLACE INTO store (uuid, data) VALUES (?, ?)
  dbDelete(uuid)     DELETE FROM store WHERE uuid = ?
  transact(fn)       wraps fn() in BEGIN / COMMIT, rolls back on throw

electron/ipc/batch.ts
  runBatch(ops)      validates array length ≤ 10, runs all ops in one transaction
                     each op: { get: uuid } | { all: null } | { put: record } | { delete: uuid }
                     put with resourceType: 'ticket' → validated via ticketDataSchema before write

src/lib/localDB.ts  (renderer-side wrapper)
  localDB.get(uuid)
  localDB.all()
  localDB.put(record)
  localDB.putTicket(ticket)   adds resourceType tag, calls ticket.toJSON()
  localDB.delete(uuid)
  localDB.batch(ops)
```

---

## File map

| File | What it owns |
|---|---|
| `src/shared/types/ticket.ts` | Zod schemas, `TicketData` type, `TicketHost` interface, abstract `Ticket` class |
| `src/shared/types/tickets/execute.ts` | `ExecuteTicket` — status flow + `create()` factory |
| `src/shared/types/tickets/explore.ts` | `ExploreTicket` — status flow + `create()` factory |
| `src/shared/types/tickets/feature.ts` | `FeatureTicket` — status flow + `create()` factory |
| `src/lib/ticketStore.ts` | Live collection of `Ticket` instances, React hook, wires host + create hook |
| `src/lib/localDB.ts` | Renderer-side IPC wrapper — generic blob store + typed ticket put |
| `src/lib/tickets.ts` | `loadTickets()` — reads store, seeds on first boot, hydrates instances |
| `electron/db/sqlite.ts` | SQLite singleton, prepared statements, `transact()` |
| `electron/ipc/batch.ts` | Pure batch dispatcher — testable without Electron |
| `electron/ipc/localStorageAPI.ts` | Registers `db:query` IPC channel |
| `electron/main.ts` | App lifecycle, calls `initSqlite` + `registerLocalStorageAPI` |
| `electron/preload.ts` | Exposes `window.db.query` to the renderer via `contextBridge` |
