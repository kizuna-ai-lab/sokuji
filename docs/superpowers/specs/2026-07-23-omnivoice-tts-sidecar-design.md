# OmniVoice TTS — Local Native (sidecar) integration

**Date:** 2026-07-23 (rev 2, post-spike)
**Status:** Design — Phase 0 spike **complete (✅ GO)**; Phases 1–3 approved in principle, pending plan
**Tracking issue:** [#351](https://github.com/kizuna-ai-lab/sokuji/issues/351)

## Summary

Add **OmniVoice** (`k2-fsa/OmniVoice`) — a massively multilingual, zero-shot voice-cloning TTS on a
Qwen3-0.6B backbone — as a **Local Native (Python sidecar)** TTS card.

The Phase 0 spike established that the community ONNX export (`onnx-community/OmniVoice-Onnx`) is
**unusable** (its `llm_decoder` is exported causal; OmniVoice needs bidirectional attention → noise),
but the **model itself is sound** and a **custom bidirectional re-export works end-to-end**
(audio human-confirmed). Therefore we **produce and host our own corrected ONNX** and ship a sidecar
backend that runs OmniVoice's **real** decoding algorithm (ported to numpy), not the stock
`inference.py`.

Weights are **CC-BY-NC** (root: Emilia training data). Product decision: ship behind an explicit
**non-commercial consent gate**; NC responsibility is passed to the user. Because there is no usable
upstream ONNX, **we host our own corrected re-export** (packaging option A).

## Goals

- Ship OmniVoice as a native TTS card with zero-shot clip cloning, multilingual (`languages=("multi",)`).
- Host a **corrected, bidirectional** ONNX re-export we control.
- Run the **real** OmniVoice decoding (CFG + special-token framing + gumbel + schedule), not `inference.py`.
- Gate download behind a truthful CC-BY-NC consent dialog (reusable, license-aware).

## Non-goals (v1 / YAGNI)

- Voice-design attribute controls (gender/age/pitch/whisper) and non-verbal symbols (`[laughter]`).
- Auto-transcribing the reference clip (cloning needs **no** transcript — spike finding).
- Intra-utterance streaming (`STREAMING=False`).
- CPU deployment tier (spike: causal export RTF 2.46 on 20-core Grace; bidirectional is heavier → GPU-only).

## Spike results (Phase 0 — DONE, 2026-07-23)

Full report: `.spike/out/README.md`. Machine: NVIDIA GB10 (aarch64/sbsa), sidecar `.venv`,
`onnxruntime-gpu` 1.24 (CUDA 13). Key findings that shape this design:

- **Stock export broken 3 ways** (all in `inference.py`): (1) causal `llm_decoder` (genai ModelBuilder
  builds `Qwen3ForCausalLM`); (2) no classifier-free guidance; (3) missing special-token framing +
  naive greedy. Proven: probe on the stock ONNX shows causal attention (change last pos → earlier
  Δ=0.0); generated codes collapse to 2–9 unique values/codebook (noise). Not caught upstream because
  `eval.py` skips the LLM and never tests end-to-end.
- **Model is sound.** PyTorch `generate()` → good speech (en/zh/ja).
- **Re-export works.** Bidirectional `llm_decoder` (`torch.onnx.export`, full 4-D mask) is numerically
  identical to PyTorch (max_abs 2.4e-4, cos 1.000000); driving `generate()` with it → speech,
  **human-confirmed intelligible incl. JA**.
- **Runtime:** plain `onnxruntime` (no `onnxruntime-genai` at inference); cuDNN via `ort.preload_dlls()`
  (sbsa). Stock causal export hit **RTF 0.22–0.28 on GB10 CUDA** — headroom for the no-KV bidirectional
  forward; fp16/GPU RTF to be re-measured in Phase 1.
- **`transcript_required = False`** — cloning consumes only the reference audio (Higgs), not text.

## The real decoding algorithm (source of truth)

From `modeling_omnivoice.py` (downloaded to `.spike/models/omnivoice_src/`). The v1 backend must port
these to numpy — **`inference.py` is discarded**:

- `_prepare_inference_inputs` (L1064): builds `input_ids` = `style_tokens`
  (`<|denoise|><|lang_start|>{lang}<|lang_end|><|instruct_start|>{instruct}<|instruct_end|>`) +
  `text_tokens` (`<|text_start|>{ref_text+text}<|text_end|>`, via `_tokenize_with_nonverbal_tags`) +
  optional `ref_audio_tokens` + `target` (all MASK); `audio_mask` marks the audio region.
- `_generate_iterative` (L1145): builds a **bidirectional 4-D mask** (`[:, :, :L, :L]=True`), batches
  **cond + uncond** (2·B) for CFG, runs `num_step` steps; each step: forward → per-item extract cond/uncond
  logits → `_predict_tokens_with_scoring` (CFG combine L1299, mask out `audio_mask_id`, greedy or gumbel
  by `class_temperature`) → position scores minus `layer_penalty_factor·layer_id` → gumbel
  (`position_temperature`) → topk `k` from the per-step `schedule` → unmask.
- Schedule: `_get_time_steps(t_start=0, t_end=1, num_step, t_shift)` (L1509) + per-codebook counts (L1232).
- Defaults (`OmniVoiceGenerationConfig`, L98): `num_step=32, guidance_scale=2.0, t_shift=0.1,
  layer_penalty_factor=5.0, position_temperature=5.0, class_temperature=0.0, denoise=True`.
- Duration → `num_target_tokens`: from text length / `duration` / `speed` at `frame_rate` (25 fps). Port
  the estimator (≈ L1009) or a faithful heuristic.

## Architecture / components

### Component 1 — Offline re-export toolchain (build-time, not shipped in the sidecar)
Produces the ONNX artifacts we host. Runs in an isolated env (torch + transformers≥5.4 + omnivoice +
onnxscript — none of which touch the torch-free runtime sidecar). Steps:
- Load `k2-fsa/OmniVoice` (`AutoModel.from_pretrained(..., trust_remote_code=True,
  attn_implementation="eager")`).
- **Re-export `llm_decoder` bidirectional**: wrap `model.llm`, forward with a full attention mask,
  `torch.onnx.export` (opset 20) → `(inputs_embeds, attention_mask) → hidden_states`. Produce **fp16**
  and **int4** variants (verify each still matches PyTorch, cos≈1.0).
- **Re-export ALL graphs from source** (decision 2026-07-23): `audio_embeddings_encoder`,
  `audio_heads_decoder`, and the 4 Higgs graphs, alongside the bidirectional `llm_decoder` — nothing is
  reused from `onnx-community`, so the whole artifact's provenance is ours. Reuse the authors' wrapper
  logic (`user_script.py` / `codes/model_wrappers.py`) for the non-LLM graphs, but we run the export and
  own the output. (Higgs: export fp32 — the fp16 `semantic_encoder` is a broken export, see spike.)
- Publish to a repo we control (e.g. `jiangzhuo9357/omnivoice-onnx-bidi`) with the layout the backend
  expects. This is the artifact the card downloads.
- Keep the toolchain script + a pinned env in-repo (e.g. `scripts/reexport-omnivoice/`) so the artifact
  is reproducible.

### Component 2 — Sidecar backend `omnivoice_onnx` (runtime, torch-free)
Mirrors `cosyvoice3` for the plumbing; new numpy decoder for the algorithm.
- **Runtime package** `sidecar/sokuji_sidecar/omnivoice/`:
  - `runtime.py` — ONNX sessions for the 3 backbone graphs + 4 Higgs graphs; cold/hot device placement +
    silent-CUDA-fallback fail-fast (pattern `cosyvoice3/runtime.py:62-79`); `session_factory` test seam.
  - `decode.py` — **numpy port of `_generate_iterative` + `_prepare_inference_inputs`** (CFG,
    special-token framing, gumbel position selection, schedule, layer penalty). The crux of the work.
  - `frontend.py` — Qwen2 tokenizer (`tokenizers` pkg) + the special-token IDs + `_combine_text` /
    nonverbal-tag handling; duration→frames estimator.
  - `higgs.py` — encode (clone) + decode (reuse the proven pipeline; fp32 Higgs — fp16 `semantic_encoder`
    is a broken export, see spike).
  - No `librosa`/`transformers`/`torch` at inference (AST-guard test, like `test_cosyvoice3_backend.py:52`).
- **Backend class** in `tts_backends.py`: `@register_backend`, `NAME="omnivoice_onnx"`, `CLONES=True`,
  `STREAMING=False`, `sample_rate=24000`; `load/unload/set_voice(audio, sr)` (**no `ref_text`** →
  transcript not required), `generate(text, speed)`, `list_builtin_voices`.
- **Gate** `accel.py:131`: `"omnivoice_onnx": "onnxruntime"`.
- **Catalog card** `catalog.py`: `id="omnivoice-0.6b"`, `languages=("multi",)`, `clones=True`,
  `named_voices=True`, **`transcript_required=False`**, `streaming=False`, `sample_rate=24000`,
  `deployments=` gpu-cuda (RTF from Phase-1 re-measure), `repos=(_OMNIVOICE_REPO,)` →
  `SOKUJI_OMNIVOICE_REPO` default = **our hosted repo**, `license=` the CC-BY-NC descriptor (Phase 3),
  `size_bytes`, `sort_order`.
- **Tests**: `test_omnivoice_backend.py`, `test_omnivoice_runtime.py`, `test_omnivoice_decode.py` (the
  decoder is the risk — test against small fixtures + a PyTorch-parity check where feasible); extend
  `test_catalog.py` + `test_accel.py` allow-lists.

### Component 3 — Renderer license-consent gate (reusable, license-aware)
Unchanged from rev 1 except the source repo is **ours**:
- `license` descriptor threaded `catalog.py TtsModel` → `accel.py` serializer (759-767) →
  `nativeProtocol.ts NativeModelInfo` → `nativeCatalog.ts` card. Fields: `spdx="CC-BY-NC-4.0"`,
  `nonCommercial=true`, `sourceRepo`, `attribution="k2-fsa/OmniVoice"`, `url`.
- `LicenseConsentModal` (on `Modal`, `WarningModal`-style) fired from `handleDownload`
  (`NativeModelManagementSection.tsx:243`) **before** `download()` when `license.nonCommercial`; states the
  true CC-BY-NC terms, Sokuji disclaimer, non-commercial reminder, k2-fsa attribution; **accept once,
  persisted per-model**.
- Clone UX: reuse `NativeVoiceSection`/`VoiceLibrarySection` — but since `transcript_required=False`, the
  transcript field is hidden (clip-only import/record).
- i18n: new keys in all 30 `src/locales/*/translation.json` (consistency test enforces).

## Data flow (runtime)
```
Download click → handleDownload → (license.nonCommercial) LicenseConsentModal → accept (persist)
  → nativeModelStore.download → sidecar downloads OUR omnivoice-onnx-bidi repo
Run → TtsEngine.init → accel.resolve_tts → make_backend("omnivoice_onnx") → load ONNX graphs
  → [clone: set_voice(clip) → higgs encode → ref codes]
  → generate(text): frontend frames text w/ special tokens → decode.py (CFG + gumbel + schedule over
     audio_embeddings→bidi llm→audio_heads) → audio codes → higgs decode → 24 kHz → int16
```

## Error handling / testing / risks
- Errors: `BackendLoadError` on load failure → resolver fallback / `NoUsablePlan`; CUDA silent-CPU fail-fast;
  consent declined → no download.
- Testing: the **numpy decoder** is the primary risk — unit-test its pieces and, where feasible, assert
  parity against the PyTorch `_generate_iterative` on a fixed seed/tiny case. Plus backend/runtime/catalog/
  accel tests mirroring cosyvoice3; i18n consistency; a real-model manual smoke.
- Risks: (1) numpy decoder fidelity (CFG/gumbel/schedule) — highest; (2) fp16/int4 re-export must preserve
  quality (re-verify vs PyTorch); (3) GPU RTF for the no-KV bidirectional forward (re-measure); (4) we host
  a CC-BY-NC-derived artifact — accepted via consent gate + product decision; (5) JA kanji quality
  (human-confirmed OK in spike, keep an eye in QA).

## Open items resolved by Phase 1
- fp16/int4 re-export quality; GB10 CUDA RTF for the bidirectional forward; final `size_bytes`;
  duration-estimator fidelity; exact special-token id set from the tokenizer.
