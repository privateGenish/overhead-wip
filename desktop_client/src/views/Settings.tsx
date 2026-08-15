import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { AccountAvatar } from '@/components/AccountAvatar'
import { getTicketStore } from '@/lib/ticketStore'
import { getGlobalSetting, setGlobalSetting } from '@/lib/appSettings'
import { setTheme, useThemeChoice, THEME_CHOICES, type ThemeChoice } from '@/lib/theme'

/**
 * Notifications used to sit in this list. It was removed rather than left
 * empty — the app has nothing to notify anyone about, and a section that will
 * never be filled reads as unfinished work forever.
 */
const SECTIONS = ['General', 'Account', 'Admin Control', 'About'] as const
type Section = (typeof SECTIONS)[number]

/** Shared frame so every section leads the same way. */
function SectionHeader({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground">{blurb}</p>
    </div>
  )
}

/** A titled row with its control on the right — the shape of every setting. */
function SettingRow({
  label, hint, children,
}: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4 flex items-center justify-between gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const THEME_LABELS: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

/**
 * The theme switch — the first way to reach the light/dark palettes that have
 * been sitting in `index.css` all along.
 *
 * "System" is a subscription, not a snapshot: pick it and the app follows the
 * OS as it changes, without a relaunch.
 */
function ThemeToggle() {
  const choice = useThemeChoice()

  return (
    <div role="group" aria-label="Theme" className="flex items-center gap-1 rounded-lg bg-muted p-1">
      {THEME_CHOICES.map((option) => (
        <button
          key={option}
          aria-pressed={choice === option}
          onClick={() => { void setTheme(option) }}
          className={`px-3 py-1 text-sm rounded-md transition-all cursor-pointer ${
            choice === option
              ? 'bg-background shadow-sm text-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {THEME_LABELS[option]}
        </button>
      ))}
    </div>
  )
}

function General() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="General" blurb="How Overhead looks and behaves." />
      <SettingRow
        label="Appearance"
        hint="System follows your operating system as it changes."
      >
        <ThemeToggle />
      </SettingRow>
    </div>
  )
}

/**
 * Account — a name and the avatar drawn from it.
 *
 * Global, not per-project: one identity across the whole app, stored beside the
 * active-project pointer rather than inside any single project.
 *
 * The name commits on blur rather than on every keystroke. It is a field you
 * fill in once and leave, so there is nothing for a debounce to save.
 */
function Account() {
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    void getGlobalSetting('account.name').then(setName)
  }, [])

  if (name === null) return null

  function commit(): void {
    const trimmed = (name ?? '').trim()
    setName(trimmed)
    void setGlobalSetting('account.name', trimmed)
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Account" blurb="Who you are, across every project." />

      <div className="rounded-lg border p-4 flex items-center gap-4">
        <AccountAvatar name={name} />
        <div className="min-w-0 flex-1">
          <label htmlFor="account-name" className="text-sm font-medium">Name</label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">
            Your avatar is drawn from it — same name, same mark, every time.
          </p>
          <Input
            id="account-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commit}
            placeholder="Your name"
            className="max-w-xs"
          />
        </div>
      </div>
    </div>
  )
}

function AdminControl() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleDeleteAll() {
    setBusy(true)
    await getTicketStore().deleteAll()
    setBusy(false)
    setOpen(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Admin Control" blurb="Destructive actions — use with caution." />

      <div className="rounded-lg border border-destructive/30 p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Delete all tickets</p>
          <p className="text-xs text-muted-foreground mt-0.5">Permanently removes every ticket from the database. This cannot be undone.</p>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          Delete all
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete all tickets?</DialogTitle>
            <DialogDescription>
              This will permanently delete every ticket in the database. There is no way to recover them after confirmation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={busy}>
              Cancel
            </DialogClose>
            <Button variant="destructive" onClick={handleDeleteAll} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Deliberately empty — the copy is not written yet, and says so plainly. */
function About() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="About" blurb="Version and credits." />
      <div className="rounded-lg border border-dashed p-10 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      </div>
    </div>
  )
}

const SECTION_CONTENT: Record<Section, React.ReactNode> = {
  General: <General />,
  Account: <Account />,
  'Admin Control': <AdminControl />,
  About: <About />,
}

export function Settings() {
  const [active, setActive] = useState<Section>('General')

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <nav className="w-52 shrink-0 border-r p-4 flex flex-col gap-1">
        {SECTIONS.map((section) => (
          <button
            key={section}
            onClick={() => setActive(section)}
            className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors cursor-pointer ${
              active === section
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          >
            {section}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        {SECTION_CONTENT[active]}
      </div>
    </div>
  )
}
