import type { GraphView, GraphViewNode, GraphViewEdge } from '@/types/electron'

class GraphClient {
  private g(op: string, payload?: unknown): Promise<unknown> {
    return window.db.graph(op, payload)
  }

  listViews(): Promise<GraphView[]> {
    return this.g('view:list') as Promise<GraphView[]>
  }

  createView(name: string): Promise<GraphView> {
    return this.g('view:create', { name }) as Promise<GraphView>
  }

  renameView(uuid: string, name: string): Promise<void> {
    return this.g('view:rename', { uuid, name }) as Promise<void>
  }

  deleteView(uuid: string): Promise<void> {
    return this.g('view:delete', { uuid }) as Promise<void>
  }

  listNodes(viewUuid: string): Promise<GraphViewNode[]> {
    return this.g('node:list', { viewUuid }) as Promise<GraphViewNode[]>
  }

  upsertNode(viewUuid: string, ticketUuid: string, x: number, y: number): Promise<void> {
    return this.g('node:upsert', { viewUuid, ticketUuid, x, y }) as Promise<void>
  }

  removeNode(viewUuid: string, ticketUuid: string): Promise<void> {
    return this.g('node:remove', { viewUuid, ticketUuid }) as Promise<void>
  }

  listEdges(viewUuid: string): Promise<GraphViewEdge[]> {
    return this.g('edge:list', { viewUuid }) as Promise<GraphViewEdge[]>
  }

  createEdge(viewUuid: string, sourceUuid: string, targetUuid: string, sourceHandle?: string, targetHandle?: string): Promise<GraphViewEdge> {
    return this.g('edge:create', { viewUuid, sourceUuid, targetUuid, sourceHandle, targetHandle }) as Promise<GraphViewEdge>
  }

  removeEdge(uuid: string): Promise<void> {
    return this.g('edge:remove', { uuid }) as Promise<void>
  }
}

export const graphClient = new GraphClient()
