# Custom Voice Preview — Frontend Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every custom voice a play button that synthesizes one sentence in that voice, so a user can hear the clone before using it — for Local Native (Electron sidecar) and Kizuna AI (managed Soniox) alike.

**Architecture:** One shared shell change (`VoiceLibrarySection` gains a third render state), one shared sample-language resolver, one shared app-session preview cache, and two implementations behind the existing `VoiceLibrarySource` seam. Local Native synthesizes over its own dedicated sidecar connection and falls back to replaying the reference clip; managed Soniox mints a single-use TTS key from the phase-1 backend, synthesizes, and always reports completion.

**Tech Stack:** React 18 + TypeScript (strict), Zustand, Vitest + jsdom + Testing Library, i18next, SCSS.

**Spec:** `docs/superpowers/specs/2026-09-09-custom-voice-preview-design.md` — §3 (shared layer), §4 (Local Native), §6 (managed), §9 (sequencing), §10 (open items). **Read it before Task 1.** Phase 1 (the backend) is merged and deployed: `kizuna-ai-lab/sokuji-backend` PR #68, merge `9813c210`.

---

## Global Constraints

Every task's requirements implicitly include this section.

1. **English only** in all code, comments, docstrings and commit messages (repo rule, `CLAUDE.md`).
2. **TDD.** Write the failing test, run it and see it fail for the stated reason, then implement. A test that passes before the implementation exists is not a test — delete it and write one that fails.
3. **No `console.error` / `console.warn`** anywhere in `src/`. Failures inside `src/components` surface through existing component state (`setCaptureError`); see `CLAUDE.md`'s Error Handling section. `src/stores` and `src/services` are at zero and a consistency test fails if one comes back.
4. **The preview language is never user-selectable.** No picker, no setting, no override. (Spec §3.)
5. **The preview cache is never persisted.** In-memory, app-session lifetime. No IndexedDB, no localStorage. (Spec §6.)
6. **A preview must not pin or touch the managed voice slot** — no `touch`, no `pin`, no re-ordering of LRU state. (jiangzhuo's ruling, 2026-09-10.)
7. **No TTS sub-quota.** Previews and sessions share the org's 25 TTS slots as-is; do not add client-side rationing. (jiangzhuo's ruling, 2026-09-10.)
8. **Never use `nativeModelStore`'s own connection for TTS.** That singleton is the long-lived model-management channel; closing or re-purposing it breaks model management. (Spec §4.)
9. Run `npx tsc --noEmit` and `npm run test` before every commit. Both must be clean.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/lib/tts/previewSample.ts` | The 28-language sample table (moved verbatim) **plus** `resolvePreviewSample`, the language rule. Shared by both halves. |
| `src/lib/tts/previewSample.test.ts` | Moved from `sonioxPreviewSample.test.ts`, plus the new resolver's cases. |
| `src/lib/tts/previewCache.ts` | App-session preview cache: `get` / `set` / `clear`, key `source\|id\|language\|speed`. |
| `src/lib/tts/previewCache.test.ts` | Lifetime, namespacing and clearing. |
| `src/lib/local-inference/native/nativePreviewTts.ts` | Lazily-created dedicated `NativeTtsClient`; synthesize one sentence; close on demand. |
| `src/lib/local-inference/native/nativePreviewTts.test.ts` | Connection lifetime, ownership recovery, cancellation. |

**Deleted**

| File | Why |
|---|---|
| `src/components/Settings/sections/sonioxPreviewSample.ts` | Moved to `src/lib/tts/previewSample.ts`; it is no longer Soniox-specific. |
| `src/components/Settings/sections/sonioxPreviewSample.test.ts` | Moves with it. |

**Modified**

| File | Change |
|---|---|
| `src/components/Settings/sections/VoiceLibrarySection.tsx` | New `previewUnavailableReason?: string` prop; `renderPreviewButton` becomes three-state. |
| `src/components/Settings/sections/voiceLibrarySource.ts` | `VoiceLibrarySource` gains `preview(...)`; `byokVoiceSource` implements it; `managedVoiceSource.canPreview` becomes `true` and implements it. |
| `src/components/Settings/sections/SonioxVoiceSection.tsx` | `handlePreview` delegates to `source.preview(...)` and to the shared cache; `manageNote` forks BYOK vs managed. |
| `src/components/Settings/sections/NativeVoiceSection.tsx` | New `ttsModelId` / `ttsLanguages` props; `handlePreview` synthesizes and falls back to the clip; passes `previewUnavailableReason` during a session; closes the preview client on unmount. |
| `src/components/Settings/sections/NativeModelManagementSection.tsx` | Threads `ttsModelId` and `ttsLanguages` into `NativeVoiceSection`. |
| `src/services/providers/sonioxManagedMinBalance.ts` | Preview balance floor, mirroring the backend constant. |
| `src/locales/*/translation.json` (or the repo's locale layout) | New copy keys from Tasks 2, 5, 7. |

---

## Shared test fixtures

Tasks 5, 6 and 7 reference these by name. Define each once, in the test file
that first needs it, and import it from there afterwards.

```ts
/** Stands in for NativeTtsClient (Tasks 6, 7). Counts init() so a test can
 *  prove the client stayed warm, and can be told to fail generate() the way
 *  the sidecar does when another connection owns the engine. */
export function fakeTtsClient(opts: {
  failFirstGenerateWith?: string;
  failEveryGenerateWith?: string;
} = {}) {
  let generateCalls = 0;
  return {
    initCalls: 0,
    closed: false,
    async init() { this.initCalls += 1; return { sampleRate: 24000 }; },
    async setVoice() {},
    async setReferenceVoice() {},
    async generate() {
      generateCalls += 1;
      const fail = opts.failEveryGenerateWith
        ?? (generateCalls === 1 ? opts.failFirstGenerateWith : undefined);
      if (fail) throw new Error(fail);
      return { samples: new Float32Array([0.25]), sampleRate: 24000, generationTimeMs: 1 };
    },
    cancel() {},
    close() { this.closed = true; },
  };
}

/** Stands in for the managed backend client (Task 5). Each hook records its
 *  own call so a test can assert ORDER, which is what the finally-block
 *  behaviour turns on. */
export function fakeManagedClient(hooks: {
  sessionKey: (body: { mode: string }) => Promise<{ ttsApiKey: string; region: string }>;
  previewDone: () => Promise<void>;
}) {
  return {
    sessionKey: hooks.sessionKey,
    previewDone: hooks.previewDone,
    list: async () => [],
    create: async () => { throw new Error('unused'); },
    delete: async () => {},
  };
}
```

`close()` on the fake stands for closing the underlying connection; the real
handle calls `conn.close()` through the client it owns.

---

## Task 1: The shared sample table and the language rule

**Files:**
- Create: `src/lib/tts/previewSample.ts`
- Create: `src/lib/tts/previewSample.test.ts`
- Delete: `src/components/Settings/sections/sonioxPreviewSample.ts`, `src/components/Settings/sections/sonioxPreviewSample.test.ts`
- Modify: `src/components/Settings/sections/SonioxVoiceSection.tsx` (import path only, this task)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface PreviewSample { language: string; text: string; }
  export const PREVIEW_SAMPLES: Record<string, string>;
  export function previewSampleFor(language: string): PreviewSample;
  export function resolvePreviewSample(
    targetLanguage: string,
    speaks: ((language: string) => boolean) | null,
  ): PreviewSample | null;
  ```
  `speaks === null` means "this engine speaks anything" (managed Soniox: cloned voices are any-voice-any-language) and makes `resolvePreviewSample` equivalent to `previewSampleFor`. `null` **return** means no preview is possible; the caller renders `previewUnavailableReason`.

- [ ] **Step 1: Move the file verbatim**

`git mv src/components/Settings/sections/sonioxPreviewSample.ts src/lib/tts/previewSample.ts` and the same for the test. Do not edit the table, the sentences, `FALLBACK_LANGUAGE`, or `previewSampleFor`. Update the module docstring's first line from "auditioning a Soniox voice" to "auditioning a custom voice", and fix the import in `SonioxVoiceSection.tsx`. Run `npx tsc --noEmit` — it must be clean before you write a single new line.

- [ ] **Step 2: Write the failing test for the resolver**

```ts
import { describe, it, expect } from 'vitest';
import { resolvePreviewSample, PREVIEW_SAMPLES } from './previewSample';

describe('resolvePreviewSample', () => {
  it('speaks the target language when the engine supports it', () => {
    const r = resolvePreviewSample('ja', (l) => l === 'ja');
    expect(r).toEqual({ language: 'ja', text: PREVIEW_SAMPLES.ja });
  });

  it('falls back to English when the engine cannot speak the target', () => {
    // `ja` IS in the table — this is the case the old English-fallback could
    // not catch, because the fallback only fires on a MISSING table entry.
    const r = resolvePreviewSample('ja', (l) => l === 'en');
    expect(r).toEqual({ language: 'en', text: PREVIEW_SAMPLES.en });
  });

  it("uses the engine's own list when it speaks neither the target nor English", () => {
    const r = resolvePreviewSample('ja', (l) => l === 'ko');
    expect(r).toEqual({ language: 'ko', text: PREVIEW_SAMPLES.ko });
  });

  it('returns null when nothing the engine speaks has a sentence', () => {
    // A family whose only language has no table entry. Synthesising the
    // English text under that code is exactly the text/language mismatch
    // `previewSampleFor`'s pair-return exists to prevent, so refuse instead.
    expect(resolvePreviewSample('ja', (l) => l === 'xx')).toBeNull();
  });

  it('treats a null predicate as "speaks anything"', () => {
    // Managed Soniox: cloned voices are any-voice-any-language, so the rule
    // must collapse to exactly today's behaviour.
    expect(resolvePreviewSample('ja', null)).toEqual({ language: 'ja', text: PREVIEW_SAMPLES.ja });
    expect(resolvePreviewSample('xx', null)).toEqual({ language: 'en', text: PREVIEW_SAMPLES.en });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

`npm run test -- src/lib/tts/previewSample.test.ts`
Expected: FAIL — `resolvePreviewSample is not a function`.

- [ ] **Step 4: Implement the resolver**

```ts
/**
 * Which language a preview speaks.
 *
 * The order is target language, then English, then whatever else the engine
 * offers — and EVERY tier must clear two gates: the engine can speak it, and
 * the table has a sentence for it. Requiring a table entry at each tier is
 * what keeps the mismatch unconstructible: synthesising the English sentence
 * under some other language code is precisely the defect `previewSampleFor`'s
 * pair-return was designed to prevent, and a model reading a sentence with the
 * wrong phonology sounds broken in a way a user would blame on the clone.
 *
 * `speaks === null` means the engine speaks anything, which is managed
 * Soniox's case (cloned voices are documented any-voice-any-language). The
 * rule then collapses to `previewSampleFor` — today's behaviour, unchanged.
 *
 * Returns null when no language clears both gates. That is not an error: the
 * caller renders the disabled control with `previewUnavailableReason` rather
 * than dialling out and failing.
 */
export function resolvePreviewSample(
  targetLanguage: string,
  speaks: ((language: string) => boolean) | null,
): PreviewSample | null {
  if (!speaks) return previewSampleFor(targetLanguage);
  const has = (l: string) => Object.prototype.hasOwnProperty.call(PREVIEW_SAMPLES, l);
  const candidates = [targetLanguage, FALLBACK_LANGUAGE, ...Object.keys(PREVIEW_SAMPLES)];
  for (const l of candidates) {
    if (has(l) && speaks(l)) return { language: l, text: PREVIEW_SAMPLES[l] };
  }
  return null;
}
```

Note the third tier iterates `PREVIEW_SAMPLES`' own keys, not the engine's list: the two are filtered by the same predicate, and iterating the table guarantees a sentence exists for whatever it yields. `hasOwnProperty` rather than `in` for the same reason the existing `previewSampleFor` uses it — a `language` of `"toString"` must not resolve off the prototype chain.

- [ ] **Step 5: Run the tests**

`npm run test -- src/lib/tts/previewSample.test.ts` → PASS.
`npx tsc --noEmit` → clean.

- [ ] **Step 6: Mutation-check the second case**

Temporarily change the loop to skip the `speaks(l)` gate. The "falls back to English when the engine cannot speak the target" test must fail. Restore. If it still passes, the test is not pinning the rule and must be rewritten before you continue.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tts/previewSample.ts src/lib/tts/previewSample.test.ts \
        src/components/Settings/sections/SonioxVoiceSection.tsx
git add -A src/components/Settings/sections/sonioxPreviewSample.ts \
           src/components/Settings/sections/sonioxPreviewSample.test.ts
git commit -m "refactor(tts): share the preview sample table and add the language rule"
```

---

## Task 2: The third render state

**Files:**
- Modify: `src/components/Settings/sections/VoiceLibrarySection.tsx`
- Modify: `src/components/Settings/sections/VoiceLibrarySection.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `previewUnavailableReason?: string` on `VoiceLibrarySectionProps`.

Today `renderPreviewButton` is binary — `if (!onPreview || !v.removable || v.disabled) return null` gives "button" or "no button". Local Native needs a third state: rendered, disabled, explaining why.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders a disabled preview control with the reason when previewing is unavailable', () => {
  render(<VoiceLibrarySection {...baseProps} onPreview={onPreview}
    previewUnavailableReason="Stop the session to preview" />);
  const btn = screen.getByRole('button', { name: 'Stop the session to preview' });
  expect(btn).toBeDisabled();
});

it('never calls onPreview while a reason is set', async () => {
  const onPreview = vi.fn();
  render(<VoiceLibrarySection {...baseProps} onPreview={onPreview}
    previewUnavailableReason="Stop the session to preview" />);
  await userEvent.click(screen.getByRole('button', { name: 'Stop the session to preview' }));
  expect(onPreview).not.toHaveBeenCalled();
});

it('still renders nothing when onPreview is absent, reason or not', () => {
  render(<VoiceLibrarySection {...baseProps} previewUnavailableReason="whatever" />);
  expect(screen.queryByRole('button', { name: /preview|play/i })).toBeNull();
});
```

The third case matters: a reason must not conjure a control for a source that has no preview at all.

- [ ] **Step 2: Run and watch them fail**

`npm run test -- src/components/Settings/sections/VoiceLibrarySection.test.tsx`
Expected: FAIL — no such prop, no disabled button found.

- [ ] **Step 3: Implement**

Add to `VoiceLibrarySectionProps`, immediately after `onPreview`:

```ts
  /** When set, the preview control renders DISABLED with this text as its
   *  label and tooltip, and `onPreview` is never called. Distinct from
   *  omitting `onPreview`, which renders no control at all: "you cannot
   *  preview right now, and here is why" is a different message from "this
   *  source cannot preview". Local Native uses it while a session holds the
   *  sidecar's TTS engine, and when no language the engine speaks has a
   *  sample sentence. */
  previewUnavailableReason?: string;
```

Destructure it, then in `renderPreviewButton`, immediately after the existing early return:

```tsx
    if (previewUnavailableReason) {
      return (
        <button
          type="button"
          className="voice-row-btn"
          disabled
          aria-label={previewUnavailableReason}
          title={previewUnavailableReason}
        >
          <Play size={14} />
        </button>
      );
    }
```

- [ ] **Step 4: Run the tests**

Both new tests PASS; every pre-existing `VoiceLibrarySection` test still passes unedited — this prop is additive and no existing caller sets it.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/VoiceLibrarySection.tsx \
        src/components/Settings/sections/VoiceLibrarySection.test.tsx
git commit -m "feat(voice-library): a third preview state, disabled with a reason"
```

---

## Task 3: The app-session preview cache

**Files:**
- Create: `src/lib/tts/previewCache.ts`, `src/lib/tts/previewCache.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function previewCacheKey(source: string, id: string, language: string, speed: number): string;
  export function getCachedPreview(key: string): { audio: Float32Array; sampleRate: number } | undefined;
  export function setCachedPreview(key: string, value: { audio: Float32Array; sampleRate: number }): void;
  export function clearPreviewCache(): void;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { previewCacheKey, getCachedPreview, setCachedPreview, clearPreviewCache } from './previewCache';

const sample = { audio: new Float32Array([0.1]), sampleRate: 24000 };

describe('previewCache', () => {
  beforeEach(() => clearPreviewCache());

  it('returns what was stored under the same key', () => {
    const k = previewCacheKey('soniox:us', 'v1', 'ja', 1.0);
    setCachedPreview(k, sample);
    expect(getCachedPreview(k)).toBe(sample);
  });

  it('namespaces by source, so the same id under two sources cannot collide', () => {
    // `custom:1` means different clips under different TTS models
    // (voiceStoreFor(custom, modelId)); the old useRef was unambiguous only
    // because it lived inside one section bound to one source.
    const a = previewCacheKey('native:moss_tts_nano', 'custom:1', 'ja', 1.0);
    const b = previewCacheKey('native:supertonic', 'custom:1', 'ja', 1.0);
    setCachedPreview(a, sample);
    expect(getCachedPreview(b)).toBeUndefined();
  });

  it('distinguishes language and speed', () => {
    const k = previewCacheKey('soniox:us', 'v1', 'ja', 1.0);
    setCachedPreview(k, sample);
    expect(getCachedPreview(previewCacheKey('soniox:us', 'v1', 'en', 1.0))).toBeUndefined();
    expect(getCachedPreview(previewCacheKey('soniox:us', 'v1', 'ja', 1.2))).toBeUndefined();
  });

  it('survives across callers, which is the whole point', () => {
    // The cache outlives any one component: a second listen after closing and
    // reopening the panel must not take another lease and spend again.
    const k = previewCacheKey('soniox:us', 'v1', 'ja', 1.0);
    setCachedPreview(k, sample);
    clearPreviewCache();
    expect(getCachedPreview(k)).toBeUndefined();
    setCachedPreview(k, sample);
    expect(getCachedPreview(k)).toBe(sample);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Cached preview audio, for the life of the app session.
 *
 * A synthesized sample is deterministic for a fixed (voice, language, speed),
 * so a repeat listen carries no new information — but it costs. For managed
 * Soniox it spends wallet balance AND takes the account's exclusivity lease
 * for 15-45s, during which a real session start gets a 409. That is why this
 * outlives the component: the old `useRef` inside SonioxVoiceSection was
 * thrown away by closing the panel, switching section or changing provider,
 * and the next listen paid again.
 *
 * DELIBERATELY NOT PERSISTED. Surviving a restart would mean handling "same
 * id, different content", and that failure — a user re-records a reference
 * clip, previews, and hears the OLD clone, concluding the re-record did not
 * take — is worse than paying twice. Within one app session the hazard cannot
 * arise: `NativeVoiceStore` exposes rename/delete/resolveApply and no
 * in-place replacement, so a re-record is always a new id, and a re-cloned
 * managed voice is a new Soniox UUID. Content is immutable per id. That is a
 * property of today's stores rather than a guarantee anyone wrote down, so a
 * store that gains in-place replacement must revisit this.
 */
const cache = new Map<string, { audio: Float32Array; sampleRate: number }>();

/** `source` namespaces the id. Once the cache outlives the section, `id`
 *  alone is ambiguous — `custom:1` is a different clip under a different TTS
 *  model (`voiceStoreFor(custom, modelId)`). */
export function previewCacheKey(source: string, id: string, language: string, speed: number): string {
  return `${source}|${id}|${language}|${speed}`;
}

export function getCachedPreview(key: string) { return cache.get(key); }
export function setCachedPreview(key: string, value: { audio: Float32Array; sampleRate: number }) { cache.set(key, value); }
export function clearPreviewCache(): void { cache.clear(); }
```

- [ ] **Step 4: Run the tests** → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tts/previewCache.ts src/lib/tts/previewCache.test.ts
git commit -m "feat(tts): an app-session preview cache, namespaced by source"
```

---

## Task 4: The `preview` seam and BYOK

**Files:**
- Modify: `src/components/Settings/sections/voiceLibrarySource.ts`, `voiceLibrarySource.test.ts`
- Modify: `src/components/Settings/sections/SonioxVoiceSection.tsx`, `SonioxVoiceSection.test.tsx`

**Interfaces:**
- Consumes: Task 1's `resolvePreviewSample`, Task 3's cache.
- Produces, on `VoiceLibrarySource`:
  ```ts
  /** Synthesize one sample sentence in this voice. Rejects rather than
   *  returning null on failure; the section maps the error to a banner. */
  preview(args: {
    id: string; language: string; text: string; speed: number; signal?: AbortSignal;
  }): Promise<{ audio: Float32Array; sampleRate: number }>;
  /** Namespace for the shared preview cache — distinct per voice project. */
  readonly cacheNamespace: string;
  ```

- [ ] **Step 1: Write the failing test for `byokVoiceSource.preview`**

```ts
it('byokVoiceSource.preview synthesizes through the injected client', async () => {
  const synth = vi.fn(async () => ({ audio: new Float32Array([0.5]), sampleRate: 24000 }));
  const src = byokVoiceSource(fakeClient(), { synthesize: synth, apiKey: 'k', region: 'us' });
  const out = await src.preview({ id: 'v1', language: 'ja', text: 'こんにちは', speed: 1.0 });
  expect(synth).toHaveBeenCalledWith(expect.objectContaining({
    apiKey: 'k', region: 'us', voice: 'v1', language: 'ja', text: 'こんにちは', speed: 1.0,
  }));
  expect(out.sampleRate).toBe(24000);
});
```

Inject `synthesize` (defaulting to the real `synthesizeOnce`) so this is testable without a network fake. Keep the default export shape: `byokVoiceSource(client, ttsDeps)`.

- [ ] **Step 2: Run and watch it fail** — `src.preview is not a function`.

- [ ] **Step 3: Implement `preview` on `byokVoiceSource`**

**This widens an exported signature.** `byokVoiceSource(client)` becomes
`byokVoiceSource(client, ttsDeps)` and `managedVoiceSource(client)` becomes
`managedVoiceSource(client, ttsDeps)` in Task 5. Give `ttsDeps` a default
(`{ synthesize: synthesizeOnce }` plus the key/region the BYOK caller already
holds) so existing call sites compile, then follow `npx tsc --noEmit` to every
one of them rather than grepping. `SonioxVoiceSection` is the only production
caller; the rest are tests.

Move the body of today's `SonioxVoiceSection.handlePreview` `try` block here: it is the same `synthesizeOnce` call with the same arguments. `cacheNamespace` is `` `soniox:${region}` `` — a different region is a different voice project.

- [ ] **Step 4: Rewrite `SonioxVoiceSection.handlePreview` to delegate**

It keeps: the `source?.canPreview` guard, the `clampNumber(settings.ttsSpeed, 0.7, 1.3, 1.0)` clamp, the post-await `sourceRef.current !== requestSource` staleness check, the `aborted` swallow, and `setCaptureError(mapTtsError(e).message)`. It loses: the direct `synthesizeOnce` import and the local `previewCacheRef`.

Language now comes from `resolvePreviewSample(settings.targetLanguage, null)` — `null` because a Soniox clone speaks anything. It cannot return null for a null predicate, but narrow it anyway rather than asserting.

Cache lookups move to Task 3's module with `previewCacheKey(source.cacheNamespace, id, sample.language, speed)`. Keep the existing `useEffect(() => { clearPreviewCache(); }, [source])`.

- [ ] **Step 5: Run the full Soniox section suite**

`npm run test -- src/components/Settings/sections/SonioxVoiceSection.test.tsx`
Every pre-existing test must still pass. If one asserted on the removed `previewCacheRef` internals, rewrite it to assert the observable behaviour (a second preview does not call `synthesize` twice) rather than deleting it.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/voiceLibrarySource.ts \
        src/components/Settings/sections/voiceLibrarySource.test.ts \
        src/components/Settings/sections/SonioxVoiceSection.tsx \
        src/components/Settings/sections/SonioxVoiceSection.test.tsx
git commit -m "refactor(voice): move preview behind the VoiceLibrarySource seam"
```

---

## Task 5: Managed preview

**Files:**
- Modify: `src/components/Settings/sections/voiceLibrarySource.ts`, `voiceLibrarySource.test.ts`
- Modify: `src/components/Settings/sections/SonioxVoiceSection.tsx` (the `manageNote` fork)

**Interfaces:**
- Consumes: Task 4's `preview` signature. The phase-1 backend: `POST /api/soniox/session-key` with `{ mode: 'voice_preview' }` → `{ ttsApiKey, region, ... }` (**no `sttApiKey` for this mode, by design**), and `POST /api/soniox/preview-done` → 204.
- Precedent for the exchange, including its 409 retry: `src/services/clients/ManagedSonioxSession.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it('mints a preview key, synthesizes with ttsApiKey, then reports done', async () => {
  const calls: string[] = [];
  const src = managedVoiceSource(fakeManagedClient({
    sessionKey: async (body) => { calls.push(`key:${body.mode}`); return { ttsApiKey: 'tk', region: 'us' }; },
    previewDone: async () => { calls.push('done'); },
  }), { synthesize: async (a) => { calls.push(`synth:${a.apiKey}`); return { audio: new Float32Array(1), sampleRate: 24000 }; } });

  await src.preview({ id: 'v1', language: 'ja', text: 'x', speed: 1.0 });

  expect(calls).toEqual(['key:voice_preview', 'synth:tk', 'done']);
});

it('reports done even when synthesis throws', async () => {
  const previewDone = vi.fn(async () => {});
  const src = managedVoiceSource(fakeManagedClient({
    sessionKey: async () => ({ ttsApiKey: 'tk', region: 'us' }), previewDone,
  }), { synthesize: async () => { throw new Error('boom'); } });

  await expect(src.preview({ id: 'v1', language: 'ja', text: 'x', speed: 1.0 })).rejects.toThrow('boom');
  expect(previewDone).toHaveBeenCalledTimes(1);
});

it('reports done even when the caller aborts', async () => {
  // A user cancelling is far more common than a crash, and preview-done is
  // what makes the charge prompt and releases the account's lease. If it only
  // ran on success, the common path would leave the lease to expire.
  const previewDone = vi.fn(async () => {});
  const ac = new AbortController();
  const src = managedVoiceSource(fakeManagedClient({
    sessionKey: async () => ({ ttsApiKey: 'tk', region: 'us' }), previewDone,
  }), { synthesize: async () => { ac.abort(); throw new SonioxVoicesError('aborted', 'aborted', 0); } });

  await expect(src.preview({ id: 'v1', language: 'ja', text: 'x', speed: 1.0, signal: ac.signal })).rejects.toBeTruthy();
  expect(previewDone).toHaveBeenCalledTimes(1);
});

it('does not report done when the key was never minted', async () => {
  // Nothing was leased, so there is nothing to complete; a stray call would
  // 404 and, worse, could complete a DIFFERENT preview lease of this account.
  const previewDone = vi.fn(async () => {});
  const src = managedVoiceSource(fakeManagedClient({
    sessionKey: async () => { throw new Error('402'); }, previewDone,
  }), { synthesize: async () => { throw new Error('unreachable'); } });

  await expect(src.preview({ id: 'v1', language: 'ja', text: 'x', speed: 1.0 })).rejects.toBeTruthy();
  expect(previewDone).not.toHaveBeenCalled();
});
```

The last case is the one an implementer is most likely to get wrong by wrapping the whole function in `try/finally`.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

```ts
    async preview({ id, language, text, speed, signal }) {
      // Mint FIRST and outside the try/finally: a mint that failed leased
      // nothing, so there is nothing to complete — and `preview-done` resolves
      // the account's own lease server-side, so a stray call could complete a
      // different in-flight preview of the same account.
      const key = await client.sessionKey({ mode: 'voice_preview' });
      try {
        // `ttsApiKey`, not `sttApiKey`: this mode mints no transcription key
        // at all (backend §5.6), and the field is absent by design.
        return await deps.synthesize({
          apiKey: key.ttsApiKey, region: key.region,
          voice: id, language, text, speed, signal,
        });
      } finally {
        // `finally`, not the success path. This call is the BILLING TRIGGER:
        // it writes the lease's `started_at`, which is what lets the
        // reconciler sweep find it at all, and what releases the account's
        // exclusivity lease instead of leaving it to the 45s backstop. A user
        // cancelling mid-synthesis is the common case, not the rare one.
        //
        // Never rethrows: a failed completion must not mask the synthesis
        // result or replace a useful error with a bookkeeping one. The charge
        // is not lost either way — it is deferred to the next sweep.
        await client.previewDone().catch(() => {});
      }
    },
```

Set `canPreview: true` and replace its comment. `cacheNamespace` is `` `managed:${region}` ``.

- [ ] **Step 4: Error mapping in `SonioxVoiceSection.mapTtsError`**

Add, ahead of the existing arms:
- `402` → `t('voiceLibrary.previewNeedsBalance', 'Top up your balance to preview this voice.')`
- `409` → `t('voiceLibrary.previewSessionRunning', 'A session is running. Try again in a moment.')`
- `503` reuses the existing capacity message.

- [ ] **Step 5: Fork `manageNote`**

BYOK keeps today's "previewing spends your own Soniox quota". Managed gets `t('voiceLibrary.previewChargedToBalance', 'Previewing synthesizes a short sample and is charged to your account balance.')`.

- [ ] **Step 6: Run the suite, `tsc --noEmit`, commit**

```bash
git commit -am "feat(voice): managed preview mints a single-use key and always reports done"
```

---

## Task 6: `nativePreviewTts` on a dedicated connection

**Files:**
- Create: `src/lib/local-inference/native/nativePreviewTts.ts`, `nativePreviewTts.test.ts`

**Interfaces:**
- Consumes: `NativeTtsClient` (`src/lib/local-inference/native/NativeTtsClient.ts`) — `init(model?, device?, language?, variant?)`, `setVoice(name)`, `setReferenceVoice(audio, sampleRate, refText?)`, `generate(text, speed)` (the **non-streaming** overload: omit `onChunk` and it returns the whole `Float32Array`), `cancel()`. Its constructor defaults to `new SidecarConnection()` — **`new NativeTtsClient()` with no argument already IS the dedicated connection this task needs.** Working precedent: `src/components/dev/NativeTtsProto.tsx:60`.
- Produces:
  ```ts
  export interface PreviewTtsHandle {
    synthesize(args: {
      modelId: string; language: string; text: string; speed: number;
      voice: { kind: 'name'; name: string } | { kind: 'clip'; audio: Float32Array; sampleRate: number; refText?: string };
    }): Promise<{ audio: Float32Array; sampleRate: number }>;
    close(): void;
  }
  export function createPreviewTts(make?: () => NativeTtsClient): PreviewTtsHandle;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it('initialises once and reuses the client for a second preview', async () => {
  const client = fakeTtsClient();
  const h = createPreviewTts(() => client);
  await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'alba' } });
  await h.synthesize({ modelId: 'm', language: 'ja', text: 'b', speed: 1, voice: { kind: 'name', name: 'alba' } });
  expect(client.initCalls).toBe(1);   // warm for the sitting: record, listen, re-record, listen again
});

it('re-initialises when the model changes', async () => {
  const client = fakeTtsClient();
  const h = createPreviewTts(() => client);
  await h.synthesize({ modelId: 'm1', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
  await h.synthesize({ modelId: 'm2', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
  expect(client.initCalls).toBe(2);
});

it('recovers from _not_owner_error by re-initialising once and retrying', async () => {
  // Right after a session ends the engine may still record the session's (now
  // closed) connection as owner. The panel cannot observe another
  // connection's ownership, so recovering is the only correct answer —
  // treating it as a failure would show an error for a preview that works on
  // the very next click.
  const client = fakeTtsClient({ failFirstGenerateWith: '_not_owner_error' });
  const h = createPreviewTts(() => client);
  const out = await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
  expect(client.initCalls).toBe(2);
  expect(out.audio.length).toBeGreaterThan(0);
});

it('does not retry a second _not_owner_error', async () => {
  // One recovery, not a loop: a persistent ownership conflict means something
  // else holds the engine and retrying forever would hang the button.
  const client = fakeTtsClient({ failEveryGenerateWith: '_not_owner_error' });
  const h = createPreviewTts(() => client);
  await expect(h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } }))
    .rejects.toThrow(/_not_owner_error/);
  expect(client.initCalls).toBe(2);
});

it('close() closes the connection and the next synthesize starts a new one', async () => {
  const clients = [fakeTtsClient(), fakeTtsClient()];
  let i = 0;
  const h = createPreviewTts(() => clients[i++]);
  await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
  h.close();
  expect(clients[0].closed).toBe(true);
  await h.synthesize({ modelId: 'm', language: 'ja', text: 'a', speed: 1, voice: { kind: 'name', name: 'x' } });
  expect(clients[1].initCalls).toBe(1);
});
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

Hold `client: NativeTtsClient | null` and `loadedModelId: string | null` in a closure. `synthesize` lazily creates the client, `init`s when `loadedModelId !== modelId`, applies the voice, then `generate(text, speed)` with **no `onChunk`** so the one-shot path returns the complete buffer. On a rejection whose message contains `_not_owner_error`, re-`init` once and retry exactly once. `close()` closes the connection, drops the client and clears `loadedModelId`.

Deliberately **not** passing `device` or `variant` to `init`: the sidecar picks its own default, and a preview auditions the *voice*, not the compute placement. Threading the session's pinned variant here would make the panel depend on session state it does not otherwise read, for a difference nobody can hear.

- [ ] **Step 4: Run the tests, `tsc --noEmit`, commit**

```bash
git commit -am "feat(native): preview TTS on its own sidecar connection"
```

---

## Task 7: Wire Local Native

**Files:**
- Modify: `src/components/Settings/sections/NativeVoiceSection.tsx`, `NativeVoiceSection.test.tsx`
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 3, 6.
- `NativeVoiceSectionProps` gains:
  ```ts
  /** Selected TTS model id — `tts_init`'s `model`. */
  ttsModelId: string;
  /** That card's `languages` (from the catalog, `nativeProtocol.ts`'s
   *  NativeModelInfo). Drives the preview language rule. */
  ttsLanguages: string[];
  ```
  `NativeModelManagementSection` already holds the catalog and the selected TTS id; thread both.

- [ ] **Step 1: Write the failing tests**

```tsx
it('synthesizes with the custom voice rather than replaying the clip', async () => {
  const tts = fakeTtsClient();
  renderNativeVoiceSection({ ttsClient: tts, store: storeWithClip({ id: 1 }) });
  await userEvent.click(await screen.findByRole('button', { name: /play/i }));
  // The clip is still read -- it is the reference the clone is built from --
  // but what plays is the SYNTHESIS, so the model must have been asked.
  expect(tts.initCalls).toBe(1);
  await waitFor(() => expect(playedAudio()).toEqual(new Float32Array([0.25])));
});

it('falls back to replaying the reference clip when synthesis fails', async () => {
  // Deliberate, not a consolation prize: replaying answers "did I record
  // clearly?", synthesis answers "does the clone sound like me". Keeping the
  // old path as the failure mode costs nothing and loses nothing.
});

it('disables preview with a reason while a session is active, and never dials out', async () => {
  // The sidecar's TTS engine is a process singleton guarded by `_owner_conn`;
  // a panel-issued tts_generate during a session returns _not_owner_error. So
  // refuse up front instead of failing slowly.
});

it('disables preview with a reason when no language the family speaks has a sample', async () => {
  // `ttsLanguages` names only a code the 28-entry table has no sentence for,
  // so `resolvePreviewSample` returns null and there is nothing to synthesize.
  renderNativeVoiceSection({ ttsLanguages: ['xx'], store: storeWithClip({ id: 1 }) });
  const btn = await screen.findByRole('button', { name: /no sample sentence/i });
  expect(btn).toBeDisabled();
});

it('closes the preview client when the section unmounts', async () => {
  // A resident TTS model is GB-scale; the memory goes back when the user
  // leaves the panel.
});
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

- Hold the handle in a ref: `const previewTtsRef = useRef<PreviewTtsHandle | null>(null)`, created lazily, and `useEffect(() => () => previewTtsRef.current?.close(), [])`.
- `previewUnavailableReason` = `isSessionActive ? t('voiceLibrary.previewNeedsSessionStopped', 'Stop the session to preview this voice.') : sample === null ? t('voiceLibrary.previewLanguageUnsupported', 'This model has no sample sentence in a language it speaks.') : undefined`, where `sample = resolvePreviewSample(targetLanguage, (l) => supportsLanguage({ languages: ttsLanguages }, l))`.
- `handlePreview` resolves the clip via the existing `store.resolveApply(numId)`, picks the voice shape (`clip` for a custom voice, which is what every custom voice is here), calls `previewTtsRef.current.synthesize(...)`, and on **any** rejection returns the clip payload it already resolved — the existing behaviour, now the fallback. `aborted` still returns null silently.
- Keep it inside the shared cache from Task 3 with namespace `` `native:${ttsModelId}` ``.
- Voice-required families need no new branch: `eligibleCustomVoices(customVoices, capability.transcriptRequired)` already marks ineligible rows `disabled`, and a disabled row renders no preview control at all (Task 2's first early return).

- [ ] **Step 4: Run the tests, `tsc --noEmit`, commit**

```bash
git commit -am "feat(native): synthesize a custom-voice preview, falling back to the clip"
```

---

## Task 8: The carried floor and the copy

**Files:**
- Modify: `src/services/providers/sonioxManagedMinBalance.ts` and its test
- Modify: the locale catalogs for every key added in Tasks 2, 5 and 7

- [ ] **Step 1: Mirror the backend's preview balance floor**

`sonioxManagedMinBalance.ts` must state the same number as the backend's `PREVIEW_MIN_SESSION_S`-derived floor and cite it by name, the way the session floor already does. Phase 1 could not exercise this; this is where it becomes reachable. Add a test pinning the literal and a comment naming the backend constant it mirrors, so a drift is a failed test rather than a wrong gate.

- [ ] **Step 2: Add every new key to the English catalog first**

`voiceLibrary.previewNeedsBalance`, `voiceLibrary.previewSessionRunning`, `voiceLibrary.previewChargedToBalance`, `voiceLibrary.previewNeedsSessionStopped`, `voiceLibrary.previewLanguageUnsupported`.

- [ ] **Step 3: Translate into the repo's other locales**

Follow the precedent set in phase 1's dashboard labels: **ja/zh/ko take the product's established *listen* sense** (`試聴` / `试听` / `미리 듣기`) rather than the generic view-rooted loanword. `previewSample.ts`'s own table is TTS input and is NOT i18n — do not touch it.

- [ ] **Step 4: Full suite, both typechecks, commit**

```bash
npm run test
npx tsc --noEmit
git commit -am "feat(voice): preview copy and the managed preview balance floor"
```

---

## Definition of done

- `npm run test` and `npx tsc --noEmit` clean.
- A Local Native custom voice previews by synthesis, and still replays its clip when synthesis fails.
- A managed Soniox clone previews, is charged once, and a second listen in the same app session costs nothing.
- Previewing during a session is a disabled control with a reason, on both halves.
- No preview language picker exists anywhere.
- Nothing persists preview audio to disk.
