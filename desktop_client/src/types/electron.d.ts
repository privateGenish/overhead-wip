export type RelationType = 'relates-to' | 'blocked-by'

export interface TicketRelation {
  uuid: string
  node_a: string
  node_b: string
  type: RelationType
}

export interface GraphView      { uuid: string; name: string; created_at: number }
export interface GraphViewNode  { ticket_uuid: string; x: number; y: number }
export interface GraphViewEdge  { uuid: string; source_uuid: string; target_uuid: string; source_handle: string | null; target_handle: string | null }

type RelationPayload =
  | { type: RelationType; node_a: string; node_b: string }
  | { uuid: string }
  | { ticketUuid: string }
  | Record<string, never> // listAll takes no payload

export interface Project {
  uuid: string
  name: string
  prefix: string
  created_at: number
}

declare global {
  interface Window {
    /**
     * Optional because it only exists behind the preload bridge — tests and any
     * non-Electron host render without it.
     */
    deepLink?: {
      /** Subscribes to `overhead://` links. Returns an unsubscribe. */
      onOpen: (callback: (url: string) => void) => () => void
    }
    /**
     * Global settings — theme and account, the state that outlives a project
     * switch. Optional for the same reason `deepLink` is: it only exists
     * behind the preload bridge.
     */
    appSettings?: {
      get: (key: string) => Promise<string | null>
      set: (key: string, value: string) => Promise<void>
    }
    projects: {
      list:   () => Promise<Project[]>
      active: () => Promise<Project | null>
      create: (name: string, prefix: string) => Promise<Project>
      rename: (uuid: string, name: string) => Promise<Project>
      remove: (uuid: string) => Promise<{ uuid: string }>
      switch: (uuid: string) => Promise<Project>
      onChanged?: (callback: (project: Project | null) => void) => () => void
    }
    db: {
      query:        (sql: string, params?: unknown[]) => Promise<unknown>
      ticket:       (sql: string, params?: unknown[]) => Promise<unknown>
      note:         (sql: string, params?: unknown[]) => Promise<unknown>
      history:      (ticketUuid: string) => Promise<{ ts: number; description: string }[]>
      historyFlush: (ticketUuid: string) => Promise<void>
      relation:     (op: 'add' | 'remove' | 'list' | 'listAll', payload: RelationPayload) => Promise<unknown>
      graph:        (op: string, payload?: unknown) => Promise<unknown>
      onVaultTicketUpdated?: (callback: (ticketUuid: string) => void) => () => void
      onGraphUpdated?: (callback: () => void) => () => void
    }
  }
}

export {}
