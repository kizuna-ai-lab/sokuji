# Native Metadata Single-Sourcing — Plan 2: Frontend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the LOCAL_NATIVE renderer onto the sidecar as the single source of model/voice facts: add an explicit sidecar lifecycle, delete the hardcoded catalog/voice tables in `nativeCatalog.ts` and derive everything from `nativeModelStore.catalog`, make the voice control capability-driven (single/range/list speaker-id shapes), and fold in the global native auto-select + Start-button gate fix.

**Architecture:** Depends on **Plan 1** (sidecar) being merged — it provides the complete TTS catalog, the extended `models_catalog` payload, `set_speaker`/`set_voice {sid}`, and `tts_voices.list_builtin_voices()`. This plan changes TypeScript only, except Task 3 which also flips the `list_tts_voices` handler (paired with its renderer consumer so the app never has a broken voice list). Selection logic stays in TS; only its data input changes from hardcoded arrays to the sidecar catalog.

**Tech Stack:** TypeScript, React, Zustand, Vitest. Run renderer tests with `npx vitest run <paths>` (NOT `npm test`). Spec: `docs/superpowers/specs/2026-06-30-native-model-metadata-single-source-design.md`.

## Global Constraints

- Renderer tests: `npx vitest run <paths>`. Never `npm test`.
- Sidecar test (Task 3 only): `cd sidecar && .venv/bin/python -m pytest <path>`.
- English only for code, comments, commits. Conventional-commit messages. Every commit ends with these two trailers verbatim:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS`
- Commits stay LOCAL. Do NOT push, open PRs, or mark anything ready.
- `tsc` is NOT clean repo-wide (~113 pre-existing errors); the correctness gate is vitest, not `tsc`. Do not gate task completion on a clean `tsc`. Each task keeps the app building under Vite/esbuild and its vitest suites green.
- TTS model id = repo path (piper) or `moss-tts-nano`. `ttsVoice` encodes the in-model selection: `builtin:<Name>` / `custom:<id>` (list), `sid:<n>` (range), `''` (single/default).
- Selection logic stays in TS. Data (ids, languages, recommended, order, repo, numSpeakers, clones, voices) comes only from `nativeModelStore.catalog` + `list_tts_voices`.

---

### Task 1: Protocol types — catalog fields, voice descriptor, tts kind

Extend the TS wire types additively so later tasks can consume the richer payload. Nothing breaks: new `NativeModelInfo` fields are optional, `NativeVoiceInfo` is new and unused yet, and `modelsCatalog`'s `kind` widens to include `'tts'`.

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts:8-10` (`NativeModelInfo`), `:47` (`ListTtsVoicesResultMsg`)
- Modify: `src/lib/local-inference/native/NativeModelClient.ts:111-118` (`modelsCatalog` kind), `:136-142` (`listTtsVoices` return)
- Test: `src/lib/local-inference/native/NativeModelClient.test.ts`

**Interfaces:**
- Produces:
  - `NativeModelInfo` gains `order: number; repo: string; kind: 'asr' | 'translate' | 'tts'; numSpeakers?: number; clones?: boolean; streaming?: boolean`.
  - `NativeVoiceInfo { name: string; language?: string; curated: boolean; unstable: boolean; default: boolean }`.
  - `ListTtsVoicesResultMsg.voices: NativeVoiceInfo[]`.
  - `NativeModelClient.modelsCatalog(models?, kind?: 'asr'|'translate'|'tts')`; `listTtsVoices(model?): Promise<NativeVoiceInfo[]>`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/local-inference/native/NativeModelClient.test.ts` (mirror the existing mock-WS pattern in that file; this asserts the client passes `kind: 'tts'` and returns the descriptor array verbatim):

```typescript
import type { NativeVoiceInfo } from './nativeProtocol';

it('requests the tts catalog kind and returns voice descriptors', async () => {
  const client = new NativeModelClient();
  const voices: NativeVoiceInfo[] = [
    { name: 'Ava', language: 'en', curated: true, unstable: false, default: true },
  ];
  // installMockWs is the helper used by the other tests in this file; it captures
  // sent payloads and lets the test resolve replies by message type.
  const ws = installMockWs(client, {
    models_catalog: { type: 'models_catalog_result', models: [] },
    list_tts_voices: { type: 'list_tts_voices_result', voices },
  });
  await client.modelsCatalog(undefined, 'tts');
  expect(ws.lastSent('models_catalog').kind).toBe('tts');
  await expect(client.listTtsVoices('moss-tts-nano')).resolves.toEqual(voices);
});
```

If `NativeModelClient.test.ts` has no `installMockWs`/`lastSent` helper, use the same WS-mocking approach the existing tests in that file already use (read the top of the file) and assert the two behaviours: `kind: 'tts'` is sent and `listTtsVoices` returns the descriptor array.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeModelClient.test.ts`
Expected: FAIL — `modelsCatalog` rejects `'tts'` at the type level / `listTtsVoices` types as `string[]`.

- [ ] **Step 3: Extend the protocol types**

In `src/lib/local-inference/native/nativeProtocol.ts`, replace `NativeModelInfo` (lines 8-10) and add `NativeVoiceInfo`, and change `ListTtsVoicesResultMsg` (line 47):

```typescript
export interface NativeModelInfo {
  id: string; name: string; languages: string[]; recommended: boolean; tiers: NativeTier[];
  order: number; repo: string; kind: 'asr' | 'translate' | 'tts';
  numSpeakers?: number; clones?: boolean; streaming?: boolean;   // tts only
}
export interface NativeVoiceInfo {
  name: string; language?: string; curated: boolean; unstable: boolean; default: boolean;
}
```

```typescript
export interface ListTtsVoicesResultMsg { type: 'list_tts_voices_result'; id: number; voices: NativeVoiceInfo[]; }
```

- [ ] **Step 4: Widen the client methods**

In `src/lib/local-inference/native/NativeModelClient.ts`, change `modelsCatalog` (lines 111-118) and `listTtsVoices` (lines 136-142):

```typescript
  async modelsCatalog(models?: string[], kind?: 'asr' | 'translate' | 'tts'): Promise<NativeModelInfo[]> {
    await this.connect();
    const payload: { type: 'models_catalog'; models?: string[]; kind?: 'asr' | 'translate' | 'tts' } = { type: 'models_catalog' };
    if (models) payload.models = models;
    if (kind) payload.kind = kind;
    const msg = await this.send(payload);
    return (msg as Extract<ServerMsg, { type: 'models_catalog_result' }>).models;
  }
```

```typescript
  /** Built-in TTS voice descriptors for a voice-capable model (empty if not downloaded). */
  async listTtsVoices(model?: string): Promise<NativeVoiceInfo[]> {
    await this.connect();
    const payload: { type: 'list_tts_voices'; model?: string } = { type: 'list_tts_voices' };
    if (model) payload.model = model;
    const msg = await this.send(payload);
    return (msg as Extract<ServerMsg, { type: 'list_tts_voices_result' }>).voices;
  }
```

Add `NativeVoiceInfo` to the type import at the top of the file (line 1).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/NativeModelClient.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/native/nativeProtocol.ts src/lib/local-inference/native/NativeModelClient.ts src/lib/local-inference/native/NativeModelClient.test.ts
git commit -m "feat(native): protocol types for catalog fields + voice descriptors + tts kind

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 2: Store sidecar lifecycle (`sidecarStatus` + `ensureCatalog` + `retrySidecar`)

Add an explicit lifecycle to `nativeModelStore`, fetch the asr+translate+tts catalog through it, and expose a selector. `refreshCatalog` learns the `tts` kind. `ensureCatalog` is the single warm-up entry point; `retrySidecar` re-runs it after failure.

**Files:**
- Modify: `src/stores/nativeModelStore.ts` (interface + initial state + `refreshCatalog` + new actions + selector)
- Test: `src/stores/nativeModelStore.test.ts`

**Interfaces:**
- Consumes: `client.modelsCatalog(models, kind)` with `'tts'` (Task 1).
- Produces:
  - `sidecarStatus: 'idle' | 'starting' | 'ready' | 'unavailable'`.
  - `ensureCatalog(): Promise<void>` — idempotent; `starting`→handshake+fetch asr/translate/tts→`ready`, throw→`unavailable`; returns immediately when already `ready`.
  - `retrySidecar(): Promise<void>` — resets to `idle` then `ensureCatalog()`.
  - `useNativeSidecarStatus()` selector.

- [ ] **Step 1: Write the failing test**

Add to `src/stores/nativeModelStore.test.ts` (the file already mocks `NativeModelClient`; extend that mock so `modelsCatalog` resolves per kind, and `connect`/handshake succeeds):

```typescript
import { useNativeModelStore } from './nativeModelStore';

it('ensureCatalog transitions starting → ready and populates the catalog', async () => {
  // The suite's client mock returns a model per kind from modelsCatalog.
  const store = useNativeModelStore.getState();
  expect(useNativeModelStore.getState().sidecarStatus).toBe('idle');
  const p = store.ensureCatalog();
  expect(useNativeModelStore.getState().sidecarStatus).toBe('starting');
  await p;
  expect(useNativeModelStore.getState().sidecarStatus).toBe('ready');
  expect(Object.keys(useNativeModelStore.getState().catalog).length).toBeGreaterThan(0);
});

it('ensureCatalog goes to unavailable when the catalog fetch throws', async () => {
  // Configure the suite mock so modelsCatalog rejects for this case.
  mockModelsCatalogReject();
  useNativeModelStore.setState({ sidecarStatus: 'idle', catalog: {} });
  await useNativeModelStore.getState().ensureCatalog();
  expect(useNativeModelStore.getState().sidecarStatus).toBe('unavailable');
});

it('ensureCatalog is a no-op once ready (no refetch)', async () => {
  mockModelsCatalogResolve();
  useNativeModelStore.setState({ sidecarStatus: 'ready' });
  const calls = modelsCatalogCallCount();
  await useNativeModelStore.getState().ensureCatalog();
  expect(modelsCatalogCallCount()).toBe(calls);
});
```

`mockModelsCatalogResolve` / `mockModelsCatalogReject` / `modelsCatalogCallCount` are thin helpers over the file's existing `NativeModelClient` mock — add them next to that mock (toggle a module-level flag the mocked `modelsCatalog` reads, and count invocations).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: FAIL — `sidecarStatus` / `ensureCatalog` undefined.

- [ ] **Step 3: Add lifecycle state, actions, and tts-aware refreshCatalog**

In `src/stores/nativeModelStore.ts`, add to the `NativeModelStore` interface (after `catalog`, around line 16):

```typescript
  /** Sidecar lifecycle. Drives every native UI surface that depends on the catalog. */
  sidecarStatus: 'idle' | 'starting' | 'ready' | 'unavailable';
  /** Warm the sidecar and load the full model catalog (asr+translate+tts) + hardware.
   *  Idempotent: returns immediately when already `ready`. Sets `unavailable` on any
   *  failure (no silent catch) so surfaces can show an error + retry. */
  ensureCatalog: () => Promise<void>;
  /** Re-attempt catalog load after `unavailable` (user-triggered retry). */
  retrySidecar: () => Promise<void>;
```

Add the initial value next to the other initial state (where `catalog: {}` is set):

```typescript
  sidecarStatus: 'idle',
```

Replace `refreshCatalog` (lines 90-104) to also fetch the `tts` kind:

```typescript
  refreshCatalog: async (models) => {
    try {
      const [asr, translate, tts] = await Promise.all([
        client.modelsCatalog(models, 'asr'),
        client.modelsCatalog(models, 'translate'),
        client.modelsCatalog(models, 'tts'),
      ]);
      const list = [...asr, ...translate, ...tts];
      set((s) => ({ catalog: { ...s.catalog, ...Object.fromEntries(list.map((m) => [m.id, m])) } }));
    } catch {
      // best-effort badge refresh; ensureCatalog owns the authoritative lifecycle
    }
  },
```

Add the two new actions inside the store (next to `refreshCatalog`):

```typescript
  ensureCatalog: async () => {
    const st = get().sidecarStatus;
    if (st === 'ready' || st === 'starting') return;
    set({ sidecarStatus: 'starting' });
    try {
      // hardwareInfo() drives connect() (native-host:start handshake) and confirms
      // the sidecar answers; the three catalog kinds populate the model map.
      const [asr, translate, tts] = await Promise.all([
        client.modelsCatalog(undefined, 'asr'),
        client.modelsCatalog(undefined, 'translate'),
        client.modelsCatalog(undefined, 'tts'),
      ]);
      const list = [...asr, ...translate, ...tts];
      set({
        catalog: Object.fromEntries(list.map((m) => [m.id, m])),
        sidecarStatus: 'ready',
      });
    } catch {
      set({ sidecarStatus: 'unavailable' });
    }
  },

  retrySidecar: async () => {
    set({ sidecarStatus: 'idle' });
    await get().ensureCatalog();
  },
```

Add the selector near the other exported selectors (around line 229):

```typescript
export const useNativeSidecarStatus = () => useNativeModelStore((s) => s.sidecarStatus);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts
git commit -m "feat(native): sidecar lifecycle (sidecarStatus + ensureCatalog + retrySidecar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 3: Built-in voices single-sourced (handler swap + descriptors end-to-end)

Flip the sidecar `list_tts_voices` handler to descriptors (Plan 1 supplied `list_builtin_voices`), thread `NativeVoiceInfo[]` through the store/section, and rewire `curatedBuiltinVoices` / `defaultTtsVoice` to read descriptor fields. Delete `BUILTIN_VOICE_META` / `DEFAULT_VOICE_BY_LANG`. Done together so the MOSS voice list is never broken between commits.

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_engine.py:187-190` (`_h_list_tts_voices`)
- Modify: `src/stores/nativeModelStore.ts:217-223` (`nativeListTtsVoices`)
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (`curatedBuiltinVoices`, `defaultTtsVoice`; delete `BUILTIN_VOICE_META`, `DEFAULT_VOICE_BY_LANG`)
- Modify: `src/lib/local-inference/native/nativeTtsVoiceReconciliation.ts` (descriptor-aware default — see Task 8 for the shape-aware part; here just keep it compiling)
- Modify: `src/components/Settings/sections/NativeVoiceSection.tsx` (consume descriptors), `src/components/Settings/sections/NativeModelManagementSection.tsx:469,479-481` (`builtinVoices` state type)
- Test: `sidecar/tests/test_tts_engine.py`, `src/lib/local-inference/native/nativeCatalog.test.ts`, `src/components/Settings/sections/NativeVoiceSection.test.tsx`

**Interfaces:**
- Consumes: `tts_voices.list_builtin_voices` (Plan 1 Task 4), `NativeVoiceInfo` (Task 1).
- Produces:
  - `nativeListTtsVoices(model?): Promise<NativeVoiceInfo[]>`.
  - `curatedBuiltinVoices(targetLanguage, voices: NativeVoiceInfo[]): { curated: NativeVoiceInfo[]; rest: NativeVoiceInfo[] }`.
  - `defaultTtsVoice(targetLanguage, voices: NativeVoiceInfo[]): string` — returns `builtin:<name>` of the descriptor with `default && language===tgt`, else `builtin:<first curated>`, else `''`.

- [ ] **Step 1: Write the failing tests**

Sidecar — add to `sidecar/tests/test_tts_engine.py`:

```python
def test_list_tts_voices_returns_descriptors(monkeypatch):
    monkeypatch.setattr("sokuji_sidecar.tts_voices.list_builtin_voices",
                        lambda model=None: [{"name": "Ava", "language": "en",
                                             "curated": True, "unstable": False, "default": True}])
    state = {}; tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["list_tts_voices"](
        state, {"id": 1, "type": "list_tts_voices"}, None, None))
    assert reply["voices"] == [{"name": "Ava", "language": "en",
                                "curated": True, "unstable": False, "default": True}]
```

Renderer — add to `src/lib/local-inference/native/nativeCatalog.test.ts`:

```typescript
import type { NativeVoiceInfo } from './nativeProtocol';

const V = (name: string, language: string | undefined, curated: boolean, def = false): NativeVoiceInfo =>
  ({ name, language, curated, unstable: false, default: def });

it('defaultTtsVoice picks the language default descriptor', () => {
  const voices = [V('Ava', 'en', true, true), V('Bella', 'en', true), V('Saki', 'ja', true, true)];
  expect(defaultTtsVoice('en', voices)).toBe('builtin:Ava');
  expect(defaultTtsVoice('ja', voices)).toBe('builtin:Saki');
});

it('defaultTtsVoice falls back to first curated, then empty', () => {
  expect(defaultTtsVoice('fr', [V('Ava', 'en', true, true)])).toBe('builtin:Ava');
  expect(defaultTtsVoice('fr', [])).toBe('');
});

it('curatedBuiltinVoices splits and orders target-language curated first', () => {
  const voices = [V('Bella', 'en', true), V('Saki', 'ja', true), V('Nathan', 'en', false)];
  const { curated, rest } = curatedBuiltinVoices('en', voices);
  expect(curated.map((v) => v.name)).toEqual(['Bella', 'Saki']);
  expect(rest.map((v) => v.name)).toEqual(['Nathan']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_engine.py::test_list_tts_voices_returns_descriptors -v`
Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — handler returns names; `defaultTtsVoice`/`curatedBuiltinVoices` have the old single-arg signature.

- [ ] **Step 3: Flip the sidecar handler**

In `sidecar/sokuji_sidecar/tts_engine.py`, replace `_h_list_tts_voices` (lines 187-190):

```python
async def _h_list_tts_voices(state, msg, _b, conn=None):
    from . import tts_voices
    voices = tts_voices.list_builtin_voices(msg.get("model"))
    return {"type": "list_tts_voices_result", "id": msg.get("id"), "voices": voices}, None
```

- [ ] **Step 4: Thread descriptors through the store**

In `src/stores/nativeModelStore.ts`, change `nativeListTtsVoices` (lines 217-223) return type to `Promise<NativeVoiceInfo[]>` (import the type), keeping the `[]`-on-error behavior.

- [ ] **Step 5: Rewire `curatedBuiltinVoices` / `defaultTtsVoice`; delete the maps**

In `src/lib/local-inference/native/nativeCatalog.ts`, delete `BUILTIN_VOICE_META` (lines 156-175) and `DEFAULT_VOICE_BY_LANG` (line 177), and replace `defaultTtsVoice` (179-181) and `curatedBuiltinVoices` (187-201):

```typescript
import type { NativeModelInfo, NativeVoiceInfo, VariantInfo } from './nativeProtocol';

/** The per-language default built-in voice ('' when the list is empty). Reads the
 *  sidecar descriptor flagged `default` for the target language; else the first
 *  curated voice; else ''. */
export function defaultTtsVoice(targetLanguage: string, voices: NativeVoiceInfo[]): string {
  const want = canonLang(targetLanguage);
  const def = voices.find((v) => v.default && v.language && canonLang(v.language) === want);
  if (def) return `builtin:${def.name}`;
  const firstCurated = voices.find((v) => v.curated);
  return firstCurated ? `builtin:${firstCurated.name}` : '';
}

/** Split descriptors into curated (shown first; target-language curated before
 *  other curated) and the rest (alphabetical). */
export function curatedBuiltinVoices(
  targetLanguage: string, voices: NativeVoiceInfo[],
): { curated: NativeVoiceInfo[]; rest: NativeVoiceInfo[] } {
  const want = canonLang(targetLanguage);
  const curated = voices.filter((v) => v.curated);
  const rest = voices.filter((v) => !v.curated);
  curated.sort((a, b) => {
    const am = a.language && canonLang(a.language) === want ? 0 : 1;
    const bm = b.language && canonLang(b.language) === want ? 0 : 1;
    return am - bm || a.name.localeCompare(b.name);
  });
  rest.sort((a, b) => a.name.localeCompare(b.name));
  return { curated, rest };
}
```

(`defaultTtsVoice` now needs the voice list at every call site — `nativeTtsVoiceReconciliation.ts` and `NativeVoiceSection.tsx`. Update those next.)

- [ ] **Step 6: Update `NativeVoiceSection` to consume descriptors**

In `src/components/Settings/sections/NativeVoiceSection.tsx`: change the import (drop `BUILTIN_VOICE_META`), change the `builtinVoices` prop type to `NativeVoiceInfo[]`, build entries from descriptor fields (replace the `BUILTIN_VOICE_META[name]?.…` lookups with `v.unstable` / `v.language`), and pass the descriptor list to `defaultTtsVoice(targetLanguage, builtinVoices)`:

```typescript
import type { NativeVoiceInfo } from '../../../lib/local-inference/native/nativeProtocol';
// props: builtinVoices: NativeVoiceInfo[];
  const voices = useMemo<VoiceEntry[]>(() => {
    const { curated, rest } = curatedBuiltinVoices(targetLanguage, builtinVoices);
    const toBuiltin = (v: NativeVoiceInfo, isCurated: boolean): VoiceEntry => ({
      id: `builtin:${v.name}`,
      label: v.name,
      group: 'builtin',
      removable: false,
      meta: { curated: isCurated, unstable: v.unstable, language: v.language },
    });
    const builtinEntries = [
      ...curated.map((v) => toBuiltin(v, true)),
      ...rest.map((v) => toBuiltin(v, false)),
    ];
    const customEntries: VoiceEntry[] = customVoices.map((v) => ({
      id: `custom:${v.id}`, label: v.name, group: 'custom', removable: true,
    }));
    return [...builtinEntries, ...customEntries];
  }, [builtinVoices, customVoices, targetLanguage]);
  // ...
  const selectedId = selected || defaultTtsVoice(targetLanguage, builtinVoices);
```

In `src/components/Settings/sections/NativeModelManagementSection.tsx`, change the `builtinVoices` state type from `string[]` to `NativeVoiceInfo[]` (lines 469, 479-481) and import `NativeVoiceInfo`. Update `NativeVoiceSection.test.tsx` fixtures from `string[]` to descriptor objects.

- [ ] **Step 7: Keep `reconcileTtsVoice` compiling**

In `src/lib/local-inference/native/nativeTtsVoiceReconciliation.ts`, `defaultTtsVoice` now needs a voice list. Pass an empty list for now (Task 8 makes it shape-aware): `return defaultTtsVoice(targetLanguage, []);` at both call sites. This compiles and preserves the "no voices → ''" behaviour; Task 8 supplies the real list + shape.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_engine.py -v`
Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts src/components/Settings/sections/NativeVoiceSection.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_engine.py sidecar/tests/test_tts_engine.py src/stores/nativeModelStore.ts src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeTtsVoiceReconciliation.ts src/components/Settings/sections/NativeVoiceSection.tsx src/components/Settings/sections/NativeModelManagementSection.tsx src/lib/local-inference/native/nativeCatalog.test.ts src/components/Settings/sections/NativeVoiceSection.test.tsx
git commit -m "feat(native): single-source built-in voices as sidecar descriptors

list_tts_voices returns rich descriptors; renderer drops BUILTIN_VOICE_META /
DEFAULT_VOICE_BY_LANG and reads curated/language/default from the sidecar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 4: Derive ASR options from the catalog (delete `NATIVE_ASR`)

Replace the hardcoded `NATIVE_ASR` array with derivation from `nativeModelStore.catalog`. The ASR selection functions take a `catalog` argument.

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (delete `NATIVE_ASR`; `compatibleNativeAsr`, `incompatibleNativeAsr`, `nativeAsrForLanguage`, `asrToCard`, `nativeAsrCards`, `nativeAsrIncompatibleCards`)
- Modify callers: `src/components/Settings/sections/NativeModelManagementSection.tsx` (`nativeAsrCards`/`nativeAsrIncompatibleCards`), `src/stores/settingsStore.ts:1295-1296` (ASR compat check)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Produces: `compatibleNativeAsr(srcLang, catalog)`, `incompatibleNativeAsr(srcLang, catalog)`, `nativeAsrForLanguage(srcLang, current, catalog)`, `nativeAsrCards(srcLang, catalog)`, `nativeAsrIncompatibleCards(srcLang, catalog)` — all returning the same shapes as today, derived from `catalog` entries with `kind === 'asr'`.

- [ ] **Step 1: Write the failing test**

Add to `nativeCatalog.test.ts` (helper to build a catalog fixture):

```typescript
import type { NativeModelInfo } from './nativeProtocol';

const M = (id: string, kind: NativeModelInfo['kind'], languages: string[], order: number,
           recommended = false, extra: Partial<NativeModelInfo> = {}): NativeModelInfo =>
  ({ id, name: id, languages, recommended, tiers: [], order, repo: id, kind, ...extra });

const ASR_CAT = {
  'sense-voice': M('sense-voice', 'asr', ['zh', 'en', 'ja'], 1, true),
  'whisper-large-v3': M('whisper-large-v3', 'asr', ['multi'], 6, true),
  'granite': M('granite', 'asr', ['en', 'fr'], 7),
};

it('compatibleNativeAsr derives from the catalog, recommended+order first', () => {
  const out = compatibleNativeAsr('fr', ASR_CAT).map((m) => m.id);
  expect(out).toEqual(['whisper-large-v3', 'granite']); // multi + fr; recommended first
});

it('nativeAsrForLanguage keeps a still-compatible current, else best compatible', () => {
  expect(nativeAsrForLanguage('zh', 'sense-voice', ASR_CAT)).toBe('sense-voice');
  expect(nativeAsrForLanguage('fr', 'sense-voice', ASR_CAT)).toBe('whisper-large-v3');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — functions take only `srcLang`.

- [ ] **Step 3: Implement catalog-derived ASR helpers**

In `nativeCatalog.ts`, delete `NATIVE_ASR` (lines 41-54). Add a shared deriver and rewrite the ASR functions (replace lines 73-89 and 418-433). `NativeModelInfo` has no `streaming`/`clones` for ASR, so cards map straight from the catalog entry:

```typescript
/** Catalog entries of a kind, recommended-first then `order`. */
function catalogModels(catalog: Record<string, NativeModelInfo>, kind: NativeModelInfo['kind']): NativeModelInfo[] {
  return Object.values(catalog).filter((m) => m.kind === kind)
    .sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended) || a.order - b.order);
}

export function compatibleNativeAsr(srcLang: string, catalog: Record<string, NativeModelInfo>): NativeModelInfo[] {
  return catalogModels(catalog, 'asr').filter((m) => supportsLanguage(m, srcLang));
}
export function incompatibleNativeAsr(srcLang: string, catalog: Record<string, NativeModelInfo>): NativeModelInfo[] {
  return catalogModels(catalog, 'asr').filter((m) => !supportsLanguage(m, srcLang));
}
export function nativeAsrForLanguage(srcLang: string, current: string, catalog: Record<string, NativeModelInfo>): string {
  const cur = catalog[current];
  if (cur && cur.kind === 'asr' && supportsLanguage(cur, srcLang)) return current;
  return compatibleNativeAsr(srcLang, catalog)[0]?.id || current;
}

function infoToCard(m: NativeModelInfo): NativeModelCardSpec {
  return {
    selectId: m.id, downloadId: m.id, name: m.name, languages: m.languages,
    recommended: m.recommended, sortOrder: m.order,
    streaming: m.streaming, clones: m.clones,
  };
}
export function nativeAsrCards(srcLang: string, catalog: Record<string, NativeModelInfo>): NativeModelCardSpec[] {
  return compatibleNativeAsr(srcLang, catalog).map(infoToCard);
}
export function nativeAsrIncompatibleCards(srcLang: string, catalog: Record<string, NativeModelInfo>): NativeModelCardSpec[] {
  return incompatibleNativeAsr(srcLang, catalog).map(infoToCard);
}
```

`supportsLanguage` already accepts `{ languages?: string[] }`; `NativeModelInfo.languages` is `string[]`, so it applies unchanged. Remove the now-unused `NativeModelOption`/`byRecommendedThenOrder`/`asrToCard` if nothing else references them after Tasks 5-6 (leave them until then if translation/tts still use them).

- [ ] **Step 4: Update callers**

- `NativeModelManagementSection.tsx`: it already has `catalog = useNativeCatalog()`; pass it: `nativeAsrCards(settings.sourceLanguage, catalog)` and `nativeAsrIncompatibleCards(settings.sourceLanguage, catalog)`.
- `settingsStore.ts` validateApiKey (lines 1295-1296): this region is rewritten in Task 10. For now, change the ASR compat check to read the store catalog:
  `const cat = (await import('./nativeModelStore')).useNativeModelStore.getState().catalog;`
  `const asrOpt = cat[s.asrModel]; const asrCompatible = !!asrOpt && asrOpt.kind === 'asr' && supportsLanguage(asrOpt, s.sourceLanguage);`
  and drop the `NATIVE_ASR` import.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts src/components/Settings/sections/NativeModelManagementSection.tsx src/stores/settingsStore.ts
git commit -m "refactor(native): derive ASR options from the sidecar catalog (delete NATIVE_ASR)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 5: Derive translation cards from the catalog (delete `NATIVE_TRANSLATION` + `NATIVE_OPUS_PAIRS`)

`nativeTranslationCards(src, tgt)` becomes catalog-derived: multilingual models (`languages` includes `multi`) always show; pair-specific models (Opus-MT, `languages = [src, tgt]`) show only when the pair matches.

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (delete `NATIVE_TRANSLATION` lines 56-66, `NATIVE_OPUS_PAIRS` 441-455; rewrite `nativeTranslationCards` 457-478)
- Modify callers: `NativeModelManagementSection.tsx` (`nativeTranslationCards`), `ProviderSection.tsx` (model-info translation lookup), `settingsStore.ts` (validateApiKey `trCompatible`, Task 10)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Produces: `nativeTranslationCards(src, tgt, catalog): NativeModelCardSpec[]` — multilingual cards (order-sorted) followed by pair-matching Opus cards.

- [ ] **Step 1: Write the failing test**

```typescript
const TR_CAT = {
  'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true),
  'qwen3-0.6b': M('qwen3-0.6b', 'translate', ['multi'], 2, true),
  'opus-mt-zh-en': M('opus-mt-zh-en', 'translate', ['zh', 'en'], 21),
  'opus-mt-en-zh': M('opus-mt-en-zh', 'translate', ['en', 'zh'], 22),
};

it('nativeTranslationCards: multilingual always, opus only for the matching pair', () => {
  const zhEn = nativeTranslationCards('zh', 'en', TR_CAT).map((c) => c.selectId);
  expect(zhEn).toEqual(['qwen2.5-0.5b', 'qwen3-0.6b', 'opus-mt-zh-en']);
  const enZh = nativeTranslationCards('en', 'zh', TR_CAT).map((c) => c.selectId);
  expect(enZh).toEqual(['qwen2.5-0.5b', 'qwen3-0.6b', 'opus-mt-en-zh']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `nativeTranslationCards` ignores the catalog arg / wrong signature.

- [ ] **Step 3: Implement catalog-derived translation cards**

Delete `NATIVE_TRANSLATION` (56-66) and `NATIVE_OPUS_PAIRS` (441-455). Rewrite `nativeTranslationCards`:

```typescript
export function nativeTranslationCards(src: string, tgt: string, catalog: Record<string, NativeModelInfo>): NativeModelCardSpec[] {
  const wantSrc = canonLang(src);
  const wantTgt = canonLang(tgt);
  const all = catalogModels(catalog, 'translate');
  const multilingual = all.filter((m) => m.languages.includes('multi'));
  const pair = all.filter((m) => {
    const ls = m.languages.map(canonLang);
    return !m.languages.includes('multi') && ls[0] === wantSrc && ls[1] === wantTgt;
  });
  return [...multilingual, ...pair].map(infoToCard);
}
```

- [ ] **Step 4: Update callers**

- `NativeModelManagementSection.tsx`: pass `catalog` — `nativeTranslationCards(settings.sourceLanguage, settings.targetLanguage, catalog)`.
- `ProviderSection.tsx`: the model-info translation lookup `nativeTranslationCards(src, tgt).find(...)` → pass the catalog (the component reads `useNativeCatalog()`; add it if absent). This is finalized in Task 13; for now pass `catalog`.
- `settingsStore.ts` `trCompatible`: handled in Task 10.

- [ ] **Step 5: Run tests, then commit**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts src/components/Settings/sections/NativeModelManagementSection.tsx src/components/Settings/sections/ProviderSection.tsx
git commit -m "refactor(native): derive translation cards from the catalog (delete NATIVE_TRANSLATION/OPUS)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 6: Derive TTS cards + voice shape from the catalog (delete `NATIVE_TTS_BY_LANG`/MOSS consts)

TTS cards come from `kind === 'tts'` catalog entries supporting the target language. Add `voiceShape()` (single/range/list) and rewrite the TTS resolver/picker helpers to take the catalog.

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (delete `NATIVE_TTS_BY_LANG` 96-131, `MOSS_NANO_*` 138-144; rewrite `nativeTtsVoices`→`nativeTtsModels`, `pickNativeTts`, `hasNativeTts`, `resolveNativeTts`, `nativeTtsModelIsVoiceCapable`, `nativeTtsCards`; add `voiceShape`)
- Modify callers: `NativeModelManagementSection.tsx` (`nativeTtsCards`, `nativeTtsModelIsVoiceCapable`, `resolveNativeTts`, `pickNativeTts`)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Produces:
  - `voiceShape(info: NativeModelInfo | undefined): 'none' | 'range' | 'list'` — `clones`→list, `numSpeakers>1`→range, else none.
  - `nativeTtsModels(tgt, catalog): NativeModelInfo[]` — tts models supporting `tgt`, order-sorted.
  - `nativeTtsCards(tgt, catalog)`, `resolveNativeTts(choice, tgt, catalog)`, `pickNativeTts(tgt, catalog)`, `hasNativeTts(tgt, catalog)`, `nativeTtsModelIsVoiceCapable(modelId, catalog)`.

- [ ] **Step 1: Write the failing test**

```typescript
const TTS_CAT = {
  'moss-tts-nano': M('moss-tts-nano', 'tts', ['en', 'ja'], 0, true, { clones: true, streaming: true, numSpeakers: 1 }),
  'csukuangfj/vits-piper-en_US-amy-low': M('csukuangfj/vits-piper-en_US-amy-low', 'tts', ['en'], 10, false, { clones: false, numSpeakers: 1 }),
  'csukuangfj/vits-piper-en_US-libritts_r-medium': M('csukuangfj/vits-piper-en_US-libritts_r-medium', 'tts', ['en'], 11, false, { clones: false, numSpeakers: 904 }),
};

it('voiceShape classifies list/range/single', () => {
  expect(voiceShape(TTS_CAT['moss-tts-nano'])).toBe('list');
  expect(voiceShape(TTS_CAT['csukuangfj/vits-piper-en_US-libritts_r-medium'])).toBe('range');
  expect(voiceShape(TTS_CAT['csukuangfj/vits-piper-en_US-amy-low'])).toBe('none');
  expect(voiceShape(undefined)).toBe('none');
});

it('nativeTtsCards lists tts models for the language; resolveNativeTts honors off/valid/default', () => {
  expect(nativeTtsCards('ja', TTS_CAT).map((c) => c.selectId)).toEqual(['moss-tts-nano']);
  expect(resolveNativeTts('off', 'en', TTS_CAT)).toBeUndefined();
  expect(resolveNativeTts('csukuangfj/vits-piper-en_US-amy-low', 'en', TTS_CAT)).toBe('csukuangfj/vits-piper-en_US-amy-low');
  expect(resolveNativeTts('', 'en', TTS_CAT)).toBe('moss-tts-nano'); // recommended/order-first default
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — old signatures, no `voiceShape`.

- [ ] **Step 3: Implement catalog-derived TTS helpers + `voiceShape`**

Delete `NATIVE_TTS_BY_LANG` (96-131) and `MOSS_NANO_LANGS`/`MOSS_NANO_TTS` (138-144). Replace `nativeTtsVoices` (147-150), `nativeTtsModelIsVoiceCapable` (203-206), `pickNativeTts` (214-216), `hasNativeTts` (219-221), `resolveNativeTts` (229-233), `nativeTtsCards` (480-489):

```typescript
export type VoiceShape = 'none' | 'range' | 'list';
/** A TTS model's voice control shape: list (named voices + clones), range
 *  (numeric speaker id 0..N-1), or none (single voice). */
export function voiceShape(info: NativeModelInfo | undefined): VoiceShape {
  if (!info) return 'none';
  if (info.clones) return 'list';
  if ((info.numSpeakers ?? 1) > 1) return 'range';
  return 'none';
}

/** TTS models supporting the target language, recommended+order first. */
export function nativeTtsModels(tgt: string, catalog: Record<string, NativeModelInfo>): NativeModelInfo[] {
  return catalogModels(catalog, 'tts').filter((m) => supportsLanguage(m, tgt));
}
export function nativeTtsCards(tgt: string, catalog: Record<string, NativeModelInfo>): NativeModelCardSpec[] {
  return nativeTtsModels(tgt, catalog).map((m, i) => ({
    selectId: m.id, downloadId: m.id, name: m.name, languages: [tgt],
    recommended: i === 0, sortOrder: m.order, streaming: m.streaming, clones: m.clones,
  }));
}
export function pickNativeTts(tgt: string, catalog: Record<string, NativeModelInfo>): string {
  return nativeTtsModels(tgt, catalog)[0]?.id || '';
}
export function hasNativeTts(tgt: string, catalog: Record<string, NativeModelInfo>): boolean {
  return nativeTtsModels(tgt, catalog).length > 0;
}
export function nativeTtsModelIsVoiceCapable(modelId: string, catalog: Record<string, NativeModelInfo>): boolean {
  return !!catalog[modelId]?.clones;
}
export function resolveNativeTts(choice: string, tgt: string, catalog: Record<string, NativeModelInfo>): string | undefined {
  if (choice === 'off') return undefined;
  if (choice && nativeTtsModels(tgt, catalog).some((m) => m.id === choice)) return choice;
  return pickNativeTts(tgt, catalog) || undefined;
}
```

Delete the now-unused `NativeModelOption`, `byRecommendedThenOrder`, `asrToCard` if no references remain (search the file).

- [ ] **Step 4: Update callers**

In `NativeModelManagementSection.tsx`: pass `catalog` to `nativeTtsCards(settings.targetLanguage, catalog)`, `resolveNativeTts(settings.ttsModel, settings.targetLanguage, catalog)`, and `nativeTtsModelIsVoiceCapable(reserveTtsId, catalog)`. (`reserveTtsId` derives from `resolveNativeTts`.)

- [ ] **Step 5: Run tests, then commit**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts src/components/Settings/sections/NativeModelManagementSection.tsx
git commit -m "refactor(native): derive TTS cards + voiceShape from the catalog (delete NATIVE_TTS_BY_LANG)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 7: `requiredNativeModels` + `autoSelectNative` take the catalog

These two consume the (now catalog-derived) resolvers, so they need the catalog threaded through. `autoSelectNative` already receives `isDownloaded`/`isHardwareGated` closures from the store; add `catalog` for the TTS/translation resolution it does internally.

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (`requiredNativeModels` 249-260; `autoSelectNative` 508+ — wherever it calls `resolveNativeTts`/`nativeTranslationCards`)
- Modify: `src/stores/nativeModelStore.ts:180-196` (`autoSelect` passes `get().catalog`)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`, `src/stores/nativeModelStore.test.ts`

**Interfaces:**
- Produces: `requiredNativeModels(asrModel, translationChoice, ttsChoice, src, tgt, catalog, textOnly?)`; `autoSelectNative(src, tgt, current, catalog, isDownloaded, recalled?, isHardwareGated?)`.

- [ ] **Step 1: Write the failing test**

```typescript
it('requiredNativeModels resolves tts via the catalog', () => {
  expect(requiredNativeModels('sense-voice', '', '', 'en', 'en', { ...ASR_CAT, ...TR_CAT, ...TTS_CAT }))
    .toEqual(['sense-voice', 'qwen2.5-0.5b', 'moss-tts-nano']);
  expect(requiredNativeModels('sense-voice', '', '', 'en', 'en', { ...ASR_CAT, ...TR_CAT, ...TTS_CAT }, true))
    .toEqual(['sense-voice', 'qwen2.5-0.5b']); // textOnly drops tts
});
```

(Read the current `autoSelectNative` body, lines 508-end, and add an `autoSelectNative` test that exercises a stale-translation reconcile for a pair using the catalog — mirror the existing autoSelect tests already in the file, passing the fixture catalog.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — signatures lack `catalog`.

- [ ] **Step 3: Thread `catalog` through both functions**

`requiredNativeModels`:

```typescript
export function requiredNativeModels(
  asrModel: string, translationChoice: string, ttsChoice: string, _src: string, tgt: string,
  catalog: Record<string, NativeModelInfo>, textOnly = false,
): string[] {
  const ids = [asrModel, resolveNativeTranslation(translationChoice) || 'qwen2.5-0.5b'];
  if (!textOnly) {
    const tts = resolveNativeTts(ttsChoice, tgt, catalog);
    if (tts) ids.push(tts);
  }
  return ids;
}
```

In `autoSelectNative`, add `catalog: Record<string, NativeModelInfo>` after `current` and pass it to every internal `resolveNativeTts(...)` / `nativeTranslationCards(...)` call in the body (read lines 508-end to update each call site; the reconcile logic is unchanged).

- [ ] **Step 4: Update the store**

In `nativeModelStore.ts` `autoSelect` (lines 180-196), pass `get().catalog`:

```typescript
    const updates = autoSelectNative(src, tgt, current, catalog, isDownloaded, get().recallModels(src, tgt), isHardwareGated);
```

- [ ] **Step 5: Run tests, then commit**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts src/stores/nativeModelStore.test.ts`
Expected: PASS.

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts
git commit -m "refactor(native): requiredNativeModels + autoSelectNative take the catalog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 8: `ttsVoice` speaker-id encoding (shape-aware reconcile + client + session apply)

Add `sid:<n>` support: reconciliation becomes shape-aware (only `clones` models default to a built-in voice), the TTS client gains `setSpeaker`, and the session apply routes list/range/single correctly. This also fixes the current bug where a piper model receives `builtin:Ava`.

**Files:**
- Modify: `src/lib/local-inference/native/nativeTtsVoiceReconciliation.ts`
- Modify: `src/lib/local-inference/native/NativeTtsClient.ts` (add `setSpeaker`)
- Modify: `src/services/clients/LocalNativeClient.ts:112-119` (shape-aware apply)
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (export `sidFromTtsVoice`/`ttsVoiceForSid`)
- Test: `src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts`, `NativeTtsClient.test.ts`

**Interfaces:**
- Produces:
  - `sidFromTtsVoice(v: string): number` (`sid:5`→5, else 0); `ttsVoiceForSid(n): string` (`sid:<n>`).
  - `reconcileTtsVoice(ttsVoice, customVoiceIds, targetLanguage, voices: NativeVoiceInfo[], clones: boolean): string` — `clones` false → pass through (`''` stays `''`, `sid:n` stays); `clones` true → `''`/dead-custom → `defaultTtsVoice(tgt, voices)`.
  - `NativeTtsClient.setSpeaker(sid: number): Promise<void>` → `set_voice {sid}`.

- [ ] **Step 1: Write the failing tests**

`nativeTtsVoiceReconciliation.test.ts`:

```typescript
import { reconcileTtsVoice } from './nativeTtsVoiceReconciliation';
const ava = [{ name: 'Ava', language: 'en', curated: true, unstable: false, default: true }];

it('non-cloning models pass through (no builtin default)', () => {
  expect(reconcileTtsVoice('', [], 'en', [], false)).toBe('');
  expect(reconcileTtsVoice('sid:3', [], 'en', [], false)).toBe('sid:3');
});
it('cloning models default empty/dead-custom to the language default', () => {
  expect(reconcileTtsVoice('', [], 'en', ava, true)).toBe('builtin:Ava');
  expect(reconcileTtsVoice('custom:9', [], 'en', ava, true)).toBe('builtin:Ava');
  expect(reconcileTtsVoice('custom:9', [9], 'en', ava, true)).toBe('custom:9');
});
```

`NativeTtsClient.test.ts`: assert `setSpeaker(5)` sends `{ type: 'set_voice', sid: 5 }` (mirror the file's existing `setVoice` test).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts src/lib/local-inference/native/NativeTtsClient.test.ts`
Expected: FAIL — old `reconcileTtsVoice` arity; no `setSpeaker`.

- [ ] **Step 3: Implement reconcile + sid helpers + client**

`nativeTtsVoiceReconciliation.ts`:

```typescript
import { defaultTtsVoice } from './nativeCatalog';
import type { NativeVoiceInfo } from './nativeProtocol';

/** Resolve a stored ttsVoice to a concrete in-model selection.
 *  - clones=false (single/range): pass through ('' = default speaker, 'sid:n' = a speaker).
 *  - clones=true (MOSS list): '' or a dead custom id → the language's default built-in. */
export function reconcileTtsVoice(
  ttsVoice: string, customVoiceIds: number[], targetLanguage: string,
  voices: NativeVoiceInfo[], clones: boolean,
): string {
  if (!clones) return ttsVoice;
  if (!ttsVoice) return defaultTtsVoice(targetLanguage, voices);
  if (ttsVoice.startsWith('custom:')) {
    const id = Number(ttsVoice.slice('custom:'.length));
    if (!Number.isFinite(id) || !customVoiceIds.includes(id)) return defaultTtsVoice(targetLanguage, voices);
  }
  return ttsVoice;
}
```

In `nativeCatalog.ts` add:

```typescript
/** sid encoded as the suffix of a `sid:<n>` ttsVoice ('sid:5' → 5; anything else → 0). */
export function sidFromTtsVoice(v: string): number {
  return v.startsWith('sid:') ? (Number(v.slice(4)) || 0) : 0;
}
export function ttsVoiceForSid(n: number): string { return `sid:${n}`; }
```

In `NativeTtsClient.ts` after `setVoice` (line 115):

```typescript
  /** Select a numeric speaker id (range models). */
  async setSpeaker(sid: number): Promise<void> {
    await this.send({ type: 'set_voice', sid });
  }
```

- [ ] **Step 4: Make the session apply shape-aware**

In `src/services/clients/LocalNativeClient.ts`, replace the voice-apply block (lines 108-119). The init result `r` carries `clones`; fetch the model's voice descriptors for the default, and route by encoding:

```typescript
        let customIds: number[] = [];
        try { customIds = (await listNativeVoices()).map((v) => v.id); }
        catch { /* storage unavailable → built-in voices only */ }
        const voiceList = r.clones ? await nativeListTtsVoices(config.ttsModelId) : [];
        const voice = reconcileTtsVoice(config.ttsVoice ?? '', customIds, config.targetLanguage, voiceList, !!r.clones);
        if (voice.startsWith('builtin:')) {
          await this.tts.setVoice?.(voice.slice('builtin:'.length));
        } else if (voice.startsWith('custom:')) {
          const id = Number(voice.slice('custom:'.length));
          const stored = await getNativeVoice(id);
          if (stored) await this.tts.setReferenceVoice(new Float32Array(stored.audio), stored.sampleRate);
        } else if (voice.startsWith('sid:')) {
          await this.tts.setSpeaker(sidFromTtsVoice(voice));
        }
        // else single-voice model: send nothing (backend uses speaker 0)
```

Add imports to `LocalNativeClient.ts`: `nativeListTtsVoices` from `../../stores/nativeModelStore`, and `sidFromTtsVoice` from `../../lib/local-inference/native/nativeCatalog`.

- [ ] **Step 5: Run tests, then commit**

Run: `npx vitest run src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts src/lib/local-inference/native/NativeTtsClient.test.ts src/services/clients/LocalNativeClient.test.ts`
Expected: PASS.

```bash
git add src/lib/local-inference/native/nativeTtsVoiceReconciliation.ts src/lib/local-inference/native/NativeTtsClient.ts src/services/clients/LocalNativeClient.ts src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts src/lib/local-inference/native/NativeTtsClient.test.ts
git commit -m "feat(native): ttsVoice sid:<n> encoding + shape-aware voice apply

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 9: Capability-driven `NativeVoiceSection` (single/range/list)

`NativeVoiceSection` switches on the selected TTS model's `voiceShape`: `list` → the existing `VoiceLibrarySection` dropdown; `range` → a speaker-id slider writing `sid:<n>`; `none` → nothing. Mirrors `LocalInferenceVoiceSection`.

**Files:**
- Modify: `src/components/Settings/sections/NativeVoiceSection.tsx` (add shape switch + slider; new props `shape`, `numSpeakers`)
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx` (pass `shape`/`numSpeakers`; render for `shape !== 'none'`, not only `clones`)
- Test: `src/components/Settings/sections/NativeVoiceSection.test.tsx`

**Interfaces:**
- Consumes: `voiceShape`, `sidFromTtsVoice`, `ttsVoiceForSid` (Tasks 6, 8).
- Produces: `NativeVoiceSection` renders a slider for `shape === 'range'` and the dropdown for `shape === 'list'`.

- [ ] **Step 1: Write the failing test**

Add to `NativeVoiceSection.test.tsx`:

```typescript
it('renders a speaker-id slider for a range model and writes sid:<n>', () => {
  const onSelect = vi.fn();
  render(<NativeVoiceSection {...baseProps} shape="range" numSpeakers={904}
    selected="sid:3" onSelect={onSelect} builtinVoices={[]} />);
  const slider = screen.getByRole('slider');
  expect(slider).toHaveAttribute('max', '903');
  fireEvent.change(slider, { target: { value: '7' } });
  expect(onSelect).toHaveBeenCalledWith('sid:7');
});

it('renders nothing for a single-voice model', () => {
  const { container } = render(<NativeVoiceSection {...baseProps} shape="none" numSpeakers={1} builtinVoices={[]} />);
  expect(container).toBeEmptyDOMElement();
});
```

(`baseProps` supplies the existing required props; add `shape`/`numSpeakers` to the props type.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Settings/sections/NativeVoiceSection.test.tsx`
Expected: FAIL — no `shape` prop / no slider branch.

- [ ] **Step 3: Add the shape switch**

In `NativeVoiceSection.tsx`, add to props: `shape: VoiceShape; numSpeakers?: number;` (import `VoiceShape`, `sidFromTtsVoice`, `ttsVoiceForSid`). Before the existing `return`, add:

```typescript
  if (shape === 'none') return null;

  if (shape === 'range') {
    const max = Math.max(1, (numSpeakers ?? 1) - 1);
    const sid = Math.min(sidFromTtsVoice(selected), max);
    return (
      <div className="setting-item">
        <div className="setting-label">
          <span>{t('settings.ttsSpeakerId', 'Speaker ID')}</span>
          <span className="setting-value">{sid}</span>
        </div>
        <input type="range" min="0" max={max} step="1" value={sid}
          onChange={(e) => onSelect(ttsVoiceForSid(parseInt(e.target.value, 10)))}
          className="slider" disabled={isSessionActive} />
      </div>
    );
  }
  // shape === 'list' falls through to the VoiceLibrarySection dropdown below.
```

- [ ] **Step 4: Update the parent to drive shape**

In `NativeModelManagementSection.tsx`, compute `const ttsShape = voiceShape(catalog[reserveTtsId || '']);` and render the section when `ttsShape !== 'none'` (replacing the `ttsVoiceCapable` gate), passing `shape={ttsShape}` and `numSpeakers={catalog[reserveTtsId || '']?.numSpeakers}`. Keep loading built-in voices only when `ttsShape === 'list'`.

- [ ] **Step 5: Run tests, then commit**

Run: `npx vitest run src/components/Settings/sections/NativeVoiceSection.test.tsx`
Expected: PASS.

```bash
git add src/components/Settings/sections/NativeVoiceSection.tsx src/components/Settings/sections/NativeModelManagementSection.tsx src/components/Settings/sections/NativeVoiceSection.test.tsx
git commit -m "feat(native): capability-driven voice control (single/range/list) with speaker slider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 10: `validateApiKey` LOCAL_NATIVE — `ensureCatalog` gate + global auto-select

Rewrite the LOCAL_NATIVE branch to: warm the sidecar via `ensureCatalog`; if not `ready`, report not-ready with a `starting`/`unavailable`-specific message and never mutate the selection; if `ready`, run `autoSelect` globally, persist via `updateLocalNative`, then gate on the reconciled selection using the catalog-derived compat checks.

**Files:**
- Modify: `src/stores/settingsStore.ts:1278-1343`
- Test: `src/stores/settingsStore.nativeGate.test.ts`

**Interfaces:**
- Consumes: `useNativeModelStore` `ensureCatalog`/`sidecarStatus`/`autoSelect`/`catalog`/`isReady`/`refresh`, and the catalog-derived `nativeTranslationCards`/`requiredNativeModels`/`supportsLanguage`.

- [ ] **Step 1: Write the failing test**

Add to `settingsStore.nativeGate.test.ts` (the suite already mocks the native store; extend the mock with `ensureCatalog`/`sidecarStatus`/`catalog`):

```typescript
it('reports not-ready and does not mutate selection while sidecar is starting', async () => {
  mockNativeSidecar({ status: 'unavailable' }); // ensureCatalog leaves it unavailable
  const before = useSettingsStore.getState().localNative.translationModel;
  const r = await useSettingsStore.getState().validateApiKey();
  expect(r.valid).toBe(false);
  expect(useSettingsStore.getState().localNative.translationModel).toBe(before);
});

it('runs global auto-select when ready and gates on the reconciled pair', async () => {
  mockNativeSidecar({ status: 'ready', catalog: READY_CATALOG, downloaded: ['sense-voice', 'qwen2.5-0.5b'] });
  // stale translation for the new pair → autoSelect reconciles it
  useSettingsStore.setState((s) => ({ localNative: { ...s.localNative,
    sourceLanguage: 'en', targetLanguage: 'zh', asrModel: 'sense-voice', translationModel: 'opus-mt-zh-en' } }));
  const r = await useSettingsStore.getState().validateApiKey();
  expect(useSettingsStore.getState().localNative.translationModel).not.toBe('opus-mt-zh-en');
  expect(r.valid).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/settingsStore.nativeGate.test.ts`
Expected: FAIL — branch still uses the handshake-only path / `NATIVE_ASR`.

- [ ] **Step 3: Rewrite the LOCAL_NATIVE branch**

Replace lines 1280-1343 of `settingsStore.ts`:

```typescript
      if (provider === Provider.LOCAL_NATIVE) {
        const { useNativeModelStore, nativeListVariants } = await import('./nativeModelStore');
        const nstore = useNativeModelStore.getState();
        if (!isElectron()) {
          set({ isApiKeyValid: false, availableModels: [], isValidating: false,
            validationMessage: 'Native sidecar unavailable (desktop app + installed sidecar required)' });
          return { valid: false, message: 'Native sidecar unavailable (desktop app + installed sidecar required)', validating: false };
        }
        // Warm the sidecar + load the catalog. Gate on the lifecycle; never run
        // auto-select on an incomplete/empty catalog.
        await nstore.ensureCatalog();
        const status = useNativeModelStore.getState().sidecarStatus;
        if (status !== 'ready') {
          const message = status === 'unavailable'
            ? i18n.t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings')
            : i18n.t('settings.localNativeStarting', 'Starting the local engine…');
          set({ isApiKeyValid: false, availableModels: [], validationMessage: message, isValidating: false });
          return { valid: false, message, validating: false };
        }
        const catalog = useNativeModelStore.getState().catalog;
        const s0 = get().localNative;
        // Global auto-select: reconcile the stale selection for this pair against
        // the catalog + live download statuses, and persist it (fixes both the
        // Start button and the model-info "None").
        const updates = nstore.autoSelect(s0.sourceLanguage, s0.targetLanguage, {
          asrModel: s0.asrModel, translationModel: s0.translationModel, ttsModel: s0.ttsModel,
        });
        if (updates) get().updateLocalNative(updates);
        const s = get().localNative;
        const asrOpt = catalog[s.asrModel];
        const asrCompatible = !!asrOpt && asrOpt.kind === 'asr' && supportsLanguage(asrOpt, s.sourceLanguage);
        const trCompatible = nativeTranslationCards(s.sourceLanguage, s.targetLanguage, catalog)
          .some((c) => c.selectId === s.translationModel);
        const models = requiredNativeModels(s.asrModel, s.translationModel, s.ttsModel, s.sourceLanguage, s.targetLanguage, catalog, get().textOnly);
        let statusRepos: Record<string, string> | undefined;
        if (s.translationModel.startsWith('hy-mt')) {
          try {
            const reserveTtsId = resolveNativeTts(s.ttsModel, s.targetLanguage, catalog) || null;
            const vd = await nativeListVariants(s.translationModel, s.asrModel || null, reserveTtsId);
            const resolved = statusReposFor([s.translationModel], { [s.translationModel]: vd }, s.translationVariantByModel);
            if (Object.keys(resolved).length > 0) statusRepos = resolved;
          } catch { /* best-effort */ }
        }
        await useNativeModelStore.getState().refresh(models, statusRepos);
        const ready = asrCompatible && trCompatible && useNativeModelStore.getState().isReady(models);
        const message = ready ? ''
          : !asrCompatible ? i18n.t('settings.localNativeAsrIncompatible', 'Select a speech-recognition model for the source language')
          : !trCompatible ? i18n.t('settings.localNativeTranslationIncompatible', 'Select a translation model for this language pair')
          : i18n.t('settings.localNativeModelsRequired', 'Download the native models in settings');
        set({
          isApiKeyValid: ready,
          availableModels: ready ? [{ id: 'native-asr-translate', type: 'realtime' as const, created: 0 }] : [],
          validationMessage: message, isValidating: false,
        });
        return { valid: ready, message, validating: false };
      }
```

Update imports at the top of `settingsStore.ts`: drop `NATIVE_ASR`; ensure `nativeTranslationCards`, `requiredNativeModels`, `resolveNativeTts`, `supportsLanguage`, `statusReposFor` are imported from `nativeCatalog`.

Note: `createSessionConfig` (around line 745) calls `resolveNativeTts(settings.ttsModel, settings.targetLanguage)` — add the `catalog` arg there too: `resolveNativeTts(settings.ttsModel, settings.targetLanguage, useNativeModelStore.getState().catalog)`. Verify every `resolveNativeTts`/`requiredNativeModels`/`nativeTranslationCards` call in this file passes the catalog (grep the file).

- [ ] **Step 4: Run tests, then commit**

Run: `npx vitest run src/stores/settingsStore.nativeGate.test.ts src/stores/settingsStore.test.ts`
Expected: PASS.

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.nativeGate.test.ts
git commit -m "feat(native): global auto-select + sidecar-lifecycle gate in validateApiKey

ensureCatalog warms the sidecar; when ready, auto-select reconciles the pair and
persists it (fixing the Start button + model-info None); starting/unavailable
report distinct messages and never mutate the selection.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 11: `SettingsInitializer` warms the sidecar for LOCAL_NATIVE

Trigger `ensureCatalog` when LOCAL_NATIVE is the active provider so the lifecycle starts (and the UI leaves `idle`) without waiting for a Start click. The existing LOCAL_NATIVE re-validate effect already calls `validateApiKey`, which now calls `ensureCatalog`; this task just guarantees an initial warm-up on provider selection / settings load.

**Files:**
- Modify: `src/components/SettingsInitializer/SettingsInitializer.tsx`
- Test: none new (mirrors the untested LOCAL_INFERENCE init effect; covered indirectly by the Task 10 gate tests).

**Interfaces:**
- Consumes: `useNativeModelStore.getState().ensureCatalog`.

- [ ] **Step 1: Add the warm-up effect**

In `SettingsInitializer.tsx`, in the existing LOCAL_NATIVE effect (added previously, ~lines 154-176), ensure the first action warms the sidecar:

```typescript
  useEffect(() => {
    if (!settingsLoaded || provider !== Provider.LOCAL_NATIVE) return;
    let cancelled = false;
    (async () => {
      const { useNativeModelStore } = await import('../../stores/nativeModelStore');
      await useNativeModelStore.getState().ensureCatalog();
      if (!cancelled) await validateApiKey();
    })();
    return () => { cancelled = true; };
  }, [settingsLoaded, provider, localNativeSettings.sourceLanguage, localNativeSettings.targetLanguage,
      localNativeSettings.asrModel, localNativeSettings.translationModel, localNativeSettings.ttsModel, validateApiKey]);
```

(If the effect already exists with these deps, just prepend the `ensureCatalog()` call before `validateApiKey()`. `ensureCatalog` is idempotent, so an extra call is harmless.)

- [ ] **Step 2: Verify the app builds and the native suites pass**

Run: `npx vitest run src/stores/settingsStore.nativeGate.test.ts`
Expected: PASS (no regression; this is wiring).

- [ ] **Step 3: Commit**

```bash
git add src/components/SettingsInitializer/SettingsInitializer.tsx
git commit -m "feat(native): warm the sidecar (ensureCatalog) on LOCAL_NATIVE provider load

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 12: `NativeModelManagementSection` — lifecycle UI + remove panel-bound auto-select

Subscribe to `sidecarStatus`: show a "starting" skeleton, an "unavailable + retry" error, or the normal cards. Remove the panel-bound auto-select effect (lines ~533) — the global gate (Task 10) now owns reconciliation, so the panel only displays.

**Files:**
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx`
- Test: `src/components/Settings/sections/NativeModelManagementSection.test.tsx` (if present; else add a focused render test)

**Interfaces:**
- Consumes: `useNativeSidecarStatus`, `useNativeModelStore.getState().retrySidecar`.

- [ ] **Step 1: Write the failing test**

Add a render test asserting the starting/unavailable states:

```typescript
it('shows a starting placeholder while the sidecar warms', () => {
  useNativeModelStore.setState({ sidecarStatus: 'starting' });
  render(<NativeModelManagementSection {...props} />);
  expect(screen.getByText(/starting the local engine/i)).toBeInTheDocument();
});

it('shows an error + retry when the sidecar is unavailable', () => {
  const retry = vi.spyOn(useNativeModelStore.getState(), 'retrySidecar');
  useNativeModelStore.setState({ sidecarStatus: 'unavailable' });
  render(<NativeModelManagementSection {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(retry).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: FAIL — no lifecycle UI.

- [ ] **Step 3: Add the lifecycle gate; remove the panel auto-select effect**

Near the top of the section's render, add (using `useNativeSidecarStatus()`):

```tsx
  const sidecarStatus = useNativeSidecarStatus();
  if (sidecarStatus === 'starting' || sidecarStatus === 'idle') {
    return <div className="native-models-loading">{t('settings.localNativeStarting', 'Starting the local engine…')}</div>;
  }
  if (sidecarStatus === 'unavailable') {
    return (
      <div className="native-models-error">
        <span>{t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings')}</span>
        <button type="button" onClick={() => useNativeModelStore.getState().retrySidecar()}>
          {t('common.retry', 'Retry')}
        </button>
      </div>
    );
  }
```

Delete the panel-bound auto-select `useEffect` (around line 533, the one that calls `autoSelect(...)` then `update(...)` and sets `autoSelectedStages`). Keep any "Auto-selected" badge state only if still derivable; otherwise remove the badge too (the global gate now reconciles before the panel renders).

- [ ] **Step 4: Run tests, then commit**

Run: `npx vitest run src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: PASS.

```bash
git add src/components/Settings/sections/NativeModelManagementSection.tsx src/components/Settings/sections/NativeModelManagementSection.test.tsx
git commit -m "feat(native): model panel shows sidecar lifecycle; drop panel-bound auto-select

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 13: `ProviderSection` model-info — starting / unavailable / ready

The model-info line distinguishes "starting…" and "engine unavailable" from a resolved stage list (so it no longer shows a stale "None" while the sidecar warms).

**Files:**
- Modify: `src/components/Settings/sections/ProviderSection.tsx` (the model-info block, ~line 522)
- Test: none new (display wiring; covered by manual app test + the gate tests).

**Interfaces:**
- Consumes: `useNativeSidecarStatus`, `useNativeCatalog`, `nativeTranslationCards` (with catalog).

- [ ] **Step 1: Gate the model-info on lifecycle**

In `ProviderSection.tsx`, where the LOCAL_NATIVE `model-info` renders (~line 522), branch on `useNativeSidecarStatus()`:

```tsx
  const nativeStatus = useNativeSidecarStatus();
  // inside the LOCAL_NATIVE model-info render:
  if (nativeStatus === 'starting' || nativeStatus === 'idle')
    return <div className="model-info">{t('settings.localNativeStarting', 'Starting the local engine…')}</div>;
  if (nativeStatus === 'unavailable')
    return <div className="model-info">{t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings')}</div>;
```

Update the translation lookup to pass the catalog: `nativeTranslationCards(src, tgt, catalog).find((c) => c.selectId === translationModel)`. The "None" text now only appears when ready AND the pair genuinely has no matching card (which the global auto-select makes rare).

- [ ] **Step 2: Verify build + commit**

Run: `npx vitest run src/stores/settingsStore.nativeGate.test.ts` (sanity; no regression).

```bash
git add src/components/Settings/sections/ProviderSection.tsx
git commit -m "feat(native): model-info distinguishes starting/unavailable from a resolved None

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 14: `MainPanel` Start button — surface starting / unavailable

The Start-time re-validate already runs `validateApiKey` for LOCAL_NATIVE (extended earlier) and surfaces `result.message`. Confirm the button is disabled and the message is shown for the `starting`/`unavailable` outcomes, and that `canStartSession` reflects `isApiKeyValid` (which is false in those states).

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (start guard ~1060-1090; `canStartSession` ~426 — verify, adjust only if needed)
- Test: none new (the readiness logic is unit-tested via the Task 10 gate; MainPanel wiring mirrors the untested LOCAL_INFERENCE path).

**Interfaces:**
- Consumes: `validateApiKey` result `message`/`valid` (Task 10).

- [ ] **Step 1: Verify the guard surfaces the message**

In `MainPanel.tsx`, the start handler already calls `validateApiKey()` for `Provider.LOCAL_INFERENCE || Provider.LOCAL_NATIVE` and surfaces `result.message` on failure. Confirm this path shows the `starting`/`unavailable` message (it now comes from Task 10) and aborts start. `canStartSession` (line ~426) gates on `isApiKeyValid`, which Task 10 sets false for non-ready — no change needed unless the guard omits LOCAL_NATIVE.

- [ ] **Step 2: Manual smoke + commit (only if a change was needed)**

If MainPanel already handles both providers identically, no code change is required and this task is a verification checkpoint — note it in the ledger and proceed. If a gap is found (e.g. the message isn't surfaced for LOCAL_NATIVE), apply the minimal fix mirroring the LOCAL_INFERENCE branch and commit:

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "fix(native): surface starting/unavailable message on Start for LOCAL_NATIVE

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

## Final check

- Run the native renderer suites:
  `npx vitest run src/lib/local-inference/native src/stores/nativeModelStore.test.ts src/stores/settingsStore.nativeGate.test.ts src/components/Settings/sections/NativeVoiceSection.test.tsx src/components/Settings/sections/NativeModelManagementSection.test.tsx`
  Expected: PASS.
- Grep for stragglers: `grep -rn "NATIVE_ASR\|NATIVE_TRANSLATION\|NATIVE_TTS_BY_LANG\|NATIVE_OPUS_PAIRS\|BUILTIN_VOICE_META\|DEFAULT_VOICE_BY_LANG\|MOSS_NANO_" src` should return nothing in `src/` (all deleted).
- Manual app smoke (user): select LOCAL_NATIVE; confirm the model panel shows "starting" then cards; reverse the language pair with no compatible translation and confirm the Start button disables + model-info shows the right message (not a stale None); pick a multi-speaker piper model and confirm the speaker slider; pick MOSS and confirm the voice dropdown + custom clones still work.
