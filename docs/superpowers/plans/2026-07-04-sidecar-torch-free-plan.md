# Torch-free sidecar — phased implementation plan

**Spec**: `docs/superpowers/specs/2026-07-04-sidecar-torch-free-design.md`
**Branch**: `native-torch-free`

Each phase is independently landable and keeps the sidecar green (tests +
import health) — torch remains installed until Phase D flips setup.sh, so
mid-migration the tree always runs.

## Phase A — shared infra off torch/librosa/transformers

- [x] A1 accel.py: NVML probing (`nvidia-ml-py`) replaces `torch.cuda.*`
      (device props, capability, `mem_get_info`). Unit tests mock pynvml.
- [x] A2 tts_engine.py: remove `torch.cuda.empty_cache()` best-effort block.
- [x] A3 tts_backends.py: `AutoTokenizer` → `tokenizers.Tokenizer`
      (tokenizer.json is present in the Qwen3-TTS ONNX repos).
- [x] A4 qwen3_tts/mel.py: numpy Slaney mel filterbank (golden-value test
      against current librosa output, generated once before the swap).
- [x] A5 audio io: `librosa.load/resample` → `soundfile` + `soxr` in
      tts_backends (clip-clone reference loading).
- [x] A6 requirements.txt: + tokenizers (already), soundfile, soxr,
      nvidia-ml-py; nothing removed yet.

## Phase B — ASR: drop funasr

- [x] B1 catalog.py: sense-voice rows → `sherpa` backend (CPU tier; artifact =
      csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17, int8+tokens
      only, 239MB download vs 945MB torch repo). Verified on real audio:
      CPU RTF 0.023 (43× realtime), correct en/zh/ja transcripts.
      FunAsrSenseVoiceBackend deleted.
- [x] B2 Fun-ASR-MLT-Nano off funasr. Researched leads (2026-07-04):
      * **transcribe.cpp** (ggml family) — handy-computer/Fun-ASR-MLT-Nano-2512-gguf
        ships validated GGUF quants of our exact model (WER 1.69–1.89 librispeech;
        RTF 68× metal / 16× cpu on M4 Max, 9× vulkan / 4.5× cpu on Ryzen 4750U).
        Runtime binary pattern mirrors llama_runtime (external server binary).
        PREFERRED: cross-platform accel (metal/vulkan/cuda/cpu) for free.
      * FunASR-nano-onnx (csukuangfj / Wasser1462) — ORT export kit
        (encoder_adaptor + embedding + LLM), but inference needs funasr's
        feature extraction (portable to numpy) and appears to target the
        non-MLT nano. Backup path.
      Until one lands: card stays on funasr rows; when funasr leaves the venv
      the tiers show unavailable (hardware-gating UI), the card is NOT deleted.
- [x] B3 delete _FunAsrBackend/FunAsrNanoBackend once B2 lands.

## DECISION 2026-07-04: ASR runtime = transcribe.cpp (supersedes the ORT ports)

Research verdict (measured on the RTX 4070 SUPER box, PyPI `transcribe-cpp`
0.1.1 stock wheel):

| axis | transcribe.cpp | onnxruntime path |
|---|---|---|
| model coverage | ALL 11 catalog ASR models incl. Fun-ASR-MLT (no ONNX exists) and Voxtral-Realtime streaming | 5 separate ports, each with feature-extraction golden work |
| GPU today | YES — Vulkan out of the box: Cohere RTF 0.0096 (104×RT), SenseVoice 0.0055; Metal/CUDA flavors exist | CUDA blocked on unreleased ORT with #29525 (Cohere AND Voxtral both hit GQA attention_bias — verified: cohere decoder GQA node input[10] = gqa_attention_bias) |
| CPU | Cohere RTF 0.146 (≈ our ORT 0.115); SenseVoice 0.044 | ORT port verified 0.115 |
| install | 30MB wheel (CPU+Vulkan bundled); CUDA optional 216MB GH tarball | onnxruntime-gpu 773MB + cuDNN/cuBLAS ~1.5GB |
| downloads | Cohere Q4_K_M 1.56GB (vs ONNX q4 2.1GB) | — |
| multi-vendor | Vulkan = AMD/Intel free; Metal; CPU | DML needs separate Windows package juggling |
| API | official Python bindings: Model/session.run(pcm) batch + stream() with committed/tentative | hand-rolled per-model KV loops |
| risks | v0.1.x, 87★, single maintainer (pin version; MIT; vendored ggml); SenseVoice output lacks ITN/punctuation (keep sherpa row for it); PyPI cu12 is a placeholder (CUDA via GH release tarball if ever needed — Vulkan already 100×RT) | per-model debugging (CUDA empty-output class bugs) |

Adopted plan: ONE `transcribe_cpp` backend (batch first) + catalog re-point for
cohere/qwen3-asr/granite×2/voxtral/fun-asr-mlt (whisper may follow later,
dropping faster-whisper/av; sense-voice stays sherpa for ITN). The Cohere ORT
backend (`ort_speechllm.py`, `cohere_features.py`) is superseded and gets
removed when the transcribe.cpp backend lands. onnxruntime remains for the TTS
domain + Opus translate (CPU flavor may suffice — Phase D sizing).

## Phase C status (2026-07-04, second pass): DONE — all 12 ASR cards on transcribe.cpp

Landed in one sweep per the "ASR 全部用 transcribe.cpp" decision (whisper too):
- `transcribe_backend.py` (TranscribeCppBackend, batch) is the ONLY ASR backend;
  ctranslate2/sherpa-ASR/transformers/qwen3asr/voxtral_realtime/funasr backends,
  voxtral_stream.py, ort_speechllm.py and cohere_features.py are deleted.
- catalog: every ASR row = gpu-vulkan/gpu-metal/cpu on one handy-computer GGUF
  (Q8_0 whisper+SenseVoice, Q4_K_M speech-LLMs, Q6_K Fun-ASR per author WER).
- accel: Machine.tc_kinds (transcribe.cpp backend probe) feeds gpu-vulkan/metal
  tier availability; the UI's GPU override ('cuda') now pins any accelerator tier.
- native_models: generic one-GGUF-file download rule for all ASR ids.
- setup.sh: torch/transformers-fork/faster-whisper/librosa/funasr/mistral-common
  REMOVED; runtimes = transcribe-cpp + sherpa-onnx + onnxruntime(+nvidia cuDNN/
  cuBLAS wheels for the GPU flavor, _cudnn_preload already handles that layout).
- Verified full-path (resolve→load→transcribe) on the 4070 via Vulkan:
  whisper-tiny RTF 0.0042, fun-asr-mlt RTF 0.0161 (correct ja text),
  cohere RTF 0.0096, sensevoice RTF 0.0055.
Follow-up status (2026-07-04 evening):
- [x] Voxtral streaming: TranscribeCppStreamBackend + _TcStream adapt
      session.stream()'s committed/tentative to the engine's feed/drain/end
      contract (committed-prefix deltas only). Real Vulkan verify: partials
      stream, EN final exact, 2nd utterance (ja) on the same session correct
      WITH ITN+punct; RTF 0.55.
- [x] WER spot-checks (Vulkan, real clips): whisper-large-v3 all 5 langs
      correct (RTF ~0.03, zh in traditional script — known whisper trait);
      qwen3-asr all 5 correct (RTF 0.016–0.023); granite-2b en/ja + 2b-plus
      en correct (~0.03); earlier: cohere/sensevoice/fun-asr/whisper-tiny.
- [x] SenseVoice ITN: not exposed in Python bindings 0.1.1 (supports('itn')
      reports capability only; no run/family knob). Accepted; upstream ask.
      NOTE Voxtral/whisper/qwen3 outputs DO carry ITN+punctuation.
- Phase D: torch-free import gate test added; prefetch fetches the catalog
  GGUF; SOKUJI_VENV knob for clean rebuilds; venv size measurement below.

## Phase C (superseded — kept for reference) — ASR speech-LLMs → ORT

Order: Cohere (usage #1, CPU-viable, CUDA-safe graph) → Granite 2b →
Granite 2b-plus → Qwen3-ASR → Voxtral (last; CUDA tier gated on the ORT
release with #29525).

Cohere port facts (researched 2026-07-04):
- repo `onnx-community/cohere-transcribe-03-2026-ONNX`: `onnx/encoder_model*.onnx`
  (+ fp16/q4/q4f16/quantized variants) + `onnx/decoder_model_merged*.onnx`,
  tokenizer.json, preprocessor_config.json.
- feature extractor = NeMo FilterbankFeatures ("CohereAsrFeatureExtractor"):
  16 kHz, preemphasis 0.97, n_fft 512, win 400, hop 160, 128 mels, log,
  per-feature normalization, dither 1e-5 (set 0 for determinism).
- decoder: 8 layers, heads==kv_heads==8 (no GQA → CUDA EP safe TODAY),
  vocab 16384, bos 4, eos 3, prompt_format "cohere_asr".
- golden source: the venv's transformers 5.13 fork has CohereAsrFeatureExtractor
  + CohereAsrForConditionalGeneration — use them for feature/logit parity tests
  BEFORE Phase D removes transformers.

C1 Cohere status (2026-07-04): DONE for the cpu tier —
`cohere_features.py` (golden-parity numpy front end) + `ort_speechllm.py`
(CohereOnnxBackend: encoder + merged-decoder KV greedy loop, q4 variant,
2.1GB pinned file set). Real-audio verify: CPU RTF 0.115 (8.7× realtime),
correct transcript. ORT baseline bumped 1.20.1 → 1.23.2 (q4 export needs
GatherBlockQuantized `bits`). OPEN: gpu-cuda tier emits EMPTY transcripts on
ORT 1.23.2 (eos-first; 833 Memcpy CPU-fallback nodes) — next steps: try the
fp16 variant on CUDA, or per-step logits diff CPU vs CUDA to find the bad op;
row ships cpu-only until fixed. CohereTransformersBackend deleted.

Per model:
- [ ] C\*.1 port the WASM worker's preprocessing (mel/feature extraction) to
      numpy in a new `ort_speechllm.py` backend family
- [ ] C\*.2 encoder+decoder-merged ORT session, KV-cache decode loop,
      streaming partials preserved (voxtral_stream.py contract)
- [ ] C\*.3 parity check vs the transformers backend on the benchmark clips
      (same harness as the Phase-2 GPU benchmark), RTF + WER eyeball
- [ ] C\*.4 catalog row flips backend; transformers row deleted

Voxtral extras:
- [ ] C5.a session options: disable GroupQueryAttentionFusion (#29524
      workaround) until fixed upstream
- [ ] C5.b CUDA deployment gated on `onnxruntime >= <first release with #29525>`

## Phase D — setup.sh / packaging flip (DONE 2026-07-04)

- [x] D1 setup.sh torch-free (landed with the ASR sweep); GPU flavor installs
      nvidia-cudnn-cu12 + nvidia-cublas-cu12. `compressed-tensors` (FP8-era
      leftover) removed from requirements — it silently re-pulled
      torch+triton+transformers+nvidia (+4.1 GB) into a "clean" venv.
- [x] D2 clean-venv import health: installed set exact, tc_kinds=(cpu,vulkan),
      NVML sees the 4070, ORT 1.23.2 with CUDA EP, zero torch-era packages
      importable. cudnn-preload loads all 8 libs from the standalone wheel.
- [x] D3 (repurposed — CT2 is gone): MOSS TTS GPU smoke on the clean venv:
      CUDA EP sessions created via the pip cuDNN, 2.56s audio in 813ms.
- [x] D4 measured: CPU flavor 397 MB, GPU flavor 3.1 GB (was 8.7 GB) — see
      spec table. ASR keeps Vulkan GPU even in the CPU flavor.
- [x] D5 prefetch fetches catalog GGUFs; spec/plan updated.

## Verification gates

- sidecar pytest suite green after every phase
- renderer vitest suite untouched/green (catalog wire shape unchanged)
- no `import torch|transformers|funasr|librosa` under sokuji_sidecar/ after
  Phase C+D (grep gate in CI-able script)


## Phase E — unified device + variant selection (spec: 2026-07-05 §8)

Increments, each independently landable and green:

- [x] E1 foundation: Machine gains stable GPU identity from tc.backends()
      (`gpus: (kind, name, mem_total)`), fingerprint includes identity but
      NEVER volatile mem_free; new fresh-read helpers `device_free_bytes()`
      (tc primary, NVML fallback) and `ram_free_bytes()` (psutil).
- [x] E2 translate fully-resident quant rule: `_llamacpp_variant_row` prefers
      the LARGEST quant whose size×1.1 fits fresh free − reserved; --fit only
      when nothing fully fits (budget ≥ 50% of default-quant size), else cpu.
- [x] E3 ASR quality ladder: big cards (≥1GB) gain a Q8_0 alt rung in the
      catalog; GPU pick walks quality-descending with the same budget check;
      CPU takes the SMALLEST quant (bandwidth-bound). variantIds wired for
      kind=asr. PLUS (found during E3): load-time selection restricts to
      quants already downloaded (_downloaded_quants) for BOTH asr and
      translate — an absent upgrade rung must never beat a cached default.
- [x] E4 cross-stage ledger (core): stage→bytes ledger fed by load_measured
      actuals (0 for cpu landings; vulkan/metal deltas now measured via
      device_free_bytes); translate reserve is ledger-aware — retires the
      stacked-padding over-reserve. Remaining E4 tail: metal unified-memory
      branch + allocation-order planning (needs a session-plan message).
- [ ] E5 renderer: generalize the variant picker beyond translation cards;
      surface plan reasons ("Auto: Q8_0 — fits 4.7GB of 10.9GB free").
- [ ] E6 bench keys already include compute_type — extend the demotion pass
      to compare same-device different-quant entries.
