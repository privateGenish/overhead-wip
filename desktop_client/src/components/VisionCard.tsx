import { Card } from '@/components/ui/card'
import { SettingEditor } from '@/components/SettingEditor'

export function VisionCard() {
  return (
    <Card className="p-5 gap-5 overflow-y-auto">
      <section className="space-y-1">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">North Star</span>
        <SettingEditor
          settingKey="vision.northStar"
          placeholder="One sentence — what does success look like?"
          editable={false}
        />
      </section>

      <div className="border-t" />

      <section className="space-y-1">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Vision</span>
        <SettingEditor
          settingKey="vision.body"
          placeholder="Core idea, monetization, floating thoughts…"
          editable={false}
        />
      </section>
    </Card>
  )
}
