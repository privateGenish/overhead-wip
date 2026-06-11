import { useState } from 'react'
import { TicketView } from '@/components/TicketView'
import { Vision } from '@/views/Vision'

type ProductTab = 'Features' | 'Vision'

export function Product() {
  const [tab, setTab] = useState<ProductTab>('Features')

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-6 pt-4 pb-0">
        {(['Features', 'Vision'] as ProductTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm rounded-md transition-all cursor-pointer ${
              tab === t
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'Features' ? (
          <TicketView filter={(t) => t.type === 'Feature'} fixedType="Feature" />
        ) : (
          <Vision />
        )}
      </div>
    </div>
  )
}
