import fs from 'node:fs'
import path from 'node:path'
import { runSql } from '../db/sqlite'
import type { TicketRow, NoteRow } from '../db/sqlite'

/**
 * Where notes live inside a vault.
 *
 * Notes are titled documents with no `OVH-###` id, so their filenames come
 * from their titles — which could collide with a ticket's. A subdirectory
 * keeps the two namespaces apart, and gives the watcher an unambiguous way to
 * tell a note file from a ticket file (see `vaultWatcher`).
 */
export const NOTES_DIRNAME = 'notes'

let vaultDir = ''

/** In-memory map of uuid → last written filename (for rename/delete cleanup). */
const lastPaths = new Map<string, string>()

/**
 * The same index for notes, kept separate because the two live in different
 * directories and a note's filename tracks its (renameable) title.
 */
const noteLastPaths = new Map<string, string>()

export function initVault(dir: string): void {
  vaultDir = dir
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(dir, NOTES_DIRNAME), { recursive: true })
  rebuildIndex()
  rebuildNoteIndex()
}

const AGENT_GUIDE_FILENAME = 'OVERHEAD.md'

/**
 * Mirrors the agent guide into the vault, verbatim, once per project open.
 *
 * This reaches an audience the bridge's briefing gate structurally cannot: a
 * coding agent editing files in the project directory without ever calling
 * the bridge, which picks up OVERHEAD.md the same way it would a CLAUDE.md.
 *
 * Carries no frontmatter (it mirrors the source file as-is), so `rebuildIndex`
 * — which only recognises a `uuid:` line — never matches it; no indexing
 * changes are needed for this to be safe to write alongside ticket files.
 */
export function writeAgentGuide(dir: string): void {
  const src = path.join(process.env.APP_ROOT ?? '', 'shared', 'agent-guide.md')
  try {
    const content = fs.readFileSync(src, 'utf8')
    fs.writeFileSync(path.join(dir, AGENT_GUIDE_FILENAME), content, 'utf8')
  } catch (err) {
    console.warn('[vault] could not write OVERHEAD.md — agent-guide.md missing or unreadable:', err)
  }
}

export function getVaultDir(): string {
  return vaultDir
}

/** The `notes/` subdirectory of the open vault, or `''` when none is open. */
export function getNotesDir(): string {
  return vaultDir ? path.join(vaultDir, NOTES_DIRNAME) : ''
}

/**
 * Rebuilds the uuid → filename map from files already on disk. Without this,
 * the map starts empty each session and renames/archives/deletes of tickets
 * created in a previous session can't find their stale .md file.
 */
function rebuildIndex(): void {
  lastPaths.clear()
  for (const filename of fs.readdirSync(vaultDir)) {
    if (!filename.endsWith('.md')) continue
    const content = fs.readFileSync(path.join(vaultDir, filename), 'utf8')
    const match = content.match(/^uuid:\s*(.+)$/m)
    if (match) lastPaths.set(match[1].trim(), filename)
  }
}

/** `rebuildIndex` for `notes/` — same reasoning, different directory. */
function rebuildNoteIndex(): void {
  noteLastPaths.clear()
  const dir = getNotesDir()
  for (const filename of fs.readdirSync(dir)) {
    if (!filename.endsWith('.md')) continue
    const content = fs.readFileSync(path.join(dir, filename), 'utf8')
    const match = content.match(/^uuid:\s*(.+)$/m)
    if (match) noteLastPaths.set(match[1].trim(), filename)
  }
}

/**
 * Releases the vault. MUST be called when closing a project — both indexes are
 * module-level state keyed by uuid, and carrying either into the next project
 * would delete files belonging to the wrong one.
 */
export function closeVault(): void {
  vaultDir = ''
  lastPaths.clear()
  noteLastPaths.clear()
}

/** Test seam: how many uuid→filename entries are currently cached. */
export function __vaultIndexSize(): number {
  return lastPaths.size
}

/** Test seam: the same count for notes. Closing a project MUST zero it. */
export function __noteVaultIndexSize(): number {
  return noteLastPaths.size
}

export function __resetVaultForTests(): void {
  closeVault()
}

function buildFrontmatter(ticket: TicketRow): string {
  return [
    '---',
    `uuid: ${ticket.uuid}`,
    `id: ${ticket.id}`,
    `title: ${ticket.title}`,
    `type: ${ticket.type}`,
    `status: ${ticket.status}`,
    `backlog: ${ticket.backlog === 1}`,
    `pinned: ${ticket.pinned === 1}`,
    '---',
  ].join('\n')
}

/** Writes a ticket's .md file. If the ticket is archived or missing, deletes instead. */
export function vaultWrite(uuid: string): void {
  if (!vaultDir) return

  const rows = runSql('SELECT * FROM tickets WHERE uuid = ? LIMIT 1', [uuid]) as TicketRow[]
  const ticket = rows[0]

  if (!ticket || ticket.archived === 1) {
    vaultDelete(uuid)
    return
  }

  const filename = `${ticket.id}.md`
  const newPath = path.join(vaultDir, filename)

  const oldFilename = lastPaths.get(uuid)
  if (oldFilename && oldFilename !== filename) {
    fs.rmSync(path.join(vaultDir, oldFilename), { force: true })
  }

  const content = `${buildFrontmatter(ticket)}\n\n${ticket.description}`
  fs.writeFileSync(newPath, content, 'utf8')
  lastPaths.set(uuid, filename)
}

/** Removes a ticket's .md file using the cached filename. */
export function vaultDelete(uuid: string): void {
  if (!vaultDir) return
  const filename = lastPaths.get(uuid)
  if (filename) {
    fs.rmSync(path.join(vaultDir, filename), { force: true })
    lastPaths.delete(uuid)
  }
}

/**
 * Removes every ticket .md file.
 *
 * Only the vault's top level, deliberately: this runs on "delete all tickets",
 * and `notes/` belongs to a different collection that the caller did not ask
 * to erase.
 */
export function vaultClear(): void {
  if (!vaultDir) return
  for (const filename of fs.readdirSync(vaultDir)) {
    if (!filename.endsWith('.md')) continue
    fs.rmSync(path.join(vaultDir, filename), { force: true })
  }
  lastPaths.clear()
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function buildNoteFrontmatter(note: NoteRow): string {
  return ['---', `uuid: ${note.uuid}`, `title: ${note.title}`, '---'].join('\n')
}

/**
 * A filename a person would recognise in Obsidian, derived from the title.
 *
 * Titles are neither unique nor stable, so a slug already claimed by *another*
 * note gains the head of this note's uuid. Renaming therefore moves the file,
 * which `noteVaultWrite` handles the same way tickets handle an id change.
 */
function noteFilename(note: NoteRow): string {
  const slug = note.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled'

  const claimed = [...noteLastPaths].some(
    ([uuid, filename]) => uuid !== note.uuid && filename === `${slug}.md`,
  )
  return claimed ? `${slug}-${note.uuid.slice(0, 8)}.md` : `${slug}.md`
}

/** Writes a note's .md file into `notes/`. Deletes instead if it has gone. */
export function noteVaultWrite(uuid: string): void {
  if (!vaultDir) return

  const rows = runSql('SELECT * FROM notes WHERE uuid = ? LIMIT 1', [uuid]) as NoteRow[]
  const note = rows[0]

  if (!note) {
    noteVaultDelete(uuid)
    return
  }

  const dir = getNotesDir()
  fs.mkdirSync(dir, { recursive: true })

  const filename = noteFilename(note)
  const oldFilename = noteLastPaths.get(uuid)
  if (oldFilename && oldFilename !== filename) {
    fs.rmSync(path.join(dir, oldFilename), { force: true })
  }

  fs.writeFileSync(
    path.join(dir, filename),
    `${buildNoteFrontmatter(note)}\n\n${note.body}`,
    'utf8',
  )
  noteLastPaths.set(uuid, filename)
}

/** Removes a note's .md file using the cached filename. */
export function noteVaultDelete(uuid: string): void {
  if (!vaultDir) return
  const filename = noteLastPaths.get(uuid)
  if (filename) {
    fs.rmSync(path.join(getNotesDir(), filename), { force: true })
    noteLastPaths.delete(uuid)
  }
}
