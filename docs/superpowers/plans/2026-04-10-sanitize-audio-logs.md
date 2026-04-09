# Sanitize Audio Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `sanitizeEvent` in `logStore.ts` with three-layer sanitization that strips Gemini base64 audio, generic base64 strings, and known audio field names — with human-readable size placeholders.

**Architecture:** Extract `sanitizeEvent` and helpers into a dedicated module `src/stores/sanitizeEvent.ts` so it can be imported directly in tests without pulling in the Zustand store. The store re-imports and calls it the same way. Three layers run in order: structure-aware (Gemini `inlineData`), field-name rules, generic base64 catch-all.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/stores/sanitizeEvent.ts` | Create | Pure `sanitizeEvent` function + `formatBytes` helper, exported for direct testing |
| `src/stores/logStore.ts` | Modify (lines 155-211) | Remove inline `sanitizeEvent`, import from `sanitizeEvent.ts` |
| `src/stores/sanitizeEvent.test.ts` | Create | Unit tests for all three layers + placeholder formatting |

---

### Task 1: Extract sanitizeEvent to its own module with formatBytes helper

**Files:**
- Create: `src/stores/sanitizeEvent.ts`

- [ ] **Step 1: Write the failing test for `formatBytes`**

Create `src/stores/sanitizeEvent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatBytes, sanitizeEvent } from './sanitizeEvent';

describe('formatBytes', () => {
  it('formats bytes under 1024 as B', () => {
    expect(formatBytes(0)).toBe('0B');
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(1023)).toBe('1023B');
  });

  it('formats bytes in KB range', () => {
    expect(formatBytes(1024)).toBe('1.0KB');
    expect(formatBytes(1536)).toBe('1.5KB');
    expect(formatBytes(46080)).toBe('45.0KB');
  });

  it('formats bytes in MB range', () => {
    expect(formatBytes(1048576)).toBe('1.0MB');
    expect(formatBytes(2621440)).toBe('2.5MB');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/sanitizeEvent.test.ts`
Expected: FAIL — module `./sanitizeEvent` not found

- [ ] **Step 3: Write `formatBytes` and scaffold `sanitizeEvent`**

Create `src/stores/sanitizeEvent.ts`:

```ts
/** Format byte count as human-readable string: "512B", "45.0KB", "2.5MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

// Estimate decoded size of a base64 string
function base64ByteSize(str: string): number {
  return Math.ceil(str.length * 3 / 4);
}

// Check if a long string is likely base64-encoded
function isLikelyBase64(str: string): boolean {
  if (str.length <= 200) return false;
  // Count base64-valid characters
  let validChars = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (
      (c >= 65 && c <= 90) ||  // A-Z
      (c >= 97 && c <= 122) || // a-z
      (c >= 48 && c <= 57) ||  // 0-9
      c === 43 || c === 47 || c === 61 // + / =
    ) {
      validChars++;
    }
  }
  return validChars / str.length > 0.9;
}

const AUDIO_FIELD_NAMES = new Set([
  'audio', 'audioData', 'audio_data', 'pcmData', 'buffer', 'wav', 'pcm'
]);

/** Sanitize event data by removing large binary/base64 audio payloads. */
export function sanitizeEvent(event: any): any {
  // Primitives and nulls pass through
  if (!event || typeof event !== 'object') {
    // Layer 2: generic base64 detection on strings
    if (typeof event === 'string' && isLikelyBase64(event)) {
      return `<base64:${formatBytes(base64ByteSize(event))}>`;
    }
    return event;
  }

  // ArrayBuffer / TypedArray → placeholder
  if (event instanceof ArrayBuffer) {
    return `<binary:${formatBytes(event.byteLength)}>`;
  }
  if (ArrayBuffer.isView(event)) {
    return `<binary:${formatBytes(event.byteLength)}>`;
  }

  // Arrays → recurse each element
  if (Array.isArray(event)) {
    return event.map(item => sanitizeEvent(item));
  }

  // --- Layer 1: Structure-aware detection ---
  // If this object has mimeType starting with "audio/" and a "data" key,
  // replace "data" with an audio placeholder, copy everything else normally.
  const mimeType = event.mimeType;
  const isAudioMimeObject =
    typeof mimeType === 'string' &&
    mimeType.startsWith('audio/') &&
    'data' in event;

  const sanitized: any = {};
  for (const key in event) {
    if (!event.hasOwnProperty(key)) continue;
    const value = event[key];

    // Layer 1: replace data in audio-mimeType objects
    if (isAudioMimeObject && key === 'data') {
      if (typeof value === 'string') {
        sanitized[key] = `<audio:${formatBytes(base64ByteSize(value))}>`;
      } else if (value instanceof ArrayBuffer) {
        sanitized[key] = `<audio:${formatBytes(value.byteLength)}>`;
      } else if (ArrayBuffer.isView(value)) {
        sanitized[key] = `<audio:${formatBytes(value.byteLength)}>`;
      } else {
        sanitized[key] = `<audio:unknown>`;
      }
      continue;
    }

    // Layer 3: field-name rules for known audio fields
    if (AUDIO_FIELD_NAMES.has(key)) {
      if (value instanceof ArrayBuffer) {
        sanitized[key] = `<binary:${formatBytes(value.byteLength)}>`;
        continue;
      }
      if (ArrayBuffer.isView(value)) {
        sanitized[key] = `<binary:${formatBytes(value.byteLength)}>`;
        continue;
      }
      if (Array.isArray(value) && value.length > 1000) {
        sanitized[key] = `<binary:${formatBytes(value.length * 4)}>`;
        continue;
      }
      if (typeof value === 'string' && value.length > 200) {
        sanitized[key] = `<audio:${formatBytes(base64ByteSize(value))}>`;
        continue;
      }
      // Small values in audio fields: recurse normally
    }

    // Layer 2: generic base64 detection on string values
    if (typeof value === 'string' && isLikelyBase64(value)) {
      sanitized[key] = `<base64:${formatBytes(base64ByteSize(value))}>`;
      continue;
    }

    // Default: recurse
    sanitized[key] = sanitizeEvent(value);
  }

  return sanitized;
}
```

- [ ] **Step 4: Run test to verify `formatBytes` passes**

Run: `npx vitest run src/stores/sanitizeEvent.test.ts`
Expected: PASS — all 3 `formatBytes` tests green

- [ ] **Step 5: Commit**

```bash
git add src/stores/sanitizeEvent.ts src/stores/sanitizeEvent.test.ts
git commit -m "feat: extract sanitizeEvent with three-layer sanitization and formatBytes helper (#189)"
```

---

### Task 2: Add Layer 1 tests (Gemini structure-aware detection)

**Files:**
- Modify: `src/stores/sanitizeEvent.test.ts`

- [ ] **Step 1: Add Gemini audio tests**

Append to `src/stores/sanitizeEvent.test.ts`:

```ts
describe('sanitizeEvent', () => {
  describe('Layer 1: structure-aware detection (Gemini)', () => {
    it('replaces inlineData.data when mimeType is audio', () => {
      const event = {
        type: 'serverContent.modelTurn',
        data: {
          parts: [
            {
              inlineData: {
                mimeType: 'audio/pcm;rate=24000',
                data: 'A'.repeat(61440), // ~45KB base64
              },
            },
          ],
        },
      };
      const result = sanitizeEvent(event);
      expect(result.data.parts[0].inlineData.data).toBe('<audio:45.0KB>');
      expect(result.data.parts[0].inlineData.mimeType).toBe('audio/pcm;rate=24000');
    });

    it('preserves text and thought parts alongside audio parts', () => {
      const event = {
        type: 'serverContent.modelTurn',
        data: {
          parts: [
            { text: 'Translating Russian to German', thought: true },
            {
              inlineData: {
                mimeType: 'audio/pcm;rate=24000',
                data: 'B'.repeat(2560),
              },
            },
          ],
        },
      };
      const result = sanitizeEvent(event);
      expect(result.data.parts[0].text).toBe('Translating Russian to German');
      expect(result.data.parts[0].thought).toBe(true);
      expect(result.data.parts[1].inlineData.data).toBe('<audio:1.9KB>');
    });

    it('does not apply audio placeholder when mimeType is not audio', () => {
      const event = {
        inlineData: {
          mimeType: 'image/png',
          data: 'C'.repeat(500), // long base64, but not audio mimeType
        },
      };
      const result = sanitizeEvent(event);
      // Layer 1 does NOT trigger (not audio mimeType)
      // But Layer 2 catches the long base64 string
      expect(result.inlineData.data).toBe(`<base64:${formatBytes(Math.ceil(500 * 3 / 4))}>`);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/stores/sanitizeEvent.test.ts`
Expected: PASS — all Layer 1 tests green

- [ ] **Step 3: Commit**

```bash
git add src/stores/sanitizeEvent.test.ts
git commit -m "test: add Layer 1 Gemini structure-aware sanitization tests (#189)"
```

---

### Task 3: Add Layer 2 tests (generic base64 detection)

**Files:**
- Modify: `src/stores/sanitizeEvent.test.ts`

- [ ] **Step 1: Add generic base64 tests**

Append inside the `sanitizeEvent` describe block:

```ts
  describe('Layer 2: generic base64 detection', () => {
    it('strips long base64 string in OpenAI audio delta field', () => {
      const event = {
        type: 'response.audio.delta',
        delta: 'AAAA'.repeat(200), // 800 chars of base64
      };
      const result = sanitizeEvent(event);
      expect(result.delta).toBe(`<base64:${formatBytes(Math.ceil(800 * 3 / 4))}>`);
      expect(result.type).toBe('response.audio.delta');
    });

    it('preserves text in OpenAI text delta field', () => {
      const event = {
        type: 'response.text.delta',
        delta: 'This is a normal text translation output that should not be stripped.',
      };
      const result = sanitizeEvent(event);
      expect(result.delta).toBe('This is a normal text translation output that should not be stripped.');
    });

    it('strips deeply nested base64 string', () => {
      const event = {
        level1: {
          level2: {
            level3: {
              payload: 'QUFB'.repeat(100), // 400 chars base64
            },
          },
        },
      };
      const result = sanitizeEvent(event);
      expect(result.level1.level2.level3.payload).toBe(
        `<base64:${formatBytes(Math.ceil(400 * 3 / 4))}>`
      );
    });

    it('does not strip short base64-like strings under 200 chars', () => {
      const event = {
        token: 'eyJhbGciOiJIUzI1NiJ9', // short JWT-like, 20 chars
      };
      const result = sanitizeEvent(event);
      expect(result.token).toBe('eyJhbGciOiJIUzI1NiJ9');
    });

    it('does not strip long strings that are not base64', () => {
      const longText = 'Hello world. This is a long human-readable sentence. '.repeat(10);
      const event = { description: longText };
      const result = sanitizeEvent(event);
      expect(result.description).toBe(longText);
    });

    it('strips base64 string passed as top-level primitive', () => {
      const base64Str = 'QUFBQQ=='.repeat(50); // 400 chars
      const result = sanitizeEvent(base64Str);
      expect(result).toBe(`<base64:${formatBytes(Math.ceil(400 * 3 / 4))}>`);
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/stores/sanitizeEvent.test.ts`
Expected: PASS — all Layer 2 tests green

- [ ] **Step 3: Commit**

```bash
git add src/stores/sanitizeEvent.test.ts
git commit -m "test: add Layer 2 generic base64 detection tests (#189)"
```

---

### Task 4: Add Layer 3 tests (field-name rules) and passthrough tests

**Files:**
- Modify: `src/stores/sanitizeEvent.test.ts`

- [ ] **Step 1: Add field-name and passthrough tests**

Append inside the `sanitizeEvent` describe block:

```ts
  describe('Layer 3: field-name rules', () => {
    it('strips long string in known audio field', () => {
      const event = {
        type: 'output_audio_data',
        audio: 'D'.repeat(300), // 300 chars in "audio" field
      };
      const result = sanitizeEvent(event);
      expect(result.audio).toBe(`<audio:${formatBytes(Math.ceil(300 * 3 / 4))}>`);
      expect(result.type).toBe('output_audio_data');
    });

    it('strips large array in known audio field', () => {
      const event = {
        pcmData: new Array(2000).fill(0),
      };
      const result = sanitizeEvent(event);
      expect(result.pcmData).toBe(`<binary:${formatBytes(2000 * 4)}>`);
    });

    it('preserves short values in known audio fields', () => {
      const event = {
        audio: 'ok',
        pcm: 42,
      };
      const result = sanitizeEvent(event);
      expect(result.audio).toBe('ok');
      expect(result.pcm).toBe(42);
    });
  });

  describe('passthrough and edge cases', () => {
    it('passes through events with no audio data unchanged', () => {
      const event = {
        type: 'session.created',
        data: { status: 'connected', provider: 'gemini', model: 'gemini-2.5-flash' },
      };
      const result = sanitizeEvent(event);
      expect(result).toEqual(event);
    });

    it('passes through null and undefined', () => {
      expect(sanitizeEvent(null)).toBeNull();
      expect(sanitizeEvent(undefined)).toBeUndefined();
    });

    it('passes through numbers and booleans', () => {
      expect(sanitizeEvent(42)).toBe(42);
      expect(sanitizeEvent(true)).toBe(true);
    });

    it('handles ArrayBuffer at top level', () => {
      const buf = new ArrayBuffer(1024);
      const result = sanitizeEvent(buf);
      expect(result).toBe('<binary:1.0KB>');
    });

    it('handles TypedArray at top level', () => {
      const arr = new Int16Array(512); // 1024 bytes
      const result = sanitizeEvent(arr);
      expect(result).toBe('<binary:1.0KB>');
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/stores/sanitizeEvent.test.ts`
Expected: PASS — all tests green

- [ ] **Step 3: Commit**

```bash
git add src/stores/sanitizeEvent.test.ts
git commit -m "test: add Layer 3 field-name and passthrough tests (#189)"
```

---

### Task 5: Wire up logStore to use the new module

**Files:**
- Modify: `src/stores/logStore.ts` (lines 155-211 — remove old `sanitizeEvent`; add import at top)

- [ ] **Step 1: Replace inline `sanitizeEvent` with import**

In `src/stores/logStore.ts`, remove the entire `sanitizeEvent` function (lines 155-211) and add an import at the top of the file.

Add this import after the existing imports (after line 7):

```ts
import { sanitizeEvent } from './sanitizeEvent';
```

Remove lines 155-211 (the old `sanitizeEvent` function and its comment).

- [ ] **Step 2: Run the full test suite to verify nothing broke**

Run: `npx vitest run`
Expected: PASS — all tests green including `sanitizeEvent.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/stores/logStore.ts
git commit -m "refactor: use extracted sanitizeEvent module in logStore (#189)"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run lint if configured**

Run: `npm run lint` (if it exists, otherwise skip)
Expected: No new errors
