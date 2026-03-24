# PostHog Error Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture unhandled JS exceptions and send them as `$exception` events to PostHog Error Tracking via the existing `posthog-js-lite` SDK.

**Architecture:** A standalone `errorTracking.ts` module hooks `window.onerror` and `window.onunhandledrejection`, parses stack traces, deduplicates, redacts sensitive data, and calls `posthog.capture('$exception', ...)`. It is mounted in `shared/index.tsx` after PostHog initialization.

**Tech Stack:** TypeScript, posthog-js-lite, Vitest

**Spec:** `docs/superpowers/specs/2026-03-24-posthog-error-tracking-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/errorTracking.ts` | **Create** — Core module: global error handlers, stack trace parsing, dedup, redaction, `$exception` event dispatch |
| `src/lib/errorTracking.test.ts` | **Create** — Unit tests for all errorTracking behaviors |
| `shared/index.tsx` | **Modify** — Mount error tracking after PostHog init, cleanup on unmount |

---

### Task 1: Stack trace parser — tests

**Files:**
- Create: `src/lib/errorTracking.test.ts`
- Create: `src/lib/errorTracking.ts` (empty export)

- [ ] **Step 1: Create `errorTracking.ts` with empty exports as compile target**

```typescript
// src/lib/errorTracking.ts
import type PostHog from 'posthog-js-lite';

export interface StackFrame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

export function parseStackTrace(stack: string): StackFrame[] {
  return [];
}

export function setupErrorTracking(posthog: PostHog): () => void {
  return () => {};
}
```

- [ ] **Step 2: Write failing tests for stack trace parsing**

```typescript
// src/lib/errorTracking.test.ts
import { describe, it, expect } from 'vitest';
import { parseStackTrace } from './errorTracking';

describe('parseStackTrace', () => {
  it('parses Chrome/V8 stack frames', () => {
    const stack = `TypeError: Cannot read properties of undefined
    at handleClick (http://localhost:5173/assets/index-abc123.js:42:15)
    at HTMLButtonElement.onclick (http://localhost:5173/assets/index-abc123.js:100:3)`;

    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(2);
    // PostHog convention: outermost first (reversed from stack trace order)
    expect(frames[0]).toEqual({
      filename: 'http://localhost:5173/assets/index-abc123.js',
      function: 'HTMLButtonElement.onclick',
      lineno: 100,
      colno: 3,
      in_app: true,
    });
    expect(frames[1]).toEqual({
      filename: 'http://localhost:5173/assets/index-abc123.js',
      function: 'handleClick',
      lineno: 42,
      colno: 15,
      in_app: true,
    });
  });

  it('parses Chrome frames without function name', () => {
    const stack = `Error: test
    at http://localhost:5173/assets/index.js:10:5`;

    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      filename: 'http://localhost:5173/assets/index.js',
      function: '?',
      lineno: 10,
      colno: 5,
      in_app: true,
    });
  });

  it('parses Firefox stack frames', () => {
    const stack = `handleClick@http://localhost:5173/assets/index.js:42:15
onClick@http://localhost:5173/assets/index.js:100:3`;

    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({
      filename: 'http://localhost:5173/assets/index.js',
      function: 'onClick',
      lineno: 100,
      colno: 3,
      in_app: true,
    });
    expect(frames[1]).toEqual({
      filename: 'http://localhost:5173/assets/index.js',
      function: 'handleClick',
      lineno: 42,
      colno: 15,
      in_app: true,
    });
  });

  it('returns empty array for empty/missing stack', () => {
    expect(parseStackTrace('')).toEqual([]);
    expect(parseStackTrace('Error: no frames here')).toEqual([]);
  });

  it('skips unparseable lines and returns partial results', () => {
    const stack = `TypeError: oops
    at validFunc (http://localhost:5173/app.js:10:5)
    some garbage line
    at anotherFunc (http://localhost:5173/app.js:20:3)`;

    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0].function).toBe('anotherFunc');
    expect(frames[1].function).toBe('validFunc');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/errorTracking.test.ts`
Expected: FAIL — `parseStackTrace` returns empty array

- [ ] **Step 4: Commit test scaffolding**

```bash
git add src/lib/errorTracking.ts src/lib/errorTracking.test.ts
git commit -m "test(error-tracking): add stack trace parser tests (red)"
```

---

### Task 2: Stack trace parser — implementation

**Files:**
- Modify: `src/lib/errorTracking.ts`

- [ ] **Step 1: Implement `parseStackTrace`**

```typescript
// In src/lib/errorTracking.ts — replace the empty parseStackTrace

// Chrome/V8: "    at funcName (url:line:col)" or "    at url:line:col"
const CHROME_FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?((?:https?|chrome-extension):\/\/[^\s]+?|[^\s(]+?):(\d+):(\d+)\)?\s*$/;

// Firefox/Safari: "funcName@url:line:col"
const FIREFOX_FRAME_RE = /^(.+?)@((?:https?|moz-extension|safari-extension):\/\/[^\s]+?|[^\s@]+?):(\d+):(\d+)\s*$/;

export function parseStackTrace(stack: string): StackFrame[] {
  if (!stack) return [];

  const lines = stack.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    let match = CHROME_FRAME_RE.exec(line);
    if (match) {
      frames.push({
        filename: match[2],
        function: match[1] || '?',
        lineno: parseInt(match[3], 10),
        colno: parseInt(match[4], 10),
        in_app: true,
      });
      continue;
    }

    match = FIREFOX_FRAME_RE.exec(line);
    if (match) {
      frames.push({
        filename: match[2],
        function: match[1] || '?',
        lineno: parseInt(match[3], 10),
        colno: parseInt(match[4], 10),
        in_app: true,
      });
    }
  }

  // Reverse: PostHog expects outermost frame first
  frames.reverse();
  return frames;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/lib/errorTracking.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/errorTracking.ts
git commit -m "feat(error-tracking): implement stack trace parser for Chrome and Firefox formats"
```

---

### Task 3: Sensitive data redaction — tests and implementation

**Files:**
- Modify: `src/lib/errorTracking.ts`
- Modify: `src/lib/errorTracking.test.ts`

- [ ] **Step 1: Add redaction tests**

Append to `src/lib/errorTracking.test.ts`:

```typescript
import { redactSensitiveData } from './errorTracking';

describe('redactSensitiveData', () => {
  it('redacts OpenAI API key patterns', () => {
    expect(redactSensitiveData('Error with sk-abc123def456')).toBe('Error with [REDACTED]');
  });

  it('redacts Google API key patterns', () => {
    expect(redactSensitiveData('Key: AIzaSyB-example123')).toBe('Key: [REDACTED]');
  });

  it('redacts generic key- prefixed tokens', () => {
    expect(redactSensitiveData('Using key-abcdef12345')).toBe('Using [REDACTED]');
  });

  it('leaves normal messages unchanged', () => {
    expect(redactSensitiveData('TypeError: undefined is not a function')).toBe(
      'TypeError: undefined is not a function'
    );
  });

  it('redacts multiple keys in one message', () => {
    expect(redactSensitiveData('sk-aaa and AIzaSyB-bbb')).toBe('[REDACTED] and [REDACTED]');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/errorTracking.test.ts`
Expected: FAIL — `redactSensitiveData` not exported

- [ ] **Step 3: Implement `redactSensitiveData`**

Add to `src/lib/errorTracking.ts`:

```typescript
// Matches common API key patterns: sk-..., AIza..., key-...
const API_KEY_RE = /\b(sk-[a-zA-Z0-9_-]{10,}|AIza[a-zA-Z0-9_-]{10,}|key-[a-zA-Z0-9_-]{10,})\b/g;

export function redactSensitiveData(message: string): string {
  return message.replace(API_KEY_RE, '[REDACTED]');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/errorTracking.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/errorTracking.ts src/lib/errorTracking.test.ts
git commit -m "feat(error-tracking): add API key redaction for error messages"
```

---

### Task 4: Deduplication — tests and implementation

**Files:**
- Modify: `src/lib/errorTracking.ts`
- Modify: `src/lib/errorTracking.test.ts`

- [ ] **Step 1: Add deduplication tests**

Append to `src/lib/errorTracking.test.ts`:

```typescript
import { createDeduplicator } from './errorTracking';

describe('createDeduplicator', () => {
  it('allows first occurrence of an error', () => {
    const dedup = createDeduplicator();
    expect(dedup.shouldReport('TypeError', 'oops', 'app.js', 42)).toBe(true);
  });

  it('suppresses same error within 5 seconds', () => {
    const dedup = createDeduplicator();
    dedup.shouldReport('TypeError', 'oops', 'app.js', 42);
    expect(dedup.shouldReport('TypeError', 'oops', 'app.js', 42)).toBe(false);
  });

  it('allows same error after 5 seconds', () => {
    const dedup = createDeduplicator();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    dedup.shouldReport('TypeError', 'oops', 'app.js', 42);

    vi.spyOn(Date, 'now').mockReturnValue(now + 5001);
    expect(dedup.shouldReport('TypeError', 'oops', 'app.js', 42)).toBe(true);

    vi.restoreAllMocks();
  });

  it('allows different errors', () => {
    const dedup = createDeduplicator();
    dedup.shouldReport('TypeError', 'oops', 'app.js', 42);
    expect(dedup.shouldReport('ReferenceError', 'nope', 'app.js', 50)).toBe(true);
  });

  it('evicts oldest entry when map exceeds 100 entries', () => {
    const dedup = createDeduplicator();
    // Fill 100 entries
    for (let i = 0; i < 100; i++) {
      dedup.shouldReport('Error', `msg${i}`, 'app.js', i);
    }
    // 101st entry should succeed and evict the oldest
    expect(dedup.shouldReport('Error', 'msg100', 'app.js', 100)).toBe(true);
    // The first entry (msg0) was evicted, so it should be reportable again
    expect(dedup.shouldReport('Error', 'msg0', 'app.js', 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/errorTracking.test.ts`
Expected: FAIL — `createDeduplicator` not exported

- [ ] **Step 3: Implement `createDeduplicator`**

Add to `src/lib/errorTracking.ts`:

```typescript
const DEDUP_WINDOW_MS = 5000;
const DEDUP_MAX_ENTRIES = 100;

export interface Deduplicator {
  shouldReport(type: string, message: string, filename?: string, lineno?: number): boolean;
}

export function createDeduplicator(): Deduplicator {
  const seen = new Map<string, number>();

  return {
    shouldReport(type: string, message: string, filename?: string, lineno?: number): boolean {
      const key = `${type}:${message}:${filename ?? ''}:${lineno ?? ''}`;
      const now = Date.now();
      const lastSeen = seen.get(key);

      if (lastSeen !== undefined && now - lastSeen < DEDUP_WINDOW_MS) {
        return false;
      }

      // Evict oldest if at capacity
      if (seen.size >= DEDUP_MAX_ENTRIES && !seen.has(key)) {
        const oldestKey = seen.keys().next().value;
        if (oldestKey !== undefined) {
          seen.delete(oldestKey);
        }
      }

      seen.set(key, now);
      return true;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/errorTracking.test.ts`
Expected: All 15 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/errorTracking.ts src/lib/errorTracking.test.ts
git commit -m "feat(error-tracking): add error deduplication with 5s window and 100-entry cap"
```

---

### Task 5: `setupErrorTracking` — tests

**Files:**
- Modify: `src/lib/errorTracking.test.ts`

- [ ] **Step 1: Add `setupErrorTracking` tests**

Append to `src/lib/errorTracking.test.ts`:

```typescript
import { setupErrorTracking } from './errorTracking';

describe('setupErrorTracking', () => {
  let mockPosthog: { capture: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPosthog = { capture: vi.fn() };
    // Clear any existing handlers
    window.onerror = null;
    window.onunhandledrejection = null;
  });

  afterEach(() => {
    window.onerror = null;
    window.onunhandledrejection = null;
  });

  it('installs window.onerror and window.onunhandledrejection handlers', () => {
    const cleanup = setupErrorTracking(mockPosthog as any);
    expect(window.onerror).toBeInstanceOf(Function);
    expect(window.onunhandledrejection).toBeInstanceOf(Function);
    cleanup();
  });

  it('captures $exception on window.onerror with Error object', () => {
    const cleanup = setupErrorTracking(mockPosthog as any);

    const error = new TypeError('test error');
    error.stack = `TypeError: test error
    at testFunc (http://localhost:5173/assets/app.js:10:5)`;

    window.onerror!('test error', 'http://localhost:5173/assets/app.js', 10, 5, error);

    expect(mockPosthog.capture).toHaveBeenCalledOnce();
    const [eventName, props] = mockPosthog.capture.mock.calls[0];
    expect(eventName).toBe('$exception');
    expect(props.$exception_type).toBe('TypeError');
    expect(props.$exception_message).toBe('test error');
    expect(props.$exception_level).toBe('error');
    expect(props.$exception_source).toBe('onerror');
    expect(props.$exception_list).toHaveLength(1);
    expect(props.$exception_list[0].mechanism).toEqual({ handled: false, type: 'onerror' });
    expect(props.$exception_list[0].stacktrace.frames).toHaveLength(1);

    cleanup();
  });

  it('captures $exception on window.onerror without Error object (string-only)', () => {
    const cleanup = setupErrorTracking(mockPosthog as any);

    window.onerror!('Script error.', 'http://example.com/app.js', 10, 5, undefined);

    expect(mockPosthog.capture).toHaveBeenCalledOnce();
    const [, props] = mockPosthog.capture.mock.calls[0];
    expect(props.$exception_type).toBe('Error');
    expect(props.$exception_message).toBe('Script error.');

    cleanup();
  });

  it('captures $exception on unhandledrejection', () => {
    const cleanup = setupErrorTracking(mockPosthog as any);

    const error = new ReferenceError('x is not defined');
    error.stack = `ReferenceError: x is not defined
    at main (http://localhost:5173/assets/app.js:5:1)`;

    const event = new PromiseRejectionEvent('unhandledrejection', {
      reason: error,
      promise: Promise.resolve(),
    });
    window.onunhandledrejection!(event);

    expect(mockPosthog.capture).toHaveBeenCalledOnce();
    const [, props] = mockPosthog.capture.mock.calls[0];
    expect(props.$exception_type).toBe('ReferenceError');
    expect(props.$exception_source).toBe('onunhandledrejection');
    expect(props.$exception_list[0].mechanism.type).toBe('onunhandledrejection');

    cleanup();
  });

  it('captures unhandledrejection with string reason', () => {
    const cleanup = setupErrorTracking(mockPosthog as any);

    const event = new PromiseRejectionEvent('unhandledrejection', {
      reason: 'string rejection',
      promise: Promise.resolve(),
    });
    window.onunhandledrejection!(event);

    expect(mockPosthog.capture).toHaveBeenCalledOnce();
    const [, props] = mockPosthog.capture.mock.calls[0];
    expect(props.$exception_type).toBe('UnhandledRejection');
    expect(props.$exception_message).toBe('string rejection');

    cleanup();
  });

  it('captures unhandledrejection with object reason', () => {
    const cleanup = setupErrorTracking(mockPosthog as any);

    const event = new PromiseRejectionEvent('unhandledrejection', {
      reason: { code: 500, detail: 'server error' },
      promise: Promise.resolve(),
    });
    window.onunhandledrejection!(event);

    expect(mockPosthog.capture).toHaveBeenCalledOnce();
    const [, props] = mockPosthog.capture.mock.calls[0];
    expect(props.$exception_type).toBe('UnhandledRejection');
    expect(props.$exception_message).toContain('500');

    cleanup();
  });

  it('redacts API keys in error messages', () => {
    const cleanup = setupErrorTracking(mockPosthog as any);

    const error = new Error('Invalid API key: sk-abc123def456xyz789');
    error.stack = 'Error: Invalid API key: sk-abc123def456xyz789\n    at f (app.js:1:1)';

    window.onerror!('', '', 0, 0, error);

    const [, props] = mockPosthog.capture.mock.calls[0];
    expect(props.$exception_message).toContain('[REDACTED]');
    expect(props.$exception_message).not.toContain('sk-abc123');

    cleanup();
  });

  it('deduplicates same error within 5 seconds', () => {
    const cleanup = setupErrorTracking(mockPosthog as any);

    const error = new Error('dupe');
    error.stack = 'Error: dupe\n    at f (app.js:1:1)';

    window.onerror!('dupe', 'app.js', 1, 1, error);
    window.onerror!('dupe', 'app.js', 1, 1, error);
    window.onerror!('dupe', 'app.js', 1, 1, error);

    expect(mockPosthog.capture).toHaveBeenCalledOnce();

    cleanup();
  });

  it('cleanup restores original handlers', () => {
    const originalOnerror = vi.fn();
    const originalRejection = vi.fn();
    window.onerror = originalOnerror;
    window.onunhandledrejection = originalRejection;

    const cleanup = setupErrorTracking(mockPosthog as any);
    expect(window.onerror).not.toBe(originalOnerror);

    cleanup();
    expect(window.onerror).toBe(originalOnerror);
    expect(window.onunhandledrejection).toBe(originalRejection);
  });

  it('chains to pre-existing onerror handler', () => {
    const originalOnerror = vi.fn();
    window.onerror = originalOnerror;

    const cleanup = setupErrorTracking(mockPosthog as any);

    const error = new Error('test');
    error.stack = 'Error: test\n    at f (app.js:1:1)';
    window.onerror!('test', 'app.js', 1, 1, error);

    expect(originalOnerror).toHaveBeenCalledOnce();
    expect(mockPosthog.capture).toHaveBeenCalledOnce();

    cleanup();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/errorTracking.test.ts`
Expected: FAIL — `setupErrorTracking` returns noop, handlers not installed

- [ ] **Step 3: Commit**

```bash
git add src/lib/errorTracking.test.ts
git commit -m "test(error-tracking): add setupErrorTracking integration tests (red)"
```

---

### Task 6: `setupErrorTracking` — implementation

**Files:**
- Modify: `src/lib/errorTracking.ts`

- [ ] **Step 1: Implement `setupErrorTracking`**

Replace the stub `setupErrorTracking` in `src/lib/errorTracking.ts`:

```typescript
export function setupErrorTracking(posthog: PostHog): () => void {
  const dedup = createDeduplicator();

  // Save pre-existing handlers for chaining and cleanup
  const prevOnerror = window.onerror;
  const prevOnunhandledrejection = window.onunhandledrejection;

  window.onerror = (message, source, lineno, colno, error) => {
    captureError(posthog, dedup, error, String(message), source, lineno, colno, 'onerror');

    // Chain to previous handler
    if (typeof prevOnerror === 'function') {
      prevOnerror.call(window, message, source, lineno, colno, error);
    }
  };

  window.onunhandledrejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;

    if (reason instanceof Error) {
      captureError(posthog, dedup, reason, reason.message, undefined, undefined, undefined, 'onunhandledrejection');
    } else {
      // Non-Error rejection (string, object, etc.)
      const message = typeof reason === 'string' ? reason : JSON.stringify(reason);
      captureError(posthog, dedup, null, message, undefined, undefined, undefined, 'onunhandledrejection');
    }

    // Chain to previous handler
    if (typeof prevOnunhandledrejection === 'function') {
      prevOnunhandledrejection.call(window, event);
    }
  };

  // Return cleanup function
  return () => {
    window.onerror = prevOnerror;
    window.onunhandledrejection = prevOnunhandledrejection;
  };
}

function captureError(
  posthog: PostHog,
  dedup: Deduplicator,
  error: Error | null | undefined,
  message: string,
  source?: string,
  lineno?: number,
  colno?: number,
  mechanism: 'onerror' | 'onunhandledrejection' = 'onerror',
): void {
  const type = error?.name || (mechanism === 'onunhandledrejection' ? 'UnhandledRejection' : 'Error');
  const rawMessage = error?.message || message;
  const redactedMessage = redactSensitiveData(rawMessage);

  // Parse stack trace from Error object
  const frames = error?.stack ? parseStackTrace(error.stack) : [];

  // Extract top frame info for dedup key
  const topFrame = frames.length > 0 ? frames[frames.length - 1] : undefined;
  const dedupFilename = topFrame?.filename || source || '';
  const dedupLineno = topFrame?.lineno || lineno;

  if (!dedup.shouldReport(type, rawMessage, dedupFilename, dedupLineno)) {
    return;
  }

  const exceptionEntry: Record<string, any> = {
    type,
    value: redactedMessage,
    mechanism: {
      handled: false,
      type: mechanism,
    },
  };

  if (frames.length > 0) {
    exceptionEntry.stacktrace = {
      type: 'raw',
      frames,
    };
  }

  posthog.capture('$exception', {
    $exception_type: type,
    $exception_message: redactedMessage,
    $exception_level: 'error',
    $exception_source: mechanism,
    $exception_list: [exceptionEntry],
  });
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/lib/errorTracking.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/errorTracking.ts
git commit -m "feat(error-tracking): implement setupErrorTracking with global error handlers"
```

---

### Task 7: Integrate into `shared/index.tsx`

**Files:**
- Modify: `shared/index.tsx:1-5` (imports)
- Modify: `shared/index.tsx:119-157` (UnifiedApp component)

- [ ] **Step 1: Add import and ref**

At top of `shared/index.tsx`, add import:

```typescript
import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
```

Add after the existing imports (line 5):

```typescript
import { setupErrorTracking } from '../src/lib/errorTracking';
```

- [ ] **Step 2: Add cleanupRef and mount error tracking**

In the `UnifiedApp` component, add a ref:

```typescript
const UnifiedApp = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [posthogClient, setPosthogClient] = useState<PostHog | null>(null);
  const errorTrackingCleanupRef = useRef<(() => void) | null>(null);
```

Modify the `initializePostHog().then(...)` callback (around line 144) to mount error tracking:

```typescript
        initializePostHog().then(client => {
          setPosthogClient(client);
          if (client) {
            errorTrackingCleanupRef.current = setupErrorTracking(client);
          }
          const analyticsEnd = performance.now();
          console.log(`[Sokuji] Analytics initialized in ${Math.round(analyticsEnd - analyticsStart)}ms`);
        }).catch(error => {
```

- [ ] **Step 3: Add cleanup on unmount**

Add a second `useEffect` after the existing one (after line 157):

```typescript
  // Cleanup error tracking on unmount
  useEffect(() => {
    return () => {
      errorTrackingCleanupRef.current?.();
    };
  }, []);
```

- [ ] **Step 4: Run tests to verify nothing is broken**

Run: `npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add shared/index.tsx
git commit -m "feat(error-tracking): integrate error tracking into PostHog initialization (#138)"
```

---

### Task 8: Run full test suite and verify

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass, including the new error tracking tests

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run lint (if configured)**

Run: `npm run lint 2>/dev/null || echo "no lint script"`
Expected: No new lint errors

- [ ] **Step 4: Manual smoke test (optional)**

Run: `npm run dev`
Open browser console and type: `throw new Error('test error tracking')`
Check PostHog dashboard for the `$exception` event.
