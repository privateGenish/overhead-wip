import type { TicketRelation } from '@/types/electron'

class RelationsClient {
  /** Link two tickets symmetrically. Order doesn't matter — canonical ordering is enforced by the API. */
  async relate(node_a: string, node_b: string): Promise<TicketRelation> {
    return window.db.relation('add', { type: 'relates-to', node_a, node_b }) as Promise<TicketRelation>
  }

  /** Mark `blocked` as blocked by `blocker`. node_a = blocked, node_b = blocker. */
  async blockBy(blocked: string, blocker: string): Promise<TicketRelation> {
    return window.db.relation('add', { type: 'blocked-by', node_a: blocked, node_b: blocker }) as Promise<TicketRelation>
  }

  async remove(uuid: string): Promise<void> {
    await window.db.relation('remove', { uuid })
  }

  async list(ticketUuid: string): Promise<TicketRelation[]> {
    return window.db.relation('list', { ticketUuid }) as Promise<TicketRelation[]>
  }

  async listAll(): Promise<TicketRelation[]> {
    return window.db.relation('listAll', {}) as Promise<TicketRelation[]>
  }
}

export const relationsClient = new RelationsClient()
