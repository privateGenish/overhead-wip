export type RelationType = 'relates-to' | 'blocked-by'

export interface TicketRelation {
  uuid: string
  node_a: string
  node_b: string
  type: RelationType
}

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
      relation:     (op: 'add' | 'remove' | 'list', payload: RelationPayload) => Promise<unknown>
      onVaultTicketUpdated?: (callback: (ticketUuid: string) => void) => () => void
    }
  }
}

export {}
