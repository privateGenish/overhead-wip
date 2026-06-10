import fs from 'node:fs'
import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { runSql } from '../db/sqlite'

interface ParsedMarkdown {
  frontmatter: Record<string, string | boolean>
  body: string
}

interface TicketSyncRow {
  uuid: string
  description: string
  updated_at: number
}

let watcher: FSWatcher | null = null

type VaultSyncListener = (uuid: string) => void

function parseFrontmatterValue(value: string): string | boolean {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return trimmed.replace(/^(['"])(.*)\1$/, '$2')
}

export function parseMarkdown(content: string): ParsedMarkdown | null {
  const normalized = content.replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/.exec(normalized)
  if (!match) return null

  const frontmatter: ParsedMarkdown['frontmatter'] = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    if (!key) continue
    frontmatter[key] = parseFrontmatterValue(line.slice(separator + 1))
  }

  return {
    frontmatter,
    body: match[2].replace(/^\r?\n/, ''),
  }
}

function ticketForUuid(uuid: string): TicketSyncRow | null {
  const rows = runSql(
    'SELECT uuid, description, updated_at FROM tickets WHERE uuid = ? LIMIT 1',
    [uuid],
  ) as TicketSyncRow[]
  return rows[0] ?? null
}

export function syncMarkdownToSqlite(
  filename: string,
  uuidOverride?: string,
  onSynced?: VaultSyncListener,
): boolean {
  let stat: fs.Stats
  let content: string

  try {
    stat = fs.statSync(filename)
    if (!stat.isFile()) return false
    content = fs.readFileSync(filename, 'utf8')
  } catch (err) {
    console.warn(`Vault watcher skipped unreadable file: ${filename}`, err)
    return false
  }

  const parsed = parseMarkdown(content)
  if (!parsed) {
    console.warn(`Vault watcher skipped malformed markdown: ${filename}`)
    return false
  }

  const uuid = uuidOverride ?? parsed.frontmatter.uuid
  if (typeof uuid !== 'string' || !uuid.trim()) {
    console.warn(`Vault watcher skipped markdown without uuid: ${filename}`)
    return false
  }

  const description = parsed.body
  if (!description.trim()) return false

  const ticket = ticketForUuid(uuid)
  if (!ticket) {
    console.warn(`Vault watcher could not find ticket for uuid: ${uuid}`)
    return false
  }

  if (stat.mtime.getTime() <= ticket.updated_at) return false
  if (ticket.description === description) return false

  runSql(
    'UPDATE tickets SET description = ?, updated_at = ? WHERE uuid = ?',
    [description, stat.mtime.getTime(), uuid],
  )
  onSynced?.(uuid)
  return true
}

function isMarkdownFile(filename: string): boolean {
  return path.extname(filename).toLowerCase() === '.md'
}

function handleVaultFile(filename: string, onSynced?: VaultSyncListener): void {
  if (!isMarkdownFile(filename)) return
  syncMarkdownToSqlite(filename, undefined, onSynced)
}

export function initVaultWatcher(
  vaultDir: string,
  onSynced?: VaultSyncListener,
): FSWatcher {
  void stopVaultWatcher()
  watcher = watch(vaultDir, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 25,
    },
    ignored: (filename, stats) => {
      if (!stats?.isFile()) return false
      return !isMarkdownFile(filename)
    },
  })
  watcher.on('add', (filename) => handleVaultFile(filename, onSynced))
  watcher.on('change', (filename) => handleVaultFile(filename, onSynced))
  watcher.on('error', (err) => {
    console.warn('Vault watcher error:', err)
  })
  return watcher
}

export async function stopVaultWatcher(): Promise<void> {
  const active = watcher
  watcher = null
  if (active) await active.close()
}
