/**
 * The governed bridge (Door 2).
 *
 * `dispatchBridge(method, args)` is the single entry point for all external
 * transports — HTTP, unix socket, MCP, CLI. No raw SQL crosses this boundary:
 * callers name a method and pass data; the gate handles auth/throttle; each
 * method validates its own input with Zod.
 *
 * There is no IPC channel here — the bridge does not touch the renderer.
 * The renderer has Door 1 (window.db / raw SQL). External processes reach the
 * bridge via whatever transport is stood up on top of dispatchBridge.
 */

import { authorize, throttle, type BridgeContext } from './gate'
import { createTicket, getTicket, listTickets, updateTicket, deleteTicket } from './tickets'
import { relate, blockBy, unrelate, listRelations } from './relations'
import {
  listViews, createView, renameView, deleteView,
  listViewNodes, addViewNode, removeViewNode,
  listViewEdges, createViewEdge, removeViewEdge,
} from './views'

/** The complete public method surface exposed to external callers. */
const methods = {
  createTicket,
  getTicket,
  listTickets,
  updateTicket,
  deleteTicket,
  relate,
  blockBy,
  unrelate,
  listRelations,
  listViews,
  createView,
  renameView,
  deleteView,
  listViewNodes,
  addViewNode,
  removeViewNode,
  listViewEdges,
  createViewEdge,
  removeViewEdge,
} as const

export type BridgeMethod = keyof typeof methods

/**
 * Runs a bridge method through the gate. Single entry point for every caller
 * and transport. Each method validates its own input.
 */
export function dispatchBridge(method: string, args: unknown, ctx: BridgeContext = {}): unknown {
  const fn = (methods as Record<string, ((args: unknown) => unknown) | undefined>)[method]
  if (!fn) throw new Error(`bridge: unknown method "${method}".`)
  authorize(method, ctx)
  throttle(method, ctx)
  return fn(args)
}
