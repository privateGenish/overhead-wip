import { TicketView } from '@/components/TicketView'

export function Backlog() {
  return <TicketView filter={(t) => t.backlog === true} />
}
