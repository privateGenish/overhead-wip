# Overhead — how this app works

Overhead exists to take the overhead out of planning work that gets handed to
coding agents. Thinking is captured as structure — tickets, relations, notes —
so it outlives the conversation it came from and can be handed over without
being re-explained.

You are one of the people it gets handed to. Two jobs follow: **capture the
user's thinking as structure while it is happening**, and **read the structure
that already exists before you act.**

---

## The three ticket types

They are not three words for "task". Each holds a different kind of unfinished
business, and picking the wrong one makes the board unreadable.

**Explore** — an open question. Something the user has not settled and needs to
work out. `Open → In Progress → Concluded | Not Needed`. The output is an
answer, written into the description.

**Feature** — a user-facing capability, held at the level of intent rather than
implementation. `Idea → Scoped → In Progress → Built | Canceled`. This is where
an idea gets shaped before anyone builds it.

**Execute** — a decided unit of work. `Draft → Ready → In Progress → Done |
Failed | Rejected`. If it is not clear what "done" means, it is not an Execute
ticket yet.

Statuses are fixed per type and enforced. A value outside a type's flow is
rejected, not stored.

---

## When to make one

Capturing is cheap. A lost thread is not. Lean toward creating.

- **The user is circling a question they have not settled** — "should we do X or
  Y", "I'm not sure whether…", turning a decision over out loud → an **Explore**
  ticket. Answer them as well, but capture the question, or the thinking dies
  with the conversation.
- **The user describes something the product should do** — a direction, a
  capability, "it would be good if…" → a **Feature** at `Idea`.
- **The user settles on a concrete piece of work** → an **Execute** ticket.

Create these without being asked. That is the point of the app: the user should
not have to stop thinking in order to file what they are thinking.

Two limits on that:

- Check `listTickets` first. A second ticket for something already open is worse
  than no ticket.
- A passing remark is not a thread. When you are unsure, say what you would
  create and let the user wave it through — but do not stop to ask about every
  one.

---

## What Overhead deliberately does not have

No priority. No assignee. No due dates. No tags or labels. No parent/child
hierarchy. One person works here; there is no coordination problem to model.

Do not smuggle them back in. `[P1]` in a title, `Parent: OVH-004` in a
description, `1. / 2. / 3.` prefixes to imply order — these all corrupt the
board with structure the app rejected on purpose.

---

## Structure is expressed with relations

Dependency and order live in relations, never in a tree and never in naming.

- **`blocked-by`** — this ticket cannot proceed until the other is finished.
  This is how you say what comes first.
- **`relates-to`** — symmetric. Two tickets are part of one piece of work.

If you find yourself wanting a sub-task, make a ticket and relate it.

---

## Before you make a judgment call

Call `getProjectContext`. It returns the project's north star and vision as the
user wrote them, plus the **bench** — the up-to-four tickets they have pinned as
what they are actively working on.

The vision is there for the decisions a ticket does not settle on its own: which
approach to take, what matters more, where to draw a line. It is how the user
steers work they are not watching. Read it before deciding one of those on their
behalf.

---

## Writing tickets

The description is the handover. Write for someone opening the ticket cold, with
none of the conversation that produced it — usually a future agent, sometimes
the user in a month.

- **Title** — what it is, not what kind of thing it is. No prefixes, no tags.
- **Description** — markdown. The problem, what is known, and what would settle
  it.
- **References** — `@OVH-123` anywhere in markdown is extracted into backlinks.

---

## The rest of the surface

- **Notes** — titled markdown with no status, type, or relations. A place to
  think that is not a ticket yet.
- **Backlog** — a flag, not a status. Hidden by default everywhere. Real, but
  not now.
- **Archived** — removed from view without being deleted.
- **Graph views** — canvases of placed tickets. Edges are typed: `blocked-by`
  and `relates-to` mean what they mean everywhere, `visual` is a hand-drawn line
  carrying no meaning.
- **Projects** — one is open at a time, and scoping is implicit. No method takes
  a project argument; every call acts on whatever is open. Every response names
  the acting project — check it if you are doing a run of writes.
