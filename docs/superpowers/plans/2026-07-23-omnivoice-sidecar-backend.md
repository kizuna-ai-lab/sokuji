# OmniVoice Sidecar Backend (Plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runtime `omnivoice_onnx` Local-Native (sidecar) TTS backend that runs OmniVoice's **real** non-autoregressive decoding (classifier-free guidance + special-token framing + gumbel scheduling) in **numpy over plain onnxruntime**, against the corrected artifact `jiangzhuo9357/omnivoice-onnx-bidi`, producing intelligible zero-shot-cloning speech.

**Architecture:** A torch-free runtime package `sidecar/sokuji_sidecar/omnivoice/` (frontend tokenizer/framing, ONNX session runtime, the ported decoder, Higgs codec glue) + a backend class registered like `cosyvoice3`, a catalog card, and the accel gate. The renderer downloads + shows the card automatically from the wire catalog (the consent gate is Plan 3).

**Tech Stack:** Python (torch-free), `onnxruntime`(-gpu), numpy, `tokenizers`, `soxr`/`soundfile`; mirrors `sidecar/sokuji_sidecar/cosyvoice3/`.

## Global Constraints

- **Torch-free runtime.** No `torch`/`transformers`/`librosa` imported at inference — AST-guarded (mirror `sidecar/tests/test_cosyvoice3_backend.py:52`). Tokenizer via the `tokenizers` package.
- **Plain onnxruntime**, no `onnxruntime-genai`. Accel gate maps `"omnivoice_onnx": "onnxruntime"`.
- **Repo:** `SOKUJI_OMNIVOICE_REPO` default = `jiangzhuo9357/omnivoice-onnx-bidi`. Layout: `<variant>/{audio_embeddings_encoder,llm_decoder,audio_heads_decoder}.onnx(+.data)` + tokenizer/config; shared `audio_tokenizer/{acoustic,semantic,quantizer}_encoder.onnx,higgs_decoder.onnx` (fp32); variants `fp16`,`int4`.
- **Card:** `id="omnivoice-0.6b"`, `languages=("multi",)`, `clones=True`, `named_voices=True`, **`transcript_required=False`** (cloning uses only the reference AUDIO), `streaming=False`, `sample_rate=24000`, **GPU-CUDA-only** deployment (int4 recommended; CPU too slow).
- **Split-Higgs interface contract (carried from Plan 1 review):** the exported Higgs graphs use codes layout **(num_q=8, B, T)**, and the acoustic/semantic encoders must be aligned by the CONSUMER via **`T = min(acoustic_T, semantic_T)`** truncation before `quantizer_encoder`. Replicate exactly.
- **Real algorithm source of truth:** `.spike/models/omnivoice_src/modeling_omnivoice.py`. Config defaults (`OmniVoiceGenerationConfig`, L98): `num_step=32, guidance_scale=2.0, t_shift=0.1, layer_penalty_factor=5.0, position_temperature=5.0, class_temperature=0.0, denoise=True`. Do NOT re-adapt `inference.py` (discarded — it was causal + no-CFG + no framing).
- **Bidirectional attention:** feed `llm_decoder` a **full 4-D mask** (the whole point of the re-export). For CFG the batch is `2·B` (cond rows 0..B-1, uncond rows B..2B-1) with per-row full square blocks + a padding diagonal for the shorter uncond (mirror `_generate_iterative` L1199-1217).
- Comments English. Add nothing to the renderer except what the wire catalog needs (consent UI is Plan 3).

---

## File Structure

- `sidecar/sokuji_sidecar/omnivoice/__init__.py`
- `sidecar/sokuji_sidecar/omnivoice/runtime.py` — ONNX session construction (3 backbone + 4 Higgs), device placement, silent-CUDA-fallback fail-fast, `session_factory` seam.
- `sidecar/sokuji_sidecar/omnivoice/frontend.py` — `tokenizers` Qwen2 load; special-token framing; nonverbal-tag tokenization; duration→num_target_tokens.
- `sidecar/sokuji_sidecar/omnivoice/higgs.py` — reference-clip encode (with the min-T alignment) + codes→waveform decode.
- `sidecar/sokuji_sidecar/omnivoice/decode.py` — the ported `_generate_iterative` (CFG, gumbel, schedule, unmask loop) + `_predict_tokens_with_scoring` + `_get_time_steps`/`_gumbel_sample`/`_filter_top_k`.
- `sidecar/sokuji_sidecar/tts_backends.py` — add `OmniVoiceOnnxBackend`.
- `sidecar/sokuji_sidecar/catalog.py` — add the card + repo env.
- `sidecar/sokuji_sidecar/accel.py` — add the gate entry.
- Tests: `sidecar/tests/test_omnivoice_frontend.py`, `test_omnivoice_higgs.py`, `test_omnivoice_decode.py`, `test_omnivoice_backend.py`; extend `test_catalog.py` + `test_accel.py`.

**Parity oracle for tests:** a separate torch env can run the PyTorch `model.generate()` (the `.spike/exportenv`) — decoder parity tests compare the numpy decoder against PyTorch **with `position_temperature=0` and `class_temperature=0`** (fully deterministic: no gumbel, greedy tokens) so codes match; end-to-end audio smoke uses the defaults. Where a PyTorch oracle is impractical inside the sidecar test env, assert against fixtures captured from the oracle + intelligibility (TTS→ASR round-trip via the sidecar's own Whisper is out of scope; use signal + code-diversity + a captured-fixture parity instead).

---

## Task 1: Runtime package skeleton + ONNX session loader

**Files:** Create `omnivoice/__init__.py`, `omnivoice/runtime.py`; Test `sidecar/tests/test_omnivoice_runtime.py`.

**Interfaces:**
- Produces: `build_sessions(model_dir, higgs_dir, device, threads, session_factory=None) -> dict` with keys `audio_embeddings, llm_decoder, audio_heads, acoustic_encoder, semantic_encoder, quantizer_encoder, higgs_decoder`. Cold graphs (higgs) pinned CPU, hot (backbone) CUDA-with-fallback + silent-CPU-fallback fail-fast (pattern `cosyvoice3/runtime.py:48-81`). `session_factory` is the test seam.

- [ ] **Step 1: failing test** — assert the 7 keys are built and that a fake `session_factory` receives the expected 7 filenames; assert CUDA fail-fast raises when a hot graph silently lands on CPU.

```python
# sidecar/tests/test_omnivoice_runtime.py
from sokuji_sidecar.omnivoice import runtime
def test_build_sessions_keys(tmp_path, monkeypatch):
    seen = []
    def fake_factory(path, providers):
        seen.append(path.split("/")[-1])
        class S:  # minimal stub
            def get_providers(self): return providers
        return S()
    for f in ["audio_embeddings_encoder.onnx","llm_decoder.onnx","audio_heads_decoder.onnx"]:
        (tmp_path / f).write_bytes(b"x")
    hg = tmp_path / "audio_tokenizer"; hg.mkdir()
    for f in ["acoustic_encoder.onnx","semantic_encoder.onnx","quantizer_encoder.onnx","higgs_decoder.onnx"]:
        (hg / f).write_bytes(b"x")
    s = runtime.build_sessions(str(tmp_path), str(hg), "cpu", 4, session_factory=fake_factory)
    assert set(s) == {"audio_embeddings","llm_decoder","audio_heads","acoustic_encoder","semantic_encoder","quantizer_encoder","higgs_decoder"}
    assert len(seen) == 7
```

- [ ] **Step 2: run — fails** (`ModuleNotFoundError`). Run: `cd sidecar && .venv/bin/python -m pytest tests/test_omnivoice_runtime.py -v`.
- [ ] **Step 3: implement `runtime.py`** mirroring `cosyvoice3/runtime.py` (GRAPH_FILES map; cold=higgs on CPU, hot=backbone on CUDA-with-CPU fallback; `_fail_fast_if_cpu_only` for hot graphs when device=cuda; default `session_factory` builds `ort.InferenceSession`). Include `__init__.py` (empty).
- [ ] **Step 4: run — passes.**
- [ ] **Step 5: commit** `git add sidecar/sokuji_sidecar/omnivoice/__init__.py sidecar/sokuji_sidecar/omnivoice/runtime.py sidecar/tests/test_omnivoice_runtime.py && git commit -m "feat(omnivoice): sidecar ONNX session runtime"`.

---

## Task 2: Frontend — tokenizer, special-token framing, duration estimator

**Files:** Create `omnivoice/frontend.py`; Test `sidecar/tests/test_omnivoice_frontend.py`.

**Interfaces:**
- Produces:
  - `load_tokenizer(model_dir) -> Tokenizer` (the `tokenizers` package; `tokenizer.json` in the variant dir).
  - `build_input_ids(tok, text, *, lang=None, instruct=None, ref_codes=None, num_target_tokens, denoise=True) -> (input_ids: np.int64 (1,8,S), audio_mask: bool (1,S), cond_audio_start:int)` — replicates `_prepare_inference_inputs` (L1064): style tokens `<|denoise|><|lang_start|>{lang}<|lang_end|><|instruct_start|>{instruct}<|instruct_end|>`, text `<|text_start|>{combined}<|text_end|>` (nonverbal-tag split L1528, `add_special_tokens=False`), optional ref audio codes, target = all MASK (id 1024), each row repeated across 8 codebooks.
  - `estimate_target_tokens(text, *, speed=1.0, frame_rate=25) -> int` — port the duration estimate (modeling ~L1009 region; verify against the model).

- [ ] **Step 1: failing test** — build_input_ids on `"hello"` (lang="English") yields shape `(1,8,S)`, audio_mask True only over the target region, MASK id 1024 filling the target, and the special tokens `<|text_start|>`/`<|lang_start|>` present in the ids (look up their ids via the tokenizer). Compare the exact token id sequence to a fixture captured from the PyTorch `_prepare_inference_inputs` (capture it in the `.spike/exportenv` and paste the fixture into the test).
- [ ] **Step 2: run — fails.**
- [ ] **Step 3: implement `frontend.py`** — load `tokenizer.json`; replicate framing + nonverbal split; assemble input_ids/audio_mask; duration estimator. Special-token ids come from the tokenizer's added-tokens (they ARE in the Qwen2 vocab — assert lookups succeed).
- [ ] **Step 4: run — passes** (ids match the captured PyTorch fixture exactly).
- [ ] **Step 5: commit** `feat(omnivoice): frontend tokenizer + special-token framing + duration estimate`.

---

## Task 3: Higgs codec glue (reference-clip encode + decode)

**Files:** Create `omnivoice/higgs.py`; Test `sidecar/tests/test_omnivoice_higgs.py`.

**Interfaces:**
- Produces:
  - `encode_reference(sessions, wav_path_or_array, sr) -> np.int64 (8, T)` — load clip, resample 24k+16k (soxr), run acoustic+semantic encoders, **`T=min(acoustic_T, semantic_T)` truncation** (the split-graph contract), quantizer_encoder → codes; return `(8,T)` (drop the batch axis).
  - `decode(sessions, codes_8xT) -> np.float32 waveform@24k`.

- [ ] **Step 1: failing test** — encode the real clip `scripts/assets/gpt-sovits-voices/classic-zh.wav` → codes `(8,T)`, decode → speech-level RMS `0.02<rms<0.35` + code diversity `>30`; assert the min-T alignment is applied (feed mismatched-length features and confirm no shape error / correct truncation).
- [ ] **Step 2: run — fails.**
- [ ] **Step 3: implement `higgs.py`** (numpy; soxr resample). Reuse the exact ORT session I/O names from the Plan-1 export (`waveform_24k`,`waveform_16k`,`acoustic_features`,`semantic_features`,`codes`,`waveform_24k`).
- [ ] **Step 4: run — passes.**
- [ ] **Step 5: commit** `feat(omnivoice): Higgs reference-encode + decode with min-T alignment`.

---

## Task 4: The decoder — real iterative unmasking (CFG + gumbel + schedule)

**Files:** Create `omnivoice/decode.py`; Test `sidecar/tests/test_omnivoice_decode.py`.

**Interfaces:**
- Produces: `generate_codes(sessions, input_ids, audio_mask, num_target_tokens, *, cfg) -> np.int64 (8, num_target_tokens)` — the numpy port of `_generate_iterative` (L1145): build the **2·B CFG batch** with the bidirectional 4-D mask (cond full block + uncond full block + pad diagonal, L1199-1217); for each of `num_step` steps: backbone forward (audio_embeddings→llm_decoder[full mask]→audio_heads) on the batch; per item extract cond/uncond logits (L1270-1271); `_predict_tokens_with_scoring` (CFG combine `log_softmax(c+guidance·(c−u))`, mask out MASK id, greedy or gumbel by class_temperature); score − `layer_penalty·layer_id`; gumbel(position_temperature); topk `k` from the schedule; unmask. Helpers `_get_time_steps`/`_gumbel_sample`/`_filter_top_k` ported verbatim to numpy. `cfg` carries the `OmniVoiceGenerationConfig` defaults.
- Backbone forward helper `run_backbone(sessions, input_ids, audio_mask, attn_mask_4d) -> logits (B,8,S,1025)` (dtype-match the LLM's declared input dtype, like the Plan-1 `run_backbone_step`).

- [ ] **Step 1: failing test — deterministic parity vs PyTorch.** With `position_temperature=0, class_temperature=0` (no gumbel, greedy), run the numpy decoder and compare the generated codes to a **fixture captured from PyTorch `_generate_iterative`** with the same seed/config/input (capture in `.spike/exportenv`). Assert code agreement ≥ 0.98 (allow tiny fp-driven argmax ties). Also a defaults-config run must yield diverse codes (`>30` unique/codebook) and, decoded via Task-3 higgs, speech-level RMS.
- [ ] **Step 2: run — fails.**
- [ ] **Step 3: implement `decode.py`.** Port each piece from the modeling source with the file:line anchors above. The 4-D mask + CFG batching is the subtle part — build it exactly as `_generate_iterative` L1190-1217.
- [ ] **Step 4: run — passes** (deterministic parity ≥0.98; defaults produce diverse codes + speech).
- [ ] **Step 5: commit** `feat(omnivoice): numpy iterative-unmasking decoder (CFG+gumbel+schedule)`.

---

## Task 5: Backend class + catalog card + accel gate

**Files:** Modify `tts_backends.py`, `catalog.py`, `accel.py`; Test `sidecar/tests/test_omnivoice_backend.py`; extend `test_catalog.py`, `test_accel.py`.

**Interfaces:**
- Produces `OmniVoiceOnnxBackend` (`NAME="omnivoice_onnx"`, `CLONES=True`, `STREAMING=False`, `sample_rate=24000`): `load(model_ref, device, compute_type, config=None)` (snapshot_download variant dir + higgs dir → `runtime.build_sessions` + `frontend.load_tokenizer`); `set_voice(audio, sr)` (**no ref_text** → `higgs.encode_reference` → cache ref codes); `generate(text, speed=1.0)` (`frontend.build_input_ids` → `decode.generate_codes` → `higgs.decode` → float32@24k); `unload`; `list_builtin_voices` staticmethod; `is_loaded`.

- [ ] **Step 1: failing tests** — `test_omnivoice_backend.py`: flags (NAME/CLONES/STREAMING/sample_rate); `set_voice` exposes NO `ref_text` param (transcript not required — the engine introspects the signature, `tts_engine.py:70`); `generate` returns float32 + gen_ms (monkeypatch decode/higgs); no-torch/transformers/librosa AST guard over the `omnivoice/` package; load clears stale voice state. Extend `test_catalog.py` allowed-backends + a `test_omnivoice_card_shape` (id/languages=("multi",)/clones/transcript_required=False/gpu-only) and `test_accel.py` installed+resolvable (mirror `:529-546`).
- [ ] **Step 2: run — fails.**
- [ ] **Step 3: implement.** Backend class mirroring `CosyVoice3OnnxBackend` (`tts_backends.py:665-773`) but `set_voice(self, audio, sr)` (no `ref_text`). Catalog card in `catalog.py` (repo env default `jiangzhuo9357/omnivoice-onnx-bidi`; `Deployment("omnivoice_onnx","gpu-cuda","int4",_OMNIVOICE_REPO,1.0)` + maybe an fp16 row; `repos=(_OMNIVOICE_REPO,)`; card fields per Global Constraints; add the CC-BY-NC `license` descriptor placeholder consumed by Plan 3). `accel.py:131` add `"omnivoice_onnx":"onnxruntime"`.
- [ ] **Step 4: run — passes** (backend + extended catalog/accel suites green).
- [ ] **Step 5: commit** `feat(omnivoice): omnivoice_onnx backend + catalog card + accel gate`.

---

## Task 6: Real-model integration smoke (opt-in)

**Files:** add an opt-in smoke to `sidecar/tests/test_tts_backends.py` (env-gated, mirror `:291-301`).

- [ ] **Step 1:** write an env-gated (`SOKUJI_OMNIVOICE_SMOKE=1`) test: `snapshot_download` the real repo (or use a cached copy), `load` on `gpu-cuda` if available else skip, `set_voice(classic-zh.wav)`, `generate("你好，这是一个测试。")` → assert speech-level RMS + duration>0.
- [ ] **Step 2: run it once manually** on the GB10 (`SOKUJI_OMNIVOICE_SMOKE=1 …`) — record the audio + RTF; **listen** (human gate) to confirm intelligibility. (Not part of the default suite.)
- [ ] **Step 3: commit** `test(omnivoice): opt-in real-model integration smoke`.

---

## Self-Review

**Spec coverage (Component 2):** runtime (T1), frontend framing + duration (T2), Higgs glue w/ split-graph contract (T3), the real CFG/gumbel/schedule decoder (T4), backend+card+gate+tests (T5), integration smoke (T6). `transcript_required=False`, gpu-cuda-only, plain onnxruntime, torch-free, `("multi",)` — all encoded in Global Constraints + tasks. Consent `license` descriptor is stubbed on the card for Plan 3 to consume.

**Placeholder scan:** the PyTorch-captured fixtures (T2 ids, T4 codes) are the one thing produced during implementation (capture in `.spike/exportenv`) — flagged explicitly, not vague.

**Type consistency:** `build_sessions(...)→dict`; `build_input_ids(...)→(input_ids,audio_mask,cond_audio_start)`; `encode_reference(...)→(8,T)`; `generate_codes(...)→(8,num_target_tokens)`; `decode(...)→float32@24k`; backend `set_voice(audio,sr)` (no ref_text). Consistent across tasks.
