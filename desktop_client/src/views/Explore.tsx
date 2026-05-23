import { TicketView } from '@/components/TicketView'

export function Explore() {
  return <TicketView filter={(t) => t.type === 'Explore'} fixedType="Explore" />
}
