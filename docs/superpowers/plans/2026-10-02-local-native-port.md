# Local Native on the Client Contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Local Native (`local_native`, the Electron sidecar provider) onto the client contract — a definition, an adapter, its views and its readiness in `src/providers/local_native/` — so it is offered again (flagged, behind its tester switch, Electron only) as LocalInference's sibling, kizuna-ai-lab/sokuji#578.

**Architecture:** One provider folder modelled on `src/providers/localInference/`. The adapter drives the existing sidecar clients (`src/lib/local-inference/native/Native{Asr,Translate,Tts}Client.ts`) and the existing renderer VAD worker through narrow seams (`engines.ts`); every store-backed thing it needs (voice lists, the hardware probe, the resolved-plan badges) is injected from the definition through `bridge.ts`, so the session side stays store-free. Model resolution and load order move into the builder; readiness is `ensureSelectionReady` over `nativeModelStore`, now fed the provider's own settings instead of the old `settingsStore` slice. The existing native UI (`useNativeEngineAdapter`, `NativeModelManagementSection`, `NativeDeviceControl`, `SlotDeviceBadge`, `StoragePage`'s native half) takes `settings / update / pair` from its host, exactly as the WASM side did for LocalInference. The old path stays compiled and unreachable; deleting it is a later plan, after the owner's live test.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest + Testing Library (jsdom), the sidecar WebSocket protocol (`nativeProtocol.ts`), Silero VAD in a web worker.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — Migration item 10, "Structural gaps", "Parameters and deferred decisions", and the `admit` paragraph (`:2100-2109`). Issue: kizuna-ai-lab/sokuji#578. Roadmap: `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` ("Scheduled by the Stage 2 foundation plan" → "Local Native").

## Rulings this plan takes (the owner may overrule any at review)

Every production comment that needs to justify a choice cites these as `#578 ruling N`.

1. **Place and presence.** `local_native` sits right after `localInference` in `RELEASED` ("Free", then "Free (Native)"), `flagged: true`, `testerSwitch: LOCAL_NATIVE_DEBUG_KEY`, `platforms: ['electron']`, `kind: 'local'`. A release build offers it only with the switch or `VITE_ENABLED_PROVIDERS=local_native`.
2. **Not the third user.** Local Native needs no real-time silence and no re-chunking: the sidecar is local, unbilled and never closes on idle, and it cuts on VAD marks. Audio goes to the sidecar and the VAD worker exactly as it arrives, as today. AST2's and Palabra's rules stay where they are.
3. **`SentenceCut` moves to `src/lib/segmentation/sentenceCut.ts`**, unchanged; LocalInference and Local Native import it from there.
4. **Two legs are refused by `admit`** with no code of its own: the runner's `admit_refused` sentence carries the English detail "Local Native translates one side at a time: choose Me or Other." No new locale key for a tester-only provider.
5. **Readiness says why by code**, each code aliased to the sentence every locale already has (`settings.localNative*`): `native_engine_update_required`, `native_engine_required`, `native_unavailable`, `native_starting`, `native_asr_missing`, `native_translation_missing`. `not-electron` maps to `native_unavailable` (unreachable: the provider is Electron only). Every one targets the `provider` section.
6. **The new provider owns `settings.localNative.*`.** `check` never prunes. `nativeModelStore` stops writing the old slice (`applyPrunes` goes), stops re-running the old `validateApiKey` (`revalidateNativeProvider` goes: `watchReadiness` re-checks instead), and reads selections from its caller, not from `settingsStore`. The old `validateApiKey` arm passes its own slice and mode in and no longer prunes. Otherwise the old path could write a stale copy over the user's new choices — both read and write the same keys.
7. **Settings keep the old slice's field names** under `settings.localNative.*`, so every saved value is read as is, with no migration code. `sourceLanguage` / `targetLanguage` / `turnDetectionMode` leave `S` (the global pair and turn mode already read them). One new field: `participantSystemPrompt` (default `''`), LocalInference's rule for the reverse direction.
8. **Translation streams into its segment.** The sidecar's `translate_partial` pushes open the translation segment and update it; the result replaces the text. A failed translation closes what streamed and says `translation_failed`.
9. **Speech ranges.** One-shot synthesis: one ranged clip per sentence. Streaming synthesis: each chunk as it arrives, unranged, and the sentence's range divided among its chunks by sample count (`tileSpan`) once the sentence ends (`speechRanges`), Soniox's method.
10. **Failures by effect.** ASR's or translation's socket closing, or the VAD worker failing after it is ready, ends the session (`failed`). TTS failing to load, dying, or a clone-only model with no clip: `tts_degraded`, text goes on. An id-less ASR error: `transcription_failed`; an id-less translation error: `translation_failed`. Departure: the old client reported a TTS load failure as session-broken.
11. **The old path and its gates stay.** `VITE_ENABLE_LOCAL_NATIVE`, `isLocalNativeEnabled()`, the old settings shell, `LocalNativeClient` and the `localNative` slice are untouched except where this plan names them; deleting them is the next plan, after the owner's live test (owner's rule, 2026-09-26).
12. **The first-run wizard is unchanged:** it does not offer a flagged provider.
13. **Voice previews take the app's route.** `ProviderEngine` hands its `Engine` the app's preview port; `LocalNativeEngine` provides it as `VoicePreviewContext`, as `SonioxSettings` does.
14. **Resolved plans travel through the bridge.** The adapter reports each stage's resolved device through an injected `host.plan(...)`, which the definition wires to `nativeModelStore`'s `set*Resolved`. Loading flags are not written: nothing outside the old client reads them, and the adapter's `loading` events replace them.
15. **Load order is the builder's:** `asrFirst` from the catalog's tiers and sizes (GPU-only first, else the larger), as the old client decided it inside `connect()`.
16. **`check` passes `textOnly: false`.** TTS never gates readiness; refreshing its status keeps the library's badges accurate.

## Global Constraints

- English in code, comments, commit messages and docs (`CLAUDE.md`: "English-only for all comments and documentation").
- Production comments cite rulings, choices or issue numbers (`#578 ruling N`), never reviews, findings, tasks or plans.
- No one-time migration code: a stored value is read as is, or falls to its default.
- Failures are recorded with `reportError` / `reportWarning` (`src/lib/diagnostics/report.ts`), never `console.error` / `console.warn`. An adapter never calls `report()` or `console.*`: it says `failed`, `degraded` or `frame` (`CLAUDE.md`, "Inside an adapter session").
- An adapter's session side (`adapter.ts` and every file in its folder it value-imports) imports no `src/stores/**` module, no `lib/diagnostics/report`, and runs no global timer, `Date.now()` or `performance.now()`: timers read `request.clock` (`src/providers/sessionSide.consistency.test.ts`).
- No file outside the old path value-imports `src/services/{clients,providers,interfaces}/**`, except the four shared leaves (`src/providers/oldPath.consistency.test.ts`).
- Audio crosses the contract at 24 kHz mono `Int16` (`SAMPLE_RATE`, `src/lib/contract/adapter.ts`).
- `stop()` ends every engine before its first `await` (`AdapterSession.stop`).
- Every adapter test asserts `checkConformance(log, context)` is `[]`.
- Commits: conventional format, pathspec only (`git commit -- <paths>`), ending with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe` on its own line.
- Gates at the end of every task: `npx vitest run src` (baseline on `a75b3825`: 543 + 1 files, 6777 + 2 tests, 0 failed), `npx vitest run electron extension` (43 files / 533 tests), and `npx tsc --noEmit -p tsconfig.json` with no error that the baseline (95 errors) does not already have. Save the baseline once before Task 1: `npx tsc --noEmit -p tsconfig.json > /tmp/lnp-tsc-base.txt 2>&1`.

## Review Focus

The inputs the spec implies that no task's tests would otherwise exercise, most likely first. Each has its test in the owning task.

1. **The sidecar dies mid-session** (ASR's socket closes): a person expects the session to end with a notice, not a silent session that transcribes nothing. Task 7, "a closed ASR socket fails the session".
2. **Readiness that churns:** `check` refreshes model statuses, and `watchReadiness` listens to the store — a person expects one re-check per real change, not a loop every 150 ms. Task 4, "a refresh that changes nothing does not call back".
3. **Both legs selected:** a person expects a clear refusal at Start, never a run whose two legs fight over one engine. Task 3, "admit refuses two legs".
4. **A saved selection from the old slice:** a person who picked models before expects them still picked. Task 3, "reads the old slice's saved fields as they are" (settings keys), and Task 10, "the provider's storage prefix is the old slice's".
5. **Stop during a streaming synthesis:** a person expects silence at once and no late audio. Task 7, "stop during a streaming sentence emits nothing after".

---

## File Structure

**Create — `src/providers/local_native/`:**
- `settings.ts` — `S` (`LocalNativeSettings`), defaults, the narrow `NativeEngineSettings` the native UI edits, `NativeEngineOverride`, the languages.
- `config.ts` — `C` (`LocalNativeConfig`), `buildLocalNative`, `describeLocalNative`, `admitLocalNative`, `asrLoadsFirst`.
- `check.ts` — `checkLocalNative`, `watchLocalNativeReadiness`, the reason → code table.
- `engines.ts` — the seams the adapter drives, and `nativeEngines` over the real clients and the VAD worker (session side).
- `voice.ts` — the clone-only gate and the voice to apply (session side; stores injected).
- `speech.ts` — one translation spoken sentence by sentence, ranged (session side).
- `adapter.ts` — `createLocalNativeAdapter(engines, host)` (session side).
- `fakeEngines.ts` — test-only fakes for every seam and the host.
- `bridge.ts` — the store-backed host the definition hands the adapter (not session side).
- `LocalNativeEngine.tsx`, `LocalNativeEngineSummary.tsx`, `LocalNativeSettings.tsx`, `LocalNativeTurnDetection.tsx` — the views.
- `provider.ts` — the definition.
- Tests beside each: `settings.test.ts`, `config.test.ts`, `check.test.ts`, `engines.test.ts`, `voice.test.ts`, `speech.test.ts`, `adapter.test.ts`, `LocalNativeEngine.test.tsx`, `LocalNativeEngineSummary.test.tsx`, `LocalNativeSettings.test.tsx`, `LocalNativeTurnDetection.test.tsx`, `provider.test.ts`.

**Move:**
- `src/providers/localInference/sentenceCut.ts` (+ test) → `src/lib/segmentation/sentenceCut.ts` (+ test).
- `src/services/clients/createNativeVadWorker.ts` → `src/lib/local-inference/native/createNativeVadWorker.ts`.

**Modify:**
- `src/stores/nativeModelStore.ts` (+ test) — readiness input, no prunes, pins from the provider store, no old re-validation.
- `src/stores/settingsStore.ts` — the old `validateApiKey` arm passes selections and mode.
- `src/services/clients/LocalNativeClient.ts` — the moved VAD factory's path.
- `src/providers/localInference/adapter.ts` — `SentenceCut`'s new path.
- `src/components/Settings/engine/useNativeEngineAdapter.ts`, `SlotDeviceBadge.tsx`, `StoragePage.tsx`, `src/components/Settings/sections/NativeModelManagementSection.tsx`, `NativeDeviceControl.tsx` (+ their tests) — `settings / update / pair` from the host.
- `src/components/Settings/sections/ProviderSpecificSettings.tsx` — the old shell passes its slice (it stays unmounted).
- `src/components/providers/ProviderOwnSettings.tsx` — `ProviderEngine` passes the preview port.
- `src/lib/view/noticeText.ts`, `src/lib/view/noticeTargets.ts` — the readiness codes.
- `src/providers/registry.ts`, `registry.test.ts`, `src/providers/localInference/provider.test.ts`, `src/providers/sessionSide.consistency.test.ts`.
- `CLAUDE.md`, `CONTEXT.md`, the roadmap.

---
### Task 1: `SentenceCut` moves to `src/lib/segmentation/`

**Files:**
- Move: `src/providers/localInference/sentenceCut.ts` → `src/lib/segmentation/sentenceCut.ts`
- Move: `src/providers/localInference/sentenceCut.test.ts` → `src/lib/segmentation/sentenceCut.test.ts`
- Modify: `src/providers/localInference/adapter.ts:19`
- Modify: `src/providers/sessionSide.consistency.test.ts:178-185`, `:305-309`

**Interfaces:**
- Consumes: nothing new.
- Produces: `import { SentenceCut, runtimeOver, PUNCTUATION_BUDGET_MS, type SentenceCutOptions } from '../../lib/segmentation/sentenceCut'` — the exports are unchanged: `runtimeOver(punctuate: Punctuator, clock: Clock): SegmentationRuntime`; `new SentenceCut({ lang, sentences, runtime, onPending(tail: string), onSeal(chunk: SealedChunk) })` with `partial(raw: string): void`, `final(text: string): boolean`, `reset(): void`. Task 7 imports it from this path.

- [ ] **Step 1: Write the failing test**

In `src/providers/sessionSide.consistency.test.ts`, the first `it` lists LocalInference's session side; drop the moved file from that list:

```ts
    expect(sessionSide(REPO_ROOT, 'src/providers/localInference')).toEqual(
      expect.arrayContaining([
        'src/providers/localInference/adapter.ts',
        'src/providers/localInference/engines.ts',
        'src/providers/localInference/speech.ts',
      ]),
    );
    expect(sessionSide(REPO_ROOT, 'src/providers/localInference')).not.toContain('src/providers/localInference/sentenceCut.ts');
```

and in `it("a session side runs no global timer: every timer reads the request's clock", ...)` name the shared module the walk no longer reaches, next to the existing one:

```ts
    // The walk does not follow `src/lib/**`: the shared modules session sides cut their segments and jobs with, by name (Stage 2 translation cuts, choice 1; #578 ruling 3).
    expect(globalTimerCalls(readFileSync(join(REPO_ROOT, 'src/lib/segmentation/continuousSegments.ts'), 'utf-8'))).toEqual([]);
    expect(globalTimerCalls(readFileSync(join(REPO_ROOT, 'src/lib/segmentation/sentenceCut.ts'), 'utf-8'))).toEqual([]);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/providers/sessionSide.consistency.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.../src/lib/segmentation/sentenceCut.ts'`, and the `not.toContain` assertion fails while the file still sits in the provider folder.

- [ ] **Step 3: Move the module and its test**

```bash
git mv src/providers/localInference/sentenceCut.ts src/lib/segmentation/sentenceCut.ts
git mv src/providers/localInference/sentenceCut.test.ts src/lib/segmentation/sentenceCut.test.ts
```

Rewrite the moved module's imports (its body is unchanged):

```ts
import type { Clock } from '../contract/clock';
import type { Punctuator } from '../contract/adapter';
import { countSkeleton, offsetAfterSkeleton } from './sealCursor';
import type { PunctuationModelId, SegmentationRuntime } from './SegmentationRuntime';
import { baseLang, breakpoints, sentenceEnds } from './sentenceEnd';
import { SentenceStream, type SealedChunk } from './SentenceStream';
```

and the moved test's:

```ts
import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import type { Punctuator } from '../contract/adapter';
import type { SealedChunk } from './SentenceStream';
import { breakpoints, sentenceEnds } from './sentenceEnd';
import { PUNCTUATION_BUDGET_MS, SentenceCut, runtimeOver } from './sentenceCut';
```

In `src/providers/localInference/adapter.ts`, line 19 becomes:

```ts
import { SentenceCut, runtimeOver } from '../../lib/segmentation/sentenceCut';
```

If the module's own header comment names its provider, add one sentence to it: `Shared by LocalInference and Local Native (#578 ruling 3).`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/sessionSide.consistency.test.ts src/lib/segmentation/sentenceCut.test.ts src/providers/localInference`
Expected: PASS, every file.

- [ ] **Step 5: Run the gates and commit**

Run the three gates (Global Constraints). Expected: src 543 + 1 files, 6777 + 2 tests (the same count: a move), electron + extension 43 / 533, no new tsc error.

```bash
git commit -m "refactor(segmentation): move SentenceCut to the shared segmentation module

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe" -- src/providers/localInference/sentenceCut.ts src/providers/localInference/sentenceCut.test.ts src/lib/segmentation/sentenceCut.ts src/lib/segmentation/sentenceCut.test.ts src/providers/localInference/adapter.ts src/providers/sessionSide.consistency.test.ts
```

---

### Task 2: `nativeModelStore` takes its selections from its caller

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts:556-573` (`NativeReadinessInput`)
- Modify: `src/stores/nativeModelStore.ts` (`catalogStatusRepos`, `revalidateNativeProvider` and its five calls, `ensureSelectionReady`, `applyPrunes`)
- Modify: `src/stores/settingsStore.ts:629-636` (the old `validateApiKey` arm's thunk)
- Move: `src/services/clients/createNativeVadWorker.ts` → `src/lib/local-inference/native/createNativeVadWorker.ts`
- Modify: `src/services/clients/LocalNativeClient.ts:17`, `src/services/clients/LocalNativeClient.test.ts:9`
- Test: `src/stores/nativeModelStore.test.ts`

**Interfaces:**
- Consumes: `useProviderStore` (`src/stores/providerStore.ts`), its `entries.local_native.settings.selections` once Task 10 registers the provider.
- Produces:

```ts
// nativeCatalog.ts
export interface NativeReadinessInput {
  selection: NativeReadinessSelection;          // { sourceLanguage; targetLanguage }, unchanged
  selections: Selections;                       // the caller's own model choices
  mode: 'speaker' | 'participant' | 'both';     // the audio mode a start would run
  textOnly: boolean;
}
```

`useNativeModelStore.getState().ensureSelectionReady(read)` keeps its signature and its result (`{ ready, reason, notes }`), reads `selections` and `mode` from `read()`, and writes no settings. `applyPrunes` no longer exists. `createNativeVadWorker(): Worker | null` lives at `src/lib/local-inference/native/createNativeVadWorker.ts`; Task 5 imports it from there.

- [ ] **Step 1: Write the failing tests**

In `src/stores/nativeModelStore.test.ts`, add `import type { NativeReadinessInput } from '../lib/local-inference/native/nativeCatalog';` and, inside `describe('ensureSelectionReady (facade)', ...)` right after `const SEL = ...`, a reader helper:

```ts
  /** The facade's thunk: the pair, the caller's own selections, the mode and the toggle. */
  const read = (over: Partial<NativeReadinessInput> = {}) => (): NativeReadinessInput =>
    ({ selection: SEL, selections: {}, mode: 'speaker', textOnly: false, ...over });
```

Add these four cases to that `describe`:

```ts
  it('resolves against the selections the caller hands in, never the old slice (#578 ruling 6)', async () => {
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog();
    const { useSettingsStore } = await import('./settingsStore');
    const dir = directionKey('zh', 'en');
    // The old slice names a model the catalog does not know; the caller hands in nothing explicit.
    useSettingsStore.setState({
      localNative: { ...useSettingsStore.getState().localNative, selections: { [dir]: { ...emptyDirection(), asr: { modelId: 'gone-model' } } } },
    });
    const r = await useNativeModelStore.getState().ensureSelectionReady(read({ textOnly: true }));
    expect(r.notes.filter((n) => n.from === 'gone-model')).toEqual([]);
    expect(r.ready).toBe(true);
  });

  it('writes nothing back, not even a dead id it found (#578 ruling 6)', async () => {
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog();
    const { useSettingsStore } = await import('./settingsStore');
    const dir = directionKey('zh', 'en');
    const dead = { [dir]: { ...emptyDirection(), asr: { modelId: 'gone-model' } } };
    useSettingsStore.setState({ localNative: { ...useSettingsStore.getState().localNative, selections: dead } });
    const r = await useNativeModelStore.getState().ensureSelectionReady(read({ selections: dead }));
    expect(r.notes.some((n) => n.from === 'gone-model')).toBe(true);
    expect(useSettingsStore.getState().localNative.selections).toEqual(dead);
    expect('applyPrunes' in useNativeModelStore.getState()).toBe(false);
  });

  it("the mandatory leg follows the caller's mode, not audioStore", async () => {
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog();
    const { default: useAudioStore } = await import('./audioStore');
    useAudioStore.setState({ mode: 'speaker' } as never);
    // en → zh has no ASR in the fixture catalog (its ASR is zh-only): participant alone is mandatory and fails.
    const r = await useNativeModelStore.getState().ensureSelectionReady(read({ mode: 'participant' }));
    expect(r).toMatchObject({ ready: false, reason: 'asr-incompatible' });
  });
```

and in `describe('statusRepos ...')` (the block holding `'an explicit variant pin wins over the recommendation'`) replace that case with:

```ts
  it("an explicit variant pin in Local Native's own settings wins over the recommendation (#578 ruling 6)", async () => {
    _asrExtraModels = [FUN_ASR];
    const { useProviderStore } = await import('./providerStore');
    const dir = directionKey('zh', 'en');
    const entry = {
      settings: { selections: { [dir]: { ...emptyDirection(), asr: { modelId: 'fun-asr-mlt-nano', variant: 'q6_k' } } } },
      credentials: {},
      pair: { source: 'zh', target: 'en' },
    };
    useProviderStore.setState({ entries: { ...useProviderStore.getState().entries, local_native: entry } });
    await useNativeModelStore.getState().ensureCatalog();
    await useNativeModelStore.getState().refresh(['fun-asr-mlt-nano']);
    expect((globalThis as any).__lastStatusRepos).toMatchObject({
      'fun-asr-mlt-nano': 'handy/Fun-ASR-gguf/Fun-ASR-Q6_K.gguf',
    });
    const { local_native: _dropped, ...rest } = useProviderStore.getState().entries;
    useProviderStore.setState({ entries: rest });
  });
```

and replace `'retrySidecar re-runs provider validation so the stale gate message clears'` with:

```ts
  it("retrySidecar boots the sidecar and leaves the old store's validation alone (#578 ruling 6)", async () => {
    mockModelsCatalogResolve();
    useNativeModelStore.setState({ sidecarStatus: 'unavailable' });
    const { useSettingsStore } = await import('./settingsStore');
    const validateApiKey = vi.fn(async () => ({ valid: true, validating: false }));
    useSettingsStore.setState({ provider: 'local_native', validateApiKey } as never);
    await useNativeModelStore.getState().retrySidecar();
    expect(useNativeModelStore.getState().sidecarStatus).toBe('ready');
    expect(validateApiKey).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: FAIL — the first case finds a `gone-model` note (the store reads the old slice), the second sees the slice pruned and `applyPrunes` present, the third answers `ready: true` (the store reads `audioStore`'s `speaker`), the pin case reads the recommended repo, the retry case sees `validateApiKey` called.

- [ ] **Step 3: Change the readiness input**

In `src/lib/local-inference/native/nativeCatalog.ts` replace `NativeReadinessInput`:

```ts
/** Everything readiness reads, resolved in one go. Handed to the facade as a
 * thunk rather than a value: a cold sidecar start is slow, and the user can
 * change the pair / text-only while it runs, so the verdict must be computed
 * from the selection as of AFTER warmup — not a call-site snapshot. The
 * caller owns `selections` and `mode` (#578 ruling 6): the facade reads no
 * settings store and no audio store of its own. */
export interface NativeReadinessInput {
  selection: NativeReadinessSelection;
  /** The caller's own model choices, keyed `src→tgt`. */
  selections: Selections;
  /** The audio mode a start would run: `participant` alone gates the reverse direction. */
  mode: 'speaker' | 'participant' | 'both';
  textOnly: boolean;
}
```

- [ ] **Step 4: Change the store**

In `src/stores/nativeModelStore.ts`:

1. Replace `catalogStatusRepos`:

```ts
/**
 * Catalog-wide pins: Local Native's own settings (#578 ruling 6), across every
 * direction the user has touched — this runs before any direction is current.
 * Reached through a dynamic import, as the old slice was: the provider store
 * loads the registry, which imports this store. No entry yet, no pins.
 */
async function catalogStatusRepos(list: NativeModelInfo[]): Promise<Record<string, string>> {
  let pins: Record<string, string> = {};
  try {
    const { useProviderStore } = await import('./providerStore');
    const settings = useProviderStore.getState().entries.local_native?.settings as { selections?: Selections } | undefined;
    const selections = settings?.selections ?? {};
    pins = pinsFromSelections(selections, Object.keys(selections));
  } catch { /* provider store unavailable — fall back to recommendations */ }
  return deriveVariantRepos(list, pins);
}
```

2. Delete `revalidateNativeProvider` (and the comment line above the block, `// Re-run provider validation so the Start button gates with the cache state.`) and its five calls: `void revalidateNativeProvider();` in `installBundle` (and its comment line `// Unlock the provider gate + warm the freshly installed sidecar.`), `void revalidateNativeProvider();` in `removeBundle`, `if (status === 'ready') await revalidateNativeProvider();` in `download`, `await revalidateNativeProvider();` in `deleteModel`, and in `retrySidecar` the call with its comment block, so it reads:

```ts
  retrySidecar: async () => {
    set({ sidecarStatus: 'idle', engineInfo: null, deviceProfiles: null, profileGeneration: null });
    // The provider's readiness watch sees the lifecycle move and re-checks (#578 ruling 6).
    await get().ensureCatalog();
  },
```

3. In `ensureSelectionReady`, replace everything from `const { selection, textOnly } = read();` down to (and including) the `mandatoryFirst` declaration with:

```ts
    const { selection, selections, mode: audioMode, textOnly } = read();
    const catalog = get().catalog;
    const speakerDir = directionKey(selection.sourceLanguage, selection.targetLanguage);
    const participantDir = directionKey(selection.targetLanguage, selection.sourceLanguage);
    // The mandatory leg follows the caller's mode (see the ready verdict
    // below): pin priority and the status refresh judge the SAME leg the gate does.
    const mandatoryFirst = audioMode === 'participant'
      ? [participantDir, speakerDir] : [speakerDir, participantDir];
```

and delete the prune block after the two `resolve` calls:

```ts
    const prunes = [...speaker.prunes, ...participant.prunes];
    if (prunes.length > 0) {
      await get().applyPrunes(prunes);
    }
```

Update the interface doc of `ensureSelectionReady` (its last sentences): `resolve() output IS the answer, and nothing is written back — not even a dead id: the caller owns its settings (#578 ruling 6).`

4. Delete `applyPrunes` from the `NativeModelStore` interface (with its doc) and from the store body. Remove every import the edit leaves unused (`tsc` names them: `emptyDirection`, `Stage`, `describeCause` if nothing else uses them).

- [ ] **Step 5: Pass the old arm its own slice and mode**

In `src/stores/settingsStore.ts`, the old `validateApiKey` arm's thunk becomes:

```ts
        const { ready, reason } = await useNativeModelStore.getState()
          .ensureSelectionReady(() => ({
            selection: get().localNative,
            selections: get().localNative.selections,
            mode: useAudioStore.getState().mode,
            textOnly: effectiveTextOnly({
              speakerLegRuns: speakerChannelInScope(useAudioStore.getState().mode),
              textOnly: get().textOnly,
            }),
          }));
```

- [ ] **Step 6: Move the VAD factory**

```bash
git mv src/services/clients/createNativeVadWorker.ts src/lib/local-inference/native/createNativeVadWorker.ts
```

Its body becomes:

```ts
/** Isolated factory so the native clients' owners can be unit-tested with the worker stubbed (#578: the old client and the new adapter both use it). */
export function createNativeVadWorker(): Worker | null {
  return new Worker(
    new URL('../workers/native-vad.worker.ts', import.meta.url),
    { type: 'module' },
  );
}
```

`src/services/clients/LocalNativeClient.ts:17` becomes `import { createNativeVadWorker } from '../../lib/local-inference/native/createNativeVadWorker';` and `src/services/clients/LocalNativeClient.test.ts:9` becomes `vi.mock('../../lib/local-inference/native/createNativeVadWorker', () => ({ createNativeVadWorker: () => null }));`.

- [ ] **Step 7: Fit the remaining store tests to the new input**

In `src/stores/nativeModelStore.test.ts`, every `ensureSelectionReady(() => ({ selection: SEL, textOnly: X }))` becomes `ensureSelectionReady(read({ textOnly: X }))`, and every `ensureSelectionReady(() => ({ selection: {...}, textOnly: X }))` with another pair becomes `ensureSelectionReady(read({ selection: {...}, textOnly: X }))`. A case that seeded `useSettingsStore`'s `localNative.selections` before calling the facade hands the same object in instead: `read({ selections: <that object>, ... })`, and drops the seeding. `'reads the selection AFTER sidecar warmup, not at call time'` returns `{ selection: SEL, selections: {}, mode: 'speaker', textOnly: true }` from its own thunk. Delete `'applyPrunes writes to the localNative slice'` and the `beforeEach` that only reset the slice for it. `'prunes a dead id seeded on the PARTICIPANT-direction selections entry in one ensureSelectionReady() call'` becomes `'notes a dead id on the PARTICIPANT direction and leaves it in place'`: hand the dead selections in through `read({ selections })`, keep its note assertion, and assert `useSettingsStore.getState().localNative.selections` is unchanged. The `ensureSelectionReady` facade's `beforeEach` that reset the old slice's selections goes too: the facade no longer reads it.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/stores/nativeModelStore.test.ts src/stores/settingsStore.nativeGate.test.ts src/stores/settingsStore.native-gate.test.ts src/stores/settingsStore.test.ts src/services/clients/LocalNativeClient.test.ts`
Expected: PASS, every file.

- [ ] **Step 9: Run the gates and commit**

Run the three gates. Expected: src green (one test fewer for `applyPrunes`, four more), electron + extension 43 / 533, no new tsc error.

```bash
git commit -m "refactor(native): readiness takes its selections and mode from the caller

The native model store stops reading and writing the old settings slice
and stops re-running its validation: the new provider owns
settings.localNative.* (#578 ruling 6).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe" -- src/lib/local-inference/native/nativeCatalog.ts src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts src/stores/settingsStore.ts src/services/clients/createNativeVadWorker.ts src/lib/local-inference/native/createNativeVadWorker.ts src/services/clients/LocalNativeClient.ts src/services/clients/LocalNativeClient.test.ts
```

---
### Task 3: Local Native's settings, languages and builder

**Files:**
- Create: `src/providers/local_native/settings.ts`, `src/providers/local_native/engineLegs.ts`, `src/providers/local_native/config.ts`
- Test: `src/providers/local_native/settings.test.ts`, `src/providers/local_native/config.test.ts`

**Interfaces:**
- Consumes: `useNativeModelStore.getState().resolve(src, tgt, selections): DirectionResult` (`resolve` reads the store's `catalog` and `statuses`), `catalog`, `sizes`; `voiceCapability(model)` (`nativeCatalog.ts`); `buildDefaultLocalPrompt(src, tgt)` (`src/lib/local-inference/prompts.ts`); `getLocalInferenceLanguages()` / `getLocalInferenceTargetLanguages(source)` (`modelManifest.ts`), the list the old descriptor offered (`LocalNativeProviderConfig.ts:225`).
- Produces (later tasks use these exact names):

```ts
// settings.ts
export type NativeDevice = 'auto' | 'cpu' | 'gpu';
export interface LocalNativeSettings {
  selections: Selections; ttsSpeed: number; ttsVoice: string;
  asrDevice: NativeDevice; translationDevice: NativeDevice; ttsDevice: NativeDevice;
  vadThreshold: number; vadMinSilenceDuration: number; vadMinSpeechDuration: number;
  useTemplateMode: boolean; systemPrompt: string; participantSystemPrompt: string;
}
export const LOCAL_NATIVE_DEFAULTS: LocalNativeSettings;
export type NativeEngineSettings = Pick<LocalNativeSettings, 'selections' | 'asrDevice' | 'translationDevice' | 'ttsDevice' | 'ttsVoice'>;
export interface NativeEngineOverride { settings: NativeEngineSettings; update: (patch: Partial<NativeEngineSettings>) => void; pair: LanguagePair }
export const localNativeLanguages: Provider<LocalNativeSettings, never, never>['languages'];
// engineLegs.ts
export const FALLBACK_PAIR: LanguagePair;            // { source: 'ja', target: 'en' }
export function modeOfLegs(legs: readonly LegName[]): 'speaker' | 'participant' | 'both';
// config.ts
export interface NativeStageConfig { modelId: string; variant?: string; device: NativeDevice }
export interface LocalNativeConfig {
  asr: NativeStageConfig;
  vad: { threshold: number; minSilenceDuration: number; minSpeechDuration: number };
  translation: (NativeStageConfig & { instructions: string; wrapTranscript: boolean }) | null;
  tts?: NativeStageConfig & { speed: number; voice: string; capability: VoiceCapability | null };
  asrFirst: boolean;
  jobSentences?: number;
}
export function asrLoadsFirst(asrId: string, translationId: string | undefined, catalog: Record<string, NativeModelInfo>, sizes: Record<string, number>): boolean;
export function buildLocalNative(context: SessionContext, s: LocalNativeSettings, shared: SharedSettings): LocalNativeConfig | ProviderRefusal;
export function describeLocalNative(c: LocalNativeConfig): { asrModel?: string; translationModel?: string; ttsModel?: string };
export const ONE_SIDE_AT_A_TIME: string;
export function admitLocalNative(configs: Partial<Record<LegName, LocalNativeConfig>>): true | ProviderRefusal;
```

- [ ] **Step 1: Write the failing tests**

`src/providers/local_native/settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AUTO } from '../../lib/provider/languages';
import { LOCAL_NATIVE_DEFAULTS, localNativeLanguages } from './settings';

describe('Local Native settings', () => {
  // The old slice's fields (`LocalNativeProviderConfig.ts`, `defaultLocalNativeSettings`),
  // less the three the global pair and turn mode own: each stored value is read under
  // the same `settings.localNative.<field>` key, as it is (#578 ruling 7).
  const OLD_SLICE_FIELDS = [
    'selections', 'ttsSpeed', 'vadThreshold', 'vadMinSilenceDuration', 'vadMinSpeechDuration',
    'useTemplateMode', 'systemPrompt', 'asrDevice', 'translationDevice', 'ttsDevice', 'ttsVoice',
  ];

  it("reads the old slice's saved fields as they are, with one new field", () => {
    expect(Object.keys(LOCAL_NATIVE_DEFAULTS).sort()).toEqual([...OLD_SLICE_FIELDS, 'participantSystemPrompt'].sort());
  });

  it("keeps the old slice's defaults", () => {
    expect(LOCAL_NATIVE_DEFAULTS).toEqual({
      selections: {}, ttsSpeed: 1.0, ttsVoice: '',
      asrDevice: 'auto', translationDevice: 'auto', ttsDevice: 'auto',
      vadThreshold: 0.3, vadMinSilenceDuration: 1.4, vadMinSpeechDuration: 0.4,
      useTemplateMode: true, systemPrompt: '', participantSystemPrompt: '',
    });
  });

  it('never offers AUTO, offers a target for every source, and starts ja → en', () => {
    const sources = localNativeLanguages.sources(LOCAL_NATIVE_DEFAULTS).map((o) => o.value);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources).not.toContain(AUTO);
    for (const source of sources) {
      const targets = localNativeLanguages.targets(source, LOCAL_NATIVE_DEFAULTS).map((o) => o.value);
      expect(targets.length, source).toBeGreaterThan(0);
      expect(targets, source).not.toContain(source);
    }
    expect(localNativeLanguages.initial?.(LOCAL_NATIVE_DEFAULTS)).toEqual({ source: 'ja', target: 'en' });
  });
});
```

`src/providers/local_native/config.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import { directionKey, emptyDirection } from '../../lib/local-inference/selection/types';
import type { SharedSettings } from '../../lib/provider/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { admitLocalNative, asrLoadsFirst, buildLocalNative, describeLocalNative, ONE_SIDE_AT_A_TIME, type LocalNativeConfig } from './config';
import { LOCAL_NATIVE_DEFAULTS, type LocalNativeSettings } from './settings';

const cpu = [{ tier: 'cpu', backend: 'ct2', available: true }];
const CATALOG = {
  'asr-a': { id: 'asr-a', name: 'ASR A', kind: 'asr', languages: ['ja', 'en'], recommended: true, tiers: cpu, order: 1, repo: 'r-asr' },
  'mt-a': { id: 'mt-a', name: 'MT A', kind: 'translate', languages: ['multi'], recommended: true, tiers: cpu, order: 1, repo: 'r-mt' },
  'tts-a': { id: 'tts-a', name: 'TTS A', kind: 'tts', languages: ['ja', 'en'], recommended: true, tiers: cpu, order: 1, repo: 'r-tts', voice: { builtin: 'named', custom: 'clip' } },
} as unknown as Record<string, NativeModelInfo>;
const READY = { 'asr-a': 'ready', 'mt-a': 'ready', 'tts-a': 'ready' } as const;

const forward: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const reverse: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: false, turns: 'auto' };
const shared = (over: Partial<SharedSettings> = {}): SharedSettings => ({
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === 'en',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
  ...over,
});
const s = (over: Partial<LocalNativeSettings> = {}): LocalNativeSettings => ({ ...LOCAL_NATIVE_DEFAULTS, ...over });
const built = (r: ReturnType<typeof buildLocalNative>): LocalNativeConfig => {
  if ('refused' in r && typeof r.refused === 'string') throw new Error(`refused: ${r.refused}`);
  return r as LocalNativeConfig;
};

beforeEach(() => {
  useNativeModelStore.setState({ catalog: CATALOG, statuses: { ...READY }, sizes: { 'asr-a': 100, 'mt-a': 50, 'tts-a': 10 } });
});

describe('buildLocalNative', () => {
  it('resolves the three stages for the leg, with the devices the settings pin', () => {
    const c = built(buildLocalNative(forward, s({ asrDevice: 'gpu', translationDevice: 'cpu', ttsDevice: 'auto', ttsSpeed: 1.2, ttsVoice: 'builtin:Bella' }), shared()));
    expect(c.asr).toEqual({ modelId: 'asr-a', device: 'gpu' });
    expect(c.translation).toMatchObject({ modelId: 'mt-a', device: 'cpu' });
    expect(c.tts).toEqual({ modelId: 'tts-a', device: 'auto', speed: 1.2, voice: 'builtin:Bella', capability: { builtin: 'named', custom: 'clip' } });
    expect(c.vad).toEqual({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
  });

  it("carries an explicit pick's variant pin", () => {
    const selections = { [directionKey('ja', 'en')]: { ...emptyDirection(), asr: { modelId: 'asr-a', variant: 'q8_0' } } };
    expect(built(buildLocalNative(forward, s({ selections }), shared())).asr).toEqual({ modelId: 'asr-a', variant: 'q8_0', device: 'auto' });
  });

  it('refuses a leg with no speech recognition model', () => {
    useNativeModelStore.setState({ statuses: { ...READY, 'asr-a': 'absent' } });
    expect(buildLocalNative(forward, s(), shared())).toEqual({ refused: 'No speech recognition model for ja.', code: 'no_asr', params: { source: 'ja' } });
  });

  it('runs transcription only when no translation model resolves', () => {
    useNativeModelStore.setState({ statuses: { ...READY, 'mt-a': 'absent' } });
    expect(built(buildLocalNative(forward, s(), shared())).translation).toBeNull();
  });

  it('loads TTS only where the leg speaks', () => {
    expect(built(buildLocalNative({ ...forward, speech: false }, s(), shared())).tts).toBeUndefined();
  });

  it('template mode: the default prompt, wrapped', () => {
    expect(built(buildLocalNative(forward, s(), shared())).translation).toMatchObject({
      instructions: buildDefaultLocalPrompt('ja', 'en'), wrapTranscript: true,
    });
  });

  it("advanced mode: the speaker's prompt, and the reverse direction's own prompt, falling back to the speaker's", () => {
    const adv = s({ useTemplateMode: false, systemPrompt: '  Speaker rules  ', participantSystemPrompt: '' });
    expect(built(buildLocalNative(forward, adv, shared())).translation).toMatchObject({ instructions: 'Speaker rules', wrapTranscript: false });
    expect(built(buildLocalNative(reverse, adv, shared())).translation).toMatchObject({ instructions: 'Speaker rules' });
    expect(built(buildLocalNative(reverse, { ...adv, participantSystemPrompt: 'Other rules' }, shared())).translation).toMatchObject({ instructions: 'Other rules' });
  });

  it('cuts jobs by sentences only under a sentences display', () => {
    expect(built(buildLocalNative(forward, s(), shared())).jobSentences).toBeUndefined();
    expect(built(buildLocalNative(forward, s(), shared({ segmentation: { mode: 'sentences', sentencesPerRow: 2 } }))).jobSentences).toBe(2);
  });

  it('decides the load order from the catalog (#578 ruling 15)', () => {
    expect(built(buildLocalNative(forward, s(), shared())).asrFirst).toBe(true);
  });
});

describe('asrLoadsFirst', () => {
  const gpuOnly = { ...CATALOG['mt-a'], tiers: [{ tier: 'vulkan', backend: 'llama', available: true }] } as NativeModelInfo;
  it('a GPU-only stage loads first', () => {
    expect(asrLoadsFirst('asr-a', 'mt-a', { ...CATALOG, 'mt-a': gpuOnly }, {})).toBe(false);
  });
  it('else the larger loads first', () => {
    expect(asrLoadsFirst('asr-a', 'mt-a', CATALOG, { 'asr-a': 10, 'mt-a': 50 })).toBe(false);
    expect(asrLoadsFirst('asr-a', 'mt-a', CATALOG, { 'asr-a': 50, 'mt-a': 10 })).toBe(true);
  });
  it('with no translation, or no catalog, ASR first', () => {
    expect(asrLoadsFirst('asr-a', undefined, CATALOG, {})).toBe(true);
    expect(asrLoadsFirst('asr-a', 'mt-a', {}, {})).toBe(true);
  });
});

describe('describeLocalNative and admitLocalNative', () => {
  const one = built(buildLocalNative(forward, s(), shared()));
  it('names the models a config uses', () => {
    expect(describeLocalNative(one)).toEqual({ asrModel: 'asr-a', translationModel: 'mt-a', ttsModel: 'tts-a' });
  });
  it('admit refuses two legs and admits one (#578 ruling 4)', () => {
    expect(admitLocalNative({ speaker: one })).toBe(true);
    expect(admitLocalNative({ participant: one })).toBe(true);
    expect(admitLocalNative({ speaker: one, participant: one })).toEqual({ refused: ONE_SIDE_AT_A_TIME });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/local_native`
Expected: FAIL — `Failed to resolve import "./settings"` / `"./config"`.

- [ ] **Step 3: Write `settings.ts` and `engineLegs.ts`**

`src/providers/local_native/settings.ts`:

```ts
import { identityWire } from '../../lib/language/wire';
import type { LanguagePair, Provider } from '../../lib/provider/types';
import type { Selections } from '../../lib/local-inference/selection/types';
import { getLocalInferenceLanguages, getLocalInferenceTargetLanguages } from '../../lib/local-inference/modelManifest';

export type NativeDevice = 'auto' | 'cpu' | 'gpu';

/**
 * Local Native's `S`: the old slice's fields under their old names, so each
 * saved value is read under the same `settings.localNative.<field>` key, as
 * it is (#578 ruling 7). The pair and the turn mode are global now and left
 * out; `participantSystemPrompt` is LocalInference's rule for the reverse
 * direction, new here.
 */
export interface LocalNativeSettings {
  /** Per-direction model choices, keyed `src→tgt`. '' in any stage means auto; `variant` pins a quant. */
  selections: Selections;
  ttsSpeed: number;
  /** `builtin:<name>`, `custom:<id>`, or '' for the per-language default. One value for every TTS model. */
  ttsVoice: string;
  asrDevice: NativeDevice;
  translationDevice: NativeDevice;
  ttsDevice: NativeDevice;
  vadThreshold: number;
  vadMinSilenceDuration: number;
  vadMinSpeechDuration: number;
  /** true = Simple (default), false = Advanced. */
  useTemplateMode: boolean;
  /** Advanced-mode speaker prompt (default ''). */
  systemPrompt: string;
  /** Advanced-mode prompt for the reverse direction (default '', empty = the speaker's). */
  participantSystemPrompt: string;
}

export const LOCAL_NATIVE_DEFAULTS: LocalNativeSettings = {
  selections: {},
  ttsSpeed: 1.0,
  ttsVoice: '',
  asrDevice: 'auto',
  translationDevice: 'auto',
  ttsDevice: 'auto',
  vadThreshold: 0.3,
  vadMinSilenceDuration: 1.4,
  vadMinSpeechDuration: 0.4,
  useTemplateMode: true,
  systemPrompt: '',
  participantSystemPrompt: '',
};

/** What the native model UI edits: the picks, the devices and the voice. The old settings shell hands it the old slice, which has the same fields. */
export type NativeEngineSettings = Pick<LocalNativeSettings, 'selections' | 'asrDevice' | 'translationDevice' | 'ttsDevice' | 'ttsVoice'>;

/** The host's `settings` / `update` / pair, as `useWasmEngineAdapter`'s override is LocalInference's. */
export interface NativeEngineOverride {
  settings: NativeEngineSettings;
  update: (patch: Partial<NativeEngineSettings>) => void;
  pair: LanguagePair;
}

/**
 * The old descriptor's list (`getLocalInferenceLanguages`): the languages a
 * speech-recognition model and a speech-synthesis model both support. The
 * target list leaves out the chosen source. Never `AUTO`. `initial` matches
 * the old slice's defaults (`ja` → `en`).
 */
export const localNativeLanguages: Provider<LocalNativeSettings, never, never>['languages'] = {
  sources: () => getLocalInferenceLanguages(),
  targets: (source) => getLocalInferenceTargetLanguages(source),
  initial: () => ({ source: 'ja', target: 'en' }),
  // Each sidecar engine turns the app code into its model's own form.
  wire: identityWire(),
};
```

`src/providers/local_native/engineLegs.ts`:

```ts
import type { LegName } from '../../lib/conversation/types';
import type { LanguagePair } from '../../lib/provider/types';

/** The hosts always supply `pair`; this matters only standalone (a test, the dev preview). */
export const FALLBACK_PAIR: LanguagePair = { source: 'ja', target: 'en' };

/**
 * `legs` → the audio mode a start would run: more than one leg is `'both'`,
 * one leg is itself, none falls back to `'speaker'`. LocalInference keeps the
 * same three lines in its own folder: a provider imports no other provider's
 * folder. Its own module, so the cheap `EngineSummary` and `check` do not
 * import the `Engine` chain.
 */
export function modeOfLegs(legs: readonly LegName[]): 'speaker' | 'participant' | 'both' {
  return legs.length > 1 ? 'both' : legs[0] ?? 'speaker';
}
```

- [ ] **Step 4: Write `config.ts`**

```ts
import type { SessionContext } from '../../lib/contract/adapter';
import type { LegName } from '../../lib/conversation/types';
import { voiceCapability, type VoiceCapability } from '../../lib/local-inference/native/nativeCatalog';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import type { LocalNativeSettings, NativeDevice } from './settings';

/** One sidecar stage: the model, its pinned quant, and the device the settings ask for. */
export interface NativeStageConfig {
  modelId: string;
  variant?: string;
  device: NativeDevice;
}

/**
 * Local Native's `C`. Ports `LocalNativeSessionConfig` minus what the contract
 * carries elsewhere (direction, `textOnly` as `context.speech`, replay, turn
 * mode). Model resolution, the voice capability and the load order are
 * decided here, from the native model store — never in the adapter (spec:
 * "Structural gaps").
 */
export interface LocalNativeConfig {
  asr: NativeStageConfig;
  vad: { threshold: number; minSilenceDuration: number; minSpeechDuration: number };
  /** Null: no translation model resolved, so the leg is transcription only. */
  translation: (NativeStageConfig & { instructions: string; wrapTranscript: boolean }) | null;
  /** Set only where the leg speaks. `capability`: the catalog's voice capability for the model; null while the catalog does not list it (the adapter then reads the init reply's `clones`, as the old client did). */
  tts?: NativeStageConfig & { speed: number; voice: string; capability: VoiceCapability | null };
  /** ASR loads before translation (#578 ruling 15). */
  asrFirst: boolean;
  /** As LocalInference's: absent — one job per final; 0 — Auto; 1–5 — a job every N sentences. */
  jobSentences?: number;
}

/** LocalInference's prompt rule (its `config.ts`), the same here: template mode uses the default; else the speaker's prompt, or, for the reverse direction, its own. */
function localInstructions(context: SessionContext, s: LocalNativeSettings, shared: SharedSettings): string {
  const { source, target } = context.direction;
  if (s.useTemplateMode) return buildDefaultLocalPrompt(source, target);
  const speakerResolved = s.systemPrompt.trim() || buildDefaultLocalPrompt(source, target);
  if (!shared.reversed(context.direction)) return speakerResolved;
  return s.participantSystemPrompt.trim() || speakerResolved;
}

function stage(resolved: { modelId: string; variant?: string }, device: NativeDevice): NativeStageConfig {
  return { modelId: resolved.modelId, ...(resolved.variant ? { variant: resolved.variant } : {}), device };
}

/**
 * Which stage claims VRAM first (#578 ruling 15; the old client's
 * `asrLoadsFirst`): a GPU-only model (catalog tiers, none `cpu`) loads first;
 * when both or neither are GPU-only, the larger download; ASR first without
 * a translation stage or catalog data.
 */
export function asrLoadsFirst(
  asrId: string,
  translationId: string | undefined,
  catalog: Record<string, NativeModelInfo>,
  sizes: Record<string, number>,
): boolean {
  if (!translationId) return true;
  const gpuOnly = (id: string): boolean => {
    const info = catalog[id];
    return !!info && info.tiers.length > 0 && !info.tiers.some((t) => t.tier === 'cpu');
  };
  const asrGpuOnly = gpuOnly(asrId);
  if (asrGpuOnly !== gpuOnly(translationId)) return asrGpuOnly;
  return (sizes[asrId] ?? 0) >= (sizes[translationId] ?? 0);
}

/** Local Native's builder, called once per leg: `context.direction` names the leg's direction. */
export function buildLocalNative(
  context: SessionContext,
  s: LocalNativeSettings,
  shared: SharedSettings,
): LocalNativeConfig | ProviderRefusal {
  const { source, target } = context.direction;
  const store = useNativeModelStore.getState();
  const resolved = store.resolve(source, target, s.selections);
  if (!resolved.asr) {
    return { refused: `No speech recognition model for ${source}.`, code: 'no_asr', params: { source } };
  }

  let translation: LocalNativeConfig['translation'] = null;
  if (resolved.translation) {
    const instructions = localInstructions(context, s, shared);
    const wrapTranscript = s.useTemplateMode
      || instructions === buildDefaultLocalPrompt(source, target)
      || instructions === buildDefaultLocalPrompt(target, source);
    translation = { ...stage(resolved.translation, s.translationDevice), instructions, wrapTranscript };
  }

  const asr = stage(resolved.asr, s.asrDevice);
  const config: LocalNativeConfig = {
    asr,
    vad: { threshold: s.vadThreshold, minSilenceDuration: s.vadMinSilenceDuration, minSpeechDuration: s.vadMinSpeechDuration },
    translation,
    asrFirst: asrLoadsFirst(asr.modelId, translation?.modelId, store.catalog, store.sizes),
  };
  if (shared.segmentation.mode === 'sentences') config.jobSentences = shared.segmentation.sentencesPerRow;
  if (context.speech && resolved.tts) {
    config.tts = {
      ...stage(resolved.tts, s.ttsDevice),
      speed: s.ttsSpeed,
      voice: s.ttsVoice,
      capability: store.catalog[resolved.tts.modelId] ? voiceCapability(store.catalog[resolved.tts.modelId]) : null,
    };
  }
  return config;
}

export function describeLocalNative(c: LocalNativeConfig): { asrModel?: string; translationModel?: string; ttsModel?: string } {
  return { asrModel: c.asr.modelId, translationModel: c.translation?.modelId, ttsModel: c.tts?.modelId };
}

/** The `admit_refused` notice's detail (#578 ruling 4). */
export const ONE_SIDE_AT_A_TIME = 'Local Native translates one side at a time: choose Me or Other.';

/**
 * Two legs are refused until the sidecar keeps one engine per connection
 * (spec: "Parameters and deferred decisions"): today one engine per stage
 * serves the whole process, so the second leg's init evicts the first's
 * model and the first leg to close unloads both.
 */
export function admitLocalNative(configs: Partial<Record<LegName, LocalNativeConfig>>): true | ProviderRefusal {
  return configs.speaker && configs.participant ? { refused: ONE_SIDE_AT_A_TIME } : true;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/providers/local_native`
Expected: PASS (settings: 3, config: 14).

- [ ] **Step 6: Run the gates and commit**

```bash
git commit -m "feat(local_native): settings, languages and the builder

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe" -- src/providers/local_native/settings.ts src/providers/local_native/settings.test.ts src/providers/local_native/engineLegs.ts src/providers/local_native/config.ts src/providers/local_native/config.test.ts
```

(`sessionSide.consistency.test.ts` requires an `adapter.ts` in every provider folder: until Task 7 lands one, that test fails on `src/providers/local_native`. Add a placeholder in this task so the suite stays green — `src/providers/local_native/adapter.ts` containing only `export {};` with the comment `// The adapter lands in Task 7 of the #578 plan.` — and include it in this commit. Task 7 replaces it.)

---

### Task 4: Readiness — `check`, `watchReadiness` and the codes

**Files:**
- Create: `src/providers/local_native/check.ts`
- Modify: `src/lib/view/noticeText.ts` (`NOTICE_ALIASES`), `src/lib/view/noticeTargets.ts` (`NOTICE_TARGETS`)
- Test: `src/providers/local_native/check.test.ts`, `src/lib/view/noticeText.test.ts` (one case)

**Interfaces:**
- Consumes: `ensureSelectionReady(read)` with Task 2's `NativeReadinessInput`; `modeOfLegs` (Task 3).
- Produces:

```ts
export const NATIVE_READINESS_CODES: Readonly<Record<Exclude<NativeReadinessReason, 'ready'>, string>>;
export async function checkLocalNative(s: LocalNativeSettings, ctx: CheckContext): Promise<CheckResult>;
export function nativeReadinessKey(state: Pick<NativeModelStoreState, 'sidecarStatus' | 'bundleStatus' | 'catalog' | 'statuses'>): string;
export function watchLocalNativeReadiness(onChange: () => void): () => void;
```

- [ ] **Step 1: Write the failing tests**

`src/providers/local_native/check.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock('../../stores/nativeModelStore', async () => {
  const { create } = await import('zustand');
  const useNativeModelStore = create(() => ({
    sidecarStatus: 'idle' as string,
    bundleStatus: 'unknown' as string,
    catalog: {} as Record<string, unknown>,
    statuses: {} as Record<string, string>,
    ensureSelectionReady: (read: () => unknown) => fake.ensure(read),
  }));
  return { useNativeModelStore };
});

import { useNativeModelStore } from '../../stores/nativeModelStore';
import { checkLocalNative, NATIVE_READINESS_CODES, watchLocalNativeReadiness } from './check';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

const pair = { source: 'ja', target: 'en' };

beforeEach(() => {
  fake.ensure.mockReset();
  useNativeModelStore.setState({ sidecarStatus: 'ready', bundleStatus: 'ready', catalog: {}, statuses: {} });
});

describe('checkLocalNative', () => {
  it('hands the facade the pair, its own selections, the legs as a mode, and never text-only (#578 ruling 16)', async () => {
    let seen: unknown;
    fake.ensure.mockImplementation(async (read: () => unknown) => { seen = read(); return { ready: true, reason: 'ready', notes: [] }; });
    const selections = { 'ja→en': { asr: { modelId: 'a' }, translation: { modelId: '' }, tts: { modelId: '' } } };
    await expect(checkLocalNative({ ...LOCAL_NATIVE_DEFAULTS, selections }, { pair, legs: ['participant'] })).resolves.toEqual({ ok: true });
    expect(seen).toEqual({ selection: { sourceLanguage: 'ja', targetLanguage: 'en' }, selections, mode: 'participant', textOnly: false });
  });

  it('says why by a code for every reason (#578 ruling 5)', async () => {
    for (const [reason, code] of Object.entries(NATIVE_READINESS_CODES)) {
      fake.ensure.mockResolvedValueOnce({ ready: false, reason, notes: [] });
      const r = await checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'] });
      expect(r, reason).toMatchObject({ ok: false, code });
      expect((r as { reason: string }).reason.length, reason).toBeGreaterThan(0);
    }
  });

  it('rejects with the reason when the start that asked is cancelled', async () => {
    fake.ensure.mockReturnValue(new Promise(() => {}));
    const ac = new AbortController();
    const checking = checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'], signal: ac.signal });
    ac.abort(new Error('cancelled'));
    await expect(checking).rejects.toThrow('cancelled');
  });
});

describe('watchLocalNativeReadiness', () => {
  it('calls back when what readiness reads changes', () => {
    const onChange = vi.fn();
    const off = watchLocalNativeReadiness(onChange);
    useNativeModelStore.setState({ statuses: { a: 'ready' } });
    useNativeModelStore.setState({ sidecarStatus: 'unavailable' });
    useNativeModelStore.setState({ bundleStatus: 'absent' });
    useNativeModelStore.setState({ catalog: { a: {} } } as never);
    expect(onChange).toHaveBeenCalledTimes(4);
    off();
    useNativeModelStore.setState({ statuses: { a: 'absent' } });
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('a refresh that changes nothing does not call back (Review Focus 2)', () => {
    useNativeModelStore.setState({ statuses: { a: 'ready', b: 'absent' } });
    const onChange = vi.fn();
    const off = watchLocalNativeReadiness(onChange);
    // `refresh` always writes a new object; the same content must not re-check, or check → refresh → check loops.
    useNativeModelStore.setState({ statuses: { b: 'absent', a: 'ready' } });
    useNativeModelStore.setState({ sidecarStatus: 'ready' });
    expect(onChange).not.toHaveBeenCalled();
    off();
  });
});
```

In `src/lib/view/noticeText.test.ts`, add one case:

```ts
  it("words Local Native's readiness codes by the sentences every locale has (#578 ruling 5)", () => {
    expect(NOTICE_ALIASES).toMatchObject({
      native_engine_update_required: 'settings.localNativeEngineUpdateRequired',
      native_engine_required: 'settings.localNativeEngineRequired',
      native_unavailable: 'settings.localNativeUnavailable',
      native_starting: 'settings.localNativeStarting',
      native_asr_missing: 'settings.localNativeAsrIncompatible',
      native_translation_missing: 'settings.localNativeTranslationIncompatible',
    });
    for (const code of ['native_engine_update_required', 'native_engine_required', 'native_unavailable', 'native_starting', 'native_asr_missing', 'native_translation_missing']) {
      expect(settingsTargetForCode(code), code).toBe('provider');
    }
  });
```

(import `NOTICE_ALIASES` from `./noticeText` and `settingsTargetForCode` from `./noticeTargets` if the test file does not already.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/local_native/check.test.ts src/lib/view/noticeText.test.ts`
Expected: FAIL — `Failed to resolve import "./check"`; the aliases are undefined.

- [ ] **Step 3: Write `check.ts`**

```ts
import type { NativeReadinessReason } from '../../lib/local-inference/native/nativeCatalog';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { modeOfLegs } from './engineLegs';
import type { LocalNativeSettings } from './settings';

type NativeModelStoreState = ReturnType<typeof useNativeModelStore.getState>;
type NotReady = Exclude<NativeReadinessReason, 'ready'>;

/** Each reason's code; `noticeText`'s aliases word them by the sentences every locale has (#578 ruling 5). */
export const NATIVE_READINESS_CODES: Readonly<Record<NotReady, string>> = {
  // Unreachable: the provider is Electron only.
  'not-electron': 'native_unavailable',
  'engine-mismatch': 'native_engine_update_required',
  'engine-absent': 'native_engine_required',
  unavailable: 'native_unavailable',
  starting: 'native_starting',
  'asr-incompatible': 'native_asr_missing',
  'translation-incompatible': 'native_translation_missing',
};

/** Diagnostic English, for the console and a surface with no words for the code. */
const REASONS: Readonly<Record<NotReady, string>> = {
  'not-electron': 'Local Native runs in the desktop app only.',
  'engine-mismatch': 'The inference engine needs an update.',
  'engine-absent': 'The inference engine is not installed.',
  unavailable: 'The native engine is unavailable.',
  starting: 'The local engine is starting.',
  'asr-incompatible': 'No speech recognition model for this language.',
  'translation-incompatible': 'No translation model for this language pair.',
};

/**
 * Local Native's readiness (spec: "Readiness is one check"): the native model
 * store's gate — sidecar warmup, the bundle's state, both directions' models —
 * fed this provider's own selections, the pair and the legs. Writes nothing
 * (#578 ruling 6). TTS never gates, so it asks with text-only off (#578 ruling 16).
 */
export async function checkLocalNative(s: LocalNativeSettings, ctx: CheckContext): Promise<CheckResult> {
  const answer = await raceSignal(useNativeModelStore.getState().ensureSelectionReady(() => ({
    selection: { sourceLanguage: ctx.pair.source, targetLanguage: ctx.pair.target },
    selections: s.selections,
    mode: modeOfLegs(ctx.legs),
    textOnly: false,
  })), ctx.signal);
  if (answer.ready) return { ok: true };
  const reason = answer.reason as NotReady;
  return { ok: false, reason: REASONS[reason], code: NATIVE_READINESS_CODES[reason] };
}

/**
 * What `check`'s answer depends on, as content. `refresh` writes a new
 * statuses object even when nothing changed, and `check` itself refreshes:
 * keyed by reference, every check would schedule the next.
 */
export function nativeReadinessKey(state: Pick<NativeModelStoreState, 'sidecarStatus' | 'bundleStatus' | 'catalog' | 'statuses'>): string {
  const statuses = Object.keys(state.statuses).sort().map((id) => `${id}=${state.statuses[id]}`).join(',');
  return `${state.sidecarStatus}|${state.bundleStatus}|${Object.keys(state.catalog).sort().join(',')}|${statuses}`;
}

/** A download, a delete, the bundle or the sidecar's lifecycle moving: the store's own events, once each. */
export function watchLocalNativeReadiness(onChange: () => void): () => void {
  let key = nativeReadinessKey(useNativeModelStore.getState());
  return useNativeModelStore.subscribe((state) => {
    const next = nativeReadinessKey(state);
    if (next === key) return;
    key = next;
    onChange();
  });
}

/** `work`'s answer, or the abort reason if the start that asked is cancelled first (LocalInference's `raceInitialize`, for any promise). */
function raceSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => {});
    return Promise.reject(signal.reason ?? new Error('aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}
```

- [ ] **Step 4: Add the aliases and the targets**

In `src/lib/view/noticeText.ts`, at the end of `NOTICE_ALIASES`:

```ts
  // Local Native's readiness (#578 ruling 5): the old gate's sentences, which every locale has.
  native_engine_update_required: 'settings.localNativeEngineUpdateRequired',
  native_engine_required: 'settings.localNativeEngineRequired',
  native_unavailable: 'settings.localNativeUnavailable',
  native_starting: 'settings.localNativeStarting',
  native_asr_missing: 'settings.localNativeAsrIncompatible',
  native_translation_missing: 'settings.localNativeTranslationIncompatible',
```

In `src/lib/view/noticeTargets.ts`, at the end of `NOTICE_TARGETS`:

```ts
  // Local Native's readiness codes (#578 ruling 5): the engine card and the model chips are the provider section's.
  native_engine_update_required: 'provider',
  native_engine_required: 'provider',
  native_unavailable: 'provider',
  native_starting: 'provider',
  native_asr_missing: 'provider',
  native_translation_missing: 'provider',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/providers/local_native src/lib/view`
Expected: PASS. (If a `src/lib/view` test checks that every alias exists in every catalog, it passes: the six keys are in all 30.)

- [ ] **Step 6: Run the gates and commit**

```bash
git commit -m "feat(local_native): readiness over the native model store, worded by code

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe" -- src/providers/local_native/check.ts src/providers/local_native/check.test.ts src/lib/view/noticeText.ts src/lib/view/noticeTargets.ts src/lib/view/noticeText.test.ts
```

---

### Task 5: The sidecar seams — `engines.ts`

**Files:**
- Create: `src/providers/local_native/engines.ts`
- Test: `src/providers/local_native/engines.test.ts`

**Interfaces:**
- Consumes: `NativeAsrClient`, `NativeTranslateClient`, `NativeTtsClient`, `SidecarConnection` / `ISidecarConnection` (`src/lib/local-inference/native/`), `FakeSidecarConnection` (`SidecarConnection.fake.ts`, tests), `createNativeVadWorker` (Task 2), `SAMPLE_RATE`.
- Produces (Task 7's adapter and fakes implement and drive exactly these):

```ts
export interface NativeInitReport { loadTimeMs?: number; backend?: string; device?: string; computeType?: string; rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string }
export interface NativeTtsReady extends NativeInitReport { sampleRate: number; streaming: boolean; clones: boolean }
export interface NativeAsrLike {
  init(o: { language: string; modelId: string; device: NativeDevice; variant?: string }): Promise<NativeInitReport>;
  feedAudio(pcm: Int16Array): void;
  sendVadMark(event: 'start' | 'end' | 'cancel'): void;
  flush(): Promise<void>;
  dispose(): void;
  onPartialResult: ((text: string) => void) | null;
  onResult: ((r: { text: string; durationMs: number; recognitionTimeMs: number }) => void) | null;
  onError: ((message: string) => void) | null;
  onClosed: ((message: string) => void) | null;
}
export interface NativeTranslationLike {
  init(o: { sourceLang: string; targetLang: string; modelId: string; device: NativeDevice; variant?: string; asrModel?: string; ttsModel?: string }): Promise<NativeInitReport>;
  translate(text: string, systemPrompt: string, wrapTranscript: boolean): Promise<{ translatedText: string; inferenceTimeMs: number }>;
  dispose(): void;
  onPartial: ((text: string) => void) | null;
  onError: ((message: string) => void) | null;
  onClosed: ((message: string) => void) | null;
}
export interface NativeTtsLike {
  init(o: { modelId: string; device: NativeDevice; language: string; variant?: string }): Promise<NativeTtsReady>;
  setVoice(name: string): Promise<void>;
  setReferenceVoice(audio: Float32Array, sampleRate: number, transcript?: string): Promise<void>;
  generate(text: string, speed: number, onChunk?: (pcm: Float32Array) => void): Promise<{ samples: Float32Array; sampleRate: number; generationTimeMs: number }>;
  dispose(): void;
  onError: ((message: string) => void) | null;
  onClosed: ((message: string) => void) | null;
}
export interface NativeVadLike {
  init(config: LocalNativeConfig['vad']): Promise<void>;
  feed(pcm: Int16Array): void;
  flush(): void;
  dispose(): void;
  onSpeechStart: (() => void) | null;
  onSpeechEnd: (() => void) | null;
  onSpeechCancel: (() => void) | null;
  onError: ((message: string) => void) | null;
}
export interface LocalNativeEngines { asr(): NativeAsrLike; translation(): NativeTranslationLike; tts(): NativeTtsLike; vad(): NativeVadLike }
export function nativeAsr(conn?: ISidecarConnection): NativeAsrLike;
export function nativeTranslation(conn?: ISidecarConnection): NativeTranslationLike;
export function nativeTts(conn?: ISidecarConnection): NativeTtsLike;
export function nativeVad(factory?: () => Worker | null): NativeVadLike;
export const nativeEngines: LocalNativeEngines;
```

- [ ] **Step 1: Write the failing tests**

`src/providers/local_native/engines.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { FakeSidecarConnection } from '../../lib/local-inference/native/SidecarConnection.fake';
import type { ServerMsg } from '../../lib/local-inference/native/nativeProtocol';
import { nativeAsr, nativeTranslation, nativeTts, nativeVad } from './engines';

const msg = (m: Record<string, unknown>) => m as unknown as ServerMsg;

describe('nativeAsr', () => {
  it('inits at the contract rate with the device and variant, and feeds and marks the socket', async () => {
    const conn = new FakeSidecarConnection();
    const asr = nativeAsr(conn);
    const init = asr.init({ language: 'ja', modelId: 'asr-a', device: 'gpu', variant: 'q8_0' });
    expect(conn.sent[0]).toMatchObject({ type: 'asr_init', language: 'ja', model: 'asr-a', sampleRate: 24000, device: 'gpu', variant: 'q8_0' });
    conn.emit(msg({ type: 'ready', id: conn.sent[0].id, loadTimeMs: 5, device: 'vulkan' }));
    await expect(init).resolves.toMatchObject({ loadTimeMs: 5, device: 'vulkan' });
    const pcm = new Int16Array([1, 2, 3]);
    asr.feedAudio(pcm);
    asr.sendVadMark('start');
    expect(conn.binarySent).toEqual([pcm]);
    expect(conn.sent[1]).toEqual({ type: 'vad_mark', event: 'start' });
  });

  it('hands pushes to its hooks, an id-less error as an error, and a closed socket as closed', () => {
    const conn = new FakeSidecarConnection();
    const asr = nativeAsr(conn);
    asr.onPartialResult = vi.fn();
    asr.onResult = vi.fn();
    asr.onError = vi.fn();
    asr.onClosed = vi.fn();
    conn.emit(msg({ type: 'partial', text: 'こん' }));
    conn.emit(msg({ type: 'result', text: 'こんにちは', durationMs: 900, recognitionTimeMs: 90 }));
    conn.emit(msg({ type: 'error', message: 'feeder failed' }));
    conn.emitClose();
    expect(asr.onPartialResult).toHaveBeenCalledWith('こん');
    expect(asr.onResult).toHaveBeenCalledWith({ text: 'こんにちは', durationMs: 900, recognitionTimeMs: 90 });
    expect(asr.onError).toHaveBeenCalledWith('feeder failed');
    expect(asr.onClosed).toHaveBeenCalledWith('native host disconnected');
  });
});

describe('nativeTranslation', () => {
  it('inits with the co-loaded ids, streams partials, and reports a closed socket', async () => {
    const conn = new FakeSidecarConnection();
    const tr = nativeTranslation(conn);
    tr.onPartial = vi.fn();
    tr.onClosed = vi.fn();
    void tr.init({ sourceLang: 'ja', targetLang: 'en', modelId: 'mt-a', device: 'auto', asrModel: 'asr-a', ttsModel: 'tts-a' });
    expect(conn.sent[0]).toMatchObject({ type: 'translate_init', sourceLang: 'ja', targetLang: 'en', model: 'mt-a', device: 'auto', asrModel: 'asr-a', ttsModel: 'tts-a' });
    conn.emit(msg({ type: 'translate_partial', text: 'Hel' }));
    expect(tr.onPartial).toHaveBeenCalledWith('Hel');
    conn.emitClose();
    expect(tr.onClosed).toHaveBeenCalledWith('native host disconnected');
  });
});

describe('nativeTts', () => {
  it('a closed socket rejects the synthesis in flight and reports closed', async () => {
    const conn = new FakeSidecarConnection();
    const tts = nativeTts(conn);
    tts.onClosed = vi.fn();
    const init = tts.init({ modelId: 'tts-a', device: 'auto', language: 'en' });
    conn.emit(msg({ type: 'ready', id: conn.sent[0].id, loadTimeMs: 1, sampleRate: 24000, streaming: true, clones: false }));
    await expect(init).resolves.toMatchObject({ streaming: true, sampleRate: 24000 });
    const speaking = tts.generate('Hello.', 1, () => {});
    conn.emitClose();
    await expect(speaking).rejects.toThrow();
    expect(tts.onClosed).toHaveBeenCalledWith('native host disconnected');
  });
});

describe('nativeVad', () => {
  function fakeWorker() {
    const w = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as ((e: MessageEvent) => void) | null, onerror: null as ((e: ErrorEvent) => void) | null };
    return w;
  }
  const say = (w: ReturnType<typeof fakeWorker>, data: Record<string, unknown>) => w.onmessage?.({ data } as MessageEvent);

  it('inits the worker with the three knobs and no max duration, and maps its edges', async () => {
    const w = fakeWorker();
    const vad = nativeVad(() => w as unknown as Worker);
    vad.onSpeechStart = vi.fn();
    vad.onSpeechEnd = vi.fn();
    vad.onSpeechCancel = vi.fn();
    const init = vad.init({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
    const posted = w.postMessage.mock.calls[0][0];
    expect(posted.type).toBe('init');
    expect(posted.vadConfig).toEqual({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
    say(w, { type: 'ready' });
    await init;
    say(w, { type: 'speech_start' });
    say(w, { type: 'speech_end' });
    say(w, { type: 'speech_cancel' });
    expect(vad.onSpeechStart).toHaveBeenCalledTimes(1);
    expect(vad.onSpeechEnd).toHaveBeenCalledTimes(1);
    expect(vad.onSpeechCancel).toHaveBeenCalledTimes(1);
    vad.feed(new Int16Array([1]));
    vad.flush();
    vad.dispose();
    expect(w.postMessage.mock.calls.map((c) => c[0].type)).toEqual(['init', 'audio', 'flush', 'dispose']);
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  it('an error before ready rejects the init; after ready it is an error', async () => {
    const w1 = fakeWorker();
    const first = nativeVad(() => w1 as unknown as Worker);
    const init = first.init({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
    say(w1, { type: 'error', message: 'model missing' });
    await expect(init).rejects.toThrow('model missing');

    const w2 = fakeWorker();
    const second = nativeVad(() => w2 as unknown as Worker);
    second.onError = vi.fn();
    const ready = second.init({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
    say(w2, { type: 'ready' });
    await ready;
    say(w2, { type: 'error', message: 'segmenter died' });
    expect(second.onError).toHaveBeenCalledWith('segmenter died');
  });

  it('with no worker (tests, an unsupported page) it opens and does nothing', async () => {
    const vad = nativeVad(() => null);
    await expect(vad.init({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 })).resolves.toBeUndefined();
    expect(() => { vad.feed(new Int16Array(1)); vad.flush(); vad.dispose(); }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/local_native/engines.test.ts`
Expected: FAIL — `Failed to resolve import "./engines"`.

- [ ] **Step 3: Write `engines.ts`**

```ts
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { createNativeVadWorker } from '../../lib/local-inference/native/createNativeVadWorker';
import { NativeAsrClient } from '../../lib/local-inference/native/NativeAsrClient';
import { NativeTranslateClient } from '../../lib/local-inference/native/NativeTranslateClient';
import { NativeTtsClient } from '../../lib/local-inference/native/NativeTtsClient';
import { SidecarConnection, type ISidecarConnection } from '../../lib/local-inference/native/SidecarConnection';
import type { LocalNativeConfig } from './config';
import type { NativeDevice } from './settings';

/**
 * The narrow shapes Local Native's adapter drives, over today's sidecar
 * clients (`src/lib/local-inference/native/`) and the renderer VAD worker.
 * Each stage owns its socket, as the sidecar routes binary frames and frees
 * memory per connection. `onClosed`: the socket went away unasked — the
 * stage will answer nothing more (`dispose()` never fires it). Tests pass
 * fakes (`fakeEngines.ts`).
 */

/** What a stage's init reply reports: the sidecar's resolved plan. */
export interface NativeInitReport {
  loadTimeMs?: number;
  backend?: string;
  device?: string;
  computeType?: string;
  rtf?: number;
  tokensPerSec?: number;
  memoryBytes?: number;
  fallbackReason?: string;
}

export interface NativeTtsReady extends NativeInitReport {
  sampleRate: number;
  /** The family streams its synthesis in chunks. */
  streaming: boolean;
  /** The family clones a voice from a clip (the old catalog's fallback for the capability). */
  clones: boolean;
}

export interface NativeAsrLike {
  init(o: { language: string; modelId: string; device: NativeDevice; variant?: string }): Promise<NativeInitReport>;
  /** Contract-rate pcm, sent as is: the socket copies it. */
  feedAudio(pcm: Int16Array): void;
  /** A VAD edge; the sidecar cuts its utterances on these (spec Amendment A1 of the sidecar design). */
  sendVadMark(event: 'start' | 'end' | 'cancel'): void;
  flush(): Promise<void>;
  dispose(): void;
  /** The cumulative hypothesis for the utterance, never a delta. */
  onPartialResult: ((text: string) => void) | null;
  onResult: ((r: { text: string; durationMs: number; recognitionTimeMs: number }) => void) | null;
  /** An id-less error push: one chunk failed, the engine goes on. */
  onError: ((message: string) => void) | null;
  onClosed: ((message: string) => void) | null;
}

export interface NativeTranslationLike {
  init(o: { sourceLang: string; targetLang: string; modelId: string; device: NativeDevice; variant?: string; asrModel?: string; ttsModel?: string }): Promise<NativeInitReport>;
  translate(text: string, systemPrompt: string, wrapTranscript: boolean): Promise<{ translatedText: string; inferenceTimeMs: number }>;
  dispose(): void;
  /** The cleaned accumulation so far, once per token: never a delta. */
  onPartial: ((text: string) => void) | null;
  onError: ((message: string) => void) | null;
  onClosed: ((message: string) => void) | null;
}

export interface NativeTtsLike {
  init(o: { modelId: string; device: NativeDevice; language: string; variant?: string }): Promise<NativeTtsReady>;
  setVoice(name: string): Promise<void>;
  setReferenceVoice(audio: Float32Array, sampleRate: number, transcript?: string): Promise<void>;
  /** Streaming families call `onChunk` with 24 kHz Float32 and resolve with no samples; one-shot ones resolve with the clip at its own rate. */
  generate(text: string, speed: number, onChunk?: (pcm: Float32Array) => void): Promise<{ samples: Float32Array; sampleRate: number; generationTimeMs: number }>;
  dispose(): void;
  onError: ((message: string) => void) | null;
  onClosed: ((message: string) => void) | null;
}

export interface NativeVadLike {
  init(config: LocalNativeConfig['vad']): Promise<void>;
  feed(pcm: Int16Array): void;
  /** Ends the open speech segment now (a turn's end). */
  flush(): void;
  dispose(): void;
  onSpeechStart: (() => void) | null;
  onSpeechEnd: (() => void) | null;
  onSpeechCancel: (() => void) | null;
  /** The ready worker failed: no more edges will come. */
  onError: ((message: string) => void) | null;
}

export interface LocalNativeEngines {
  asr(): NativeAsrLike;
  translation(): NativeTranslationLike;
  tts(): NativeTtsLike;
  vad(): NativeVadLike;
}

export function nativeAsr(conn: ISidecarConnection = new SidecarConnection()): NativeAsrLike {
  const client = new NativeAsrClient(conn);
  const asr: NativeAsrLike = {
    onPartialResult: null,
    onResult: null,
    onError: null,
    onClosed: null,
    init: ({ language, modelId, device, variant }) => client.init(language, modelId, SAMPLE_RATE, device, variant),
    feedAudio: (pcm) => client.feedAudio(pcm, SAMPLE_RATE),
    sendVadMark: (event) => client.sendVadMark(event),
    flush: () => client.flush(),
    dispose: () => client.dispose(),
  };
  client.onPartialResult = (text) => asr.onPartialResult?.(text);
  client.onResult = (r) => asr.onResult?.({ text: r.text, durationMs: r.durationMs, recognitionTimeMs: r.recognitionTimeMs });
  client.onError = (message) => asr.onError?.(message);
  conn.onClose((error) => asr.onClosed?.(error.message));
  return asr;
}

export function nativeTranslation(conn: ISidecarConnection = new SidecarConnection()): NativeTranslationLike {
  const client = new NativeTranslateClient(conn);
  const translation: NativeTranslationLike = {
    onPartial: null,
    onError: null,
    onClosed: null,
    init: ({ sourceLang, targetLang, modelId, device, variant, asrModel, ttsModel }) =>
      client.init(sourceLang, targetLang, modelId, device, asrModel ?? null, ttsModel ?? null, variant),
    translate: (text, systemPrompt, wrapTranscript) => client.translate(text, systemPrompt, wrapTranscript),
    dispose: () => client.dispose(),
  };
  client.onPartial = (text) => translation.onPartial?.(text);
  client.onError = (message) => translation.onError?.(message);
  conn.onClose((error) => translation.onClosed?.(error.message));
  return translation;
}

export function nativeTts(conn: ISidecarConnection = new SidecarConnection()): NativeTtsLike {
  const client = new NativeTtsClient(conn);
  const tts: NativeTtsLike = {
    onError: null,
    onClosed: null,
    init: ({ modelId, device, language, variant }) => client.init(modelId, device, language, variant),
    setVoice: (name) => client.setVoice(name),
    setReferenceVoice: (audio, sampleRate, transcript) => client.setReferenceVoice(audio, sampleRate, transcript),
    generate: (text, speed, onChunk) => client.generate(text, speed, onChunk ? (pcm) => onChunk(pcm) : undefined),
    dispose: () => client.dispose(),
  };
  client.onError = (message) => tts.onError?.(message);
  // The connection keeps one close handler, and the client's own rejects its
  // streams: this one takes its place, so it disposes the client — which
  // rejects them — before saying so.
  conn.onClose((error) => {
    client.dispose();
    tts.onClosed?.(error.message);
  });
  return tts;
}

export function nativeVad(factory: () => Worker | null = createNativeVadWorker): NativeVadLike {
  const worker = factory();
  let ready = false;
  const vad: NativeVadLike = {
    onSpeechStart: null,
    onSpeechEnd: null,
    onSpeechCancel: null,
    onError: null,
    init: (config) => new Promise<void>((resolve, reject) => {
      if (!worker) { resolve(); return; }
      const failed = (message: string) => {
        if (ready) vad.onError?.(message);
        else reject(new Error(message));
      };
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; message?: string };
        if (m.type === 'ready') { ready = true; resolve(); }
        else if (m.type === 'speech_start') vad.onSpeechStart?.();
        else if (m.type === 'speech_end') vad.onSpeechEnd?.();
        else if (m.type === 'speech_cancel') vad.onSpeechCancel?.();
        else if (m.type === 'error') failed(m.message ?? 'VAD worker failed');
      };
      worker.onerror = (e: ErrorEvent) => failed(e.message || 'VAD worker failed');
      worker.postMessage({
        type: 'init',
        ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
        vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
        // Three knobs and no max duration: the worker cuts at 19 s itself, under the sidecar's own backstop.
        vadConfig: { threshold: config.threshold, minSilenceDuration: config.minSilenceDuration, minSpeechDuration: config.minSpeechDuration },
      });
    }),
    feed: (pcm) => worker?.postMessage({ type: 'audio', pcm, sampleRate: SAMPLE_RATE }),
    flush: () => worker?.postMessage({ type: 'flush' }),
    dispose: () => {
      worker?.postMessage({ type: 'dispose' });
      worker?.terminate();
    },
  };
  return vad;
}

export const nativeEngines: LocalNativeEngines = {
  asr: () => nativeAsr(),
  translation: () => nativeTranslation(),
  tts: () => nativeTts(),
  vad: () => nativeVad(),
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/local_native/engines.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 5: Run the gates and commit**

```bash
git commit -m "feat(local_native): the sidecar and VAD seams the adapter drives

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe" -- src/providers/local_native/engines.ts src/providers/local_native/engines.test.ts
```

---
### Task 6: The host, the voice and the speech

**Files:**
- Create: `src/providers/local_native/host.ts`, `src/providers/local_native/voice.ts`, `src/providers/local_native/speech.ts`
- Test: `src/providers/local_native/voice.test.ts`, `src/providers/local_native/speech.test.ts`

**Interfaces:**
- Consumes: `NativeTtsLike`, `NativeTtsReady`, `NativeInitReport` (Task 5); `LocalNativeConfig['tts']` (Task 3); `requiresVoiceClip`, `eligibleCustomVoices`, `voiceCapability`, `VoiceCustom` (`nativeCatalog.ts`); `reconcileTtsVoice` (`nativeTtsVoiceReconciliation.ts`); `NativeVoiceStore` (`nativeVoiceStores.ts`); `tileSpan` (`src/lib/contract/ranges.ts`); `splitSentences`, `float32ToInt16`, `resampleFloat32`.
- Produces:

```ts
// host.ts
export type NativeStage = 'asr' | 'translation' | 'tts';
export interface NativePlan extends NativeInitReport { model: string; device: string }
export interface NativeHost {
  listVoices(modelId: string): Promise<NativeVoiceInfo[]>;
  voiceStore(custom: VoiceCustom, modelId: string): NativeVoiceStore | null;
  hardware(): Promise<HardwareInfoResultMsg | null>;
  plan(stage: NativeStage, plan: NativePlan): void;
}
// voice.ts
export async function voiceClipMissing(config: NonNullable<LocalNativeConfig['tts']>, host: NativeHost): Promise<boolean>;
export interface AppliedVoice { voice: string; substituted?: { from: string; to: string } }
export async function applyVoice(tts: NativeTtsLike, config: NonNullable<LocalNativeConfig['tts']>, language: string, ready: NativeTtsReady, host: NativeHost): Promise<AppliedVoice>;
// speech.ts
export interface NativeSpeechEmit {
  audio(pcm: Int16Array, range?: TextRange): void;
  ranges(entries: ReadonlyArray<{ index: number; range: TextRange }>): void;
  degraded(message: string, cause?: unknown): void;
  frame(direction: 'in' | 'out', type: string, payload: Record<string, unknown>): void;
}
export function locateSentence(text: string, sentence: string, searchFrom: number): { range?: TextRange; nextSearchFrom: number };
export async function speakNative(tts: NativeTtsLike, text: string, lang: string, opts: { modelId: string; voice: string; speed: number; streaming: boolean }, emit: NativeSpeechEmit, isEnded: () => boolean, clock: Clock): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

`src/providers/local_native/voice.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { NativeVoiceStore } from '../../lib/local-inference/native/nativeVoiceStores';
import type { NativeHost } from './host';
import type { LocalNativeConfig } from './config';
import type { NativeTtsLike, NativeTtsReady } from './engines';
import { applyVoice, voiceClipMissing } from './voice';

type TtsConfig = NonNullable<LocalNativeConfig['tts']>;
const tts = (over: Partial<TtsConfig> = {}): TtsConfig => ({ modelId: 'tts-a', device: 'auto', speed: 1, voice: '', capability: null, ...over });
const ready = (over: Partial<NativeTtsReady> = {}): NativeTtsReady => ({ sampleRate: 24000, streaming: false, clones: false, ...over });

function store(clips: Array<{ id: number; hasTranscript?: boolean }>, failList = false): NativeVoiceStore {
  return {
    kind: 'clip',
    capability: {} as NativeVoiceStore['capability'],
    list: vi.fn(async () => { if (failList) throw new Error('idb'); return clips.map((c) => ({ name: `clip ${c.id}`, ...c })); }),
    onImport: vi.fn(), rename: vi.fn(), delete: vi.fn(),
    resolveApply: vi.fn(async (id: number) => ({ kind: 'clip' as const, audio: new Float32Array([id]), sampleRate: 24000, transcript: `t${id}` })),
  };
}
function host(over: Partial<NativeHost> = {}): NativeHost {
  return { listVoices: vi.fn(async () => []), voiceStore: vi.fn(() => null), hardware: vi.fn(async () => null), plan: vi.fn(), ...over };
}
function engine(): NativeTtsLike & { setVoice: ReturnType<typeof vi.fn>; setReferenceVoice: ReturnType<typeof vi.fn> } {
  return {
    init: vi.fn(), generate: vi.fn(), dispose: vi.fn(), onError: null, onClosed: null,
    setVoice: vi.fn(async () => {}), setReferenceVoice: vi.fn(async () => {}),
  } as never;
}
const cloneOnly = { builtin: 'none' as const, custom: 'clip' as const, required: true };

describe('voiceClipMissing', () => {
  it('a clone-only model with no usable clip cannot speak', async () => {
    expect(await voiceClipMissing(tts({ capability: cloneOnly }), host({ voiceStore: () => store([]) }))).toBe(true);
    expect(await voiceClipMissing(tts({ capability: { ...cloneOnly, transcriptRequired: true } }), host({ voiceStore: () => store([{ id: 1 }]) }))).toBe(true);
    expect(await voiceClipMissing(tts({ capability: cloneOnly }), host({ voiceStore: () => store([], true) }))).toBe(true);
  });
  it('a clip, a model that speaks unset, or an unknown capability is not gated', async () => {
    expect(await voiceClipMissing(tts({ capability: cloneOnly }), host({ voiceStore: () => store([{ id: 1 }]) }))).toBe(false);
    expect(await voiceClipMissing(tts({ capability: { builtin: 'named', custom: 'clip', required: false } }), host())).toBe(false);
    expect(await voiceClipMissing(tts({ capability: null }), host())).toBe(false);
  });
});

describe('applyVoice', () => {
  it('applies a stored built-in voice the model lists', async () => {
    const e = engine();
    const voices = [{ name: 'Bella', language: 'en', curated: true, unstable: false, default: false }];
    const r = await applyVoice(e, tts({ voice: 'builtin:Bella', capability: { builtin: 'named', custom: 'none' } }), 'en', ready(), host({ listVoices: async () => voices }));
    expect(e.setVoice).toHaveBeenCalledWith('Bella');
    expect(r).toEqual({ voice: 'builtin:Bella' });
  });

  it('applies a stored custom clip by its reference audio and transcript', async () => {
    const e = engine();
    const r = await applyVoice(e, tts({ voice: 'custom:3', capability: cloneOnly }), 'en', ready(), host({ voiceStore: () => store([{ id: 3 }]) }));
    expect(e.setReferenceVoice).toHaveBeenCalledWith(new Float32Array([3]), 24000, 't3');
    expect(r).toEqual({ voice: 'custom:3' });
  });

  it('a custom clip no longer usable is substituted, and says so (R35)', async () => {
    const e = engine();
    const r = await applyVoice(e, tts({ voice: 'custom:9', capability: cloneOnly }), 'en', ready(), host({ voiceStore: () => store([{ id: 3 }]) }));
    expect(r).toEqual({ voice: 'custom:3', substituted: { from: '9', to: '3' } });
  });

  it('with no catalog entry, reads the init reply\'s clones', async () => {
    const listVoices = vi.fn(async () => []);
    await applyVoice(engine(), tts({ capability: null }), 'en', ready({ clones: true }), host({ listVoices }));
    expect(listVoices).toHaveBeenCalledWith('tts-a');
  });
});
```

`src/providers/local_native/speech.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { TextRange } from '../../lib/contract/adapter';
import type { NativeTtsLike } from './engines';
import { locateSentence, speakNative, type NativeSpeechEmit } from './speech';

type Chunked = (text: string, speed: number, onChunk?: (pcm: Float32Array) => void) => Promise<{ samples: Float32Array; sampleRate: number; generationTimeMs: number }>;
function engine(generate: Chunked): NativeTtsLike {
  return { init: vi.fn(), setVoice: vi.fn(), setReferenceVoice: vi.fn(), generate: vi.fn(generate), dispose: vi.fn(), onError: null, onClosed: null };
}
function recorder() {
  const audio: Array<{ samples: number; range?: TextRange }> = [];
  const ranges: Array<ReadonlyArray<{ index: number; range: TextRange }>> = [];
  const degraded: string[] = [];
  const frames: string[] = [];
  const emit: NativeSpeechEmit = {
    audio: (pcm, range) => audio.push(range ? { samples: pcm.length, range } : { samples: pcm.length }),
    ranges: (entries) => ranges.push(entries),
    degraded: (message) => degraded.push(message),
    frame: (_d, type) => frames.push(type),
  };
  return { emit, audio, ranges, degraded, frames };
}
const opts = (streaming: boolean) => ({ modelId: 'tts-a', voice: 'builtin:Bella', speed: 1, streaming });
const TEXT = 'Hello there. How are you?';

describe('speakNative', () => {
  it('one-shot: one ranged clip per sentence, resampled to 24 kHz', async () => {
    const r = recorder();
    const tts = engine(async () => ({ samples: new Float32Array(1600), sampleRate: 16000, generationTimeMs: 4 }));
    await speakNative(tts, TEXT, 'en', opts(false), r.emit, () => false, createVirtualClock());
    expect(r.audio).toEqual([{ samples: 2400, range: [0, 12] }, { samples: 2400, range: [13, 25] }]);
    expect(r.ranges).toEqual([]);
    expect(r.frames[0]).toBe('local.native.tts.start');
    expect(r.frames[r.frames.length - 1]).toBe('local.native.tts.end');
  });

  it("streaming: each chunk unranged as it arrives, then the sentence's range divided among them (#578 ruling 9)", async () => {
    const r = recorder();
    const tts = engine(async (_t, _s, onChunk) => {
      onChunk?.(new Float32Array(1000));
      onChunk?.(new Float32Array(3000));
      return { samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: 6 };
    });
    await speakNative(tts, TEXT, 'en', opts(true), r.emit, () => false, createVirtualClock());
    expect(r.audio).toEqual([{ samples: 1000 }, { samples: 3000 }, { samples: 1000 }, { samples: 3000 }]);
    expect(r.ranges).toEqual([
      [{ index: 0, range: [0, 3] }, { index: 1, range: [3, 12] }],
      [{ index: 2, range: [13, 16] }, { index: 3, range: [16, 25] }],
    ]);
  });

  it('a sentence that fails is skipped and said; the next still runs', async () => {
    const r = recorder();
    let n = 0;
    const tts = engine(async () => {
      if (n++ === 0) throw new Error('synth crashed');
      return { samples: new Float32Array(2400), sampleRate: 24000, generationTimeMs: 1 };
    });
    await speakNative(tts, TEXT, 'en', opts(false), r.emit, () => false, createVirtualClock());
    expect(r.degraded).toEqual(['a sentence could not be spoken: synth crashed']);
    expect(r.audio).toEqual([{ samples: 2400, range: [13, 25] }]);
  });

  it('ended while synthesizing: the late answer says nothing', async () => {
    const r = recorder();
    let ended = false;
    const tts = engine(async () => { ended = true; return { samples: new Float32Array(2400), sampleRate: 24000, generationTimeMs: 1 }; });
    await speakNative(tts, TEXT, 'en', opts(false), r.emit, () => ended, createVirtualClock());
    expect(r.audio).toEqual([]);
    expect(r.frames).not.toContain('local.native.tts.end');
  });

  it('locates a sentence from where the last one ended, and steps over a miss', () => {
    expect(locateSentence('ab. ab.', 'ab.', 3)).toEqual({ range: [4, 7], nextSearchFrom: 7 });
    expect(locateSentence('ab.', 'zz', 0)).toEqual({ range: undefined, nextSearchFrom: 2 });
  });
});
```

(`splitSentences` trims each `Intl.Segmenter` sentence, so `'Hello there. How are you?'` gives `['Hello there.', 'How are you?']` at `[0, 12]` and `[13, 25]`; `resampleFloat32` turns 1600 samples at 16 kHz into `Math.round(1600 / (16000 / 24000))` = 2400.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/local_native/voice.test.ts src/providers/local_native/speech.test.ts`
Expected: FAIL — `Failed to resolve import "./voice"` / `"./speech"`.

- [ ] **Step 3: Write `host.ts`**

```ts
import type { VoiceCustom } from '../../lib/local-inference/native/nativeCatalog';
import type { HardwareInfoResultMsg, NativeVoiceInfo } from '../../lib/local-inference/native/nativeProtocol';
import type { NativeVoiceStore } from '../../lib/local-inference/native/nativeVoiceStores';
import type { NativeInitReport } from './engines';

export type NativeStage = 'asr' | 'translation' | 'tts';

/** A stage's resolved plan, as the library's badges read it. */
export interface NativePlan extends NativeInitReport {
  model: string;
  device: string;
}

/**
 * What the adapter asks of the app around it. The definition hands it in
 * (`bridge.ts`), so the session side imports no store (#578 ruling 14); tests
 * hand in a fake.
 */
export interface NativeHost {
  /** Built-in voice names for a voice-capable model; [] when unavailable. */
  listVoices(modelId: string): Promise<NativeVoiceInfo[]>;
  /** The custom-clip store for a capability, or null when the model takes none. */
  voiceStore(custom: VoiceCustom, modelId: string): NativeVoiceStore | null;
  /** A machine snapshot for the Logs panel; null when unavailable. */
  hardware(): Promise<HardwareInfoResultMsg | null>;
  /** The sidecar's resolved plan for one stage. */
  plan(stage: NativeStage, plan: NativePlan): void;
}
```

- [ ] **Step 4: Write `voice.ts`**

```ts
import { eligibleCustomVoices, requiresVoiceClip, voiceCapability, type VoiceCapability } from '../../lib/local-inference/native/nativeCatalog';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { reconcileTtsVoice } from '../../lib/local-inference/native/nativeTtsVoiceReconciliation';
import type { LocalNativeConfig } from './config';
import type { NativeTtsLike, NativeTtsReady } from './engines';
import type { NativeHost } from './host';

type TtsConfig = NonNullable<LocalNativeConfig['tts']>;

/**
 * The renderer's mirror of the sidecar's R16 pre-check: a model that reports
 * `voice.required` cannot speak without a stored clip, known before it loads.
 * Storage that fails counts as no clip. A model the catalog does not list is
 * not gated, as the old client skipped it.
 */
export async function voiceClipMissing(config: TtsConfig, host: NativeHost): Promise<boolean> {
  const capability = config.capability;
  if (!capability || !requiresVoiceClip(capability)) return false;
  const store = host.voiceStore(capability.custom, config.modelId);
  if (!store) return true;
  try {
    return eligibleCustomVoices(await store.list(), capability.transcriptRequired).length === 0;
  } catch {
    return true;
  }
}

export interface AppliedVoice {
  /** What was applied: `builtin:<name>`, `custom:<id>`, or the stored value passed through. */
  voice: string;
  /** A stored custom clip no longer usable, swapped for another (R35). */
  substituted?: { from: string; to: string };
}

/**
 * The stored voice reconciled against what this model and this device hold,
 * and applied (the old client's `connect()`, next-session semantics). The
 * catalog's capability, or the init reply's `clones` when the catalog does
 * not list the model. Storage failing leaves the built-in voices only.
 */
export async function applyVoice(
  tts: NativeTtsLike,
  config: TtsConfig,
  language: string,
  ready: NativeTtsReady,
  host: NativeHost,
): Promise<AppliedVoice> {
  const capability: VoiceCapability = config.capability ?? voiceCapability({ clones: ready.clones } as unknown as NativeModelInfo);
  const store = host.voiceStore(capability.custom, config.modelId);
  let customIds: number[] = [];
  if (store) {
    try {
      customIds = eligibleCustomVoices(await store.list(), capability.transcriptRequired).map((v) => v.id);
    } catch { /* storage unavailable: built-in voices only */ }
  }
  const voices = capability.builtin === 'named' ? await host.listVoices(config.modelId) : [];
  const voice = reconcileTtsVoice(config.voice, customIds, language, voices, capability.custom !== 'none', capability.builtin === 'named');
  const applied: AppliedVoice = { voice };
  if (config.voice.startsWith('custom:') && voice.startsWith('custom:') && voice !== config.voice) {
    applied.substituted = { from: config.voice.slice('custom:'.length), to: voice.slice('custom:'.length) };
  }
  if (voice.startsWith('builtin:')) {
    await tts.setVoice(voice.slice('builtin:'.length));
  } else if (voice.startsWith('custom:') && store) {
    const payload = await store.resolveApply(Number(voice.slice('custom:'.length)));
    if (payload?.kind === 'clip') await tts.setReferenceVoice(payload.audio, payload.sampleRate, payload.transcript);
  }
  return applied;
}
```

- [ ] **Step 5: Write `speech.ts`**

```ts
import { SAMPLE_RATE, type TextRange } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import { tileSpan } from '../../lib/contract/ranges';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { float32ToInt16, resampleFloat32 } from '../../utils/audio-conversion';
import { splitSentences } from '../../utils/splitSentences';
import type { NativeTtsLike } from './engines';

/**
 * One translation spoken sentence by sentence (the old client's `runJob`
 * TTS loop). One-shot families: one clip per sentence with its exact range.
 * Streaming families: each chunk as it arrives, unranged, and once the
 * sentence ends its range divided among those chunks by sample count —
 * `speechRanges`, Soniox's method (#578 ruling 9). A sentence that fails is
 * reported and skipped; `isEnded` is read between sentences and when one
 * settles, so a session that stopped meanwhile hears nothing more.
 */
export interface NativeSpeechEmit {
  audio(pcm: Int16Array, range?: TextRange): void;
  /** The ranges of this text's earlier audio entries, by their place among them (0 first). */
  ranges(entries: ReadonlyArray<{ index: number; range: TextRange }>): void;
  degraded(message: string, cause?: unknown): void;
  frame(direction: 'in' | 'out', type: string, payload: Record<string, unknown>): void;
}

/** The sentence's UTF-16 range in `text`, searching from where the last one ended; on a miss, no range, and the search still advances. */
export function locateSentence(text: string, sentence: string, searchFrom: number): { range?: TextRange; nextSearchFrom: number } {
  const pos = text.indexOf(sentence, searchFrom);
  if (pos >= 0) return { range: [pos, pos + sentence.length], nextSearchFrom: pos + sentence.length };
  return { range: undefined, nextSearchFrom: searchFrom + sentence.length };
}

export async function speakNative(
  tts: NativeTtsLike,
  text: string,
  lang: string,
  opts: { modelId: string; voice: string; speed: number; streaming: boolean },
  emit: NativeSpeechEmit,
  isEnded: () => boolean,
  clock: Clock,
): Promise<void> {
  const sentences = splitSentences(text, lang).filter((s) => s.trim());
  emit.frame('out', 'local.native.tts.start', { text, sentenceCount: sentences.length, modelId: opts.modelId, voice: opts.voice, speed: opts.speed });
  const ttsStart = clock.now();
  let searchFrom = 0;
  /** Audio entries this text has had so far: a `ranges` index names one of them. */
  let entries = 0;

  for (let i = 0; i < sentences.length; i++) {
    if (isEnded()) return;
    const sentence = sentences[i];
    const { range, nextSearchFrom } = locateSentence(text, sentence, searchFrom);
    searchFrom = nextSearchFrom;
    emit.frame('out', 'local.native.tts.sentence.start', { sentenceIndex: i, sentenceCount: sentences.length, text: sentence });
    const sentenceStart = clock.now();
    const chunks: Array<{ index: number; samples: number }> = [];
    let samples = 0;
    let generationTimeMs: number;
    try {
      if (opts.streaming) {
        const done = await tts.generate(sentence, opts.speed, (pcm) => {
          if (isEnded()) return;
          // Streaming chunks arrive at the contract's 24 kHz already.
          const int16 = float32ToInt16(pcm);
          if (int16.length === 0) return;
          chunks.push({ index: entries++, samples: int16.length });
          samples += int16.length;
          emit.audio(int16);
        });
        generationTimeMs = done.generationTimeMs;
      } else {
        const result = await tts.generate(sentence, opts.speed);
        if (isEnded()) return;
        const int16 = float32ToInt16(resampleFloat32(result.samples, result.sampleRate, SAMPLE_RATE));
        samples = int16.length;
        generationTimeMs = result.generationTimeMs;
        if (int16.length > 0) {
          entries++;
          emit.audio(int16, range);
        }
      }
    } catch (error) {
      if (isEnded()) return;
      emit.frame('in', 'local.native.tts.error', { error: describeCause(error), sentenceIndex: i });
      emit.degraded(`a sentence could not be spoken: ${describeCause(error)}`, error);
      continue;
    }
    if (isEnded()) return;
    if (range && chunks.length > 0) {
      const tiles = tileSpan(range, chunks.map((c) => c.samples), text);
      emit.ranges(chunks.map((c, k) => ({ index: c.index, range: tiles[k] })));
    }
    const audioDurationMs = Math.round((samples / SAMPLE_RATE) * 1000);
    const generateMs = generationTimeMs ?? clock.now() - sentenceStart;
    emit.frame('in', 'local.native.tts.sentence.end', {
      sentenceIndex: i,
      sentenceCount: sentences.length,
      text: sentence,
      generateMs,
      audioDurationMs,
      ...(audioDurationMs > 0 ? { rtf: Math.round((generateMs / audioDurationMs) * 1000) / 1000 } : {}),
    });
  }
  emit.frame('in', 'local.native.tts.end', { sentenceCount: sentences.length, durationMs: clock.now() - ttsStart });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/providers/local_native/voice.test.ts src/providers/local_native/speech.test.ts`
Expected: PASS (voice: 6, speech: 5).

- [ ] **Step 7: Run the gates and commit**

```bash
git commit -m "feat(local_native): the voice to apply and the speech, ranged

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe" -- src/providers/local_native/host.ts src/providers/local_native/voice.ts src/providers/local_native/voice.test.ts src/providers/local_native/speech.ts src/providers/local_native/speech.test.ts
```

---

### Task 7: The adapter

**Files:**
- Create: `src/providers/local_native/fakeEngines.ts`
- Replace: `src/providers/local_native/adapter.ts` (Task 3's placeholder)
- Test: `src/providers/local_native/adapter.test.ts`
- Modify: `src/providers/sessionSide.consistency.test.ts` (Local Native's session side and its test-only fakes)

**Interfaces:**
- Consumes: Tasks 3, 5 and 6 as declared; `SentenceCut`, `runtimeOver` from `src/lib/segmentation/sentenceCut` (Task 1); `fillIn` (`src/lib/conversation/fillIn.ts`); `gateChars` (`SentenceStream.ts`); `DEFAULT_CHUNK_SENTENCES`.
- Produces:

```ts
export type LocalNativeCredentials = Record<string, never>;
export const VAD_INIT_TIMEOUT_MS = 15_000;
export function createLocalNativeAdapter(engines: LocalNativeEngines, host: NativeHost): Adapter<LocalNativeConfig, LocalNativeCredentials>;
// fakeEngines.ts (test only)
export function createFakeNativeEngines(): { engines: LocalNativeEngines; asr: FakeNativeAsr; translation: FakeNativeTranslation; tts: FakeNativeTts; vad: FakeNativeVad; calls: string[] };
export function createFakeNativeHost(over?: Partial<NativeHost>): NativeHost & { plans: Array<{ stage: NativeStage; plan: NativePlan }> };
```

- [ ] **Step 1: Write the fakes**

`src/providers/local_native/fakeEngines.ts`:

```ts
/**
 * Test support: Local Native's seams driven by hand. Each `init` stays
 * pending until the test settles it; `calls` records the order the adapter
 * initialised them in.
 */
import type { LocalNativeConfig } from './config';
import type {
  LocalNativeEngines, NativeAsrLike, NativeInitReport, NativeTranslationLike, NativeTtsLike, NativeTtsReady, NativeVadLike,
} from './engines';
import type { NativeHost, NativePlan, NativeStage } from './host';

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const REPORT: NativeInitReport = { loadTimeMs: 3, device: 'cpu', backend: 'ct2', computeType: 'int8' };

export class FakeNativeAsr implements NativeAsrLike {
  onPartialResult: NativeAsrLike['onPartialResult'] = null;
  onResult: NativeAsrLike['onResult'] = null;
  onError: NativeAsrLike['onError'] = null;
  onClosed: NativeAsrLike['onClosed'] = null;
  inits: Array<Parameters<NativeAsrLike['init']>[0]> = [];
  fed: Int16Array[] = [];
  marks: string[] = [];
  flushes = 0;
  disposes = 0;
  flushResult: Promise<void> = Promise.resolve();
  private loading = deferred<NativeInitReport>();
  constructor(private readonly calls: string[]) {}
  init(o: Parameters<NativeAsrLike['init']>[0]) { this.calls.push('asr'); this.inits.push(o); return this.loading.promise; }
  ready(report: NativeInitReport = REPORT) { this.loading.resolve(report); }
  failInit(message: string) { this.loading.reject(new Error(message)); }
  feedAudio(pcm: Int16Array) { this.fed.push(new Int16Array(pcm)); }
  sendVadMark(event: 'start' | 'end' | 'cancel') { this.marks.push(event); }
  flush() { this.flushes++; return this.flushResult; }
  dispose() { this.disposes++; }
  partial(text: string) { this.onPartialResult?.(text); }
  final(text: string) { this.onResult?.({ text, durationMs: 1000, recognitionTimeMs: 100 }); }
  fail(message: string) { this.onError?.(message); }
  close(message = 'native host disconnected') { this.onClosed?.(message); }
}

export class FakeNativeTranslation implements NativeTranslationLike {
  onPartial: NativeTranslationLike['onPartial'] = null;
  onError: NativeTranslationLike['onError'] = null;
  onClosed: NativeTranslationLike['onClosed'] = null;
  inits: Array<Parameters<NativeTranslationLike['init']>[0]> = [];
  calls: Array<{ text: string; systemPrompt: string; wrapTranscript: boolean }> = [];
  disposes = 0;
  private loading = deferred<NativeInitReport>();
  private pending: Array<Deferred<{ translatedText: string; inferenceTimeMs: number }>> = [];
  constructor(private readonly order: string[]) {}
  init(o: Parameters<NativeTranslationLike['init']>[0]) { this.order.push('translation'); this.inits.push(o); return this.loading.promise; }
  ready(report: NativeInitReport = { ...REPORT, tokensPerSec: 40 }) { this.loading.resolve(report); }
  failInit(message: string) { this.loading.reject(new Error(message)); }
  translate(text: string, systemPrompt: string, wrapTranscript: boolean) {
    this.calls.push({ text, systemPrompt, wrapTranscript });
    const d = deferred<{ translatedText: string; inferenceTimeMs: number }>();
    this.pending.push(d);
    return d.promise;
  }
  /** A `translate_partial` push for the request in flight. */
  stream(text: string) { this.onPartial?.(text); }
  answer(translatedText: string) { this.pending.shift()!.resolve({ translatedText, inferenceTimeMs: 12 }); }
  reject(message: string) { this.pending.shift()!.reject(new Error(message)); }
  dispose() { this.disposes++; }
  close(message = 'native host disconnected') { this.onClosed?.(message); }
}

export class FakeNativeTts implements NativeTtsLike {
  onError: NativeTtsLike['onError'] = null;
  onClosed: NativeTtsLike['onClosed'] = null;
  inits: Array<Parameters<NativeTtsLike['init']>[0]> = [];
  voices: string[] = [];
  references: Array<{ sampleRate: number; transcript?: string }> = [];
  spoken: string[] = [];
  disposes = 0;
  private loading = deferred<NativeTtsReady>();
  private pending: Array<{ onChunk?: (pcm: Float32Array) => void; d: Deferred<{ samples: Float32Array; sampleRate: number; generationTimeMs: number }> }> = [];
  constructor(private readonly order: string[]) {}
  init(o: Parameters<NativeTtsLike['init']>[0]) { this.order.push('tts'); this.inits.push(o); return this.loading.promise; }
  ready(over: Partial<NativeTtsReady> = {}) { this.loading.resolve({ sampleRate: 24000, streaming: false, clones: false, ...REPORT, ...over }); }
  failInit(message: string) { this.loading.reject(new Error(message)); }
  setVoice(name: string) { this.voices.push(name); return Promise.resolve(); }
  setReferenceVoice(_audio: Float32Array, sampleRate: number, transcript?: string) { this.references.push({ sampleRate, transcript }); return Promise.resolve(); }
  generate(text: string, _speed: number, onChunk?: (pcm: Float32Array) => void) {
    this.spoken.push(text);
    const d = deferred<{ samples: Float32Array; sampleRate: number; generationTimeMs: number }>();
    this.pending.push({ onChunk, d });
    return d.promise;
  }
  /** One-shot: the oldest synthesis answers with this clip. */
  say(samples = new Float32Array(2400).fill(0.1), sampleRate = 24000) { this.pending.shift()!.d.resolve({ samples, sampleRate, generationTimeMs: 5 }); }
  /** Streaming: a chunk for the oldest synthesis. */
  chunk(samples = new Float32Array(1200).fill(0.1)) { this.pending[0].onChunk?.(samples); }
  /** Streaming: the oldest synthesis is done. */
  finish() { this.pending.shift()!.d.resolve({ samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: 7 }); }
  failSpeech(message: string) { this.pending.shift()!.d.reject(new Error(message)); }
  /** Like the real client, a dispose rejects every synthesis in flight. */
  dispose() {
    this.disposes++;
    for (const p of this.pending.splice(0)) p.d.reject(new Error('native host disconnected'));
  }
  close(message = 'native host disconnected') { this.onClosed?.(message); }
}

export class FakeNativeVad implements NativeVadLike {
  onSpeechStart: NativeVadLike['onSpeechStart'] = null;
  onSpeechEnd: NativeVadLike['onSpeechEnd'] = null;
  onSpeechCancel: NativeVadLike['onSpeechCancel'] = null;
  onError: NativeVadLike['onError'] = null;
  inits: Array<LocalNativeConfig['vad']> = [];
  fed: Int16Array[] = [];
  flushes = 0;
  disposes = 0;
  private loading = deferred<void>();
  constructor(private readonly order: string[]) {}
  init(config: LocalNativeConfig['vad']) { this.order.push('vad'); this.inits.push(config); return this.loading.promise; }
  ready() { this.loading.resolve(); }
  failInit(message: string) { this.loading.reject(new Error(message)); }
  feed(pcm: Int16Array) { this.fed.push(new Int16Array(pcm)); }
  flush() { this.flushes++; }
  dispose() { this.disposes++; }
  start() { this.onSpeechStart?.(); }
  end() { this.onSpeechEnd?.(); }
  cancel() { this.onSpeechCancel?.(); }
  fail(message: string) { this.onError?.(message); }
}

export function createFakeNativeEngines() {
  const calls: string[] = [];
  const asr = new FakeNativeAsr(calls);
  const translation = new FakeNativeTranslation(calls);
  const tts = new FakeNativeTts(calls);
  const vad = new FakeNativeVad(calls);
  const engines: LocalNativeEngines = { asr: () => asr, translation: () => translation, tts: () => tts, vad: () => vad };
  return { engines, asr, translation, tts, vad, calls };
}

export function createFakeNativeHost(over: Partial<NativeHost> = {}): NativeHost & { plans: Array<{ stage: NativeStage; plan: NativePlan }> } {
  const plans: Array<{ stage: NativeStage; plan: NativePlan }> = [];
  return {
    plans,
    listVoices: async () => [],
    voiceStore: () => null,
    hardware: async () => null,
    plan: (stage, plan) => { plans.push({ stage, plan }); },
    ...over,
  };
}
```

- [ ] **Step 2: Write the failing tests**

`src/providers/local_native/adapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { AdapterSession, SessionContext } from '../../lib/contract/adapter';
import { checkConformance, recordConformance, type ConformanceLog } from '../../lib/contract/conformance';
import type { AdapterEvent } from '../../lib/contract/events';
import { createLocalNativeAdapter, VAD_INIT_TIMEOUT_MS } from './adapter';
import type { LocalNativeConfig } from './config';
import { createFakeNativeEngines, createFakeNativeHost } from './fakeEngines';
import type { NativeHost } from './host';

const silent: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' };
const speaking: SessionContext = { ...silent, speech: true };

const TTS = { modelId: 'tts-a', device: 'auto' as const, speed: 1, voice: '', capability: { builtin: 'named' as const, custom: 'none' as const } };
function config(over: Partial<LocalNativeConfig> = {}): LocalNativeConfig {
  return {
    asr: { modelId: 'asr-a', device: 'auto' },
    vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 },
    translation: { modelId: 'mt-a', device: 'auto', instructions: 'Translate ja to en.', wrapTranscript: true },
    asrFirst: true,
    ...over,
  };
}

/** Lets every pending promise continuation run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function begin(c = config(), context = silent, host: NativeHost = createFakeNativeHost(), signal = new AbortController().signal) {
  const fakes = createFakeNativeEngines();
  const recorder = recordConformance();
  const clock = createVirtualClock();
  const starting = createLocalNativeAdapter(fakes.engines, host).start({ context, config: c, credentials: {}, clock, signal }, recorder.events);
  return { ...fakes, ...recorder, starting, context, clock, host };
}

/** Starts a session with every seam ready to answer. */
async function open(c = config(), context = silent, host: NativeHost = createFakeNativeHost()) {
  const t = begin(c, context, host);
  t.asr.ready();
  t.translation.ready();
  t.tts.ready();
  t.vad.ready();
  const session: AdapterSession = await t.starting;
  await settle();
  return { ...t, session };
}

const events = (log: ConformanceLog) => log.filter((e): e is AdapterEvent => e.kind !== 'marker');
const ofKind = <K extends AdapterEvent['kind']>(log: ConformanceLog, kind: K) =>
  events(log).filter((e) => e.kind === kind).map((e) => e.payload as Extract<AdapterEvent, { kind: K }>['payload']);
function segments(log: ConformanceLog, side: 'source' | 'translation') {
  const bySide = new Map<number, { origin?: string; text: string; closed: boolean }>();
  for (const e of events(log)) {
    if (e.kind === 'segmentOpened' && e.payload.side === side) bySide.set(e.payload.ref, { origin: e.payload.origin, text: '', closed: false });
    else if (e.kind === 'segmentText') { const s = bySide.get(e.payload.ref); if (s) s.text = e.payload.text; }
    else if (e.kind === 'segmentClosed') { const s = bySide.get(e.payload.ref); if (s) s.closed = true; }
  }
  return [...bySide.values()];
}
const conformant = (log: ConformanceLog, context: SessionContext) => expect(checkConformance(log, context)).toEqual([]);

describe('opening', () => {
  it("loads in the builder's order, ASR and translation first, then TTS, then the VAD (#578 ruling 15)", async () => {
    const a = await open(config({ tts: TTS }), speaking);
    expect(a.calls).toEqual(['asr', 'translation', 'tts', 'vad']);
    const b = await open(config({ tts: TTS, asrFirst: false }), speaking);
    expect(b.calls).toEqual(['translation', 'asr', 'tts', 'vad']);
    expect(b.translation.inits[0]).toEqual({ sourceLang: 'ja', targetLang: 'en', modelId: 'mt-a', device: 'auto', variant: undefined, asrModel: 'asr-a', ttsModel: 'tts-a' });
    expect(a.vad.inits[0]).toEqual({ threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 });
  });

  it('says each model loaded, and hands each plan to the host (#578 ruling 14)', async () => {
    const t = await open(config({ tts: TTS }), speaking);
    expect(ofKind(t.log, 'loading')).toEqual([
      { stage: 'asr', done: 1, total: 3 }, { stage: 'translation', done: 2, total: 3 }, { stage: 'tts', done: 3, total: 3 },
    ]);
    expect((t.host as ReturnType<typeof createFakeNativeHost>).plans.map((p) => [p.stage, p.plan.model, p.plan.device])).toEqual([
      ['asr', 'asr-a', 'cpu'], ['translation', 'mt-a', 'cpu'], ['tts', 'tts-a', 'cpu'],
    ]);
    conformant(t.log, speaking);
  });

  it('an ASR load that fails rejects the start and ends every seam', async () => {
    const t = begin();
    t.asr.failInit('no such model');
    await expect(t.starting).rejects.toThrow('ASR engine init failed: no such model');
    expect([t.asr.disposes, t.translation.disposes, t.vad.disposes]).toEqual([1, 1, 1]);
  });

  it('a cancelled start rejects at once and ends every seam', async () => {
    const ac = new AbortController();
    const t = begin(config(), silent, createFakeNativeHost(), ac.signal);
    ac.abort(new Error('cancelled'));
    await expect(t.starting).rejects.toThrow('cancelled');
    expect(t.asr.disposes).toBe(1);
  });

  it('a VAD that never loads fails the start after its timeout', async () => {
    const t = begin();
    t.asr.ready();
    t.translation.ready();
    await settle();
    t.clock.advance(VAD_INIT_TIMEOUT_MS);
    await expect(t.starting).rejects.toThrow('VAD worker init timeout');
  });

  it('TTS that fails to load leaves the session without speech, and says so (#578 ruling 10)', async () => {
    const t = begin(config({ tts: TTS }), speaking);
    t.asr.ready();
    t.translation.ready();
    t.tts.failInit('out of memory');
    t.vad.ready();
    await t.starting;
    await settle();
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
  });

  it('a clone-only model with no clip is not loaded, and says so', async () => {
    const t = await open(config({ tts: { ...TTS, capability: { builtin: 'none', custom: 'clip', required: true } } }), speaking);
    expect(t.calls).not.toContain('tts');
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
  });

  it('a transcription-only session says so once', async () => {
    const t = await open(config({ translation: null }));
    expect(t.calls).toEqual(['asr', 'vad']);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'translation_unavailable' })]);
  });
});

describe('speech in, text out', () => {
  it('a partial opens the source segment, the final closes it, and the translation streams into its own (#578 ruling 8)', async () => {
    const t = await open();
    t.asr.partial('こんにち');
    t.asr.final('こんにちは');
    expect(t.translation.calls).toEqual([{ text: 'こんにちは', systemPrompt: 'Translate ja to en.', wrapTranscript: true }]);
    t.translation.stream('Hel');
    t.translation.stream('Hello');
    t.translation.answer('Hello.');
    await settle();
    expect(segments(t.log, 'source')).toEqual([{ origin: 'u1', text: 'こんにちは', closed: true }]);
    expect(segments(t.log, 'translation')).toEqual([{ origin: 'u1', text: 'Hello.', closed: true }]);
    conformant(t.log, silent);
  });

  it('a failed translation closes what streamed and says translation_failed', async () => {
    const t = await open();
    t.asr.final('こんにちは');
    t.translation.stream('Hel');
    t.translation.reject('timed out');
    await settle();
    expect(segments(t.log, 'translation')).toEqual([{ origin: 'u1', text: 'Hel', closed: true }]);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'translation_failed' })]);
    conformant(t.log, silent);
  });

  it('typed text: a source segment exactly as typed, and its job', async () => {
    const t = await open();
    t.mark('appendText', '  hi  ');
    t.session.appendText('  hi  ');
    expect(t.translation.calls[0].text).toBe('hi');
    t.translation.answer('やあ');
    await settle();
    expect(segments(t.log, 'source')).toEqual([{ origin: 'u1', text: '  hi  ', closed: true }]);
    conformant(t.log, silent);
  });

  it('an id-less ASR error drops the utterance and says transcription_failed', async () => {
    const t = await open();
    t.asr.partial('こん');
    t.asr.fail('feeder failed');
    expect(segments(t.log, 'source')).toEqual([{ origin: 'u1', text: 'こん', closed: true }]);
    expect(t.translation.calls).toEqual([]);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'transcription_failed' })]);
  });

  it('VAD edges become sidecar marks, and audio goes to both', async () => {
    const t = await open();
    t.session.appendAudio(new Int16Array([1, 2]));
    t.vad.start();
    t.vad.end();
    t.vad.cancel();
    expect(t.asr.fed).toEqual([new Int16Array([1, 2])]);
    expect(t.vad.fed).toEqual([new Int16Array([1, 2])]);
    expect(t.asr.marks).toEqual(['start', 'end', 'cancel']);
  });

  it("a turn's end feeds a 700 ms silent tail to both, then flushes the VAD and the sidecar; a failed flush is only a frame", async () => {
    const t = await open();
    t.asr.flushResult = Promise.reject(new Error('flush timed out'));
    t.session.endTurn();
    await settle();
    expect(t.asr.fed.map((f) => f.length)).toEqual(Array(7).fill(2400));
    expect(t.vad.fed.length).toBe(7);
    expect([t.vad.flushes, t.asr.flushes]).toEqual([1, 1]);
    expect(ofKind(t.log, 'frame').map((f) => f.type)).toContain('local.native.asr.flush.error');
    expect(ofKind(t.log, 'failed')).toEqual([]);
  });
});

describe('speech out', () => {
  it('a one-shot sentence is one ranged clip', async () => {
    const t = await open(config({ tts: TTS }), speaking);
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    t.tts.say();
    await settle();
    expect(ofKind(t.log, 'audio').map((a) => a.range)).toEqual([[0, 6]]);
    conformant(t.log, speaking);
  });

  it('a streaming sentence arrives chunk by chunk, and its range is filled in afterwards (#578 ruling 9)', async () => {
    const t = begin(config({ tts: TTS }), speaking);
    t.asr.ready(); t.translation.ready(); t.tts.ready({ streaming: true }); t.vad.ready();
    await t.starting;
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    t.tts.chunk();
    t.tts.chunk();
    t.tts.finish();
    await settle();
    expect(ofKind(t.log, 'audio').map((a) => a.range)).toEqual([undefined, undefined]);
    expect(ofKind(t.log, 'speechRanges')).toEqual([{ ref: expect.any(Number), ranges: [{ index: 0, range: [0, 3] }, { index: 1, range: [3, 6] }] }]);
    conformant(t.log, speaking);
  });

  it('applies the stored built-in voice before the first sentence', async () => {
    const host = createFakeNativeHost({ listVoices: async () => [{ name: 'Bella', language: 'en', curated: true, unstable: false, default: true }] });
    const t = await open(config({ tts: { ...TTS, voice: 'builtin:Bella' } }), speaking, host);
    expect(t.tts.voices).toEqual(['Bella']);
  });

  it('no audio when the leg does not speak', async () => {
    const t = await open(config({ tts: TTS }), silent);
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    expect(t.tts.spoken).toEqual([]);
    conformant(t.log, silent);
  });
});

describe('failing and ending', () => {
  it("a closed ASR socket fails the session (Review Focus 1)", async () => {
    const t = await open();
    t.asr.close();
    expect(ofKind(t.log, 'failed')).toEqual([{ message: 'The local engine stopped: native host disconnected' }]);
    t.asr.final('late');
    expect(ofKind(t.log, 'segmentOpened')).toEqual([]);
  });

  it('a closed TTS socket stops speech only', async () => {
    const t = await open(config({ tts: TTS }), speaking);
    t.tts.close();
    expect(ofKind(t.log, 'failed')).toEqual([]);
    expect(ofKind(t.log, 'degraded')).toEqual([expect.objectContaining({ code: 'tts_degraded' })]);
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    expect(t.tts.spoken).toEqual([]);
    expect(segments(t.log, 'translation')).toEqual([{ origin: 'u1', text: 'Hello.', closed: true }]);
  });

  it('a VAD that fails after it is ready fails the session', async () => {
    const t = await open();
    t.vad.fail('segmenter died');
    expect(ofKind(t.log, 'failed')).toEqual([{ message: 'Voice activity detection stopped: segmenter died' }]);
  });

  it('stop ends every seam before its first await', async () => {
    const t = await open(config({ tts: TTS }), speaking);
    t.mark('stop');
    void t.session.stop();
    expect([t.asr.disposes, t.translation.disposes, t.tts.disposes, t.vad.disposes]).toEqual([1, 1, 1, 1]);
  });

  it('stop during a streaming sentence emits nothing after (Review Focus 5)', async () => {
    const t = begin(config({ tts: TTS }), speaking);
    t.asr.ready(); t.translation.ready(); t.tts.ready({ streaming: true }); t.vad.ready();
    const session = await t.starting;
    t.asr.final('こんにちは');
    t.translation.answer('Hello.');
    await settle();
    t.tts.chunk();
    t.mark('stop');
    await session.stop();
    const before = t.log.length;
    t.asr.final('late');
    await settle();
    expect(t.log.length).toBe(before);
    conformant(t.log, speaking);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/providers/local_native/adapter.test.ts`
Expected: FAIL — `createLocalNativeAdapter` is not exported by the placeholder `adapter.ts`.

- [ ] **Step 4: Write `adapter.ts`**

```ts
import {
  SAMPLE_RATE,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type Ref,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import { fillIn, type Punctuator } from '../../lib/conversation/fillIn';
import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { countSkeleton } from '../../lib/segmentation/sealCursor';
import { SentenceCut, runtimeOver } from '../../lib/segmentation/sentenceCut';
import { gateChars, type SealedChunk } from '../../lib/segmentation/SentenceStream';
import { DEFAULT_CHUNK_SENTENCES } from '../../lib/segmentation/segmentationMode';
import type { LocalNativeConfig } from './config';
import type { LocalNativeEngines, NativeAsrLike, NativeInitReport, NativeTranslationLike, NativeTtsLike, NativeTtsReady, NativeVadLike } from './engines';
import type { NativeHost, NativeStage } from './host';
import { speakNative } from './speech';
import { applyVoice, voiceClipMissing } from './voice';

/**
 * Local Native on the new contract (spec: "L0 — the client contract"): ASR,
 * translation and TTS in the Electron sidecar, VAD in a renderer worker,
 * ported from `LocalNativeClient` without its display bookkeeping. Audio goes
 * to the sidecar and the VAD as it arrives (#578 ruling 2); the VAD's edges
 * become the sidecar's marks; source segments come from the sidecar's
 * partials and finals; translation jobs run one at a time, each streaming
 * into its own segment and spoken before the next starts.
 */

export type LocalNativeCredentials = Record<string, never>;

/** The VAD worker's model load: past this, the start fails (the old client's). */
export const VAD_INIT_TIMEOUT_MS = 15_000;
/** A manual turn's release: 700 ms of silence, seven 100 ms frames, before the flush (the old shell's `pttFinalization`). */
const TAIL_FRAMES = 7;
const FRAME_SAMPLES = SAMPLE_RATE / 10;

interface Job {
  text: string;
  origin: string;
  /** Punctuate before translating: a per-final or typed job under a sentences display; never a seal. */
  fill: boolean;
}

/** The translation segment a job fills: opened at its first text. */
interface Answer {
  ref: Ref | null;
  origin: string;
  text: string;
}

export function createLocalNativeAdapter(engines: LocalNativeEngines, host: NativeHost): Adapter<LocalNativeConfig, LocalNativeCredentials> {
  return {
    async start(request, events): Promise<AdapterSession> {
      if (request.signal.aborted) throw request.signal.reason ?? new Error('aborted');
      const session = new NativeSession(request, events, engines, host);
      await session.open();
      // Once the start has resolved: a start that failed owes no notice.
      queueMicrotask(() => session.announce());
      return session;
    },
  };
}

class NativeSession implements AdapterSession {
  readonly info = { transport: 'sidecar' };

  private readonly config: LocalNativeConfig;
  private readonly asr: NativeAsrLike;
  private readonly translation: NativeTranslationLike | null;
  private tts: NativeTtsLike | null;
  private ttsReady: NativeTtsReady | null = null;
  /** The voice applied at load, for the Logs panel. */
  private voiceLabel = '';
  private readonly vad: NativeVadLike;

  /** Set by `stop()`, `failed`, or a start that did not open: nothing is emitted after it. */
  private ended = false;
  private live = false;
  private failOpening: ((error: unknown) => void) | null = null;
  private notices: Array<{ code: ClientDiagnosticCode; message: string; cause?: unknown }> = [];
  private translationUnavailableAnnounced = false;
  private readonly ttsDeath: Promise<void>;
  private ttsDeathSettle: () => void = () => {};

  private nextRef: Ref = 1;
  private utterances = 0;
  private utterance: { ref: Ref; origin: string; text: string } | null = null;
  private jobs: Job[] = [];
  private processing = false;
  /** The running job's translation segment: its partials fill it (one job runs at a time). */
  private answer: Answer | null = null;
  private readonly cut: SentenceCut | null;

  constructor(
    private readonly request: StartRequest<LocalNativeConfig, LocalNativeCredentials>,
    private readonly events: AdapterEvents,
    engines: LocalNativeEngines,
    private readonly host: NativeHost,
  ) {
    this.config = request.config;
    this.asr = engines.asr();
    this.translation = this.config.translation ? engines.translation() : null;
    this.tts = this.config.tts ? engines.tts() : null;
    this.vad = engines.vad();
    this.ttsDeath = new Promise<void>((resolve) => { this.ttsDeathSettle = resolve; });
    const { jobSentences } = this.config;
    const { punctuate } = request;
    this.cut = this.config.translation && jobSentences !== undefined && jobSentences >= 1 && jobSentences <= 5 && punctuate
      ? new SentenceCut({
        lang: request.context.direction.source,
        sentences: jobSentences,
        runtime: runtimeOver(punctuate, request.clock),
        onPending: (tail) => this.show(tail),
        onSeal: (chunk) => this.seal(chunk),
      })
      : null;
  }

  /**
   * Loads ASR and translation in the builder's order (#578 ruling 15), then
   * TTS, then the VAD. ASR, translation or the VAD failing rejects the start,
   * every seam ended first; TTS failing leaves the session without speech
   * (#578 ruling 10). The start's signal ends every seam and rejects at once.
   */
  open(): Promise<void> {
    const { config, request } = this;
    const { source, target } = request.context.direction;
    const total = 1 + (this.translation ? 1 : 0) + (this.tts ? 1 : 0);
    let done = 0;
    this.frame('out', 'local.native.init.start', {
      asr: config.asr.modelId,
      translation: config.translation?.modelId ?? null,
      tts: config.tts?.modelId ?? null,
      sourceLanguage: source,
      targetLanguage: target,
    });
    this.probeHardware();

    return new Promise<void>((resolve, reject) => {
      const { signal } = request;
      const fail = (error: unknown) => {
        if (this.ended) return;
        this.ended = true;
        this.failOpening = null;
        signal.removeEventListener('abort', onAbort);
        this.endSeams();
        reject(error);
      };
      const onAbort = () => fail(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      this.failOpening = fail;
      const loaded = (stage: NativeStage) => this.emit('loading', { stage, done: ++done, total });
      /** Opening was cut short: what follows is nobody's business. */
      const alive = () => { if (this.ended) throw new Error('ended while opening'); };

      const loadAsr = async () => {
        const startedAt = request.clock.now();
        let report: NativeInitReport;
        try {
          report = await this.asr.init({ language: source, modelId: config.asr.modelId, device: config.asr.device, variant: config.asr.variant });
        } catch (error) {
          throw new Error(`ASR engine init failed: ${describeCause(error)}`);
        }
        alive();
        this.loadedStage('asr', config.asr.modelId, report, request.clock.now() - startedAt);
        this.listenToAsr();
        loaded('asr');
      };
      const loadTranslation = async () => {
        const { translation } = this;
        const tr = config.translation;
        if (!translation || !tr) return;
        const startedAt = request.clock.now();
        let report: NativeInitReport;
        try {
          report = await translation.init({
            sourceLang: source, targetLang: target, modelId: tr.modelId, device: tr.device, variant: tr.variant,
            // Co-loaded stages, so the sidecar accounts for their memory.
            asrModel: config.asr.modelId, ttsModel: config.tts?.modelId,
          });
        } catch (error) {
          throw new Error(`Translation engine init failed: ${describeCause(error)}`);
        }
        alive();
        this.loadedStage('translation', tr.modelId, report, request.clock.now() - startedAt);
        translation.onPartial = (text) => { if (this.answer) this.showAnswer(this.answer, text); };
        translation.onError = (message) => this.emit('degraded', { code: 'translation_failed', message });
        translation.onClosed = (message) => this.fatal(`The local engine stopped: ${message}`);
        loaded('translation');
      };

      const steps = async () => {
        if (config.asrFirst) { await loadAsr(); await loadTranslation(); }
        else { await loadTranslation(); await loadAsr(); }
        await this.loadTts(loaded);
        alive();
        await this.loadVad();
        alive();
      };
      steps().then(() => {
        if (this.ended) return;
        signal.removeEventListener('abort', onAbort);
        this.failOpening = null;
        this.live = true;
        this.frame('out', 'local.native.init.ready', { ttsEnabled: this.tts !== null });
        resolve();
      }, (error: unknown) => fail(error));
    });
  }

  /** A stage's plan: the Logs line, its fallback line, and the library's badge (#578 ruling 14). */
  private loadedStage(stage: NativeStage, model: string, report: NativeInitReport, elapsedMs: number): void {
    const device = report.device ?? 'cpu';
    this.frame('in', `local.native.init.${stage}.ready`, {
      model, device, backend: report.backend, computeType: report.computeType,
      ...(report.rtf !== undefined ? { rtf: report.rtf } : {}),
      ...(report.tokensPerSec !== undefined ? { tokensPerSec: report.tokensPerSec } : {}),
      ...(report.memoryBytes !== undefined ? { memoryBytes: report.memoryBytes } : {}),
      loadTimeMs: report.loadTimeMs ?? elapsedMs,
    });
    if (report.fallbackReason) this.frame('in', `local.native.init.${stage}.fallback`, { model, fallbackReason: report.fallbackReason });
    this.host.plan(stage, { ...report, model, device });
  }

  /** TTS, unless the model cannot speak without a clip the device lacks; failing, the session goes on without speech. */
  private async loadTts(loaded: (stage: NativeStage) => void): Promise<void> {
    const { tts } = this;
    const ttsConfig = this.config.tts;
    if (!tts || !ttsConfig) return;
    const { target } = this.request.context.direction;
    if (await voiceClipMissing(ttsConfig, this.host)) {
      if (this.ended) return;
      this.dropTts(tts);
      this.notices.push({ code: 'tts_degraded', message: `TTS unavailable, continuing without it: "${ttsConfig.modelId}" needs a voice clip — record or import one in Settings first` });
      loaded('tts');
      return;
    }
    if (this.ended) return;
    const startedAt = this.request.clock.now();
    try {
      const ready = await tts.init({ modelId: ttsConfig.modelId, device: ttsConfig.device, language: target, variant: ttsConfig.variant });
      if (this.ended) return;
      this.loadedStage('tts', ttsConfig.modelId, ready, this.request.clock.now() - startedAt);
      const applied = await applyVoice(tts, ttsConfig, target, ready, this.host);
      if (this.ended) return;
      this.ttsReady = ready;
      this.voiceLabel = applied.voice;
      if (applied.substituted) {
        this.notices.push({
          code: 'voice_fallback',
          message: `Configured voice ${applied.substituted.from} is no longer usable with this model (deleted, or missing a required transcript); substituted voice ${applied.substituted.to}. Update the selection in settings.`,
        });
      }
      tts.onError = (message) => this.emit('degraded', { code: 'tts_degraded', message });
      tts.onClosed = (message) => this.ttsDied(tts, message);
    } catch (error) {
      if (this.ended) return;
      this.frame('in', 'local.native.init.tts.error', { model: ttsConfig.modelId, error: describeCause(error) });
      this.dropTts(tts);
      this.notices.push({ code: 'tts_degraded', message: `TTS unavailable, continuing without it: ${describeCause(error)}`, cause: error });
    }
    loaded('tts');
  }

  /** The VAD worker, bounded by the request's clock; its edges become the sidecar's marks. */
  private loadVad(): Promise<void> {
    const { vad, request } = this;
    vad.onSpeechStart = () => {
      if (this.ended) return;
      this.asr.sendVadMark('start');
      this.frame('out', 'local.native.speech_start', {});
    };
    vad.onSpeechEnd = () => { if (!this.ended) this.asr.sendVadMark('end'); };
    vad.onSpeechCancel = () => { if (!this.ended) this.asr.sendVadMark('cancel'); };
    vad.onError = (message) => this.fatal(`Voice activity detection stopped: ${message}`);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cancel = request.clock.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('VAD worker init timeout'));
      }, VAD_INIT_TIMEOUT_MS);
      vad.init(this.config.vad).then(
        () => { if (settled) return; settled = true; cancel(); resolve(); },
        (error: unknown) => { if (settled) return; settled = true; cancel(); reject(error); },
      );
    });
  }

  /** A machine snapshot for the Logs panel, never on the start's path. */
  private probeHardware(): void {
    this.host.hardware().then((hw) => {
      if (!hw) return;
      this.frame('in', 'local.native.hardware', {
        os: hw.os, arch: hw.arch, cpuCores: hw.cpuCores, gpus: hw.gpus,
        backendsInstalled: hw.backendsInstalled, accelAvailable: hw.accelAvailable,
        generation: hw.generation ?? null, devices: hw.devices ?? null,
      });
    }, () => { /* diagnostics only */ });
  }

  /** The notices the start found, and transcription-only's own, once the start has resolved. */
  announce(): void {
    for (const notice of this.notices) this.emit('degraded', notice);
    this.notices = [];
    if (!this.config.translation) this.announceTranslationUnavailable();
  }

  private announceTranslationUnavailable(): void {
    if (this.translationUnavailableAnnounced) return;
    this.translationUnavailableAnnounced = true;
    const { source, target } = this.request.context.direction;
    this.emit('degraded', { code: 'translation_unavailable', message: `No translation model for ${source} → ${target} — transcription only.` });
  }

  appendAudio(pcm: Int16Array): void {
    if (this.ended) return;
    // Both copy what they are handed (the socket, the worker's structured clone): the runner may reuse the array.
    this.asr.feedAudio(pcm);
    this.vad.feed(pcm);
  }

  /** As LocalInference's: a source segment with exactly the typed text, then a job with its trimmed text. */
  appendText(text: string): void {
    if (this.ended || !text.trim()) return;
    const ref = this.nextRef++;
    const origin = this.nextOrigin();
    this.emit('segmentOpened', { ref, side: 'source', origin });
    this.emit('segmentText', { ref, text });
    this.emit('segmentClosed', { ref, origin });
    if (this.config.translation) this.enqueue({ text: text.trim(), origin, fill: this.config.jobSentences !== undefined });
    else this.announceTranslationUnavailable();
  }

  beginTurn(): void {}
  /** Neither the VAD nor the sidecar can discard a segment: both end a turn the same way. */
  endTurn(): void { this.flushTurn(); }
  cancelTurn(): void { this.flushTurn(); }

  /** The silent tail, then the VAD's flush and the sidecar's (the old `createResponse`); a failed flush costs nothing but a Logs line. */
  private flushTurn(): void {
    if (this.ended) return;
    const silence = new Int16Array(FRAME_SAMPLES);
    for (let i = 0; i < TAIL_FRAMES; i++) {
      this.asr.feedAudio(silence);
      this.vad.feed(silence);
    }
    this.vad.flush();
    this.asr.flush().catch((error: unknown) => this.frame('in', 'local.native.asr.flush.error', { error: describeCause(error) }));
  }

  async stop(): Promise<void> {
    this.ended = true;
    this.jobs = [];
    this.cut?.reset();
    this.endSeams();
  }

  private endSeams(): void {
    this.vad.dispose();
    this.asr.dispose();
    this.translation?.dispose();
    this.tts?.dispose();
  }

  private listenToAsr(): void {
    const { asr } = this;
    asr.onPartialResult = (text) => this.partial(text);
    asr.onResult = (result) => this.final(result);
    asr.onError = (error) => {
      this.frame('in', 'local.native.asr.error', { error });
      // One chunk failed (#578 ruling 10): close what the utterance showed, and drop its cut.
      this.abandonUtterance();
      this.cut?.reset();
      this.emit('degraded', { code: 'transcription_failed', message: error });
    };
    asr.onClosed = (message) => this.fatal(`The local engine stopped: ${message}`);
  }

  /** The sidecar's cumulative hypothesis for the utterance: shown, or sliced by the cut. */
  private partial(raw: string): void {
    if (!raw || this.ended) return;
    this.frame('in', 'local.native.asr.partial', { text: raw });
    if (this.cut) this.cut.partial(raw);
    else this.show(raw);
  }

  /** LocalInference's rule: the open source segment opens at the first text holding a letter or digit. */
  private show(raw: string): void {
    const text = raw.trim();
    if (countSkeleton(text) === 0) return;
    if (!this.utterance) {
      this.utterance = { ref: this.nextRef++, origin: this.nextOrigin(), text: '' };
      this.emit('segmentOpened', { ref: this.utterance.ref, side: 'source', origin: this.utterance.origin });
    }
    if (text === this.utterance.text) return;
    this.utterance.text = text;
    this.emit('segmentText', { ref: this.utterance.ref, text });
  }

  /** A chunk the cut sealed: its segment closes and its job is queued; never filled in. */
  private seal({ text, reason }: SealedChunk): void {
    this.frame('out', 'local.native.segmentation.seal', { reason, text });
    const sealed = text.trim();
    if (countSkeleton(sealed) === 0) return;
    this.show(sealed);
    const segment = this.utterance!;
    this.utterance = null;
    this.emit('segmentClosed', { ref: segment.ref, origin: segment.origin });
    this.enqueue({ text: sealed, origin: segment.origin, fill: false });
  }

  private final(result: { text: string; durationMs: number; recognitionTimeMs: number }): void {
    if (this.ended) return;
    const text = result.text.trim();
    if (!text) {
      this.cut?.reset();
      this.abandonUtterance();
      return;
    }
    this.frame('in', 'local.native.asr.end', {
      text,
      modelId: this.config.asr.modelId,
      durationMs: result.durationMs,
      recognitionTimeMs: result.recognitionTimeMs,
      ...(result.durationMs > 0 ? { rtf: Math.round((result.recognitionTimeMs / result.durationMs) * 1000) / 1000 } : {}),
    });
    if (this.cut) {
      this.cut.final(text);
      this.abandonUtterance();
      return;
    }
    const current = this.utterance;
    this.utterance = null;
    const segment = current ?? { ref: this.nextRef++, origin: this.nextOrigin(), text: '' };
    if (!current) this.emit('segmentOpened', { ref: segment.ref, side: 'source', origin: segment.origin });
    if (text !== segment.text) this.emit('segmentText', { ref: segment.ref, text });
    this.emit('segmentClosed', { ref: segment.ref, origin: segment.origin });
    if (this.config.translation) this.enqueue({ text, origin: segment.origin, fill: this.config.jobSentences !== undefined });
  }

  private abandonUtterance(): void {
    const current = this.utterance;
    this.utterance = null;
    if (current) this.emit('segmentClosed', { ref: current.ref, origin: current.origin });
  }

  private nextOrigin(): string {
    return `u${++this.utterances}`;
  }

  private enqueue(job: Job): void {
    this.jobs.push(job);
    if (!this.processing) void this.drain();
  }

  private async drain(): Promise<void> {
    this.processing = true;
    try {
      while (this.jobs.length > 0 && !this.ended) await this.run(this.jobs.shift()!);
    } finally {
      this.processing = false;
    }
  }

  /** One job: its translation streams into its segment, is spoken, and the segment closes — after a failure, with what streamed (#578 ruling 8). */
  private async run(job: Job): Promise<void> {
    const answer: Answer = { ref: null, origin: job.origin, text: '' };
    this.answer = answer;
    try {
      const text = await this.translated(job);
      if (text === undefined || this.ended) return;
      this.showAnswer(answer, text);
      if (answer.ref !== null) await this.speak(answer.ref, text);
    } catch (error) {
      this.frame('in', 'local.native.pipeline.error', { error: describeCause(error) });
    } finally {
      this.answer = null;
      if (answer.ref !== null) this.emit('segmentClosed', { ref: answer.ref, origin: answer.origin });
    }
  }

  /** The job's translation segment opens at its first text and shows each new one. */
  private showAnswer(answer: Answer, text: string): void {
    if (!text || this.ended) return;
    if (answer.ref === null) {
      answer.ref = this.nextRef++;
      this.emit('segmentOpened', { ref: answer.ref, side: 'translation', origin: answer.origin });
    }
    if (text === answer.text) return;
    answer.text = text;
    this.emit('segmentText', { ref: answer.ref, text });
  }

  private async translated(job: Job): Promise<string | undefined> {
    const { translation } = this;
    const tr = this.config.translation;
    if (!translation || !tr) return undefined;
    const { punctuate } = this.request;
    const text = job.fill && punctuate ? await this.punctuate(job.text, punctuate) : job.text;
    if (this.ended) return undefined;
    this.frame('out', 'local.native.translation.start', { sourceText: text, modelId: tr.modelId, systemPrompt: tr.instructions, wrapTranscript: tr.wrapTranscript });
    let result: { translatedText: string; inferenceTimeMs: number };
    try {
      result = await translation.translate(text, tr.instructions, tr.wrapTranscript);
    } catch (error) {
      if (this.ended) return undefined;
      const message = describeCause(error);
      this.frame('in', 'local.native.translation.error', { modelId: tr.modelId, sourceText: text, error: message });
      this.emit('degraded', { code: 'translation_failed', message, cause: error });
      return undefined;
    }
    if (this.ended || !result.translatedText) return undefined;
    this.frame('in', 'local.native.translation.end', { sourceText: text, translatedText: result.translatedText, inferenceTimeMs: result.inferenceTimeMs, modelId: tr.modelId });
    return result.translatedText;
  }

  /** LocalInference's Auto shape: short text raw; longer text filled in within 1 s on the request's clock, else raw. */
  private async punctuate(text: string, punctuator: Punctuator): Promise<string> {
    const { source } = this.request.context.direction;
    if (text.length < gateChars(source, DEFAULT_CHUNK_SENTENCES)) return text;
    return new Promise<string>((resolve) => {
      let settled = false;
      const cancel = this.request.clock.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(text);
      }, 1000);
      fillIn(source, text, punctuator).then((filled) => {
        if (settled) return;
        settled = true;
        cancel();
        resolve(filled);
      });
    });
  }

  /** Speaks into the job's segment; a TTS that dies meanwhile ends the speech at once (the race). */
  private async speak(ref: Ref, text: string): Promise<void> {
    const { tts, ttsReady } = this;
    const ttsConfig = this.config.tts;
    if (!tts || !ttsReady || !ttsConfig || !this.request.context.speech) return;
    const spoken = speakNative(
      tts,
      text,
      this.request.context.direction.target,
      { modelId: ttsConfig.modelId, voice: this.voiceLabel, speed: ttsConfig.speed, streaming: ttsReady.streaming },
      {
        audio: (pcm, range) => this.emit('audio', { ref, pcm, range }),
        ranges: (entries) => this.emit('speechRanges', { ref, ranges: entries }),
        degraded: (message, cause) => this.emit('degraded', { code: 'tts_degraded', message, cause }),
        frame: (direction, type, payload) => this.frame(direction, type, payload),
      },
      () => this.ended || this.tts !== tts,
      this.request.clock,
    );
    await Promise.race([spoken, this.ttsDeath]);
  }

  private dropTts(tts: NativeTtsLike): void {
    tts.dispose();
    if (this.tts === tts) this.tts = null;
  }

  /** The TTS socket closed: speech stops for the session and the text goes on (#578 ruling 10). */
  private ttsDied(tts: NativeTtsLike, error: string): void {
    if (this.ended || this.tts !== tts) return;
    this.dropTts(tts);
    this.ttsDeathSettle();
    const notice = { code: 'tts_degraded' as const, message: `Speech synthesis stopped: ${error}` };
    if (this.live) this.emit('degraded', notice);
    else this.notices.push(notice);
  }

  /** The session can no longer work: while opening, the start rejects; after, `failed`, and nothing more. */
  private fatal(message: string): void {
    if (this.ended) return;
    this.cut?.reset();
    if (!this.live) {
      this.failOpening?.(new Error(message));
      return;
    }
    this.emit('failed', { message });
    this.ended = true;
  }

  private frame(direction: 'in' | 'out', type: string, payload: Record<string, unknown>): void {
    this.emit('frame', { direction, type, payload: framePayload(payload) });
  }

  private emit<K extends keyof AdapterEvents>(kind: K, payload: Parameters<AdapterEvents[K]>[0]): void {
    if (this.ended) return;
    (this.events[kind] as (p: typeof payload) => void)(payload);
  }
}
```

- [ ] **Step 5: Pin the session side**

In `src/providers/sessionSide.consistency.test.ts`, in the first `it`, after the LocalInference block:

```ts
    expect(sessionSide(REPO_ROOT, 'src/providers/local_native')).toEqual(
      expect.arrayContaining([
        'src/providers/local_native/adapter.ts',
        'src/providers/local_native/engines.ts',
        'src/providers/local_native/speech.ts',
        'src/providers/local_native/voice.ts',
      ]),
    );
    // The store-backed host stays off the session side (#578 ruling 14).
    expect(sessionSide(REPO_ROOT, 'src/providers/local_native')).not.toContain('src/providers/local_native/config.ts');
```

and in `it("only test-only modules import the adapter test kit or a provider's fixtures", ...)` next to the LocalInference control:

```ts
    expect(testOnly.has('src/providers/local_native/fakeEngines.ts')).toBe(true);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/providers/local_native src/providers/sessionSide.consistency.test.ts`
Expected: PASS. If a conformance assertion fails, read the violation's rule name in `src/lib/contract/conformance.ts` and fix the adapter, never the assertion.

- [ ] **Step 7: Run the gates and commit**

```bash
git commit -m "feat(local_native): the adapter on the client contract

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe" -- src/providers/local_native/adapter.ts src/providers/local_native/adapter.test.ts src/providers/local_native/fakeEngines.ts src/providers/sessionSide.consistency.test.ts
```

---
### Task 8: The native UI takes `settings / update / pair` from its host

**Files:**
- Modify: `src/components/Settings/engine/useNativeEngineAdapter.ts` (+ `useNativeEngineAdapter.test.ts`)
- Modify: `src/components/Settings/engine/SlotDeviceBadge.tsx` (+ `SlotDeviceBadge.test.tsx`)
- Modify: `src/components/Settings/sections/NativeDeviceControl.tsx` (+ `NativeDeviceControl.test.tsx`)
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx` (+ `NativeModelManagementSection.test.tsx`, `NativeModelManagementSection.licenseGate.test.tsx`)
- Modify: `src/components/Settings/engine/StoragePage.tsx` (+ `StoragePage.test.tsx`)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (the old shell passes its slice)

**Interfaces:**
- Consumes: `NativeEngineSettings`, `NativeEngineOverride`, `NativeDevice` (Task 3).
- Produces (Task 9 calls these):

```ts
export function useNativeEngineAdapter(isSessionActive: boolean, override: NativeEngineOverride): EngineAdapter;
export const SlotDeviceBadge: React.FC<{ stage: Stage; modelId: string | null; id: string; setting: NativeDevice }>;
export const NativeDeviceControl: React.FC<{ stage: Stage; value: NativeDevice; onChange(device: NativeDevice): void; disabled?: boolean }>;
export const NativeModelManagementSection: React.FC<{ isSessionActive?: boolean; stageFilter?: Stage; direction?: string; settings: NativeEngineSettings; update(patch: Partial<NativeEngineSettings>): void; pair: LanguagePair }>;
// StoragePage's native arm:
| { provider: 'native'; isSessionActive?: boolean; settings: NativeEngineSettings; pair: LanguagePair }
```

None of the five reads `useLocalNativeSettings` / `useUpdateLocalNative` afterwards.

- [ ] **Step 1: Write the failing tests**

In `src/components/Settings/engine/useNativeEngineAdapter.test.ts`, drop the `ServiceFactory` mock, the `settingsStore` import and the `beforeEach` line that seeded `updateLocalNative`, and add a host override:

```ts
const update = vi.fn();
const override = (selections = {}, pair = { source: 'ja', target: 'en' }) => ({
  settings: { selections, asrDevice: 'auto' as const, translationDevice: 'auto' as const, ttsDevice: 'auto' as const, ttsVoice: '' },
  update,
  pair,
});
```

Every `renderHook(() => useNativeEngineAdapter())` becomes `renderHook(() => useNativeEngineAdapter(false, override(<the selections the case seeded>)))`; a case that asserted the old slice after `select` asserts `update` instead (`expect(update).toHaveBeenCalledWith({ selections: ... })`). Add:

```ts
  it("reads the host's pair and settings, and writes through its update (#578)", async () => {
    const { result } = renderHook(() => useNativeEngineAdapter(false, override({}, { source: 'zh', target: 'en' })));
    expect(result.current.directions.map((d) => d.dir)).toEqual(['zh→en', 'en→zh']);
    await act(async () => { await result.current.select({ dir: 'zh→en', stage: 'asr' }, 'sense-voice'); });
    expect(update).toHaveBeenCalledWith({ selections: { 'zh→en': { asr: { modelId: 'sense-voice' }, translation: { modelId: '' }, tts: { modelId: '' } } } });
  });
```

In `SlotDeviceBadge.test.tsx` drop the `settingsStore` mock; each render passes the setting the mock held: `<SlotDeviceBadge stage="asr" modelId="m" id="b" setting={mockSettings.asrDevice} />` (the mock object stays, as a fixture). Add:

```ts
  it('shows the setting it is handed', () => {
    const { container } = render(<SlotDeviceBadge stage="asr" modelId="m" id="b" setting="cpu" />);
    expect(container.querySelector('.slot-device-badge__setting')?.textContent).toBe('CPU');
  });
```

In `NativeDeviceControl.test.tsx` drop the `settingsStore` mock; renders become `<NativeDeviceControl stage="asr" value={mockSettings.asrDevice} onChange={mockUpdateDevice} />` with `const mockUpdateDevice = vi.fn();`, and a case that asserted `mockUpdate({ asrDevice: 'cpu' })` asserts `mockUpdateDevice('cpu')`.

In `NativeModelManagementSection.test.tsx` and `.licenseGate.test.tsx` drop the `settingsStore` mock and add `ttsVoice: ''` to each file's `mockSettings` fixture (`NativeEngineSettings` requires it); every `render(<NativeModelManagementSection ... />)` adds `settings={mockSettings} update={mockUpdate} pair={{ source: mockSettings.sourceLanguage, target: mockSettings.targetLanguage }}` (the fixture keeps its pair fields; they now only feed `pair`). Add to `NativeModelManagementSection.test.tsx` (its fixture's `sense-voice` lists `zh`):

```ts
  it("takes its pair from the host, not a settings store (#578)", () => {
    render(<NativeModelManagementSection settings={mockSettings} update={mockUpdate} pair={{ source: 'zh', target: 'en' }} />);
    // The ASR group lists the cards for the host's source.
    expect(screen.getAllByText(/SenseVoice/i).length).toBeGreaterThan(0);
  });
```


In `StoragePage.test.tsx`, the native block renders `<StoragePage provider="native" settings={NATIVE} pair={{ source: 'ja', target: 'en' }} />` with `const NATIVE = { selections: {}, asrDevice: 'auto' as const, translationDevice: 'auto' as const, ttsDevice: 'auto' as const, ttsVoice: '' };`, dropping whatever seeded the old slice.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/Settings/engine src/components/Settings/sections/NativeDeviceControl.test.tsx src/components/Settings/sections/NativeModelManagementSection.test.tsx src/components/Settings/sections/NativeModelManagementSection.licenseGate.test.tsx`
Expected: FAIL — the components still read the old store (the zh case shows ja→en; the device control ignores `value`; `select` writes the old slice, not `update`).

- [ ] **Step 3: Change `useNativeEngineAdapter`**

```ts
import React, { useMemo } from 'react';
import { useNativeModelStore } from '../../../stores/nativeModelStore';
import { nativeCandidates } from '../../../lib/local-inference/selection/candidates.native';
import { directionKey, emptyDirection, type Stage } from '../../../lib/local-inference/selection/types';
import type { NativeEngineOverride } from '../../../providers/local_native/settings';
import { EngineSection } from '../sections/EngineSection';
import { SlotDeviceBadge } from './SlotDeviceBadge';
import { languageNameFor } from './languageName';
import { shortenModelName } from '../../../lib/local-inference/modelName';
import type { EngineAdapter } from './EngineTypes';
```

The signature becomes `export function useNativeEngineAdapter(isSessionActive: boolean, override: NativeEngineOverride): EngineAdapter`, its doc `/** LOCAL_NATIVE's EngineAdapter — sidecar catalog + statuses, EngineSection gate. Every mount hands it the host's settings / update / pair: Local Native's \`Engine\`, and the old settings shell its slice (#578). */`, and its first lines:

```ts
  const sourceLanguage = override.pair.source;
  const targetLanguage = override.pair.target;
  const { selections, asrDevice, translationDevice, ttsDevice } = override.settings;
  const { update } = override;
  const catalog = useNativeModelStore((s) => s.catalog);
  const statuses = useNativeModelStore((s) => s.statuses);
```

`select` ends with `update({ selections: next });` (no `await`), `slotBadge` passes the slot's device setting:

```ts
      slotBadge: (slot, id) => {
        const [src, tgt] = split(slot.dir);
        const modelId = useNativeModelStore.getState().resolve(src, tgt, selections)[slot.stage]?.modelId ?? null;
        const setting = slot.stage === 'asr' ? asrDevice : slot.stage === 'translation' ? translationDevice : ttsDevice;
        return React.createElement(SlotDeviceBadge, { stage: slot.stage, modelId, id, setting });
      },
```

and the memo's dependencies are `[sourceLanguage, targetLanguage, selections, asrDevice, translationDevice, ttsDevice, catalog, statuses, update, isSessionActive]`.

- [ ] **Step 4: Change `SlotDeviceBadge`, `NativeDeviceControl`, `NativeModelManagementSection`, `StoragePage`**

`SlotDeviceBadge.tsx`: remove the `useLocalNativeSettings` import and call; the props gain `setting: DeviceSetting`, and

```ts
export const SlotDeviceBadge: React.FC<{ stage: Stage; modelId: string | null; id: string; setting: DeviceSetting }> = ({ stage, modelId, id, setting: rawSetting }) => {
```

with the old `rawSetting` computation deleted (the prop replaces it). Its doc gains: `The setting comes from the host's settings (#578).`

`NativeDeviceControl.tsx`: remove the store import and calls; replace the component's head and `setDevice`:

```tsx
/**
 * Per-stage compute-device segmented control (Auto / CPU / GPU) over the
 * value its host hands it (#578). Its only mount is the model library,
 * NMMS's group headers (B'2 decision, 2026-09-03).
 */
export const NativeDeviceControl: React.FC<{ stage: Stage; value: DeviceMode; onChange(device: DeviceMode): void; disabled?: boolean }> = ({ stage, value: rawValue, onChange, disabled = false }) => {
  const { t } = useTranslation();
  const catalog = useNativeCatalog();
  const gpuAvail = gpuTierAvailable(catalog);
  // Coerce a stale 'gpu' to 'auto' for display when no GPU tier is available.
  const deviceValue: DeviceMode = rawValue === 'gpu' && !gpuAvail ? 'auto' : rawValue;
```

and the button's `onClick` calls `onChange(mode)` where it called `setDevice(mode)` (delete `setDevice`).

`NativeModelManagementSection.tsx`: remove the `settingsStore` import; the props become

```tsx
export const NativeModelManagementSection: React.FC<{
  isSessionActive?: boolean;
  stageFilter?: Stage;
  direction?: string;
  /** The host's settings, its writer, and its pair (#578): Local Native's `Engine`, or the old shell's slice. */
  settings: NativeEngineSettings;
  update: (patch: Partial<NativeEngineSettings>) => void;
  pair: LanguagePair;
}> = ({ isSessionActive = false, stageFilter, direction, settings, update, pair }) => {
```

delete the two lines `const settings = useLocalNativeSettings();` / `const update = useUpdateLocalNative();`, take the pair from the prop:

```tsx
  const [srcLang, tgtLang] = direction
    ? splitDirection(direction)
    : [pair.source, pair.target];
```

and hand each device control its own field:

```tsx
          aboveList={<NativeDeviceControl stage="asr" value={settings.asrDevice} onChange={(asrDevice) => update({ asrDevice })} disabled={isSessionActive} />}>
          aboveList={<NativeDeviceControl stage="translation" value={settings.translationDevice} onChange={(translationDevice) => update({ translationDevice })} disabled={isSessionActive} />}>
          aboveList={<NativeDeviceControl stage="tts" value={settings.ttsDevice} onChange={(ttsDevice) => update({ ttsDevice })} disabled={isSessionActive} />}>
```

Import `NativeEngineSettings` from `../../../providers/local_native/settings` and `LanguagePair` from `../../../lib/provider/types`.

`StoragePage.tsx`: the native arm of the props union becomes `| { provider: 'native'; isSessionActive?: boolean; settings: NativeEngineSettings; pair: LanguagePair }`, its doc says `The \`native\` half reads Local Native's own settings and pair (#578).`, the `useLocalNativeSettings()` call and import go, and:

```tsx
  const native = props.provider === 'native' ? props : null;
  // ...
  const sourceLanguage = wasm ? wasm.pair.source : native!.pair.source;
  const targetLanguage = wasm ? wasm.pair.target : native!.pair.target;
  const selections: Selections = wasm ? wasm.settings.selections : native!.settings.selections;
```

- [ ] **Step 5: The old shell hands its slice in**

In `src/components/Settings/sections/ProviderSpecificSettings.tsx` (unmounted, kept with the old path, #578 ruling 11):

```tsx
  const nativePair = useMemo(
    () => ({ source: localNativeSettings.sourceLanguage, target: localNativeSettings.targetLanguage }),
    [localNativeSettings.sourceLanguage, localNativeSettings.targetLanguage],
  );
  const nativeOverride = useMemo(
    () => ({ settings: localNativeSettings, update: updateLocalNativeSettings, pair: nativePair }),
    [localNativeSettings, updateLocalNativeSettings, nativePair],
  );
  const nativeAdapter = useNativeEngineAdapter(isSessionActive, nativeOverride);
```

and the library and storage renders gain `settings={localNativeSettings} update={updateLocalNativeSettings} pair={nativePair}` / `settings={localNativeSettings} pair={nativePair}`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/Settings`
Expected: PASS, including `ProviderSpecificSettings.engine.test.tsx` unchanged.

- [ ] **Step 7: Run the gates and commit**

```bash
git commit -m "refactor(native-ui): the native model UI takes settings, update and pair from its host

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe" -- src/components/Settings/engine/useNativeEngineAdapter.ts src/components/Settings/engine/useNativeEngineAdapter.test.ts src/components/Settings/engine/SlotDeviceBadge.tsx src/components/Settings/engine/SlotDeviceBadge.test.tsx src/components/Settings/sections/NativeDeviceControl.tsx src/components/Settings/sections/NativeDeviceControl.test.tsx src/components/Settings/sections/NativeModelManagementSection.tsx src/components/Settings/sections/NativeModelManagementSection.test.tsx src/components/Settings/sections/NativeModelManagementSection.licenseGate.test.tsx src/components/Settings/engine/StoragePage.tsx src/components/Settings/engine/StoragePage.test.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx
```

---

### Task 9: The views

**Files:**
- Create: `src/providers/local_native/LocalNativeEngine.tsx`, `LocalNativeEngineSummary.tsx`, `LocalNativeSettings.tsx`, `LocalNativeTurnDetection.tsx`
- Modify: `src/components/providers/ProviderOwnSettings.tsx` (`ProviderEngine` passes the preview port)
- Test: `LocalNativeEngine.test.tsx`, `LocalNativeEngineSummary.test.tsx`, `LocalNativeSettings.test.tsx`, `LocalNativeTurnDetection.test.tsx` (all in `src/providers/local_native/`), `src/components/providers/ProviderOwnSettings.test.tsx` (one case)

**Interfaces:**
- Consumes: Task 8's components; `EngineSurface` (`src/components/Settings/engine/EngineSurface.tsx`), `EngineStatusLine` (`src/components/Settings/sections/EngineStatusLine.tsx`), `VoicePreviewContext` (`src/components/providers/VoicePreviewContext.tsx`), `TtsSpeedControl`, `TranslationPromptControl`, `VadControl` (`LocalSettingsControls.tsx`); `nativeAsrCards`, `nativeAsrIncompatibleCards`, `nativeTranslationCards`, `nativeTtsModels`, `estimateNativeMemoryByDevice`, `actualNativeMemoryByDevice`, `formatMemMb`, `hasNativeTts`, `supportsCustomPrompt` (`nativeCatalog.ts`).
- Produces: `LocalNativeEngine(props: EngineProps<LocalNativeSettings>)`, `LocalNativeEngineSummary(props: EngineSummaryProps<LocalNativeSettings>)`, `LocalNativeSettingsView(props: SettingsProps<LocalNativeSettings>)`, `LocalNativeTurnDetectionSummary`, `LocalNativeTurnDetectionHelp`, `LocalNativeTurnDetectionControls` (each `SettingsProps<LocalNativeSettings>`).

- [ ] **Step 1: Write the failing tests**

`src/providers/local_native/LocalNativeEngine.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useContext } from 'react';

const seen = vi.hoisted(() => ({ overrides: [] as unknown[], modes: [] as string[], ports: [] as unknown[] }));
vi.mock('../../components/Settings/engine/useNativeEngineAdapter', () => ({
  useNativeEngineAdapter: (_active: boolean, override: unknown) => { seen.overrides.push(override); return {}; },
}));
vi.mock('../../components/Settings/engine/EngineSurface', async () => {
  const { VoicePreviewContext } = await import('../../components/providers/VoicePreviewContext');
  return {
    EngineSurface: ({ effectiveMode }: { effectiveMode: string }) => {
      seen.modes.push(effectiveMode);
      seen.ports.push(useContext(VoicePreviewContext));
      return null;
    },
  };
});

import { LocalNativeEngine } from './LocalNativeEngine';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

describe('LocalNativeEngine', () => {
  it('keys the override on the pair\'s languages, shows the legs\' mode, and provides the preview port (#578 ruling 13)', () => {
    const update = vi.fn();
    const port = { play: vi.fn(), stop: vi.fn() };
    const { rerender } = render(<LocalNativeEngine settings={LOCAL_NATIVE_DEFAULTS} update={update} pair={{ source: 'ja', target: 'en' }} legs={['participant']} preview={port} />);
    rerender(<LocalNativeEngine settings={LOCAL_NATIVE_DEFAULTS} update={update} pair={{ source: 'ja', target: 'en' }} legs={['participant']} preview={port} />);
    expect(seen.overrides[0]).toBe(seen.overrides[1]);
    expect(seen.modes).toEqual(['participant', 'participant']);
    expect(seen.ports[0]).toBe(port);
  });
});
```

`src/providers/local_native/LocalNativeEngineSummary.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { LocalNativeEngineSummary } from './LocalNativeEngineSummary';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

vi.mock('../../components/Settings/sections/EngineStatusLine', () => ({ EngineStatusLine: () => <div data-testid="engine-status-line" /> }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

const cpu = [{ tier: 'cpu', backend: 'ct2', available: true }];
const M = (id: string, kind: NativeModelInfo['kind'], languages: string[]): NativeModelInfo =>
  ({ id, name: id, kind, languages, recommended: true, tiers: cpu, order: 1, repo: id, sizeBytes: 104_857_600 }) as NativeModelInfo;
const CATALOG = { 'asr-a': M('asr-a', 'asr', ['ja', 'en']), 'mt-a': M('mt-a', 'translate', ['multi']), 'tts-a': M('tts-a', 'tts', ['en']) };

const props = (over: Record<string, unknown> = {}) => ({
  settings: LOCAL_NATIVE_DEFAULTS, update: vi.fn(), pair: { source: 'ja', target: 'en' }, legs: ['speaker'] as const, openSlot: vi.fn(), ...over,
});

beforeEach(() => {
  useNativeModelStore.setState({
    sidecarStatus: 'ready', catalog: CATALOG,
    statuses: { 'asr-a': 'ready', 'mt-a': 'ready', 'tts-a': 'ready' },
    sizes: { 'asr-a': 104_857_600, 'mt-a': 104_857_600, 'tts-a': 104_857_600 },
    asrResolved: null, translationResolved: null,
  });
});

describe('LocalNativeEngineSummary', () => {
  it('shows three chips for the speaker, the status line, and the tour anchor', () => {
    const { container } = render(<LocalNativeEngineSummary {...props()} legs={['speaker']} />);
    expect(screen.getByTestId('engine-status-line')).toBeTruthy();
    expect(container.querySelector('[data-tour="engine-chips"]')).toBeTruthy();
    expect(container.querySelectorAll('.model-chip')).toHaveLength(3);
  });

  it('two chips for the participant alone, and a chip opens its slot', () => {
    const p = props({ legs: ['participant'] });
    const { container } = render(<LocalNativeEngineSummary {...p} legs={['participant']} />);
    expect(container.querySelectorAll('.model-chip')).toHaveLength(2);
    fireEvent.click(container.querySelectorAll('.model-chip')[0]);
    expect(p.openSlot).toHaveBeenCalledWith({ dir: 'en→ja', stage: 'asr' });
  });

  it('a missing model is a None chip', () => {
    useNativeModelStore.setState({ statuses: { 'asr-a': 'absent', 'mt-a': 'ready', 'tts-a': 'ready' } });
    render(<LocalNativeEngineSummary {...props()} legs={['speaker']} />);
    expect(screen.getAllByText('None').length).toBeGreaterThan(0);
  });

  it('while the sidecar starts, says so instead of chips', () => {
    useNativeModelStore.setState({ sidecarStatus: 'starting' });
    const { container } = render(<LocalNativeEngineSummary {...props()} legs={['speaker']} />);
    expect(container.querySelector('.local-native-status.is-loading')).toBeTruthy();
    expect(container.querySelectorAll('.model-chip')).toHaveLength(0);
  });

  it('an estimate before a run, what is in use after one', () => {
    const { rerender } = render(<LocalNativeEngineSummary {...props()} legs={['speaker']} />);
    expect(screen.getByText('Estimated')).toBeTruthy();
    useNativeModelStore.setState({
      asrResolved: { model: 'asr-a', device: 'cpu', memoryBytes: 104_857_600 },
      translationResolved: { model: 'mt-a', device: 'cpu', memoryBytes: 104_857_600 },
    });
    rerender(<LocalNativeEngineSummary {...props()} legs={['speaker']} />);
    expect(screen.getByText('In use')).toBeTruthy();
  });

  it('names a stale pick and switches it to Auto through update', () => {
    const p = props({ settings: { ...LOCAL_NATIVE_DEFAULTS, selections: { 'ja→en': { asr: { modelId: 'gone' }, translation: { modelId: '' }, tts: { modelId: '' } } } } });
    render(<LocalNativeEngineSummary {...p} legs={['speaker']} />);
    fireEvent.click(screen.getByTestId('resolution-notes-use-auto'));
    expect(p.update).toHaveBeenCalledWith({ selections: { 'ja→en': { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: '' } } } });
  });
});
```

`src/providers/local_native/LocalNativeSettings.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { LocalNativeSettingsView } from './LocalNativeSettings';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

const cpu = [{ tier: 'cpu', backend: 'ct2', available: true }];
const M = (id: string, kind: NativeModelInfo['kind'], languages: string[]): NativeModelInfo =>
  ({ id, name: id, kind, languages, recommended: true, tiers: cpu, order: 1, repo: id }) as NativeModelInfo;

beforeEach(() => {
  useNativeModelStore.setState({ catalog: { 'mt-a': M('mt-a', 'translate', ['multi']) }, statuses: { 'mt-a': 'ready' } });
});

describe('LocalNativeSettingsView', () => {
  it('offers the speed only where the target has a native voice', () => {
    const { rerender } = render(<LocalNativeSettingsView settings={LOCAL_NATIVE_DEFAULTS} update={vi.fn()} pair={{ source: 'ja', target: 'en' }} />);
    expect(screen.queryByLabelText('Speech Speed')).toBeNull();
    useNativeModelStore.setState({ catalog: { 'mt-a': M('mt-a', 'translate', ['multi']), 'tts-a': M('tts-a', 'tts', ['en']) } });
    rerender(<LocalNativeSettingsView settings={LOCAL_NATIVE_DEFAULTS} update={vi.fn()} pair={{ source: 'ja', target: 'en' }} />);
    expect(screen.getByLabelText('Speech Speed')).toBeTruthy();
  });

  it('shows the translation prompt control (#526 decides whether it is enabled)', () => {
    render(<LocalNativeSettingsView settings={LOCAL_NATIVE_DEFAULTS} update={vi.fn()} pair={{ source: 'ja', target: 'en' }} />);
    expect(screen.getByText('Translation Prompt')).toBeTruthy();
  });
});
```


`src/providers/local_native/LocalNativeTurnDetection.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LocalNativeTurnDetectionControls, LocalNativeTurnDetectionSummary } from './LocalNativeTurnDetection';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

describe('LocalNativeTurnDetection', () => {
  it('summarizes the minimum silence', () => {
    const { container } = render(<LocalNativeTurnDetectionSummary settings={{ ...LOCAL_NATIVE_DEFAULTS, vadMinSilenceDuration: 1.2 }} update={vi.fn()} />);
    expect(container.textContent).toBe('VAD Settings · Min Silence Duration: 1.20s');
  });
  it('draws the three knobs the native VAD takes', () => {
    const { container } = render(<LocalNativeTurnDetectionControls settings={LOCAL_NATIVE_DEFAULTS} update={vi.fn()} />);
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(3);
  });
});
```

In `src/components/providers/ProviderOwnSettings.test.tsx` (it already imports `ProviderEngine`, `appVoicePreview`, `fakeProvider` and `FAKE_DEFAULTS`; add `EngineProps` to its `lib/provider/types` import), a new block after `describe('ProviderOwnSettings', ...)`:

```tsx
describe('ProviderEngine', () => {
  it("hands Engine the app's voice-preview route (#578 ruling 13)", () => {
    useProviderStore.setState({ entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } } } });
    const seen: EngineProps<FakeSettings>[] = [];
    const Engine = (props: EngineProps<FakeSettings>) => { seen.push(props); return null; };
    render(<ProviderEngine providers={[{ ...fakeProvider, Engine }]} />);
    expect(seen[0].preview).toBe(appVoicePreview);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/local_native src/components/providers`
Expected: FAIL — the four view modules do not exist; `ProviderEngine` passes no `preview`.

- [ ] **Step 3: Write `LocalNativeEngine.tsx`**

```tsx
import { useMemo } from 'react';
import { EngineSurface } from '../../components/Settings/engine/EngineSurface';
import { StoragePage } from '../../components/Settings/engine/StoragePage';
import { useNativeEngineAdapter } from '../../components/Settings/engine/useNativeEngineAdapter';
import { NativeModelManagementSection } from '../../components/Settings/sections/NativeModelManagementSection';
import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
import type { EngineProps } from '../../lib/provider/types';
import { FALLBACK_PAIR, modeOfLegs } from './engineLegs';
import type { LocalNativeSettings } from './settings';

/**
 * Local Native's `Engine`: the native model management — `EngineSurface` over
 * `useNativeEngineAdapter`, `NativeModelManagementSection` and `StoragePage`'s
 * native half — fed from `settings` / `update` / the pair (spec: Migration
 * item 10). Voice previews take the app's route through the preview port its
 * host hands it (#578 ruling 13).
 */
export function LocalNativeEngine({
  settings, update, disabled = false, pair = FALLBACK_PAIR, legs, initialSlot, onInitialSlotConsumed, preview,
}: EngineProps<LocalNativeSettings>) {
  // Keyed on the pair's languages: the store hands out a new pair object on every settings write.
  const { source, target } = pair;
  const hostPair = useMemo(() => ({ source, target }), [source, target]);
  const override = useMemo(() => ({ settings, update, pair: hostPair }), [settings, update, hostPair]);
  const adapter = useNativeEngineAdapter(disabled, override);
  return (
    <VoicePreviewContext.Provider value={preview ?? null}>
      <EngineSurface
        adapter={adapter}
        effectiveMode={modeOfLegs(legs)}
        initialSlot={initialSlot ?? null}
        onInitialSlotConsumed={onInitialSlotConsumed}
        renderLibrary={(slot) => (
          <NativeModelManagementSection
            isSessionActive={disabled}
            stageFilter={slot.stage}
            direction={slot.dir}
            settings={settings}
            update={update}
            pair={hostPair}
          />
        )}
        renderStorage={() => <StoragePage provider="native" isSessionActive={disabled} settings={settings} pair={hostPair} />}
      />
    </VoicePreviewContext.Provider>
  );
}
```

- [ ] **Step 4: Write `LocalNativeEngineSummary.tsx`**

```tsx
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Cpu } from 'lucide-react';
import { EngineStatusLine } from '../../components/Settings/sections/EngineStatusLine';
import {
  actualNativeMemoryByDevice, estimateNativeMemoryByDevice, formatMemMb,
  nativeAsrCards, nativeAsrIncompatibleCards, nativeTranslationCards, nativeTtsModels,
} from '../../lib/local-inference/native/nativeCatalog';
import { shortenModelName } from '../../lib/local-inference/modelName';
import { directionKey, emptyDirection, type DirectionResult, type ResolutionNote, type Selections } from '../../lib/local-inference/selection/types';
import type { EngineSummaryProps } from '../../lib/provider/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { FALLBACK_PAIR, modeOfLegs } from './engineLegs';
import type { LocalNativeSettings } from './settings';

/**
 * Local Native's summary under the provider picker: the engine's status
 * line, a chip per stage of each direction the legs run, the memory the
 * resolved models take (estimated, or in use once a run reported its plan),
 * and the fallbacks in use — the old `ProviderSection` and `LanguageSection`
 * blocks, read from `settings` and the pair.
 */
export function LocalNativeEngineSummary({
  settings, update, disabled = false, pair = FALLBACK_PAIR, legs, openSlot,
}: EngineSummaryProps<LocalNativeSettings>) {
  const { t } = useTranslation();
  const mode = modeOfLegs(legs);
  const participantInScope = legs.includes('participant');
  const sidecarStatus = useNativeModelStore((s) => s.sidecarStatus);
  const catalog = useNativeModelStore((s) => s.catalog);
  const statuses = useNativeModelStore((s) => s.statuses);
  const sizes = useNativeModelStore((s) => s.sizes);
  const asrResolved = useNativeModelStore((s) => s.asrResolved);
  const translationResolved = useNativeModelStore((s) => s.translationResolved);

  const speaker: DirectionResult = useMemo(
    () => useNativeModelStore.getState().resolve(pair.source, pair.target, settings.selections),
    [pair.source, pair.target, settings.selections, catalog, statuses],
  );
  const participant: DirectionResult = useMemo(
    () => useNativeModelStore.getState().resolve(pair.target, pair.source, settings.selections),
    [pair.source, pair.target, settings.selections, catalog, statuses],
  );

  const estimate = useMemo(() => estimateNativeMemoryByDevice([
    { id: speaker.asr?.modelId, device: settings.asrDevice },
    { id: speaker.translation?.modelId, device: settings.translationDevice },
    { id: speaker.tts?.modelId, device: settings.ttsDevice },
  ], sizes, catalog), [speaker, settings.asrDevice, settings.translationDevice, settings.ttsDevice, sizes, catalog]);

  // What is really in use once a run reported its plan — only while it is about the current picks.
  const actual = useMemo(() => {
    const asrMatch = !!asrResolved && asrResolved.model === speaker.asr?.modelId;
    const trMatch = !!translationResolved && translationResolved.model === speaker.translation?.modelId;
    if (!asrMatch || !trMatch) return null;
    const mem = actualNativeMemoryByDevice(asrResolved, translationResolved);
    const degraded = [asrResolved, translationResolved].some((r) => r?.device === 'cpu' && r?.fallbackReason);
    return { ...mem, degraded };
  }, [asrResolved, translationResolved, speaker]);

  const renderChips = (resolved: DirectionResult, src: string, tgt: string, includeTts: boolean): React.ReactNode => {
    const dir = directionKey(src, tgt);
    const asrId = resolved.asr?.modelId;
    const asrCard = asrId ? [...nativeAsrCards(src, catalog), ...nativeAsrIncompatibleCards(src, catalog)].find((c) => c.selectId === asrId) : undefined;
    const trId = resolved.translation?.modelId;
    const trCard = trId ? nativeTranslationCards(src, tgt, catalog).find((c) => c.selectId === trId) : undefined;
    const ttsId = resolved.tts?.modelId;
    const ttsModel = ttsId ? nativeTtsModels(tgt, catalog).find((m) => m.id === ttsId) : undefined;
    const chip = (stage: 'asr' | 'translation' | 'tts', labelKey: string, labelDefault: string, id: string | undefined, name: string | undefined) => (
      <button type="button" className="model-chip" onClick={() => openSlot({ dir, stage })}>
        <span className="model-chip-label">{t(labelKey, labelDefault)}</span>
        <span className={`model-chip-value ${id ? 'model-ok' : 'model-warn'}`}>
          {id ? shortenModelName(name ?? id) : t('common.none', 'None')}
        </span>
      </button>
    );
    return (
      <>
        {chip('asr', 'providers.local_inference.modelAsr', 'ASR', asrId, asrCard?.name)}
        {chip('translation', 'providers.local_inference.modelTranslation', 'MT', trId, trCard?.name)}
        {includeTts && chip('tts', 'providers.local_inference.modelTts', 'TTS', ttsId, ttsModel?.name)}
      </>
    );
  };

  const chipGroups = (): React.ReactNode => {
    if (mode === 'participant') return <div className="model-inline">{renderChips(participant, pair.target, pair.source, false)}</div>;
    if (mode === 'both') {
      return (
        <>
          <div className="model-inline-group">
            <span className="model-inline-group__label">{t('modePicker.modeYou', 'Me')}</span>
            <div className="model-inline">{renderChips(speaker, pair.source, pair.target, true)}</div>
          </div>
          <div className="model-inline-group">
            <span className="model-inline-group__label">{t('modePicker.modeParticipants', 'Other')}</span>
            <div className="model-inline">{renderChips(participant, pair.target, pair.source, false)}</div>
          </div>
        </>
      );
    }
    return <div className="model-inline">{renderChips(speaker, pair.source, pair.target, true)}</div>;
  };

  // The fallbacks in use, for the directions the legs show; no-candidate notes are readiness's to word.
  const notes = useMemo(
    () => [...speaker.notes, ...(participantInScope ? participant.notes : [])].filter((n: ResolutionNote) => n.reason !== 'no-candidate'),
    [speaker, participant, participantInScope],
  );
  const staleNames: string[] = [];
  for (const n of notes) {
    if (!n.from) continue;
    const name = shortenModelName(catalog[n.from]?.name ?? n.from);
    if (!staleNames.includes(name)) staleNames.push(name);
  }
  const switchNotesToAuto = () => {
    const next: Selections = { ...settings.selections };
    for (const n of notes) next[n.direction] = { ...(next[n.direction] ?? emptyDirection()), [n.stage]: { modelId: '' } };
    update({ selections: next });
  };

  return (
    <>
      <EngineStatusLine />
      {/* data-tour on the wrapper: the tour's models step can run while the sidecar still starts. */}
      <div className="local-inference-info" data-tour="engine-chips">
        {sidecarStatus === 'starting' || sidecarStatus === 'idle' ? (
          <div className="model-info local-native-status is-loading">{t('settings.localNativeStarting', 'Starting the local engine')}</div>
        ) : sidecarStatus === 'unavailable' ? (
          <div className="model-info local-native-status is-error">{t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings')}</div>
        ) : (
          <div className="model-info">
            {chipGroups()}
            {actual ? (
              <div className="memory-estimate">
                <Cpu size={11} />
                <span className="memory-estimate__label">{t('engineUi.inUse', 'In use')}</span>
                {actual.vramMb > 0 && <span>VRAM {formatMemMb(actual.vramMb)}</span>}
                {actual.ramMb > 0 && <span>RAM {formatMemMb(actual.ramMb)}</span>}
                {actual.degraded && <span className="memory-estimate__warn">{t('engineUi.translationOnCpu', 'Translation on CPU — not enough VRAM')}</span>}
              </div>
            ) : (estimate.vramMb > 0 || estimate.ramMb > 0) && (
              <div className="memory-estimate">
                <Cpu size={11} />
                <span className="memory-estimate__label">{t('engineUi.estimated', 'Estimated')}</span>
                {estimate.vramMb > 0 && <span>VRAM ~{formatMemMb(estimate.vramMb)}</span>}
                {estimate.ramMb > 0 && <span>RAM ~{formatMemMb(estimate.ramMb)}</span>}
              </div>
            )}
          </div>
        )}
        {notes.length > 0 && (
          <div className="language-resolution-notes" data-testid="language-resolution-notes">
            <div className="language-warning">
              <AlertTriangle size={12} />
              <span>
                {staleNames.length === 0
                  ? t('settings.resolutionNotesSummary', '{{count}} of your selected models are unavailable — automatic fallbacks are in use.', { count: notes.length })
                  : staleNames.length > 2
                    ? t('settings.resolutionNotesNamedMore', '{{names}} and {{count}} more unavailable — automatic fallbacks are in use.', { names: staleNames.slice(0, 2).join(', '), count: staleNames.length - 2 })
                    : t('settings.resolutionNotesNamed', '{{names}} unavailable — automatic fallbacks are in use.', { names: staleNames.join(', ') })}
                {' '}
                <button type="button" className="language-model-warning__link" data-testid="resolution-notes-review"
                  onClick={() => openSlot({ dir: notes[0].direction, stage: notes[0].stage })}>
                  {t('settings.resolutionNotesReview', 'Review')}
                </button>
                {' · '}
                <button type="button" className="language-model-warning__link" data-testid="resolution-notes-use-auto"
                  onClick={switchNotesToAuto} disabled={disabled}>
                  {t('settings.resolutionNotesUseAuto', 'Switch to Auto')}
                </button>
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
```


- [ ] **Step 5: Write `LocalNativeSettings.tsx` and `LocalNativeTurnDetection.tsx`**

```tsx
import { useMemo } from 'react';
import { TranslationPromptControl, TtsSpeedControl } from '../../components/Settings/sections/LocalSettingsControls';
import { hasNativeTts, supportsCustomPrompt } from '../../lib/local-inference/native/nativeCatalog';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import type { SettingsProps } from '../../lib/provider/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import type { LocalNativeSettings as S } from './settings';

/**
 * Local Native's `Settings`: TTS speed, shown only where the target language
 * has a native voice, and the translation prompt, offered unless every
 * resolved translation model owns its own prompt (#526). Its models are its
 * `Engine`; its VAD knobs are its `TurnDetection`.
 */
export function LocalNativeSettingsView({ settings, update, disabled = false, pair }: SettingsProps<S>) {
  const source = pair?.source ?? 'ja';
  const target = pair?.target ?? 'en';
  const catalog = useNativeModelStore((s) => s.catalog);
  const statuses = useNativeModelStore((s) => s.statuses);
  const speaker = useMemo(() => useNativeModelStore.getState().resolve(source, target, settings.selections), [source, target, settings.selections, catalog, statuses]);
  const participant = useMemo(() => useNativeModelStore.getState().resolve(target, source, settings.selections), [source, target, settings.selections, catalog, statuses]);
  const promptSupported = supportsCustomPrompt(speaker.translation?.modelId ?? '') || supportsCustomPrompt(participant.translation?.modelId ?? '');
  return (
    <>
      {hasNativeTts(target, catalog) && (
        <TtsSpeedControl value={settings.ttsSpeed} onChange={(ttsSpeed) => update({ ttsSpeed })} disabled={disabled} />
      )}
      <TranslationPromptControl
        useTemplateMode={settings.useTemplateMode}
        systemPrompt={settings.systemPrompt}
        participantSystemPrompt={settings.participantSystemPrompt}
        preview={buildDefaultLocalPrompt(source, target)}
        supported={promptSupported}
        disabled={disabled}
        onChange={(patch) => update(patch)}
      />
    </>
  );
}
```

`LocalNativeTurnDetection.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import { VadControl } from '../../components/Settings/sections/LocalSettingsControls';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { SettingsProps } from '../../lib/provider/types';
import type { LocalNativeSettings as S } from './settings';

const helpIcon = (
  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
);

/**
 * Local Native's VAD knobs: the renderer's Silero worker takes three (no max
 * duration — it cuts at 19 s itself), whatever model runs, so every part shows
 * always. Same words as LocalInference's (`VadControl`'s own keys).
 */
export function LocalNativeTurnDetectionSummary({ settings }: SettingsProps<S>) {
  const { t } = useTranslation();
  return <>{`${t('settings.vadSettings', 'VAD Settings')} · ${t('settings.vadMinSilenceDuration', 'Min Silence Duration')}: ${settings.vadMinSilenceDuration.toFixed(2)}s`}</>;
}

export function LocalNativeTurnDetectionHelp(_props: SettingsProps<S>) {
  const { t } = useTranslation();
  return (
    <Tooltip content={t('settings.vadSettingsTooltip', 'Voice Activity Detection parameters. Controls how speech segments are detected and split. Changes take effect on next session start.')} position="top">
      {helpIcon}
    </Tooltip>
  );
}

export function LocalNativeTurnDetectionControls({ settings, update, disabled = false }: SettingsProps<S>) {
  return (
    <VadControl
      values={{
        vadThreshold: settings.vadThreshold,
        vadMinSilenceDuration: settings.vadMinSilenceDuration,
        vadMinSpeechDuration: settings.vadMinSpeechDuration,
      }}
      onChange={(patch) => update(patch)}
      disabled={disabled}
    />
  );
}
```

- [ ] **Step 6: `ProviderEngine` passes the preview port**

In `src/components/providers/ProviderOwnSettings.tsx`, `ProviderEngine`'s render gains `preview={appVoicePreview}`:

```tsx
  return (
    <Engine
      {...ownProps(selection, selection.entry, disabled)}
      legs={legs}
      initialSlot={initialSlot}
      onInitialSlotConsumed={onInitialSlotConsumed}
      preview={appVoicePreview}
    />
  );
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/providers/local_native src/components/providers`
Expected: PASS.

- [ ] **Step 8: Run the gates and commit**

```bash
git commit -m "feat(local_native): its Engine, summary, settings and turn detection views

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe" -- src/providers/local_native/LocalNativeEngine.tsx src/providers/local_native/LocalNativeEngine.test.tsx src/providers/local_native/LocalNativeEngineSummary.tsx src/providers/local_native/LocalNativeEngineSummary.test.tsx src/providers/local_native/LocalNativeSettings.tsx src/providers/local_native/LocalNativeSettings.test.tsx src/providers/local_native/LocalNativeTurnDetection.tsx src/providers/local_native/LocalNativeTurnDetection.test.tsx src/components/providers/ProviderOwnSettings.tsx src/components/providers/ProviderOwnSettings.test.tsx
```

---

### Task 10: The definition, the registry, and the record

**Files:**
- Create: `src/providers/local_native/bridge.ts`, `src/providers/local_native/provider.ts`
- Test: `src/providers/local_native/bridge.test.ts`, `src/providers/local_native/provider.test.ts`
- Modify: `src/providers/registry.ts`, `src/providers/registry.test.ts`
- Modify: `CLAUDE.md`, `CONTEXT.md`, `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`

**Interfaces:**
- Consumes: everything above; `LOCAL_NATIVE_DEBUG_KEY` (`src/utils/environment.ts`); `nativeListTtsVoices`, `nativeHardwareInfo`, `set*Resolved` (`nativeModelStore.ts`); `voiceStoreFor` (`nativeVoiceStores.ts`).
- Produces: `localNativeProvider` (id `'local_native'`), `nativeStoreHost: NativeHost`.

- [ ] **Step 1: Write the failing tests**

`src/providers/local_native/bridge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { nativeStoreHost } from './bridge';

describe('nativeStoreHost', () => {
  it("files each stage's plan where the library's badges read it (#578 ruling 14)", () => {
    nativeStoreHost.plan('asr', { model: 'asr-a', device: 'vulkan', backend: 'ggml', rtf: 0.2 });
    nativeStoreHost.plan('translation', { model: 'mt-a', device: 'cpu', tokensPerSec: 30, fallbackReason: 'vram' });
    nativeStoreHost.plan('tts', { model: 'tts-a', device: 'cpu' });
    const s = useNativeModelStore.getState();
    expect(s.asrResolved).toMatchObject({ model: 'asr-a', device: 'vulkan', backend: 'ggml', rtf: 0.2 });
    expect(s.translationResolved).toMatchObject({ model: 'mt-a', device: 'cpu', tokensPerSec: 30, fallbackReason: 'vram' });
    expect(s.ttsResolved).toMatchObject({ model: 'tts-a', device: 'cpu' });
  });
});
```

`src/providers/local_native/provider.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isPresent } from '../../lib/provider/presence';
import { LOCAL_NATIVE_DEBUG_KEY } from '../../utils/environment';
import { localNativeProvider } from './provider';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

const env = (over: Partial<Parameters<typeof isPresent>[1]> = {}) =>
  ({ platform: 'electron' as const, dev: false, enabled: new Set<string>(), kizuna: false, switchOn: () => false, ...over });

describe('localNativeProvider', () => {
  it("keeps the old enum's id and the old slice's storage prefix", () => {
    expect(localNativeProvider.id).toBe('local_native');
    expect(localNativeProvider.kind).toBe('local');
    expect(localNativeProvider.settings).toEqual({ key: 'localNative', defaults: LOCAL_NATIVE_DEFAULTS });
    expect(localNativeProvider.credentials.keys).toEqual([]);
  });

  it('is flagged, Electron only, and unlocked by its tester switch (#578 ruling 1)', () => {
    expect(localNativeProvider.flagged).toBe(true);
    expect(localNativeProvider.testerSwitch).toBe(LOCAL_NATIVE_DEBUG_KEY);
    expect(isPresent(localNativeProvider, env())).toBe(false);
    expect(isPresent(localNativeProvider, env({ switchOn: (k) => k === LOCAL_NATIVE_DEBUG_KEY }))).toBe(true);
    expect(isPresent(localNativeProvider, env({ enabled: new Set(['local_native']) }))).toBe(true);
    expect(isPresent(localNativeProvider, env({ platform: 'web', dev: true }))).toBe(false);
  });

  it('speaks optionally, takes typed text, decides its own boundaries, and offers both turn modes', () => {
    expect(localNativeProvider.speech).toBe('optional');
    expect(localNativeProvider.textInput(LOCAL_NATIVE_DEFAULTS)).toBe(true);
    expect(localNativeProvider.boundaries(LOCAL_NATIVE_DEFAULTS)).toBe('provider');
    expect(localNativeProvider.turns(LOCAL_NATIVE_DEFAULTS)).toEqual(['auto', 'manual']);
    expect(localNativeProvider.session?.admit).toBeTypeOf('function');
    expect(localNativeProvider.Engine).toBeTypeOf('function');
    expect(localNativeProvider.EngineSummary).toBeTypeOf('function');
    expect(localNativeProvider.watchReadiness).toBeTypeOf('function');
  });
});
```

In `src/providers/registry.test.ts`, the release order (`it("the release offers its providers in the owner's order", ...)`) becomes:

```ts
    // ... then Local Native right after LocalInference, flagged (#578 ruling 1), ...
    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'local_native', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'openai_live', 'soniox', 'palabraai']);
```

(extend that test's comment with `then Local Native, flagged (#578 ruling 1)` after LocalInference).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/local_native/bridge.test.ts src/providers/local_native/provider.test.ts src/providers/registry.test.ts`
Expected: FAIL — `./bridge`, `./provider` missing; the release order lacks `local_native`.

- [ ] **Step 3: Write `bridge.ts`**

```ts
import { voiceStoreFor } from '../../lib/local-inference/native/nativeVoiceStores';
import { nativeHardwareInfo, nativeListTtsVoices, useNativeModelStore } from '../../stores/nativeModelStore';
import type { NativeHost } from './host';

/**
 * The adapter's host over the native model store (#578 ruling 14): the
 * built-in voices and the hardware probe through the store's management
 * socket, the clip stores, and each stage's resolved plan where the
 * library's badges read it. The definition hands it in, so the session side
 * imports no store.
 */
export const nativeStoreHost: NativeHost = {
  listVoices: (modelId) => nativeListTtsVoices(modelId),
  voiceStore: (custom, modelId) => voiceStoreFor(custom, modelId),
  hardware: () => nativeHardwareInfo(),
  plan: (stage, plan) => {
    const store = useNativeModelStore.getState();
    const { model, device, backend, computeType, rtf, tokensPerSec, memoryBytes, fallbackReason } = plan;
    if (stage === 'asr') store.setAsrResolved({ model, device, backend, computeType, rtf, memoryBytes, fallbackReason });
    else if (stage === 'translation') store.setTranslationResolved({ model, device, backend, computeType, tokensPerSec, memoryBytes, fallbackReason });
    else store.setTtsResolved({ model, device, backend, computeType, rtf, memoryBytes, fallbackReason });
  },
};
```

- [ ] **Step 4: Write `provider.ts`**

```ts
import { KizunaAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { LOCAL_NATIVE_DEBUG_KEY } from '../../utils/environment';
import { createLocalNativeAdapter, type LocalNativeCredentials } from './adapter';
import { nativeStoreHost } from './bridge';
import { checkLocalNative, watchLocalNativeReadiness } from './check';
import { admitLocalNative, buildLocalNative, describeLocalNative, type LocalNativeConfig } from './config';
import { nativeEngines } from './engines';
import { LocalNativeEngine } from './LocalNativeEngine';
import { LocalNativeEngineSummary } from './LocalNativeEngineSummary';
import { LocalNativeSettingsView } from './LocalNativeSettings';
import { LocalNativeTurnDetectionControls, LocalNativeTurnDetectionHelp, LocalNativeTurnDetectionSummary } from './LocalNativeTurnDetection';
import { LOCAL_NATIVE_DEFAULTS, localNativeLanguages, type LocalNativeSettings } from './settings';

const adapter = createLocalNativeAdapter(nativeEngines, nativeStoreHost);

/**
 * Local Native's definition (spec: Migration item 10): LocalInference's
 * sibling on the Electron sidecar. Flagged and unlocked by its tester switch
 * until it ships (#578 ruling 1); its catalogs already spell it `local_native`.
 */
export const localNativeProvider: Provider<LocalNativeSettings, LocalNativeCredentials, LocalNativeConfig> & { id: 'local_native' } = {
  id: 'local_native',
  kind: 'local',
  platforms: ['electron'],
  flagged: true,
  testerSwitch: LOCAL_NATIVE_DEBUG_KEY,
  icon: KizunaAIIcon,
  // Today's TUTORIAL_URLS value, as a literal: that module is the old provider layer.
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/local-native-setup',

  settings: { key: 'localNative', defaults: LOCAL_NATIVE_DEFAULTS },
  Settings: LocalNativeSettingsView,
  Engine: LocalNativeEngine,
  EngineSummary: LocalNativeEngineSummary,
  TurnDetection: { Summary: LocalNativeTurnDetectionSummary, Controls: LocalNativeTurnDetectionControls, Help: LocalNativeTurnDetectionHelp },

  credentials: { keys: [], fields: () => [], read: () => ({}) },
  check: (_k, s, ctx) => checkLocalNative(s, ctx),
  watchReadiness: watchLocalNativeReadiness,

  languages: localNativeLanguages,

  speech: 'optional',
  textInput: () => true,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildLocalNative,
  describe: describeLocalNative,
  start: adapter.start,

  session: { admit: admitLocalNative },
};
```

- [ ] **Step 5: Register it**

In `src/providers/registry.ts`, import `import { localNativeProvider } from './local_native/provider';` and insert it in `RELEASED` right after `localInferenceProvider`; the doc comment names it: `…, the free LocalInference and, flagged, Local Native (#578 ruling 1), then Gemini, …`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/providers src/app src/components/providers src/components/Settings`
Expected: PASS. A failure in an invariant of `registry.test.ts` (language codes, locale names, the context-offer rules) is the definition's to fix, never the invariant's.

- [ ] **Step 7: Bring the record up to date**

- `CLAUDE.md`: in "Provider Architecture", replace the bullet "Local Native is the exception until kizuna-ai-lab/sokuji#578: …" with: `Local Native runs on this structure since kizuna-ai-lab/sokuji#578 (\`src/providers/local_native/\`, flagged, behind its \`debug:local-native\` switch, Electron only). Its old path — \`LocalNativeClient\`, \`LocalNativeProviderConfig\`, the old settings shell, the \`localNative\` slice — stays compiled and unreachable until the owner's live test, then is deleted; \`src/providers/oldPath.consistency.test.ts\` keeps new code off it.` Make the same change where "Code Organization", "Error Handling" ("Local Native's old \`IClient\`"), "Environment Variables" (\`VITE_ENABLE_LOCAL_NATIVE\` now gates only the old path; the new definition is gated by \`flagged\` / \`testerSwitch\` / \`VITE_ENABLED_PROVIDERS\`) and "Adding a New AI Provider" name the exception. The first paragraph's "Local Native, the Electron sidecar, still runs on the old provider path until kizuna-ai-lab/sokuji#578" becomes "Local Native, the Electron sidecar, is offered to testers (flagged)".
- `CONTEXT.md`: where it says Local Native runs the old path until #578, say it runs on its own provider folder; keep "two PEER providers … no unifying layer" (#578 ruling 3 moves only `SentenceCut`, a segmentation module, not a provider seam); update the "Native sidecar model resolution" entries: resolution is the builder's (`config.ts`), readiness is `ensureSelectionReady` fed the provider's own settings.
- The roadmap: append a section `## The Local Native port (kizuna-ai-lab/sokuji#578)` recording the sixteen rulings by number and title, the stated departures (TTS load failure is degraded, not session-broken; translation partials keep streaming; `translate_init`'s `ttsModel` only when TTS loads; the store no longer prunes or re-validates the old slice; the old path's `revalidateNativeProvider` is gone), and what remains: the owner's live test on the sidecar (the native backends, the voices, the device profile, Start refused for Both), then the deletion plan for the old path (`LocalNativeClient` and tests, `LocalNativeProviderConfig`, `ProviderConfigFactory`, `ClientFactory`, `ProviderDescriptor`, `localParticipantConfig`, `punctuateDefinite`, `IClient.ts`, the old shell and `sessionStore.ts`, the `localNative` slice and `validateApiKey`, `oldPath.consistency.test.ts`, `VITE_ENABLE_LOCAL_NATIVE` and `isLocalNativeEnabled`, the old store's `asrLoading`/`ttsLoading` and `lastResolutionNotes`).

- [ ] **Step 8: Run every gate**

Run: `npx vitest run src`, `npx vitest run electron extension`, `npx tsc --noEmit -p tsconfig.json` (no error the baseline lacks). Then render the Engine page and the summary headlessly once (memory: "Settle UI decisions by rendering") with the sidecar mocked ready, and look: the chips, the status line, the library opening from a chip.

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(local_native): register Local Native on the client contract, flagged

kizuna-ai-lab/sokuji#578: the definition, its store-backed host and its
place after LocalInference; the docs say the old path is kept until the
owner's live test.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe" -- src/providers/local_native/bridge.ts src/providers/local_native/bridge.test.ts src/providers/local_native/provider.ts src/providers/local_native/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts CLAUDE.md CONTEXT.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
```

---

## After this plan

1. The owner's live test on the sidecar, on the Electron app with `debug:local-native` set: the native backends (GPU and CPU), the voices (built-in, custom clip, a clone-only model without a clip), the device profile, push-to-talk, a sentences display, typed text, and Start refused for Both.
2. The deletion plan for the old path (the list in Task 10's roadmap section).
3. Shipping: `VITE_ENABLED_PROVIDERS=local_native` at a release, and the tester switch and `VITE_ENABLE_LOCAL_NATIVE` removed with the old path.
