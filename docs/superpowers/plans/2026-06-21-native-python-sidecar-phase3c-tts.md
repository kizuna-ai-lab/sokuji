# Native Python Sidecar — Phase 3c (native non-cloning TTS / speech output) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Complete the speech→speech loop for `LOCAL_NATIVE` by adding a non-cloning native TTS (sherpa-onnx piper VITS) selectable by model id, so the provider can emit audio without a reference clip. English gets speech output out of the box.

**Architecture:** The TTS stage becomes a pluggable dispatcher (like ASR's recognizer): `init.model` containing `piper`/`vits` → sherpa-onnx `OfflineTts` (no reference); else → Pocket (cloning). `NativeTtsClient.init(model)` selects it; `LocalNativeClient` enables TTS for non-cloning models and emits the audio delta. Reuses the existing TTS WS protocol (`init`/`generate`).

**Tech Stack:** sherpa-onnx `OfflineTts` (VITS piper, validated: RTF 31.7×, 16 kHz), the existing native clients + `audio-conversion`.

## Global Constraints
- Reuse the Phase 1 TTS protocol (`init` / `generate` → binary PCM + `result`) unchanged; only `init` gains a `model` field (already optional).
- sherpa piper outputs **16 kHz** — the renderer resamples to 24 kHz (LocalNativeClient already does `resampleFloat32(res.samples, res.sampleRate, 24000)`).
- Non-cloning piper needs **no `set_voice`**; Pocket (cloning) still needs it. Dispatch by model id; `isCloning = model.includes('pocket')`.
- Lazy imports; fake-engine unit tests run without sherpa; real path model-gated.
- Models via `huggingface_hub` (e.g. `csukuangfj/vits-piper-en_US-amy-low` — model.onnx + tokens.txt + espeak-ng-data/, auto-discovered in the snapshot dir).
- `npm run build` is the renderer gate.

## Task 1: Sidecar — pluggable TTS (Pocket + sherpa piper)
- Create `sidecar/sokuji_sidecar/sherpa_tts.py` — `SherpaPiperTts.init(model) -> loadMs`, `generate(text, speed) -> (np.float32 samples, gen_ms)`, `.sample_rate`. Auto-discover `*.onnx` (not `.onnx.json`) + `tokens.txt` + `espeak-ng-data` in `snapshot_download(repo)`; `OfflineTtsConfig(OfflineTtsModelConfig(vits=OfflineTtsVitsModelConfig(model, tokens, data_dir)))`.
- Create `sidecar/sokuji_sidecar/tts_engine.py` — `TtsEngine` dispatcher: `init(model)` → SherpaPiperTts if `piper`/`vits` in model else PocketEngine; `generate`, `set_voice` (Pocket only), `.sample_rate`. Handlers `init`/`set_voice`/`generate` on `state["engine"]`; `_h_init` passes `msg.get("model")`.
- `__main__.py`: `state["engine"] = TtsEngine()`, `register` from `tts_engine` instead of `pocket_engine` (Pocket stays as a backend; its module/tests untouched).
- Tests `tests/test_tts_engine.py`: fake-backend dispatch (piper vs pocket selection) + model-gated `test_real_piper` (generate >1s audio from `csukuangfj/vits-piper-en_US-amy-low`).
- Validate real piper; commit `feat(sidecar): pluggable TTS + sherpa-onnx piper (non-cloning)`.

## Task 2: Renderer — wire TTS into LocalNativeClient
- `NativeTtsClient.init(model?: string)` — send `{type:'init', model}`.
- `LocalNativeClient.connect`: `ttsEnabled = !!ttsModelId && !textOnly && !ttsModelId.includes('pocket')`; if enabled `await this.tts.init(ttsModelId)`. `runJob`: when enabled, `generate` → `float32ToInt16(resampleFloat32(samples, sr, 24000))` → `emit(item, {audio})`.
- Update `LocalNativeClient.test.ts`: a TTS-enabled case asserting an `{audio}` delta is emitted.
- `npm run build` + vitest; commit `feat(renderer): native piper TTS in LocalNativeClient`.

## Task 3: Default speech-out for English
- `settingsStore`: `pickNativeTts(targetLang)` → `'csukuangfj/vits-piper-en_US-amy-low'` for `en`, else `''`. In `createLocalNativeSessionConfig`, `ttsModelId = settings.ttsModel || pickNativeTts(settings.targetLanguage) || undefined`.
- `npm run build`; commit `feat(settings): default native piper TTS for English target`.
- Generate a piper WAV sample to verify by ear.

## Deferred (Phase 3d)
- Per-stage native model-selection UI (ASR/MT/TTS dropdowns for the sidecar catalog).
- More piper languages + a TTS on/off toggle.
- Real sidecar readiness (download-on-demand + health) replacing the `isElectron()` stub.

## Self-Review
TTS dispatch mirrors the proven ASR-recognizer pattern; protocol/clients unchanged. Pocket stays as the cloning backend (its tests untouched). Real piper validated before commit. English speech works out of the box; other languages stay text-only until more models are added.
