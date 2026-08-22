import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { SettingEditor } from '@/components/SettingEditor'
import { generalClient } from '@/lib/generalClient'
import { benchClient } from '@/lib/benchClient'
import { noteClient, type NoteData } from '@/lib/noteClient'

/** Both opt-in, per project — read and written from Settings → General. */
export const HOME_SHOW_NORTH_STAR_KEY = 'home.showNorthStar'
export const HOME_SHOW_VISION_KEY = 'home.showVision'

function useHomeToggle(key: string, fallback: boolean): boolean {
  const [value, setValue] = useState(fallback)
  useEffect(() => {
    let alive = true
    void generalClient.settingGet(key).then((v) => { if (alive && v !== null) setValue(v === 'true') })
    return () => { alive = false }
  }, [key])
  return value
}

function usePinnedNotes(): NoteData[] {
  const [notes, setNotes] = useState<NoteData[]>([])
  useEffect(() => {
    let alive = true
    void benchClient.listNoteSlots()
      .then((slots) => Promise.all(slots.map((s) => noteClient.get(s.uuid))))
      .then((loaded) => { if (alive) setNotes(loaded.filter((n): n is NoteData => n !== null)) })
    return () => { alive = false }
  }, [])
  return notes
}

interface RailProps {
  onOpenNotes: () => void
}

/**
 * What you read, not what you do — North Star and Vision are opt-in (Settings
 * → General) so a document meant for thinking doesn't crowd the bench by
 * default, and up to 2 pinned notes. Renders nothing when every section is
 * off, so Home doesn't reserve a dead column.
 */
export function Rail({ onOpenNotes }: RailProps) {
  const showNorthStar = useHomeToggle(HOME_SHOW_NORTH_STAR_KEY, true)
  const showVision = useHomeToggle(HOME_SHOW_VISION_KEY, false)
  const pinnedNotes = usePinnedNotes()

  if (!showNorthStar && !showVision && pinnedNotes.length === 0) return null

  return (
    <Card className="w-72 shrink-0 gap-5 overflow-y-auto p-5">
      {showNorthStar && (
        <section className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">North Star</span>
          <SettingEditor
            settingKey="vision.northStar"
            placeholder="One sentence — what does success look like?"
            editable={false}
          />
        </section>
      )}

      {showNorthStar && showVision && <div className="border-t" />}

      {showVision && (
        <section className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Vision</span>
          <SettingEditor
            settingKey="vision.body"
            placeholder="Core idea, monetization, floating thoughts…"
            editable={false}
          />
        </section>
      )}

      {(showNorthStar || showVision) && pinnedNotes.length > 0 && <div className="border-t" />}

      {pinnedNotes.length > 0 && (
        <section className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Notes</span>
          <div className="flex flex-col gap-0.5">
            {pinnedNotes.map((note) => (
              <button
                key={note.uuid}
                onClick={onOpenNotes}
                className="flex items-center gap-2 rounded px-1 py-1 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground/60" />
                <span className="truncate">{note.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </Card>
  )
}
