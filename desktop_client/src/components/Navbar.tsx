import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconUser } from '@tabler/icons-react'
import { Archive, FolderOpen, Settings } from 'lucide-react'

const NAV_GROUPS = [
  ['Home', 'Product', 'Explore', 'Execute'],
  ['Backlog', 'All', 'Graph'],
]

interface NavbarProps {
  active: string
  onSelect: (tab: string) => void
  /**
   * The open project's name. Optional only because the shell reads it over
   * IPC — the fallback covers the frame before that answer arrives.
   */
  projectName?: string
}

export function Navbar({ active, onSelect, projectName }: NavbarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-background">
      {/* Tab groups */}
      <div className="flex items-center gap-2">
        {NAV_GROUPS.map((group, gi) => (
          <div
            key={gi}
            className="flex items-center gap-1 bg-muted rounded-lg px-1 py-1"
          >
            {group.map((label) => (
              <button
                key={label}
                onClick={() => onSelect(label)}
                className={`px-3 py-1 text-sm rounded-md transition-all cursor-pointer ${
                  active === label
                    ? 'bg-background shadow-sm text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        <button className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          Notes
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline">
                <IconUser /> {projectName ?? 'No project'}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onSelect('Projects')}>
              <FolderOpen className="h-4 w-4" />
              Projects
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSelect('Archived')}>
              <Archive className="h-4 w-4" />
              Archived Tickets
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSelect('Settings')}>
              <Settings className="h-4 w-4" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
