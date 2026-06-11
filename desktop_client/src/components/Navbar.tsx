import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconUser } from '@tabler/icons-react'
import { Archive, PlusIcon, Settings } from 'lucide-react'

const NAV_GROUPS = [
  ['Home', 'Product', 'Explore', 'Execute'],
  ['Backlog', 'All'],
]

interface NavbarProps {
  active: string
  onSelect: (tab: string) => void
}

export function Navbar({ active, onSelect }: NavbarProps) {
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
        <Button variant="outline" size="icon">
          <PlusIcon />
        </Button>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        <button className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          Notes
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <IconUser /> Project Name
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
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
