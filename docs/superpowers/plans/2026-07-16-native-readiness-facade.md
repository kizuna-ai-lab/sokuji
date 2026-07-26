# Native Readiness Facade (C5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 98-line LOCAL_NATIVE readiness gate in `settingsStore.validateApiKey` into a single `nativeModelStore.ensureSelectionReady(selection, opts)` facade, so the LOCAL_NATIVE branch reads as symmetrically as the LOCAL_INFERENCE branch (which already delegates to `useModelStore.ensureSelectionReady`).

**Architecture:** The effectful readiness pipeline (warm sidecar → lifecycle gate → variant-aware status refresh → auto-select → compat + downloaded checks) moves into a new async store method that returns `{ ready, reason, corrections }`. `settingsStore` shrinks to: call the facade → apply corrections → map `reason` → i18n message → set validation state. The duplicated variant-repo derivation in the gate is unified with the store's own copy behind one private `deriveVariantRepos` helper.

**Tech Stack:** TypeScript, Zustand (`create` store), Vitest 4 (`vitest`; single file: `npx vitest run <path>`), i18next.

## Global Constraints

- **Behaviour-preserving refactor.** Every scenario must produce the identical `{ valid, message, validating }` from `validateApiKey()`, the identical persisted `localNative` selection, and the identical set of sidecar calls. Preserve any latent bug verbatim — do not "fix" behaviour during this refactor.
- **Peer-provider rule:** LOCAL_INFERENCE (WASM) and LOCAL_NATIVE (sidecar) are peers. Do NOT introduce a shared inference abstraction between them. The facade is native-only; it mirrors WASM's `ensureSelectionReady` in *shape* only.
- **Do NOT touch:** the WASM side (`modelStore.ts`, `engine/`, `workers/`), the wire protocol (`nativeProtocol.ts` message shapes), the session-stage client (`LocalNativeClient.ts`) and its `asr/tts` resolved/loading store state, or C6's store-lane split.
- **English-only** comments/identifiers. Conventional-commit messages. Frequent commits (one per task).

---

## File Structure

- `src/lib/local-inference/native/nativeCatalog.ts` — add the readiness types (`NativeReadinessReason`, `NativeReadinessSelection`, `NativeReadinessResult`), co-located with the existing `NativeSelection`. Pure types, no logic.
- `src/stores/nativeModelStore.ts` — add the private `deriveVariantRepos` helper (used by the existing `catalogStatusRepos` AND the new facade), and the `ensureSelectionReady` store method.
- `src/stores/settingsStore.ts` — shrink the LOCAL_NATIVE branch of `validateApiKey` to delegate to the facade; add a module-level `msgForNativeReason(reason)` helper mapping reason → i18n message.
- `src/stores/nativeModelStore.test.ts` — add facade tests (real store + existing `FakeWS` harness): the variant/refresh/lifecycle/compat/reason coverage re-homed from `nativeGate.test.ts`.
- `src/stores/settingsStore.nativeGate.test.ts` — (Task 1) freeze the current per-scenario `validationMessage`; (Task 4) restructure to the thin wrapper-contract form (mock the facade), keeping the frozen message assertions.

---

## Task 1: Freeze the current `validationMessage` per scenario (characterization)

The existing `nativeGate.test.ts` drives `validateApiKey()` and asserts `r.valid`, but never asserts `validationMessage`. Since the refactor moves how the message is derived (inline conditionals → `msgForNativeReason(reason)`), pin the current observable message for each reachable failure scenario FIRST, against unchanged product code.

**Files:**
- Modify: `src/stores/settingsStore.nativeGate.test.ts`

**Interfaces:**
- Consumes: `validateApiKey()` return `{ valid, message, validating }` and `useSettingsStore.getState().validationMessage` (unchanged in this task).
- Produces: frozen message-string constants that Task 4 re-asserts against the mocked facade.

- [ ] **Step 1: Add message assertions to the reachable-reason scenarios.**

The existing whole-store mock (lines 48–60) provides `refresh/isReady/ensureCatalog/autoSelect/sidecarStatus/catalog` (no `bundleStatus`), so the reasons reachable here are: `unavailable`, `starting`, `asr-incompatible`, `translation-incompatible`, `models-missing`, and `ready`. (`engine-absent` / `engine-mismatch` / `not-electron` need `bundleStatus`/electron control and are covered by the facade tests in Task 3.)

Add a new `describe` block at the end of the file. Use the file's existing `setNative` / `mockNativeSidecar` helpers.

```ts
describe('LOCAL_NATIVE gate: validationMessage is frozen per scenario', () => {
  it('empty message when ready', async () => {
    mockIsReady.mockReturnValue(true);
    setNative({ sourceLanguage: 'zh', targetLanguage: 'en', translationModel: 'qwen2.5-0.5b' });
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r.valid).toBe(true);
    expect(useSettingsStore.getState().validationMessage).toBe('');
  });

  it('unavailable → retry message', async () => {
    mockNativeSidecar({ status: 'unavailable' });
    await useSettingsStore.getState().validateApiKey();
    expect(useSettingsStore.getState().validationMessage)
      .toBe('Native engine unavailable — retry in settings');
  });

  it('starting → starting message', async () => {
    mockNativeSidecar({ status: 'starting' });
    await useSettingsStore.getState().validateApiKey();
    expect(useSettingsStore.getState().validationMessage)
      .toBe('Starting the local engine…');
  });

  it('translation incompatible → translation message', async () => {
    mockIsReady.mockReturnValue(true);
    setNative({ sourceLanguage: 'en', targetLanguage: 'zh', translationModel: 'opus-mt-zh-en' });
    await useSettingsStore.getState().validateApiKey();
    expect(useSettingsStore.getState().validationMessage)
      .toBe('Select a translation model for this language pair');
  });

  it('asr incompatible → asr message', async () => {
    // An ASR model that is not an 'asr'-kind card for the source language.
    mockIsReady.mockReturnValue(true);
    setNative({ sourceLanguage: 'zh', targetLanguage: 'en', asrModel: 'no-such-asr', translationModel: 'qwen2.5-0.5b' });
    await useSettingsStore.getState().validateApiKey();
    expect(useSettingsStore.getState().validationMessage)
      .toBe('Select a speech-recognition model for the source language');
  });

  it('models missing → download message', async () => {
    mockIsReady.mockReturnValue(false); // compatible selection, but not downloaded
    setNative({ sourceLanguage: 'zh', targetLanguage: 'en', translationModel: 'qwen2.5-0.5b' });
    await useSettingsStore.getState().validateApiKey();
    expect(useSettingsStore.getState().validationMessage)
      .toBe('Download the native models in settings');
  });
});
```

- [ ] **Step 2: Run and pin the ACTUAL strings.**

Run: `npx vitest run src/stores/settingsStore.nativeGate.test.ts`

Expected: PASS. If any message assertion fails because the test-env i18n resolves a key to something other than the fallback shown above, replace that expected string with the ACTUAL string the current product code produced (this is characterization — pin what the code emits today, verbatim). Do not change product code.

- [ ] **Step 3: Commit.**

```bash
git add src/stores/settingsStore.nativeGate.test.ts
git commit -m "test(native): freeze validationMessage per readiness scenario (pre-refactor characterization)"
```

---

## Task 2: Extract the shared `deriveVariantRepos` helper

The store's `catalogStatusRepos` (nativeModelStore.ts:117–133) and the gate's `resolveVariantRepos` (settingsStore.ts:885–896) are the same derivation. Extract one private helper now; `catalogStatusRepos` uses it (the gate copy is removed in Task 4 when the gate moves into the facade).

**Files:**
- Modify: `src/stores/nativeModelStore.ts:117-133`
- Modify: `src/stores/nativeModelStore.test.ts` (add one focused unit test)

**Interfaces:**
- Produces: `deriveVariantRepos(cards: NativeModelInfo[], pins: Record<string, string>): Record<string, string>` — module-private in `nativeModelStore.ts`. Consumed by `catalogStatusRepos` (this task) and `ensureSelectionReady` (Task 3).

- [ ] **Step 1: Add the helper and rewrite `catalogStatusRepos`.**

Replace the body of `catalogStatusRepos` (nativeModelStore.ts:117–133) and add `deriveVariantRepos` directly above it:

```ts
/** A card's CHOSEN (pinned ?? recommended) variant repo, for each multi-variant
 * card in `cards`. Single-variant cards are skipped (their status uses the
 * default-repo cache). Pure: no store/settings reads — pins are injected. */
function deriveVariantRepos(cards: NativeModelInfo[], pins: Record<string, string>): Record<string, string> {
  const vd: Record<string, { variants: { id: string; repo: string }[]; recommended: string }> = {};
  for (const m of cards) {
    const vs = m.variants;
    if (!vs || vs.length < 2) continue;
    vd[m.id] = {
      variants: vs.map((v) => ({ id: v.id, repo: v.repo ?? '' })),
      recommended: vs.find((v) => v.recommended)?.id ?? vs[0].id,
    };
  }
  return statusReposFor(Object.keys(vd), vd, pins);
}

async function catalogStatusRepos(list: NativeModelInfo[]): Promise<Record<string, string>> {
  let pins: Record<string, string> = {};
  try {
    const { useSettingsStore } = await import('./settingsStore');
    pins = useSettingsStore.getState().localNative.translationVariantByModel ?? {};
  } catch { /* settings store unavailable — fall back to recommendations */ }
  return deriveVariantRepos(list, pins);
}
```

- [ ] **Step 2: Add a focused unit test for `deriveVariantRepos` behaviour via the public surface.**

`deriveVariantRepos` is module-private, so exercise it through the already-tested `catalogStatusRepos` path (`ensureCatalog` → `statusRepos`). The existing tests at `nativeModelStore.test.ts` lines ~169–210 already cover recommended/pin selection through this path — add one assertion that a single-variant card is skipped. Insert near the existing variant tests:

```ts
it('deriveVariantRepos skips single-variant cards (via catalog-derived statusRepos)', async () => {
  await useNativeModelStore.getState().ensureCatalog();
  // sense-voice (the fixture ASR) has no `variants` → no entry in statusRepos.
  expect(useNativeModelStore.getState().statusRepos['sense-voice']).toBeUndefined();
});
```

- [ ] **Step 3: Run the store tests.**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: PASS (all existing variant/lifecycle tests + the new one).

- [ ] **Step 4: Commit.**

```bash
git add src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts
git commit -m "refactor(native): extract shared deriveVariantRepos; catalogStatusRepos uses it"
```

---

## Task 3: Readiness types + `ensureSelectionReady` facade + facade tests

Add the facade to `nativeModelStore` and its tests. The gate is NOT touched yet, so `validateApiKey` still uses its current inline logic and `nativeGate.test.ts` stays green through this task.

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (add types near `NativeSelection`, ~line 446)
- Modify: `src/stores/nativeModelStore.ts` (add method to the interface + the `create` body)
- Modify: `src/stores/nativeModelStore.test.ts` (add facade tests)

**Interfaces:**
- Consumes: `deriveVariantRepos` (Task 2); existing store methods `ensureCatalog/refresh/autoSelect/isReady` and state `sidecarStatus/bundleStatus/catalog`; nativeCatalog helpers `nativeAsrCards/nativeTranslationCards/nativeTtsCards/requiredNativeModels/supportsLanguage`.
- Produces:
  - `NativeReadinessReason` (string union), `NativeReadinessSelection`, `NativeReadinessResult` in `nativeCatalog.ts`.
  - `ensureSelectionReady(selection: NativeReadinessSelection, opts: { textOnly: boolean }) => Promise<NativeReadinessResult>` on the store. Consumed by `settingsStore` in Task 4.

- [ ] **Step 1: Add the readiness types to `nativeCatalog.ts`.**

Immediately after the existing `NativeSelection` interface (`nativeCatalog.ts:446-450`), add:

```ts
/** Why a LOCAL_NATIVE selection is / isn't session-ready. `settingsStore` maps
 * each reason to a user-facing message; the store never owns i18n strings. */
export type NativeReadinessReason =
  | 'ready'
  | 'not-electron'
  | 'engine-mismatch'
  | 'engine-absent'
  | 'unavailable'
  | 'starting'
  | 'asr-incompatible'
  | 'translation-incompatible'
  | 'models-missing';

/** The selection fields readiness depends on (a structural subset of
 * LocalNativeSettings, so the settings slice is assignable to it). */
export interface NativeReadinessSelection {
  sourceLanguage: string;
  targetLanguage: string;
  asrModel: string;
  translationModel: string;
  ttsModel: string;
  translationVariantByModel: Record<string, string>;
}

export interface NativeReadinessResult {
  ready: boolean;
  reason: NativeReadinessReason;
  /** Auto-select's changed fields (null = nothing changed); the caller persists them. */
  corrections: Partial<NativeSelection> | null;
}
```

- [ ] **Step 2: Extend the store's imports and interface.**

In `nativeModelStore.ts`, extend the `nativeCatalog` import (line 4) to add the helpers and types the facade needs:

```ts
import {
  autoSelectNative, hardwareGated, statusReposFor,
  nativeAsrCards, nativeTranslationCards, nativeTtsCards,
  requiredNativeModels, supportsLanguage,
  type NativeSelection, type NativeReadinessSelection, type NativeReadinessResult, type NativeReadinessReason,
} from '../lib/local-inference/native/nativeCatalog';
```

Add the method to the `NativeModelStore` interface (near `isReady`, ~line 75):

```ts
  /** Full LOCAL_NATIVE session-readiness gate: warm the sidecar, check the
   *  lifecycle, refresh the pair's statuses (variant-aware), auto-select stale
   *  choices, and judge compat + downloaded state. Returns ready + a reason and
   *  the auto-select corrections (the caller persists them). Mirrors the WASM
   *  useModelStore.ensureSelectionReady in shape (peers, not a shared layer). */
  ensureSelectionReady: (selection: NativeReadinessSelection, opts: { textOnly: boolean }) => Promise<NativeReadinessResult>;
```

- [ ] **Step 3: Implement the method in the `create` body.**

Add inside the store object (e.g. directly after `isReady`, ~line 416). This is a verbatim behaviour port of `settingsStore.ts:839-936`; the only structural change is computing `effective` in-memory instead of persist-then-reread, and returning `corrections` for the caller to persist.

```ts
  ensureSelectionReady: async (selection, opts) => {
    if (!isElectron()) return { ready: false, reason: 'not-electron', corrections: null };
    await get().ensureCatalog();
    const status = get().sidecarStatus;
    if (status !== 'ready') {
      const bundle = get().bundleStatus;
      const reason: NativeReadinessReason =
        bundle === 'mismatch' ? 'engine-mismatch'
        : (bundle === 'absent' || bundle === 'paused') ? 'engine-absent'
        : status === 'unavailable' ? 'unavailable'
        : 'starting';
      return { ready: false, reason, corrections: null };
    }
    const catalog = get().catalog;
    const pins = selection.translationVariantByModel ?? {};
    const asCards = (ids: string[]): NativeModelInfo[] =>
      ids.map((id) => catalog[id]).filter((c): c is NativeModelInfo => !!c);
    // FIRST refresh: this pair's candidate statuses, variant-aware — so a cold
    // start doesn't read the default repo and wipe a valid pinned selection.
    const candidateIds = Array.from(new Set([
      ...nativeAsrCards(selection.sourceLanguage, catalog),
      ...nativeTranslationCards(selection.sourceLanguage, selection.targetLanguage, catalog),
      ...nativeTtsCards(selection.targetLanguage, catalog),
    ].map((c) => c.downloadId).filter((id): id is string => !!id)));
    const candidateRepos = deriveVariantRepos(asCards(candidateIds), pins);
    await get().refresh(candidateIds, Object.keys(candidateRepos).length > 0 ? candidateRepos : undefined);
    // Reconcile the stale selection against catalog + live statuses. autoSelect
    // also persists to modelPreferences internally; it RETURNS the changed
    // settings fields (the caller applies them to settingsStore).
    const corrections = get().autoSelect(selection.sourceLanguage, selection.targetLanguage, {
      asrModel: selection.asrModel, translationModel: selection.translationModel, ttsModel: selection.ttsModel,
    });
    const effective = corrections ? { ...selection, ...corrections } : selection;
    const asrOpt = catalog[effective.asrModel];
    const asrCompatible = !!asrOpt && asrOpt.kind === 'asr' && supportsLanguage(asrOpt, effective.sourceLanguage);
    const trCompatible = nativeTranslationCards(effective.sourceLanguage, effective.targetLanguage, catalog)
      .some((c) => c.selectId === effective.translationModel);
    const models = requiredNativeModels(
      effective.asrModel, effective.translationModel, effective.ttsModel,
      effective.sourceLanguage, effective.targetLanguage, catalog, opts.textOnly);
    // SECOND refresh: the selected models' chosen variant repos (pin ?? recommended).
    const resolved = deriveVariantRepos(asCards([effective.asrModel, effective.translationModel]), pins);
    const statusRepos = Object.keys(resolved).length > 0 ? resolved : undefined;
    await get().refresh(models, statusRepos);
    const ready = asrCompatible && trCompatible && get().isReady(models);
    const reason: NativeReadinessReason = ready ? 'ready'
      : !asrCompatible ? 'asr-incompatible'
      : !trCompatible ? 'translation-incompatible'
      : 'models-missing';
    return { ready, reason, corrections: corrections ?? null };
  },
```

- [ ] **Step 4: Add facade tests (real store + FakeWS) — the re-homed coverage.**

Add to `nativeModelStore.test.ts`. The file already forces `isElectron()===true`, seeds the catalog through `FakeWS`, and captures the last `model_status` repos in `globalThis.__lastStatusRepos`. Use `useNativeModelStore.setState(...)` to force lifecycle/state where needed. Write these cases (each names the reason it pins):

```ts
describe('ensureSelectionReady (facade)', () => {
  const SEL = {
    sourceLanguage: 'zh', targetLanguage: 'en',
    asrModel: 'sense-voice', translationModel: 'qwen2.5-0.5b', ttsModel: '',
    translationVariantByModel: {} as Record<string, string>,
  };

  it('unavailable sidecar → not ready, reason unavailable, no corrections', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable' });
    // ensureCatalog will try to (re)load; make the catalog fetch reject so it stays unavailable.
    mockModelsCatalogReject();
    const r = await useNativeModelStore.getState().ensureSelectionReady(SEL, { textOnly: false });
    expect(r).toEqual({ ready: false, reason: 'unavailable', corrections: null });
  });

  it('bundle absent → reason engine-absent', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable', bundleStatus: 'absent' });
    mockModelsCatalogReject();
    const r = await useNativeModelStore.getState().ensureSelectionReady(SEL, { textOnly: false });
    expect(r.reason).toBe('engine-absent');
  });

  it('bundle mismatch → reason engine-mismatch', async () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable', bundleStatus: 'mismatch' });
    mockModelsCatalogReject();
    const r = await useNativeModelStore.getState().ensureSelectionReady(SEL, { textOnly: false });
    expect(r.reason).toBe('engine-mismatch');
  });

  it('ready + downloaded compatible pair → ready', async () => {
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog(); // status → ready, catalog seeded
    const r = await useNativeModelStore.getState().ensureSelectionReady(SEL, { textOnly: false });
    // FakeWS reports every queried model 'ready', and the fixture qwen is multi/compatible.
    expect(r.ready).toBe(true);
    expect(r.reason).toBe('ready');
  });

  it('stale translation for the reversed pair → not ready, reason translation-incompatible', async () => {
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog();
    const r = await useNativeModelStore.getState().ensureSelectionReady(
      { ...SEL, sourceLanguage: 'en', targetLanguage: 'zh', translationModel: 'opus-mt-zh-en' },
      { textOnly: false });
    // opus-mt-zh-en is not a card for en→zh → incompatible even though "downloaded".
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('translation-incompatible');
  });

  it('resolves the selected model chosen variant repo on the required-models refresh', async () => {
    // Seed a multi-variant translate card into the FakeWS catalog for this test,
    // then assert the LAST model_status carried its recommended repo.
    // (Mirror the existing multi-variant fixtures at the top of this file.)
    mockModelsCatalogResolve();
    await useNativeModelStore.getState().ensureCatalog();
    const catalog = useNativeModelStore.getState().catalog;
    useNativeModelStore.setState({ catalog: { ...catalog, 'hy-mt2-1.8b': {
      id: 'hy-mt2-1.8b', name: 'HY', kind: 'translate', languages: ['multi'], recommended: false,
      tiers: [], order: 9, repo: '', variantIds: ['q4_k_m', 'q8_0'],
      variants: [
        { id: 'fp8', sizeBytes: 8e9, repo: 'tencent/Hy-MT2-1.8B-FP8', supported: true, recommended: true },
        { id: 'bf16', sizeBytes: 15e9, repo: 'tencent/Hy-MT2-1.8B', supported: true, recommended: false },
      ],
    } } as any });
    await useNativeModelStore.getState().ensureSelectionReady(
      { ...SEL, translationModel: 'hy-mt2-1.8b' }, { textOnly: false });
    expect((globalThis as any).__lastStatusRepos).toMatchObject({ 'hy-mt2-1.8b': 'tencent/Hy-MT2-1.8B-FP8' });
  });
});
```

Note: the `not-electron` reason is covered by the Task-4 `msgForNativeReason` unit test (this file forces `isElectron()===true`, so it can't reach that branch cleanly).

- [ ] **Step 5: Run store tests.**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: PASS. If the "ready" fixture case reports not-ready, inspect what `requiredNativeModels`/`isReady` returned for the fixture and adjust the SEL/catalog to a genuinely-compatible-and-downloaded pair (do not change product code). If a `mockModelsCatalogReject`/`Resolve` toggle leaks across tests, reset it in the block's own `beforeEach` (mirror the file's existing reset at line ~72).

- [ ] **Step 6: Confirm the gate still passes (untouched).**

Run: `npx vitest run src/stores/settingsStore.nativeGate.test.ts`
Expected: PASS (unchanged — the gate is refactored in Task 4).

- [ ] **Step 7: Commit.**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts
git commit -m "feat(native): add nativeModelStore.ensureSelectionReady readiness facade + tests"
```

---

## Task 4: Shrink the gate + `msgForNativeReason`; restructure `nativeGate.test.ts`

Replace the 98-line LOCAL_NATIVE branch with the facade call, add the reason→message map, and thin the gate test to the wrapper contract (the variant/refresh/lifecycle assertions now live in Task 3's facade tests).

**Files:**
- Modify: `src/stores/settingsStore.ts` (add `msgForNativeReason`; replace `validateApiKey` LOCAL_NATIVE branch lines 839–937)
- Modify: `src/stores/settingsStore.nativeGate.test.ts` (restructure to wrapper form; keep the Task-1 frozen message assertions)

**Interfaces:**
- Consumes: `nativeModelStore.ensureSelectionReady` (Task 3); `NativeReadinessReason` type.
- Produces: `msgForNativeReason(reason: NativeReadinessReason): string` (module-private in settingsStore.ts).

- [ ] **Step 1: Add the reason→message helper.**

Near the top of `settingsStore.ts` (after the imports; it uses the already-imported `i18n`), add — importing the type from nativeCatalog:

```ts
import type { NativeReadinessReason } from '../lib/local-inference/native/nativeCatalog';

/** Map a native readiness reason to its user-facing message. Verbatim port of
 * the messages the inline LOCAL_NATIVE gate produced. */
function msgForNativeReason(reason: NativeReadinessReason): string {
  switch (reason) {
    case 'ready': return '';
    case 'not-electron': return 'Native sidecar unavailable (desktop app + installed sidecar required)';
    case 'engine-mismatch': return i18n.t('settings.localNativeEngineUpdateRequired', 'The inference engine needs an update — open provider settings to update it');
    case 'engine-absent': return i18n.t('settings.localNativeEngineRequired', 'Download the inference engine in provider settings');
    case 'unavailable': return i18n.t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings');
    case 'starting': return i18n.t('settings.localNativeStarting', 'Starting the local engine…');
    case 'asr-incompatible': return i18n.t('settings.localNativeAsrIncompatible', 'Select a speech-recognition model for the source language');
    case 'translation-incompatible': return i18n.t('settings.localNativeTranslationIncompatible', 'Select a translation model for this language pair');
    case 'models-missing': return i18n.t('settings.localNativeModelsRequired', 'Download the native models in settings');
  }
}
```

- [ ] **Step 2: Replace the LOCAL_NATIVE branch (settingsStore.ts:839-937) with the delegation.**

```ts
      if (provider === Provider.LOCAL_NATIVE) {
        const { useNativeModelStore } = await import('./nativeModelStore');
        const { ready, reason, corrections } = await useNativeModelStore.getState()
          .ensureSelectionReady(get().localNative, { textOnly: get().textOnly });
        if (corrections) get().updateLocalNative(corrections);
        const message = msgForNativeReason(reason);
        set({
          isApiKeyValid: ready,
          availableModels: ready ? [{ id: 'native-asr-translate', type: 'realtime' as const, created: 0 }] : [],
          validationMessage: message, isValidating: false,
        });
        return { valid: ready, message, validating: false };
      }
```

(`get().localNative` is a `LocalNativeSettings`, structurally assignable to `NativeReadinessSelection`.) Remove the now-unused imports from `settingsStore.ts` if the gate was their only user (check `nativeAsrCards`, `nativeTranslationCards`, `nativeTtsCards`, `requiredNativeModels`, `supportsLanguage`, `statusReposFor`, `nativeListVariants` — remove any that are no longer referenced anywhere in the file; keep those still used by other code paths). Let the TS build flag unused imports.

- [ ] **Step 3: Add the `msgForNativeReason` unit test (pins ALL 9 reason strings).**

Add to `nativeGate.test.ts` (or a small sibling — keep it in `nativeGate.test.ts`). Import the helper is not possible (module-private), so assert through the wrapper in Step 4 for each reason. Instead, add a table test that drives the wrapper with a mocked facade (Step 4 sets that up). Fold the all-reasons assertion into Step 4.

- [ ] **Step 4: Restructure `nativeGate.test.ts` to the wrapper-contract form.**

Replace the whole-store mock (lines 48–60) so `getState()` also exposes a controllable `ensureSelectionReady`, and drop the now-unneeded internal stubs' assertions. Keep `updateLocalNative` real (it persists via the mocked ServiceFactory).

```ts
const mockEnsureSelectionReady = vi.fn();
vi.mock('./nativeModelStore', () => ({
  useNativeModelStore: {
    getState: () => ({
      ensureSelectionReady: (...a: unknown[]) => mockEnsureSelectionReady(...a),
    }),
  },
}));
```

Replace the variant/refresh/lifecycle describe blocks (which asserted internal `mockRefresh`/`reposArg` calls — now covered by Task 3's facade tests) with wrapper-contract tests. KEEP the Task-1 frozen message assertions, now driven by the mocked facade returning the matching reason:

```ts
const REASON_MESSAGE: Record<string, string> = {
  'ready': '',
  'not-electron': 'Native sidecar unavailable (desktop app + installed sidecar required)',
  'engine-mismatch': 'The inference engine needs an update — open provider settings to update it',
  'engine-absent': 'Download the inference engine in provider settings',
  'unavailable': 'Native engine unavailable — retry in settings',
  'starting': 'Starting the local engine…',
  'asr-incompatible': 'Select a speech-recognition model for the source language',
  'translation-incompatible': 'Select a translation model for this language pair',
  'models-missing': 'Download the native models in settings',
};

describe('LOCAL_NATIVE gate delegates to ensureSelectionReady', () => {
  beforeEach(() => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE } as any);
    mockEnsureSelectionReady.mockReset();
  });

  it('sets valid + empty message + availableModels when ready', async () => {
    mockEnsureSelectionReady.mockResolvedValue({ ready: true, reason: 'ready', corrections: null });
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r).toEqual({ valid: true, message: '', validating: false });
    expect(useSettingsStore.getState().isApiKeyValid).toBe(true);
    expect(useSettingsStore.getState().availableModels).toEqual([{ id: 'native-asr-translate', type: 'realtime', created: 0 }]);
  });

  it('applies corrections to localNative', async () => {
    mockEnsureSelectionReady.mockResolvedValue({ ready: true, reason: 'ready', corrections: { translationModel: 'opus-mt-zh-en' } });
    await useSettingsStore.getState().validateApiKey();
    expect(useSettingsStore.getState().localNative.translationModel).toBe('opus-mt-zh-en');
  });

  it('does not touch localNative when corrections is null', async () => {
    const before = useSettingsStore.getState().localNative.translationModel;
    mockEnsureSelectionReady.mockResolvedValue({ ready: false, reason: 'models-missing', corrections: null });
    await useSettingsStore.getState().validateApiKey();
    expect(useSettingsStore.getState().localNative.translationModel).toBe(before);
  });

  for (const [reason, expected] of Object.entries(REASON_MESSAGE)) {
    it(`maps reason "${reason}" to its frozen message`, async () => {
      mockEnsureSelectionReady.mockResolvedValue({ ready: reason === 'ready', reason, corrections: null });
      const r = await useSettingsStore.getState().validateApiKey();
      expect(r.message).toBe(expected);
      expect(useSettingsStore.getState().validationMessage).toBe(expected);
      expect(useSettingsStore.getState().isApiKeyValid).toBe(reason === 'ready');
    });
  }
});
```

Delete the old variant-aware/lifecycle/translation-incompat describe blocks and the Task-1 `validationMessage is frozen per scenario` block (its intent is now the `REASON_MESSAGE` table above), and the now-unused mock scaffolding (`mockRefresh`, `mockIsReady`, `mockListVariants`, `mockEnsureCatalog`, `mockAutoSelect`, `mockSidecarStatus`, `mockCatalog`, `mockNativeSidecar`, `reposArg`, `setNative`, VARIANTS/DEFAULT_CATALOG fixtures) if nothing else references them. If the test-env i18n resolved any string differently in Task 1, use that same resolved value in `REASON_MESSAGE` (keep OLD==NEW).

- [ ] **Step 5: Run the affected tests.**

Run: `npx vitest run src/stores/settingsStore.nativeGate.test.ts src/stores/nativeModelStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.nativeGate.test.ts
git commit -m "refactor(native): gate delegates to ensureSelectionReady facade; reason→message map"
```

---

## Task 5: Full-suite + related-gate verification

**Files:** none (verification only).

- [ ] **Step 1: Run the native + settings + gate suites.**

Run: `npx vitest run src/stores/ src/services/providers/localNativeGating.test.ts src/services/clients/ClientFactory.localnative.test.ts src/services/clients/LocalNativeClient.test.ts`
Expected: PASS. In particular `settingsStore.native-gate.test.ts` and `localNativeGating.test.ts` (which also drive the LOCAL_NATIVE gate) must stay green — if either asserted an internal call the gate no longer makes directly, migrate that assertion to the facade tests (do not weaken it).

- [ ] **Step 2: Run the whole suite.**

Run: `npx vitest run`
Expected: PASS (no regressions outside the native surface).

- [ ] **Step 3: Verify the gate shrank and reads symmetrically.**

Run: `git diff --stat main -- src/stores/settingsStore.ts`
Expected: the LOCAL_NATIVE branch is now ~10 lines and structurally parallel to the LOCAL_INFERENCE branch below it. Eyeball both branches for symmetry.

- [ ] **Step 4: Commit any verification-driven fixes** (only if Step 1 required migrating an assertion).

```bash
git add -A && git commit -m "test(native): migrate remaining gate assertions to the facade"
```
