// @vitest-environment jsdom
/**
 * Applying an `overhead://` link.
 *
 * The ordering test is the one that matters: a cross-project link must complete
 * the project switch *before* it looks its target up, because the target lives
 * in the incoming project's database. Resolving first reads the old one and
 * lands on the wrong ticket — or on none, and reports a link as broken when it
 * is not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Project } from '@/types/electron'

/** Every step of a resolution appends here, in the order it ran. */
const steps = vi.hoisted(() => [] as string[])

const alpha: Project = { uuid: 'u-alpha', name: 'Alpha', prefix: 'ALP', created_at: 1 }
const beta: Project = { uuid: 'u-beta', name: 'Beta', prefix: 'BET', created_at: 2 }

vi.mock('@/lib/projectSwitch', () => ({
  switchToProject: async (uuid: string) => {
    steps.push(`switch:${uuid}`)
    return uuid === beta.uuid ? beta : alpha
  },
}))

vi.mock('@/lib/ticketClient', () => ({
  ticketClient: {
    getByHumanId: async (id: string) => {
      steps.push(`ticket:${id}`)
      return id === 'BET-7' ? { uuid: 't-7', id } : null
    },
  },
}))

vi.mock('@/lib/graphClient', () => ({
  graphClient: {
    listViews: async () => {
      steps.push('views')
      return [{ uuid: 'v-1', name: 'View 1', created_at: 0 }]
    },
  },
}))

import { resolveDeepLink } from './deepLinkRouter'

function installProjectsApi(list: Project[] = [alpha, beta]) {
  ;(window as unknown as { projects: unknown }).projects = {
    list: async () => {
      steps.push('list')
      return list
    },
  }
}

describe('resolveDeepLink', () => {
  beforeEach(() => {
    steps.length = 0
    installProjectsApi()
  })

  it('switches project before it resolves the ticket', async () => {
    const outcome = await resolveDeepLink(`overhead://project/${beta.uuid}/ticket/BET-7`, alpha.uuid)

    expect(steps).toEqual(['list', `switch:${beta.uuid}`, 'ticket:BET-7'])
    expect(outcome.entered).toEqual(beta)
    expect(outcome.route).toEqual({ kind: 'ticket', uuid: 't-7' })
    expect(outcome.error).toBeNull()
  })

  it('does not switch when the link names the project already open', async () => {
    const outcome = await resolveDeepLink(`overhead://project/${alpha.uuid}/page/execute`, alpha.uuid)

    expect(steps).toEqual([])
    expect(outcome.entered).toBeNull()
    expect(outcome.route).toEqual({ kind: 'page', page: 'execute' })
  })

  it('switches into a project even when the app has none open', async () => {
    const outcome = await resolveDeepLink(`overhead://project/${beta.uuid}/page/graph`, null)

    expect(steps).toEqual(['list', `switch:${beta.uuid}`])
    expect(outcome.entered).toEqual(beta)
    expect(outcome.route).toEqual({ kind: 'page', page: 'graph' })
  })

  it('refuses a project this machine does not have, without switching', async () => {
    const outcome = await resolveDeepLink('overhead://project/u-missing/page/home', alpha.uuid)

    expect(steps).toEqual(['list'])
    expect(outcome.entered).toBeNull()
    expect(outcome.route).toBeNull()
    expect(outcome.error).toContain('u-missing')
  })

  it('reports a malformed link and stays put', async () => {
    const outcome = await resolveDeepLink('overhead://nonsense', alpha.uuid)

    expect(steps).toEqual([])
    expect(outcome.route).toBeNull()
    expect(outcome.error).not.toBeNull()
  })

  it('lands on home with a message when the ticket id is unknown', async () => {
    const outcome = await resolveDeepLink(`overhead://project/${beta.uuid}/ticket/BET-99`, alpha.uuid)

    expect(steps).toEqual(['list', `switch:${beta.uuid}`, 'ticket:BET-99'])
    expect(outcome.entered).toEqual(beta)
    expect(outcome.route).toEqual({ kind: 'page', page: 'home' })
    expect(outcome.error).toContain('BET-99')
  })

  it('opens a graph view that exists', async () => {
    const outcome = await resolveDeepLink(`overhead://project/${alpha.uuid}/view/v-1`, alpha.uuid)

    expect(steps).toEqual(['views'])
    expect(outcome.route).toEqual({ kind: 'view', viewUuid: 'v-1' })
    expect(outcome.error).toBeNull()
  })

  it('falls back to the graph page when the view is gone', async () => {
    const outcome = await resolveDeepLink(`overhead://project/${alpha.uuid}/view/v-gone`, alpha.uuid)

    expect(outcome.route).toEqual({ kind: 'page', page: 'graph' })
    expect(outcome.error).not.toBeNull()
  })
})
