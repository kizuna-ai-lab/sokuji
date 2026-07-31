# Soniox Voice Cloning (BYOK) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BYOK Soniox users can clone a voice from a ≤20 s reference (record or upload), manage clones, and select one for TTS; the Kizuna twin gets the same section read-only (built-ins only).

**Architecture:** New protocol piece `SonioxVoicesClient` (REST `/v1/voices` + WAV encoding + readiness polling) beside the STT/TTS streams. New `SonioxVoiceSection` adapter wraps the existing `VoiceLibrarySection` (dropdown presentation) mapping 28 built-ins + fetched clones to `VoiceEntry[]`; consent checkbox and optional name input live in the adapter. `hasVoiceSettings` flips off for Soniox so the generic dropdown disappears. `settings.voice` stores the clone UUID — the TTS pipeline already passes it through verbatim. Spec: `docs/superpowers/specs/2026-07-31-soniox-voice-cloning-byok-design.md`.

**Tech Stack:** TypeScript, React, Vitest (+ @testing-library/react), fetch (mocked in tests), i18next (30 locales).

## Global Constraints

- **Branch/worktree:** `feat/soniox-voice-cloning` in `.claude/worktrees/soniox-voice-clone` (off origin/main). Never push, never open a PR, no bare `git stash`.
- **No wire/session-config changes** — `voice` is already an opaque string end to end.
- **Managed twin:** section renders built-ins only; no fetch, no create/delete affordances (`isKizunaManagedProvider` gate).
- **API facts to honor:** create = multipart `name`+`file` only; list paginated by `limit`/`cursor`; `voice_failed` is terminal (no retry); readiness normally seconds; delete 204 (404 tolerated as success); errors carry `error_type`.
- **Vitest gate:** `npx vitest run <path>`; not tsc. Known worktree-environment "Denied ID …?url" failures are pre-existing.
- **All comments/code in English.** Conventional commits, one per task, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `VoiceLibrarySection` — make `onRename` optional

**Files:**
- Modify: `src/components/Settings/sections/VoiceLibrarySection.tsx` (props at :45-46, rename affordances — grep `onRename` for all use sites)
- Test: `src/components/Settings/sections/VoiceLibrarySection.test.tsx`

**Interfaces:**
- Produces: `onRename?: (id, name) => Promise<void>` — optional; when absent, the rename affordance (inline rename input/button on removable entries, in both list and dropdown-manage presentations) does not render. Existing call sites (`NativeVoiceSection`, `LocalInferenceVoiceSection`) pass it and are unaffected.

- [ ] **Step 1: Write the failing test**

Append to the existing test file (reuse its existing render helpers/fixtures — read the file first and follow its established harness; the new case needs a removable custom entry and NO `onRename` prop):

```tsx
  it('hides the rename affordance when onRename is not provided', () => {
    // Render with a removable custom voice, onDelete present, onRename ABSENT.
    // Assert: the delete control renders for the entry, but no rename
    // input/button exists (query by the rename accessible name / test id the
    // component uses — mirror however the existing rename test locates it).
    // Also assert rendering does not crash.
  });
```

Concretely: copy the file's existing rename-interaction test, drop `onRename` from the props, and invert the assertions (rename control absent, delete still present). Keep the exact queries the existing test uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Settings/sections/VoiceLibrarySection.test.tsx`
Expected: FAIL — TypeScript requires `onRename`, and/or the rename control renders unconditionally.

- [ ] **Step 3: Implement**

- Props: `onRename?: (id: string, name: string) => Promise<void>;` (JSDoc: "Optional — when absent, removable voices cannot be renamed and no rename affordance renders (providers without a rename API, e.g. Soniox clones).").
- At every rename render site (inline input/pencil control in the list presentation and in the dropdown manage panel), wrap with `onRename && (...)`; in the rename submit handler, early-return when `!onRename`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/VoiceLibrarySection.test.tsx src/components/Settings/sections/NativeVoiceSection.test.tsx src/components/Settings/sections/LocalInferenceVoiceSection.test.tsx`
Expected: ALL PASS (both existing adapters unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/VoiceLibrarySection.tsx src/components/Settings/sections/VoiceLibrarySection.test.tsx
git commit -m "feat(voice-library): make onRename optional for providers without a rename API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `SonioxVoicesClient` — REST protocol piece + WAV encoder

**Files:**
- Create: `src/services/clients/SonioxVoicesClient.ts`
- Test: `src/services/clients/SonioxVoicesClient.test.ts`

**Interfaces (Tasks 3-4 rely on these exact names):**

```typescript
export type SonioxVoiceModelStatus = 'not_computed' | 'processing' | 'ready' | 'failed';
export interface SonioxVoice {
  id: string;
  name: string;
  filename?: string;
  created_at?: string;
  models?: Array<{ model: string; status: SonioxVoiceModelStatus; error_type?: string | null; error_message?: string | null }>;
}
export class SonioxVoicesError extends Error { readonly errorType: string; readonly status: number; }
export class SonioxVoicesClient {
  constructor(apiKey: string);
  list(): Promise<SonioxVoice[]>;                       // auto-paginates
  get(id: string): Promise<SonioxVoice>;
  create(name: string, file: Blob, filename?: string): Promise<SonioxVoice>;
  delete(id: string): Promise<void>;                    // 404 tolerated
  waitUntilReady(id: string, opts?: { model?: string; timeoutMs?: number; intervalMs?: number }): Promise<SonioxVoice>;
}
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob;
```

- [ ] **Step 1: Write the failing tests**

Create `src/services/clients/SonioxVoicesClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonioxVoicesClient, SonioxVoicesError, encodeWavPcm16 } from './SonioxVoicesClient';

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); vi.useFakeTimers(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const err = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });
const VOICE = (over: object = {}) => ({
  id: 'v-1', name: 'My Voice',
  models: [{ model: 'tts-rt-v1', status: 'processing', error_type: null, error_message: null }],
  ...over,
});

describe('SonioxVoicesClient', () => {
  it('lists voices with auth header and follows pagination cursors', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ voices: [VOICE({ id: 'a' })], next_page_cursor: 'c2' }))
      .mockResolvedValueOnce(ok({ voices: [VOICE({ id: 'b' })], next_page_cursor: null }));
    const voices = await new SonioxVoicesClient('key-1').list();
    expect(voices.map((v) => v.id)).toEqual(['a', 'b']);
    const [url1, init1] = fetchMock.mock.calls[0];
    expect(String(url1)).toContain('https://api.soniox.com/v1/voices');
    expect(String(url1)).toContain('limit=1000');
    expect((init1.headers as Record<string, string>).Authorization).toBe('Bearer key-1');
    expect(String(fetchMock.mock.calls[1][0])).toContain('cursor=c2');
  });

  it('creates via multipart with exactly name + file and surfaces the created voice', async () => {
    fetchMock.mockResolvedValueOnce(ok(VOICE()));
    const blob = new Blob(['x'], { type: 'audio/wav' });
    const voice = await new SonioxVoicesClient('k').create('My Voice', blob, 'ref.wav');
    expect(voice.id).toBe('v-1');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('name')).toBe('My Voice');
    expect((form.get('file') as File).name).toBe('ref.wav');
    expect([...form.keys()].sort()).toEqual(['file', 'name']);
  });

  it('maps API errors to SonioxVoicesError with error_type', async () => {
    fetchMock.mockResolvedValueOnce(err(409, { error_type: 'voice_name_conflict', message: 'dup' }));
    await expect(new SonioxVoicesClient('k').create('x', new Blob(['y'])))
      .rejects.toMatchObject({ errorType: 'voice_name_conflict', status: 409 });
  });

  it('delete tolerates 404 and rejects other failures', async () => {
    fetchMock.mockResolvedValueOnce(err(404, { error_type: 'voice_not_found', message: 'gone' }));
    await expect(new SonioxVoicesClient('k').delete('v-x')).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(err(500, { error_type: 'internal_error', message: 'boom' }));
    await expect(new SonioxVoicesClient('k').delete('v-x'))
      .rejects.toMatchObject({ errorType: 'internal_error' });
  });

  it('waitUntilReady polls until ready', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(VOICE()))
      .mockResolvedValueOnce(ok(VOICE({ models: [{ model: 'tts-rt-v1', status: 'ready' }] })));
    const p = new SonioxVoicesClient('k').waitUntilReady('v-1', { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(250);
    await expect(p).resolves.toMatchObject({ id: 'v-1' });
  });

  it('waitUntilReady rejects terminally on failed (no retry) and on timeout', async () => {
    fetchMock.mockResolvedValueOnce(ok(VOICE({ models: [{ model: 'tts-rt-v1', status: 'failed', error_message: 'bad clip' }] })));
    await expect(new SonioxVoicesClient('k').waitUntilReady('v-1'))
      .rejects.toMatchObject({ errorType: 'voice_failed' });

    fetchMock.mockResolvedValue(ok(VOICE())); // forever processing
    const p = new SonioxVoicesClient('k').waitUntilReady('v-2', { timeoutMs: 500, intervalMs: 100 });
    const assertion = expect(p).rejects.toMatchObject({ errorType: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});

describe('encodeWavPcm16', () => {
  it('produces a valid RIFF/WAVE mono 16-bit header and round-trips samples', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWavPcm16(samples, 24000);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...buf.slice(8, 12))).toBe('WAVE');
    expect(dv.getUint16(22, true)).toBe(1);            // mono
    expect(dv.getUint32(24, true)).toBe(24000);        // sample rate
    expect(dv.getUint16(34, true)).toBe(16);           // bit depth
    expect(dv.getUint32(40, true)).toBe(samples.length * 2);
    expect(dv.getInt16(44, true)).toBe(0);
    expect(dv.getInt16(46, true)).toBe(Math.round(0.5 * 0x7fff));
    expect(dv.getInt16(50, true)).toBe(0x7fff);        // +1 clamps to max
    expect(dv.getInt16(52, true)).toBe(-0x8000);       // -1 maps to min
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/clients/SonioxVoicesClient.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/services/clients/SonioxVoicesClient.ts`:

```typescript
/**
 * Soniox voice-cloning REST component (`/v1/voices`) — BYOK only: voice
 * MANAGEMENT requires the permanent project key (temporary keys are
 * live-verified 401 on these endpoints; their usage_type enum has no REST
 * scope). USING a cloned voice needs no changes anywhere: `voice` is an
 * opaque string on the TTS wire and tts_rt temporary keys synthesize with
 * cloned UUIDs (live-verified 2026-07-31).
 *
 * Facts honored here (docs + live probes):
 * - create is multipart with exactly `name` (unique per project) + `file`
 *   (reference clip <= 20 s / 10 MB); there are no metadata/owner fields.
 * - readiness is per model: models[].status in
 *   not_computed | processing | ready | failed; `failed` is TERMINAL despite
 *   the API using a 503 for it — recreate, never retry.
 * - The organization-wide quota is 20 voices (all projects combined).
 */

const VOICES_URL = 'https://api.soniox.com/v1/voices';
const TTS_MODEL = 'tts-rt-v1';

export type SonioxVoiceModelStatus = 'not_computed' | 'processing' | 'ready' | 'failed';

export interface SonioxVoice {
  id: string;
  name: string;
  filename?: string;
  created_at?: string;
  models?: Array<{
    model: string;
    status: SonioxVoiceModelStatus;
    error_type?: string | null;
    error_message?: string | null;
  }>;
}

export class SonioxVoicesError extends Error {
  constructor(
    readonly errorType: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'SonioxVoicesError';
  }
}

async function throwApiError(res: Response): Promise<never> {
  let errorType = 'http_error';
  let message = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    errorType = body.error_type ?? errorType;
    message = body.message ?? body.error_message ?? message;
  } catch {
    // non-JSON error body — keep the HTTP fallback
  }
  throw new SonioxVoicesError(errorType, message, res.status);
}

export class SonioxVoicesClient {
  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  /** All voices in the project (auto-paginates; page size 1000). */
  async list(): Promise<SonioxVoice[]> {
    const voices: SonioxVoice[] = [];
    let cursor: string | null = null;
    do {
      const url = new URL(VOICES_URL);
      url.searchParams.set('limit', '1000');
      if (cursor) url.searchParams.set('cursor', cursor);
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) await throwApiError(res);
      const body = await res.json();
      voices.push(...(body.voices ?? []));
      cursor = body.next_page_cursor ?? null;
    } while (cursor);
    return voices;
  }

  async get(id: string): Promise<SonioxVoice> {
    const res = await fetch(`${VOICES_URL}/${id}`, { headers: this.headers() });
    if (!res.ok) await throwApiError(res);
    return res.json();
  }

  async create(name: string, file: Blob, filename = 'reference.wav'): Promise<SonioxVoice> {
    const form = new FormData();
    form.set('name', name);
    form.set('file', file, filename);
    const res = await fetch(VOICES_URL, { method: 'POST', headers: this.headers(), body: form });
    if (!res.ok) await throwApiError(res);
    return res.json();
  }

  /** Deleting an already-gone voice is a success (idempotent cleanup). */
  async delete(id: string): Promise<void> {
    const res = await fetch(`${VOICES_URL}/${id}`, { method: 'DELETE', headers: this.headers() });
    if (!res.ok && res.status !== 404) await throwApiError(res);
  }

  /** Poll until the voice is ready for `model`; `failed` rejects terminally. */
  async waitUntilReady(
    id: string,
    opts: { model?: string; timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<SonioxVoice> {
    const { model = TTS_MODEL, timeoutMs = 60_000, intervalMs = 1500 } = opts;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const voice = await this.get(id);
      const entry = voice.models?.find((m) => m.model === model);
      if (entry?.status === 'ready') return voice;
      if (entry?.status === 'failed') {
        throw new SonioxVoicesError('voice_failed', entry.error_message ?? 'Voice processing failed', 503);
      }
      if (Date.now() >= deadline) {
        throw new SonioxVoicesError('timeout', 'Voice processing timed out', 408);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/** Mono 16-bit PCM WAV from a Float32Array capture (VoiceLibrarySection's
 *  recorder output). Small and local on purpose — zoomApi's encoder emits a
 *  16 kHz data URI for a different wire; sharing would couple the two. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);  // PCM
  dv.setUint16(22, 1, true);  // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeAscii(36, 'data');
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : Math.round(s * 0x7fff), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/clients/SonioxVoicesClient.test.ts`
Expected: PASS (8 tests). If the FormData `init.headers` shape trips the test (Headers instance vs plain object), adjust the test to read via `new Headers(init.headers).get('Authorization')` — keep the implementation as plain object (fetch accepts it, and FormData needs the browser to set the multipart boundary itself — do NOT set Content-Type manually).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxVoicesClient.ts src/services/clients/SonioxVoicesClient.test.ts
git commit -m "feat(soniox): voices REST client with WAV encoding and readiness polling

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `SonioxVoiceSection` adapter component

**Files:**
- Create: `src/components/Settings/sections/SonioxVoiceSection.tsx`
- Test: `src/components/Settings/sections/SonioxVoiceSection.test.tsx`

**Interfaces:**
- Consumes: `VoiceLibrarySection` (optional `onRename` from Task 1), `SonioxVoicesClient`/`encodeWavPcm16`/`SonioxVoicesError` (Task 2), `SonioxProviderConfig` static voices via `new SonioxProviderConfig().getConfig().voices`.
- Produces:

```tsx
export interface SonioxVoiceSectionProps {
  settings: { voice: string; apiKey: string };
  onUpdate: (patch: { voice: string }) => void;
  managed: boolean;          // Kizuna twin: built-ins only, no fetch/create/delete
  isSessionActive: boolean;
}
```

- [ ] **Step 1: Write the failing test**

Create `src/components/Settings/sections/SonioxVoiceSection.test.tsx` (mock the client MODULE; real component; jsdom):

```tsx
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (_k: string, def?: string) => def ?? _k, i18n: { language: 'en' } }),
  };
});

const listMock = vi.fn();
const createMock = vi.fn();
const deleteMock = vi.fn();
const waitMock = vi.fn();
vi.mock('../../../services/clients/SonioxVoicesClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/clients/SonioxVoicesClient')>();
  return {
    ...actual, // keep encodeWavPcm16 + SonioxVoicesError real
    SonioxVoicesClient: vi.fn(function () {
      return { list: listMock, create: createMock, delete: deleteMock, waitUntilReady: waitMock, get: vi.fn() };
    }),
  };
});

const { default: SonioxVoiceSection } = await import('./SonioxVoiceSection');

const READY = { model: 'tts-rt-v1', status: 'ready', error_type: null, error_message: null };
const cloned = (over: object = {}) => ({ id: 'uuid-1', name: 'Me', models: [READY], ...over });

function mount(over: object = {}) {
  const onUpdate = vi.fn();
  const utils = render(
    <SonioxVoiceSection
      settings={{ voice: 'Maya', apiKey: 'k' }}
      onUpdate={onUpdate}
      managed={false}
      isSessionActive={false}
      {...over}
    />
  );
  return { onUpdate, ...utils };
}

describe('SonioxVoiceSection', () => {
  beforeEach(() => {
    listMock.mockReset().mockResolvedValue([]);
    createMock.mockReset();
    deleteMock.mockReset().mockResolvedValue(undefined);
    waitMock.mockReset();
  });

  it('renders the 28 built-ins immediately and cloned voices after fetch', async () => {
    listMock.mockResolvedValue([cloned()]);
    const { container } = mount();
    const select = container.querySelector('select')!;
    expect(select.querySelectorAll('option').length).toBeGreaterThanOrEqual(28);
    await waitFor(() => expect([...select.querySelectorAll('option')].some((o) => o.value === 'uuid-1')).toBe(true));
  });

  it('selecting a cloned voice writes the UUID through onUpdate', async () => {
    listMock.mockResolvedValue([cloned()]);
    const { container, onUpdate } = mount();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    const select = container.querySelector('select')!;
    await waitFor(() => expect([...select.querySelectorAll('option')].some((o) => o.value === 'uuid-1')).toBe(true));
    fireEvent.change(select, { target: { value: 'uuid-1' } });
    expect(onUpdate).toHaveBeenCalledWith({ voice: 'uuid-1' });
  });

  it('shows a deleted-voice placeholder when the stored UUID is not in the fetched list', async () => {
    listMock.mockResolvedValue([]);
    const { container } = mount({ settings: { voice: 'gone-uuid', apiKey: 'k' } });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    const select = container.querySelector('select')!;
    await waitFor(() => {
      const opt = [...select.querySelectorAll('option')].find((o) => o.value === 'gone-uuid');
      expect(opt).toBeTruthy();
    });
    expect(select.value).toBe('gone-uuid'); // stored setting is not rewritten
  });

  it('managed mode renders built-ins only: no fetch, no consent/create affordances', () => {
    const { container } = mount({ managed: true });
    expect(listMock).not.toHaveBeenCalled();
    expect(container.querySelector('#soniox-voice-consent')).toBeNull();
    expect(screen.queryByText(/Record/i)).toBeNull();
  });

  it('marks failed clones and offers no selection benefit (label carries the failed hint)', async () => {
    listMock.mockResolvedValue([cloned({ id: 'bad', name: 'Broken', models: [{ model: 'tts-rt-v1', status: 'failed' }] })]);
    const { container } = mount();
    const select = container.querySelector('select')!;
    await waitFor(() => {
      const opt = [...select.querySelectorAll('option')].find((o) => o.value === 'bad');
      expect(opt?.textContent).toMatch(/failed/i);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Settings/sections/SonioxVoiceSection.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/components/Settings/sections/SonioxVoiceSection.tsx`:

```tsx
/**
 * Soniox voice picker + BYOK voice cloning, wrapping the shared
 * VoiceLibrarySection (dropdown presentation): 28 built-ins as the preset
 * group, cloned voices (fetched live from /v1/voices — Soniox is the sole
 * source of truth) as the custom group. Managed (Kizuna) sessions cannot
 * manage voices (temporary keys are locked out of the REST API), so the twin
 * renders built-ins only; Phase 2 swaps the data source to backend endpoints.
 *
 * Create flow: consent checkbox gates record/upload → WAV-encode (recordings)
 * → POST → poll until ready (seconds) → auto-select. `voice_failed` is
 * terminal: the entry renders a failed hint and can only be deleted.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import {
  SonioxVoicesClient,
  SonioxVoicesError,
  encodeWavPcm16,
  type SonioxVoice,
} from '../../../services/clients/SonioxVoicesClient';
import { SonioxProviderConfig } from '../../../services/providers/SonioxProviderConfig';

export interface SonioxVoiceSectionProps {
  settings: { voice: string; apiKey: string };
  onUpdate: (patch: { voice: string }) => void;
  managed: boolean;
  isSessionActive: boolean;
}

const BUILTIN_VOICES = new SonioxProviderConfig().getConfig().voices;
const TTS_MODEL = 'tts-rt-v1';

function isReady(v: SonioxVoice): boolean {
  return v.models?.some((m) => m.model === TTS_MODEL && m.status === 'ready') ?? false;
}
function isFailed(v: SonioxVoice): boolean {
  return v.models?.some((m) => m.model === TTS_MODEL && m.status === 'failed') ?? false;
}

const SonioxVoiceSection: React.FC<SonioxVoiceSectionProps> = ({
  settings,
  onUpdate,
  managed,
  isSessionActive,
}) => {
  const { t } = useTranslation();
  const [clones, setClones] = useState<SonioxVoice[]>([]);
  const [listState, setListState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [consent, setConsent] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const client = useMemo(
    () => (managed || !settings.apiKey ? null : new SonioxVoicesClient(settings.apiKey)),
    [managed, settings.apiKey]
  );
  // Refresh results landing after unmount (or after the key changed) must not
  // write state; the counter invalidates in-flight loads.
  const loadGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (!client) return;
    const generation = ++loadGeneration.current;
    setListState('loading');
    try {
      const voices = await client.list();
      if (generation !== loadGeneration.current) return;
      setClones(voices);
      setListState('idle');
    } catch {
      if (generation !== loadGeneration.current) return;
      setListState('error');
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    return () => { loadGeneration.current++; };
  }, [refresh]);

  const requireConsent = () => {
    if (!consent) {
      throw new Error(
        t('settings.sonioxVoiceConsentRequired', 'Confirm you have the right to use this voice first')
      );
    }
  };

  const mapCreateError = (e: unknown): Error => {
    if (e instanceof SonioxVoicesError) {
      if (e.errorType === 'voice_name_conflict') {
        return new Error(t('settings.sonioxVoiceNameConflict', 'A voice with this name already exists'));
      }
      if (e.errorType === 'limit_exceeded' || e.status === 429) {
        return new Error(
          t('settings.sonioxVoiceQuotaError', 'Soniox organization voice limit reached — delete a voice and retry')
        );
      }
      if (e.errorType === 'voice_failed') {
        return new Error(t('settings.sonioxVoiceFailed', 'Processing failed — delete this voice and try a clearer clip'));
      }
    }
    return e instanceof Error ? e : new Error(String(e));
  };

  const finishCreate = async (created: SonioxVoice) => {
    try {
      await client!.waitUntilReady(created.id);
    } finally {
      await refresh();
    }
    onUpdate({ voice: created.id });
    setVoiceName('');
  };

  const nextName = () =>
    voiceName.trim() ||
    t('settings.sonioxVoiceDefaultName', 'My Voice {{n}}', { n: clones.length + 1 });

  const onRecord = async (clip: Float32Array, sampleRate: number) => {
    requireConsent();
    try {
      const created = await client!.create(nextName(), encodeWavPcm16(clip, sampleRate));
      await finishCreate(created);
    } catch (e) {
      throw mapCreateError(e);
    }
  };

  const onImport = async (file: File) => {
    requireConsent();
    try {
      const created = await client!.create(voiceName.trim() || file.name.replace(/\.[^.]+$/, ''), file, file.name);
      await finishCreate(created);
    } catch (e) {
      throw mapCreateError(e);
    }
  };

  const onDelete = async (id: string) => {
    await client!.delete(id);
    await refresh();
    // Deliberate in-app deletion of the selected voice falls back to the
    // default built-in; an EXTERNAL deletion only ever shows the placeholder.
    if (settings.voice === id) onUpdate({ voice: 'Maya' });
  };

  const entries = useMemo<VoiceEntry[]>(() => {
    const builtin: VoiceEntry[] = BUILTIN_VOICES.map((v) => ({
      id: v.value,
      label: v.name,
      group: 'builtin',
      removable: false,
    }));
    const custom: VoiceEntry[] = managed
      ? []
      : clones.map((v) => ({
          id: v.id,
          label: isFailed(v)
            ? `${v.name} — ${t('settings.sonioxVoiceFailedBadge', 'failed')}`
            : isReady(v)
              ? v.name
              : `${v.name} — ${t('settings.sonioxVoiceProcessingBadge', 'processing…')}`,
          group: 'custom',
          removable: true,
        }));
    const known = new Set([...builtin, ...custom].map((e) => e.id));
    if (settings.voice && !known.has(settings.voice) && listState !== 'loading') {
      custom.push({
        id: settings.voice,
        label: t('settings.sonioxVoiceDeletedPlaceholder', '(deleted voice)'),
        group: 'custom',
        removable: false,
      });
    }
    return [...builtin, ...custom];
  }, [clones, managed, settings.voice, listState, t]);

  return (
    <div className="settings-section" id="soniox-voice-section">
      <h2>{t('settings.voiceSettings', 'Voice Settings')}</h2>
      {!managed && (
        <div className="setting-item">
          <label className="unlimited-checkbox">
            <input
              id="soniox-voice-consent"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>{t('settings.sonioxVoiceConsent', 'I confirm I have the right to use this voice')}</span>
          </label>
          <input
            id="soniox-voice-name"
            type="text"
            className="text-input"
            placeholder={t('settings.sonioxVoiceNamePlaceholder', 'Name for a new cloned voice (optional)')}
            value={voiceName}
            maxLength={128}
            onChange={(e) => setVoiceName(e.target.value)}
          />
        </div>
      )}
      {listState === 'error' && (
        <div className="setting-item">
          <div className="setting-description">
            {t('settings.sonioxVoiceListError', 'Could not load cloned voices — check the API key.')}{' '}
            <button className="option-button" onClick={() => void refresh()}>
              {t('settings.retry', 'Retry')}
            </button>
          </div>
        </div>
      )}
      <VoiceLibrarySection
        voices={entries}
        selectedId={settings.voice}
        onSelect={(id) => onUpdate({ voice: id })}
        onImport={managed ? undefined : onImport}
        onRecord={managed ? undefined : onRecord}
        onDelete={onDelete}
        capability={{
          importModes: managed ? [] : ['record', 'upload'],
          curation: false,
          presentation: 'dropdown',
          accept: 'audio/*',
          maxClipSeconds: 20,
          minClipSeconds: 3,
        }}
        isSessionActive={isSessionActive}
      />
    </div>
  );
};

export default SonioxVoiceSection;
```

Adjust to the REAL `VoiceLibrarySection` contract while implementing (read it first): if `onDelete` is required even when there are no removable entries, pass the handler unconditionally as above; if entry `meta` is the intended slot for status hints, prefer it over label suffixes — keep the test's `/failed/i` assertion aligned with whichever you choose.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/SonioxVoiceSection.test.tsx src/components/Settings/sections/VoiceLibrarySection.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/SonioxVoiceSection.tsx src/components/Settings/sections/SonioxVoiceSection.test.tsx
git commit -m "feat(soniox): voice section with BYOK cloning over the shared voice library

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Integration — replace the generic dropdown for Soniox

**Files:**
- Modify: `src/services/providers/SonioxProviderConfig.ts` (`hasVoiceSettings` at ~:295 with its comment)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (`renderSonioxSettings` — insert the section FIRST in the fragment, before TtsSpeedControl)
- Test: `src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`

**Interfaces:** consumes `SonioxVoiceSection` (Task 3) and the existing `activeSonioxSettings`/`updateActiveSonioxSettings`/`isKizunaManagedProvider` plumbing already present in the component.

- [ ] **Step 1: Write the failing tests**

Append to `ProviderSpecificSettings.soniox.test.tsx` (mock `./SonioxVoiceSection` with a marker component the same way heavy children are stubbed at the top of the file — add `vi.mock('./SonioxVoiceSection', () => ({ default: (p: any) => <div data-testid="soniox-voice-section" data-managed={String(p.managed)} /> }))`):

```tsx
  it('renders SonioxVoiceSection (managed=false) and no generic voice dropdown for BYOK Soniox', () => {
    const { container, getByTestId } = mount();
    expect(getByTestId('soniox-voice-section').getAttribute('data-managed')).toBe('false');
    // The generic renderVoiceSettings select carried the settings.voice value
    // of a config-listed voice; assert the generic section's select is gone:
    expect(container.querySelector('.model-selection-container')).toBeNull(); // (pre-existing)
    expect(screen.queryByText('Voice Settings')).toBeNull(); // generic section title no longer rendered by renderVoiceSettings
  });

  it('passes managed=true for the Kizuna twin', () => {
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_SONIOX });
    const { getByTestId } = mount();
    expect(getByTestId('soniox-voice-section').getAttribute('data-managed')).toBe('true');
  });
```

(While implementing, verify how the generic voice section's absence is best asserted — `renderVoiceSettings` is gated on `config.capabilities.hasVoiceSettings`; with the mock in place the marker replaces the real section, so asserting the marker + hasVoiceSettings=false covers it. Adjust the second assertion to whatever the generic section uniquely renders if 'Voice Settings' text is ambiguous with the mocked marker.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`
Expected: new cases FAIL (no marker rendered; generic dropdown still present).

- [ ] **Step 3: Implement**

**(a)** `SonioxProviderConfig.ts`: `hasVoiceSettings: false, // voice UI moved to SonioxVoiceSection (built-ins + BYOK clones); the generic dropdown cannot display cloned UUIDs` — the static `VOICES` table STAYS (it feeds the section's builtin group).

**(b)** `ProviderSpecificSettings.tsx` — import `SonioxVoiceSection`, and add as the first element of `renderSonioxSettings`'s fragment:

```tsx
        <SonioxVoiceSection
          settings={activeSonioxSettings}
          onUpdate={updateActiveSonioxSettings}
          managed={isKizunaManagedProvider(provider)}
          isSessionActive={isSessionActive}
        />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx src/services/providers/SonioxProviderConfig.test.ts`
Expected: ALL PASS (the voices guard test from #371 keeps passing — the table is untouched).

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/SonioxProviderConfig.ts src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx
git commit -m "feat(soniox): swap the static voice dropdown for the cloning-aware section

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Locales — new keys × 30 files

The keys (under `settings`, en byte-identical to the inline defaults of Tasks 3):

| Key | en value |
|---|---|
| `sonioxVoiceConsent` | `I confirm I have the right to use this voice` |
| `sonioxVoiceConsentRequired` | `Confirm you have the right to use this voice first` |
| `sonioxVoiceNamePlaceholder` | `Name for a new cloned voice (optional)` |
| `sonioxVoiceDefaultName` | `My Voice {{n}}` |
| `sonioxVoiceDeletedPlaceholder` | `(deleted voice)` |
| `sonioxVoiceProcessingBadge` | `processing…` |
| `sonioxVoiceFailedBadge` | `failed` |
| `sonioxVoiceFailed` | `Processing failed — delete this voice and try a clearer clip` |
| `sonioxVoiceNameConflict` | `A voice with this name already exists` |
| `sonioxVoiceQuotaError` | `Soniox organization voice limit reached — delete a voice and retry` |
| `sonioxVoiceListError` | `Could not load cloned voices — check the API key.` |

Also check whether `settings.retry` and `settings.voiceSettings` already exist in en (both are referenced with inline defaults; `voiceSettings` almost certainly exists from the generic section) — add ONLY missing keys, and if `retry` exists under a different namespace reuse that key in Task 3's code instead (fix the component, not the locale).

- [ ] **Step 1:** en keys after the `sonioxBackground*` block; consistency test RED (29 locales) — proving the guard.
- [ ] **Step 2:** Translate ×29 (native care de/ja/zh_CN/zh_TW; `{{n}}` placeholder MUST survive verbatim in every locale — the consistency test checks placeholder fidelity); insert via job-tmp script (`/home/jiangzhuo/.claude/jobs/6639a1cc/tmp/`).
- [ ] **Step 3:** Consistency test GREEN; `git diff --stat src/locales/` = exactly 30 files.
- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "feat(soniox): locale strings for voice cloning

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full-suite verification

- [ ] **Step 1:** `npx vitest run` — only the known environmental "Denied ID …?url" class may fail (verify anything else against branch base `9ea8e7a3` with an in-place checkout round-trip; tree is clean).
- [ ] **Step 2:** `npm run build`.
- [ ] **Step 3:** Focused re-check: `npx vitest run src/services/clients/ src/components/Settings/sections/ src/locales/`.
- [ ] **Step 4:** Commit only if fixes were needed (`fix(soniox): full-suite fixes for voice cloning`, same footer).

## Out of scope

- Managed-side CRUD (Phase 2: backend dynamic slots per the spec's Future work), rename, recompute UI, preview playback of clones (`onPreview` omitted — clips are not stored locally), the 503 auto-resume (separate PR).
- Pushing / PR — user approval per action.
