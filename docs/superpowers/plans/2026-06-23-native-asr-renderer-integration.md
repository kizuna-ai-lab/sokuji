# Native ASR Renderer Integration (Granite cards + hardware-gating + device override) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LOCAL_NATIVE renderer expose the new Granite speech-LLM models (selectable, hardware-gated off when no GPU) and let the user force the ASR compute device (Auto/CPU/GPU), threaded through to the sidecar.

**Architecture:** The sidecar already serves `models_catalog` (per-machine tier availability) and reads `asr_init.device`. This increment: (1) adds Granite ASR cards to the renderer's `NATIVE_ASR`; (2) greys+disables a model card whose `models_catalog` entry has no available tier (GPU-only Granite on a CPU box), reusing the existing incompatible-card path; (3) adds a `localNative.asrDevice` setting + an Auto/CPU/GPU control, threaded `settings → LocalNativeSessionConfig → LocalNativeClient → NativeAsrClient.init → asr_init.device`.

**Tech Stack:** TypeScript, React, Zustand, vitest 4 (the correctness gate — NOT tsc, which is known-dirty). Renderer under `src/`.

## Global Constraints

- **Correctness gate is vitest** (`npx vitest run <file>`); React component wiring is verified with `npm run build`. Do NOT gate on tsc.
- **Granite is GPU-only** — its sidecar catalog row has only a `gpu-cuda` deployment, so `models_catalog` reports `tiers: [{tier:"gpu-cuda", available:<bool>}]`. A card with no available tier is hardware-gated (greyed, not selectable, "Requires GPU").
- **Model ids match the sidecar catalog verbatim:** `granite-speech-4.1-2b` (en/fr/de/es/pt/ja) and `granite-speech-4.1-2b-plus` (en/fr/de/es/pt). These ids are the card `selectId`/`downloadId` AND the `models_catalog` keys.
- **Device values:** `'auto' | 'cpu' | 'cuda'` (the sidecar accepts more; the renderer offers Auto/CPU/GPU where GPU→`'cuda'`). Default `'auto'`. Multi-accelerator selection (metal/vulkan/dml) is future.
- **The "GPU" device option shows only when a GPU tier is available** on this machine — derived from the existing `useNativeCatalog` feed (any model with an available non-cpu tier), no new hardware_info fetch.
- **Out of scope (the immediate follow-up plan):** the perf badge (surfacing `ready.rtf`/resolved device on the active model) and the "loading model…" state — both are coupled to the live session `ready`/connect flow. Also out of scope: llama.cpp/MLX, full migration of selection to the sidecar feed.
- **Commit messages:** Conventional Commits. No hand-written trailers.

---

## File Structure

**Modify:**
- `src/lib/local-inference/native/nativeCatalog.ts` — add the two Granite rows to `NATIVE_ASR`; add a `hardwareGated(info)` helper.
- `src/lib/local-inference/native/nativeCatalog.test.ts` — Granite language compatibility + `hardwareGated` tests.
- `src/components/Settings/sections/NativeModelManagementSection.tsx` — gate hardware-incompatible cards; add the device-override control.
- `src/stores/settingsStore.ts` — `LocalNativeSettings.asrDevice` + default + `createLocalNativeSessionConfig`.
- `src/stores/settingsStore.test.ts` — `createLocalNativeSessionConfig` includes `asrDevice`.
- `src/services/interfaces/IClient.ts` — `LocalNativeSessionConfig.asrDevice`.
- `src/services/clients/LocalNativeClient.ts` — pass `config.asrDevice` to `asr.init`.
- `src/lib/local-inference/native/NativeAsrClient.ts` — `init` gains a `device` param → `asr_init.device`.
- `src/lib/local-inference/native/NativeAsrClient.test.ts` — `init` sends `device`.

---

## Task 1: Granite ASR cards

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts`
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Produces: `NATIVE_ASR` gains `granite-speech-4.1-2b` (`['en','fr','de','es','pt','ja']`, sortOrder 5) and `granite-speech-4.1-2b-plus` (`['en','fr','de','es','pt']`, sortOrder 6), both non-recommended. Their specific language lists mean the existing `compatibleNativeAsr`/`incompatibleNativeAsr` language-gating applies automatically (e.g. `-2b-plus` is incompatible with a `ja` source).

- [ ] **Step 1: Write the failing test** (append to `nativeCatalog.test.ts`)

```typescript
  it('exposes Granite speech-LLM ASR options with language-specific gating', () => {
    const ids = NATIVE_ASR.map((m) => m.id);
    expect(ids).toContain('granite-speech-4.1-2b');
    expect(ids).toContain('granite-speech-4.1-2b-plus');
    // base granite supports Japanese; the plus variant does not
    expect(compatibleNativeAsr('ja').map((m) => m.id)).toContain('granite-speech-4.1-2b');
    expect(compatibleNativeAsr('ja').map((m) => m.id)).not.toContain('granite-speech-4.1-2b-plus');
    // neither is recommended (sense-voice / whisper-base stay the recommended leaders)
    expect(NATIVE_ASR.find((m) => m.id === 'granite-speech-4.1-2b')!.recommended).toBeFalsy();
    // a non-sense-voice language still leads with whisper-base, not granite
    expect(compatibleNativeAsr('de')[0].id).toBe('whisper-base');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `granite-speech-4.1-2b` not in `NATIVE_ASR`.

- [ ] **Step 3: Add the Granite rows** (`nativeCatalog.ts`)

In `NATIVE_ASR`, append after `whisper-large-v3`:

```typescript
  { id: 'granite-speech-4.1-2b', label: 'Granite Speech 4.1 (2B)', languages: ['en', 'fr', 'de', 'es', 'pt', 'ja'], sortOrder: 5 },
  { id: 'granite-speech-4.1-2b-plus', label: 'Granite Speech 4.1 (2B+)', languages: ['en', 'fr', 'de', 'es', 'pt'], sortOrder: 6 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS — the new case passes; existing assertions (`compatibleNativeAsr('de')[0].id === 'whisper-base'`, `compatibleNativeAsr('zh')[0].id === 'sense-voice'`) still hold (Granite doesn't support `zh`, and for `de` it's compatible-but-not-recommended so whisper-base still leads).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): Granite speech-LLM ASR cards (language-gated)"
```

---

## Task 2: Hardware-gating of GPU-only cards

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (add `hardwareGated`)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx`

**Interfaces:**
- Consumes: `NativeModelInfo` (the `models_catalog` entry shape from the follow-on: `{id, name, languages, recommended, tiers: {tier, backend, available}[]}`).
- Produces: `hardwareGated(info: NativeModelInfo | undefined): boolean` — true when the catalog entry exists, has tiers, and NONE are available (a GPU-only model on a machine without the GPU). The `NativeModelCard` greys+disables such a card (reusing the incompatible path) and shows "Requires GPU".

- [ ] **Step 1: Write the failing test** (append to `nativeCatalog.test.ts`)

```typescript
  it('hardwareGated is true only when a model has tiers but none are available', () => {
    expect(hardwareGated(undefined)).toBe(false);                       // unknown → not gated
    expect(hardwareGated({ id: 'x', name: 'X', languages: ['en'], recommended: false, tiers: [] } as any)).toBe(false);
    expect(hardwareGated({ id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-cuda', backend: 'transformers', available: false }] } as any)).toBe(true);   // GPU-only, no GPU
    expect(hardwareGated({ id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-cuda', backend: 'transformers', available: true }] } as any)).toBe(false);   // GPU present
    expect(hardwareGated({ id: 's', name: 'S', languages: ['en'], recommended: false,
      tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] } as any)).toBe(false);              // CPU floor
  });
```

(Add `hardwareGated` and the `NativeModelInfo` type to the import line at the top of `nativeCatalog.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `hardwareGated is not exported`.

- [ ] **Step 3: Implement `hardwareGated`** (`nativeCatalog.ts`)

Add the import of the type at the top: `import type { NativeModelInfo } from './nativeProtocol';`, then add the helper near `tierLabel`:

```typescript
/** A model is hardware-gated when the sidecar reports tiers for it but NONE are
 *  available on this machine (e.g. a GPU-only model with no GPU). Unknown (no
 *  catalog entry yet) is NOT gated — we don't grey a card before the feed loads. */
export function hardwareGated(info: NativeModelInfo | undefined): boolean {
  return !!info && info.tiers.length > 0 && !info.tiers.some((t) => t.available);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the card** (`NativeModelManagementSection.tsx`)

In `NativeModelCard`, after the existing `const info = ... catalog[spec.downloadId ...]` lookup (from the follow-on), compute the gate and fold it into the card's disabled/incompatible state. Add `hardwareGated` to the `nativeCatalog` import. Then:

```typescript
  const hwGated = hardwareGated(info);
```

Extend the `classNames` array to include `hwGated && 'model-card--incompatible'`, change the disabled guard so a hardware-gated card is not selectable, and add a "Requires GPU" note in the `model-card__meta` block:

```tsx
              {hwGated && <span className="model-card__lang-tag">Requires GPU</span>}
```

and make the click guard refuse selection when gated:

```typescript
  const handleClick = () => { if (!disabled && !hwGated && ready) onSelect(); };
```

(Reuse the existing `model-card--incompatible` class — no new SCSS. "Requires GPU" is a plain technical string — no new i18n key.)

- [ ] **Step 6: Verify the helper test + the build**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

Run: `npm run build`
Expected: build succeeds (the component wiring compiles).

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts src/components/Settings/sections/NativeModelManagementSection.tsx
git commit -m "feat(native): hardware-gate GPU-only ASR cards when no GPU tier is available"
```

---

## Task 3: asrDevice setting + session-config threading + asr.init device

**Files:**
- Modify: `src/stores/settingsStore.ts`, `src/services/interfaces/IClient.ts`, `src/services/clients/LocalNativeClient.ts`, `src/lib/local-inference/native/NativeAsrClient.ts`
- Test: `src/stores/settingsStore.test.ts`, `src/lib/local-inference/native/NativeAsrClient.test.ts`

**Interfaces:**
- Produces: `LocalNativeSettings.asrDevice: 'auto' | 'cpu' | 'cuda'` (default `'auto'`); `createLocalNativeSessionConfig` emits `asrDevice`; `LocalNativeSessionConfig.asrDevice?: string`; `LocalNativeClient.connect` passes it to `asr.init`; `NativeAsrClient.init(language, modelId, sampleRate, vad, device?)` sends `device` in the `asr_init` message.

- [ ] **Step 1: Write the failing tests**

Append to `settingsStore.test.ts` (mirroring however it constructs the store/config — use the exported `createLocalNativeSessionConfig` if accessible, otherwise drive it via the store as the existing tests do):

```typescript
  it('local_native session config carries the asrDevice override', () => {
    const { useSettingsStore } = require('./settingsStore');
    useSettingsStore.getState().updateLocalNative({ asrDevice: 'cpu' });
    useSettingsStore.setState({ provider: 'local_native' } as any);
    const cfg = useSettingsStore.getState().getSessionConfig?.() ?? useSettingsStore.getState().createSessionConfig?.();
    expect((cfg as any).asrDevice).toBe('cpu');
  });
```

(If `settingsStore.test.ts` already has a helper that builds the local_native config, follow that pattern instead — the assertion is `cfg.asrDevice === 'cpu'`.)

Append to `NativeAsrClient.test.ts` (extend its FakeWS to capture the `asr_init` message and assert `device`):

```typescript
  it('sends the device override in asr_init', async () => {
    const c = new NativeAsrClient();
    await c.init('en', 'granite-speech-4.1-2b', 24000, undefined, 'cuda');
    expect(FakeWS.lastInit.device).toBe('cuda');
  });
```

(Extend the test's `FakeWS.send` to record `asr_init` messages: `if (msg.type === 'asr_init') { FakeWS.lastInit = msg; queueMicrotask(() => this.emit({ type:'ready', id: msg.id, loadTimeMs: 5 })); }`, with a `static lastInit: any` field.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/settingsStore.test.ts src/lib/local-inference/native/NativeAsrClient.test.ts`
Expected: FAIL — `asrDevice` undefined in the config / `device` not in the asr_init message.

- [ ] **Step 3: Add the setting + thread it through**

(a) `settingsStore.ts` — in `interface LocalNativeSettings` add `asrDevice: 'auto' | 'cpu' | 'cuda';`; in `defaultLocalNativeSettings` add `asrDevice: 'auto',`; in `createLocalNativeSessionConfig`'s returned object add `asrDevice: settings.asrDevice,`.

(b) `IClient.ts` — in `LocalNativeSessionConfig` add `asrDevice?: string;`.

(c) `LocalNativeClient.ts` — change the `asr.init` call to pass the device (5th arg):

```typescript
    await this.asr.init(config.sourceLanguage, config.asrModelId, 24000, {
      threshold: config.vadThreshold,
      minSilence: config.vadMinSilenceDuration,
      minSpeech: config.vadMinSpeechDuration,
    }, config.asrDevice);
```

(d) `NativeAsrClient.ts` — change `init`'s signature and message:

```typescript
  async init(
    language = '', modelId?: string, sampleRate = 24000,
    vad?: { threshold?: number; minSilence?: number; minSpeech?: number },
    device?: string,
  ): Promise<{ loadTimeMs: number }> {
    await this.connect();
    this.onStatus?.('[native-asr] init…');
    const msg = await this.send({
      type: 'asr_init', language, model: modelId, sampleRate, device,
      vadThreshold: vad?.threshold, vadMinSilenceDuration: vad?.minSilence, vadMinSpeechDuration: vad?.minSpeech,
    });
    return { loadTimeMs: (msg as Extract<ServerMsg, { type: 'ready' }>).loadTimeMs };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/settingsStore.test.ts src/lib/local-inference/native/NativeAsrClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/services/interfaces/IClient.ts src/services/clients/LocalNativeClient.ts src/lib/local-inference/native/NativeAsrClient.ts src/stores/settingsStore.test.ts src/lib/local-inference/native/NativeAsrClient.test.ts
git commit -m "feat(native): asrDevice override setting threaded into asr_init"
```

---

## Task 4: Device-override control (Auto / CPU / GPU)

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (add `gpuTierAvailable`)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx`

**Interfaces:**
- Consumes: `useLocalNativeSettings`/`useUpdateLocalNative` (settingsStore), `useNativeCatalog` (the follow-on store).
- Produces: `gpuTierAvailable(catalog: Record<string, NativeModelInfo>): boolean` — true when any model in the feed has an available non-cpu tier (so the machine has a usable GPU). A device control in the Speech-recognition group sets `localNative.asrDevice`; the "GPU" option is shown only when `gpuTierAvailable`.

- [ ] **Step 1: Write the failing test** (append to `nativeCatalog.test.ts`)

```typescript
  it('gpuTierAvailable reflects any available non-cpu tier in the feed', () => {
    expect(gpuTierAvailable({})).toBe(false);
    expect(gpuTierAvailable({ a: { id: 'a', name: 'A', languages: ['en'], recommended: false,
      tiers: [{ tier: 'cpu', backend: 'sherpa', available: true }] } } as any)).toBe(false);
    expect(gpuTierAvailable({ g: { id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-cuda', backend: 'transformers', available: true }] } } as any)).toBe(true);
    expect(gpuTierAvailable({ g: { id: 'g', name: 'G', languages: ['en'], recommended: false,
      tiers: [{ tier: 'gpu-cuda', backend: 'transformers', available: false }] } } as any)).toBe(false);
  });
```

(Add `gpuTierAvailable` to the test's import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `gpuTierAvailable is not exported`.

- [ ] **Step 3: Implement `gpuTierAvailable`** (`nativeCatalog.ts`)

```typescript
/** True when the sidecar feed reports any available non-cpu tier — i.e. this
 *  machine has a usable GPU/NPU, so the "Force GPU" device option is meaningful. */
export function gpuTierAvailable(catalog: Record<string, NativeModelInfo>): boolean {
  return Object.values(catalog).some((m) => m.tiers.some((t) => t.available && t.tier !== 'cpu'));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the control to the Speech-recognition group** (`NativeModelManagementSection.tsx`)

Add `gpuTierAvailable` to the `nativeCatalog` import and `useNativeCatalog` to the store imports (the latter may already be imported for the badge). In the section component, read the setting + catalog and render a small control at the top of the ASR `ModelGroup` (inside `<ModelGroup id="model-asr" ...>`, before `renderCards(asrCards, ...)`):

```tsx
        <div className="model-group__device-control">
          <span className="model-group__device-label">{t('models.computeDevice', 'Compute device')}</span>
          <select
            className="select-dropdown"
            value={settings.asrDevice}
            disabled={isSessionActive}
            onChange={(e) => update({ asrDevice: e.target.value as 'auto' | 'cpu' | 'cuda' })}
          >
            <option value="auto">{t('models.deviceAuto', 'Auto')}</option>
            <option value="cpu">{t('models.deviceCpu', 'CPU')}</option>
            {gpuTierAvailable(catalog) && <option value="cuda">{t('models.deviceGpu', 'GPU')}</option>}
          </select>
        </div>
```

where `const catalog = useNativeCatalog();` is read in the section body (add it with the other hooks). The labels use the existing `select-dropdown` class (global) and i18n keys with English fallbacks (the keys are new but fall back to English; full localization of the four short strings is a follow-up — they render correctly via the fallback).

- [ ] **Step 6: Verify the helper test + the build**

Run: `npx vitest run src/lib/local-inference/native/ src/stores/nativeModelStore.test.ts`
Expected: PASS (all native unit tests).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts src/components/Settings/sections/NativeModelManagementSection.tsx
git commit -m "feat(native): Auto/CPU/GPU device-override control in the ASR settings"
```

---

## Self-Review

**Spec coverage** (this increment = spec §7 items 1–3):
- Granite cards (selectable) → Task 1.
- Hardware-gating of GPU-only cards (§7 item 2, reusing the incompatible path) → Task 2.
- Device-override setting + threading to `asr_init` (§7 item 3) → Task 3; the Auto/CPU/GPU control → Task 4.
- **Deferred to the immediate follow-up plan (noted):** the perf badge surfacing `ready.rtf`/resolved device (§7 item 4) and the "loading model…" state — both need the live-session `ready`/connect flow (capture `device`/`rtf` from `ready` into a store, a connection-time loading indicator). Out of scope here.

**Placeholder scan:** none — every step has complete code and exact commands. The `settingsStore.test.ts` assertion (Step 1, Task 3) adapts to that file's existing config-construction helper; the assertion target (`cfg.asrDevice === 'cpu'`) is concrete.

**Type consistency:** `asrDevice: 'auto'|'cpu'|'cuda'` is the same union in `LocalNativeSettings` (Task 3a), the `update({asrDevice: ...})` cast (Task 4), and the default. `NativeModelInfo` (from `nativeProtocol`, defined in the follow-on) is consumed by `hardwareGated` (Task 2) and `gpuTierAvailable` (Task 4) with the same `tiers: {tier, available}[]` shape. `NativeAsrClient.init`'s new 5th param `device?` (Task 3d) matches the `config.asrDevice` passed by `LocalNativeClient` (Task 3c).

## Notes / decisions

- **Device union kept to `auto|cpu|cuda`** for now — the renderer offers Auto/CPU/GPU; "GPU" maps to `cuda` (the only desktop accelerator proven so far). metal/vulkan/dml selection is future and would generalize the "GPU" option from the hardware_info accelerator list.
- **The "GPU" option is gated on `gpuTierAvailable`** derived from the existing catalog feed — no new hardware_info fetch, and it stays correct per-machine.
- **Hardware-gating reuses `model-card--incompatible`** (no new SCSS) and a plain "Requires GPU" string (no new i18n key), consistent with the follow-on's tier-badge decision.
- **Perf badge + loading state split out** because they require the live-session `ready` (resolved device + rtf) and a connection-time indicator — a focused follow-up plan keeps this one to the self-contained settings surface.
