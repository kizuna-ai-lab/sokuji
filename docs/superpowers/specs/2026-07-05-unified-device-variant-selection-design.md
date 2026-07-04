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
6. **Vendor coverage is a REQUIREMENT (2026-07-05)** — LLM translate and TTS
   must accelerate on AMD, Intel and Apple hardware, not just NVIDIA. See §7
   for the concrete per-platform paths; the planner allocates VRAM only to
   stages that have a GPU path on the machine, and that set grows as §7 lands.
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
| AMD/Intel translate has no GPU | add a `vulkan` llama flavor from the OFFICIAL llama.cpp release assets (see §7) |
| TTS GPU is CUDA-only | DirectML on Windows, CoreML on macOS, OpenVINO opt-in on Intel Linux (see §7) |

## 6. Risks / verify-first

- transcribe.cpp behavior when the model does NOT fit VRAM (clean error → our
  fallback works; vs driver paging → slow success): test with Voxtral Q8 +
  artificially occupied VRAM before trusting ENGINE_FACTOR.
- `memory_free` readings while llama-server (separate process) holds VRAM —
  verify tc/NVML both see it (they should; device-wide).
- Old GPUs without coopmat may invert vulkan-vs-cuda — bench cache demotion is
  the backstop; consider a one-time micro-bench on first GPU use.
- Multi-GPU boxes: v1 plans only device 0; note in code.

## 7. Vendor acceleration paths for Translate + TTS (requirement, 2026-07-05)

**Distribution context**: the sidecar ships as a SEPARATE download — the app
detects the user's OS/GPU at download time and fetches a matching prepackaged
bundle. So this section's per-platform package choices are **bundle SKUs picked
by that client-side detection**, not install-time pip logic on the user's
machine: e.g. `win-dml` (onnxruntime-directml — one SKU for all Windows GPU
vendors), `mac` (standard ORT wheel: CoreML + Metal + transcribe.cpp metal),
`linux-nvidia` (onnxruntime-gpu + nvidia wheels), `linux-cpu` (ASR still gets
Vulkan from the stock transcribe.cpp wheel). The llama-server flavor binaries
stay runtime-downloaded on demand (they're keyed to the model being used, and
the GGUF download flow already covers them). The download-time detector needs
the same probes the planner uses (GPU vendor, OS) — but only the coarse
subset; fine-grained planning still happens inside the installed sidecar.

LLM translate and TTS must accelerate on AMD / Intel / Apple, matching what
ASR already gets from transcribe.cpp's Vulkan/Metal wheel.

### Translate (llama-server) — add a `vulkan` flavor

llama.cpp's OFFICIAL releases already ship Vulkan builds
(`llama-bXXXX-bin-ubuntu-vulkan-x64.tar.gz`, `llama-bXXXX-bin-win-vulkan-x64.zip`)
— and llama_runtime already downloads official Windows assets, so this is the
same pipeline with two more assets + checksums:

- `_FLAVORS` += `vulkan`; `flavor_for_device("vulkan") = "vulkan"`.
- catalog `_llm_translate_row` tiers += `gpu-vulkan` (rank below gpu-cuda:
  NVIDIA boxes keep CUDA — for LLM decode CUDA generally still wins — AMD/Intel
  land on vulkan).
- `default_flavor()`: nvidia→cuda, apple→metal, vulkan-capable GPU (reuse
  `Machine.tc_kinds` — transcribe.cpp's probe answers for the same driver) →
  vulkan, else cpu. `required_flavors()` gains vulkan on such machines.
- `--fit` partial offload works identically on the Vulkan backend.
- Later options (measure first): SYCL flavor for Intel (official asset exists),
  HIP for AMD — only if Vulkan measurably underperforms on those parts.
- Apple: covered today (metal flavor, m1–m5 configs).

### TTS (onnxruntime) — per-platform EP matrix

| platform | package (PyPI, verified) | EP | covers |
|---|---|---|---|
| Windows, any vendor | `onnxruntime-directml` 1.24.x | DmlExecutionProvider | NVIDIA + AMD + Intel with ONE package |
| macOS | ~~CoreML EP~~ **CPU by default** — see the CoreML verdict below | — | Apple Silicon CPU is fast enough for MOSS/Supertonic/piper |
| Linux NVIDIA | `onnxruntime-gpu` (today) | CUDA EP | NVIDIA |
| Linux Intel | `onnxruntime-openvino` 1.24.x (opt-in) | OpenVINO EP | Intel GPU/NPU |
| Linux AMD | none on PyPI (ROCm EP needs a custom build) | — | CPU for now |

**CoreML verdict (investigated 2026-07-05, no Mac needed):** the macOS
`onnxruntime` 1.23.2 wheel WAS inspected directly — CoreML EP is compiled in
(MLProgram symbols + shipped op list), WebGPU EP is NOT (zero `wgpu*` symbols;
the provider name string is just registry boilerplate). But the CoreML
MLProgram op list has only **45 ops** — no Gather / Where / Equal / Range /
Expand / Exp / Sin / Cos / Neg / Tile / Pad / ScatterND / Einsum. Cross-checked
against our actual TTS graphs (op histograms from the cached ONNX files):

| model | compute nodes | CoreML-unsupported |
|---|---|---|
| MOSS-TTS LM (5 graphs) | 6,676 | 24% (Gather 630, Where 157, …) |
| MOSS audio tokenizer | 7,176 | 18% (Gather 636, Range 133, …) |
| Qwen3-TTS (16 graphs) | 29,078 | 27% (Gather 2,312, Where 1,022, …) |

The unsupported ops sit inside EVERY transformer layer, so partitioning
shatters the graph into hundreds of tiny CoreML islands with CPU⇄ANE copies at
every seam — a net SLOWDOWN, not partial acceleration. CoreML EP is built for
static-shape CV graphs, not AR decoders with dynamic KV caches. **Do not wire
a CoreML tier.**

macOS TTS plan instead:
- default = **CPU**: Apple-Silicon CPU comfortably runs MOSS 100M /
  Supertonic 66M / piper (they already run on x86 CPU today);
- qwen3-tts (0.6B/1.7B) tier-gates OFF on the mac SKU short-term;
- mid-term direction for heavy models on Mac (user, 2026-07-05): REPLACE the
  model or use a Mac-suited export rather than forcing the ONNX graph through
  a weak EP — most likely **MLX** with `mlx-community` exports (Apple's
  Apple-Silicon-native framework; unified memory; active export community —
  e.g. mlx-community already ships Fun-ASR-MLT-Nano fp16/8bit/4bit). accel.py
  already reserves an "mlx" backend slot in the installed map. The custom
  ORT-WebGPU-EP build stays only as a fallback idea if MLX lacks an export.

Wiring (Windows unchanged, macOS revised):
- `tts_backends` device→providers map grows: `dml` → `["DmlExecutionProvider", cpu]`.
  Before advertising the tier, run the same op-histogram check against the DML
  op list (DML covers far more ops than CoreML — Microsoft runs LLMs on it —
  so it is EXPECTED to pass, but verify, not assume).
- catalog TTS rows: += `gpu-dml` tier only. No gpu-metal/CoreML tier.
- probing already exists: `_dml_adapters()` reads ORT's provider list; CoreML
  likewise appears in `get_available_providers()` on macOS.
- setup.sh flavor: Windows default becomes `onnxruntime-directml` (one package,
  all vendors — simpler than CUDA + cuDNN wheels; NVIDIA-on-Windows can opt
  into CUDA later if DML measurably underperforms); macOS keeps the standard
  wheel; Linux keeps the CUDA/CPU split with OpenVINO as an Intel opt-in.
- Linux AMD TTS stays CPU short-term (MOSS 100M / Supertonic 66M are fine on
  CPU; qwen3-tts tier-gates off). Revisit if ROCm EP wheels appear or if we
  ever move TTS decode to a ggml runtime.

### Resulting coverage after §7 lands

| stage | NVIDIA | AMD | Intel | Apple |
|---|---|---|---|---|
| ASR | Vulkan ✓ (today) | Vulkan ✓ (today) | Vulkan ✓ (today) | Metal ✓ (today) |
| Translate | CUDA ✓ | Vulkan (new flavor) | Vulkan (new flavor) | Metal ✓ |
| TTS | CUDA ✓ / DML on Win | DML on Win; Linux CPU | DML on Win / OpenVINO opt-in | CPU for small TTS; heavy models → MLX (mlx-community exports), future work |

## 8. End-state design (v2) — after §7 lands, per bundle SKU

### 8.1 The three engines, fully implemented, per SKU

| SKU (picked at download by OS/GPU detection) | ASR | Translate LLM | TTS | memory topology |
|---|---|---|---|---|
| linux-nvidia | vulkan | cuda (llama flavor) | CUDA EP | one discrete VRAM pool shared by ALL THREE (different APIs, same silicon) + RAM |
| linux-generic (AMD/Intel) | vulkan | vulkan (new flavor) | cpu (OpenVINO opt-in on Intel) | discrete VRAM shared by ASR+translate; TTS in RAM |
| win-dml | vulkan | cuda on NVIDIA / vulkan on AMD-Intel | DML EP (all vendors) | one discrete VRAM pool shared by all three |
| mac | metal | metal (llama flavor) | **cpu** (CoreML EP rejected — op coverage; heavy TTS gated, WebGPU-EP build is the mid-term option) | **unified memory: ONE pool for GPU work AND RAM** |
| cpu-only | cpu | cpu | cpu | RAM only |

Two consequences the v1 sketch missed:

- **Budget is per PHYSICAL DEVICE, not per API.** On win-NVIDIA the session may
  run ASR-on-Vulkan + translate-on-CUDA + TTS-on-DML — three APIs, one card,
  one VRAM pool. The probe layer must unify tc.backends() / NVML / ORT-EP
  reports into one device registry entry.
- **Apple unified memory changes the degrade move.** Moving a stage to "CPU"
  frees no memory there (same pool); the only memory-relieving degrade is a
  smaller quant. Conversely there is no hard VRAM cliff — Metal's working-set
  limit (~70% of RAM) is the budget.

### 8.2 DeviceRegistry (probe layer, runtime, inside the sidecar)

```
Device := { vendor, name, mem_total, mem_free,
            apis: subset of {vulkan, metal, cuda, dml, coreml},
            unified: bool }          # true on Apple Silicon

sources: tc.backends()  → device identity + mem figures (vulkan/metal/cpu)
         NVML           → NVIDIA detail (capability; cross-check mem)
         ORT providers  → whether dml/coreml/cuda EPs exist in THIS bundle
         merge key: device name (v1: assume ≤1 discrete GPU; multi-GPU later)

StagePath(stage) := ordered accelerator list this SKU+machine offers, e.g.
    linux-nvidia:  asr=[vulkan], translate=[cuda], tts=[cuda]
    mac:           asr=[metal],  translate=[metal], tts=[]   # cpu (CoreML rejected)
    (cpu always implicit floor)
```

The download-time detector needs only the coarse projection of this (OS +
GPU vendor) to pick the SKU; the registry above runs inside the installed
sidecar where the runtimes can be queried directly.

### 8.3 Variant ladders (end state)

| stage | GPU ladder (quality-descending) | CPU pick | notes |
|---|---|---|---|
| ASR ≥1GB cards | Q8_0 → Q6_K → Q4_K_M | Q4_K_M | per-card default from the author's WER table (e.g. Fun-ASR keeps Q6_K) |
| ASR small cards | fixed single quant | same | no picker |
| translate LLM | largest quant FULLY resident (Q8_0 → Q4_K_M) | Q4_K_M | --fit partial offload only when nothing fits AND budget ≥ ~50% of size |
| TTS | single variant today | — | hook for qwen3-tts fp16/int8 later |

### 8.4 SessionPlanner v2

```
plan(session = {asr_model, translate_model, tts_model}, dev = registry.gpu):

  if dev is None:                            # cpu-only SKU/machine
      every stage: (cpu, cpu-pick); check Σ sizes×1.3 ≤ ram_free; done

  if dev.unified:                            # Apple
      budget = dev.mem_total × 0.70 − foreign_usage
      # degrade move = smaller quant (never "to CPU" for memory reasons);
      # walk ALL stages down their ladders together until Σ needs ≤ budget,
      # shrinking in reverse CPU-cost order (asr first, translate last)
  else:                                      # discrete GPU
      budget = dev.mem_free − CONTEXT_SLAB(~1GiB)
      allocate stages in CPU-fallback-cost order
          (translate → gpu-needing TTS → asr):
          take the first ladder rung with size×ENGINE_FACTOR ≤ budget,
          subtract; exhausted ladder → stage-specific fallback:
              translate: --fit rule above, else cpu
              tts/asr:   cpu (RAM-checked)

  bench pass (all platforms): any (model, device, quant) measured
      not-faster than its cpu entry → demote; measurements accumulate
      per machine fingerprint, so second sessions start from facts.

  emit per stage {device, variant, reason};  reasons surface in the UI
      ("Auto: Q8_0 on GPU · fits 4.7GB of 10.9GB free"), and the variant
      picker marks the planner's rung as Recommended.

re-plan triggers: model change, device-override change, session start
  (mem_free re-read — llama-server and other apps move it), bench update.
```

### 8.5 Division of labor (who decides what, when)

| decision | where | when | inputs |
|---|---|---|---|
| bundle SKU | app (Electron), download flow | sidecar download | OS + GPU vendor (coarse) |
| stage accelerator KIND | fixed by SKU (§8.1 StagePath) | install | — |
| use GPU vs CPU per stage ("Auto") | SessionPlanner | session start / re-plan | registry mem figures, budget, bench |
| quant rung | SessionPlanner ladder walk | same | budget + WER-table ranks |
| overrides | user | any time | device toggle per stage; quant pin per model |

### 8.6 v2 verify-first additions

- Same-card multi-API accounting: allocate via CUDA then read Vulkan
  mem_free (and vice versa) — confirm each API sees the other's usage.
- Metal working-set behavior at the 70% line (graceful vs jetsam).
- ~~CoreML op coverage~~ DONE (2026-07-05): rejected — 18–27% of compute
  nodes unsupported, scattered through every layer. DML op coverage: run the
  same op-histogram check (expected to pass; verify).
- Vulkan llama flavor tok/s vs CUDA on the same NVIDIA card (decides the
  flavor ranking for the win-dml SKU on NVIDIA).
