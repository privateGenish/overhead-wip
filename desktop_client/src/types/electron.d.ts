declare global {
  interface Window {
    db: {
      query:   (sql: string, params?: unknown[]) => Promise<unknown>
      ticket:  (sql: string, params?: unknown[]) => Promise<unknown>
      history: (ticketUuid: string) => Promise<{ ts: number; description: string }[]>
    }
  }
}

export {}
