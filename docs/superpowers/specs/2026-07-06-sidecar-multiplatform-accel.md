# Sidecar Multi-Platform Hardware Acceleration — Spec

**Date**: 2026-07-06
**Branch**: native-sidecar
**Design doc (diagrams, benchmarks, decision log)**: https://claude.ai/code/artifact/63c48cb2-d01e-40a8-8119-cb1498c71512

## Goal

Every inference stage of the native sidecar gets the best available hardware
acceleration on Windows, Linux and macOS across GPU vendors; models declare
which platforms they support; users download a self-contained sidecar bundle
matched to their OS/hardware; no NVIDIA-specific probing library (NVML)
remains in the codebase.

## Decisions (all settled 2026-07-06, evidence in the design doc)

| # | Decision | Evidence / constraint |
|---|----------|----------------------|
| D1 | ORT ships as **two SKUs**: `onnxruntime-gpu` (CUDA) for NVIDIA on Win+Linux; `onnxruntime-directml` 1.24.4 for non-NVIDIA Windows. | WebGPU EP rejected by full-pipeline PoC (9–19× behind CUDA on 4070, vocoder VK OOM). All ORT variant wheels share the `onnxruntime` module name — mutually exclusive, one per bundle. |
| D2 | DML SKU runs **all graphs on DML, including autoregressive ones** — no pre-emptive AR→CPU routing. Real AR RTF, heavy-TTS usability and ORT 1.24.4 load compatibility are verified later on a physical Windows machine. | Linux-measured RTF numbers must not be extrapolated to Windows hardware. DML requires Python ≥3.11 (bundle-local, does not affect the Linux venv). |
| D3 | **Opus-MT translation moves to CTranslate2** (int8, CPU-only by design). | Benchmark (ja→en, 30 sentences, i7-14700F, independently verified): CT2 int8 greedy 23.6 ms/sentence vs 262 ms production ORT loop (~11×), 332 vs 553 MB RSS. `marian_onnx.py` is deleted with the switch (this also removes the confirmed empty-translation bug: ignored `bad_words_ids=[[pad]]`, 4/30 common ja sentences). |
| D4 | Opus-MT model assets are **converted and self-hosted** (per-pair HF repos mirroring the `gaudi/opus-mt-*-ctranslate2` layout). | 4 of 13 gaudi repos are broken (no `model.bin`: en-es, en-ar, en-ru, en-jap). Conversion via `ct2-transformers-converter --quantization int8` offline (dev machine; torch allowed there, sidecar stays torch-free). Source tokens must get `</s>` appended manually (`add_source_eos=false` in these conversions). |
| D5 | **macOS TTS goes MLX** (`mlx-audio`): Qwen3-TTS (first-class upstream + mlx-community quants), MOSS nano (dedicated class). Supertonic stays CPU (no MLX port; small enough). | Apple Silicon + macOS ≥14 only → catalog needs an "Apple Silicon required" dimension. CoreML EP rejected (no Attention/GQA/MatMulNBits kernels). |
| D6 | **llama.cpp gains a `vulkan` flavor** so AMD/Intel GPUs accelerate translation LLMs. | Upstream official releases already ship prebuilt `win-vulkan-x64.zip` and `ubuntu-vulkan-{x64,arm64}.tar.gz` (verified at b9876). Windows: extend the GitHub assets table. Linux: official ubuntu-vulkan (verify glibc) or bucket build. Flavor choice: NVIDIA→cuda, Apple→metal, other dGPU→vulkan, none→cpu. |
| D7 | **NVML (`nvidia-ml-py`) is removed.** Device truth = transcribe.cpp probe (all-vendor devices + VRAM total/free; NVIDIA detection via device description string), llama.cpp's own probe binaries (SM/featcode), `_apple_silicon()`. | ORT `get_ep_devices()` verified unusable (no CUDA device enumeration on Linux, no memory fields). CUDA `min_capability` is production-dead code — delete. `hardware_info.gpus[]` switches to the tc probe (fixes empty array on mac/AMD). |
| D8 | **cuDNN handling is officialized** in the nvidia SKU: `onnxruntime-gpu[cuda,cudnn]` extras + `onnxruntime.preload_dlls()` replace hand-written `_cudnn_preload.py` and the Electron `LD_LIBRARY_PATH` injection. | Official mechanism since ORT 1.21. |
| D9 | Catalog `Deployment` gains a **`platforms` tag** (default all three OSes) plus an Apple-Silicon-required marker; resolvers filter by `platform.system()`. Protocol/UI unchanged (tier strings are free-form; renderer already renders unknown tiers). | |
| D10 | **User-facing sidecar = self-contained bundles** (embedded Python + all wheels). `setup.sh` remains a developer/CI tool only. SKUs: `sidecar-nvidia` (Win+Linux), `sidecar-directml` (Windows non-NVIDIA), `sidecar-mac`. Models and llama-server binaries stay download-on-demand. | Open item: Linux non-NVIDIA (reuse nvidia bundle with CPU fallback vs a separate CPU bundle). |
| D11 | Cleanup items riding along: remove `gpu-cuda` tiers from sherpa TTS cards (stock sherpa-onnx wheel is verified CPU-only — currently produces a false GPU badge and phantom VRAM ledger claims); replace the Apple M1–M5 whitelist in `llama_runtime._metal_config` with degrade-with-warning. | sherpa-onnx 1.13.3: bundled ORT has only CPUExecutionProvider (runtime-verified). |
| D12 | **All SKUs and the dev venv unify on Python 3.12.** | cp312 wheels verified for Linux+Windows: onnxruntime-gpu 1.23.2, onnxruntime-directml 1.24.4, sherpa-onnx 1.13.3, ctranslate2 4.8.1, sentencepiece 0.2.0; transcribe-cpp is py3-none-any; mlx supports 3.12 on arm64 macOS. `setup.sh` prefers python3.12 (change lands with P7). Dev-venv rebuild is deferred until P1 execution finishes (implementer subagents run on the current 3.10 venv). |

## Out of scope

- sherpa-onnx acceleration (VAD + VITS stay CPU — verified sufficient).
- HIP/SYCL llama.cpp flavors (optional post-Vulkan refinement).
- WinML (`onnxruntime-windowsml`) — re-evaluate in 6–12 months.
- Qwen3-TTS natural-generation instability (all-EP model-level issue — separate follow-up).

## Workstream roadmap (one plan per workstream)

| Plan | Workstream | Depends on |
|------|-----------|------------|
| P1 | Opus-MT → CTranslate2 (D3, D4) | — |
| P2 | NVML removal + probe unification + cleanups (D7, D11) | — |
| P3 | catalog `platforms` tags (D9) | — |
| P4 | llama.cpp vulkan flavor (D6) | P2 (flavor choice uses tc probe) |
| P5 | DML enablement in ORT TTS backends + cuDNN officialization (D1, D2, D8) | P3 (gpu-dml tier is windows-only) |
| P6 | macOS MLX lane (D5) | P3 (macos/AS tags) |
| P7 | Self-contained bundle packaging + Electron SKU selection (D10) | P1–P6 |

## Windows physical-machine verification checklist (deferred, gates D2)

1. Our ONNX exports load on ORT 1.24.4 (opset ceiling).
2. DML AR-graph RTF vs same-machine CPU (MOSS nano, Qwen3-TTS 0.6B).
3. VRAM / per-step recompilation behavior on a growing-KV decode loop.
4. Only if results are unacceptable: revisit AR→CPU routing or model surgery.

## D7 (NVML removal) — known limitation + hardware validation

After P2, NVIDIA presence is derived **solely** from the transcribe.cpp device
probe (`has_nvidia` = a tc-probe device description contains "nvidia"), replacing
NVML's driver-level detection. Two consequences to gate the NVIDIA release on:

- **Coupling (Important):** a real NVIDIA box where the tc probe can't enumerate
  the GPU (no Vulkan ICD, headless, or a CPU-only transcribe-cpp build) but CUDA +
  `onnxruntime-gpu` *can* will silently route ORT-CUDA TTS and the llama flavor to
  CPU, with no `fallbackReason`. If a no-Vulkan/headless NVIDIA-CUDA config is in
  scope, add a secondary presence signal (llama.cpp SM-probe / CUDA-runtime
  cross-check — P4/P5 territory), else document as a known limitation.
- **Substring contract (validated on real hardware, 2026-07-06):** on the dev
  4070 box, `accel.probe().gpus` = `('vulkan', 'NVIDIA GeForce RTX 4070 SUPER',
  12878610432)`, `has_nvidia()` = True, `device_free_bytes()` = ~11.2 GB — the
  "nvidia" substring and the tc free-VRAM path hold against ground truth (CI only
  ever exercised the synthetic string). Re-confirm on Windows+NVIDIA before ship.

Both are consequences of the D7 decision (tc probe as sole device truth), not
implementation defects; the P2 whole-branch review rated the branch ready to merge.
