# Unified Auto device selection + variant recommendation (assessment)

**Date**: 2026-07-05
**Branch**: `native-torch-free`
**Status**: Assessment / proposal — no implementation yet

## 1. The three engines today (facts)

| | ASR — transcribe.cpp | Translate LLM — llama-server | Translate Opus — ORT | TTS — ORT (MOSS/Supertonic/Qwen3) | TTS — sherpa (piper) |
|---|---|---|---|---|---|
| devices | vulkan / metal / cpu (cuda loadable but measured 4–6× slower than Vulkan on Ada) | **cuda / metal / cpu — no vulkan flavor** | cpu only | cuda / cpu (ORT EPs; DML/CoreML not wired) | cpu only (catalog still has a vestigial gpu-cuda row) |
| memory behavior | whole model on one backend; doesn't fit → load fails → resolver falls back | `--fit` partial offload — never fails, degrades smoothly | tiny | whole model; proactive VRAM gate (weights×1.2 + 1GiB) then OOM-fallback | tiny |
| variants today | ONE quant per card (repos ship 6: F32/F16/BF16/Q8_0/Q6_K/Q5_K_M/Q4_K_M) | TWO quants + picker + pin (`select_variant`) | none | none | none |
| perf shape | GPU has 10–100× headroom; quality is the scarce axis | tok/s drives subtitle latency; partial offload can be slower than a smaller fully-resident quant | fast | time-to-first-audio sensitive; qwen3-tts is 4.3GB | fast |
| user override | asrDevice auto/cpu/cuda('GPU') | translationDevice + quant pin | — | ttsDevice | — |

Key structural fact: **all three stages run concurrently in one session and share
one pool of VRAM.** Today's coordination is pairwise and ad-hoc: translate's
`reserved_bytes` subtracts the ASR+TTS *download sizes*; ASR/TTS use a per-load
proactive gate. Nothing plans the session as a whole.

## 2. Environment data we can obtain

Already probed (accel.Machine):
- **`tc.backends()`** — per-device `kind` (vulkan/metal/cuda/cpu), description,
  **memory_total / memory_free**. Vendor-agnostic (sees AMD/Intel/Apple).
  Currently only `kind` is kept (`tc_kinds`) — the memory figures are the single
  most valuable unused datum.
- NVML — GPU name, VRAM total/free, compute capability (NVIDIA only).
- ORT `get_available_providers()` (CUDA/DML/CoreML), apple_silicon, OS/arch,
  cpu_cores, installed-backend set.
- **bench cache** (`accel-bench.json`) — measured RTF / tok/s / TTS-RTF per
  (machine fingerprint, model, backend, device, compute_type). Already used to
  demote a GPU slower than CPU; not yet variant-aware.

Cheap to add:
- RAM total/available (psutil already a dependency) — gates big-quant CPU picks.
- Free disk (download-time advice; a variant recommendation is also a download
  recommendation).
- Vulkan capability detail (coopmat support) — old GPUs may invert the
  vulkan-beats-cuda result; the bench cache is the safety net either way.
- CPU model string (tc reports it) for coarse CPU-speed tiers.

Not worth it now: battery/thermal state, per-process GPU accounting.

## 3. Dimensions the logic must consider

1. **Shared VRAM across stages** — per-stage greedy ≠ global optimum. The
   binding constraint on a 8–12GB card running Voxtral + an LLM + Qwen3-TTS.
2. **Different failure semantics** — llama `--fit` never fails (slows down);
   transcribe.cpp / ORT fail-and-fallback. Budget math is *mandatory* for the
   latter, *advisory* (perf-only) for the former.
3. **Opposite quant preferences by device** — GPU: quality-first (perf surplus);
   CPU: small-first (bandwidth-bound, Q4 is both faster and smaller).
4. **The partial-offload trap** — a fully-resident Q4_K_M usually beats a
   half-offloaded Q8_0. Translate's variant choice should key on "fits entirely
   in the remaining budget", not on a static rank.
5. **Latency structure per stage** — ASR: RTF per utterance; translate: first
   token + tok/s (drives subtitle lag); TTS: time-to-first-audio.
6. **Uneven vendor coverage** — AMD/Intel Linux today: ASR GPU ✓ (Vulkan),
   translate GPU ✗ (no vulkan llama flavor), TTS GPU ✗ (no DML wiring). The
   planner must allocate VRAM only to stages that can actually use it.
7. **CPU-fallback cost is not uniform** — translate CPU costs ~an order of
   magnitude in tok/s (worst UX hit); ASR CPU is fine (RTF 0.05–0.15); small
   TTS CPU is fine, qwen3-tts CPU is unusable.
8. **Measured feedback beats estimates** — the bench cache turns first-session
   estimates into second-session facts; extend keys to cover variants.
9. **User overrides always win** — per-stage device override + per-model quant
   pin (existing precedence, keep).
10. Download size / disk, and model load time (a 5GB quant also costs startup).

## 4. Proposed logic (two layers)

### Layer 1 — MachineProfile (probe once, cache by fingerprint)

```
gpus      = tc.backends() devices (kind, memory_total, memory_free)   # primary
            + NVML capability where NVIDIA                             # detail
ram_free  = psutil.virtual_memory().available
eps       = onnxruntime available providers
bench     = accel-bench.json entries for this fingerprint
paths     = which stages have a GPU path on this machine:
              asr: vulkan|metal present
              translate: cuda|metal present (llama flavors)
              tts: CUDAExecutionProvider present
```

### Layer 2 — SessionPlanner (per session config: the three chosen models)

Replace the pairwise `reserved_bytes` dance with one allocator:

```
budget = gpu.memory_free − CONTEXT_SLAB(~1GiB)

stages, in order of CPU-fallback cost (highest first):
    1. translate-LLM   (CPU = 10× slower tokens)
    2. tts IF model is GPU-needing (qwen3-tts); small TTS models rank last
    3. asr             (CPU floor is acceptable for every card)

for stage in that order:
    ladder = variant ladder for the stage's model on its best available device
             GPU ladder: quality-descending  (Q8_0 → Q6_K → Q4_K_M)
             CPU ladder: speed-ascending      (Q4_K_M only, by default)
    pick the FIRST GPU variant with need = size × ENGINE_FACTOR ≤ budget
        ENGINE_FACTOR: transcribe.cpp ~1.15 (KV small),
                       ORT-TTS 1.2 (existing gate), llama n/a (--fit)
    if picked: budget −= need; record (device=gpu, variant)
    else:
        translate-LLM special case: keep GPU via --fit with the DEFAULT quant
            *only if* budget ≥ ~50% of its size (else fully CPU is faster);
        others: (device=cpu, variant=Q4_K_M), check size×1.3 ≤ ram_free

bench correction pass:
    if bench has (model, gpu, variant) measured NOT faster than its cpu
    entry → demote to cpu (existing rule, now variant-keyed)

emit per-stage {device, variant, reason} + write chosen reserve back so a
mid-session model swap replans against reality (NVML/tc free re-read).
```

Recommendation surface (what the user sees):
- Device control stays auto/cpu/GPU per stage; "Auto" = planner output.
- Variant picker (ASR gains one on the ≥1GB cards, two rungs: Q4_K_M default,
  Q8_0 quality) shows the planner's pick as "Recommended"; pin overrides.

### Why allocation order = CPU-fallback cost, not model size

On a 12GB card with Voxtral(2.8G) + Qwen3.5-2B(1.3G) + qwen3-tts(4.3G):
everything fits. On 8GB: planner gives translate its full quant (1.3G),
qwen3-tts (4.3G), then ASR's ladder walks Q8→Q4 and lands wherever the
remainder allows — or CPU, which for ASR is a mild penalty. Sizing by
"who suffers most on CPU" degrades the *least painful* stage first.

## 5. Gap list (current → proposed)

| gap | change |
|---|---|
| tc memory figures unused | Machine gains `gpus: [(kind, total, free)]` from tc.backends() |
| ASR single-quant | add Q8_0 alt rung to the ≥1GB cards; wire variantIds (reuse translate UI) |
| translate picks quant by static rank | prefer largest quant that FULLY fits remaining budget; --fit only as fallback |
| TTS not in any budget | qwen3-tts joins the allocator; small TTS bypass |
| pairwise reserved_bytes | SessionPlanner owns one budget; reserved_bytes becomes its output |
| sherpa_tts fake gpu-cuda rows | delete (pip wheel is CPU-only) |
| RAM never checked | psutil available-RAM gate for CPU picks |
| AMD translate has no GPU | upstream ask: vulkan llama-app flavor (or accept and document) |

## 6. Risks / verify-first

- transcribe.cpp behavior when the model does NOT fit VRAM (clean error → our
  fallback works; vs driver paging → slow success): test with Voxtral Q8 +
  artificially occupied VRAM before trusting ENGINE_FACTOR.
- `memory_free` readings while llama-server (separate process) holds VRAM —
  verify tc/NVML both see it (they should; device-wide).
- Old GPUs without coopmat may invert vulkan-vs-cuda — bench cache demotion is
  the backstop; consider a one-time micro-bench on first GPU use.
- Multi-GPU boxes: v1 plans only device 0; note in code.
