# Schema changes

The migration record for Overhead's databases.

There is **no `schema_version` table and no runtime migration machinery** — a
deliberate decision. Schema changes are applied by rewriting the schema, and
documented here. This file is the record.

**Rule:** every schema change gets an entry — what changed, when, and why.

---

## 2026-08-15 — Multi-project storage

**Databases went from one to many.** Previously a single
`<userData>/overhead.db` plus a single `<userData>/vault/`. Now:

```
<userData>/global.db                      project registry + app-wide settings
<userData>/projects/<project-uuid>/
    overhead.db                           that project's data
    vault/                                that project's markdown mirror
```

Existing data was **discarded, not migrated** — it was prototype content, and
the authorization to rewrite it freely is standing (see
`FINALIZATION-PLAN.md`). The old `<userData>/overhead.db` and `<userData>/vault/`
are simply orphaned; nothing reads them any more.

### New: `global.db`

The only state living outside a project. It holds the pointer selecting which
project database to open, so by definition it cannot live inside one.

| Table | Purpose |
|---|---|
| `projects` | uuid, name, prefix, created_at |
| `app_settings` | key/value — `activeProject`, `window.bounds`, later account + theme |

- `name` and `prefix` are `UNIQUE COLLATE NOCASE`. Enforced in the schema rather
  than the UI: duplicate names make projects ambiguous, and duplicate prefixes
  make `@OVH-123` mentions ambiguous across vaults.
- `prefix` is treated as **immutable after creation** — changing it would strand
  every existing ticket id and every markdown mention. There is deliberately no
  `setPrefix`.

### Project database

Same seven tables as before, unchanged in shape, **with no `project_uuid`
column anywhere** — the directory *is* the scope, so no query filters by
project and none can forget to.

Added:

| Change | Why |
|---|---|
| `tickets.pinned INTEGER NOT NULL DEFAULT 0` | Pinning primitive (plan **C1**). No consumer yet — the focus dashboard is deferred. |
| `notes` table | Titled markdown notes (plan **B10**) |
| `mentions` table + `idx_mentions_target` | Backlinks from `@OVH-123` references (plan **C10**) |

`mentions` is a **projection of document content, never a source of truth**.
Rebuilding it by re-parsing every ticket and note must always be safe and
produce identical rows.

### Removed

The two ad-hoc `try { ALTER TABLE graph_view_edges ADD COLUMN … } catch {}`
blocks. They existed only to patch databases created before the edge-handle
columns — databases that no longer exist.

---

## 2026-08-23 — The bench

Home's re-entry surface (plan **B1**) needed the pinning primitive to become a
real, bounded capability rather than an unconsumed flag.

### New tables

| Table | Purpose |
|---|---|
| `bench_slots` | `ticket_uuid` → `slot` (0-3). Source of truth for which tickets are pinned, their cap (4), and their display order. |
| `pinned_notes` | Same shape for notes: `note_uuid` → `slot` (0-1), cap 2. |

`tickets.pinned` is **not replaced** — it still exists and is still what
`TicketControlBar`, the vault frontmatter and every existing test read.
Pinning now always writes both: a `bench_slots` row (for the cap and order)
and `tickets.pinned = 1` (for every surface that only needs the boolean),
back-to-back with no `await` between them — not wrapped in `transact()`,
since `writeTicket` already opens one of its own internally and this
codebase's `transact()` doesn't nest. `bench_slots` is the table that
enforces the cap — `tickets.pinned` alone never did and can't.

Notes have no equivalent boolean column; `pinned_notes` is their only source
of truth. Both tables `ON DELETE CASCADE`, so deleting a ticket or note frees
its slot for free.

No age or timestamp column was added anywhere in this round — pin order is
assigned by which slot is free when you pin, not by when.
