import { TicketView } from '@/components/TicketView'

/**
 * The one view where backlog tickets are the content rather than the exception,
 * so it opts out of the hidden-by-default rule the other views follow.
 */
export function Backlog() {
  return <TicketView filter={(t) => t.backlog === true} showsBacklog />
}
