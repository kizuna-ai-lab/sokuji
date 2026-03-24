# PostHog Error Tracking Integration

**Issue**: [#138](https://github.com/kizuna-ai-lab/sokuji/issues/138) — PostHog Error Tracking not capturing any client errors
**Date**: 2026-03-24
**Status**: Design approved

## Problem

PostHog Error Tracking is enabled on the dashboard but receives no errors from clients. The root cause: `posthog-js-lite` does not support automatic `$exception` capturing, and the codebase has no global error handlers. Existing custom events (`error_occurred`, `api_error`, `audio_error`) are manual business-level tracking that goes to regular analytics, not the Error Tracking feature.

## Decision: Stay with posthog-js-lite

We evaluated switching to the full `posthog-js` SDK but decided against it:

- **Store rejection history**: v0.5.6 was rejected by Chrome Web Store for "remotely hosted code" when using `posthog-js`. We migrated to `posthog-js-lite` to resolve this (see `docs/store/chrome_web_store_response.md`).
- **Ongoing risks**: `posthog-js` v1.363.3's `module.no-external` build still uses `loadExternalDependency()` for exception autocapture — dynamic script loading that fails under extension CSP (`script-src 'self'`). Issue #2828 (2025) confirms exception autocapture doesn't work in extensions.
- **Bundle size**: `posthog-js/module.no-external` is 196KB vs `posthog-js-lite` at ~5KB — a 40x increase.
- **posthog-js-lite is alive**: Despite the GitHub repo being archived (2025-07-29), npm releases continue actively from the `posthog-js` monorepo (v4.5.7 released 2026-03-20).

## Solution

Add a lightweight `errorTracking.ts` module that hooks `window.onerror` and `window.onunhandledrejection`, then sends standard `$exception` events via the existing `posthog-js-lite` instance.

## Architecture

### New File: `src/lib/errorTracking.ts`

Single exported function:

```typescript
export function setupErrorTracking(posthog: PostHog): () => void
```

Takes the initialized PostHog instance, returns a cleanup function that removes the handlers.

### Responsibilities

1. **Hook global error handlers**: `window.onerror` and `window.onunhandledrejection`
2. **Parse stack traces**: Basic Chrome/Firefox format regex matching (two patterns cover 90%+ of cases)
3. **Format as `$exception` event**: Send via `posthog.capture('$exception', ...)` in PostHog's expected format
4. **Filter sensitive data**: Redact API key patterns in error messages
5. **Deduplicate**: Suppress repeat reports of the same error within 5 seconds

### Not captured

- `console.error` — The codebase uses `console.error` extensively for non-fatal informational logging. Capturing it would flood the dashboard with noise.
- Electron main process errors — Out of scope for this iteration. The renderer process and extension side panel cover the vast majority of user-facing errors.

## Event Format

```typescript
posthog.capture('$exception', {
  // Top-level fields for quick filtering
  $exception_type: 'TypeError',
  $exception_message: 'Cannot read properties of undefined',
  $exception_level: 'error',
  $exception_source: 'onerror' | 'onunhandledrejection',

  // Core field — PostHog Error Tracking dashboard uses this for grouping and display
  $exception_list: [
    {
      type: 'TypeError',
      value: 'Cannot read properties of undefined',
      mechanism: {
        handled: false,
        type: 'onerror' | 'onunhandledrejection'
      },
      stacktrace: {
        type: 'raw',
        frames: [
          {
            filename: 'assets/index-abc123.js',
            function: 'handleClick',
            lineno: 42,
            colno: 15,
            in_app: true
          }
        ]
      }
    }
  ]
})
```

### Stack Trace Parsing

Two regex patterns for the dominant formats:

- **Chrome/Edge/Node**: `at functionName (filename:line:col)` or `at filename:line:col`
- **Firefox/Safari**: `functionName@filename:line:col`

Frames are returned in reverse order (outermost call first) per PostHog convention. Unknown formats are silently skipped — a partial stack trace is better than none.

## Sensitive Data Filtering

Error messages may leak API keys or user content. Mitigations:

- **API key pattern redaction**: Regex scan for known prefixes (`sk-`, `AIza`, `key-`, etc.) and replace with `[REDACTED]`
- **Property sanitization**: Reuse the existing `SENSITIVE_FIELDS` list from `src/lib/analytics.ts` for any additional properties
- **Stack frames are safe**: Only contain filename, line number, column number, and function name — no user data

## Deduplication

Prevents flooding from errors in loops or rapid re-renders:

- Key: `type + message + filename + lineno`
- Same key suppressed for 5 seconds after first report
- Implementation: `Map<string, number>` storing last report timestamp
- Map entries are cleaned up lazily (checked on next error)

## Integration Point

### `shared/index.tsx` Changes

In the `UnifiedApp` component, after PostHog initialization:

```typescript
// Current code:
initializePostHog().then(client => {
  setPosthogClient(client);
  // ...
});

// Addition:
initializePostHog().then(client => {
  setPosthogClient(client);
  if (client) {
    cleanupRef.current = setupErrorTracking(client);
  }
});

// Cleanup on unmount:
useEffect(() => {
  return () => {
    cleanupRef.current?.();
  };
}, []);
```

### Development Mode Behavior

Error tracking follows the existing PostHog capturing state. If analytics is active, errors are reported. No separate toggle — consistent with decision (C) from design discussion.

## Scope

### Files Changed

| File | Change | Lines |
|------|--------|-------|
| `src/lib/errorTracking.ts` | **New** — core module | ~120 |
| `src/lib/errorTracking.test.ts` | **New** — unit tests | ~100 |
| `shared/index.tsx` | **Modified** — mount error tracking after PostHog init | ~+10 |

### Files NOT Changed

- `src/lib/analytics.ts` — existing custom error events (`error_occurred`, `api_error`, `audio_error`) are complementary business-level tracking, kept as-is
- `extension/manifest.json` — CSP unchanged, no new external connections
- `package.json` — no new dependencies

### Explicitly Out of Scope

- Switching to `posthog-js`
- Electron main process error capture
- `console.error` capture
- Source map upload to PostHog (can be added later for better stack traces)

## Testing

Unit tests in `src/lib/errorTracking.test.ts` using Vitest:

1. **Handler installation**: Verify `window.onerror` and `window.onunhandledrejection` are set after `setupErrorTracking()`
2. **Event format**: Trigger mock errors, assert `posthog.capture` is called with correct `$exception` structure
3. **Stack trace parsing**: Test Chrome and Firefox format strings produce correct frames
4. **Deduplication**: Same error within 5s → only one `capture` call
5. **Sensitive data redaction**: Message containing `sk-abc123` → `[REDACTED]`
6. **Cleanup**: After calling the returned function, handlers are removed
7. **Null safety**: Passing null PostHog instance → no handlers installed, no errors thrown

## Acceptance Criteria Mapping

From issue #138:

- [x] Unhandled JS errors appear in PostHog Error Tracking dashboard → `window.onerror` + `unhandledrejection` → `$exception` events
- [x] Both Electron app and browser extension errors are captured → Same renderer-side code runs in both platforms
- [x] Error stack traces included for debugging → Stack trace parsing with frames
- [x] No sensitive data leaked → API key regex redaction + SENSITIVE_FIELDS filtering
- [x] Development mode errors optionally excluded → Follows PostHog capturing state
