# Native Python Sidecar — Phase 2c (faster-whisper ASR + opus-mt translation) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add two more native backends, each selectable by model id, reusing the existing WS protocol and clients with zero new transport: a **faster-whisper** ASR recognizer (whisper-* family) and a **torch-free onnxruntime opus-mt** translation path.

**Architecture:** The ASR stage keeps its shared silero-VAD windowing/segmentation; only the *recognizer* becomes pluggable (sherpa-onnx sense-voice **or** faster-whisper, chosen by `asr_init.model`). The translation stage gains a second engine path chosen by `translate_init.model` (LLM via transformers **or** opus-mt via onnxruntime greedy seq2seq). No protocol, client, or Electron changes.

**Tech Stack:** `faster-whisper` (CTranslate2) + `tokenizers` + `onnxruntime` + `numpy`, all lazy-imported inside `init()`.

## Global Constraints

- Reuse Phase 2b ASR protocol (`asr_init`/binary/`asr_flush`, pushed `speech_start`/`result`) and Phase 2a translation protocol (`translate_init`/`translate`/`translation`) **unchanged**.
- Backend selection by model id: ASR `model` containing `whisper` → faster-whisper, else sherpa sense-voice. Translation `model` containing `opus-mt` → onnxruntime opus-mt, else LLM.
- Heavy deps lazy-imported in `init()`; fake-engine/unit tests run without them; real paths are model-gated (`SOKUJI_RUN_FW_MODEL`, `SOKUJI_RUN_OPUS_MODEL`).
- opus-mt path is **torch-free** (onnxruntime + `tokenizers` only), using Xenova-style split exports (`encoder_model_quantized.onnx` + `decoder_model_quantized.onnx` + `decoder_with_past_model_quantized.onnx`) via `huggingface_hub`.
- Validate each against a real model before committing (the model-run loop caught 4 bugs in Phase 1/2b).

## Task 1: Pluggable ASR recognizer + faster-whisper

**Files:** modify `sidecar/sokuji_sidecar/asr_engine.py`; modify `sidecar/tests/test_asr_engine.py`.

**Design:** factor recognition into `self._recognize(samples16k_float32) -> str`, built in `init()` by model id. sherpa path unchanged (sense-voice). faster-whisper path: `WhisperModel(size, device="cpu", compute_type="int8")`, `transcribe(samples, language=…, beam_size=1, vad_filter=False)`, join segment texts. Size from model id (`whisper-tiny`→`tiny`, …). VAD (silero) still shared for both.

- [ ] Refactor `_drain` to call `self._recognize(seg.samples)` instead of inline sherpa.
- [ ] `init()`: if `model` contains `whisper` → build faster-whisper recognizer (no sherpa model download; VAD still loaded); else download sense-voice + build sherpa recognizer.
- [ ] Fake unit tests stay green (handlers unchanged). Add model-gated `test_real_faster_whisper` feeding the sense-voice `en.wav` (upsampled to the engine's rate) with `model="whisper-tiny"`, asserting a plausible transcript.
- [ ] Validate: `SOKUJI_RUN_FW_MODEL=1 pytest` transcribes correctly. Commit.

## Task 2: opus-mt onnxruntime translation (torch-free)

**Files:** create `sidecar/sokuji_sidecar/opus_mt.py`; modify `translate_engine.py` (dispatch by model id); modify `tests/test_translate_engine.py`.

**Design:** `OpusMtTranslator(repo)` loads encoder + decoder + decoder_with_past ONNX (`huggingface_hub.snapshot_download`, Xenova-style) + `tokenizers.Tokenizer.from_file(tokenizer.json)`. Greedy decode:
1. `enc = encoder.run(input_ids, attention_mask)`
2. first step: `decoder.run(input_ids=[decoder_start], encoder_attention_mask, encoder_hidden_states)` → logits + `present.*`
3. argmax last logit; loop `decoder_with_past.run(input_ids=[tok], encoder_attention_mask, past=present.decoder.*, present.encoder.* constant)` until eos / max_len.
4. Map `present.N.X.Y` → `past_key_values.N.X.Y` by name. `decoder_start_token_id`/`eos_token_id` from `config.json`/`generation_config.json`. Decode ids via tokenizer (skip special).

`TranslateEngine.init`/`translate` dispatch: `model` containing `opus-mt` → `OpusMtTranslator`, else the existing LLM path.

- [ ] Implement `opus_mt.py`; wire dispatch in `translate_engine.py`.
- [ ] Fake unit tests stay green. Add model-gated `test_real_opus_mt` (`Xenova/opus-mt-zh-en`, zh→en) asserting non-empty English.
- [ ] Validate against the real model (inspect actual ONNX I/O names to wire generically); fix any name mismatches found. Commit.

## Self-Review
Both reuse existing protocol/clients/Electron — no transport change. Selection is purely by model id. Real-model validation gates each commit. faster-whisper and opus-mt deps are lazy + model-gated, so the always-on fake suite is unaffected.
