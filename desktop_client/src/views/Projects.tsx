import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { switchToProject } from '@/lib/projectSwitch'
import type { Project } from '@/types/electron'

interface ProjectsProps {
  /** The project currently open, or null when none is. */
  activeProject: Project | null
  /**
   * Called once a switch has completed. The shell remounts its tree on the
   * project's uuid — this view does not, and must not, try to refresh in place.
   */
  onEntered: (project: Project) => void
  /** Called after a create/rename/delete, so the shell can re-read its copy. */
  onRegistryChanged: () => void
}

/**
 * The projects launcher.
 *
 * Reached from the navbar's project dropdown. The dropdown is not the switcher
 * — this screen is: it lists every project, and selecting one enters it.
 */
export function Projects({ activeProject, onEntered, onRegistryChanged }: ProjectsProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)

  const reload = useCallback(async () => {
    setProjects(await window.projects.list())
  }, [])

  useEffect(() => {
    let alive = true
    void window.projects.list().then((list) => {
      if (!alive) return
      setProjects(list)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  async function handleEnter(project: Project) {
    if (busy || project.uuid === activeProject?.uuid) return
    setBusy(true)
    setError(null)
    try {
      onEntered(await switchToProject(project.uuid))
    } catch (err) {
      setError(readableError(err))
      setBusy(false)
    }
  }

  async function handleCreate(name: string, prefix: string): Promise<string | null> {
    try {
      await window.projects.create(name, prefix)
      await reload()
      onRegistryChanged()
      return null
    } catch (err) {
      return readableError(err)
    }
  }

  async function handleRename(project: Project, name: string): Promise<string | null> {
    try {
      await window.projects.rename(project.uuid, name)
      await reload()
      onRegistryChanged()
      setRenaming(null)
      return null
    } catch (err) {
      return readableError(err)
    }
  }

  async function handleDelete(project: Project) {
    setBusy(true)
    try {
      await window.projects.remove(project.uuid)
      await reload()
      onRegistryChanged()
      setDeleting(null)
    } catch (err) {
      setError(readableError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl flex flex-col gap-6 p-8">
        <div>
          <h2 className="text-xl font-semibold mb-1">Projects</h2>
          <p className="text-sm text-muted-foreground">
            Each project keeps its own tickets and its own vault. One is open at a time —
            selecting another reloads the app into it.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((project) => (
              <ProjectRow
                key={project.uuid}
                project={project}
                isActive={project.uuid === activeProject?.uuid}
                isOnly={projects.length <= 1}
                disabled={busy}
                onEnter={() => void handleEnter(project)}
                onRename={() => setRenaming(project)}
                onDelete={() => setDeleting(project)}
              />
            ))}
          </div>
        )}

        <CreateProject onCreate={handleCreate} />
      </div>

      {/* Both dialogs mount only while they have a project, so their state is
          seeded at mount rather than resynced by an effect. */}
      {renaming && (
        <RenameDialog
          key={renaming.uuid}
          project={renaming}
          onClose={() => setRenaming(null)}
          onRename={handleRename}
        />
      )}

      {deleting && (
        <DeleteDialog
          project={deleting}
          busy={busy}
          onClose={() => setDeleting(null)}
          onDelete={(project) => void handleDelete(project)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface ProjectRowProps {
  project: Project
  isActive: boolean
  isOnly: boolean
  disabled: boolean
  onEnter: () => void
  onRename: () => void
  onDelete: () => void
}

function ProjectRow({
  project, isActive, isOnly, disabled, onEnter, onRename, onDelete,
}: ProjectRowProps) {
  // Deleting the project you are standing in would close the database the
  // views are reading from, and deleting the last one would leave the app with
  // nothing to open. Both are refused here rather than recovered from.
  const blockedReason = isActive
    ? 'Open another project first — the one you are in cannot be deleted.'
    : isOnly
      ? 'The last project cannot be deleted.'
      : null

  return (
    <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{project.prefix}</span>
          {isActive && <Badge variant="secondary">Active</Badge>}
        </div>
        <p className="text-sm font-medium mt-1 truncate">{project.name}</p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-label={`Open ${project.name}`}
          disabled={disabled || isActive}
          onClick={onEnter}
        >
          <FolderOpen className="size-3.5" />
          Open
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Rename ${project.name}`}
          disabled={disabled}
          onClick={onRename}
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${project.name}`}
          title={blockedReason ?? undefined}
          disabled={disabled || blockedReason !== null}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function CreateProject({ onCreate }: { onCreate: (name: string, prefix: string) => Promise<string | null> }) {
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ready = name.trim() !== '' && prefix.trim() !== ''

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    const failure = await onCreate(name.trim(), prefix.trim())
    setError(failure)
    setBusy(false)
    if (!failure) {
      setName('')
      setPrefix('')
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-dashed p-4 flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">New project</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          The prefix opens every ticket id in this project — <span className="font-mono">OVH-001</span>.
          It cannot be changed later.
        </p>
      </div>

      <div className="flex items-end gap-2">
        <label className="flex-1 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Name</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Overhead"
          />
        </label>
        <label className="w-28 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Prefix</span>
          <Input
            value={prefix}
            onChange={(event) => setPrefix(event.target.value.toUpperCase())}
            placeholder="OVH"
            className="font-mono"
          />
        </label>
        <Button type="submit" size="sm" disabled={!ready || busy}>
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Rename / delete
// ---------------------------------------------------------------------------

interface RenameDialogProps {
  project: Project
  onClose: () => void
  onRename: (project: Project, name: string) => Promise<string | null>
}

function RenameDialog({ project, onClose, onRename }: RenameDialogProps) {
  const [name, setName] = useState(project.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(await onRename(project, name.trim()))
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              Only the name changes. The prefix <span className="font-mono">{project.prefix}</span> is
              fixed — every existing ticket id and vault mention depends on it.
            </DialogDescription>
          </DialogHeader>

          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Project name"
          />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />} disabled={busy}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface DeleteDialogProps {
  project: Project
  busy: boolean
  onClose: () => void
  onDelete: (project: Project) => void
}

function DeleteDialog({ project, busy, onClose, onDelete }: DeleteDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete “{project.name}”?</DialogTitle>
          <DialogDescription>
            This deletes the project's directory from disk — every ticket in its database and
            every markdown file in its vault. There is no way to recover them after confirmation.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={busy}>
            Cancel
          </DialogClose>
          <Button variant="destructive" onClick={() => onDelete(project)} disabled={busy}>
            {busy ? 'Deleting…' : 'Yes, delete it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Electron re-throws a main-process error as
 * `Error invoking remote method 'project:create': Error: <message>`. The
 * message after the last plumbing prefix is the one written for a human —
 * show that, and never let a rejected promise disappear silently.
 */
function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const unwrapped = /Error:\s*(.+)$/.exec(raw)?.[1] ?? raw
  return unwrapped.trim() || 'Something went wrong.'
}
