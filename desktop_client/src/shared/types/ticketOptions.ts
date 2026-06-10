import type { TicketStatus, TicketType } from './ticket'

export const TICKET_TYPES = ['Execute', 'Explore', 'Feature'] as const satisfies readonly TicketType[]

export const TICKET_STATUS_OPTIONS = {
  Execute: ['Draft', 'Ready', 'In Progress', 'Done', 'Failed', 'Rejected'],
  Explore: ['Open', 'In Progress', 'Concluded', 'Not Needed'],
  Feature: ['Idea', 'Scoped', 'In Progress', 'Built', 'Canceled'],
} as const satisfies Record<TicketType, readonly string[]>

export const DEFAULT_TICKET_STATUS = {
  Execute: { value: 'Draft' },
  Explore: { value: 'Open' },
  Feature: { value: 'Idea' },
} as const satisfies Record<TicketType, TicketStatus>

export function statusForType(
  type: TicketType,
  current?: TicketStatus,
): TicketStatus {
  const statuses: readonly string[] = TICKET_STATUS_OPTIONS[type]
  if (current && statuses.includes(current.value)) {
    return current
  }
  return DEFAULT_TICKET_STATUS[type]
}
