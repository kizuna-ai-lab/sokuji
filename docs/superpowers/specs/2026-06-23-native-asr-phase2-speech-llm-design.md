# Native ASR Phase 2 — Speech-LLM Tier (transformers / Granite) Design

**Date**: 2026-06-23
**Status**: Design
**Tracking**: #129 (native local inference). Builds on the Phase-0/1 architecture in `2026-06-22-native-asr-hw-accel-design.md` (the Phase 2 entry + the `TransformersBackend`/speech-LLM rows). Phases 0–1 shipped: the `AsrBackend` adapter + resolver + catalog + benchmark, with Whisper auto-running on the dev 4070 at RTF 0.0627.

## Summary

Add the **speech-LLM ASR tier** to the native sidecar via a third `AsrBackend` adapter — **`TransformersBackend`** — that runs an autoregressive speech-LLM through HuggingFace `transformers`. The first model is **IBM Granite Speech 4.1** (the production target is `granite-speech-4.1-2b`, base, which covers **Japanese**; the cached `-2b-plus` is the smoke). The resolver, fallback chain, and RTF benchmark from Phases 0–1 are reused **unchanged** — Granite is just new catalog rows the existing machinery resolves and benchmarks.

**This path was chosen over the spec's primary llama.cpp-GGUF plan because it is dramatically more ready and was proven end-to-end on the dev box** (see Feasibility Proof): `transformers 5.12.1` is installed, Granite is a *native* transformers class (`GraniteSpeechForConditionalGeneration` via `AutoModelForSpeechSeq2Seq`), the only environment change is CUDA-enabled torch + torchaudio, and Granite transcribed a real clip at **RTF 0.042 (~24× real-time)** on the RTX 4070. The llama.cpp-GGUF backend (broader model coverage, Qwen3-ASR's 52 languages, per-platform Vulkan/Metal) is the agreed **next** increment; **MLX** is deferred (Apple-only, unprovable on this Linux box).

## Feasibility Proof (already run on the dev box)

- Env: installed `torch==2.11.0+cu128` (the cu124 index was too old for transformers 5.x; cu128 + deps pulls the nvidia runtime libs incl. cuSPARSELt) and `torchaudio==2.11.0+cu128` (Granite's `GraniteSpeechFeatureExtractor` requires torchaudio). `torch.cuda.is_available()` → True, RTX 4070 SUPER. transformers 5.12.1 still imports.
- Smoke: `AutoModelForSpeechSeq2Seq.from_pretrained("ibm-granite/granite-speech-4.1-2b-plus", dtype=torch.bfloat16).to("cuda")` + the card's chat template (`<|audio|>` user prompt) + a real 16 kHz wav.
- Result: **load ≈ 56 s (one-time), VRAM 4.22 GB, transcribe 0.30 s for 7.15 s audio → RTF 0.042**, transcript exactly correct ("The tribal chieftain called for the boy, and presented him with fifty pieces of gold.").
- Learnings baked into this design: use `.to(device)` not `device_map` (avoids the `accelerate` dependency); the 56 s model-load is the session-start cost; per-VAD-segment transcription is ~0.3 s.

## Goals

- A `TransformersBackend` adapter implementing the existing `AsrBackend` contract (`load`/`transcribe`/`unload`/`is_loaded`), lazy-importing `torch`/`transformers`/`torchaudio`.
- Catalog rows for `granite-speech-4.1-2b` (base, +ja) and `granite-speech-4.1-2b-plus` (cached, smoke), **GPU-only** (`gpu-cuda`/bf16), reusing the resolver + benchmark.
- Prove the speech-LLM tier on the real 4070 (env-gated), the same way Phase 1 proved Whisper.
- Add the CUDA-torch + torchaudio install to the Tier-0 setup.

## Non-Goals

- **llama.cpp / GGUF backend** (`LlamaCppBackend`, Qwen3-ASR, Voxtral) — the agreed *next* increment. Research notes: upstream `llama-cpp-python` has no audio chat handler (vision-only); audio needs the `JamePeng` fork's `Qwen3ASRChatHandler`, custom ctypes glue over the already-bound `mtmd_cpp` audio C-API, or a subprocess `llama-server` with `/v1/audio/transcriptions`.
- **MLX backend** (Apple Silicon) — impossible to build/prove on this Linux box; a future macOS increment.
- **Renderer integration** — showing Granite cards, the device-override UI, the perf badge consuming `ready.rtf`. A subsequent renderer increment (the Phase-1 follow-on already wired the catalog feed + tier badge).
- **A CPU floor for Granite** — full-precision 2B on CPU is not real-time; Granite is GPU-only (gated off on CPU-only machines, like Voxtral). The quantized CPU path is the llama.cpp follow-up.

## Locked Decisions

| Decision | Choice |
|---|---|
| Backend | **`TransformersBackend`** (3rd `AsrBackend` adapter), `transformers` + torch + torchaudio, lazy-imported |
| First/production model | **`granite-speech-4.1-2b`** (base, en/fr/de/es/pt/**ja**); `-2b-plus` (cached, en/fr/de/es/pt) is the smoke |
| Tier | **GPU-only** (`gpu-cuda`/bf16) — no CPU floor (full-precision 2B isn't real-time on CPU) |
| Device loading | **`.to(device)`** (not `device_map`) — avoids the `accelerate` dependency |
| Env change | **CUDA torch `2.11.0+cu128` + torchaudio `2.11.0+cu128`** (cu128 index, with deps); no `accelerate` |
| Resolver/probe | reuse Phase-0/1 `resolve`/`load_with_fallback`/benchmark unchanged; `probe()._installed` gains `"transformers"` |
| llama.cpp / MLX | deferred (next increment / macOS) |

## Architecture

The speech-LLM tier slots behind the existing adapter seam — no resolver/engine rewrite.

```
asr_engine.init(model="granite-speech-4.1-2b", device="auto")
   │
   ▼
accel.resolve → [Plan(transformers, gpu-cuda, bf16, <repo>)]   (gpu-only: empty on a CPU box → NoUsablePlan)
   │
   ▼
accel.load_with_fallback → TransformersBackend.load(repo, "cuda", "bfloat16")
   │
   ▼
TransformersBackend.transcribe(samples16k, language) → AsrResult(text)
```

### `TransformersBackend` (new adapter — `backends.py`)

```python
@register_backend
class TransformersBackend:
    NAME = "transformers"
    def load(self, model_ref, device, compute_type):
        # lazy: import torch, transformers (+torchaudio is pulled by the processor)
        # proc  = AutoProcessor.from_pretrained(model_ref)
        # dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float16
        # model = AutoModelForSpeechSeq2Seq.from_pretrained(model_ref, dtype=dtype).to(device).eval()
        # raise BackendLoadError(str(e)) on any failure (incl. torch.cuda unavailable)
    def transcribe(self, samples, language):
        # chat = [system, {"role":"user","content":"<|audio|> <ASR prompt>"}]
        # ptext = tokenizer.apply_chat_template(chat, tokenize=False, add_generation_prompt=True)
        # inputs = proc(ptext, samples, device=device, return_tensors="pt").to(device)
        # out = model.generate(**inputs, max_new_tokens=..., do_sample=False, num_beams=1)
        # text = tokenizer.decode(out[0, inputs["input_ids"].shape[-1]:], skip_special_tokens=True)
        # return AsrResult(text.strip(), language)
    def unload(self): ...   # del model; torch.cuda.empty_cache() — deterministic VRAM free
    @property
    def is_loaded(self): ...
```

The Granite chat template (system prompt + `<|audio|>` placeholder + ASR instruction) and bf16 are Granite-specifics encapsulated in the backend. `samples` is the existing float32 mono 16 kHz array the engine already produces per VAD segment.

### Catalog rows (`catalog.py`)

```python
AsrModel("granite-speech-4.1-2b", "Granite Speech 4.1 (2B)", ("en","fr","de","es","pt","ja"),
         (Deployment("transformers", "gpu-cuda", "bfloat16", "ibm-granite/granite-speech-4.1-2b", 1.0),),
         sort_order=5),
AsrModel("granite-speech-4.1-2b-plus", "Granite Speech 4.1 (2B+)", ("en","fr","de","es","pt"),
         (Deployment("transformers", "gpu-cuda", "bfloat16", "ibm-granite/granite-speech-4.1-2b-plus", 1.0),),
         sort_order=6),
```

GPU-only: no `cpu` deployment, so on a non-NVIDIA machine `resolve_deployments` filters to `[]` → `resolve` raises `NoUsablePlan` → the model is gated off (the existing incompatible-card path on the renderer side, later). `artifact` = the HF repo id; `TransformersBackend.load(repo, ...)` loads from the HF cache (downloaded on demand via `native_models`).

### Probe / resolver (`accel.py`)

- `probe()._installed` adds `"transformers"` when `importlib.util.find_spec("transformers")` and `"torch"` are present (no heavy import). So a Granite `transformers` deployment is only offered when transformers is installed.
- `_tier_available("gpu-cuda", machine)` is unchanged (`bool(machine.nvidia)` via ct2). If ct2 sees the GPU but torch is CPU-only (CUDA torch not installed), `resolve` still offers `gpu-cuda`, `TransformersBackend.load("cuda")` raises `BackendLoadError` (torch CUDA unavailable), and — because Granite is GPU-only — `load_with_fallback` exhausts and raises `AllPlansFailed` with a clear reason. The env setup installs CUDA torch, so in practice it loads; the failure mode for a mis-set-up machine is explicit, not a silent slow CPU run.

## Data flow & the load-cost wrinkle

Per-VAD-segment transcription fits the existing engine: the engine VAD-segments audio and calls `backend.transcribe(segment)` — Granite generates the full transcript per segment in ~0.3 s. No streaming needed (transformers backend is batch; the VAD already provides utterance boundaries).

The one wrinkle is the **~56 s one-time model load** at `init()` (a 2B model → GPU). This is the session-start cost, consistent with how `init()` already blocks on model load (Whisper/sense-voice load synchronously too, just faster). It runs once per session; kept inline. The Phase-1 RTF benchmark then runs once on the loaded backend (a 3 s clip → ~0.1 s on GPU) and surfaces `rtf` on `ready` via the existing mechanism.

## Error handling

Reuses the Phase-0/1 chain:
- GPU-only Granite on a CPU-only machine → `resolve` raises `NoUsablePlan` → gated off (not offered).
- Granite GPU load failure (no CUDA torch, OOM) → `BackendLoadError` → `load_with_fallback` has no other plan → `AllPlansFailed` (terminal, clear reason — **no silent CPU substitution**, matching the GPU-only contract).
- `transcribe` failure mid-session → existing engine handling (the backend's failure surfaces; the session-resilience path is unchanged).

## Testing

- **Pure unit tests (CI, no GPU/model):** `make_backend("transformers")` returns the adapter; with a **fake transformers model + processor** (monkeypatched `sys.modules`), assert `load` builds the model and `transcribe` runs the chat-template → processor → generate → decode wiring and returns the decoded text. Mirrors the fake-`faster_whisper`/`sherpa_onnx` adapter tests.
- **Catalog/probe tests (CI):** Granite resolves to `gpu-cuda` on a fake machine with `nvidia` + `"transformers"` installed; resolves to `NoUsablePlan` (gated off) on a CPU-only machine; `_installed` includes `"transformers"` when importable.
- **Env-gated real-GPU proof (`SOKUJI_RUN_GPU=1`):** load `granite-speech-4.1-2b-plus` on the 4070 via `TransformersBackend`, transcribe the cached sense-voice `test_wavs/en.wav`, assert the transcript contains "gold"/"tribal" and RTF < 1.0 (`measure_rtf`). The production `-2b` (ja) test is gated behind a model download.

## Environment setup

The Tier-0 setup script (`scripts/`) gains, for a CUDA machine:
```
pip install torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu128
```
(no `accelerate`). Done manually on the dev box during this design. `transformers` is already a sidecar dependency.

## Scope boundary / phasing

- **This increment:** `TransformersBackend` + Granite rows + `probe` `"transformers"` + env setup + the env-gated GPU proof.
- **Next (separate spec/plan):** `LlamaCppBackend` (GGUF + libmtmd audio) for Qwen3-ASR/Voxtral — broader languages, per-platform Vulkan/Metal, and the quantized CPU path.
- **Deferred:** MLX (macOS); renderer integration (Granite cards, device-override UI, perf badge); the production `granite-speech-4.1-2b` (ja) download path beyond catalog declaration.

## Sources

- Granite via transformers: `ibm-granite/granite-speech-4.1-2b(-plus)` model cards (`GraniteSpeechForConditionalGeneration` / `AutoModelForSpeechSeq2Seq`, `<|audio|>` chat template, 16 kHz, bf16). `-2b-plus` = en/fr/de/es/pt; `-2b` (base) = +ja.
- llama.cpp audio (deferred): `ggml-org/llama.cpp` libmtmd/`llama-mtmd-cli`; `abetlen/llama-cpp-python` (audio C-API bound, no audio handler upstream); `JamePeng/llama-cpp-python` fork (`Qwen3ASRChatHandler`); `ggml-org/Qwen3-ASR-{0.6B,1.7B}-GGUF`.
- Feasibility proof: run on the dev box (RTX 4070 SUPER), torch 2.11.0+cu128, RTF 0.042.
