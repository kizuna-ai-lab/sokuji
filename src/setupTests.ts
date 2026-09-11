import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import useLogStore from './stores/logStore'
import { resetReportThrottle } from './lib/diagnostics/report'

// Diagnostic logs are opt-in in the app, so logStore starts disabled and only
// settingsStore.loadSettings switches it on. Most suites assert what reaches
// the panel, so they run with it on; a file that needs it off says so in its
// own setup, which runs after this. The production default is pinned by
// logStore.test.ts ("initial state", on a fresh module) and by settingsStore's
// preflight tests.
beforeEach(() => {
  useLogStore.getState().setEnabled(true)
})

// logStore and the report throttle are module-level singletons shared by every
// test in a file. Without this, entries written by one test are still present
// when the next one asserts on `allLogs`, and a message throttled by one test
// is silently suppressed in another — which reads as a broken implementation
// rather than as leaked state.
afterEach(() => {
  useLogStore.getState().clearLogs()
  resetReportThrottle()
})
