# Security note — raw SQL on the renderer channel

**Status:** Accepted trade-off, deferred mitigation
**Date:** 2026-06-17
**Scope:** `db:ticket` / `db:relation` IPC channels, `window.db` (preload), renderer clients

---

## TL;DR

The renderer can send **raw SQL strings** across the IPC boundary
(`window.db.ticket(sql, params)`). We are **keeping this on purpose** for ease of
development. This document records *why that is a risk*, *under what conditions
it's acceptable*, and *what would force us to revisit it* — so the decision is
deliberate, not accidental.

This is a pinned issue. It does **not** block the bridge work; the bridge
(Door 2) is being built precisely so that untrusted callers never touch this
channel.

---

## Current situation

There are (will be) two ways into the database, with different trust levels:

```
DOOR 1 — first-party app (trusted, RAW SQL)         ← this document
  React component
    └─ ticketClient.upsert(data)        renderer lib, holds SQL templates
        └─ window.db.ticket(sql, params) preload contextBridge
            └─IPC "db:ticket"──▶ handler ──▶ runSql()   (+ vault + history)

DOOR 2 — plugins / MCP / CLI (untrusted, GOVERNED)  ← the bridge feature
  plugin code
    └─ window.bridge.createTicket(input)  narrow surface, NO SQL
        └─IPC "bridge:createTicket"──▶ gate (auth→throttle→validate)
                                          └─▶ runTicketSql()
```

On Door 1, the main process accepts whatever SQL string it is handed. The only
guard today is a regex in `electron/ipc/ticketAPI.ts`:

```ts
const TICKET_TABLE_RE = /\btickets\b/i   // "does the word 'tickets' appear?"
```

That is **not** a security control — it's a typo guard. The renderer effectively
has an arbitrary-SQL execution primitive against the tickets tables.

---

## Why this is a risk

"Door 1 is trusted" sounds like "we trust our own UI code." But the capability
is granted to **anything that can execute JavaScript in the renderer**, which is
a larger set than our code:

1. **Rich text / markdown.** Ticket content is authored and rendered (`novel`,
   `tiptap-markdown`). An XSS bug in that path means injected script inherits
   `window.db.ticket(rawSQL)`.
2. **The vault watcher.** `chokidar` ingests files edited *outside* the app
   (synced via git/Dropbox/another tool). External content flows into the DB and
   back into the renderer — an untrusted-input channel we don't fully control.
3. **Future plugins.** If any plugin ever runs *in the renderer*, it sees
   `window.db` and therefore raw SQL.

Note: **serialization is not the safety property.** `("DELETE FROM tickets", [])`
crosses the IPC boundary just as serialized as `{ title: "x" }`. The real
distinction is **data vs. code** — Door 2 passes data the handler interprets;
Door 1 passes a SQL *program* the handler executes. Raw SQL is code crossing the
contextBridge, which is our one real security boundary.

---

## Why it's acceptable *for now*

The trade-off holds **as long as all of these remain true**:

- [x] **Local, single-user app.** The DB is the user's own data. An "attacker"
      who controls the renderer is effectively the user, who could open
      `overhead.db` directly anyway — so raw SQL is **not a privilege
      escalation**, just a convenience.
- [x] **Rich text is sanitized.** No script execution from ticket content.
      **VERIFIED 2026-08-15** — `src/components/editorSanitization.test.tsx`.
      The protection is structural, not a filter: `tiptap-markdown` renders
      markdown to HTML and ProseMirror parses it against the editor's schema,
      so anything the schema does not define has nowhere to land. Tests cover
      `<script>`, inline `onclick`, `<iframe>`, and `<img onerror>` — all
      dropped — while headings, bold and `@OVH-123` mentions survive.
- [x] **No renderer-resident plugin ever sees `window.db`.** Plugins get
      `window.bridge` only. *(Still true — no plugin host exists.)*

Under these conditions, raw SQL from the renderer grants nothing the renderer
doesn't already legitimately have. The bridge then exists purely to give
*external / untrusted* consumers (MCP, CLI, third-party plugins) a safe subset.

If **any** box above becomes false — especially the plugin one — this stops
being acceptable and we must narrow Door 1.

---

## Containment rules (in force now)

These keep the blast radius small so we *can* lock it down later cheaply:

1. **`ticketClient` / `relationsClient` are the only callers of
   `window.db.ticket(sql)`.** Do not scatter raw SQL through components. If we
   ever revoke raw access, we change one file.
2. **Hard rule: plugins talk to `window.bridge`, never `window.db`.** Even
   first-party plugins. The moment a plugin touches `window.db`, the trust
   boundary is gone.
3. **The bridge (Door 2) never exposes SQL templates to its callers.** Callers
   pass `{ title, type, ... }`; the bridge handler picks the SQL.

---

## Follow-ups (deferred, not scheduled)

- [x] ~~Verify the markdown / rich-text render path is sanitized~~ — **done**,
      see the precondition above. This mattered more after the vault watcher
      began ingesting externally-edited markdown and `@` mentions added a
      second render path: both are untrusted input reaching the editor.
- [ ] Decide whether raw SQL on Door 1 should eventually be gated behind a
      dev-only build flag, leaving production with parameterized/whitelisted ops.
- [ ] Re-evaluate this whole document before shipping any renderer-resident
      plugin host.

---

## Related

- `desktop_client/docs/ARCHITECTURE.md` — process model & data flow
- `electron/ipc/ticketAPI.ts` — the raw `db:ticket` handler + regex guard
- `electron/preload.ts` — `window.db` surface
- Bridge feature (Door 2) — governed channel, in progress
