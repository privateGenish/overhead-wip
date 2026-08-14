// @vitest-environment jsdom
/**
 * The launcher, and the switch sequence it drives.
 *
 * The ordering test is the one that matters: the main process cannot drain the
 * renderer's debounced writes, so a switch that reaches `project:switch` before
 * `flushAll()` has landed silently drops whatever was being typed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** Every step of the switch sequence appends here, in the order it ran. */
const steps = vi.hoisted(() => [] as string[])

vi.mock('@/lib/persistQueue', () => ({
  persistQueue: {
    flushAll: async () => { steps.push('flushAll') },
  },
}))

vi.mock('@/lib/ticketStore', () => ({
  disposeTicketStore: () => { steps.push('disposeTicketStore') },
  initTicketStore: () => { steps.push('initTicketStore') },
}))

import { Projects } from './Projects'
import type { Project } from '@/types/electron'

const alpha: Project = { uuid: 'u-alpha', name: 'Alpha', prefix: 'ALP', created_at: 1 }
const beta: Project = { uuid: 'u-beta', name: 'Beta', prefix: 'BET', created_at: 2 }

interface ProjectsApi {
  list: () => Promise<Project[]>
  active: () => Promise<Project | null>
  create: (name: string, prefix: string) => Promise<Project>
  rename: (uuid: string, name: string) => Promise<Project>
  remove: (uuid: string) => Promise<{ uuid: string }>
  switch: (uuid: string) => Promise<Project>
}

function installProjectsApi(overrides: Partial<ProjectsApi> = {}): ProjectsApi {
  const api: ProjectsApi = {
    list: async () => [alpha, beta],
    active: async () => alpha,
    create: async () => beta,
    rename: async () => beta,
    remove: async (uuid) => ({ uuid }),
    switch: async (uuid) => {
      steps.push(`switch:${uuid}`)
      return uuid === beta.uuid ? beta : alpha
    },
    ...overrides,
  }
  ;(window as unknown as { projects: ProjectsApi }).projects = api
  return api
}

function renderLauncher(props: Partial<React.ComponentProps<typeof Projects>> = {}) {
  const onEntered = vi.fn()
  const onRegistryChanged = vi.fn()
  render(
    <Projects
      activeProject={alpha}
      onEntered={onEntered}
      onRegistryChanged={onRegistryChanged}
      {...props}
    />,
  )
  return { onEntered, onRegistryChanged }
}

describe('Projects launcher', () => {
  beforeEach(() => {
    steps.length = 0
    installProjectsApi()
  })

  it('lists every project with its prefix', async () => {
    renderLauncher()
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('ALP')).toBeInTheDocument()
    expect(screen.getByText('BET')).toBeInTheDocument()
  })

  it('marks the active project and offers no way to re-open it', async () => {
    renderLauncher()
    expect(await screen.findByText('Active')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Alpha' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open Beta' })).toBeEnabled()
  })

  it('refuses to delete the active project, and allows deleting another', async () => {
    renderLauncher()
    await screen.findByText('Alpha')
    expect(screen.getByRole('button', { name: 'Delete Alpha' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete Beta' })).toBeEnabled()
  })

  it('refuses to delete the last remaining project', async () => {
    installProjectsApi({ list: async () => [beta] })
    renderLauncher({ activeProject: null })
    await screen.findByText('Beta')
    expect(screen.getByRole('button', { name: 'Delete Beta' })).toBeDisabled()
  })

  it('surfaces a duplicate-name failure instead of swallowing it', async () => {
    installProjectsApi({
      create: async () => {
        throw new Error(
          `Error invoking remote method 'project:create': Error: A project named "Alpha" or using prefix "ALP" already exists.`,
        )
      },
    })
    const { onRegistryChanged } = renderLauncher()
    await screen.findByText('Alpha')

    await userEvent.type(screen.getByPlaceholderText('Overhead'), 'Alpha')
    await userEvent.type(screen.getByPlaceholderText('OVH'), 'alp')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('A project named "Alpha" or using prefix "ALP" already exists.')
    expect(onRegistryChanged).not.toHaveBeenCalled()
  })

  it('uppercases the prefix as it is typed', async () => {
    renderLauncher()
    await screen.findByText('Alpha')
    const prefix = screen.getByPlaceholderText('OVH')
    await userEvent.type(prefix, 'shop')
    expect(prefix).toHaveValue('SHOP')
  })

  it('creates a project and tells the shell the registry moved', async () => {
    const { onRegistryChanged } = renderLauncher()
    await screen.findByText('Alpha')

    await userEvent.type(screen.getByPlaceholderText('Overhead'), 'Shop')
    await userEvent.type(screen.getByPlaceholderText('OVH'), 'shop')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onRegistryChanged).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('flushes, disposes, switches and rebuilds — in that order', async () => {
    const { onEntered } = renderLauncher()
    await screen.findByText('Beta')

    await userEvent.click(screen.getByRole('button', { name: 'Open Beta' }))

    await waitFor(() => expect(onEntered).toHaveBeenCalledWith(beta))
    expect(steps).toEqual([
      'flushAll',
      'disposeTicketStore',
      `switch:${beta.uuid}`,
      'initTicketStore',
    ])
  })
})
