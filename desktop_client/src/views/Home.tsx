import { Bench } from '@/components/Bench'
import { PendingTray } from '@/components/PendingTray'
import { Rail } from '@/components/Rail'

interface HomeProps {
  onOpenTicket: (uuid: string) => void
  onOpenNotes: () => void
}

/**
 * Home — the re-entry surface. Not a dashboard: a bounded look at what's
 * pinned (the bench, ≤4 tickets) and what frames it (North Star/Vision,
 * opt-in, and up to 2 pinned notes). Nothing here is ordered or sized by how
 * long anything has been sitting.
 *
 * Anything waiting on a decision — AI-proposed ticket drafts — leads, above
 * the bench: decide those first, then get back to what you were doing.
 */
export function Home({ onOpenTicket, onOpenNotes }: HomeProps) {
  return (
    <div className="flex h-full gap-4 overflow-y-auto p-6">
      <div className="min-w-0 flex-1 flex flex-col gap-4">
        <PendingTray />
        <Bench onOpenTicket={onOpenTicket} />
      </div>
      <Rail onOpenNotes={onOpenNotes} />
    </div>
  )
}
