/**
 * Entering a project — the one sequence that swaps the app's data underneath it.
 *
 * The order below is binding. The main process cannot drain the renderer's
 * debounced write queue, so the renderer has to land its own pending edits
 * *before* asking main to close the database they belong to; and the ticket
 * store has to be released before the swap, then rebuilt against the new
 * database afterwards.
 *
 * This function deliberately stops short of the last step. Invalidating the
 * views is the caller's job: every mounted view holds state derived from the
 * project that just closed, and the honest fix is to remount the tree keyed on
 * the returned project's uuid rather than reconcile stale state in place.
 */

import { persistQueue } from '@/lib/persistQueue'
import { disposeTicketStore, initTicketStore } from '@/lib/ticketStore'
import type { Project } from '@/types/electron'

/**
 * Flushes, tears down, switches, rebuilds — in that order.
 *
 * @returns the newly-opened project. Remount the app tree on its uuid.
 * @throws if the main process refuses the switch; the old store is *not*
 * restored, so a caller that swallows this leaves the app without a store.
 */
export async function switchToProject(uuid: string): Promise<Project> {
  await persistQueue.flushAll()
  disposeTicketStore()
  const project = await window.projects.switch(uuid)
  initTicketStore()
  return project
}
