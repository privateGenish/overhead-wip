/**
 * Electron re-throws a main-process error as
 * `Error invoking remote method 'project:create': Error: <message>`. The
 * message after the last plumbing prefix is the one written for a human —
 * show that, and never let a rejected promise disappear silently.
 */
export function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const unwrapped = /Error:\s*(.+)$/.exec(raw)?.[1] ?? raw
  return unwrapped.trim() || 'Something went wrong.'
}
