# Torch-free sidecar — phased implementation plan

**Spec**: `docs/superpowers/specs/2026-07-04-sidecar-torch-free-design.md`
**Branch**: `native-torch-free`

Each phase is independently landable and keeps the sidecar green (tests +
import health) — torch remains installed until Phase D flips setup.sh, so
mid-migration the tree always runs.

## Phase A — shared infra off torch/librosa/transformers

- [ ] A1 accel.py: NVML probing (`nvidia-ml-py`) replaces `torch.cuda.*`
      (device props, capability, `mem_get_info`). Unit tests mock pynvml.
- [ ] A2 tts_engine.py: remove `torch.cuda.empty_cache()` best-effort block.
- [ ] A3 tts_backends.py: `AutoTokenizer` → `tokenizers.Tokenizer`
      (tokenizer.json is present in the Qwen3-TTS ONNX repos).
- [ ] A4 qwen3_tts/mel.py: numpy Slaney mel filterbank (golden-value test
      against current librosa output, generated once before the swap).
- [ ] A5 audio io: `librosa.load/resample` → `soundfile` + `soxr` in
      tts_backends (clip-clone reference loading).
- [ ] A6 requirements.txt: + tokenizers (already), soundfile, soxr,
      nvidia-ml-py; nothing removed yet.

## Phase B — ASR: drop funasr

- [ ] B1 catalog.py: sense-voice rows → `sherpa` backend (CPU tier;
      artifact = sherpa-onnx sense-voice export repo). GPU tier removed for
      now (CPU RTF ~0.03; ORT-CUDA variant can come back later).
- [ ] B2 Fun-ASR-Nano: research ONNX availability (sherpa-onnx export /
      community). If none: keep card, deployments stay funasr but the backend
      probe reports unavailable when funasr is absent → tier gating handles UI.
      Follow-up issue for the export.
- [ ] B3 delete FunAsr backends once B1/B2 land (or leave behind an
      availability probe until Phase D removes funasr from the venv).

## Phase C — ASR speech-LLMs → ORT (one PR per model)

Order: Cohere (usage #1, CPU-viable, CUDA-safe graph) → Granite 2b →
Granite 2b-plus → Qwen3-ASR → Voxtral (last; CUDA tier gated on the ORT
release with #29525).

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
