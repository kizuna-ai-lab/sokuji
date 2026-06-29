# Local Inference UI Unification (mirror the native pattern) — Design

**Status:** Approved (brainstorming) — ready for implementation planning.

## Goal

Make the `local_inference` (WASM) provider's settings UI structurally identical to `local_native`: `ModelManagementSection` becomes self-contained (reads/writes the store directly instead of via props), its `ModelCard` gains a `model-card__body` slot, and the TTS voice control moves **inside the selected TTS card** (a new `LocalInferenceVoiceSection`, symmetric with `NativeVoiceSection`). Same component hierarchy and same controlled pattern as native — without merging the two providers' model components.

## Background

Both providers render through `ProviderSpecificSettings` (dispatched from `AdvancedSettings`), but their shapes diverge:

- **native** (`renderLocalNativeSettings`, ProviderSpecificSettings.tsx:1853): `NativeModelManagementSection` is self-contained (`useLocalNativeSettings` / `useUpdateLocalNative`) and owns the TTS voice state; the voice picker is embedded in the selected MOSS card's `model-card__body` (via a `children` slot on `NativeModelCard`).
- **local_inference** (`renderLocalInferenceSettings`, :1912): `ModelManagementSection` is **controlled** — it receives `localInferenceSettings` + `onUpdateSettings` as props. The voice UI lives in `ProviderSpecificSettings` as `children` of `TtsSpeedControl` (below the cards), and its state/handlers (Edge-TTS voice fetch, Supertonic imported-voice library) live in `ProviderSpecificSettings`.

The building blocks for unification already exist: `useLocalInferenceSettings` / `useUpdateLocalInference` hooks (settingsStore.ts:1916/1966), `ModelManagementSection` has a single consumer (the WASM branch), and `VoiceLibrarySection` is already the shared generalized component used by both providers (dropdown, Presets/My-Voices optgroups, manage list).

## Decisions (locked during brainstorming)

1. **Mirror the native pattern, do NOT merge components** (option A). Two parallel components (`ModelManagementSection` for WASM, `NativeModelManagementSection` for native) keep their own data sources (WASM: `modelManifest`/`modelStore`/IndexedDB; native: sidecar HF catalog) but share the same structure and controlled pattern. Merging into one shared component (with a data-source adapter) is rejected as over-engineering given the very different backends.
2. **Inline voice state, mirroring native exactly** (option A). The relocated voice state lives inline in `ModelManagementSection`, as `NativeModelManagementSection` does — NOT extracted into a `useLocalInferenceVoices` hook. Accepts a larger file in exchange for a 1:1 mirror of native.

## Global Constraints

- TypeScript strict; English-only comments/docs. Conventional commits. Tests are the correctness gate (vitest); `tsc` is not repo-clean and is not a gate.
- **Do not change observable WASM behavior** — model selection/download, Edge-TTS voice selection (incl. loading/error/no-voices states + auto-select-first), Supertonic select/import/rename/delete (incl. reconcile-on-delete), and the speaker slider for other engines must all behave exactly as today. This is a structural refactor, not a behavior change.
- The WASM model UI (`ModelManagementSection`, `ProviderSpecificSettings`) currently has **zero test coverage**. Add characterization tests that lock current behavior BEFORE relocating stateful logic, then move under green.
- Relocate effects verbatim with their exact dependency arrays (the Edge-TTS fetch and auto-select-first effects are loop/timing-sensitive).
- Keep using the shared `VoiceLibrarySection` (no fork); keep existing SCSS class names.
- Do not regress native — `NativeModelCard`'s existing `children`/body slot and `NativeVoiceSection` are untouched.

## Architecture (target tree)

```
ProviderSpecificSettings
└─ renderLocalInferenceSettings()
   ├─ ModelManagementSection            [self-取: useLocalInferenceSettings / useUpdateLocalInference]
   │  └─ ModelCard[] (ASR / Translation / TTS)
   │      └─ (selected TTS card)
   │          └─ model-card__body
   │              └─ LocalInferenceVoiceSection      (switch by engine)
   │                  ├─ Edge-TTS  → <select>
   │                  ├─ Supertonic→ VoiceLibrarySection ※
   │                  └─ other     → speaker slider
   ├─ TtsSpeedControl        ← no more voice children
   ├─ SpeechModeControl / TranslationPromptControl / VadControl
```

This is structurally identical to the native branch (`NativeModelManagementSection` + `TtsSpeedControl` + SpeechMode/Prompt/Vad).

## Components & responsibilities

### `ModelManagementSection` (modified — self-取 + owns voice state)
- Drop the `localInferenceSettings` / `onUpdateSettings` props. Read `useLocalInferenceSettings()` + `useUpdateLocalInference()` internally. The existing auto-select effect now calls the self-取 update. The WASM branch call becomes `<ModelManagementSection isSessionActive={isSessionActive} />`.
- **Owns the voice state, inline** (relocated from `ProviderSpecificSettings`), exactly as `NativeModelManagementSection` owns `builtinVoices`/`customVoices`:
  - Edge-TTS: `edgeTtsVoiceStatus`, the voice-list fetch effect, `filteredVoices`, the auto-select-first-voice effect.
  - Supertonic: `importedVoices`, `supertonicVoiceEntries`, `supertonicSelectedId`, `sidFromVoiceId`, `handleImportVoice` / `handleRenameVoice` / `handleDeleteVoice` (incl. reconcile-on-delete to the default sid).
- `ModelCard` gains an optional `children?: React.ReactNode` prop, rendered inside the card root AFTER `model-card__top-row` as `{selected && children && <div className="model-card__body" onClick={(e) => e.stopPropagation()}>{children}</div>}` (identical to `NativeModelCard`). The TTS card's `children` = `<LocalInferenceVoiceSection …/>`; ASR/Translation cards pass no children.

### `LocalInferenceVoiceSection` (new — symmetric with `NativeVoiceSection`)
- Pure presentation that switches on the selected TTS engine (`getManifestEntry(ttsModel)?.engine`):
  - `edge-tts` → the `<select>` voice dropdown with loading/error/no-voices placeholders; `onChange` → `edgeTtsVoice`.
  - `supertonic` → `VoiceLibrarySection` (`capability: { importModes: ['upload'], curation: false, presentation: 'dropdown' }`) + the "Voice Builder" CTA link; `onSelect`/`onImport`/`onRename`/`onDelete` map through `sidFromVoiceId`.
  - other → the speaker slider writing `ttsSpeakerId`.
- Receives the voice list/state + handlers from `ModelManagementSection` as props (file import handled here, mirroring how `NativeVoiceSection` owns capture).

### `ProviderSpecificSettings` (simplified WASM branch)
- `renderLocalInferenceSettings` shrinks to: `<ModelManagementSection isSessionActive={…} />` + `<TtsSpeedControl …/>` (no voice `children`) + `SpeechModeControl` / `TranslationPromptControl` / `VadControl` — structurally the same as `renderLocalNativeSettings`.
- All relocated voice state/handlers are removed from this file. `ProviderSpecificSettings` keeps its own `useLocalInferenceSettings`/update usage for the remaining controls (speed/prompt/vad).

## Data flow

1. `ModelManagementSection` self-reads the store, renders the per-stage cards, and owns the voice state.
2. The selected TTS card renders `LocalInferenceVoiceSection` in its `model-card__body`, fed the voice data + handlers.
3. Selecting a voice writes the appropriate field (`edgeTtsVoice` / `ttsSpeakerId`) via `updateLocalInference`; import/rename/delete update the IndexedDB voice library and refresh.

## Error handling (preserved verbatim)

- Edge-TTS: loading / error / no-voices-for-language placeholders; auto-select the first voice when the current one is invalid for the language.
- Supertonic: deleting the active imported voice reconciles the selection back to the default sid.
- These are the loop/timing-sensitive edges — moved with exact deps and covered by the new tests.

## Testing

Add the safety net the WASM model UI never had (vitest + @testing-library/react). Write characterization tests that pass against current behavior first, then keep them green through the move:
- `LocalInferenceVoiceSection`: renders the correct control per engine (edge `<select>` / Supertonic `VoiceLibrarySection` / speaker slider) and writes the right field on change.
- Relocated Edge-TTS state: loading/error/empty/happy placeholders; auto-select-first when the current voice is invalid.
- Relocated Supertonic state: select → `ttsSpeakerId`; import/rename/delete; reconcile-on-delete of the active voice.
- `ModelCard` body slot: renders only for the selected card; clicks inside don't re-select (stopPropagation).
- `ModelManagementSection` self-取: selection/download still work without props.

## Build order (each step independently shippable + tested)

1. **`ModelManagementSection` → self-取**: drop `localInferenceSettings`/`onUpdateSettings` props, read the hooks internally; simplify the WASM branch call. Voice UI still in `ProviderSpecificSettings`. Add a test that selection/download work without props.
2. **`ModelCard` body slot**: add `children` + the `model-card__body` wrapper (additive, no children passed yet → no behavior change). Test the slot (selected-only + stopPropagation).
3. **Relocate voice → card** (the meaty step, behind new tests): build `LocalInferenceVoiceSection`; move the Edge-TTS + Supertonic voice state into `ModelManagementSection`; render `LocalInferenceVoiceSection` in the selected TTS card body; remove the voice block from `ProviderSpecificSettings`/`TtsSpeedControl`. Characterization tests for edge/supertonic/slider behavior land here.

## Risks (acknowledged)

- **No prior test coverage** on a stateful cross-boundary move — highest risk; mitigated by characterization-tests-first and verbatim effect relocation.
- **`ModelManagementSection` grows** (model + voice state in one ~714-line file) — accepted for 1:1 symmetry with native (decision 2); not extracted to a hook.
- **Parallel duplication** (two `ModelCard`/section/voice components) — the accepted cost of mirroring rather than merging (decision 1); card-behavior changes must be applied to both.

## Out of scope

- Merging the two providers' model components into one shared component (rejected: option B).
- Extracting voice state into a hook (rejected: decision 2).
- Broader `ProviderSpecificSettings` god-file cleanup beyond removing the relocated voice block.
- Any change to native (`NativeModelManagementSection` / `NativeVoiceSection` / `NativeModelCard`).
