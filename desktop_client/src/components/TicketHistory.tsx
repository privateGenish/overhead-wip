import { useEffect, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { historyClient, type TicketVersion } from '@/lib/historyClient'

/**
 * How many versions the sheet shows. Storage keeps every snapshot — they are
 * small text and this is a single-user app — but a list nobody can scan is not
 * worth rendering, so the *display* is what gets bounded.
 */
export const HISTORY_DISPLAY_LIMIT = 50

interface TicketHistoryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticketUuid: string
  onRestore: (description: string) => void
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function TicketHistory({ open, onOpenChange, ticketUuid, onRestore }: TicketHistoryProps) {
  const [loaded, setLoaded] = useState<{ uuid: string; versions: TicketVersion[] } | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    historyClient.list(ticketUuid).then((rows) => {
      if (!cancelled) setLoaded({ uuid: ticketUuid, versions: rows })
    })
    return () => { cancelled = true }
  }, [open, ticketUuid])

  const loading = !loaded || loaded.uuid !== ticketUuid
  // The newest snapshot is the ticket's current state, not a version to go back
  // to, so it is dropped first; the cap applies to what is left.
  const versions = loading ? [] : loaded.versions.slice(1, 1 + HISTORY_DISPLAY_LIMIT)

  function restore(version: TicketVersion) {
    onRestore(version.description)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-96 max-w-[90vw]">
        <SheetHeader>
          <SheetTitle>Version history</SheetTitle>
          <SheetDescription>
            Saved description snapshots, newest first.
          </SheetDescription>
        </SheetHeader>

        <div className="-mx-4 flex-1 overflow-y-auto px-4">
          {loading ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No versions saved yet.
            </p>
          ) : (
            <ol className="flex flex-col gap-4">
              {versions.map((version, i) => (
                <li key={version.ts} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatTs(version.ts)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => restore(version)}
                    >
                      Restore
                    </Button>
                  </div>
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
                    {version.description}
                  </pre>
                  {i < versions.length - 1 && <Separator />}
                </li>
              ))}
            </ol>
          )}
          {!loading && loaded.versions.length - 1 > HISTORY_DISPLAY_LIMIT && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Showing the {HISTORY_DISPLAY_LIMIT} most recent versions.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
