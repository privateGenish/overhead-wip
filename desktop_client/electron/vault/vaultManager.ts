import fs from 'node:fs'
import path from 'node:path'
import { runSql } from '../db/sqlite'
import type { TicketRow } from '../db/sqlite'

let vaultDir = ''

/** In-memory map of uuid → last written filename (for rename/delete cleanup). */
const lastPaths = new Map<string, string>()

export function initVault(dir: string): void {
  vaultDir = dir
  fs.mkdirSync(dir, { recursive: true })
  rebuildIndex()
}

export function getVaultDir(): string {
  return vaultDir
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

export function __resetVaultForTests(): void {
  vaultDir = ''
  lastPaths.clear()
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

/** Removes all .md files and resets the vault directory. */
export function vaultClear(): void {
  if (!vaultDir) return
  fs.rmSync(vaultDir, { recursive: true, force: true })
  fs.mkdirSync(vaultDir, { recursive: true })
  lastPaths.clear()
}
