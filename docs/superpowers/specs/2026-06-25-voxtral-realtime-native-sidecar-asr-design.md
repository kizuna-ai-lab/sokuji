# Native ASR: Voxtral Mini 4B Realtime (GPU sidecar) — Design

**Status:** PLANNED. Phase 1 (offline-segment adapter) is the implementable scope of this spec.
Phase 2 (true streaming engine) is sketched in §9 and gets its own spec → plan later.
**Branch:** `feat/native-asr-voxtral-realtime` (to be cut from `native-sidecar`).
**Date:** 2026-06-25.

## 0. Empirical validation (measured 2026-06-25 on RTX 4070 SUPER, 12 GB) — supersedes the "unverified" hedges below

A real load + transcription was run on the actual hardware (sidecar venv, transformers
`5.13.0.dev0`, torch `2.11.0+cu128`), and a vLLM runtime comparison was done in an isolated venv.

- **Transformers-native FITS 12 GB and works.** Weights 8.86 GB; **peak 10.3 GB** (nvidia-smi) during
  offline per-segment generate — ~1.9 GB headroom. Load 6.1 s. **RTF ≈ 0.45–0.50 (~2× realtime)** —
  a 5 s clip transcribes in ~2.5 s. Transcripts correct on en/ja/ko/zh (Cantonese `yue` garbled — not
  one of the 13 languages, expected). **§4.4's 12 GB target is confirmed**; the "≥16 GB" is the default
  ~3 h-context figure, irrelevant to bounded per-segment use.
- **`mistral-common[audio]` is a CONFIRMED required dependency** (1.11.3 installed). The processor's
  tokenizer *is* `MistralCommonBackend`.
- **Offline loading needs the snapshot-DIR pattern, not the repo-id pattern.** `mistral_common`'s
  tokenizer loader ignores transformers' `local_files_only=True` and `HF_HUB_OFFLINE=1` (both raise).
  The working offline path: `d = snapshot_download(repo, local_files_only=True)` →
  `AutoProcessor.from_pretrained(d)` + model from `d`. This differs from Cohere/Qwen3 (which pass the
  repo id) and is the SherpaBackend dir-resolve pattern. See §5.1.
- **Download must skip `consolidated.safetensors`.** The repo is 17.73 GB = `model.safetensors`
  (8.86 GB, HF format, needed) + `consolidated.safetensors` (8.86 GB, Mistral format, NOT needed by
  transformers). `download_specs`/`download` must ignore the consolidated file or every user wastes
  8.86 GB. See §5.2.
- **vLLM rejected for this use (measured).** Same single-stream speed (RTF 0.47 ≈ transformers 0.45),
  but: needs an isolated venv (pins transformers 5.12.1, conflicting with the sidecar's 5.13 fork);
  FlashInfer's ninja JIT kernel build fails on this CUDA toolchain out-of-box; only loads on 12 GB
  when crippled to `max-model-len 512` (0.82 GiB KV, 1.37× concurrency — no batching headroom); and
  it's a separate server process. Its real advantages (batched throughput, production `/v1/realtime`
  WS) need ≥16 GB and don't fit sokuji's local single-user model. **Runtime decision = transformers
  native (§4.1), now on evidence.**

## 1. Goal

Add **Voxtral Mini 4B Realtime** (`mistralai/Voxtral-Mini-4B-Realtime-2602`) as a GPU ASR model
in the LOCAL_NATIVE Python sidecar, bf16 on CUDA, through the existing `AsrBackend` seam — the
same path that already ships Granite Speech, Qwen3-ASR, and Cohere Transcribe.

Voxtral Realtime is a *streaming* speech-LLM whose payoff is sub-500 ms live transcription
(configurable 80 ms–2.4 s delay; recommended 480 ms). That payoff only materializes with a
streaming recognizer, which the current sidecar engine does not have. So this work is **phased**:

- **Phase 1 (this spec):** run the model **offline, per VAD segment** — a drop-in backend exactly
  like Qwen3/Cohere. This validates catalog/download/gating/load/coexistence on real hardware and
  ships a working (if not-yet-realtime) Voxtral ASR. It deliberately does **not** use the model's
  streaming API.
- **Phase 2 (future, §9):** a streaming engine seam that feeds continuous audio and emits
  incremental transcripts at the configured delay — the actual reason to pick the realtime variant.

Pure ASR only: Voxtral's built-in speech-*translation* (audio → text in another language) is noted
as a future possibility (§9) but out of scope — sokuji keeps ASR and translation as separate stages.

## 2. Context: what we already have

- **The `AsrBackend` adapter pattern** (`load`/`transcribe`/`unload`/`is_loaded`), a
  `@register_backend` registry (`make_backend`), the `accel.py` resolver with its `_installed()`
  self-gate + tier ranking + CPU-floor fallback, the `catalog.py` model registry,
  `native_models.download_specs`/status/download, and the renderer `nativeCatalog.ts` +
  `NativeModelManagementSection`. Adding a GPU speech-LLM ASR is, by now, a well-worn path:
  Granite (`TransformersBackend`), Qwen3-ASR (`Qwen3AsrBackend`), Cohere (`cohere_transformers`).
- **The engine seam is offline-per-segment** (`AsrEngine`, `sidecar/sokuji_sidecar/asr_engine.py`):
  silero VAD cuts speech into segments; each whole segment goes through
  `backend.transcribe(samples_f32_16k, language)` and returns full text via a `result` event.
  Phase 1 plugs straight into this — **no engine, wire-protocol, or renderer-rendering changes.**

## 3. Verified facts (de-risking complete)

Confirmed by live execution in the actual sidecar venv (`sidecar/.venv`, transformers
`5.13.0.dev0` — the PR #43838 fork already pinned for Qwen3-ASR; torch `2.11.0+cu128`):

- `transformers.models.voxtral_realtime` → `importlib.util.find_spec(...)` is **present**, and the
  top-level `transformers` namespace exposes `VoxtralRealtimeForConditionalGeneration`,
  `VoxtralRealtimeProcessor`, `VoxtralRealtimeFeatureExtractor`, `VoxtralRealtimeConfig`. **No venv
  change, no transformers bump, no new pin.** (The model card requires `transformers >= 5.2.0`;
  our fork branched from main well after that, so a future swap to a released `>=5.13` keeps it.)
- The model's `config.json` reports `model_type: "voxtral_realtime"`,
  `architectures: ["VoxtralRealtimeForConditionalGeneration"]`, and carries
  `default_num_delay_tokens` + `audio_length_per_tok` (the streaming knobs — Phase 2 territory).
- **The realtime processor is NOT API-compatible with the offline one.** `VoxtralProcessor`
  (offline `voxtral`) has `apply_transcription_request` / `apply_chat_template`; the realtime
  `VoxtralRealtimeProcessor` exposes only `__call__` — no transcription-request or chat-template
  helper. So Phase 1 cannot reuse the offline-Voxtral idiom; it uses the documented realtime
  offline path (audio-only `processor(...)` → `generate()` → `batch_decode`).
- Granite / Qwen3 / Cohere all still import on the same transformers → Voxtral Realtime
  **coexists** with the other speech-LLMs in one venv (the §6 spike re-checks this after `unload()`).

Model facts (HuggingFace model card, `mistralai/Voxtral-Mini-4B-Realtime-2602`):

| Property | Value |
|---|---|
| Checkpoint | `mistralai/Voxtral-Mini-4B-Realtime-2602` |
| Weights | safetensors, bf16, ~8.8 GB |
| Architecture | ≈3.4 B LM + ≈970 M audio encoder; **causal** audio encoder + sliding-window attention for "infinite" streaming |
| Languages (13) | en, fr, es, de, ru, zh, ja, it, pt, nl, ar, hi, ko |
| License | Apache 2.0 |
| Audio | 16 kHz; `processor.feature_extractor.sampling_rate` is the canonical rate |
| Streaming knobs | delay 80 ms–2.4 s (rec. 480 ms); 1 text token = 80 ms; `default_num_delay_tokens` (Phase 2) |
| VRAM | "≥16 GB" — but that is at the **default ~3 h context** (`max-model-len 131072`). Weights are ~8.8 GB; a bounded context (our per-segment / streaming-window use) is expected to fit the 4070's 12 GB. **Unverified until the §6 spike.** |
| Recommended runtime | vLLM (production streaming) **or** HF transformers native (`VoxtralRealtimeForConditionalGeneration`) |

Documented HF-transformers **offline** path (model card), the basis for Phase 1's `transcribe`:

```python
from transformers import VoxtralRealtimeForConditionalGeneration, AutoProcessor
processor = AutoProcessor.from_pretrained(repo_id)
model = VoxtralRealtimeForConditionalGeneration.from_pretrained(repo_id, device_map="auto")
inputs = processor(audio_array_16k, return_tensors="pt").to(model.device, dtype=model.dtype)
outputs = model.generate(**inputs)
print(processor.batch_decode(outputs, skip_special_tokens=True)[0])
```

Note: the card's example obtains `audio_array` via `mistral_common`'s `Audio.from_file` purely to
load+resample a file. We already hold float32@16k samples from the VAD, so we feed them straight to
`processor(...)`. Whether `mistral_common` is nonetheless a load-time dependency of the processor is
an open item the §6 spike settles (the Cohere precedent: `librosa` was a hidden hard dep that only a
real load surfaced).

## 4. Decisions

1. **Runtime = HF transformers native** (not vLLM) — **measured** (§0). It fits the existing
   `backends.py` pattern with zero new process/dependency-runtime and matches every other backend. The
   vLLM comparison showed identical single-stream speed but worse fit on every axis that matters here
   (venv conflict, toolchain JIT failure, KV-starved on 12 GB, separate server). vLLM (Mistral's
   production Realtime WebSocket API) is deferred to a possible Phase 2 only if transformers' native
   streaming proves inadequate AND a ≥16 GB deployment is in scope. No ONNX/sherpa export exists.
2. **Phased; Phase 1 is offline-per-segment.** The model runs through the unchanged VAD-segment
   seam. The streaming engine is Phase 2 (§9).
3. **`recommended = False` in Phase 1.** Offline mode is not this model's strength, and it's GPU-only
   + large; promote to `recommended` when Phase 2 (streaming) lands. It appends after the existing
   ASR rows: sidecar `sort_order = 9`, renderer `sortOrder = 9` (after Qwen3 at 8). No existing rows
   shift.
4. **VRAM target = 12 GB, measured.** The §6 spike loads on the 4070 with a bounded context and
   records the real footprint. If it fits 12 GB: advertise the model under the existing has-GPU gate
   (no new VRAM gating), and the GPU smoke runs locally. If it does **not** fit even bounded: fall
   back to a follow-up that adds VRAM-size gating (the resolver/catalog can't see VRAM today —
   `_nvidia_gpus()` reports `vram_mb = 0`; `hardwareGated()` only knows GPU present/absent). That
   gating mechanism is explicitly **not** built in Phase 1.
5. **Language = auto.** The model is multilingual and the offline example passes no language. Phase 1
   does not pass a language hint (auto-detect); the catalog lists the 13 supported languages so the
   compatible/incompatible split works. The §6 spike confirms whether the processor even accepts a
   hint; if a hint materially helps, wiring it is a small follow-up (no `requiresExplicitLanguage`,
   unlike Cohere).

## 5. Architecture (Phase 1)

### 5.1 `VoxtralRealtimeBackend` (`sidecar/sokuji_sidecar/backends.py`)

A new `@register_backend` class, `NAME = "voxtral_realtime"`, GPU-only, mirroring
`CohereTransformersBackend` (audio-only input, no chat template, no prompt slicing).

```python
@register_backend
class VoxtralRealtimeBackend:
    """Voxtral Mini 4B Realtime via native transformers
    (VoxtralRealtimeForConditionalGeneration). model_ref is the HF repo; GPU-tier (bf16),
    loaded with .to(device) (no accelerate). Phase 1 runs the streaming model OFFLINE,
    one whole VAD segment per generate() — audio-only input, transcript-only output (no
    chat template). Multilingual auto-detect: the language arg is recorded, not passed."""
    NAME = "voxtral_realtime"

    def load(self, model_ref, device, compute_type):
        self._model = None; self._proc = None
        if device == "cpu":
            raise BackendLoadError("voxtral_realtime is GPU-only")
        try:
            import torch
            from huggingface_hub import snapshot_download
            from transformers import VoxtralRealtimeForConditionalGeneration, AutoProcessor
            self._dtype = torch.bfloat16 if compute_type in ("bfloat16", "auto") else torch.float16
            # mistral_common's tokenizer loader ignores local_files_only / HF_HUB_OFFLINE and
            # tries to hit the hub; passing the resolved snapshot DIRECTORY makes it load the
            # cached tekken.json locally (verified §0). This is the SherpaBackend dir-resolve
            # idiom, NOT Cohere/Qwen3's repo-id idiom.
            d = snapshot_download(model_ref, local_files_only=True)
            self._proc = AutoProcessor.from_pretrained(d)
            self._model = VoxtralRealtimeForConditionalGeneration.from_pretrained(
                d, dtype=self._dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:   # missing voxtral_realtime module, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language):
        import torch
        inp = self._proc(samples, sampling_rate=TARGET_RATE, return_tensors="pt").to(self._device)
        if "input_features" in inp:                 # the Qwen3/Cohere lesson: cast features to model dtype
            inp["input_features"] = inp["input_features"].to(self._dtype)
        with torch.inference_mode():
            out = self._model.generate(**inp, max_new_tokens=256, do_sample=False)
        text = self._proc.batch_decode(out, skip_special_tokens=True)[0]
        return AsrResult(text.strip(), language)    # prefix-strip helper added only if the spike shows one
```

Open items the §6 spike confirms (not assumed): the exact processor signature
(`AutoProcessor`/`VoxtralRealtimeProcessor`; the input key — `input_features` vs other), whether
`generate()` output needs input-prompt slicing (the card decodes `outputs` directly, suggesting
audio-only → transcript-only), the accepted `language` form (if any), the `mistral_common`
dependency, and the **real VRAM footprint** at our bounded context.

Bounding the context: per-segment offline keeps generation short (`max_new_tokens=256`; segments are
seconds). If the realtime model pre-allocates a cache for its default ~3 h `max-model-len`, the spike
will show it; the fix is to construct it with a small cache/`max_position_embeddings`-bounded config.
This is the §4.4 measurement that decides 12 GB-target vs 16 GB-gating.

### 5.2 Registry wiring (three one-line touches, identical to Cohere/Qwen3)

- **`catalog.py`** — new row, appended (no existing rows shift):
  ```python
  AsrModel("voxtral-mini-4b-realtime", "Voxtral Mini 4B Realtime",
           ("en","fr","es","de","ru","zh","ja","it","pt","nl","ar","hi","ko"),
           (Deployment("voxtral_realtime", "gpu-cuda", "bfloat16",
                       "mistralai/Voxtral-Mini-4B-Realtime-2602", 1.0),),
           recommended=False, sort_order=9)
  ```
- **`accel.py` `_installed()`** — add `"voxtral_realtime": "transformers.models.voxtral_realtime"`
  to the `mods` dict. Present on the 5.13 fork → lights up; the `_has_mod` self-gate still protects
  builds where the module is absent.
- **`native_models.py` `download_specs`** — before the fallthrough:
  ```python
  if model_id == "voxtral-mini-4b-realtime":
      return {"repos": ["mistralai/Voxtral-Mini-4B-Realtime-2602"], "urls": [],
              "ignore": ["consolidated.safetensors"]}  # Mistral-format dup; transformers uses model.safetensors
  ```
  This adds a **new optional `ignore` key** to the spec dict. `download()`, `model_status()`, and
  `model_size()` currently enumerate *all* repo files (`list_repo_files`/`siblings`) — each must filter
  out names in `ignore` so we don't fetch (or size-check, or status-check) the 8.86 GB
  `consolidated.safetensors`. Without it: download is 17.73 GB instead of 8.87 GB, and `model_status`
  would report "absent" for a perfectly usable model because the consolidated blob is missing. The
  `ignore` key defaults to `[]` for every existing model, so this is additive and inert elsewhere.

### 5.3 Renderer (`src/lib/local-inference/native/nativeCatalog.ts`)

One row in `NATIVE_ASR`, appended after Qwen3 (`sortOrder 8`):
```ts
{ id: 'voxtral-mini-4b-realtime', label: 'Voxtral Mini 4B Realtime',
  languages: ['en','fr','es','de','ru','zh','ja','it','pt','nl','ar','hi','ko'], sortOrder: 9 },
```
No new `NativeModelOption` fields, no `LanguageSection` change (Voxtral auto-detects, so unlike
Cohere it doesn't set `requiresExplicitLanguage`). `asrToCard` renders it; the existing has-GPU
hardware-gating (`hardwareGated()` + `autoSelectNative`'s `isHardwareGated`) already excludes it on
no-GPU boxes and won't auto-select a model that fails readiness.

### 5.4 Dependency

**`mistral-common[audio]>=1.9.0` is a CONFIRMED required dependency** (§0; `VoxtralRealtimeProcessor`'s
tokenizer is `MistralCommonBackend`). Add it to `sidecar/setup.sh` next to `librosa`/`sacremoses` (the
heavy stage runtimes live there, not in the light `requirements.txt`). Verified: installing it does not
perturb the pinned transformers fork (Granite/Qwen3/Cohere still import). The `[audio]` extra pulls
`soundfile`/`soxr`.

## 6. Validation spike (de-risker)

**Mostly executed already (§0):** load + transcribe on the 4070 succeeded, VRAM/RTF measured,
`mistral_common` dep confirmed, the offline snapshot-dir load path proven, the dual-format download
identified, and the output format confirmed (audio-only → transcript, `batch_decode(outputs)` directly,
no prompt slice). **Remaining open items:** confirm whether the processor accepts a `language=` hint
(currently treated as auto), and the coexistence regression after `unload()`. The reproducible smoke
(to land as the GPU-gated test) mirrors the real flow — download first, then load from cache:

1. `snapshot_download("mistralai/Voxtral-Mini-4B-Realtime-2602")`, then
   `AutoProcessor.from_pretrained(ref, local_files_only=True)` and
   `VoxtralRealtimeForConditionalGeneration.from_pretrained(ref, dtype=torch.bfloat16,
   local_files_only=True).to("cuda").eval()` — surfaces any hidden dep (e.g. `mistral_common`).
2. `proc(samples_f32_16k, sampling_rate=16000, return_tensors="pt")` →
   `model.generate(**inputs, max_new_tokens=256)` → `proc.batch_decode(out, skip_special_tokens=True)`.

Assert / observe: a plausible transcript on a real clip; the **output format** (any prefix to strip?
does the output echo the prompt → need slicing?); whether a **`language=` hint** is accepted and our
codes (`en`, `ja`, …) are valid; **RTF and the real VRAM footprint on the 4070** (the §4.4 gate — does
it fit 12 GB at a bounded context?); and the coexistence regression — **Granite / Qwen3 / Cohere still
load** after Voxtral `unload()` + `torch.cuda.empty_cache()`.

The spike's measured facts feed back into §5.1 (final `transcribe` shape) and §4.4 (12 GB vs 16 GB).

## 7. Testing

- **Mocked unit tests** (`sidecar/tests/test_backends.py`): a fake processor + model (mirroring the
  Qwen3/Cohere fakes) asserting the bf16 dtype cast, the GPU-only guard raises `BackendLoadError` on
  `cpu`, and the decode path; plus the `SOKUJI_RUN_GPU`-gated real smoke from §6.
- **Catalog** (`test_catalog.py`): the new row — `recommended is False`, `sort_order == 9`, the 13
  languages, backend `voxtral_realtime`. Add `"voxtral_realtime"` to the allowed-backend set.
- **Resolver** (`test_accel.py`): `voxtral_realtime` gated on `transformers.models.voxtral_realtime`;
  present + NVIDIA machine → resolves the gpu-cuda plan; CPU-only box → `NoUsablePlan` (no CPU floor).
- **Download** (`test_native_models.py`): `download_specs("voxtral-mini-4b-realtime")` → the single
  `mistralai/Voxtral-Mini-4B-Realtime-2602` repo, no urls.
- **Renderer** (`nativeCatalog.test.ts`): the Voxtral row present (not recommended, `sortOrder 9`, 13
  languages), appears in `compatibleNativeAsr` for a supported language and behind incompatible for an
  unsupported one, and does not disturb the existing recommended-first ordering.
- Gates: `pytest` (sidecar) + `vitest` (renderer) are the correctness gates (not `tsc`);
  `npm run build` for the renderer wiring.

## 8. Out of scope (Phase 1 / YAGNI)

- **No streaming** — Phase 1 runs the model offline per segment; the realtime API is Phase 2 (§9).
- **No CPU / ONNX / GGUF path** — GPU bf16 only; CPU ASR is covered by Whisper (`ctranslate2`) and
  SenseVoice (`sherpa`). No CPU floor for this row (a sub-capable box yields `AllPlansFailed` at
  Start, consistent with the other GPU-only rows).
- **No VRAM-size gating mechanism** — built only if §6 proves the model can't fit 12 GB (§4.4).
- **No word timestamps / diarization / speaker labels.**
- **No changes to Granite / Qwen3 / Cohere**; `requirements.txt` unchanged (any new dep goes in
  `setup.sh`, §5.4).

## 9. Phase 2 (future — separate spec)

The realtime payoff. A streaming recognizer seam, roughly:

- A streaming backend contract (`feed(frames) → partial/final tokens`) alongside today's offline
  `transcribe(segment)`, driven by the model's causal encoder + `default_num_delay_tokens` (~480 ms).
- Engine changes: stream audio into the model continuously (the transport already pushes Int16 frames
  via `on_binary`), emit incremental transcripts rather than per-VAD-segment finals — VAD may shift to
  endpointing/segmentation hints rather than gating recognition.
- Wire protocol: partial-result events (`partial` vs `result`) and the renderer rendering them.
- Promote the catalog row to `recommended` once streaming lands.
- Possibly evaluate vLLM's Realtime WebSocket API if transformers streaming is inadequate.
- **Separately**, Voxtral's built-in speech-translation (fuse ASR+translate into one stage) and
  `mistralai/Voxtral-4B-TTS-2603` for the TTS stage are independent future investigations.

## 10. Files touched (Phase 1)

- `sidecar/sokuji_sidecar/backends.py` — `VoxtralRealtimeBackend`.
- `sidecar/sokuji_sidecar/catalog.py` — the `voxtral-mini-4b-realtime` row.
- `sidecar/sokuji_sidecar/accel.py` — `_installed()` gate entry.
- `sidecar/sokuji_sidecar/native_models.py` — `download_specs` branch **+ the new `ignore` key**
  honored in `download()`, `model_status()`, `model_size()` (skip `consolidated.safetensors`).
- `sidecar/setup.sh` — add `mistral-common[audio]>=1.9.0` (confirmed §0/§5.4).
- `sidecar/tests/test_backends.py`, `test_catalog.py`, `test_accel.py`, `test_native_models.py` —
  tests + the GPU smoke.
- `src/lib/local-inference/native/nativeCatalog.ts` — the row.
- `src/lib/local-inference/native/nativeCatalog.test.ts` — the row test.
