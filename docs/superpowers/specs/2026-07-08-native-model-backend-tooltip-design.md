# Native model tier-badge info tooltip — design

**Goal:** Hovering the tier badge on a native (Electron local-inference) model card shows an info tooltip listing the inference **backend framework** (CTranslate2 / ONNXRuntime / llama.cpp / transcribe.cpp / sherpa-onnx / Supertonic / MLX), the **device**, the hardware **acceleration API**, and — when the model is loaded — runtime details (precision, speed, memory, fallback), plus static **model size** and **repo**.

**Non-goals / out of scope:** No sidecar, protocol, or catalog-message changes. No changes to MainPanel / ConnectionStatus / the live-session panel. Presentation-only, in the Settings native-model cards.

## Background — current state

- The native model cards (`src/components/Settings/sections/NativeModelManagementSection.tsx`) already render a tier badge (`<span class="model-card__lang-tag">` = `TierIcon` + a label like `GPU · Vulkan`). Idle cards show the catalog capability tier; active cards show the resolved device via `resolvedTierState`/`tierLabel` (`CPU`, `GPU · CUDA`, `GPU · Metal`, `GPU · Vulkan`, `GPU · DirectML`), with a `⚠ Low VRAM → CPU` note when degraded. `TierIcon` carries a native `title="Vulkan"` browser tooltip.
- The badge shows device + hardware API only. It does **not** show the inference **framework** (llama.cpp/CT2/ORT/...), and nothing about the framework is surfaced anywhere else.
- The framework identity is already present in the renderer: `useNativeCatalog()[id].tiers[].backend` (`NativeTier.backend`), values like `llamacpp_gemma` / `ct2_opus_translate` / `transcribe_cpp` / `moss_onnx` / `sherpa_tts` / `supertonic` / `mlx_audio_tts`.

## All data originates from the sidecar (two messages)

Nothing is fabricated in the frontend; it only re-labels and formats.

| Tooltip field | Sidecar source | Frontend transform |
|---|---|---|
| Framework (engine) | catalog `tiers[].backend` (idle) / `ready.backend` (active) | backend id → label (see map) |
| Device (CPU/GPU) | catalog `tiers[].tier` (idle) / `ready.device` (active) | tier/device → `GPU`/`CPU` |
| Acceleration API | same tier/device | → `CUDA`/`Vulkan`/`Metal`/`DirectML`; hidden on CPU |
| Precision (computeType) | `ready.computeType` (active only) | verbatim (`int8`/`fp16`/`fp32`) |
| Speed | `ready.rtf` (ASR/TTS) / `ready.tokensPerSec` (translate) | `RTF 0.03` / `128 tok/s` |
| Memory | `ready.memoryBytes` (active only) | bytes → `3.2 GB` |
| Fallback note | `ready.fallbackReason` (active only) | verbatim, warning style |
| Model size | catalog `info.sizeBytes` (or selected variant `sizeBytes`) | bytes → GB |
| Repo | catalog `info.repo` (or selected variant `repo`) | verbatim |

The `models_catalog_result` message carries the static fields; the per-stage `ready` message carries the runtime fields (`asr_engine.py`/`translate_engine.py`/`tts_engine.py` ready handlers). **`ready.backend` and `ready.computeType` are already transmitted but currently dropped** by `LocalNativeClient`/`nativeModelStore` — the only "wiring" this feature adds is to stop dropping them.

## Backend id → framework label (engine/library level, 7 labels)

```
transcribe_cpp         → transcribe.cpp
transcribe_cpp_stream  → transcribe.cpp
ct2_opus_translate     → CTranslate2
llamacpp_qwen          → llama.cpp
llamacpp_hunyuan       → llama.cpp
llamacpp_gemma         → llama.cpp
moss_onnx              → ONNXRuntime
qwen3tts_onnx          → ONNXRuntime
sherpa_tts             → sherpa-onnx
supertonic             → Supertonic
mlx_audio_tts          → MLX
```

Unknown/unmapped backend id → fall back to the raw id (so a future backend still renders something, not a blank).

## Tooltip content (which tier it reflects)

The tooltip describes the **tier currently shown in the badge**, not a per-model constant — framework can vary by tier (e.g. MOSS-TTS / Qwen3-TTS use `mlx_audio_tts` on `gpu-metal` but `*_onnx` on `cpu`/`gpu-cuda`/`gpu-dml`; so on a Mac the Metal badge → MLX, the CPU badge → ONNXRuntime).

- **Idle** (model not loaded): the badge's `activeTier` (`tiers.find(t => t.available) ?? tiers[0]`). Rows: Framework, Device, Acceleration API (hidden on CPU), Model size, Repo.
- **Active** (loaded): framework from `resolved.backend`, device from `resolved.device`, API derived from that device — all from the runtime `ready` values (no catalog-tier lookup needed). Size/repo come from the model info as in the idle case. Rows: Framework, Device, Acceleration API (hidden on CPU), Precision, Speed, Memory, Model size, Repo, and the Fallback note when `fallbackReason` is present. If `resolved.backend` is somehow absent, fall back to the idle `activeTier.backend`.
- Any field whose data is absent → that row is omitted (no empty `Label: —` rows, except the API row which is simply hidden on CPU).

Layout: a compact key/value list, one row per field (muted label + value), rendered inside the existing `src/components/Tooltip/Tooltip.tsx`. The `TierIcon` native `title` is removed so there is a single tooltip on the badge.

## Files to change

1. **`src/lib/local-inference/native/nativeCatalog.ts`** — add `frameworkLabel(backendId: string): string` (the 7-entry map + raw-id fallback) and a pure helper `buildBadgeTooltipRows(...)` that takes the model info, the displayed tier, and the resolved object (or null) and returns an ordered `{ label: string; value: string; warn?: boolean }[]` for the current state. Keeping the assembly in a pure function makes it unit-testable without rendering.
2. **`src/services/clients/LocalNativeClient.ts`** — when parsing each `ready` message, keep `backend` and `computeType` (currently only `device`/`rtf`/`tokensPerSec`/`memoryBytes`/`fallbackReason` are read).
3. **`src/stores/nativeModelStore.ts`** — widen the `asrResolved`/`translationResolved`/`ttsResolved` shapes (and their setters) to carry `backend?` and `computeType?`. No new selectors needed; the section already reads the resolved objects.
4. **`src/components/Settings/sections/NativeModelManagementSection.tsx`** — wrap the tier badge in `<Tooltip content={<TooltipRows rows={...} />}>`, computing `rows` via `buildBadgeTooltipRows`; remove the native `title` from `TierIcon` usage. (If `TierIcon` sets its own `title` internally, drop it there.)
5. **i18n (`src/locales/*/translation.json`)** — add label keys for the field prefixes: framework / device / accelerationApi / precision / speed / memory / modelSize / repo. Add English + Chinese now; other locales fall back to English (existing i18next behavior). Framework names, API names, `RTF`, `tok/s`, and repo strings are proper nouns / data — not translated.

## Error handling / edge cases

- Unknown backend id → raw id shown (never blank).
- CPU tier → Acceleration API row omitted (CPU has no CUDA/Vulkan analog); all other rows still populate, so the CPU badge tooltip is still informative (framework, precision, speed, memory, size, repo).
- `resolved.backend` absent on the ready message (older sidecar) → framework falls back to the idle `activeTier.backend`; other runtime fields still show.
- Long repo strings wrap inside the tooltip; the tooltip has a sane max-width.
- Multi-quant models: use the selected/recommended variant's `sizeBytes`/`repo` when available, else the model-level `info.sizeBytes`/`info.repo`.

## Testing

- **`nativeCatalog` unit tests**: `frameworkLabel` for all 11 backend ids → the 7 labels, plus an unknown id → raw fallback. `buildBadgeTooltipRows`: idle case (no runtime rows, API hidden on CPU tier, size/repo present), active GPU case (all rows incl. precision/speed/memory), active CPU case (API row absent), and the fallbackReason → warn row.
- **`NativeModelManagementSection` render test**: idle card renders the tooltip trigger with framework+device+size+repo; active card additionally renders precision/speed/memory. Reuse the section's existing test setup (mock `nativeModelStore`).
- Run the existing `vitest` suite to confirm no regression in the section and store tests.
