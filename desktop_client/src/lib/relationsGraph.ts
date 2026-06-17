import type { TicketRelation } from '@/types/electron'

/**
 * Returns clusters of ticket uuids that are transitively related,
 * each cluster size >= 2. Pass only NON-archived relations/uuids.
 */
export function findComponents(
  relations: TicketRelation[],
  allowedUuids: Set<string>,
): string[][] {
  const adj = new Map<string, string[]>()

  for (const rel of relations) {
    if (!allowedUuids.has(rel.node_a) || !allowedUuids.has(rel.node_b)) continue
    if (!adj.has(rel.node_a)) adj.set(rel.node_a, [])
    if (!adj.has(rel.node_b)) adj.set(rel.node_b, [])
    adj.get(rel.node_a)!.push(rel.node_b)
    adj.get(rel.node_b)!.push(rel.node_a)
  }

  const visited = new Set<string>()
  const clusters: string[][] = []

  for (const uuid of allowedUuids) {
    if (visited.has(uuid) || !adj.has(uuid)) continue
    const cluster: string[] = []
    const queue = [uuid]
    visited.add(uuid)
    while (queue.length) {
      const current = queue.shift()!
      cluster.push(current)
      for (const neighbor of adj.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
    if (cluster.length >= 2) clusters.push(cluster)
  }

  return clusters
}

export type RelationChain = string[]

/**
 * Find all unique simple paths starting from `startUuid` through the relation
 * graph. Each path in the result has at least two nodes (one hop).
 *
 * - `relates-to` edges are traversed in both directions (symmetric).
 * - `blocked-by` edges are traversed in both directions too, so you can walk
 *   "this ticket blocks X" just as easily as "X is blocked by this ticket".
 *
 * Branching paths produce separate entries:
 *   1→2→3→4  and  1→2→3→5  are both returned.
 * Sub-paths are also included:
 *   1→2  and  1→2→3  appear alongside the maximal paths above.
 */
export function findAllChains(
  startUuid: string,
  relations: TicketRelation[],
): RelationChain[] {
  const adj = new Map<string, string[]>()

  function link(a: string, b: string) {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a)!.push(b)
  }

  for (const rel of relations) {
    link(rel.node_a, rel.node_b)
    link(rel.node_b, rel.node_a)
  }

  const chains: RelationChain[] = []
  const visited = new Set<string>([startUuid])

  function dfs(current: string, path: RelationChain) {
    const neighbors = adj.get(current) ?? []
    for (const next of neighbors) {
      if (visited.has(next)) continue
      visited.add(next)
      path.push(next)
      chains.push([...path])
      dfs(next, path)
      path.pop()
      visited.delete(next)
    }
  }

  dfs(startUuid, [startUuid])
  return chains
}
