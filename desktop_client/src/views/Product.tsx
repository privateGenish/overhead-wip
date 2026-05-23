import { TicketView } from '@/components/TicketView'

export function Product() {
  return <TicketView filter={(t) => t.type === 'Feature'} fixedType="Feature" />
}
