/**
 * Project context for LLMs — the vision, handed to whoever is doing the work.
 *
 * The point is steering on judgment calls. An agent working an Execute or
 * Explore ticket constantly hits thin decisions the ticket text alone does not
 * settle, and resolves them by its own defaults. The user has usually already
 * written down what matters, in the Vision tab, where they would write it
 * anyway — this makes that writing reachable so the decision goes their way
 * instead.
 *
 * Delivery is a method the agent calls, deliberately, rather than context
 * stapled onto every ticket read: ticket responses stay lean, and the tool
 * description is what makes an agent reach for this before deciding.
 */

import { runSql } from '../db/sqlite'
import { getActiveProject } from '../project/projectManager'

export interface BridgeProjectContext {
  project: { uuid: string; name: string; prefix: string } | null
  /** One sentence: what success looks like. Empty when unwritten. */
  northStar: string
  /** The longer statement — core idea, constraints, what matters. */
  vision: string
}

function setting(key: string): string {
  const rows = runSql('SELECT value FROM settings WHERE key = ?', [key]) as { value: string }[]
  return rows[0]?.value ?? ''
}

/**
 * Returns the active project's stated intent.
 *
 * The envelope is shaped to grow: conventions, constraints and a glossary all
 * belong here eventually, and adding them must not be a breaking change, so
 * callers get an object rather than a bare string.
 */
export function getProjectContext(): BridgeProjectContext {
  const active = getActiveProject()
  return {
    project: active
      ? { uuid: active.uuid, name: active.name, prefix: active.prefix }
      : null,
    northStar: setting('vision.northStar'),
    vision: setting('vision.body'),
  }
}
