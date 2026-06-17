import type { TicketRelation } from '@/types/electron'

const COL_STEP = 220  // horizontal gap between relates-to siblings
const ROW_STEP = 140  // vertical gap between blocker and blocked

/**
 * Given a cluster's ticket uuids and the relations among them, return
 * { [ticketUuid]: {x, y} } using a BFS layout:
 * - blocked-by => vertical (blocker on top, blocked below)
 * - relates-to => horizontal (side by side)
 * Guards cycles with a visited set.
 */
export function layoutCluster(
  uuids: string[],
  relations: TicketRelation[],
  origin: { x: number; y: number },
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}

  // Build directed adjacency: source → [{ target, dx, dy }]
  const adj = new Map<string, { target: string; dx: number; dy: number }[]>()

  for (const uuid of uuids) adj.set(uuid, [])

  for (const rel of relations) {
    if (!adj.has(rel.node_a) || !adj.has(rel.node_b)) continue

    if (rel.type === 'blocked-by') {
      // node_a = blocked, node_b = blocker — blocker is ABOVE, blocked is BELOW
      adj.get(rel.node_b)!.push({ target: rel.node_a, dx: 0, dy: ROW_STEP })
      adj.get(rel.node_a)!.push({ target: rel.node_b, dx: 0, dy: -ROW_STEP })
    } else {
      // relates-to: horizontal (side by side)
      adj.get(rel.node_a)!.push({ target: rel.node_b, dx: COL_STEP, dy: 0 })
      adj.get(rel.node_b)!.push({ target: rel.node_a, dx: -COL_STEP, dy: 0 })
    }
  }

  const anchor = uuids[0]
  if (!anchor) return positions

  positions[anchor] = { x: origin.x, y: origin.y }

  const visited = new Set<string>([anchor])
  const queue: string[] = [anchor]

  // Track sibling offsets to avoid overlap
  const childCounts = new Map<string, number>()

  while (queue.length) {
    const current = queue.shift()!
    const edges = adj.get(current) ?? []
    const pos = positions[current]

    let siblingIdx = 0
    for (const { target, dx, dy } of edges) {
      if (visited.has(target)) continue
      visited.add(target)

      // Spread siblings perpendicularly to avoid overlap:
      // vertical hops (dy≠0) → spread horizontally; horizontal hops → spread vertically
      const spreadX = dy !== 0 ? siblingIdx * COL_STEP : 0
      const spreadY = dx !== 0 ? siblingIdx * ROW_STEP : 0

      const count = childCounts.get(current) ?? 0
      childCounts.set(current, count + 1)
      siblingIdx++

      positions[target] = {
        x: pos.x + dx + spreadX,
        y: pos.y + dy + spreadY,
      }
      queue.push(target)
    }
  }

  // Place any isolated uuids that weren't reached
  let orphanY = origin.y
  for (const uuid of uuids) {
    if (!positions[uuid]) {
      positions[uuid] = { x: origin.x + COL_STEP * 3, y: orphanY }
      orphanY += ROW_STEP
    }
  }

  return positions
}
