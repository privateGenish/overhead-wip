# Overhead — Finalization Plan

**Branch:** `finalizing` (pseudo-master). Sub-branches merge here; `master` only after everything holds.
**Started:** 2026-08-11

---

## What Overhead is for

*Stated by Yoav during shaping — the thesis every decision in this document answers to.*

> **The goal of the app is to minimize overhead when working with coding agents and agents in general.**

The reasoning, in his words: when you don't have to spend a lot of time thinking, **you need to be sure your planning is correct — because you're relying heavily on the agent.** The app's job is to make that planning fast to produce and cheap to hand over.

Two consequences that should drive design calls throughout:

1. **Agents must be able to *create* structure** — tickets, relations, graphs — through the bridge/MCP surface, not just read it.
2. **Agents must be able to *understand* that structure with little prior context.** An agent arriving cold should grasp "this is a research ticket, this is what we're doing, this comes before that" from what the API hands it. Graphs matter specifically because they encode **what comes before what**.

Where a design choice trades human polish against agent legibility, legibility is the point of the product.

### Standing constraint — this is not a project-management tool

> **"This is aimed for a single developer. This is a way to tackle thinking and creating easier, more organized handoffs to the coding agent — not to add complexity."**

Explicitly rejected, and not to be reintroduced by an implementing agent "for completeness": **priority · assignee · due dates · tags · labels.**

There is one user. Coordination features exist to solve problems this app does not have. Every field added is a field to fill in, and filling in fields is exactly the overhead the product exists to remove. **When in doubt, leave it out** — the bar for a new field is that it improves thinking or the agent handoff, not that a tracker would have it.

### Standing constraint — the developer plans, the agent follows

*Yoav's rationale for rejecting ticket hierarchy. It generalizes well beyond that one decision.*

> "Execute tickets are the last line of thinking — coding agents should follow almost mostly that ticket. We will rarely go group by group. **The overhead should organize thoughts, not create procedural overhead.** Agents and LLMs will follow as the developer expects, and not the developer follows an arbitrary grouping. The user is planning a feature, creates research tickets, and then decides how to execute this — **not the LLM deciding for him the work order.**"

Consequences for design:

- **The `Execute` ticket is the unit of handoff.** It's the terminal artifact of thinking, and the thing an agent works from. It should be self-sufficient enough to act on.
- **Structure is expressed through relations, never imposed by a tree.** `relates-to` couples tickets into one concise piece of work; `blocked-by` states that something must come first because of a real bug or dependency. Both describe what the developer actually found — they aren't a filing system.
- **Work order is the developer's call, not the model's.** Do not add features that infer, suggest, or enforce sequencing on the developer's behalf. Encoding an intended order is a *user* action; the agent reads it.

Test for any proposed structural feature: *does this help the developer record the thinking they already did, or does it ask them to service a hierarchy?* Only the first kind belongs here.

---

## How this document works

Three passes, in order. **We are in Pass 1.**

| Pass | What happens | Status |
|---|---|---|
| **1 — Shaping** | Walk every feature. For each: what it is today (grounded in the code), how it *should* be, what needs fixing. | ✅ **Complete** — 37 shaped, 1 deferred |
| **2 — Compliance** | Re-iterate the shaped features and attach the architectural/technical rules the implementing agent must follow. | ⚪ Not started |
| **3 — Build** | Agentic implementation, sub-branch per unit, stop-and-verify at each merge. | ⚪ Not started |

Per-feature template used below:

- **Today** — factual current state, read from the code. Written by Claude.
- **Intent** — how Yoav imagines it. Filled during the walkthrough.
- **Fixes / gaps** — concrete work items that fall out of the gap between the two.
- **Status** — ⚪ not shaped · 🔵 shaping · ✅ shaped · 🟡 deferred (intent noted, design postponed)

---

## Feature inventory

Numbering is stable — referenced by later passes. Walkthrough order is top to bottom.

### A. Shell & navigation
| # | Feature | Status |
|---|---|---|
| A1 | App shell, tab routing, overlay views, **deep linking** | ✅ |
| A2 | Navbar (tab groups, `+` button, Notes, project dropdown) | ✅ |
| A3 | **Projects — multi-project support** 🆕 *(cross-cutting)* | ✅ |
| A4 | **Global fuzzy search — ⌘K palette** 🆕 | ✅ |

### B. Pages & views
| # | Feature | Status |
|---|---|---|
| B1 | Home — FocusCard + VisionCard | 🟡 |
| B2 | Product — Features tab + Vision tab | ✅ |
| B3 | Explore view | ✅ |
| B4 | Execute view | ✅ |
| B5 | Backlog view | ✅ |
| B6 | All view | ✅ |
| B7 | Archived view (overlay) | ✅ |
| B8 | Settings view (overlay) | ✅ |
| B9 | Graph view (canvas) | ✅ |
| B10 | **Notes — markdown grid** 🆕 | ✅ |

### C. Ticket system (core domain)
| # | Feature | Status |
|---|---|---|
| C1 | Ticket model — types, status flows, class hierarchy | ✅ |
| C2 | Ticket table — columns, filters, sorting, pagination, row actions | ✅ |
| C3 | Ticket detail + markdown editor | ✅ |
| C4 | Ticket control bar — type & status | ✅ |
| C5 | Create ticket panel | ✅ |
| C6 | Relations — relates-to / blocked-by | ✅ |
| C7 | Version history — snapshots & restore | ✅ |
| C8 | Archive / restore | ✅ |
| C9 | ID generation — per-project prefix | ✅ |
| C10 | **Ticket mentions / backlinks in markdown** 🆕 | ✅ |

### D. External surfaces (agent/tool access)
| # | Feature | Status |
|---|---|---|
| D1 | Governed bridge (Door 2) — method registry + gate | ✅ |
| D2 | HTTP transport | ✅ |
| D3 | Unix socket transport | ✅ |
| D4 | CLI — `ovh` | ✅ |
| D5 | MCP server | ✅ |
| D6 | **Project context for LLMs — vision as steering** 🆕 | ✅ |

### E. Internal architecture & infra
| # | Feature | Status |
|---|---|---|
| E1 | Electron main process & window lifecycle | ✅ |
| E2 | SQLite storage layer & schema | ✅ |
| E3 | IPC layer (Door 1, raw SQL) + preload bridge | ✅ |
| E4 | Markdown vault — write + watch (bidirectional) | ✅ |
| E5 | Settings / key-value store | ✅ |
| E6 | Live sync notifications | ✅ |
| E7 | Theme & design system — "Ink & Obsidian" | ✅ |
| E8 | Build, tooling, tests, docs | ✅ |

---

# Pass 1 — Feature shaping

---

## A1 · App shell, tab routing, overlay views

**Today**
- `src/App.tsx` holds all routing in two `useState`s — no router library, no URL, no history.
- `VIEWS` map: Home, Execute, Explore, Product, Backlog, All, Graph.
- `OVERLAY_VIEWS` map: Settings, Archived — these *replace* the whole screen (navbar disappears, replaced by a "← Back" header bar).
- No persistence of the active tab across restarts. No deep-linking to a ticket.

**Intent**
- **Do NOT persist the last-opened page.** Every launch starts fresh; remembering the active tab is explicitly not wanted.
  - ⚠️ Note the deliberate asymmetry with **A3**: the last-opened **project** *is* remembered, the last-opened **page within it** is not. Launching lands you in your last project, on its default page.
- **Deep linking is required — from outside the app.** It must be possible to open a specific **project**, **page/view**, **ticket**, or **graph view** directly by address, without navigating there by hand.

**Fixes / gaps**
- Needs an addressing scheme that can name a project + a target resource.
- Needs an OS-level entry point (protocol handler) so an external tool/link can reach a *running or cold* app.
- Implies a single-instance lock — a second launch must route into the existing window, not spawn a rival instance holding the same DB/socket.
- Internal routing must become addressable (today it's opaque `useState`), including "open ticket X" which currently has no representation at all.

**Status:** ✅ *(shaped; addressing details land in Pass 2)*

---

## A2 · Navbar

**Today**
- `src/components/Navbar.tsx`. Two pill-groups: `[Home, Product, Explore, Execute]` and `[Backlog, All, Graph]`.
- **`+` button is dead** — rendered, no `onClick`.
- **"Notes" button is dead** — rendered, no `onClick`.
- Right-side dropdown is labelled hardcoded **"Project Name"** with a generic user icon; its items (Archived Tickets, Settings) do work.
- No project concept exists in the data model — the label is decoration.

**Intent**
- **`+` button — drop it.** Not needed at the moment. Remove rather than leave dead.
- **"Notes" — build it.** Opens a grid-style view of markdown notes. See **B10**.
- **"Project Name" — make it real.** Shows the **active project's name**. The existing dropdown gains a new **"Projects"** item (alongside Archived Tickets / Settings) that opens the **projects launcher screen**. See **A3**.

**Fixes / gaps**
- Remove the dead `+` button.
- Wire "Notes" to the new Notes view.
- Replace the hardcoded "Project Name" label with the active project, backed by a real project entity.
- Add a "Projects" dropdown item → launcher screen. The dropdown itself is *not* the switcher; the launcher is.

**Status:** ✅

---

## A3 · Projects — multi-project support 🆕

*Cross-cutting: touches storage, vault, IDs, bridge, deep links, and every view.*

**Today**
- **No project concept exists anywhere.** One implicit global workspace: one `overhead.db`, one `vault/`, one `OVH-` counter.
- "Project Name" in the navbar is a hardcoded decorative string.

**Intent**
- **Projects are first-class and fully standalone.** No cross-project communication is foreseeable in any scope — no shared tickets, no cross-project relations, no cross-project mentions.
- **Every per-workspace behaviour duplicates per project** — explicitly including markdown/vault syncing and its directory creation. Each project gets its own directory and its own mirror.
- **Project names are unique.** No two projects may share a name.
- **One project open at a time — in-place swap.** Switching projects reloads the app into that project. No side-by-side windows.
- **Navigation to the switcher:** navbar project dropdown (already built) gains a **"Projects"** item → opens a **launcher screen** listing all projects. Selecting one enters it.
- **The active project persists across restarts.** Reopening the app returns you to the project you last worked in (contrast **A1**: the *page* within it is not remembered).
- **Each project owns its ticket ID prefix and its own counter** — `OVH-001`, `SHOP-001`, etc. See **C9**.

**Fixes / gaps**
- Requires a project registry (create / rename / delete / list / switch) with a uniqueness constraint on name.
- Launcher screen to build. Open: whether it's a third overlay view (like Settings/Archived) or a distinct pre-app screen.
- "Active project" must be stored somewhere **outside** any single project's own data, since it's the pointer that selects which one to load.
- A project needs a **prefix** field alongside its name; prefix uniqueness across projects is likely wanted too (to keep mentions unambiguous) — to confirm in Pass 2.
- Storage must be partitioned per project — decision deferred to Pass 2, but "standalone + duplicated directories" points at a per-project data directory rather than a shared DB with a foreign key.
- Vault (**E4**) becomes per-project: its own directory, its own watcher.
- ID generation (**C9**) is affected — the hardcoded global `OVH-` prefix and single counter no longer fit cleanly.
- Every external surface (**D1–D5**: bridge, HTTP, unix socket, CLI, MCP) needs to say *which project* a call targets.
- Deep links (**A1**) must be able to name a project.
- Deleting a project needs defined semantics (files on disk, running watcher, open window).

**Status:** 🔵 *(open questions below)*

---

## A4 · Global fuzzy search — ⌘K palette 🆕

**Today**
- **No command palette, and not a single keyboard shortcut handler exists anywhere in the app** (no `keydown` listener, no `metaKey`/`ctrlKey` handling in any component).
- `cmdk` **is** already a dependency and `src/components/ui/command.tsx` already exists — currently used only to power the ticket table's faceted-filter dropdowns. The library is proven in-project; the palette itself is greenfield.

**Intent**
- **App-wide fuzzy search, hidden behind a keyboard shortcut** — ⌘K or similar. The shortcut pops a search bar overlay; there is no permanent search UI taking up space.
- **Search matches on title and ticket ID.** Both matter — you look things up by name *and* by `OVH-123`.
- **Deliberately minimal: titles only, nothing more.** Explicitly *not* searching descriptions or body content in this round.
- Body/content search is acknowledged as a possible future addition — **not being touched now**.

**Fixes / gaps**
- Build the palette: global shortcut listener, overlay, fuzzy matcher over title + ID, and navigation to the chosen result.
- Scope is the **active project** (**A3**) — search never crosses projects.
- Selecting a result must be able to *open a ticket*, which needs the addressable-routing work from **A1**.
- **Scope: active tickets only.** Not archived (the Archived view has its own inline search — **B7**), and not notes. Keeps the palette a fast jump-to-ticket tool rather than a universal index.

**Status:** ✅

---

## B1 · Home — FocusCard + VisionCard

**Today**
- `src/views/Home.tsx` — two columns: `FocusCard` (flex-1) + `VisionCard` (w-72).
- **`FocusCard` is 100% hardcoded mock data.** A literal `phases` array in the component with fake tickets (OVH-004…OVH-014), fake statuses (`Answered`/`Live`/`Ready` — statuses that don't exist in the real model), fake progress counts. Nothing touches the store. "Open Ticket" button does nothing. Checkboxes are inert.
- `VisionCard` **is** real — reads `vision.northStar` + `vision.body` from the settings table via `SettingEditor` in read-only mode.
- No notion of "the current focus ticket" exists in the data model.

**Intent** — 🟡 **DEFERRED BY DECISION. Build this last.**

- Home's purpose: the **"let's get back to work" surface** — a quick look that lets you re-enter the project and jump straight back in. Not a dashboard for its own sake; a re-entry ramp.
- **Users must be able to pin the tickets they're working on.** Pinning is the wanted primitive underneath the focus concept.
- The focus dashboard is acknowledged as **not yet complete, and not yet in sync with the ticketing system**. Rather than force a design now, **keep the current placeholder** and revisit with a dedicated UX brainstorm once the ticket system underneath is settled.

**Fixes / gaps**
- ⏸️ **Do not build the real FocusCard in this round.** Leave the placeholder standing.
- Pinning needs to exist as a real capability (ticket-level, project-scoped) — schedule it with the ticket model work, not with Home.
- Reserved for the later brainstorm: what "focus" means (manual pin vs. derived from status/relations), whether phase grouping needs real ticket hierarchy (none exists today — tickets are flat), and what the re-entry view actually shows.
- `VisionCard` already works against real data — leave it alone.
- Note the dependency: the pinning primitive should be built *before* the brainstorm, so the design has something real to sit on.

**Status:** 🟡 *(deferred — placeholder retained, revisit after the ticket system settles)*

---

## B2 · Product — Features + Vision

**Today**
- `src/views/Product.tsx` — local tab state, two tabs.
- **Features tab** → `TicketView` filtered to `type === 'Feature'`, with `fixedType="Feature"` (create panel locks type, backlog filter shown, type filter hidden).
- **Vision tab** → `src/views/Vision.tsx` — two editable markdown sections ("North Star", "Vision") persisted to the settings table under `vision.northStar` / `vision.body`.

**Intent**
- **Vision stays under Product — confirmed.** Product is the **hub for meta-level and high-level thinking**: where ideas start, where features get designed and shaped conceptually. Vision belongs in that frame, not off on its own.
- **Vision should be styled better.** Present it with more care than the current plain two-section stack — it's a document you're meant to think in, not a settings form.
- **Vision + North Star are not just for the human — they are context for LLMs.** See **D6**. This is a core reason Vision lives in Product rather than being decorative.
- Vision content becomes **per-project** automatically under **A3** (it lives in settings). Each project gets its own north star.

**Fixes / gaps**
- Restyle the Vision tab — treat it as a thinking surface, not a form.
- Vision keys must move to per-project storage with the rest of settings (**E5** / **A3**).
- Wire vision content into the LLM context surface (**D6**).

**Status:** ✅

---

## B3–B6 · Shared intent for the ticket views

*Applies to Explore, Execute, Backlog and All — they are all `TicketView` with different filters.*

**Intent**
- **Backlog tickets are hidden by default everywhere.** Backlog is opt-in, never mixed into a default view. (Today this is only true on fixed-type views; the All view shows backlog with no control to remove it — that's a bug against this intent.)
- **Kanban — 🟡 DEFERRED.** The original intent was two switchable presentations (table for scanning/filtering, Kanban for working the flow). **Decision reversed during shaping: pin the Kanban for now.** Table remains the only presentation this round.

**Fixes / gaps**
- Make the backlog-hidden default apply to **all** views, and expose the backlog toggle everywhere rather than only on fixed-type views.
- ⏸️ **Do not build the Kanban this round.**

**Reserved for the Kanban revisit** *(unresolved when it was pinned — pick these up then)*
- Columns group by **status**, which is per-type (**C1**), so cross-type views (All, Backlog) need a defined column strategy: board only on type-scoped views · a swimlane per type · or a shared-stage mapping every type's statuses fold into.
- Whether the chosen presentation is remembered per view or resets each time.

---

## B3 · Explore view

**Today**
- One line: `<TicketView filter={t => t.type === 'Explore'} fixedType="Explore" />`.
- Default filter hides backlog tickets. Statuses: Open → In Progress → Concluded / Not Needed.

**Intent**
- Per the shared intent above: table only for now (Kanban deferred), backlog hidden by default.

**Status:** ✅

---

## B4 · Execute view

**Today**
- One line: `<TicketView filter={t => t.type === 'Execute'} fixedType="Execute" />`.
- Default filter hides backlog tickets. Statuses: Draft → Ready → In Progress → Done / Failed / Rejected.

**Intent**
- Per the shared intent above: table only for now (Kanban deferred), backlog hidden by default.

**Status:** ✅

---

## B5 · Backlog view

**Today**
- `<TicketView filter={t => t.backlog === true} />` — all types, backlog-flagged only. No fixed type, so the create panel asks for a type and the type filter is visible.

**Intent**
- Per the shared intent above: table only for now (Kanban deferred).
- This is the one view where backlog tickets are *the* content — the "hidden by default" rule elsewhere is what makes this view meaningful.

**Status:** ✅

---

## B6 · All view

**Today**
- `<TicketView />` — unfiltered. Every non-archived ticket of every type.
- **Inconsistency:** backlog tickets appear here *and* the backlog filter control is not rendered (it's gated on `fixedType`), so they can't be filtered out.

**Intent**
- Per the shared intent above: table only for now (Kanban deferred).
- **Backlog must be hidden here by default** — this is the view that currently violates that rule.

**Fixes / gaps**
- Apply the default backlog filter and render the backlog toggle on non-fixed-type views.

**Status:** ✅

---

## B7 · Archived view (overlay)

**Today**
- Reached from the project dropdown, not the tab bar. Full-screen overlay.
- Simple card list (type badge, id, status, title) + a **Restore** button per row. Empty state exists.
- No search, no filtering, no permanent delete, no bulk actions.

**Intent**
- **Archived needs fuzzy search — by title and by ticket ID.** This is the view that motivated the app-wide search capability (**A4**); an unfiltered scroll doesn't survive a few hundred archived tickets.

- **An inline search field on the view itself** — narrows the archived list in place. The ⌘K palette deliberately does *not* cover archived (**A4** is active tickets only), so this is the only way to find an archived ticket.

- **This view is the sole home of permanent deletion** (**C8**). Each archived row gets a delete action with a confirm. Active tickets cannot be deleted anywhere else in the app — archive first, then delete here.

**Fixes / gaps**
- Add an inline fuzzy search field over title + ID to the archived list.
- Add a per-row permanent delete + confirmation dialog. Deletion must cascade relations, history, graph nodes/edges and mention backlinks.
- No bulk actions in scope.

**Status:** ✅

---

## B8 · Settings view (overlay)

**Today**
- Sidebar with 5 sections: General, Account, Notifications, Admin Control, About.
- **Only "Admin Control" is implemented** — a single "Delete all tickets" destructive action with a confirm dialog.
- The other 4 render a placeholder: *"{name} settings will go here."*
- Nothing configurable today: no vault path, no theme toggle, no bridge/port config, no data export.

**Intent** — section by section:

| Section | Decision |
|---|---|
| **General** | ~~Placeholder~~ → **now has real content: the theme toggle** (Light / Dark / System). See **E7**. |
| **Account** | **Build it** — a **name** and a **cute avatar**. Yoav will pick an avatar library that fits the look. **Global, not per-project** — one identity across the whole app. |
| **Notifications** | ❌ **Delete the section entirely.** Not wanted. |
| **Admin Control** | Already real (Delete all tickets). Keep. |
| **About** | **Keep as a placeholder.** Copy to be written later. |

**Fixes / gaps**
- Remove the Notifications section.
- Build Account: name + avatar. Avatar library is Yoav's pick — treat as a slot to fill, don't choose unilaterally.
- Build General around the theme toggle (**E7**).
- Leave About as a deliberate placeholder — *intentionally* empty, not unfinished work. Worth making it read as "nothing here yet" rather than the current *"{name} settings will go here"* stub text.
- **Unresolved and now relevant:** with **A3**, settings split into **per-project** (vault path, ID prefix, vision) and **global** (theme, account, bridge config). That split needs a home in this UI — today there's nowhere to put per-project settings at all.
- Still nothing configurable that arguably should be: vault path (locked to userData — can't point at an Obsidian vault or git repo), theme toggle (**E7** wants both modes first-class with no switch to reach them), data export.
- Account is **global** — stored outside any single project's data, alongside the "active project" pointer (**A3**).

**Status:** ✅

---

## B9 · Graph view (canvas)

**Today**
- `src/views/Graph.tsx`, 743 lines — the single densest view. Built on `@xyflow/react`.
- **Multi-view:** named graph views (create/rename/delete via dropdown), each with its own node positions + edges, persisted in `graph_views` / `graph_view_nodes` / `graph_view_edges`.
- **Nodes:** ticket cards placed by drag-and-drop, snapped to a 20px grid, constrained to a ±5000 canvas.
- **Two edge kinds:**
  - *Stored edges* — plain user-drawn lines living in `graph_view_edges`, with pinned `source_handle`/`target_handle` (left/right/top/bottom).
  - *Derived typed edges* — **not stored**; computed live from the relations table. `blocked-by` = red arrow (blocker→blocked), `relates-to` = dashed grey. Handles auto-inferred from relative position unless a stored edge pins them.
- Auto-layout via `layoutCluster` — relates-to arranged vertically, blocked-by horizontally.
- Live-reloads on `graph:updated` from external writes (bridge/CLI/MCP).
- **`TicketNode` click is a `TODO` no-op** — you cannot open a ticket from the canvas.

**⚠️ Finding — agents cannot see the meaningful edges**

`getViewMap` is documented as "full canvas snapshot", but it returns **only `graph_view_edges`** — the hand-drawn lines that carry *no* semantic meaning. **Relations are not included at all**, and `BridgeViewEdge` has no `type` field.

So an agent reading a view gets readable nodes and a list of typeless lines, while `blocked-by` / `relates-to` — the only edges that encode *what comes before what* — are invisible. It would have to call `listRelations` per ticket and reassemble the graph itself.

This is precisely the gap that breaks the app's thesis. **Creation is solved; comprehension is not.**

**Intent**
- **Clicking a node opens that ticket.** Simple as it sounds. Shares infrastructure with deep linking (**A1**) — accessing a ticket by address is the same underlying capability.
- **Graphs must be creatable *agentically*** — via MCP/bridge methods — and, just as importantly, **readable back by LLMs**.
- Graphs are valued as a thinking tool: organizing thoughts and **understanding what comes before what**. That directionality is the payload, not decoration.
- An agent should understand a graph **without a lot of prior context** — arriving cold and grasping "this is the notes, this is what we're doing, this is a research ticket."

**Fixes / gaps**
- Click-to-open on nodes is unimplemented (`TODO` in `TicketNode.tsx`).
- **`getViewMap` must return relations**, in one unified edge list where every edge declares its type. Where an edge is stored is an implementation detail agents shouldn't have to reason about.
**Edge model — DECIDED: keep both kinds, unify at the API**

- **Both edge kinds survive.** Hand-drawn visual edges remain as a sketch layer; relations remain the semantic layer. The ability to draw a line that doesn't commit to a meaning is kept deliberately.
- **Relations are NOT materialized into per-view rows.** They stay the single source of truth. *(Considered and rejected: duplicating them per view orphans rows when a relation is deleted, and gives no answer for which views a newly-created relation should join.)*
- **The fix is the read surface, not storage.** `getViewMap` returns **one unified edge list where every edge declares its `type`** — `blocked-by`, `relates-to`, or `visual`. The two-table split becomes an implementation detail agents never see.
- **`blocked-by` is kept.** It *is* the "what comes before what" edge — the directional one, and the reason graphs earn their place here. Collapsing to `relates-to` only was considered and rejected. Future pressure is toward *adding* directional types, not removing this one.

**Read-back format — DECIDED: typed JSON including coordinates**

- Structured JSON, shaped as today but complete: nodes plus the unified typed edge list, coordinates included. No separate text/outline rendering this round.

**Fixes / gaps**
- Click-to-open on nodes is unimplemented (`TODO` in `TicketNode.tsx`).
- **`getViewMap` must include relations** and every edge must carry a `type`. `BridgeViewEdge` has no type field today.
- `listViewEdges` has the same blind spot — decide whether it also unifies or stays the raw visual-edge accessor.
- Pass 2 detail: the current "handle anchor" overload — where a stored visual edge for a pair silently pins the handles of that pair's derived edge — survives this decision but should be documented as intentional rather than incidental.

**Status:** ✅

---

## B10 · Notes — markdown grid 🆕

**Today**
- **Does not exist.** The navbar has a dead "Notes" button and nothing behind it. No notes table, no notes model, no UI.

**Intent**
- A **grid-like view of markdown notes** — reached from the navbar's "Notes" button.
- Notes can **reference tickets by mention**, e.g.
  > "I have issues with the monetization model of `@OVH-123`, I need to talk with my friend about other income streams."
- Mentions are not a Notes-only feature — **mentioning tickets in markdown works generally** (see **C10**).
- **A note is a titled markdown document** — title + body, like an Obsidian note. The grid shows title + preview.

**Fixes / gaps**
- Entire feature to build: model, storage, grid view, editor.
- Notes are assumed **project-scoped** and **vault-mirrored** like tickets (consistent with A3) — to confirm in Pass 2.
- No tags/grouping/filtering in scope for now — revisit if note count grows.

**Status:** ✅

---

## C1 · Ticket model — types & status flows

**Today**
- Abstract `Ticket` base (`src/shared/types/ticket.ts`) + three subclasses registering their own loaders.
- Fields: `uuid, id, title, type, status, backlog, description, archived, created_at, updated_at`.
- Status flows are **flat string lists**, not state machines — any status can jump to any other (`ticketOptions.ts`):
  - Execute: Draft, Ready, In Progress, Done, Failed, Rejected
  - Explore: Open, In Progress, Concluded, Not Needed
  - Feature: Idea, Scoped, In Progress, Built, Canceled
- Changing a ticket's type remaps status via `statusForType()` (keeps it if valid for the new type, else resets to that type's default).
- **No fields for:** priority, assignee, due date, tags/labels, estimate, parent/child hierarchy.
- ~~An old commit mentions "five ticket types"~~ — **false alarm, resolved.** The phrase "Five ticket types with type-specific status flows" exists only as a hardcoded mock *ticket title* inside `FocusCard.tsx:97`. No commit says it; no types were ever built and dropped. **Three types is the real, intended design.**

**Intent**
- **Three types stay as they are.** Nothing missing.
- **No priority. No assignee. No due dates. No tags or labels.** See the standing constraint at the top of this document — this is a single-developer tool for organizing thinking and handing off cleanly to a coding agent, not a tracker. Added fields are added overhead.

- **No parent/child hierarchy. Tickets stay flat — relations are enough.** See the standing constraint "the developer plans, the agent follows" at the top of this document for the full rationale. In short: hierarchy would impose procedural structure, while relations record dependencies the developer actually found. `relates-to` couples tickets into one concise piece of work; `blocked-by` covers "this must happen first."
- **Add one field: `pinned` — a boolean per ticket.** Any number of tickets can be pinned. Mirrors how `backlog` already works on the model, and is the primitive the deferred focus dashboard (**B1**) will build on.

**Fixes / gaps**
- Nothing to add from the PM-field list — the correct action is to *keep resisting* it.
- Add `pinned` to the ticket schema, the Zod schema, `toJSON`, the vault frontmatter, and the bridge's ticket methods (create/update/read), so it's reachable from every surface like any other field.
- Build the pin **affordance** (a toggle on the ticket) even though Home stays a placeholder — the data needs to exist and be settable before the B1 brainstorm has anything to design against.
- No consumer of `pinned` ships this round beyond the toggle itself; Home remains deferred.

**Status:** ✅

---

## C2 · Ticket table

**Today**
- TanStack Table v8 (`src/components/ticket-table/`), shadcn-style: column headers with sort, faceted filters, pagination, view-options (column visibility), row actions menu.
- Filters: type (hidden when the view has a fixed type), status, backlog (shown only on fixed-type views).
- Clicking a row opens the ticket detail (in-place, replaces the table).

**Intent**
- The table stays the single presentation this round — **Kanban is deferred** (see the B3–B6 shared intent).
- Row click → open detail stays as is.
- Backlog is hidden by default on **every** view, with the toggle available everywhere (today the control only renders on fixed-type views).

**Fixes / gaps**
- Apply the default backlog filter + expose the backlog toggle on non-fixed-type views (**B6** is the view that visibly breaks this rule).
- No new columns for tracker fields — none exist, by the standing constraint.
- `pinned` (**C1**) lands in the control bar, **not** as a table row action this round.

**Status:** ✅

---

## C3 · Ticket detail + markdown editor

**Today**
- `TicketDetail` = left sidebar (current tab's tickets, id + title) + main panel; replaces the list in-place rather than opening a route or modal.
- `TicketEditor`: Novel/TipTap markdown editor with an explicit **Edit / View toggle** (defaults to View/read-only). Title is an inline input in edit mode only.
- Right side panel: resizable by drag (160–480px, not persisted), holds the Backlog switch and `TicketRelations`.
- Floating **Archive** button bottom-right.
- **History** button only appears in edit mode.
- Editor content is remounted via a compound `key` on every ticket/mode/content change — a workaround, and a re-render cost.
- Saves fire on **every keystroke** (`onUpdate` → `setDescription` → SQLite write). No debounce on the write path itself; the debounce lives only in history snapshotting.

**⚠️ Verified cost of the current write path**

`electron/ipc/ticketAPI.ts:67–78` — a single keystroke synchronously performs, on the main process's only thread:

1. IPC round-trip renderer → main
2. `runTicketSql` — SQL `UPSERT` through `DatabaseSync`, which is **synchronous**
3. `vaultWrite(uuid)` — a `SELECT *` to re-read the ticket, then **`fs.writeFileSync`** of the whole `.md` file
4. re-arms the per-ticket history debounce timer
5. renderer: `#changed()` → notify → re-render of every subscriber

Typing five characters = five blocking SQL statements and five whole-file writes, on the same thread that serves window events and all other IPC. It also churns the chokidar watcher aimed at that directory (guarded by mtime/content checks, so no loop — just wasted work). Cost **grows with description length**, so it degrades as a ticket becomes more valuable. The `// eager markdown mirror` comment shows this was deliberate; it simply pays the price far more often than the goal needs.

**Intent — two decided fixes**

**1. Debounce persistence, not mutation. (Full version — decided.)**
- `setDescription` stays **instant in memory** and keeps notifying, so UI and model remain live.
- Only the **write** moves behind a per-uuid trailing debounce (~300–500ms), placed at the **persistence boundary** (store/client layer) — *not* in the model. Timing is infrastructure policy; `Ticket` must not own it.
- Precedent already in-repo, to be mirrored rather than reinvented: `SettingEditor` debounces at 500ms, and `ticketAPI` already keeps per-uuid timers with an explicit `flushHistory()`.
- **Required flush points:** edit→view toggle · ticket switch · component unmount · window blur · before-quit.
- ⚠️ **Ordering trap:** `historyFlush` fires on edit→view today. With debounced writes, the pending description write **must flush before** the snapshot, or history records stale content.
- *(Considered and rejected as too narrow: debouncing only `vaultWrite` and leaving SQL eager. It kills the file I/O — the most expensive part — for a one-line change, but leaves synchronous SQL and full re-renders on every keystroke.)*

**2. Drive the editor imperatively instead of remounting it.**
- Keep one editor instance. Content changes → `editor.commands.setContent(next, false)` in an effect; mode changes → `editor.setEditable(editing)`.
- **Guard `setContent` against the editor's current markdown** — without that comparison, every external notify clobbers the user's cursor mid-typing.
- Remount only on ticket identity change, if at all.
- ❌ **Do not** convert the editor to a controlled `value`/`onChange` component — it fights ProseMirror's document model and ends up worse than the remount it replaces.
- Why it matters: remounting discards cursor, selection and **undo history**, and forces a full markdown re-parse + ProseMirror rebuild — the visible hitch on Edit→View. The current key also embeds the entire description string in view mode, so any external vault sync remounts the editor incidentally rather than by design.

**The two fixes compound:** debounced writes produce far fewer notifies, which removes most spurious content-change remounts even before fix #2 lands.

**Fixes / gaps**
- Implement the debounced persistence layer + flush points, and fix the flush-before-snapshot ordering.
- Replace the compound-`key` remount with `setContent` / `setEditable`.
- Side panel width (160–480px) is not persisted — decide whether it should be.

**Interaction model — decided**
- **Keep the explicit Edit / View toggle.** View stays the default. It protects against stray edits while reading and gives history a natural commit point. *(Rejected: always-live editing — it would remove the edit→view flush trigger that history depends on.)*
- The toggle remains the primary flush point for both the debounced write and the history snapshot — in that order.

**Status:** ✅

---

## C4 · Ticket control bar

**Today**
- Thin bar under the detail header: two selects — **Type** and **Status** (status options driven by the current type).
- That's all. No priority/tags/dates because those fields don't exist.

**Intent**
- Stays deliberately thin — Type and Status only. The standing constraint forbids adding tracker fields here.
- **Add the `pinned` toggle to this bar** (**C1**) — a pin icon control beside Type and Status. Chosen over the side panel so it's visible without scrolling.

**Fixes / gaps**
- Add the pin toggle; wire it to the new `pinned` field.
- Keep resisting additions beyond this — the bar's thinness is the design.

**Status:** ⚪

---

## C5 · Create ticket panel

**Today**
- Three modes: `collapsed` → `expanded` → `fullPage`.
- Fields: title (Enter submits), markdown description, type (locked when `fixedType`), backlog flag.
- **Known smell:** after `create()` it finds the new ticket by taking the **last element** of the store snapshot, then sets its description. Fragile — assumes append order and that nothing else wrote in between.
- The `backlog` flag collected in the form is **never applied** to the created ticket.

**Intent**
- **After creating, open the new ticket.** Creation drops you into the detail view to keep writing — capture the thought, then flesh it out.
- Keep the three-mode panel (collapsed → expanded → full page).

**Fixes / gaps**
- 🐞 **Bug: the created ticket is found by taking the last element of the store snapshot**, then setting its description on it. Fragile — it assumes append ordering and that nothing else wrote in between.
- 🐞 **Bug: the `backlog` flag collected by the form is never applied** to the created ticket. Silently dropped.
- Both bugs and the new "open after create" behaviour share one fix: **`ticketStore.create()` must return the created ticket**, and accept the full initial state (title, type, description, backlog, and now `pinned`) so nothing is applied by guesswork after the fact.
- Creating must route into the detail view — depends on the addressable-routing work in **A1**.

**Status:** ✅

---

## C6 · Relations

**Today**
- Two types only, fixed by the API: `relates-to` (symmetric, enforced by `node_a < node_b` check constraint) and `blocked-by` (directional).
- Edited from the ticket detail's side panel (`TicketRelations`).
- Deleting a ticket cascades its relations. Every write notifies the graph.
- No other relation kinds (parent/child, duplicate, depends-on).

**Intent**
- **Two relation types are enough.** Keep `relates-to` and `blocked-by`; add nothing.
- Anything more nuanced — *"this came out of that research"*, *"this duplicates that"* — gets written in the description rather than encoded as a type.
- *(Considered and rejected: a directional "came from" type capturing which ticket produced which, and a "duplicate of" type.)*
- Weight to note: with hierarchy rejected (**C1**), these two types are **the entire structural vocabulary** of the app. That's deliberate.

**Fixes / gaps**
- No changes to the relation model itself.
- Relations must become **project-scoped** under **A3** — no relation may ever span two projects.
- Relations must appear in `getViewMap`'s unified typed edge list (**B9**) — today they're invisible to agents reading a graph.

**Status:** ✅

---

## C7 · Version history

**Today**
- Snapshots of the **description only** — not title, status, type, or any other field.
- Debounced write while typing; flushed immediately on edit→view toggle and on app quit.
- Stored in `ticket_history (ticket_uuid, ts, description, hash)`, cascade-deleted with the ticket.
- UI is a right-hand Sheet, newest first; **the newest entry is sliced off** the displayed list (it's the current state). Restore swaps the description back and immediately re-snapshots.
- No diff view, no retention limit/pruning, no labelled versions.

**Intent**
- **Keep every snapshot in storage — no pruning.** Snapshots are small text and this is a single-user app; there's no retention policy to write.
- **Cap what the *user sees* at 50.** The history sheet shows at most 50 versions. Storage is unbounded; the display is bounded.
- Keep snapshotting the **description only** — title/status/type history is not wanted.

**Fixes / gaps**
- Limit the history sheet to 50 entries. Note the existing UI already slices off the newest entry (it's the current state), so the cap applies **after** that slice.
- No pruning job, no retention config, no diff view, no labelled versions.
- History must be **project-scoped** under **A3**.
- ⚠️ Interacts with **C3**: with writes debounced, the pending description write must flush **before** the history snapshot fires, or snapshots record stale text.

**Status:** ✅

---

## C8 · Archive / restore

**Today**
- `archived` boolean on the ticket. Archived tickets are excluded from all normal views and shown in the Archived overlay.
- **Archiving deletes the ticket's vault `.md` file** (`vaultWrite` routes archived → `vaultDelete`). Restoring re-creates it on the next write.
- No hard-delete from the UI except the global "Delete all" in Settings.

**Intent**
- **Archiving keeps deleting the vault `.md` file.** Current behaviour is correct — the vault holds only active tickets and stays clean. Accepted consequence: if the vault is ever versioned (git) or an Obsidian folder, archiving registers as a real file deletion. *(Considered and rejected: moving the file to a `vault/archive/` subfolder, or leaving it in place.)*
- **Add permanent single-ticket delete — reachable only from the Archived view.** You cannot delete an active ticket directly; you must archive it first, then delete it from the archive.
- This makes deletion a deliberate two-step: **archive → delete**. Archiving stays the reversible everyday action; deletion is a separate, explicit decision made in a place you have to navigate to.

**Fixes / gaps**
- Add a delete action to rows in the **Archived view** (**B7**) with a confirm — it is the *only* delete entry point for a single ticket.
- Deletion must cascade correctly: relations, history snapshots, graph view nodes/edges, and mention backlinks (**C10**). The DB has `ON DELETE CASCADE` for relations/history/graph rows; backlinks are new and must be included.
- The vault file is already gone at archive time, so delete needs no extra file cleanup — but it must not resurrect one.

**Status:** ✅

---

## C9 · ID generation

**Today**
- `Counter.next()` reads `settings.counter`, increments, writes back, returns `OVH-NNN` (3-digit pad).
- Reset by "Delete all tickets". Prefix `OVH` is hardcoded — not configurable, not project-scoped.
- Ids are **not** reused or backfilled; nothing prevents drift if the counter row is lost.

**Intent** *(settled via A3)*
- **Each project defines its own prefix and keeps its own counter** — `OVH-001`, `SHOP-001`. IDs carry project identity and mentions stay unambiguous.

**Fixes / gaps**
- Prefix moves from a hardcoded constant to a per-project field, set at project creation.
- Counter moves from a single global `settings.counter` to per-project state.
- Existing data uses `OVH-` — the first project must adopt that prefix on migration so current IDs stay valid.
- Open: is the prefix editable after creation? Renaming it would strand every existing ID and every markdown mention. Recommend **immutable once set**.
- "Delete all tickets" resetting the counter is now a per-project action.

**Status:** ✅ *(pending the immutability call)*

---

## C10 · Ticket mentions / backlinks in markdown 🆕

**Today**
- **Does not exist.** Markdown is rendered by Novel/TipTap with `StarterKit` + `Placeholder` + `Markdown` only — no mention extension, no autocomplete, no link resolution.
- Historical note: an early mock ticket read *"Wire OVH-### reference autocomplete in editor"* — the idea predates this pass but was never built.

**Intent**
- Tickets can be **mentioned inside markdown** using an `@OVH-123`-style reference.
- Applies **generally**, not just in Notes — ticket descriptions included.
- **Backlinks are tracked and stored** — mentions are parsed and persisted as real, queryable links.
- **But nothing is surfaced in the UI yet.** No "Mentioned in…" panel, no backlink counts. The data is worth capturing now; presenting it is explicitly out of scope for this round. *(Possible later.)*

**Fixes / gaps**
- Needs a TipTap mention/reference extension with autocomplete over the project's tickets.
- Needs a stable markdown serialization so the reference survives the vault round-trip and stays readable in a plain text editor.
- Mentions must resolve within the active project only (A3 — no cross-project references).
- Backlink extraction must also run on **inbound vault edits**, not just in-app typing — otherwise externally-edited files silently desync the link table.
- Build the storage + extraction; deliberately **do not** build read UI.

**Status:** ✅

---

## D1 · Governed bridge (Door 2)

**Today**
- Single entry point `dispatchBridge(method, args, ctx)` → `gate.authorize()` → `gate.throttle()` → Zod-validated method → SQL helpers.
- **23 methods** across tickets (5), relations (4), views/nodes/edges (14). No raw SQL crosses this door.
- Writes route through the *same* `runTicketSql`/`runRelationOp` helpers the renderer uses, so vault mirroring + history snapshots behave identically.
- `throttle()` is a **stub** — `// TODO: per-caller throttling`.

**Intent**
- The single-entry-point design stays — it's working and is the reason a new method reaches every transport at once.
- **Project scoping is implicit: bridge calls act on the currently-active project** (**A3**). No project argument is added to any method. An agent working alongside you is, by definition, working on what you have open.
  - *(Considered and rejected: an explicit project parameter on all 23 methods, and implicit-with-override. Rejected as API churn across the bridge, CLI and every MCP tool schema for a single-user tool.)*
  - ⚠️ **Known consequence:** if the user switches project mid-task, an agent's later calls silently land in the new project. Mitigation to design in Pass 2: have responses state which project they acted on, so a caller can detect the switch rather than corrupt the wrong project.
- **Implement basic per-caller throttling.** Not a security control — a guard against a runaway agent loop hammering the DB.

**Fixes / gaps**
- Implement `throttle()` and remove the TODO.
- Scope every method to the active project; ensure no method can reach another project's data.
- Add the `getProjectContext` method (**D6**) and the unified typed edges in `getViewMap` (**B9**).
- New surface area needed for this round's features: notes (**B10**), pinning (**C1**), single-ticket delete (**C8**), and project registry methods (**A3**) — decide in Pass 2 which of these external callers actually need.

**Status:** ✅

---

## D2 · HTTP transport

**Today**
- In-process server on `127.0.0.1:49152`, `POST /invoke` with `{ method, args }`.
- `EADDRINUSE` is swallowed — a stale dev instance silently disables HTTP for the new process.
- **Bearer token is NOT enforced.** `transports/token.ts` mints and persists a 0600 token each launch, but the HTTP server never reads the `Authorization` header, never calls `validateToken`, and never sets `ctx.caller = 'http'` — so the gate's HTTP branch never fires. Documented as a known gap.

**Intent**
- **Keep HTTP, and enforce the bearer token.** The machinery already exists and is unused — this is mostly connecting it. *(Considered and rejected: deleting the HTTP transport entirely and relying on the unix socket, whose filesystem permissions are already real auth.)*

**Fixes / gaps**
- Read the `Authorization` header, call `validateToken()`, and set `ctx.caller = 'http'` so the gate's HTTP branch actually fires — it is dead code today.
- Reject unauthenticated requests rather than serving them.
- Revisit the swallowed `EADDRINUSE`: a stale dev instance silently disables HTTP for the new process, which is confusing to debug. At minimum it should be logged loudly.
- Update `BRIDGE.md`, which currently documents this as a known open gap.

**Status:** ✅

---

## D3 · Unix socket transport

**Today**
- `<userData>/bridge.sock`, owner-only permissions — **filesystem permissions are the auth boundary**.
- One newline-terminated JSON request per connection, one response back. Stale socket unlinked on startup.
- Used by both CLI and MCP.

**Intent**
- **Keep as is.** Filesystem permissions are a legitimate auth boundary for a local single-user tool, and this is the path both first-party clients use.

**Fixes / gaps**
- No changes beyond inheriting the active-project scoping (**D1**) and throttling.

**Status:** ✅

---

## D4 · CLI — `ovh`

**Today**
- `cli/ovh.mjs`, zero dependencies. Full coverage of all 23 bridge methods: `tickets`, `relations`, `views` (+ `views nodes`, `views edges`).
- Flags: `--raw` (minified JSON), `--socket <path>`.
- Not installed anywhere — requires a manual symlink onto PATH. No packaging, no completion, no `--help` beyond usage text.

**Intent**
- **Keep the zero-dependency design and 1:1 method coverage.** Nothing structural to change.
- Inherits implicit active-project scoping (**D1**) — no `--project` flag.

**Fixes / gaps**
- Add subcommands for whatever new bridge methods ship this round (project context, notes, pin, delete).
- Open for Pass 2: whether install stays a manual symlink or gets a real install path. Low priority — it's a single-user tool on one machine.

**Status:** ✅

---

## D5 · MCP server

**Today**
- `mcp/server.mjs`, zero dependencies, JSON-RPC 2.0 over stdio, forwards to the unix socket.
- All 23 bridge methods exposed **1:1 as MCP tools**, each with a JSON Schema mirroring its Zod schema.
- Requires the Electron app to be running (it's just a socket client). Failures return `isError` tool results rather than crashing.
- Not registered with any host by default; `OVH_SOCKET` env var overrides the socket path.

**Intent**
- **This is the app's most important external surface** — it's how coding agents actually consume the planning work, which is the entire point of the product.
- Keep the zero-dependency stdio design and 1:1 tool mapping. Inherits implicit active-project scoping (**D1**).

**Fixes / gaps**
- Expose the new methods as tools: `getProjectContext` (**D6**), unified typed graph edges (**B9**), plus notes/pin/delete as decided in Pass 2.
- **Tool descriptions carry real weight here.** Since context delivery is opt-in (**D6**), the description must make an agent reach for it *before* making judgment calls. Same for graph reads — an agent should understand it can learn "what comes before what".
- Requires the app to be running; failures already surface as `isError` results rather than protocol crashes. Keep that.

**Status:** ✅

---

## D6 · Project context for LLMs — vision as steering 🆕

**Today**
- **Does not exist.** Vision and North Star are stored as plain settings keys and rendered in two places (Vision tab, VisionCard). **Nothing exposes them to the bridge, CLI, or MCP** — an agent working a ticket has no access to the project's intent.
- The bridge returns bare ticket rows. An LLM calling `getTicket` sees a title, status and description, and nothing about what the project is *for*.

**Intent**
- **Vision + North Star are context supplied to LLMs**, not just documentation for the human.
- The purpose is **steering on judgment calls**. Agents working Execute and Explore/research tickets constantly hit *thin* decisions — marginal calls, tipping points where the ticket text alone doesn't determine the answer. The user's own written guidance ("this is what I want, this is what matters") resolves those in the user's favour instead of the model's default.
- Framed by Yoav as a **UX trick**: the user writes their intent once, in a place they'd write it anyway, and it silently improves every downstream agent decision. This is a core reason Vision sits in Product as a first-class surface (**B2**) rather than being decorative.

- **Delivery: a dedicated context method.** A single bridge method (e.g. `getProjectContext`) returns the vision + north star. Agents fetch it explicitly; it surfaces as one MCP tool. Ticket reads stay lean — the context is *not* stapled onto every `getTicket` response.

**Fixes / gaps**
- Add the context method to the bridge registry, and expose it on every transport (HTTP, CLI, MCP) like any other method.
- Must be **project-scoped** (**A3**) — an agent's context is the active project's vision, never another's.
- Design the return envelope so it can **grow beyond two keys** later (conventions, constraints, glossary) without a breaking change.
- Because the method is opt-in, the MCP tool description matters: it has to read as something an agent *should* call before making judgment calls, not as an optional extra.

**Status:** ✅

---

## E1 · Electron main process & window lifecycle

**Today**
- `electron/main.ts` boot order: SQLite → vault → vault watcher → 5 IPC registrations → token → HTTP → unix socket → window.
- **Window opens on display #2 if one exists** (`displays[1] ?? displays[0]`) — a dev-machine habit hardcoded into the app.
- Fixed 1200×800, centred on that display. No size/position persistence, no menu customization, no tray, no auto-update, no single-instance lock, no deep-link/protocol handler.
- `sandbox: false` in webPreferences.

**Intent**
- **Remember window size and position; drop the hardcoded second-display preference.** Behave like a normal app on any machine — restore where the user left it.
- Must gain a **single-instance lock** and a **protocol handler** to support deep linking (**A1**).

**Fixes / gaps**
- Replace `displays[1] ?? displays[0]` with persisted window bounds (with a sane first-run default and a guard for a display that no longer exists).
- Register a custom protocol handler; route incoming links into the running window (`second-instance` event) as well as on cold start.
- Add the single-instance lock — mandatory, since two instances would fight over the same DB, socket and vault watcher.
- Boot order must become project-aware (**A3**): resolve the active project *before* opening its DB, vault and watcher.

**Status:** ✅

---

## E2 · SQLite storage layer & schema

**Today**
- `node:sqlite` `DatabaseSync` (still flagged experimental by Node — prints a warning on every run). DB at `<userData>/overhead.db`.
- 7 tables: `tickets`, `settings`, `ticket_history`, `ticket_relations`, `graph_views`, `graph_view_nodes`, `graph_view_edges`.
- **No migration system.** Schema evolves via `CREATE TABLE IF NOT EXISTS` plus ad-hoc `try { ALTER TABLE … } catch {}` blocks for added columns. No schema version row.
- No indexes declared beyond primary keys. No backup/export path.

**Intent**
- **Fresh start — existing data is discarded.** Current DB contents are treated as disposable dev data, so the per-project schema (**A3**) is built clean with no migration of old rows. *(Considered and rejected: a full migration system, and a one-off informal fold into a default project.)*
- ⚠️ **Confirm before executing in Pass 3.** This throws away every existing ticket, relation, graph view and history snapshot, and the vault `.md` files that mirror them. Verify nothing in the current DB or vault matters before the first destructive step — and take a copy of `overhead.db` + `vault/` first regardless; it costs nothing.

**Fixes / gaps**
- Re-model the schema for per-project storage (**A3**), plus new tables/columns for notes (**B10**), mention backlinks (**C10**) and `pinned` (**C1**).
- **Recommended even under "fresh start": add a `schema_version` row now.** The decision avoids migrating *today's* data, but the moment the app holds real work the next schema change has this same problem. A version marker is nearly free while the schema is being rewritten anyway, and expensive to retrofit later.
- Remove the ad-hoc `try { ALTER TABLE … } catch {}` blocks — they exist only to patch older DBs that are being discarded.
- Consider indexes for the queries that now matter (mention lookups, per-project filters); today there are none beyond primary keys.
- `node:sqlite` remains experimental and prints a warning on every run — accepted, but worth a note in Pass 2 on whether that's tolerable for a packaged release.

**Status:** ✅

---

## E3 · IPC layer (Door 1) + preload

**Today**
- Renderer sends **raw SQL strings** over IPC (`window.db.ticket(sql, params)`). The only guard is a regex checking the word `tickets` appears — explicitly documented as "a typo guard, not a security control".
- Deliberate, documented trade-off (`SECURITY-renderer-raw-sql.md`) valid only while: local single-user, rich text sanitized (**unverified**), and no renderer-resident plugin ever sees `window.db`.
- Containment rule in force: only `ticketClient` / `relationsClient` may hold SQL templates.

**Intent**
- **Keep Door 1 as raw SQL.** The documented trade-off stands: it's a local single-user app, and the renderer is already trusted. Door 2 exists precisely so untrusted callers never touch this channel.
- Keep the containment rule in force: **only `ticketClient` / `relationsClient` may hold SQL templates.** New features must not scatter raw SQL through components.

**Fixes / gaps**
- ✅ **Actually verify the "rich text is sanitized" checkbox** — the security doc lists it as a precondition and marks it *unverified*. It matters more after this round, not less: tickets ingest external markdown via the vault watcher, and `@mentions` (**C10**) add a new render path. An XSS bug there inherits `window.db.ticket(rawSQL)`.
- Notes (**B10**) and mentions must route through the same client layer — no new SQL-holding modules.
- Update `SECURITY-renderer-raw-sql.md` once the sanitization check is done, and re-check its three preconditions against the new feature set.

**Status:** ✅

---

## E4 · Markdown vault

**Today**
- Every ticket mirrors to `<userData>/vault/<OVH-ID>.md` with YAML frontmatter (uuid, id, title, type, status, backlog) + description body.
- Rename follows the id; archive/delete removes the file. Index rebuilt from disk on boot by scanning frontmatter uuids.
- **Inbound sync is description-only** — `chokidar` watches the vault, and an external edit updates *only* `description`. Editing `title`/`status`/`type` in the frontmatter has no effect on the DB.
- Guards against loops via mtime and content comparison. Files without a matching uuid in the DB are logged and skipped — **you cannot create a ticket by dropping a new `.md` in the vault.**
- Vault path is fixed to userData — not configurable, so it can't be pointed at an Obsidian vault or a git repo.

**Intent**
- **Per-project vaults** (**A3**) — each project owns its directory, its own mirror and its own watcher. This was called out explicitly as a behaviour that must duplicate per project.
- Inbound sync stays **description-only**; frontmatter remains app-owned. No decision taken to make it fully bidirectional.

**Fixes / gaps**
- Move vault init + watcher to per-project, including teardown/re-init on project switch (the watcher must not keep watching the previous project's folder).
- Notes (**B10**) are assumed vault-mirrored too — confirm in Pass 2, and decide whether they share the directory or get a `notes/` subfolder.
- Mention backlinks (**C10**) must be re-extracted on **inbound** vault edits, not only on in-app typing, or externally-edited files silently desync the link table.
- ⚠️ Interacts with **C3**: with writes debounced, `vaultWrite` no longer fires per keystroke — confirm the watcher's mtime/content guards still behave with the new write cadence.
- Still true, still unaddressed: vault path is hardcoded to userData, so it can't point at an Obsidian vault or a git repo. Not raised as a requirement — leaving as is.

**Status:** ✅

---

## E5 · Settings / key-value store

**Today**
- `settings(key, value)` table, accessed via `generalClient` (`settingGet` / `settingSet` / `settingDelete`). The general API handler explicitly blocks ticket tables.
- Current keys in use: `counter`, `vision.northStar`, `vision.body`.
- No typed schema, no defaults registry, no settings UI beyond Vision + Delete All.

**Intent**
- **Settings split into two scopes** under **A3**:
  - **Per-project** — `vision.northStar`, `vision.body`, ID prefix, ticket counter.
  - **Global** — account name + avatar (**B8**), theme (**E7**), and the *active project* pointer.
- The global store must live **outside** any single project's data, since it holds the pointer that selects which project to load.

**Fixes / gaps**
- Introduce the global store alongside the existing per-project settings table.
- Move `counter` and the `vision.*` keys to per-project; add prefix.
- Delete-all resetting the counter becomes a per-project operation.
- Consider a small typed accessor + defaults registry rather than raw string keys — the key count is about to double and untyped `settingGet` calls are easy to typo.

**Status:** ✅

---

## E6 · Live sync notifications

**Today**
- `notifyGraphUpdated()` / `notifyTicketUpdated()` broadcast to all renderer windows.
- Graph view listens and reloads views + nodes/edges + relations. Vault watcher fires ticket notifications on external file edits.
- Notification is coarse — "something changed, reload everything for this view" rather than a targeted patch.

**Intent**
- **Keep the coarse broadcast model.** It works, and at single-user data volumes the reload cost is irrelevant. Not worth replacing with targeted patches.

**Fixes / gaps**
- Notifications must respect the active project (**A3**) — a write must never trigger a reload of a project that isn't open.
- New mutating surfaces (notes, pin, delete, project switch) need to fire the appropriate notification, or externally-made changes won't appear live.
- Project switch itself is the one genuinely new case: it invalidates *everything* in the renderer, not just one view.

**Status:** ✅

---

## E7 · Theme & design system — "Ink & Obsidian"

**Today**
- Established direction: both light and dark first-class, copper accent, Newsreader + Hanken Grotesk typography, "calm with moments", explicitly no AI-slop defaults.
- Implemented as Tailwind 4 + oklch CSS tokens in `src/index.css`; shadcn/base-ui component layer.
- `@fontsource-variable/geist` is still a dependency — inconsistent with the Newsreader/Hanken direction; worth confirming which is actually in use.
- **No theme toggle in the UI** — no way for a user to switch light/dark.

**Intent**
- **Add a theme toggle in Settings → General** — Light / Dark / System. This makes the dual-mode design reachable and gives the previously-empty General section real content (**B8**).
- Stored **globally**, not per project (**E5**).
- The established direction holds: copper accent, Newsreader + Hanken Grotesk, calm-with-moments, no AI-slop defaults.

**Fixes / gaps**
- Build the toggle + persist the choice; ensure "System" follows OS changes live rather than only at launch.
- **Verify both modes actually hold up.** Dark has had the attention; light being "first-class" is currently an aspiration nobody has been able to check, since there's no way to switch.
- Resolve the font inconsistency: `@fontsource-variable/geist` is still a dependency despite the Newsreader/Hanken direction — confirm which is in use and remove the loser.
- Vision tab restyle (**B2**) belongs to this work — it's the surface explicitly called out as needing better presentation.

**Status:** ✅

---

## E8 · Build, tooling, tests, docs

**Today**
- **`tsc -b` fails — ~15 errors, so `npm run build` cannot produce a release today.** Root causes:
  1. `@base-ui/react` `asChild` prop missing from installed types — **7 call sites** (Navbar, CreateTicketPanel, Graph, 4 in ticket-table).
  2. `src/mocks/mockTodoApp.ts` — 7 fixtures missing the `archived` field added later.
  3. `relationsClient.ts:23` — `{}` not assignable to `RelationPayload`.
  4. `Graph.tsx:470` — `NodeMouseHandler` vs `OnNodeDrag` mismatch (`@xyflow/react` types).
  5. `data-table-faceted-filter.tsx:1` — unused `React` import.
  6. `columns.tsx:13` — checkbox `'indeterminate'` not assignable to `boolean | undefined`.
- **Tests: 75 passing across 6 files** — ticket model, bridge, ticket API, history, relations API, vault. All main-process/model logic; **zero React component tests**.
- TypeDoc configured, generated API docs committed under `desktop_client/docs/api/`.
- ESLint configured. Electron-builder configured but unexercised (build fails first).
- Repo hygiene: `node_modules/` is untracked-but-present at repo root; a stale git worktree sits at `.claude/worktrees/kind-joliot-40c7c0` pinned to the first commit.
- The app **cannot run in a plain browser** — it hard-depends on `window.db` from the preload bridge (verified: `vite dev` alone throws on boot).

**Intent**
- **Get the build green first.** Nothing else in Pass 3 is verifiable while `tsc -b` fails — a red build means no packaged release and no trustworthy "it works".
- **Add React component tests** alongside the existing model/main-process suite. Cover the main views and interactions, not just logic.

**Fixes / gaps**
- Fix all ~15 type errors (the six root causes listed above). The `asChild` cluster is 7 call sites of one underlying problem — likely a single fix (correct `@base-ui/react` types or the right prop for that version), not seven.
- Stand up a React testing setup (jsdom + Testing Library under the existing Vitest) and cover the main views.
- Also test the new non-trivial logic: debounced persistence + flush ordering (**C3**), mention parsing round-trip (**C10**), project switching teardown/re-init (**A3**), and the vault watcher under the new write cadence.
- Repo hygiene: remove the stale worktree at `.claude/worktrees/kind-joliot-40c7c0` (pinned to the first commit), and confirm `node_modules/` at repo root is intended.
- Regenerate TypeDoc output once the API surface settles; the committed `docs/api/` will be stale after this round.
- Update `ARCHITECTURE.md`, `BRIDGE.md`, `SECURITY-renderer-raw-sql.md` and `docs/ticket.md` — all four describe the pre-projects architecture and will be actively misleading afterwards. (`ARCHITECTURE.md` already describes a `localDB`/`batch.ts` path that no longer matches the raw-SQL client code.)

**Status:** ✅

---

# Pass 2 — Code compliance

_Not started. Filled after Pass 1 completes._

---

# Pass 3 — Build log

_Not started._
