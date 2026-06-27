# Native Per-Card Quant Variant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the translation variant dropdown a per-card download choice (which quant to download), decoupled from active-model selection, with variant-aware download status.

**Architecture:** Replace the single `translationVariant` setting with a per-model map `translationVariantByModel`; the variant pick writes only the map (no model switch, so auto-select never fires); download status becomes variant-aware via a `repo` override on `model_status`.

**Tech Stack:** TypeScript (renderer: Zustand store, React, vitest), Python (sidecar: pytest).

## Global Constraints

- Settings field: `translationVariant?: string` → `translationVariantByModel: Record<string, string>` (per model id, global across directions; default `{}`; no entry → recommended). **No migration.**
- The variant pick writes ONLY `translationVariantByModel` — never `translationModel`, never `rememberModels`, never `setAutoSelectedStages`.
- The session-config (`IClient`) field `translationVariant` STAYS; `createLocalNativeSessionConfig` derives it as `translationVariantByModel[translationModel]` (the active model's quant = the load `select_variant` pin).
- Status is variant-aware: a card is "downloaded" ⟺ its chosen variant's repo is cached. `model_status(model_id, repo=None)` mirrors `download_specs(model_id, repo)`; the request carries an optional `repos` map (absent → default repo, fully backward-compatible).
- Out of scope: the `autoSelectNative` "not-downloaded manual selection reverts" bug.
- Renderer tests: `npx vitest run <file>`. Sidecar tests: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest <paths> -v` (system Python; two `test_accel.py` gating tests fail pre-existingly under transformers 4.53.2 — unrelated).

---

### Task 1: Sidecar — variant-aware `model_status`

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`model_status` + `_h_model_status`)
- Test: `sidecar/tests/test_native_models.py`

**Interfaces:**
- Produces: `model_status(model_id, repo=None)` — `repo` override checks the variant repo instead of the default; `_h_model_status` reads a `repos` map from the message (`{modelId: repoOverride}`), default `{}`.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_native_models.py`:

```python
def test_model_status_repo_override(monkeypatch):
    from sokuji_sidecar import native_models as nm
    seen = {}

    def fake_snapshot(repo_id, local_files_only):
        seen["repo"] = repo_id
        return "/cache"
    monkeypatch.setattr("huggingface_hub.snapshot_download", fake_snapshot)
    # no .incomplete files → ready; we only assert which repo was checked
    monkeypatch.setattr("glob.glob", lambda *a, **k: [])
    nm.model_status("hy-mt2-1.8b", repo="tencent/Hy-MT2-1.8B-FP8")
    assert seen["repo"] == "tencent/Hy-MT2-1.8B-FP8"   # the variant repo, not the bf16 default


def test_h_model_status_applies_repos_map(monkeypatch):
    import asyncio
    from sokuji_sidecar import native_models as nm
    calls = []
    monkeypatch.setattr(nm, "model_status",
                        lambda mid, repo=None: (calls.append((mid, repo)), "ready")[1])
    msg = {"id": 1, "models": ["hy-mt2-1.8b", "sense-voice"],
           "repos": {"hy-mt2-1.8b": "tencent/Hy-MT2-1.8B-FP8"}}
    reply, _ = asyncio.run(nm._h_model_status(None, msg, None))
    assert ("hy-mt2-1.8b", "tencent/Hy-MT2-1.8B-FP8") in calls
    assert ("sense-voice", None) in calls          # no override → default repo
    assert reply["statuses"] == {"hy-mt2-1.8b": "ready", "sense-voice": "ready"}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_native_models.py::test_model_status_repo_override tests/test_native_models.py::test_h_model_status_applies_repos_map -v`
Expected: FAIL — `model_status()` takes 1 positional arg / `_h_model_status` ignores `repos`.

- [ ] **Step 3: Add the `repo` param + repos map**

In `sidecar/sokuji_sidecar/native_models.py`, change the `model_status` signature line:

```python
def model_status(model_id, repo=None):
    """'ready' only if every repo + url is cached locally AND complete, else 'absent'.

    `repo` overrides the model's default repo with a chosen variant's repo (mirrors
    download_specs), so status reflects the variant the card actually downloads."""
    import glob
    from huggingface_hub import snapshot_download
    from huggingface_hub.constants import HF_HUB_CACHE
    specs = download_specs(model_id, repo)
```

(only the `def` line, docstring, and the `download_specs(model_id, repo)` call change — the loop body is unchanged.)

And change `_h_model_status`:

```python
async def _h_model_status(state, msg, _b, conn=None):
    repos = msg.get("repos") or {}
    statuses = {m: model_status(m, repos.get(m)) for m in (msg.get("models") or [])}
    return {"type": "model_status_result", "id": msg.get("id"), "statuses": statuses}, None
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_native_models.py::test_model_status_repo_override tests/test_native_models.py::test_h_model_status_applies_repos_map -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Regression run**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_native_models.py -q`
Expected: all pass (existing status tests still green — default-repo path unchanged).

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_native_models.py
git commit -m "feat(native): variant-aware model_status (repo override + repos map)"
```

---

### Task 2: Renderer — per-model variant map + decouple the pick (bug fix)

**Files:**
- Modify: `src/stores/settingsStore.ts` (field, default, `createLocalNativeSessionConfig`)
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx` (`handlePinVariant`, `pinnedVariantId`, `selectCard`)
- Test: `src/stores/settingsStore.translationVariant.test.ts`, `src/components/Settings/sections/NativeModelManagementSection.test.tsx`

**Interfaces:**
- Produces: `LocalNativeSettings.translationVariantByModel: Record<string, string>`; `createLocalNativeSessionConfig` forwards `translationVariantByModel[translationModel]` as the session-config `translationVariant`.

- [ ] **Step 1: Update the settings tests (RED)**

Replace the body of `src/stores/settingsStore.translationVariant.test.ts`'s three `it` blocks with:

```javascript
  it('is undefined (automatic) by default — empty per-model map', () => {
    expect(useSettingsStore.getState().localNative.translationVariantByModel).toEqual({});
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.translationVariant).toBeUndefined();
  });

  it('forwards the active model\'s chosen quant as config.translationVariant', async () => {
    await useSettingsStore.getState().updateLocalNative({
      translationModel: 'hy-mt2-7b', translationVariantByModel: { 'hy-mt2-7b': 'fp8' },
    });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.translationVariant).toBe('fp8');
  });

  it('a quant chosen for a NON-active model does not affect the active config', async () => {
    await useSettingsStore.getState().updateLocalNative({
      translationModel: 'qwen2.5-0.5b', translationVariantByModel: { 'hy-mt2-7b': 'fp8' },
    });
    const cfg = createLocalNativeSessionConfig(useSettingsStore.getState().localNative, '');
    expect(cfg.translationVariant).toBeUndefined();   // active model has no entry
  });
```

In `src/components/Settings/sections/NativeModelManagementSection.test.tsx`: add `translationVariantByModel: {}` to the `mockSettings` object, and change the pin test's assertion (line ~165) to:

```javascript
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ translationVariantByModel: { 'hy-mt2-7b': 'fp8' } }));
    // and it must NOT switch the active model
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ translationModel: expect.anything() }));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/stores/settingsStore.translationVariant.test.ts src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: FAIL — `translationVariantByModel` undefined; pin test still sees `translationModel` write.

- [ ] **Step 3: Swap the settings field + default + session config**

In `src/stores/settingsStore.ts`, replace the `translationVariant?: string;` field (and its comment) in `LocalNativeSettings`:

```typescript
  // Per-model chosen quant variant (e.g. { 'hy-mt2-1.8b': 'fp8' }). A model with no
  // entry uses the sidecar's recommended variant. Keyed by model id (global across
  // language directions); drives which repo the card downloads AND the load pin.
  translationVariantByModel: Record<string, string>;
```

In `defaultLocalNativeSettings`, add (e.g. after `ttsModel: ''`):

```typescript
  translationVariantByModel: {},
```

In `createLocalNativeSessionConfig`, change the `translationVariant` line:

```typescript
    translationVariant: settings.translationVariantByModel[settings.translationModel],
```

- [ ] **Step 4: Decouple the pick in the component**

In `src/components/Settings/sections/NativeModelManagementSection.tsx`:

Remove the stale-pin reset in `selectCard` (the `if (field === 'translationModel' …) { updates.translationVariant = undefined; }` block, ~lines 487-492) — the per-model map has no cross-model leak, so no reset is needed.

Replace `handlePinVariant` (~lines 502-511) with:

```typescript
  // Pick the download quant for a card — a per-model setting only. Does NOT change
  // the active translation model (so the auto-select reconcile never fires on a pick).
  const handlePinVariant = useCallback((selectId: string, variantId: string) => {
    update({ translationVariantByModel: { ...settings.translationVariantByModel, [selectId]: variantId } });
  }, [update, settings.translationVariantByModel]);
```

Replace the `pinnedVariantId` computation (~lines 534-535) with:

```typescript
          const pinnedVariantId = settings.translationVariantByModel[c.selectId];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/stores/settingsStore.translationVariant.test.ts src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck the changed files (no new errors)**

Run: `npx tsc --noEmit 2>&1 | grep -E "settingsStore.ts|NativeModelManagementSection.tsx" || echo "no new errors in changed files"`
Expected: `no new errors in changed files` (translationVariant references resolved to the new map).

- [ ] **Step 7: Commit**

```bash
git add src/stores/settingsStore.ts src/components/Settings/sections/NativeModelManagementSection.tsx src/stores/settingsStore.translationVariant.test.ts src/components/Settings/sections/NativeModelManagementSection.test.tsx
git commit -m "feat(native): per-model quant map; variant pick no longer switches the active model"
```

---

### Task 3: Renderer — wire variant-aware status

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (new pure helper `statusReposFor`)
- Modify: `src/lib/local-inference/native/NativeModelClient.ts` (`status(models, repos?)`)
- Modify: `src/stores/nativeModelStore.ts` (`refresh(models, repos?)` + interface)
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx` (compute + pass `statusRepos` to `refresh`)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Consumes: Task 1's sidecar `repos` map; Task 2's `translationVariantByModel`.
- Produces: `statusReposFor(ids, variantData, variantByModel): Record<string,string>`; `refresh(models, repos?)`; `client.status(models, repos?)`.

- [ ] **Step 1: Write the failing helper test**

Append to `src/lib/local-inference/native/nativeCatalog.test.ts`:

```javascript
  describe('statusReposFor', () => {
    const vd = {
      'hy-mt2-1.8b': { variants: [
        { id: 'bfloat16', repo: 'tencent/Hy-MT2-1.8B', computeType: 'bfloat16', sizeBytes: 0, supported: true, reason: '' },
        { id: 'fp8', repo: 'tencent/Hy-MT2-1.8B-FP8', computeType: 'fp8', sizeBytes: 0, supported: true, reason: '' },
      ], recommended: 'bfloat16' },
    };
    it('maps a card to its chosen variant repo (pinned)', () => {
      const repos = statusReposFor(['hy-mt2-1.8b', 'sense-voice'], vd, { 'hy-mt2-1.8b': 'fp8' });
      expect(repos).toEqual({ 'hy-mt2-1.8b': 'tencent/Hy-MT2-1.8B-FP8' });   // sense-voice has no variants → omitted
    });
    it('falls back to the recommended variant repo when unpinned', () => {
      const repos = statusReposFor(['hy-mt2-1.8b'], vd, {});
      expect(repos).toEqual({ 'hy-mt2-1.8b': 'tencent/Hy-MT2-1.8B' });
    });
  });
```

Add `statusReposFor` to the test's import line from `./nativeCatalog`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `statusReposFor` is not exported.

- [ ] **Step 3: Add the pure helper**

In `src/lib/local-inference/native/nativeCatalog.ts`, add (import `VariantInfo` from `./nativeProtocol` if not already):

```typescript
/**
 * The per-model status repo overrides: each card's CHOSEN variant repo (pinned,
 * else recommended). Cards without variant data are omitted → the sidecar checks
 * their default repo. Feeds the variant-aware model_status query.
 */
export function statusReposFor(
  ids: string[],
  variantData: Record<string, { variants: VariantInfo[]; recommended: string }>,
  variantByModel: Record<string, string>,
): Record<string, string> {
  const repos: Record<string, string> = {};
  for (const id of ids) {
    const vd = variantData[id];
    if (!vd) continue;
    const chosenId = variantByModel[id] ?? vd.recommended;
    const repo = vd.variants.find((v) => v.id === chosenId)?.repo;
    if (repo) repos[id] = repo;
  }
  return repos;
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread `repos` through client + store**

In `src/lib/local-inference/native/NativeModelClient.ts`, change `status`:

```typescript
  async status(models: string[], repos?: Record<string, string>): Promise<Record<string, NativeModelState>> {
    await this.connect();
    const msg = await this.send({ type: 'model_status', models, repos });
    return (msg as Extract<ServerMsg, { type: 'model_status_result' }>).statuses;
  }
```

In `src/stores/nativeModelStore.ts`, change the `refresh` interface declaration (line ~20):

```typescript
  refresh: (models: string[], repos?: Record<string, string>) => Promise<void>;
```

and the implementation (line ~93):

```typescript
  refresh: async (models, repos) => {
    if (!models.length) return;
    try {
      const result = await client.status(models, repos);
      set((s) => ({ statuses: { ...s.statuses, ...result } }));
    } catch {
      // sidecar not available — leave statuses untouched
    }
  },
```

- [ ] **Step 6: Compute and pass `statusRepos` in the component**

In `src/components/Settings/sections/NativeModelManagementSection.tsx`, import `statusReposFor` from `'../../../lib/local-inference/native/nativeCatalog'`, and after `allDownloadIds` is defined (~line 444), add:

```typescript
  const statusRepos = useMemo(
    () => statusReposFor(allDownloadIds, variantData, settings.translationVariantByModel),
    [allDownloadIds, variantData, settings.translationVariantByModel],
  );
```

Change the refresh effect (~lines 449-454) so it re-fetches status when the chosen variant changes:

```typescript
  useEffect(() => {
    refresh(allDownloadIds, statusRepos);
    refreshSizes(allDownloadIds);
    refreshCatalog();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [refreshKey, JSON.stringify(statusRepos)]);
```

- [ ] **Step 7: Run renderer suites to verify green**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: PASS (helper tests + existing component tests; the component now calls `refresh` with the repos map).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "nativeCatalog.ts|NativeModelClient.ts|nativeModelStore.ts|NativeModelManagementSection.tsx" || echo "no new errors in changed files"`
Expected: `no new errors in changed files`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts src/lib/local-inference/native/NativeModelClient.ts src/stores/nativeModelStore.ts src/components/Settings/sections/NativeModelManagementSection.tsx
git commit -m "feat(native): variant-aware download status (per-card chosen-variant repo)"
```

---

## Notes for the implementer

- **Two `translationVariant`s exist — don't conflate them.** `LocalNativeSettings.translationVariant` (settings) is REMOVED → the map. The `IClient` session-config `translationVariant` (the wire field, consumed by `LocalNativeClient.ts:59`) STAYS; `createLocalNativeSessionConfig` derives it from the map. Only the settings field changes.
- **`model_status` loop body is unchanged** in Task 1 — only the signature, docstring, and the `download_specs(model_id, repo)` call. Don't rewrite the `.incomplete` cache checks.
- **`VariantInfo`** is defined in `nativeProtocol.ts` (fields incl. `id`, `repo`, `computeType`, `sizeBytes`, `supported`, `reason`).
- The decouple (Task 2) is the user-visible bug fix on its own; Task 3 makes the downloaded-badge tell the truth about the chosen quant.

---

### Task 4: Make ALL status refreshes variant-aware (fix the readiness-gate Critical)

**Why:** Task 3 wired variant-aware status into only the management section's `refresh(..., statusRepos)`. But `statuses` is a shared map and two other callers refresh it variant-BLIND: the readiness gate (`settingsStore.ts:1295` → `refresh(models)` then `isReady`) and `ProviderSection.tsx`. So a downloaded non-default quant reads as `absent` at the gate → Start stays blocked, and badges flicker. Fix: cache the derived repos in the store so every `refresh(models)` caller is variant-aware automatically — no cross-store coupling.

**Files:**
- Modify: `src/stores/nativeModelStore.ts` (add `statusRepos` cache + `setStatusRepos`; `refresh` falls back to it)
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx` (push `statusRepos` to the store; fix the stale comment)
- Test: `src/stores/nativeModelStore.test.ts`

**Interfaces:**
- Produces: store `statusRepos: Record<string,string>` + `setStatusRepos(repos)`; `refresh(models, repos?)` uses `repos ?? get().statusRepos`.

- [ ] **Step 1: Write the failing store test**

In `src/stores/nativeModelStore.test.ts`, extend `FakeWS.send` to capture+answer `model_status` (add inside the `send` method, after the existing `model_delete` block):

```javascript
    if (msg.type === 'model_status') {
      (globalThis as any).__lastStatusRepos = msg.repos;
      queueMicrotask(() => this.emit({ type: 'model_status_result', id: msg.id,
        statuses: Object.fromEntries((msg.models || []).map((m: string) => [m, 'ready'])) }));
    }
```

Append a new describe block:

```javascript
describe('nativeModelStore.refresh — variant-aware via cached statusRepos', () => {
  it('falls back to the cached statusRepos when the caller passes none (gate path)', async () => {
    useNativeModelStore.getState().setStatusRepos({ 'hy-mt2-1.8b': 'tencent/Hy-MT2-1.8B-FP8' });
    await useNativeModelStore.getState().refresh(['hy-mt2-1.8b']);   // no repos arg — the gate's call shape
    expect((globalThis as any).__lastStatusRepos).toEqual({ 'hy-mt2-1.8b': 'tencent/Hy-MT2-1.8B-FP8' });
  });

  it('an explicit repos arg overrides the cache', async () => {
    useNativeModelStore.getState().setStatusRepos({ 'hy-mt2-1.8b': 'cached' });
    await useNativeModelStore.getState().refresh(['hy-mt2-1.8b'], { 'hy-mt2-1.8b': 'explicit' });
    expect((globalThis as any).__lastStatusRepos).toEqual({ 'hy-mt2-1.8b': 'explicit' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: FAIL — `setStatusRepos` is not a function.

- [ ] **Step 3: Add the cache + fallback in the store**

In `src/stores/nativeModelStore.ts`, add to the store interface (near `refresh:`):

```typescript
  statusRepos: Record<string, string>;
  setStatusRepos: (repos: Record<string, string>) => void;
```

Add to the store state (near `statuses: {}`):

```typescript
  statusRepos: {},
  setStatusRepos: (repos) => set({ statusRepos: repos }),
```

Change `refresh` to fall back to the cache:

```typescript
  refresh: async (models, repos) => {
    if (!models.length) return;
    try {
      const result = await client.status(models, repos ?? get().statusRepos);
      set((s) => ({ statuses: { ...s.statuses, ...result } }));
    } catch {
      // sidecar not available — leave statuses untouched
    }
  },
```

- [ ] **Step 4: Run the store test to verify it passes**

Run: `npx vitest run src/stores/nativeModelStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Push statusRepos to the store from the component + fix the stale comment**

In `src/components/Settings/sections/NativeModelManagementSection.tsx`:

Pull the action (near the other `useNativeModelStore((s) => …)` lines, ~387):

```typescript
  const setStatusRepos = useNativeModelStore((s) => s.setStatusRepos);
```

In the refresh effect (the one calling `refresh(allDownloadIds, statusRepos)`), publish the map to the store so the gate/ProviderSection refreshes see it — add as the FIRST line of the effect body:

```typescript
    setStatusRepos(statusRepos);
```

Replace the now-stale comment above the variant-map memo (the line referencing `settings.translationVariant` "scoped to the SELECTED translation model") with:

```typescript
  // The manual variant pin is a per-model map (settings.translationVariantByModel),
  // keyed by model id. Each card reads its own entry; download + load use the same value.
```

- [ ] **Step 6: Run renderer suites + scoped typecheck**

Run: `npx vitest run src/stores/nativeModelStore.test.ts src/components/Settings/sections/NativeModelManagementSection.test.tsx src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit 2>&1 | grep -E "nativeModelStore.ts|NativeModelManagementSection.tsx" | grep -v "onClearAll" || echo "no new errors in changed files"`
Expected: `no new errors in changed files`.

- [ ] **Step 7: Commit**

```bash
git add src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts src/components/Settings/sections/NativeModelManagementSection.tsx
git commit -m "fix(native): readiness gate honors the chosen quant (cached statusRepos)"
```

## Note on the residual auto-select bounce (final-review Important #2)

Re-picking the ACTIVE model's quant to an UNdownloaded variant now (correctly) flips its status to `absent`, which can trigger the `autoSelectNative` reconcile to switch the active model. This reduces to the explicitly out-of-scope "not-downloaded manual selection reverts" behavior and is NOT fixed here — the primary flow (pick a quant on a non-active card → download → select → Start) works end-to-end after Task 4. Documented as a known residual for a future auto-select pass.
