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
- [ ] B2 Fun-ASR-MLT-Nano off funasr. Researched leads (2026-07-04):
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
- [ ] B3 delete _FunAsrBackend/FunAsrNanoBackend once B2 lands.

## Phase C — ASR speech-LLMs → ORT (one PR per model)

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

## Phase D — setup.sh / packaging flip

- [ ] D1 remove torch/torchaudio/triton, transformers fork, funasr, librosa
      from setup.sh; add nvidia-cudnn-cu12/nvidia-cublas-cu12(+cudart/curand
      as verified) for the GPU flavor
- [ ] D2 clean-venv import health check: every backend's availability probe
      (accel.py `mods` map) passes/fails as expected on CPU and GPU flavors
- [ ] D3 whisper GPU smoke test on CT2 against the pip nvidia wheels
- [ ] D4 measure final venv sizes (GPU/CPU) → update spec table; assert ≤3 GB
- [ ] D5 prefetch_models.py + docs update

## Verification gates

- sidecar pytest suite green after every phase
- renderer vitest suite untouched/green (catalog wire shape unchanged)
- no `import torch|transformers|funasr|librosa` under sokuji_sidecar/ after
  Phase C+D (grep gate in CI-able script)
