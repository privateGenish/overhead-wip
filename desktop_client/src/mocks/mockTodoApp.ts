import type { TicketData } from '@/shared/types'

/**
 * The mock JSON "database" — plain `TicketData` objects, exactly the shape
 * `Ticket.load()` consumes. Stands in for persistent storage for now.
 */
export const mockTicketData: TicketData[] = [
  {
    uuid: 'a1b2c3d4-0001-4000-8000-000000000001',
    id: 'MTA-001',
    title: 'Pick a stack',
    type: 'Explore',
    status: { value: 'Open' },
    backlog: false,
    archived: false,
    description:
      '# Pick a stack\n\nDecide the foundation for the Mock Todo App.\n\n- Frontend framework\n- Persistence approach\n- Build tooling',
  },
  {
    uuid: 'a1b2c3d4-0002-4000-8000-000000000002',
    id: 'MTA-002',
    title: 'Sketch the UI',
    type: 'Explore',
    status: { value: 'Open' },
    backlog: false,
    archived: false,
    description: 'Rough out the main screens before building anything.',
  },
  {
    uuid: 'a1b2c3d4-0003-4000-8000-000000000003',
    id: 'MTA-003',
    title: 'Decide on persistence approach',
    type: 'Explore',
    status: { value: 'Open' },
    backlog: true,
    archived: false,
    description: '',
  },
  {
    uuid: 'a1b2c3d4-0004-4000-8000-000000000004',
    id: 'MTA-004',
    title: 'Todo CRUD (add / complete / delete)',
    type: 'Feature',
    status: { value: 'Idea' },
    backlog: false,
    archived: false,
    description:
      '## Todo CRUD\n\nThe core feature: create, complete, and delete todos.',
  },
  {
    uuid: 'a1b2c3d4-0005-4000-8000-000000000005',
    id: 'MTA-005',
    title: 'Filter (all / active / completed)',
    type: 'Feature',
    status: { value: 'Idea' },
    backlog: true,
    archived: false,
    description: '',
  },
  {
    uuid: 'a1b2c3d4-0006-4000-8000-000000000006',
    id: 'MTA-006',
    title: 'Scaffold project',
    type: 'Execute',
    status: { value: 'Draft' },
    backlog: false,
    archived: false,
    description: '',
  },
  {
    uuid: 'a1b2c3d4-0007-4000-8000-000000000007',
    id: 'MTA-007',
    title: 'Build CRUD UI',
    type: 'Execute',
    status: { value: 'Draft' },
    backlog: false,
    archived: false,
    description: '',
  },
]
