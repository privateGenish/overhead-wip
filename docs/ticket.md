# Ticket CRUD Pipeline

SQLite is the source of truth. The renderer never touches the DB directly — all reads and writes go through the IPC bridge.

---

## Layers

```
View component
  ├─ Ticket instance      (renderer — self-managing: own subscribers + persistence)
  └─ TicketStore          (renderer — pure collection: membership + list subscribers)
       └─ ticketClient    (renderer — builds SQL, calls window.db.ticket)
            └─ IPC bridge (contextBridge / ipcRenderer.invoke → ipcMain.handle)
                 └─ ticketAPI.ts   (main — validates SQL, calls runSql)
                      └─ sqlite.ts (main — DatabaseSync)
```

Each `Ticket` manages itself: on mutation it persists via an injected save hook and
notifies its own subscribers. `TicketStore` only tracks which tickets exist — it
subscribes to each ticket like any other subscriber so the list view stays fresh.
Persistence is injected via static hooks (`Ticket.setSaveHook` etc.), wired once at
store construction, so the model layer never imports storage.

---

## Create

1. **`CreateTicketPanel.tsx`** — user fills title + type, hits Enter or "Create ticket"  
   → calls `ticketStore.create(type, title)`

2. **`TicketStore.create()`** — calls `factories[type].create(title)` (e.g. `ExecuteTicket.create`)  
   → the subclass calls `Ticket.persist()` which fires the `#onCreated` hook  
   → hook = `ticketClient.upsert(ticket.toJSON())` (set at store construction)  
   → store `#track`s the ticket (subscribes to it), pushes it into `#tickets`, notifies listeners

3. **`ticketClient.upsert(data)`** — maps `TicketData` to SQL params, calls:
   ```
   window.db.ticket(INSERT INTO tickets ... ON CONFLICT(uuid) DO UPDATE SET ..., [...params])
   ```

4. **IPC bridge** — `ipcRenderer.invoke('db:ticket', sql, params)` → main process

5. **`ticketAPI.ts` handler** — `validateTicketSql` checks the SQL targets `tickets`  
   → `runSql(sql, params)` executes INSERT  
   → `onTicketWritten(uuid)` fires *(currently a no-op placeholder for the future MD writer)*

---

## Read (hydration on startup)

1. **`TicketStore` constructor** — calls `this.#hydrate()`

2. **`loadTickets()`** → `ticketClient.all()`  
   → `window.db.ticket('SELECT * FROM tickets ORDER BY created_at ASC')`

3. **IPC** → `runSql` → `.all()` returns raw rows

4. **`ticketClient`** — maps each row through `rowToTicketData()` → `TicketData[]`

5. **`TicketStore`** — calls `Ticket.load(data)` per row (Zod-validates, dispatches to correct subclass)  
   → store subscribes to each instance via `#track()` so list rows stay fresh  
   → `#notify()` triggers React re-render via `useSyncExternalStore`

---

## Update

1. **`TicketEditor.tsx`** — user edits title or description  
   → calls `ticket.setTitle(value)` / `ticket.setDescription(markdown)`

2. **`Ticket` base class** — mutates the field, calls its private `#changed()`:  
   → bumps `#version` (the `useSyncExternalStore` snapshot token)  
   → fires the save hook = `ticketClient.upsert(this.toJSON())` — same IPC path as Create  
   → notifies the ticket's own subscribers

3. **Subscribers re-render** —  
   → `TicketEditor` via `useTicket(ticket)`  
   → `TicketStore` is also subscribed: it refreshes the list snapshot so table/sidebar rows update

4. **SQLite** — `ON CONFLICT(uuid) DO UPDATE SET ...` updates all fields except `created_at`

---

## Delete

1. **`ticket.delete()`** — marks itself `deleted`, fires the delete hook, notifies subscribers, then clears its listeners (instance is inert from then on)  
   → hook = `ticketClient.delete(ticket.uuid)`  
   → `window.db.ticket('DELETE FROM tickets WHERE uuid = ?', [uuid])`  
   → IPC → `runSql` → DELETE  
   → `onTicketWritten(uuid)` fires *(placeholder — will remove the MD file)*

2. **`TicketStore`'s subscription fires** — sees `ticket.deleted === true`  
   → unsubscribes, filters the ticket out of `#tickets`, notifies list subscribers

---

## Delete All

Used in Settings to wipe the board.

1. **`TicketStore.deleteAll()`**  
   → `ticketClient.deleteAll()` → `DELETE FROM tickets`  
   → `generalClient.settingDelete('counter')` → resets the OVH-NNN counter  
   → clears `#tickets`, notifies listeners

---

## ID generation (`OVH-001`)

`Counter.next()` is wired as the `#generateId` hook at store construction.  
On each `create()` call it reads `settings.counter`, increments, writes back, and returns `OVH-NNN`.  
The counter is persisted in the `settings` table and cleared on `deleteAll`.

---

## Key files

| File | Role |
|------|------|
| `src/components/CreateTicketPanel.tsx` | Create UI |
| `src/components/TicketEditor.tsx` | Edit UI (title + description) |
| `src/lib/ticketStore.ts` | Collection (membership), `useTickets` / `useTicket` hooks, service-hook wiring |
| `src/lib/tickets.ts` | `loadTickets()` hydration helper |
| `src/lib/ticketClient.ts` | SQL builder, IPC caller |
| `src/lib/generalClient.ts` | Settings SQL (counter reset) |
| `src/shared/types/ticket.ts` | Self-managing `Ticket` base class (subscribe/persist), `TicketData` Zod schema |
| `electron/ipc/ticketAPI.ts` | IPC handler, SQL validation, `onTicketWritten` hook |
| `electron/ipc/generalAPI.ts` | IPC handler for settings (blocks ticket tables) |
| `electron/db/sqlite.ts` | `DatabaseSync` wrapper, `runSql` |
