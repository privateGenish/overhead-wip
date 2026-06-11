import { SettingEditor } from '@/components/SettingEditor'

export function Vision() {
  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="max-w-2xl mx-auto space-y-6">

        <section>
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">North Star</span>
          <SettingEditor
            settingKey="vision.northStar"
            placeholder="One sentence — what does success look like?"
            className="mt-1"
          />
        </section>

        <div className="border-t" />

        <section>
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Vision</span>
          <SettingEditor
            settingKey="vision.body"
            placeholder="Core idea, monetization, floating thoughts…"
            className="mt-1"
          />
        </section>

      </div>
    </div>
  )
}
