import { SettingEditor } from '@/components/SettingEditor'

/**
 * The project's intent, as a page you think on.
 *
 * It used to be two labelled boxes stacked in a column — a settings form with
 * markdown in it. Product is the hub for high-level thinking (B2), and this is
 * the surface where that thinking gets written down, so it is given the room
 * and the quiet of a document instead.
 *
 * Nothing about the storage changes: both sections are still the same two
 * per-project settings keys, still saved as you type.
 */
export function Vision() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-10 py-14">

        {/* The north star gets the page's opening position and its only
            accent — one sentence you steer by, set like a pull quote. */}
        <section>
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            North Star
          </span>
          <div className="mt-3 border-l-2 border-copper pl-5">
            <SettingEditor
              settingKey="vision.northStar"
              placeholder="One sentence — what does success look like?"
              className="vision-lede"
            />
          </div>
        </section>

        <div className="my-12 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Vision
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* Everything the north star is too short to hold. */}
        <section className="pb-20">
          <SettingEditor
            settingKey="vision.body"
            placeholder="Core idea, monetization, floating thoughts…"
          />
        </section>

      </div>
    </div>
  )
}
