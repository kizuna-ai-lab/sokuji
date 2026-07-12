# Native Python Sidecar — Phase 3b (LOCAL_NATIVE settings + UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Make the registered `LOCAL_NATIVE` provider actually selectable and usable in the running app — settings state, session-config building, start-flow wiring, language pickers, and provider-card UI — mirroring `LOCAL_INFERENCE`, gated Electron-only.

**Architecture:** Mirror the flat per-provider settings field pattern (`localNative: LocalNativeSettings`), add a `createLocalNativeSessionConfig` builder + `createSessionConfig` case, a `validateApiKey` readiness branch (sidecar-available, not IndexedDB), and the minimal MainPanel / LanguageSection / ProviderSection / ProviderSpecificSettings cases so the provider renders and starts without crashing. No change to the WASM path.

**Tech Stack:** existing Zustand `settingsStore`, React settings components.

## Global Constraints
- Electron-only (already gated in `SUPPORTED_PROVIDERS` + `ProviderConfigFactory`).
- Mirror `LOCAL_INFERENCE` patterns exactly; **do not** touch its code paths.
- MVP = speech→text-translation (ASR + translation). TTS stays optional/off (native TTS is Pocket/cloning). So `LocalNativeSettings` omits TTS speaker/speed/edge fields and prompt/VAD fields.
- Readiness: on Electron the provider is selectable (`ready = true`), sidecar/model failures surface at connect via `onError`. (Real download-on-demand + health is Phase 3c.)
- Integration gate: `npm run build` (vite/esbuild) must pass — the repo's correctness gate is build + vitest, not strict tsc.

## File touch list (from the integration map)
- `src/stores/settingsStore.ts` — type, defaults, field, hydrate, setter, getCurrentProviderSettings, union, selectors, `createLocalNativeSessionConfig`, `createSessionConfig` case, `validateApiKey` branch.
- `src/components/MainPanel/MainPanel.tsx` — apiKey case (**required**), modelName arm, prompt-source.
- `src/components/Settings/.../LanguageSection.tsx` — getProviderSettings + source/target update cases (**required**).
- `src/components/Settings/.../ProviderSection.tsx` — getProviderInfoById case + api-key-area guard.
- `src/components/Settings/.../ProviderSpecificSettings.tsx` — renderModelSettings guard.

---

## Task 1: settingsStore — settings state + selectors

Add (mirroring the LOCAL_INFERENCE lines named in the map):
```ts
export interface LocalNativeSettings {
  asrModel: string;
  translationModel: string;
  ttsModel: string;
  sourceLanguage: string;
  targetLanguage: string;
}
const defaultLocalNativeSettings: LocalNativeSettings = {
  asrModel: 'sense-voice', translationModel: '', ttsModel: '',
  sourceLanguage: 'ja', targetLanguage: 'en',
};
```
- [ ] Add interface near `LocalInferenceSettings` (`:158`) and defaults near `:337`.
- [ ] Add `localNative: LocalNativeSettings;` to the store interface (`:378`), `localNative: defaultLocalNativeSettings` to initial state (`:805`).
- [ ] Add `updateLocalNative` declaration (`:460`) + implementation mirroring `updateLocalInference` (`:1148`, persist key `settings.localNative.${key}`).
- [ ] Hydrate in `loadSettings`: add `loadProviderSettings('settings.localNative', defaultLocalNativeSettings)` to the `Promise.all` (`:1517`) and the `set({...})` (`:1548`).
- [ ] `getCurrentProviderSettings`: add `case Provider.LOCAL_NATIVE: return state.localNative;` (`:1591`) and add `LocalNativeSettings` to the return-type union (`:470`).
- [ ] Selectors: `export const useLocalNativeSettings = () => useSettingsStore((s) => s.localNative);` and `useUpdateLocalNative` (near `:1735`/`:1784`).
- [ ] Gate: `npm run build` passes. Commit `feat(settings): LocalNativeSettings state + selectors`.

## Task 2: settingsStore — session config + readiness

```ts
function createLocalNativeSessionConfig(settings: LocalNativeSettings): LocalNativeSessionConfig {
  return {
    provider: 'local_native', model: 'native-asr-translate',
    instructions: buildDefaultLocalPrompt(settings.sourceLanguage, settings.targetLanguage),
    sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage,
    asrModelId: settings.asrModel,
    translationModelId: settings.translationModel || undefined,
    ttsModelId: settings.ttsModel || undefined,
    wrapTranscript: true,
  };
}
```
- [ ] Add the builder near `createLocalInferenceSessionConfig` (`:620`); import `LocalNativeSessionConfig`.
- [ ] `createSessionConfig`: add `case Provider.LOCAL_NATIVE: config = createLocalNativeSessionConfig(state.localNative); break;` (`:1686`).
- [ ] `validateApiKey`: add, next to the LOCAL_INFERENCE branch (`:1167`):
```ts
if (provider === Provider.LOCAL_NATIVE) {
  const ready = isElectron();
  set({ isApiKeyValid: ready,
    availableModels: ready ? [{ id: 'native-asr-translate', type: 'realtime' as const, created: 0 }] : [],
    validationMessage: ready ? '' : 'Native inference requires the desktop app', isValidating: false });
  return { valid: ready, message: ready ? '' : 'Native inference requires the desktop app', validating: false };
}
```
(import `isElectron` if not already in scope).
- [ ] Gate: `npm run build`. Commit `feat(settings): LOCAL_NATIVE session config + readiness`.

## Task 3: MainPanel — start flow

- [ ] apiKey switch (`:1480`): add `case Provider.LOCAL_NATIVE: apiKey = 'local'; break;` (**required — default throws**).
- [ ] modelName ternary (`:1489`): add arm `: provider === Provider.LOCAL_NATIVE ? 'native-asr-translate'`.
- [ ] prompt-source (`:486`): extend to `provider === Provider.LOCAL_INFERENCE || provider === Provider.LOCAL_NATIVE ? getProcessedLocalPrompt(false) : ...` (the builder overrides instructions anyway, but keep prompt-source consistent).
- [ ] Gate: `npm run build`. Commit `feat(MainPanel): wire LOCAL_NATIVE session start`.

## Task 4: LanguageSection — pickers (required, else pickers are no-ops)

- [ ] `getProviderSettings` useMemo (`:150`): add `case Provider.LOCAL_NATIVE: return localNativeSettings;` (add the `useLocalNativeSettings()` hook + `useUpdateLocalNative()` at the top of the component).
- [ ] `updateSourceLanguage` switch (`:159`): add a `case Provider.LOCAL_NATIVE:` calling `updateLocalNative({ sourceLanguage: value, targetLanguage: <clamp via getTranslationTargetLanguages(value)[0] if current invalid> })` — mirror the LOCAL_INFERENCE branch (`:214`).
- [ ] `updateTargetLanguage` switch (`:233`): add `case Provider.LOCAL_NATIVE: updateLocalNative({ targetLanguage: value }); break;`.
- [ ] (optional) `targetLanguages` useMemo (`:333`): add LOCAL_NATIVE to the LOCAL_INFERENCE `if` for pair-aware target list.
- [ ] Gate: `npm run build`. Commit `feat(settings-ui): LOCAL_NATIVE language pickers`.

## Task 5: provider-card UI guards

- [ ] `ProviderSection.tsx` `getProviderInfoById` (`:323`): add a `case Provider.LOCAL_NATIVE:` returning name `'Local (Native, Electron)'`, an icon (reuse the LOCAL_INFERENCE icon), and a short description.
- [ ] `ProviderSection.tsx` api-key area (`:428`): change the `provider === Provider.LOCAL_INFERENCE` guard so LOCAL_NATIVE does **not** render the API-key input — render a minimal "no key required (sidecar)" note (or include it in the local-inference-style branch with a native sub-panel that just shows the model id).
- [ ] `ProviderSpecificSettings.tsx` `renderModelSettings` (`:699`): add `|| provider === Provider.LOCAL_NATIVE` to the early-return-null guard (so no stray realtime-model dropdown).
- [ ] Gate: `npm run build`. Commit `feat(settings-ui): LOCAL_NATIVE provider-card guards`.

## Deferred (Phase 3c)
- Native non-cloning TTS (sherpa-onnx piper) / reference-voice UX → speech output.
- Real sidecar readiness: download-on-demand + health check (replace the `isElectron()` stub).
- Per-stage native model selection UI (ASR/MT dropdowns specific to the sidecar's catalog).

## Self-Review
Every required edit mirrors a named LOCAL_INFERENCE line from the integration map. The WASM path is untouched. `npm run build` after each task catches import/case errors. UI rendering itself is verified manually in-app (Phase 3b can't be fully unit-tested headless); the start-flow `apiKey` case is the one hard-required edit (the `default` throws).
