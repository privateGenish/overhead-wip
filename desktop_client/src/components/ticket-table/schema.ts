export type TicketRow = {
  uuid: string
  id: string
  title: string
  type: 'Explore' | 'Feature' | 'Execute'
  status: string
  backlog: boolean
}
