# MainPanel Seams S4 — prepareToStart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The async pre-start seam: `prepareToStart?` on the descriptor (full spec-shaped contract), the `revalidate` port bound to settingsStore's `validateApiKey`, the public `updateProviderSlice` store action, and the generic `initPhase` label mechanism — deleting MainPanel's `LOCAL_INFERENCE || LOCAL_NATIVE` revalidation branch and the two dedicated label states.

**Architecture:** Stage S4 of the spec — first stage touching `connectConversation`. The revalidation block sits FIRST in the connect sequence (before the no-channel guard); its replacement is a generic step at exactly that position. `validateApiKey` stays the readiness authority (store-side, with its `isApiKeyValid` write that closes the Start gate and drives the subtitle window's `blocked` state) — the descriptor reaches it only through `PreparePorts.revalidate`, because settingsStore imports every descriptor and the reverse edge is a cycle. Patch application (`sessionPatch`/`settingsPatch`/two-phase guard) is S5; S4 defines the full outcome type and handles ok/false/rejection/signal.

**Tech Stack:** TypeScript, React, zustand, vitest 4, i18next.

## Global Constraints

- Repo/worktree: `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/soniox-tts-v2`, branch `refactor/mainpanel-provider-seams` (S1-S3 complete, HEAD ≈ `1f954a88`).
- **Zero behavior change**, with TWO sanctioned deltas, both documented in Task 5: (a) the advanced footer gains the 'Loading model…' rung the simple footer already had (native ASR load — today advanced shows the generic 'Initializing...'); (b) none other.
- The failure path's THREE surfaces are preserved exactly: `session.init_error` realtime event + system error conversation item + the store-side `isApiKeyValid:false` (written by validateApiKey itself) that flips the subtitle window to `blocked`. The in-block comments explaining this move with the code.
- Descriptors never import settingsStore. Local descriptors MAY import `i18n` from `'../../locales'` (established services-layer precedent) for their own fallback message.
- Full suite green every task end; `npx vite build` green at Tasks 4-6. Locate edits by grepped identifiers. Commit per task; do not push. Sweeps: generic `Provider\.[A-Z_]+`.

---

### Task 1: Public `updateProviderSlice` store action + round-trip tests

**Files:**
- Modify: `src/stores/settingsStore.ts` (interface declaration + one-line action)
- Test: `src/stores/settingsStore.test.ts` (new describe)

**Interfaces:**
- Produces: `useSettingsStore.getState().updateProviderSlice(sliceKey, patch)` — S5's settingsPatch applier. Signature: `updateProviderSlice: (sliceKey: string, patch: Record<string, unknown>) => Promise<void>` (matches the private helper's async shape). Unknown sliceKey REJECTS (throws) — never a silent no-op.

- [ ] **Step 1: Write the failing tests**

New describe in `settingsStore.test.ts` (match the file's construct/reset style — copy its beforeEach pattern):

```ts
describe('updateProviderSlice (public generic action)', () => {
  it('merges a patch into the named slice', async () => {
    await useSettingsStore.getState().updateProviderSlice('soniox', { targetLanguage: 'ja' });
    expect((useSettingsStore.getState().soniox as { targetLanguage: string }).targetLanguage).toBe('ja');
  });

  it('does not bleed into other slices or drop unpatched fields', async () => {
    const geminiBefore = useSettingsStore.getState().gemini;
    const sourceBefore = (useSettingsStore.getState().soniox as { sourceLanguage: string }).sourceLanguage;
    await useSettingsStore.getState().updateProviderSlice('soniox', { targetLanguage: 'ko' });
    expect(useSettingsStore.getState().gemini).toBe(geminiBefore);
    expect((useSettingsStore.getState().soniox as { sourceLanguage: string }).sourceLanguage).toBe(sourceBefore);
  });

  it('applies the same registry transform the named action applies', async () => {
    // The openai row's transformPatch forces turnDetectionMode 'Disabled' when
    // transportType flips to webrtc — the generic path must run it too, or the
    // two write paths diverge on the same slice.
    await useSettingsStore.getState().updateProviderSlice('openai', { transportType: 'webrtc' });
    expect((useSettingsStore.getState().openai as { turnDetectionMode: string }).turnDetectionMode).toBe('Disabled');
  });

  it('rejects an unknown slice key', async () => {
    await expect(
      useSettingsStore.getState().updateProviderSlice('not-a-slice', { x: 1 })
    ).rejects.toThrow();
  });

  it('behaves identically to the named per-provider action', async () => {
    await useSettingsStore.getState().updateProviderSlice('soniox', { voice: 'Daniel' });
    const viaGeneric = useSettingsStore.getState().soniox;
    await useSettingsStore.getState().updateSoniox({ voice: 'Daniel' });
    expect(useSettingsStore.getState().soniox).toEqual(viaGeneric);
  });
});
```

Run: FAIL (action missing). Adjust only mechanical details (reset helpers, persistence mocks) to the file's existing style — document any adjustment.

- [ ] **Step 2: Implement**

In the `SettingsStore` interface, under the `// Provider settings actions` block:

```ts
  /** Generic slice update keyed by descriptor.settingsSliceKey — the write
   *  half of the read path the reactive selectors already use. Same registry
   *  (transforms, persistence policy) as the named actions; throws on an
   *  unknown key. Consumed by MainPanel when applying a descriptor
   *  prepareToStart settingsPatch (S4/S5 seam). */
  updateProviderSlice: (sliceKey: string, patch: Record<string, unknown>) => Promise<void>;
```

In the actions block (beside `updateOpenAI` etc.):

```ts
    updateProviderSlice: (sliceKey, patch) => {
      if (!(sliceKey in PROVIDER_SLICE_REGISTRY)) {
        return Promise.reject(new Error(`updateProviderSlice: unknown slice key '${sliceKey}'`));
      }
      return updateProviderSlice(set, sliceKey as ProviderSliceKey, patch);
    },
```

(If the private helper's name collides with the property in scope, alias the import/reference — e.g. rename nothing, the property shorthand differs from the module function by qualification; verify it compiles, adjust with a local `const applySlicePatch = updateProviderSlice` alias above the create() call if needed.)

- [ ] **Step 3: Run** the new describe then the full suite → green.

- [ ] **Step 4: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/settingsStore.test.ts
git commit -m "feat(store): expose updateProviderSlice as a public generic action

The write half of the read path the descriptor-keyed selectors already
use — same registry, transforms and persistence policy as the named
actions; unknown keys reject. Consumer: the prepareToStart settingsPatch
applier (S4/S5 seam)."
```

---

### Task 2: The `prepareToStart` contract on ProviderDescriptor

**Files:**
- Modify: `src/services/providers/ProviderDescriptor.ts`
- Test: `src/services/providers/descriptorRegistry.test.ts`

**Interfaces:**
- Produces (verbatim — S5 builds on every field):

```ts
export type PrepareOutcome =
  | {
      ok: true;
      /** Merged into the built session config just before connect (S5). */
      sessionPatch?: Record<string, unknown>;
      /** Applied via settingsStore.updateProviderSlice (S5). */
      settingsPatch?: Record<string, unknown>;
      /** Two-phase stale-selection guard (S5): `expect` is checked against the
       *  slice when the hook returns — on mismatch ALL outcome parts are
       *  discarded and Start proceeds unmodified. `expectAtApply` is re-checked
       *  immediately before merging sessionPatch — on mismatch the patch is
       *  dropped and the notice suppressed, Start proceeds. */
      expect?: Record<string, unknown>;
      expectAtApply?: Record<string, unknown>;
      /** i18n key for a user-facing notice (S5). */
      noticeKey?: string;
    }
  | { ok: false; /** Display-ready text; blocks Start. */ message: string };

export interface PreparePorts {
  getAuthToken: () => Promise<string | null>;
  userId: string | null;
  /** Re-runs provider validation via the STORE action (validateApiKey) and
   *  reports the outcome. Exists because the revalidation authority IS
   *  settingsStore.validateApiKey — a store action with slice-writing side
   *  effects (isApiKeyValid drives the Start gate and the subtitle window's
   *  blocked state) that a descriptor must not import: settingsStore imports
   *  every descriptor, and the reverse edge is a cycle. MainPanel binds it. */
  revalidate: () => Promise<{ valid: boolean; message?: string }>;
  /** Reports a user-visible preparation phase; MainPanel renders it through
   *  the generic init label. */
  onPhase: (phase: InitPhase) => void;
  /** Start cancellation. No caller aborts today — MainPanel supplies a live
   *  controller per Start and S6's abort path is the intended aborter; a hook
   *  must still honor it (result discarded silently once fired). */
  signal: AbortSignal;
}

/** Semantic preparation/loading phases the init button can display. Sites map
 *  phase → their own i18n key. */
export type InitPhase =
  | { phase: 'loading-models'; completed: number; total: number }
  | { phase: 'loading-native-asr' };
```

and on the interface (OPTIONAL — no base implementation; absence means "nothing to prepare"):

```ts
  /**
   * Optional async pre-start hook, awaited by MainPanel FIRST in the connect
   * sequence (before the no-channel guard, any audio init, any client).
   * ok:false blocks Start with the display-ready message; a REJECTED promise
   * is treated as ok:false with a generic message (MainPanel catches and
   * logs); once ports.signal fires the result is discarded silently.
   */
  prepareToStart?(slice: unknown, ports: PreparePorts): Promise<PrepareOutcome>;
```

- [ ] **Step 1: Failing registry test**

```ts
describe('S4 prepareToStart', () => {
  it('is declared only where a provider has pre-start work (locals, later kizuna-soniox)', () => {
    const WITH_HOOK = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE];
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(typeof d.prepareToStart === 'function', `hook presence for ${id}`)
        .toBe(WITH_HOOK.includes(id));
    }
  });
});
```

Run: FAIL (locals lack the hook — added in Task 3; the test lands here so Task 3's TDD has its red).

- [ ] **Step 2: Add the types + optional method** (verbatim above). The registry test STAYS red for the locals until Task 3 — run the rest of the suite to confirm nothing else broke, and commit with the test marked `it.fails` → NO. House style: land the test in Task 3 instead if a red commit is unacceptable. DECISION: move Step 1's test INTO Task 3's TDD (this task commits types only, suite fully green). Adjust: this task = types + optional method + a minimal presence test asserting NO descriptor declares the hook yet:

```ts
describe('S4 prepareToStart', () => {
  it('no descriptor declares the hook yet (locals arrive with their migration)', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      expect(ProviderConfigFactory.getDescriptor(id).prepareToStart, `${id}`).toBeUndefined();
    }
  });
});
```

(Task 3 rewrites this test into the WITH_HOOK form — that rewrite IS its red step.)

- [ ] **Step 3: Run** registry + full suite → green.

- [ ] **Step 4: Commit**

```bash
git add src/services/providers/ProviderDescriptor.ts src/services/providers/descriptorRegistry.test.ts
git commit -m "feat(providers): the prepareToStart contract — outcome, ports, phases

Optional async pre-start hook with the full S4/S5 shape: display-ready
failure, patch envelope with the two-phase stale-selection guard
(applied from S5), the revalidate port that keeps validateApiKey as the
store-side readiness authority, and a signal no caller aborts yet."
```

---

### Task 3: Local descriptors' `prepareToStart`

**Files:**
- Modify: `src/services/providers/LocalInferenceProviderConfig.ts`, `LocalNativeProviderConfig.ts`
- Modify: `src/services/providers/descriptorRegistry.test.ts` (rewrite the presence test — the red step)
- Test: `src/services/providers/prepareToStart.local.test.ts` (new)

- [ ] **Step 1: Red** — rewrite the registry presence test to the WITH_HOOK form (Task 2 Step 1's code). Run: FAIL.

- [ ] **Step 2: Write the failing unit tests**

`prepareToStart.local.test.ts` (environment vi.mock preamble as in speechMode.test.ts):

```ts
describe('local prepareToStart', () => {
  const ports = (revalidateResult: { valid: boolean; message?: string }) => ({
    getAuthToken: async () => null,
    userId: null,
    revalidate: vi.fn().mockResolvedValue(revalidateResult),
    onPhase: vi.fn(),
    signal: new AbortController().signal,
  });

  for (const id of [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE]) {
    it(`${id}: valid revalidation → bare ok`, async () => {
      const d = ProviderConfigFactory.getDescriptor(id);
      const p = ports({ valid: true });
      await expect(d.prepareToStart!({}, p)).resolves.toEqual({ ok: true });
      expect(p.revalidate).toHaveBeenCalledTimes(1);
    });

    it(`${id}: invalid revalidation passes the store's message through verbatim`, async () => {
      const d = ProviderConfigFactory.getDescriptor(id);
      const out = await d.prepareToStart!({}, ports({ valid: false, message: 'no ASR model for ja' }));
      expect(out).toEqual({ ok: false, message: 'no ASR model for ja' });
    });

    it(`${id}: invalid with an empty message falls back to the provider's own default`, async () => {
      const d = ProviderConfigFactory.getDescriptor(id);
      const out = await d.prepareToStart!({}, ports({ valid: false, message: '' }));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.message).toBe('Required models not available for selected language pair.');
    });
  }
});
```

(The default string is `settings.localInferenceModelsRequired`'s en value — the SAME fallback MainPanel applies today; it moves into the providers.)

- [ ] **Step 3: Implement (identical body in both files)**

```ts
  /** Pre-start model-readiness revalidation. validateApiKey is the single
   *  authority for session readiness — auto-select, model readiness, key
   *  validation — and it must run as the STORE action (its isApiKeyValid
   *  write is what closes the Start gate and flips the subtitle window to
   *  'blocked' on failure), so it arrives here through ports.revalidate. */
  async prepareToStart(_slice: unknown, ports: PreparePorts): Promise<PrepareOutcome> {
    const result = await ports.revalidate();
    if (result.valid) return { ok: true };
    return {
      ok: false,
      message: result.message
        || i18n.t('settings.localInferenceModelsRequired', 'Required models not available for selected language pair.'),
    };
  }
```

Imports per file: `PreparePorts, PrepareOutcome` from `'./ProviderDescriptor'`; `i18n` from `'../../locales'` (services-layer precedent: settingsStore's msgForNativeReason, SonioxClient).

- [ ] **Step 4: Run** the new file + registry + full suite → green.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/LocalInferenceProviderConfig.ts src/services/providers/LocalNativeProviderConfig.ts src/services/providers/prepareToStart.local.test.ts src/services/providers/descriptorRegistry.test.ts
git commit -m "feat(providers): local descriptors revalidate through prepareToStart

The store-side validateApiKey stays the readiness authority (its
isApiKeyValid write drives the Start gate and the subtitle blocked
state); the descriptors reach it through the port and own their
fallback message."
```

---

### Task 4: MainPanel — generic dispatch replaces the LOCAL_* branch

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Replace the revalidation block**

Locate the block (grep `Re-validate before starting session`). Replace the whole `if (provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE) { … }` with:

```ts
      // Providers with pre-start work declare prepareToStart; run it FIRST,
      // before the no-channel guard, any audio init, any client. For the
      // local providers this is the model-readiness revalidation — the
      // descriptor's hook calls back into settingsStore.validateApiKey via
      // the revalidate port, so the store keeps its isApiKeyValid write (the
      // Start gate closes and the subtitle window derives `blocked`, which
      // wins over `failed` and routes to the right settings section).
      const startDescriptor = ProviderConfigFactory.getDescriptor(provider);
      if (startDescriptor.prepareToStart) {
        // No aborter calls .abort() yet — S6's abort path is the intended
        // caller; the contract requires a live signal from day one.
        const prepareAbort = new AbortController();
        const prepareSlice = useSettingsStore.getState()[startDescriptor.settingsSliceKey as keyof SettingsStore];
        let prepared: PrepareOutcome;
        try {
          prepared = await startDescriptor.prepareToStart(prepareSlice, {
            getAuthToken,
            userId: userId ?? null,
            revalidate: () => useSettingsStore.getState().validateApiKey(),
            onPhase: (phase) => setInitPhase(phase),
            signal: prepareAbort.signal,
          });
        } catch (prepareError) {
          console.error('[Sokuji] [MainPanel] prepareToStart rejected:', prepareError);
          prepared = { ok: false, message: t('mainPanel.startPreparationFailed', 'Could not prepare the session. Please try again.') };
        }
        if (!prepared.ok) {
          setIsInitializing(false);
          addRealtimeEvent(
            { type: 'session.init_error', data: { message: prepared.message } },
            'client', 'session.init_error'
          );
          // Also surface this in the conversation items, not just the realtime
          // event log, which is unreachable from the subtitle bar — see the
          // equivalent append in the outer catch block below.
          setItems(prevItems => [...prevItems, {
            id: `error-${Date.now()}`,
            role: 'system',
            type: 'error',
            status: 'completed',
            createdAt: Date.now(),
            formatted: { text: prepared.message },
          }]);
          return;
        }
        // sessionPatch/settingsPatch/notice application lands with S5 — no
        // descriptor returns them yet.
      }
```

Notes for the implementer: `getAuthToken` and `userId` are already in scope in MainPanel (grep their current uses in the managed voice-prep block); `PrepareOutcome` type import from ProviderDescriptor; the subtitle-`blocked` comment content from the old block is preserved in the new lead comment (the old block's inline copy is deleted with it); dep array of connectConversation — add `t`, `userId`, `getAuthToken`, `setInitPhase` if not present (grep the array; `setInitPhase` arrives in Task 5 — for THIS task, wire `onPhase` as `() => {}` with a `// Task 5 wires the state` comment, then Task 5 replaces it; alternatively reorder Tasks 4↔5. DECISION: Task 5 runs FIRST if you hit this — but as planned, keep order and use the placeholder; it is replaced within the same stage).

New en locale key (`src/locales/en/translation.json`, inside the `mainPanel` object beside `"initializing"`): `"startPreparationFailed": "Could not prepare the session. Please try again."` (other locales fall back to the inline default).

- [ ] **Step 2: Gates**

`grep -n "LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE" src/components/MainPanel/MainPanel.tsx` → no hits (the revalidation was the last one).
`npx vitest run` all green; `npx vite build` success.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/locales/en/translation.json
git commit -m "refactor(mainpanel): pre-start preparation dispatches through the descriptor

The LOCAL_* revalidation branch becomes the generic prepareToStart step
at the same position (first, before the no-channel guard), preserving
all three failure surfaces: the init_error event, the system
conversation item, and the store-side isApiKeyValid write that flips
the subtitle window to blocked. Rejected hooks block Start with a
generic message."
```

---

### Task 5: Generic `initPhase` label; the two dedicated states retire

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Add the state + maps, migrate the setters**

- Add `const [initPhase, setInitPhase] = useState<InitPhase | null>(null);` beside the old `initProgress` declaration; import `InitPhase` type.
- Grep every `setInitProgress` call: entry reset (`setInitProgress(null)` in connectConversation step 2) and the `local.init.*` event handler writes (`{completed, total}`) → replace with `setInitPhase(null)` / `setInitPhase({ phase: 'loading-models', completed, total })`.
- Grep every `nativeAsrLoading` setter (nativeModelStore-driven) → `setInitPhase({ phase: 'loading-native-asr' })` on load-start, `setInitPhase(null)` on load-end (verify the current true/false sites map 1:1).
- Delete the `initProgress` and `nativeAsrLoading` state declarations once no reader remains.
- Replace Task 4's `onPhase` placeholder with `(phase) => setInitPhase(phase)`.

- [ ] **Step 2: Re-rung both ladders**

Add one label helper above the component (module scope, beside the other helpers):

```ts
/** The generic init-phase label. Both footers map the semantic phase to their
 *  own i18n key; 'loading-native-asr' reuses the simple footer's key in both
 *  (already translated across locales). SANCTIONED DELTA vs the old ladders:
 *  the advanced footer used to lack the native-ASR rung and showed the
 *  generic 'Initializing...' during a sidecar model load — it now shows
 *  'Loading model…' like the simple footer always did. */
function initPhaseLabel(t: TFunction, phase: InitPhase, site: 'simple' | 'advanced'): string {
  switch (phase.phase) {
    case 'loading-models':
      return site === 'simple'
        ? t('simplePanel.initProgress', 'Loading ({{completed}}/{{total}})...', { completed: phase.completed, total: phase.total })
        : t('mainPanel.initProgress', 'Loading ({{completed}}/{{total}})...', { completed: phase.completed, total: phase.total });
    case 'loading-native-asr':
      return t('simplePanel.loadingModel', 'Loading model…');
  }
}
```

Simple footer ladder becomes:
```tsx
                      {voicePreparing
                        ? t('simplePanel.preparingVoice', 'Preparing your voice…')
                        : initPhase
                          ? initPhaseLabel(t, initPhase, 'simple')
                          : t('simplePanel.connecting', 'Connecting...')}
```
Advanced footer ladder becomes:
```tsx
                      {voicePreparing
                        ? t('mainPanel.preparingVoice', 'Preparing your voice…')
                        : initPhase
                          ? initPhaseLabel(t, initPhase, 'advanced')
                          : t('mainPanel.initializing')}
```
(`voicePreparing` stays — it is S5's rung to migrate.) Check the `TFunction` type import from i18next (or type `t` structurally as `(k: string, d?: string, o?: object) => string` matching the file's use).

- [ ] **Step 3: Gates**

`grep -n "initProgress\|nativeAsrLoading" src/components/MainPanel/MainPanel.tsx` → no hits.
`npx vitest run` all green; `npx vite build` success.

- [ ] **Step 4: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): one generic init-phase label replaces the per-state rungs

initProgress and nativeAsrLoading collapse into a semantic InitPhase the
prepareToStart port also feeds. Sanctioned delta: the advanced footer
gains the native-ASR 'Loading model…' rung the simple footer always had."
```

---

### Task 6: Stage close-out

- [ ] **Step 1: Sweep + gates**

- `grep -nE "Provider\.[A-Z_]+" src/components/MainPanel/MainPanel.tsx` — classify every hit in the report. Expected residue: 8 analytics `provider || Provider.OPENAI` fallbacks (S8), 3 kizuna-soniox lease/voice-prep/budget gates (S5/S6), comments. The LOCAL_* revalidation hit must be GONE. Any local-revalidation or prepare-related hit = BLOCKED.
- `npx vitest run` all green; `npx vite build` success.

- [ ] **Step 2: Spec correction check**

If implementation deviated from the spec's S4 text (PreparePorts shape, onPhase typing as structured InitPhase rather than a bare phaseKey string — IT DID: the spec sketched `onPhase(phaseKey: string)`, the landed contract carries params), append one correction line to the spec's `prepareToStart` section recording the landed `InitPhase` union and why (the loading-models label interpolates counts, which a bare key cannot carry). Commit with the sweep.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md
git commit -m "docs(specs): record the landed InitPhase shape

onPhase carries a structured phase, not a bare key — the loading-models
label interpolates completed/total counts."
```

---

## Self-review notes (already applied)

- **Spec coverage**: prepareToStart contract ✓ (T2, full envelope), revalidate port ✓ (T2/T3/T4), local migration ✓ (T3/T4), updateProviderSlice ✓ (T1), generic init label introduced in S4 ✓ (T5), error paths normative ✓ (T4: rejection→generic message; signal→discard with no live aborter, documented). Patch application explicitly deferred to S5 with the type landed now.
- **Ordering hazard handled**: T4 references setInitPhase before T5 creates it — the plan mandates a placeholder `onPhase: () => {}` in T4, replaced in T5 (same stage).
- **Type consistency**: `PrepareOutcome`/`PreparePorts`/`InitPhase` defined once (T2), consumed with identical shapes in T3/T4/T5.
