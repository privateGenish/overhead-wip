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
