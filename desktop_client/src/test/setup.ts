// Vitest global setup — extends expect with Testing Library's DOM matchers
// and unmounts rendered trees between tests. (Auto-cleanup relies on a global
// afterEach, which vitest only provides with `globals: true` — register it
// explicitly instead so component tests never leak DOM across tests.)
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// jsdom implements neither of these, and cmdk (the ⌘K palette, the faceted
// filters) calls both on mount. Stubs rather than real implementations: no
// test asserts on layout, they only have to exist so the component mounts.
if (typeof window !== 'undefined') {
  const host = window as unknown as { ResizeObserver?: typeof ResizeObserver }
  host.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Element.prototype.scrollIntoView ??= function scrollIntoView(): void {}
}
