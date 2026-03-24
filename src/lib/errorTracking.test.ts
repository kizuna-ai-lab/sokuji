import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseStackTrace, redactSensitiveData, createDeduplicator, setupErrorTracking } from './errorTracking';

describe('parseStackTrace', () => {
  it('parses Chrome/V8 stack frames', () => {
    const stack = `TypeError: Cannot read properties of undefined
    at handleClick (http://localhost:5173/assets/index-abc123.js:42:15)
    at HTMLButtonElement.onclick (http://localhost:5173/assets/index-abc123.js:100:3)`;

    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({
      platform: 'web:javascript',
      filename: 'http://localhost:5173/assets/index-abc123.js',
      function: 'HTMLButtonElement.onclick',
      lineno: 100,
      colno: 3,
      in_app: true,
    });
    expect(frames[1]).toEqual({
      platform: 'web:javascript',
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
      platform: 'web:javascript',
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
      platform: 'web:javascript',
      filename: 'http://localhost:5173/assets/index.js',
      function: 'onClick',
      lineno: 100,
      colno: 3,
      in_app: true,
    });
    expect(frames[1]).toEqual({
      platform: 'web:javascript',
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
    expect(redactSensitiveData('sk-aaabbbcccddd and AIzaSyBcDeFgHiJk')).toBe('[REDACTED] and [REDACTED]');
  });
});

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
    for (let i = 0; i < 100; i++) {
      dedup.shouldReport('Error', `msg${i}`, 'app.js', i);
    }
    expect(dedup.shouldReport('Error', 'msg100', 'app.js', 100)).toBe(true);
    expect(dedup.shouldReport('Error', 'msg0', 'app.js', 0)).toBe(true);
  });
});

describe('setupErrorTracking', () => {
  let mockPosthog: { capture: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPosthog = { capture: vi.fn() };
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

    const event = { reason: error } as PromiseRejectionEvent;
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

    const event = { reason: 'string rejection' } as PromiseRejectionEvent;
    window.onunhandledrejection!(event);

    expect(mockPosthog.capture).toHaveBeenCalledOnce();
    const [, props] = mockPosthog.capture.mock.calls[0];
    expect(props.$exception_type).toBe('UnhandledRejection');
    expect(props.$exception_message).toBe('string rejection');

    cleanup();
  });

  it('captures unhandledrejection with object reason', () => {
    const cleanup = setupErrorTracking(mockPosthog as any);

    const event = { reason: { code: 500, detail: 'server error' } } as PromiseRejectionEvent;
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
