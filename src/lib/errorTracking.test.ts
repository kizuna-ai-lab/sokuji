import { describe, it, expect } from 'vitest';
import { parseStackTrace, redactSensitiveData, createDeduplicator } from './errorTracking';

describe('parseStackTrace', () => {
  it('parses Chrome/V8 stack frames', () => {
    const stack = `TypeError: Cannot read properties of undefined
    at handleClick (http://localhost:5173/assets/index-abc123.js:42:15)
    at HTMLButtonElement.onclick (http://localhost:5173/assets/index-abc123.js:100:3)`;

    const frames = parseStackTrace(stack);
    expect(frames).toHaveLength(2);
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
