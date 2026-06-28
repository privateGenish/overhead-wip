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

declare global {
  interface Window {
    db: {
      query:        (sql: string, params?: unknown[]) => Promise<unknown>
      ticket:       (sql: string, params?: unknown[]) => Promise<unknown>
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
