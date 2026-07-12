# Native ASR Hardware Acceleration (Electron Sidecar)

**Date**: 2026-06-22
**Status**: Design
**Tracking**: #129 (native local inference). Builds on `2026-06-21-native-python-sidecar-local-inference-design.md`. Related model-integration specs: `2026-03-18-parakeet-tdt-integration`, `2026-03-27-voxtral-full-integration-design`, `2026-03-28-cohere-transcribe-integration-design`, `2026-04-01-granite-speech-integration-design`.

## Summary

The native Python sidecar runs ASR on the **CPU only** today: `asr_engine.py`
hard-codes `_build_sherpa` (CPU) and `_build_faster_whisper` (`device='cpu'`,
fixed `compute_type`). It has no notion of "this machine has an NVIDIA GPU /
Apple Silicon / a DirectML adapter — use it." Because we ship a *native*
backend specifically to exploit the user's hardware (CPU **and** GPU **and**
NPU), this is the central gap.

This spec adds a **hardware-acceleration layer** that, for any ASR model, looks
at the user's actual hardware and runs the fastest backend+device the model
supports — with CPU as a guaranteed floor — without `asr_engine.py` or the
renderer knowing anything about CUDA / Metal / DirectML.

The design is **Approach A — adapter interface + resolver + declarative
catalog**:

- **`AsrBackend` adapter** — one class per framework (CTranslate2, sherpa-onnx,
  llama.cpp, MLX, onnxruntime), all implementing `load(model, device,
  compute_type)` → `transcribe(samples) → text`. The only code that touches a
  framework's real API.
- **`accel.py` resolver** — the single owner of hardware probing, the
  `(model, machine, override) → ordered Plans` decision, a one-time benchmark
  cache, manual override, and the fallback chain.
- **`catalog.py`** — pure data: per-model, which backends/hardware tiers it
  supports and what to download for each. Adding a model is adding a row.

ASR is built fully; the resolver and adapter contract are structured so
translation and TTS acceleration are additive later, not a rewrite.

## Goals

- For each ASR model, **automatically select** the fastest available
  backend+device on the user's machine (prefer GPU/NPU), with a **CPU floor**
  that always works, plus a **manual device override**.
- Keep `asr_engine.py` and the renderer **hardware-agnostic** — all hardware
  knowledge lives in `accel.py` + the adapters.
- Cover the accelerator landscape: NVIDIA (CUDA), Apple Silicon (MLX/Metal),
  Windows any-GPU (DirectML/Vulkan), CPU-int8 everywhere.
- **One comprehensive spec**, implementation **phased** (CPU floor → one-GPU
  proof → speech-LLM tier → full per-platform coverage).
- Distribution is **tiered download-on-demand**: a small CPU-floor sidecar for
  everyone; heavy accelerator packs only on machines that can use them.

## Non-Goals

- **Translation and TTS hardware acceleration** — the resolver/adapter
  contract is *built to extend* to them (`probe()` and the `Plan`/fallback
  machinery are stage-agnostic), but their catalogs/adapters are separate
  future specs.
- **Packaging & signing mechanics** — signing-key custody, the pack-build CI
  pipeline, CDN cache/invalidation. This spec fixes the distribution *model*
  and the integrity *requirement*; the *how* is a downstream packaging spec.
- **Phase-2 per-model speech-LLM research** (exact quant levels, prompt
  formats per model) — scoped when Phase 2 starts.
- **Extension / web builds** — no native host; they keep WASM workers
  unchanged.

## Locked Decisions

| Decision | Choice |
|---|---|
| Architecture | **Approach A**: `AsrBackend` adapter + `accel.py` resolver + declarative `catalog.py` |
| Scope of this spec | **ASR only**, resolver built to extend to translation/TTS |
| Device selection | **Auto-detect + one-time benchmark** (prefer GPU/NPU, CPU floor) **+ manual override** |
| Distribution | **Tiered download-on-demand**: runtime → backend pack (per hardware) → model artifact (per plan) |
| sherpa-onnx GPU | **No** — sherpa stays the **CPU-int8 tier**; acceleration comes from other backends (see Backend/Hardware Matrix) |
| Backend selection is **per-model** | The catalog declares hardware tiers per *deployment row*, not per framework |
| CPU floor | Guaranteed **at the system level** (Whisper + sense-voice always have CPU deployments); individual models **may be GPU-only** (e.g. Voxtral) and are gated off on CPU-only machines |
| macOS speech-LLM path | **MLX** (beats GGUF on Apple Silicon); GGUF/llama.cpp elsewhere |

### Backend → model → hardware matrix

| Framework | Serves | Hardware tiers | Notes |
|---|---|---|---|
| **CTranslate2** (faster-whisper) | Whisper family | CPU-int8 **+** CUDA-fp16 | One converted dir; tiers differ only by `compute_type`. The workhorse + CPU floor. Verified `ct2` sees the dev RTX 4070. |
| **sherpa-onnx** | sense-voice, parakeet, reazonspeech | CPU-int8 only | pip wheel is CPU-only; GPU not worth it for these models (see below). |
| **llama.cpp** (GGUF + `libmtmd` audio) | Qwen3-ASR, Voxtral, Granite, Cohere | CPU + Metal/CUDA/Vulkan | The speech-LLM tier; `libmtmd` audio harness added upstream Apr 2026. |
| **MLX** | same speech-LLM tier | Metal (Apple Silicon only) | Best-in-class on Mac; large community download counts vs ONNX. |
| **onnxruntime** | (reserved: opus-mt / TTS later; parakeet/whisper-onnx if added) | CPU + DirectML/CoreML/CUDA | The eventual translation/TTS-shared adapter; lightly populated for ASR launch. |

### Why sherpa-onnx stays CPU-only (evidence)

Verified against the installed wheel **and** authoritative k2-fsa sources:

- The installed `sherpa_onnx 1.13.3` bundles only `libonnxruntime.so` (no
  CUDA/cuDNN libs); `OfflineModelConfig.provider` defaults to `'cpu'`.
- GPU requires a **separate** `1.13.3+cuda12.cudnn9` wheel from k2-fsa's own
  index (~245 MB, **mutually exclusive** with the CPU wheel, pins CUDA 12.x +
  cuDNN 9, NVIDIA-only).
- **DirectML** is source-build-only (`SHERPA_ONNX_ENABLE_DIRECTML`); not in any
  prebuilt wheel.
- **CoreML** ships in macOS binaries but is *measured slower than CPU* for
  transformer ASR (k2-fsa/sherpa-onnx#2910: RTF 0.470 CoreML vs 0.427 CPU; ANE
  op fallback).
- The small models sherpa serves (sense-voice-int8, parakeet, reazonspeech) are
  already near-real-time on CPU; GPU value is large-model/batch/server, and
  host↔device overhead can make small-model GPU runs net-negative.

Consequence: the small-model tier declares **only `cpu`**. A user with a GPU who
picks sense-voice runs on CPU (already real-time); for GPU acceleration the UI
steers them to Whisper or a speech-LLM model. **Acceleration is a property of
the model+backend you escalate *to*, never bolted onto sherpa.**

## Architecture

Three layers, one new seam between `asr_engine.py` and the frameworks.

```
renderer (LocalNativeClient) ── asr.init { model, device?: auto|cpu|cuda|... }
        │
        ▼
asr_engine.py ───────────────── "I need model X running"   (knows no hardware)
        │
        ▼
accel.py  (RESOLVER) ────────── (model, machine, override) → [Plan, Plan, …]
        │                        owns: probe · decide · benchmark/cache · fallback
        ▼
AsrBackend (ADAPTER) ────────── load(model, device, compute_type) → transcribe → text
        │  CTranslate2 · Sherpa · LlamaCpp · Mlx · Onnx
        ▼
catalog.py (DECLARATIVE) ─────── per-model: backends/hardware tiers + download artifacts
```

- **`asr_engine.py`** depends only on the abstract `AsrBackend` contract, not
  on `WhisperModel` / `OfflineRecognizer` — dependency inversion. Swapping
  CT2→llama.cpp for the same model is invisible upstream.
- **The resolver is the single owner** of "which backend on which device":
  probe + decision + benchmark + fallback in one testable place.
- **The catalog is pure data** — "add a model = add a row", and the resolver is
  unit-testable against a fake catalog with no models present.

### The `AsrBackend` adapter interface

```python
class AsrBackend(Protocol):
    name: str                         # "ctranslate2"|"sherpa"|"llamacpp"|"mlx"|"onnx"
    def load(self, model_dir: Path, device: str, compute_type: str) -> None: ...
    def transcribe(self, samples: np.ndarray, language: str | None) -> AsrResult: ...
    def unload(self) -> None: ...     # deterministic VRAM/GPU teardown
    @property
    def is_loaded(self) -> bool: ...

# device       = "cpu"|"cuda"|"metal"|"vulkan"|"dml"|"coreml"
# compute_type = "int8"|"int8_float16"|"float16"|"q4_k_m"|...  (backend interprets)
# samples      = float32 mono 16 kHz, [-1,1]  (unchanged from asr_engine today)
# AsrResult    = { text, language?, segments?[] }
```

The backend is **told** its device by the resolver; it does not decide its own.
It raises `BackendLoadError` if it cannot honor `(device, compute_type)` — that
drives fallback. `device`/`compute_type` are a **narrow waist**: a small
vocabulary the resolver speaks, each backend translates locally (`compute_type`
for CT2 vs `n_gpu_layers` for llama.cpp).

**The five adapters** (each lazy-imports its framework inside `load()`, so an
absent package fails only its own `load()`, never the sidecar startup):

| Adapter | Wraps | Honors | `load` | `transcribe` |
|---|---|---|---|---|
| CTranslate2Backend | `faster_whisper.WhisperModel` | cpu(int8), cuda(fp16/int8_fp16) | `WhisperModel(dir, device, compute_type)` | `model.transcribe()` → join segments |
| SherpaBackend | `sherpa_onnx.OfflineRecognizer` | cpu(int8) | `from_sense_voice` / `from_transducer` per family | createStream→acceptWaveform→decode→getResult |
| LlamaCppBackend | `llama-cpp-python` + `libmtmd` | cpu, metal, cuda, vulkan | `Llama(gguf, mmproj=audio_encoder, n_gpu_layers)` | feed audio token + prompt → decode |
| MlxBackend | `mlx_lm` / `mlx-whisper` | metal | load MLX weights (`-MLX-4bit` repos) | MLX generate |
| OnnxBackend | `onnxruntime.InferenceSession` | cpu, dml, coreml, cuda | session with resolved EP | ONNX graph (reserved) |

`unload()` is explicit (not GC-reliant) because Python's GC won't promptly free
VRAM and a mid-session model switch would otherwise OOM the GPU.

### `accel.py` — probe · resolve · benchmark · override

**Probe** (once per process, cached):

```python
@dataclass(frozen=True)
class Machine:
    os: str; arch: str; cpu_cores: int
    nvidia: list[Gpu]          # via ct2.get_cuda_device_count()+name
    apple_silicon: bool        # Darwin + arm64
    dml_adapters: list[str]    # onnxruntime 'DmlExecutionProvider' adapters
    installed: set[str]        # backends that import OK
    fingerprint: str           # hash(os,arch,gpu names) → benchmark cache key
```

Detection is cheap and degrades safely: if GPU detection throws, the
accelerator is treated as **absent** (you get the CPU floor).

**Resolve** → an **ordered list** of plans (selection = take the best; fallback
= take the next; one mechanism):

```python
@dataclass(frozen=True)
class Plan:
    backend: str; device: str; compute_type: str
    artifact: Artifact; rank: float

def resolve(model_id: str, override: str = "auto") -> list[Plan]:
    # 1. candidates ← catalog row for model_id
    # 2. filter to backend in machine.installed AND hardware present (CPU always survives)
    # 3. rank by tier weight (GPU/NPU >> CPU-int8); overwrite rank with measured RTF if cached
    # 4. override wins last: "auto" keeps order; "cpu"/"cuda"/... pins that tier to front
    # 5. return ordered list (CPU floor last)
```

**Benchmark/cache**: on a plan's first successful load, run one fixed ~5 s clip
through `transcribe`, measure RTF, write to
`~/.cache/sokuji-sidecar/accel-bench.json` keyed by
`(fingerprint, model_id, backend, device, compute_type)`. Feeds the UI ("≈4×
real-time") and demotes a GPU plan that benchmarks slower than the CPU floor.
One-time per machine+model+plan, never on the hot path, only the chosen plan
(not a full sweep). Best-effort: a benchmark that throws just omits the RTF.

**Extensibility seam**: `probe()` returns a stage-agnostic `Machine`;
`resolve()` is parameterized by `(catalog, rank_policy)`. A future
`resolve(model, catalog=TRANSLATION_CATALOG)` reuses the same probe, ranking,
cache, override, and fallback.

The seam in `asr_engine.py`:

```python
plans   = accel.resolve(model_id, override=device)   # was: if model.startswith("whisper"): _build_faster_whisper(...)
backend = load_with_fallback(plans)                  # tries plans in order, CPU floor last
text    = backend.transcribe(samples, language)
```

### Declarative catalog

```python
@dataclass(frozen=True)
class Deployment:
    backend: str           # "ctranslate2"|"sherpa"|"llamacpp"|"mlx"|"onnx"
    tier: str              # "cpu"|"gpu-cuda"|"gpu-metal"|"gpu-vulkan"|"gpu-dml"
    compute_type: str
    artifact: Artifact     # repo + files for THIS deployment (may be shared)
    rank: float

@dataclass(frozen=True)
class AsrModel:
    id: str; name: str
    languages: list[str]   # verified from HF model cards (see below)
    size_mb: int           # the resolved artifact's size
    deployments: list[Deployment]
    recommended: bool; sort_order: int
```

Two invariants this schema encodes:

1. **Not every model needs a CPU floor.** The *system* always has one (Whisper +
   sense-voice). An individual model may be **GPU-only** (Voxtral); on a
   CPU-only machine it is *incompatible* and gated off, reusing the existing
   language-incompatible card treatment.
2. **Artifact-per-deployment → per-platform download.** The resolver picks the
   plan first; only that plan's artifact downloads (Mac→MLX repo, Windows→GGUF,
   NVIDIA-Linux→CT2-CUDA dir). No user downloads a backend pack they can't run.

**Source of truth**: `catalog.py` is authoritative; the renderer *queries* it
(extending the established "sizes come from the sidecar" pattern). `models_catalog`
returns per-machine tier availability computed by `resolve()`. `nativeCatalog.ts`
becomes a thin presentational mapper, not a second source of capability data.

### ASR model rows (languages verified from HuggingFace model cards)

| Model | Backend → tier | Languages (verified) | Floor? | Source note |
|---|---|---|---|---|
| **whisper-large-v3-turbo** (CT2) | CTranslate2 → cpu-int8 + gpu-cuda-fp16 | multilingual, 99-language set | ✅ | turbo fine-tuned on 98 (Cantonese `yue` degraded; use large-v3 if needed). `distil-large-v3` is **English-only** — available only as a fast en option. |
| **sense-voice** (small) | sherpa → cpu-int8 | zh, en, ja, ko, yue (5) | ✅ | Mandarin *inference* token is `zn`, store `zh` in config. |
| **parakeet-tdt-0.6b-v3** | sherpa → cpu-int8 | 25 EU langs: bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro sk sl es sv ru uk | — | v2 is English-only; pinned to **v3**. |
| **reazonspeech** (k2-v2) | sherpa → cpu-int8 | ja (1) | — | Japanese-only. |
| **qwen3-asr-0.6b** | MLX → gpu-metal · llama.cpp → gpu-cuda/gpu-vulkan/cpu | 52 (30 languages + 22 Chinese dialects) | (cpu q4) | The *open-weights* 52 — **not** Flash-API's 11. |
| **qwen3-asr-1.7b** | same as 0.6b | 52 (same set) | — | Bigger/more accurate. |
| **voxtral-mini-3b** | llama.cpp → gpu-* · MLX → gpu-metal | 8: en es fr pt hi de nl it | ❌ GPU-only | CPU ~6× slower than real-time → no CPU deployment. |
| **granite-speech-4.1-2b** (base) | llama.cpp → gpu-*/cpu · MLX → gpu-metal | 6: en fr de es pt **ja** | (cpu q4) | Base chosen over `-2b-plus` (5 langs, **no ja**) — ja is core for the app. |

(Cohere and other speech-LLMs are Phase-2 rows; the schema already fits them.)

## Data flow & protocol

```
renderer                       sidecar Conn            accel.py / AsrBackend
  hardware_info ─────────────▶  probe() [cached]
  ◀── hardware_info_result ───  {os, gpus, backendsInstalled, accelAvailable}
  models_catalog ────────────▶  per-model: resolve() → tiers available HERE
  ◀── models_catalog_result ──  [{id, languages, sizeMb, tiers:[{tier,available,estRtf?}]}]
  model_download {id,device} ─▶ plan = resolve(id,device)[0]; download plan.artifact
  ◀── model_progress / done ──
  asr.init {model,device,vad} ▶ plans = resolve(model,override); load_with_fallback(plans)
  ◀── ready {backend,device,computeType,rtf?,fallbackReason?} ─  what ACTUALLY loaded
  [binary 16 kHz frames] ────▶  backend.transcribe(samples, lang)
  ◀── result {text, …} ───────
```

Protocol delta (grounded in the existing `nativeProtocol.ts`):

| Message | Dir | Status | Shape |
|---|---|---|---|
| `hardware_info` / `_result` | req/res | new | `{os, arch, cpuCores, gpus:[{vendor,name,vramMb}], backendsInstalled, accelAvailable}` |
| `models_catalog` / `_result` | req/res | new | `models:[{id,name,languages,sizeMb,recommended,tiers:[{tier,backend,available,estRtf?}]}]` — source-of-truth feed |
| `asr.init` request | req | extend | add `device?: 'auto'|'cpu'|'cuda'|'metal'|'vulkan'|'dml'` (default `auto`) |
| `ReadyMsg` | res | extend | add `backend?, device?, computeType?, rtf?, fallbackReason?` (resolved plan after fallback) |
| `model_download` request | req | extend | add `device?` so the downloaded artifact matches the plan that will run |
| `ModelProgressMsg`, `ModelDownloadDoneMsg` | res | reuse | non-blocking + cancellable, unchanged |
| `AsrResultMsg` (`type:'result'`) | res | reuse | transcribe output backend-agnostic, unchanged |
| `ErrorMsg` (model-tagged) | res | reuse | `model_not_downloaded` and the final `backend_load_failed` |

**`resolve()` runs twice, consistently**: at download (pick the artifact) and at
init (pick load order) — same function, same inputs, so the downloaded artifact
is one init will use. CT2 Whisper shares one artifact across cpu/cuda (no
re-download on override change). For the speech-LLM tier, MLX vs GGUF are
different files; a genuine cross-artifact switch is detected at init as
`model_not_downloaded` and prompts a download — **never a silent re-download or
silent failure.** The hot path (`transcribe` + its result) does not change at
all; all new surface is in setup.

## Distribution — tiered download-on-demand

```
Tier 1 RUNTIME       Python + base sidecar (WS server, thin deps)     once, signed
Tier 2 BACKEND PACK  framework wheels/binaries for THIS machine       CPU floor always;
                     (composed from probe())                          accel pack iff hardware
Tier 3 MODEL ARTIFACT weights for the resolved plan                   per chosen model+plan
```

- **Base sidecar ships download-on-demand + signed** (no Python in the
  installer); `native-host-manager` downloads, verifies, and spawns it on first
  LOCAL_NATIVE use.
- **Mutual exclusivity rule**: `onnxruntime` / `-gpu` / `-directml` (and sherpa
  CPU vs CUDA, CT2 CPU vs CUDA) clobber the same install dir — ship exactly one
  variant. Tier 2 is **probe-then-install the correct variant**, never both.

| Platform | CPU floor (always) | Accelerator pack (iff hardware) |
|---|---|---|
| Linux x64 | faster-whisper(CT2-CPU) + sherpa(CPU) + onnxruntime(CPU) + llama.cpp(CPU) | NVIDIA: CT2-CUDA + onnxruntime-gpu + llama.cpp-CUDA (+cuDNN) |
| Windows x64 | same CPU floor | any-GPU: onnxruntime-DirectML + llama.cpp-Vulkan; NVIDIA also: CT2-CUDA |
| macOS arm64 | sherpa(CPU) + CT2-CPU + onnxruntime(CPU) | Apple Silicon: MLX + mlx-lm + whisper.cpp-Metal + llama.cpp-Metal |

The CPU floor is **torch-free** (faster-whisper uses CTranslate2; sherpa is
standalone) → a few hundred MB, not gigabytes. torch enters only on machines
that pull a pack needing it.

- **Hosting/versioning**: CDN static artifacts
  `sidecar-<ver>-<os>-<arch>-<accel>.tar.zst`, pinned to the sidecar version;
  changed packs re-download on app update (hash diff).
- **Integrity (non-negotiable — executable code)**: every bundle carries a hash
  manifest + signature; verify signature → verify per-file hashes → extract →
  spawn. A failed check aborts; it never runs unverified bytes. (Signing-infra
  *mechanics* are the separate packaging spec.)

## UI & gating

The LOCAL_NATIVE settings already render per-stage `ModelGroup`s of
`ModelCard`s (shared with LOCAL_INFERENCE via `ModelManagementControls.tsx`).
Four additions, all reusing existing affordances:

1. **Tier badge** on each ASR card from `tiers[].available` (`⚡ GPU · CUDA` vs
   `CPU`) — sibling to the existing `model-card__lang-tag`.
2. **Hardware-gated cards** reuse the language-gate greying
   (`model-card--disabled`), reason "Requires GPU" — one greying mechanism, now
   keyed on language ∧ hardware.
3. **Device override** (native-only, in the Speech-recognition group): `Auto`
   (default) / `Force CPU` / `Force GPU (…)` (listed only if available);
   subtitle shows what Auto resolved to + the benchmarked speed.
4. **Perf surface** on the active model (`≈4× real-time`) from `ready.rtf`.

DRY: the shared `ModelCard` gains *optional* `tierBadge?` and `disabledReason?`
props — native populates them, WASM passes neither (unchanged). Device override
+ hardware summary are native-only, structured so a future translation/TTS
override is additive.

**Auto + override**: Auto displays the resolved device; override pins it;
`ready.device` reflects truth after any fallback. Forcing an unavailable device
→ inline warning, CPU floor backs it.

**Recommendation steers to hardware**: `recommended`/`sort_order` +
`autoSelectNative` are fed hardware-aware data — a GPU box surfaces
Whisper/Qwen3-ASR first; a CPU-only box surfaces the real-time-on-CPU set.
Start-button gating needs **no new code**: "GPU-only on a CPU box" makes the
model incompatible, and the existing `validateApiKey` gate fires.

## Error handling & fallback

Selection and fallback are the **same mechanism** (ordered Plans); nothing
degrades silently; `ready` always reports the device that *actually* loaded.

```python
def load_with_fallback(plans):
    notice = None
    for i, plan in enumerate(plans):              # plans[0]=best, plans[-1]=CPU floor
        try:
            b = make_backend(plan.backend)
            b.load(plan.artifact.dir, plan.device, plan.compute_type)
            return b, plan, notice
        except BackendLoadError as e:
            notice = f"{plan.device} unavailable ({e.reason}); falling back"
            continue
    raise AllPlansFailed(plans, notice)           # only if even the CPU floor died
```

| Failure | Layer | Handling | User sees |
|---|---|---|---|
| GPU load fails (OOM, cuDNN/driver, bad GGUF) | `backend.load()` | step to next plan → CPU floor | non-fatal notice + truthful `ready.device` |
| Resolved artifact absent | `init` precheck | `ErrorMsg{model,"model_not_downloaded"}` | download prompt |
| Backend pack not installed | `resolve()` filter | plan never offered | invisible (correct by construction) |
| Pack corrupt / hash mismatch | `native-host-manager` | reject, don't spawn | hard error: "verification failed" |
| GPU probe throws | `probe()` | treat accelerator absent | machine reports CPU-only; app works |
| Benchmark clip fails | `accel` post-load | skip RTF | no perf badge; load unaffected |
| Mid-session backend death | `transcribe()` | reload on floor, continue stream | brief notice, **no session interruption** |
| GPU-only model, GPU load fails | `load_with_fallback` | no floor → **terminal** | clear: "Voxtral requires GPU; load failed: <reason>" |

**Never-silent**: every downgrade fires `ready.fallbackReason` + a panel notice.
GPU-only models do **not** silently substitute — a no-floor failure is terminal
with the real reason.

**Runtime resilience respects no-interruption**: load-time = fail fast (pick
another plan); runtime mid-stream = degrade gracefully (reload on the floor,
resume the stream) because a live translation session must not be cut off. Only
a floor death surfaces a terminal error.

## Testing

The decision layer is **pure** → most logic is testable on a CPU CI box with no
hardware.

- **Pure decision tests (the bulk, CI)**: `resolve()` against five fake
  `Machine` fixtures (`cpu_only_linux`, `nvidia_linux`, `apple_silicon`,
  `windows_dml`, `windows_nvidia`) × catalog; `load_with_fallback` with injected
  fake backends (success/raise permutations) asserting the chain + `fallbackReason`;
  catalog invariants; `probe()` with mocked detection primitives; benchmark
  cache fingerprint/re-rank.
- **Adapter contract tests, tiered**: one shared suite
  (`load→is_loaded→transcribe→unload`). CPU floor adapters (sherpa-CPU,
  CT2-CPU) run real in CI with tiny models. Accelerator adapters
  (llama.cpp-CUDA, MLX, onnx-DirectML) gated behind `@pytest.mark.{gpu,mlx,dml}`
  — skipped in CI, run on the dev box / self-hosted runners.
- **Renderer tests (vitest — the project's correctness gate)**: mocked
  `models_catalog_result` payloads → tier badges render; GPU-only greys on a
  cpu-only payload; device override pins + warning; `ready.device` updates the
  label; hardware-aware `autoSelectNative` ordering.
- **Regression guard**: freeze the verified language facts as fixtures —
  `distil-large-v3 == {en}`, `granite-speech-4.1-2b` includes `ja`,
  `parakeet-v3 == 25`, `qwen3-asr == 52`, `voxtral == 8`,
  `sense-voice == {zh,en,ja,ko,yue}`.
- **E2E smoke**: golden audio → expected text on the CPU floor (CI) and on
  GPU/Mac (dev / self-hosted), confirming equivalent text + better RTF.

## Implementation phases

Each phase is independently shippable and validates one hypothesis.

- **Phase 0 — seam + CPU floor (zero hardware risk).** `AsrBackend` interface;
  `_build_sherpa`→`SherpaBackend`, `_build_faster_whisper`→`CTranslate2Backend`
  (CPU); `catalog.py` CPU-floor rows; `accel.py` complete (`probe()` with full
  GPU detection wired, only CPU plans ship); `load_with_fallback`; protocol
  (`hardware_info`, `models_catalog`, extended `ready`); renderer
  catalog-as-source-of-truth, "CPU" tier badge; the full pure decision-layer
  test suite incl. fake GPU machines. *Validates: native ASR works exactly as
  before, through the new architecture, no regression.*
- **Phase 1 — GPU proof with one accelerator (CTranslate2-CUDA).** `gpu-cuda`
  Whisper deployment; NVIDIA Tier-2 pack; benchmark + RTF; device-override UI.
  Prove on the dev 4070: CUDA load, forced-fail → CPU fallback, RTF speedup.
  *Validates: the full GPU path end-to-end on the lowest-risk accelerator.*
- **Phase 2 — speech-LLM tier (the big one).** `LlamaCppBackend` (GGUF +
  `libmtmd`) + `MlxBackend`; rows for qwen3-asr-0.6b/1.7b, voxtral (GPU-only),
  granite-speech-base; per-platform llama.cpp CUDA/Vulkan/Metal + MLX on macOS;
  GPU-only gate + no-floor terminal path. *Validates: the 52-language
  speech-LLM tier, accelerated per platform; the two-adapter-same-model design.*
- **Phase 3 — full coverage + distribution hardening (overlaps Phase 2).**
  onnxruntime-DirectML, Vulkan packs, Metal/whisper.cpp; signed pack
  download/verify in `native-host-manager`; self-hosted Mac/Windows runners
  light up the hardware-gated tests. *Validates: every platform's hardware
  exploited; tiered distribution realized.*

Dependency order: `0 → 1 → 2`, with `3` partly parallel to `2`. Phase 0 gates
everything; 1 de-risks GPU; 2 delivers the headline value; 3 completes coverage.

## Sources

Language lists and the sherpa GPU verdict were verified from primary sources:

- sherpa-onnx GPU: k2-fsa install doc (CPU-only default; CUDA wheel commands),
  `cuda.html` wheel index, issue #2910 (CoreML slower than CPU), and the
  installed `sherpa_onnx 1.13.3` wheel (no bundled CUDA/cuDNN libs).
- Whisper / distil: `distil-whisper/distil-large-v3` (+v3.5) model cards
  ("English speech recognition" / "English family") — English-only;
  `openai/whisper-large-v3(-turbo)` — 99-language tag.
- Voxtral: `mistralai/Voxtral-Mini-3B-2507` card — 8 named languages.
- Qwen3-ASR: `Qwen/Qwen3-ASR-0.6B` and `-1.7B` cards — "52 languages and
  dialects" (30 languages + 22 Chinese dialects); distinct from Flash's 11.
- Granite: `ibm-granite/granite-speech-4.1-2b` (base, incl. Japanese) vs
  `-2b-plus` (en/fr/de/es/pt) cards.
- SenseVoice: `FunAudioLLM/SenseVoiceSmall` card — Mandarin/Cantonese/English/
  Japanese/Korean (Mandarin inference token `zn`).
- Parakeet: `nvidia/parakeet-tdt-0.6b-v2` (en) vs `-v3` (25 EU languages) cards.
- ReazonSpeech: `reazon-research/reazonspeech-k2-v2` card — Japanese.
