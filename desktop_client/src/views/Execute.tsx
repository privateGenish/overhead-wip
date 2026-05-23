import { TicketView } from '@/components/TicketView'

export function Execute() {
  return <TicketView filter={(t) => t.type === 'Execute'} fixedType="Execute" />
}
