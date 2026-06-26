# Native Resolved Memory & Degrade Display

## Problem

The VRAM gate (`accel.load_with_fallback`) can silently move a LOCAL_NATIVE
model from GPU to CPU when free VRAM can't hold it — e.g. a GPU-only Voxtral
ASR claims the card and a 2B Qwen translation degrades to CPU. After that
happens the UI gives the user no honest account of it:

1. **No reason.** The gate's `notice` ("cuda skipped, insufficient VRAM →
   CPU") is discarded in the engines (`translate_engine.py:28`,
   `asr_engine.py:96`), so the user never learns *why* a stage is on CPU.
2. **No real usage.** Nothing measures actual VRAM/RAM consumed. The
   pre-session memory estimate (`ProviderSection`) still shows "VRAM ~12 GB"
   even though the degraded model actually ran on CPU/RAM — so the one number
   shown is silently wrong.
3. **Indistinguishable tier tag.** The model-card tier tag renders the same
   "GPU·CUDA" whether it means *"supports CUDA"* (catalog capability, idle) or
   *"is actually running on CUDA now"* (resolved, live) — the user can't tell
   capability from live truth at a glance.

## Goal

After a conversation starts and real data exists, surface — in the existing
estimate area and model cards, no new panel — (a) which stage ran on which
device and *why* (including a degrade reason), and (b) the real VRAM/RAM each
stage consumed. The pre-session estimate must reconcile with reality once a
session is live.

## Non-Goals

- No new live-session status panel/banner. Reuse the estimate area + cards.
- No per-model RAM attribution beyond a best-effort RSS delta.
- TTS memory is not measured (no `resolved` entry; ~60 MB). It stays out of
  the actual readout.
- No capture of runtime activation/KV growth — the load-time footprint
  (reserved VRAM / RSS delta) is the reported number.

## Architecture

The reason and the memory numbers ride the **existing pipe**, unchanged in
shape:

```
engine.init  →  ReadyMsg  →  client.init()  →  LocalNativeClient  →  resolved store  →  render
```

Two fields are added to that pipe; everything else is measurement at one end
and rendering at the other.

### Data model

`ReadyMsg` (`src/lib/local-inference/native/nativeProtocol.ts`) gains one
field and reuses one that already exists:

- `memoryBytes?: number` — **new.** Measured footprint of the loaded model on
  its device. Interpreted as VRAM or RAM by the existing `device` field (no
  separate `vramBytes`/`ramBytes`).
- `fallbackReason?: string` — **already declared, currently vestigial.**
  Populated with the `load_with_fallback` notice.

The renderer `resolved` objects
(`nativeModelStore.ts`: `asrResolved`, `translationResolved`) gain the same
two optional fields: `memoryBytes?: number`, `fallbackReason?: string`.

The client init return types (`NativeAsrClient.init`,
`NativeTranslateClient.init`) forward `memoryBytes` and `fallbackReason` from
the ready message (they already forward `device`/`rtf`/`tokensPerSec`).

### Measurement (sidecar engines)

In each engine's `init`, where `measure_rtf` / `measure_tps` already run, wrap
the existing `load_with_fallback(plans)` call with deltas. No change to
`load_with_fallback`'s signature.

- **VRAM:** `free_before = accel._cuda_free_bytes()` immediately before the
  load, `free_after` immediately after; `memoryBytes = free_before -
  free_after` **only when the resolved `plan.device == "cuda"`**. This is the
  reserved VRAM the model made unavailable (torch reserves ≥ allocated), which
  is the user-meaningful "how much of my card is gone" number. A failed-then-
  freed GPU attempt during a degrade nets out of the delta.
- **RAM:** an RSS delta around the same call, **only when `plan.device ==
  "cpu"`**, via a best-effort `accel._rss_bytes()` helper:
  `/proc/self/status` (`VmRSS`) on Linux, `resource.getrusage(RUSAGE_SELF)`
  elsewhere (normalising the KiB-vs-bytes unit), `None` on failure. No psutil
  dependency.
- **Reason:** the `notice` returned by `load_with_fallback` is assigned to
  `fallbackReason` in the ready payload (replacing the discarded `_notice`).

All measurement is best-effort: any `None` or non-positive result omits
`memoryBytes`; the renderer then shows device + speed only and the estimate
area falls back to the pre-session estimate. **No negative or zero memory is
ever shown.**

### Degrade detection

`fallbackReason` is the single, unambiguous degrade signal:

- Clean GPU load → `load_with_fallback` skips nothing → notice `None`.
- Explicit-CPU choice (`device: 'cpu'`) → resolver pins CPU first, skips
  nothing → notice `None`.
- Auto + GPU too small → gate skips the cuda plan → notice set.

Therefore: `device === 'cpu' && fallbackReason` ⟹ **degraded** (warn styling);
`device === 'cpu'` without `fallbackReason` ⟹ **chosen CPU** (neutral). No
separate "requested vs resolved" comparison is needed.

## Display

Two existing surfaces are enriched. JSX stays thin; the logic lives in pure,
unit-tested helpers in `nativeCatalog.ts`.

### A. Model-card tier tag (`NativeModelManagementSection`, ~`:102-126`)

The tag gains a **capability vs live** distinction plus a health color. A pure
helper `resolvedTierState(resolved, fallbackReason)` returns
`{ tier, live, degraded, memoryMb }` driving four states:

| State | Trigger | Treatment |
|---|---|---|
| **Capability** (idle) | no matching `resolved` | muted/outline, as today — `GPU·CUDA` = *"supports CUDA"* |
| **Live · GPU** | `resolved.device === 'cuda'` | highlighted accent (existing `model-ok` color `#10a37f`) + `· 67× · 8.1 GB` |
| **Live · CPU (chosen)** | `device === 'cpu'`, no `fallbackReason` | highlighted-live but **neutral** (not accelerated) + `· 12× · 4.2 GB` |
| **Live · CPU (degraded)** | `device === 'cpu'` **+** `fallbackReason` | warning accent (existing `model-warn` color) + a `⚠ Low VRAM → CPU` chip; full notice on hover (`title`) |

Defining signal: **idle = muted, live = highlighted**; color further encodes
GPU (green) vs degraded-CPU (warn). Reuses the `model-ok` / `model-warn`
color semantics already used by the TTS chip in this file — no new tokens.
The actual memory (`memoryMb`) is appended to the existing speed metric.

### B. Estimate area (`ProviderSection`, the existing memory-estimate block)

Becomes state-aware, resolving the estimate-vs-reality conflict:

- **Before connect / selection changed** → unchanged: `Estimated · VRAM ~12 GB
  · RAM ~120 MB` (the pre-session `estimateNativeMemoryByDevice`).
- **After connect, resolved matches current selection** → **actuals**: `In use
  · VRAM 8.1 GB · RAM 4.2 GB`, from a pure helper
  `actualNativeMemoryByDevice(asrResolved, translationResolved)` that sums
  `memoryBytes` by real `device`. A degraded Qwen's bytes correctly land in
  **RAM**, not VRAM.
- **If any stage degraded** → a one-line note: `Translation on CPU — not
  enough VRAM`.

**Stale-data guard:** actuals show only when `asrResolved.model` /
`translationResolved.model` match the currently-selected ids — the same
`model === selectId || model === downloadId` check the card already uses.
Change a model and it reverts to the estimate until the next connect.

## Components / files

| File | Change |
|---|---|
| `sidecar/sokuji_sidecar/accel.py` | add `_rss_bytes()` best-effort helper |
| `sidecar/sokuji_sidecar/asr_engine.py` | VRAM/RSS delta around `load_with_fallback`; put `memoryBytes` + `fallbackReason` in the ready payload |
| `sidecar/sokuji_sidecar/translate_engine.py` | same as ASR engine |
| `src/lib/local-inference/native/nativeProtocol.ts` | add `memoryBytes?` to `ReadyMsg` |
| `src/lib/local-inference/native/NativeAsrClient.ts` | forward `memoryBytes` + `fallbackReason` from ready |
| `src/lib/local-inference/native/NativeTranslateClient.ts` | same |
| `src/services/clients/LocalNativeClient.ts` | store `memoryBytes` + `fallbackReason` into resolved |
| `src/stores/nativeModelStore.ts` | add the two fields to `asrResolved`/`translationResolved` types |
| `src/lib/local-inference/native/nativeCatalog.ts` | add `actualNativeMemoryByDevice` + `resolvedTierState` pure helpers |
| `src/components/Settings/sections/NativeModelManagementSection.tsx` | render the 4 tier-tag states via `resolvedTierState` |
| `src/components/Settings/sections/ProviderSection.tsx` | estimate-vs-actual swap + degrade note |
| relevant `.scss` | `model-ok` / `model-warn` live-tag styling if not already reusable |

## Testing

- **Pure helpers (renderer):**
  - `actualNativeMemoryByDevice` — GPU+GPU, GPU+degraded-CPU (bytes land in
    RAM), missing/zero bytes omitted.
  - `resolvedTierState` — each of the 4 states (capability, live-GPU,
    live-CPU-chosen, live-CPU-degraded).
- **Sidecar engine:** monkeypatch `_cuda_free_bytes` (simulate a positive
  delta) and `load_with_fallback` (return a notice) → assert the ready payload
  carries `memoryBytes` and `fallbackReason`; assert omission when the delta is
  `None`/≤ 0.
- **Real-GPU E2E:** extend the existing Voxtral + Qwen3.5-2B reproduction on
  the RTX 4070 — assert the engines' ready payloads carry `memoryBytes`
  (Voxtral ~8 GB on cuda, Qwen ~4 GB on cpu) and Qwen's `fallbackReason` is
  set.

## Risks / caveats

- **VRAM delta includes torch's reserved cache**, so it slightly exceeds raw
  weight bytes — intentional: it reports VRAM actually made unavailable.
- **RSS delta is approximate** (allocator/shared pages) → labeled `~`, and
  omitted when unmeasurable.
- **TTS excluded** from actuals; the actual total can differ from the estimate
  total by the (~60 MB) TTS figure. Flagged in the readout scope, not hidden.
