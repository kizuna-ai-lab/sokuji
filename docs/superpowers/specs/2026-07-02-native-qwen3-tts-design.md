# Native Qwen3-TTS Backend (Design)

**Date:** 2026-07-02
**Status:** Design (approved in brainstorming; pending spec review → implementation plan)
**Tracking:** issue #129 (native local inference); relates to the native TTS stage (`2026-06-29-native-tts-backend-design.md`), the voice-capability model (`2026-07-01-native-supertonic-tts-design.md`), and the Qwen3-ASR runtime research.

## Summary

Add **Qwen3-TTS** (0.6B **and** 1.7B, Base) as the fourth native TTS backend in the Electron Python sidecar — a **B-class autoregressive speech-LLM** sibling of `moss_onnx`: Qwen3 talker (28-layer, KV cache) + `code_predictor` (16 code groups) + 12 Hz codec tokenizer, running as **9 fp32 ONNX graphs on pure onnxruntime** in the shared cu128 venv (no torch, no new dependency). Voice cloning is **ICL mode with a required transcript**: reference audio + its text, entered by the user at import time.

The runtime is a **port of a complete reference implementation** — `examples/python_dll_call/run_pipeline.py` in `zukky/Qwen3-TTS-ONNX-DLL` (Apache-2.0, ~850 lines) implements the full AR loop (prefill → KV-cache decode → per-frame `code_predictor` ×15 sub-codes → EOS → codec decode); its Rust DLL does only preprocessing (tokenize / resample / mel), all replaceable with libraries already in the venv. This is a port, not a from-scratch runtime — the same risk class as Supertonic's worker port.

### Measured evidence (RTX 4070 SUPER, per-graph latency, ctx=200, from the in-session bench)

| graph | int8/CPU | fp32/CPU | fp32/CUDA | fp16/CUDA |
|---|---|---|---|---|
| `talker_decode` (28-layer AR) | 16.1 ms | 38.3 ms | **15.5 ms** | export broken* |
| `code_predictor` (per sub-code) | 2.1 ms | 6.4 ms | **1.07 ms** | 0.79 ms* |

\* naive fp16 conversion hit a KV-cache Concat runtime bug (talker) — fp16 is out of scope.

Decisions this bench locks in: **fp32 everywhere** (dynamic int8 regresses on GPU: 24.6 ms; the int8 codec's `ConvInteger` hangs GPU init; fp16 export is a separate project). Estimated composite throughput at 12 Hz output (talker + 15×code_predictor + codec): **GPU RTF ≈ 0.4** (a 5 s sentence generates in ~2 s, one-shot); **fp32 CPU RTF ≈ 1.7 — not real-time**, so the CPU tier exists as a fallback but GPU is the intended deployment. An int8 CPU variant is a possible later optimization (composite est. ≈ 0.6), not in scope.

## Goals

- One backend (`qwen3tts_onnx`), two catalog rows: `qwen3-tts-0.6b` (recommended) and `qwen3-tts-1.7b`.
- ICL voice cloning with a **required, user-entered transcript**, integrated into the voice-capability model as a `transcriptRequired` extension of the `clip` custom kind. MOSS behavior unchanged.
- GPU (CUDA) + CPU tiers via the existing resolver; per-graph device placement so 1.7B's hot path fits a 12 GB card.
- Model assets repackaged to our own HF repos for durability and per-row download/delete independence.
- 10 languages: zh, en, ja, ko, de, fr, ru, pt, es, it. Output 24 kHz (matches the engine's Int16@24k contract — no resample).

## Non-goals

- fp16 / int8 variants (bench above; int8-CPU deferred as a possible optimization).
- Intra-utterance streaming (`STREAMING=False` v1; the codec decode graph is one-shot. Chunked decode — including the repo's `tokenizer12hz_decode_1024` fixed-window variant — is a future extension).
- The CustomVoice / VoiceDesign variants and their 9 preset timbres (no ONNX export exists; Base has `spk_id: {}` — no built-in voices).
- vLLM / PyTorch deployment (isolated-venv HQ tier remains a separate future track).

## Background

- **Model:** Qwen3-TTS (QwenLM, Apache-2.0), released 2026-01. ONNX exports of the **Base** models exist in `zukky/Qwen3-TTS-ONNX-DLL` (fp32, both sizes, plus tokenizer vocab/merges/config) and `sivasub987/Qwen3-TTS-0.6B-ONNX-INT8` (int8, CPU-oriented).
- **Cloning:** official mechanism is ICL — reference audio + its transcript. An x-vector-only mode (speaker_encoder mels, no text) exists with reduced quality; per the brainstorming decision the product flow **requires the transcript** (no silent quality degradation), keeping x-vector-only as an internal fallback only if ICL prompt construction fails.
- **Graphs (0.6B fp32 sizes):** `talker_prefill` 1777 MB, `talker_decode` 1777 MB (duplicated weights — separate exports), `text_project` 1270 MB (text-embedding lookup), `code_predictor` 441 MB + `code_predictor_embed` 126 MB, `codec_embed` 13 MB, `speaker_encoder` 36 MB, `tokenizer12hz_encode` 193 MB, `tokenizer12hz_decode` 457 MB (+ a 457 MB `_1024` duplicate variant we drop). 1.7B total ≈ 14 GB as published.

## Architecture

```
renderer (NativeVoiceSection / voice stores: clip store gains transcript)
   │  set_voice { sampleRate, refText } + binary clip   /  tts_generate → result
   ▼
tts_engine.py         existing singleton; threads language via set_language
   ├─ accel.resolve_tts("qwen3-tts-0.6b" | "-1.7b")     existing resolver, gpu-cuda ≫ cpu
   ├─ catalog.tts_models()                               2 rows; transcript_required flag
   └─ tts_backends.Qwen3TtsOnnxBackend                   thin adapter over qwen3_tts runtime
        └─ sidecar/sokuji_sidecar/qwen3_tts/             vendored runtime (port of run_pipeline.py)
             template.py   role/codec/language/voice-prompt input builder + tokenizer (transformers)
             sampling.py   top-k/top-p sampling, EOS handling (pure functions)
             runtime.py    session mgmt + AR loop (prefill → decode w/ KV → code_predictor ×15) + codec IO
native_models.py       download specs (two repos, ignore per row)
```

### Backend contract (`Qwen3TtsOnnxBackend`)

`NAME="qwen3tts_onnx"`, `STREAMING=False`, `CLONES=True`, `sample_rate=24000`.

- `load(model_ref, device, compute_type)`: snapshot the repo; build ORT sessions with **per-graph device placement** (below); load tokenizer (via `transformers` `AutoTokenizer` from the bundled vocab/merges — already in the venv) and config. `BackendLoadError` on failure → resolver falls back.
- `set_language(lang)`: maps to the codec language id (`codec_language_id` in config; unknown → `nothink` unconditioned path).
- `set_voice(audio, sr, ref_text)`: resample to 24 k → `tokenizer12hz_encode` → reference codes; mel (numpy/librosa — librosa is already in the venv via funasr) → `speaker_encoder` → spk_emb; tokenize `ref_text` → ICL prompt bundle stored for subsequent generates. `ref_text` empty → x-vector-only bundle (internal fallback; the UI never produces this for this model).
- `generate(text, speed)` → `(float32 @ 24 kHz, ms)`: build talker inputs (role tokens + codec prefill [language id | nothink, BOS] + voice prompt + text) → prefill → decode loop (sample main code, `code_predictor` ×15 sub-codes per frame, KV threading, stop on EOS / max frames) → `tokenizer12hz_decode` once. `speed` is accepted and ignored v1 (AR model; no duration knob).
- No `set_builtin_voice`/`set_speaker` (no presets); `list_builtin_voices()` → `[]`. With no voice set, generation is **unconditioned** (language id + nothink) — usable but timbre is not stable; the UI copy nudges users to add a custom voice.

### Per-graph device placement & the prefill spike

Cold graphs run on **CPU always**: `speaker_encoder` + `tokenizer12hz_encode` (only at set_voice), `text_project` (embedding lookup, once per utterance). Hot graphs follow the resolved tier: `talker_decode`, `code_predictor(+embed)`, `codec_embed`, `tokenizer12hz_decode`.

**Spike (first plan task):** the decode graph's dims are symbolic — verify whether `talker_decode` with **zero-length past** performs full prefill. If yes, **drop `talker_prefill` from the repack entirely**: downloads become 0.6B ≈ 4.3 GB / 1.7B ≈ 9.2 GB, and 1.7B's hot set (≈ 4.4 + 1.4 + ~1 GB) fits a 12 GB card. If no, keep the prefill graph: 0.6B stays fully GPU-capable; on 12 GB cards 1.7B's gpu-cuda tier won't fit (resolver falls back to the slow CPU tier — documented limitation until fp16).

### Model assets — repack to our own HF repos

zukky ships both sizes in one repo; our download/status/delete machinery is per-repo, so sharing one repo breaks row independence (deleting 0.6B would delete 1.7B). Repack (a scripted, user-confirmed step in the plan) into **two repos** under the user's HF account (e.g. `jiangzhuo9357/qwen3-tts-0.6b-onnx`, `…-1.7b-onnx`): the needed `.onnx` graphs (minus `tokenizer12hz_decode_1024`, minus `talker_prefill` if the spike succeeds), plus `vocab.json`/`merges.txt`/`tokenizer_config.json`/`config.json`, plus attribution/license files (Apache-2.0). Upload via the `huggingface_hub` API (project convention).

### Capability model extension: `transcriptRequired`

- `TtsModel` gains `transcript_required: bool = False`; `voice_capability()` emits `"transcriptRequired": true` alongside `custom:'clip'` for these rows. Wire: `NativeModelInfo.voice` gains `transcriptRequired?: boolean`.
- **Storage:** `nativeVoiceStorage` `StoredNativeVoice` gains `transcript?: string` (existing MOSS voices simply lack it).
- **Store/UI:** the clip `NativeVoiceStore` accepts a transcript on `onImport`/`onRecord`; for a `transcriptRequired` model the `VoiceLibrarySection` capture flow shows a **mandatory transcript field** (record and upload paths both), and **"My Voices" lists only voices that have a transcript**. MOSS (`transcriptRequired` absent) is pixel-identical to today.
- **Apply/protocol:** clip `resolveApply` payload gains `transcript?`; `NativeTtsClient.setReferenceVoice(audio, sampleRate, refText?)` adds `refText` to the `set_voice` control message; sidecar `_h_set_voice` clip branch passes it to `backend.set_voice(audio, sr, ref_text)` (backends without the param keep their 2-arg signature — the engine adapts via a keyword-optional call).

### Catalog rows

| id | name | size (post-repack, prefill-spike-dependent) | notes |
|---|---|---|---|
| `qwen3-tts-0.6b` | Qwen3-TTS (0.6B) | ≈ 4.3–6.1 GB | `recommended=True`, sort after Supertonic |
| `qwen3-tts-1.7b` | Qwen3-TTS (1.7B) | ≈ 9.2–14 GB | higher quality; 12 GB-card GPU fit depends on the spike |

Both: `languages=(zh,en,ja,ko,de,fr,ru,pt,es,it)`, `clones=True`, `streaming=False`, `sample_rate=24000`, `transcript_required=True`, deployments `(qwen3tts_onnx, gpu-cuda, fp32)` + `(qwen3tts_onnx, cpu, fp32)`; `_installed()` maps `qwen3tts_onnx → onnxruntime`.

## Testing

- **Runtime (pure units, no ORT):** template building (role/codec/language/ICL prompt token layout vs. hand-derived fixtures), sampling (top-k/top-p determinism with seeded RNG), EOS handling.
- **AR loop with fake sessions** (MOSS/Supertonic test pattern): prefill→decode KV threading, 16-code frame assembly, stop conditions, codec-decode call shape.
- **Backend:** `set_voice` ICL bundle construction (fake encoder sessions); ref_text-required vs x-vector fallback; unconditioned path; `set_language` id mapping.
- **Catalog/accel/voices:** rows + `voice_capability` `{builtin:none, custom:clip, transcriptRequired:true}`; resolver tiers; `list_tts_voices` → `[]`; download specs per repo.
- **Renderer:** protocol `refText`; clip store transcript (add/list-filter/resolveApply); `NativeVoiceSection` mandatory-transcript capture for `transcriptRequired` (and unchanged MOSS characterization); `LocalNativeClient` apply passes transcript.
- **Manual (4070):** real 0.6B GPU generate + ICL clone round-trip; 1.7B fit/fallback behavior.

## Global constraints

- TypeScript strict; English-only comments/docs. Conventional commits; commits stay LOCAL (no push/PR without consent). Tests (vitest / pytest) are the gate; `tsc` is not.
- No new sidecar dependency (onnxruntime + transformers + librosa already in the shared venv).
- **No behavior change** for MOSS / Supertonic / VITS / Piper voice flows.
- fp32 only; per-graph placement as specified; the repack step requires explicit user confirmation before any HF upload (publish consent rule).
