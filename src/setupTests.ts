import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import useLogStore from './stores/logStore'
import { resetReportThrottle } from './lib/diagnostics/report'
import { setRegionMeasure } from './lib/region/measure'
import { useRegionLatencyStore } from './stores/regionLatencyStore'

// logStore and the report throttle are module-level singletons shared by every
// test in a file. Without this, entries written by one test are still present
// when the next one asserts on `allLogs`, and a message throttled by one test
// is silently suppressed in another — which reads as a broken implementation
// rather than as leaked state.
afterEach(() => {
  useLogStore.getState().clearLogs()
  resetReportThrottle()
})

// Rendering a region select in any test must never reach the network: the
// latency measurement never settles unless a test installs its own.
beforeEach(() => {
  setRegionMeasure(() => new Promise(() => {}))
  useRegionLatencyStore.setState({ families: {} })
})
