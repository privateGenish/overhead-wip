/**
 * Turning an `overhead://` link into somewhere to stand.
 *
 * Two orderings are binding here:
 *
 * 1. **Project before route.** A link naming another project switches into it
 *    through the full `closeProject`/`openProject` lifecycle *first*, and only
 *    then resolves what to open — the target lives in the other project's
 *    database, so asking earlier reads the wrong one.
 * 2. **Never nowhere.** A link that cannot be honoured still returns a route
 *    to land on and a sentence explaining why, so a bad link is a message
 *    rather than a blank screen.
 */

import { parseDeepLink, HOME_ROUTE, type Route } from './route'
import { switchToProject } from './projectSwitch'
import { ticketClient } from './ticketClient'
import { graphClient } from './graphClient'
import type { Project } from '@/types/electron'

export interface DeepLinkOutcome {
  /** The project entered, when the link named one other than the active one. */
  entered: Project | null
  /** Where to go, or null to stay put — a link too broken to act on at all. */
  route: Route | null
  /** What to tell the user, or null when the link resolved cleanly. */
  error: string | null
}

/**
 * Resolves a link against the open project, switching first when it names
 * another one.
 *
 * @throws only if the project switch itself fails. The caller is left without a
 * ticket store in that case and must re-read the active project.
 */
export async function resolveDeepLink(
  url: string,
  activeProjectUuid: string | null,
): Promise<DeepLinkOutcome> {
  const parsed = parseDeepLink(url)
  if (!parsed.ok) return { entered: null, route: null, error: parsed.reason }

  const { projectUuid, target } = parsed.link

  let entered: Project | null = null
  if (projectUuid !== activeProjectUuid) {
    const known = (await window.projects.list()).some((p) => p.uuid === projectUuid)
    if (!known) {
      return {
        entered: null,
        route: null,
        error: `That link points at a project this machine does not have (${projectUuid}).`,
      }
    }
    entered = await switchToProject(projectUuid)
  }

  switch (target.kind) {
    case 'page':
      return { entered, route: { kind: 'page', page: target.page }, error: null }

    case 'ticket': {
      const ticket = await ticketClient.getByHumanId(target.ticketId)
      if (!ticket) {
        return { entered, route: HOME_ROUTE, error: `There is no ticket ${target.ticketId} in this project.` }
      }
      return { entered, route: { kind: 'ticket', uuid: ticket.uuid }, error: null }
    }

    case 'view': {
      const views = await graphClient.listViews()
      if (!views.some((view) => view.uuid === target.viewUuid)) {
        return {
          entered,
          route: { kind: 'page', page: 'graph' },
          error: 'That graph view no longer exists — showing the graph instead.',
        }
      }
      return { entered, route: { kind: 'view', viewUuid: target.viewUuid }, error: null }
    }
  }
}
