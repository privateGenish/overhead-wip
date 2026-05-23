const STORE_KEY = 'overhead:tickets'

export function readStore<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeStore<T>(data: T): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(data))
}
