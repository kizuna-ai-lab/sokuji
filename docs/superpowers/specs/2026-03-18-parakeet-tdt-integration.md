# Parakeet TDT 0.6B v3 Integration — Design Spec

> **Issue:** https://github.com/kizuna-ai-lab/sokuji/issues/127
> **Branch:** `feat/parakeet-tdt`
> **Worktree:** `.claude/worktrees/parakeet-tdt`

## Goal

Integrate NVIDIA NeMo Parakeet TDT 0.6B v3 (int8) as a production ASR model supporting 25 European languages. The model has been validated via proto testing — WASM loads and runs successfully in both Electron and browser contexts.

## Current State (Proto Complete)

The following work is already done on `feat/parakeet-tdt`:

| Item | Status | Location |
|------|--------|----------|
| Manifest entry | Done | `modelManifest.ts` — `nemo-parakeet-tdt-int8`, `asrEngine: 'nemo-transducer'` |
| Pack script entry | Done | `model-packs/asr/pack.py` — renames encoder/decoder/joiner to nemo-transducer convention |
| HF dataset upload | Done | `jiangzhuo9357/sherpa-onnx-asr-models/wasm-nemo-parakeet-tdt-int8/` (671MB .data) |
| Proto component | Done | `ParakeetTdtProto.tsx` + Ctrl+Shift+P toggle in MainLayout |
| WASM viability | Verified | Loads and transcribes in Electron without OOM |
| Pack script fix | Done | `pack.py` handles already-patched glue JS (Module._dataPackageMetadata) |

## What Remains

### 1. Language Registry — Add 8 missing languages

**File:** `src/utils/languages.ts`

Parakeet TDT supports 25 languages. 8 are missing from `LANGUAGE_OPTIONS`:

| Code | Name | English Name |
|------|------|-------------|
| `bg` | Български | Bulgarian |
| `hr` | Hrvatski | Croatian |
| `el` | Ελληνικά | Greek |
| `lv` | Latviešu | Latvian |
| `lt` | Lietuvių | Lithuanian |
| `mt` | Malti | Maltese |
| `sk` | Slovenčina | Slovak |
| `sl` | Slovenščina | Slovenian |

**Impact:** These codes are already in the manifest's `languages` array. Adding them to `LANGUAGE_OPTIONS` means `getLanguageOption()` will return proper display names instead of raw codes.

**No UI changes needed** — `ModelManagementSection` already auto-selects models via `getAsrModelsForLanguage(sourceLang)` which matches on the `languages` array. The language dropdown for LOCAL_INFERENCE is populated from `getTranslationSourceLanguages()` (translation models), so these 8 languages will only appear as selectable ASR sources if translation models also support them. For now, the model will be available when users select overlapping languages (en, fr, de, es, etc.) and will show up in the model management UI for download.

### 2. Clean Up Proto Code

Remove the dev-only proto before merging:
- Delete `src/lib/local-inference/ParakeetTdtProto.tsx`
- Remove lazy import, state, keyboard handler, and `<Suspense>` block from `MainLayout.tsx`

### 3. Commit and PR

Commit the production changes (manifest + languages + pack.py fixes) and create PR against `main`.

## Architecture — No Changes Needed

The existing integration is complete because:

1. **Worker config:** `nemo-transducer` engine type already exists in `asr.worker.js` — Parakeet TDT uses the same transducer architecture (encoder + decoder + joiner) as existing NeMo models
2. **Model download:** `ModelManager` + IndexedDB pipeline handles 671MB `.data` file (has progress + resume support)
3. **Model selection:** `ModelManagementSection` auto-selects any downloaded ASR model matching the source language via `getAsrModelsForLanguage()`
4. **Session config:** `LocalInferenceClient` reads `config.asrModelId` and initializes `AsrEngine` with the correct model — works transparently for any manifest entry
5. **Validation:** `modelStore.isProviderReady()` checks `modelStatuses[selectedAsrModel] === 'downloaded'` — no special logic needed

## File Changes Summary

| File | Change | Reason |
|------|--------|--------|
| `src/utils/languages.ts` | Add 8 language entries | Display names for bg, hr, el, lv, lt, mt, sk, sl |
| `src/lib/local-inference/modelManifest.ts` | Already done | Manifest entry with 25 languages |
| `model-packs/asr/pack.py` | Already done | Pack entry + glue JS fix |
| `src/lib/local-inference/ParakeetTdtProto.tsx` | Delete | Proto cleanup |
| `src/components/MainLayout/MainLayout.tsx` | Remove proto code | Proto cleanup |

## Testing Checklist

- [ ] Model appears in Model Management section when LOCAL_INFERENCE provider is selected
- [ ] Download starts and shows progress (~671MB)
- [ ] After download, model appears as selectable ASR model
- [ ] When source language is set to any of the 25 EU languages, this model is auto-selected if downloaded
- [ ] Transcription works with English input
- [ ] Transcription works with a non-English EU language (e.g., French, German)
- [ ] Punctuation and casing are preserved in transcription output
- [ ] App works normally after model deletion
- [ ] Extension build succeeds and model works in extension context

## Performance Expectations

| Metric | Expected | Notes |
|--------|----------|-------|
| Download size | ~671MB | .data file from HF CDN |
| WASM load time | 5-15s | First load; depends on device |
| Runtime RAM | ~1.2GB | WASM heap for 0.6B model |
| RTF (Real-Time Factor) | 0.5-2.0x | Slower than smaller models but acceptable for offline VAD+ASR |

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Extension memory pressure on low-end devices | Medium | Model is optional; user chooses to download. Smaller models (Moonshine, FastConformer) remain available. |
| Slow download discourages users | Low | Progress bar + resume support already exist. 671MB is large but not unprecedented (paraformer-large is 950MB). |
| Missing word issue (greedy search) | Low | Known upstream issue [#2605](https://github.com/k2-fsa/sherpa-onnx/issues/2605). Acceptable for v1; monitor user reports. |

## Future Considerations (Not in Scope)

- **Replace FastConformer models:** Parakeet TDT covers the same languages as `nemo-fastconf-multi-int8` (10 EU langs) plus 15 more. Could deprecate FastConformer in a future release.
- **Streaming support:** Parakeet TDT is offline-only. [Issue #2918](https://github.com/k2-fsa/sherpa-onnx/issues/2918) tracks upstream streaming support.
- **Language-specific model recommendations:** Could add UI hints suggesting Parakeet TDT for EU languages over generic multilingual models.
