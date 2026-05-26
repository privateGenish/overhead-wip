import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { ticketStore } from '@/lib/ticketStore'

const SECTIONS = ['General', 'Account', 'Notifications', 'Admin Control', 'About']

function AdminControl() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleDeleteAll() {
    setBusy(true)
    await ticketStore.deleteAll()
    setBusy(false)
    setOpen(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Admin Control</h2>
        <p className="text-sm text-muted-foreground">Destructive actions — use with caution.</p>
      </div>

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

const SECTION_CONTENT: Record<string, React.ReactNode> = {
  'Admin Control': <AdminControl />,
}

function DefaultSection({ name }: { name: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">{name}</h2>
      <p className="text-sm text-muted-foreground">{name} settings will go here.</p>
    </div>
  )
}

export function Settings() {
  const [active, setActive] = useState('General')

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
        {SECTION_CONTENT[active] ?? <DefaultSection name={active} />}
      </div>
    </div>
  )
}
