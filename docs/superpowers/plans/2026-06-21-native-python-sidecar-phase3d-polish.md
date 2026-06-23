# Native Python Sidecar — Phase 3d (catalog + per-stage UI + readiness) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Let users pick per-stage native models in the app, give TTS multilingual coverage, and replace the dishonest `isElectron()` readiness stub with a real sidecar health check.

## Global Constraints
- Electron-only; reuse the Phase 3a–c plumbing. No protocol/client changes.
- TTS languages: only the 7 sherpa-piper repos confirmed to exist (en/de/es/fr/it/ru/zh).
- Catalog + config logic are pure/data-driven and unit-tested; UI is build-gated + manual.

## Task 1: Native catalog + data-driven session config
- Create `src/lib/local-inference/native/nativeCatalog.ts`:
  ```ts
  export interface NativeModelOption { id: string; label: string; }
  export const NATIVE_ASR: NativeModelOption[] = [
    { id: 'sense-voice', label: 'SenseVoice (zh/en/ja/ko/yue)' },
    { id: 'whisper-tiny', label: 'Whisper tiny (multilingual)' },
    { id: 'whisper-base', label: 'Whisper base (multilingual)' },
    { id: 'whisper-small', label: 'Whisper small (multilingual)' },
  ];
  export const NATIVE_TRANSLATION: NativeModelOption[] = [
    { id: '', label: 'Auto — Qwen LLM (any language)' },
    { id: 'opus-mt', label: 'Opus-MT (fast, when the pair exists)' },
  ];
  const PIPER_BY_LANG: Record<string,string> = {
    en:'csukuangfj/vits-piper-en_US-amy-low', de:'csukuangfj/vits-piper-de_DE-thorsten-low',
    es:'csukuangfj/vits-piper-es_ES-davefx-medium', fr:'csukuangfj/vits-piper-fr_FR-siwis-medium',
    it:'csukuangfj/vits-piper-it_IT-riccardo-x_low', ru:'csukuangfj/vits-piper-ru_RU-denis-medium',
    zh:'csukuangfj/vits-piper-zh_CN-huayan-medium',
  };
  export function pickNativeTts(lang: string): string { return PIPER_BY_LANG[lang] || ''; }
  export function resolveNativeTranslation(choice: string, src: string, tgt: string): string | undefined {
    if (choice === 'opus-mt') return `Xenova/opus-mt-${src}-${tgt}`;
    return choice || undefined; // '' => undefined => sidecar Qwen LLM default
  }
  ```
- Move `pickNativeTts` out of settingsStore; `createLocalNativeSessionConfig` uses `pickNativeTts(targetLanguage)` and `resolveNativeTranslation(settings.translationModel, src, tgt)`.
- Test `nativeCatalog.test.ts`: 7 TTS langs map, unknown → ''; opus-mt mapping; '' → undefined.
- Gate: vitest + `npm run build`. Commit.

## Task 2: Per-stage model-selection UI
- `ProviderSpecificSettings.tsx`: add `renderLocalNativeSettings()` (guard `if (provider !== Provider.LOCAL_NATIVE) return null`) rendering two `<select>`s — ASR (`NATIVE_ASR`) and Translation (`NATIVE_TRANSLATION`) — reading `useLocalNativeSettings()` / writing `useUpdateLocalNative()`, plus a read-only line: "Speech output: <piper for target lang | text-only>". Add the call to the render list.
- Gate: `npm run build`. Commit.

## Task 3: Real sidecar readiness
- `settingsStore` `validateApiKey` LOCAL_NATIVE branch: replace `ready = isElectron()` with an actual check — `ready = isElectron() && !!(await window.electron?.invoke('native-host:start'))?.ok` (spawns + handshakes the sidecar; warms it for the session). Keep the same `set({...})` shape; message on failure: "Native sidecar unavailable".
- Gate: `npm run build`. Commit.

## Deferred (Phase 3e / packaging)
- More ASR/TTS languages + voice variants; ja TTS (no piper repo).
- Download-progress UI for first-run model fetches.
- **Packaging** (PyInstaller + on-demand download + signing) — the real ship blocker.

## Self-Review
Catalog centralizes the model lists (no more inline maps); config logic is unit-tested. UI mirrors the existing render-helper pattern, guarded by provider. Readiness now reflects a real spawn+handshake, not just "on Electron".
