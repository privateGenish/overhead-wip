import { FocusCard } from '@/components/FocusCard'
import { VisionCard } from '@/components/VisionCard'

export function Home() {
  return (
    <div className="flex h-full gap-4 p-6">
      <div className="flex-1 min-w-0">
        <FocusCard />
      </div>
      <div className="w-72 shrink-0 flex flex-col">
        <VisionCard />
      </div>
    </div>
  )
}
