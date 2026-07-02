# Native Qwen3-TTS Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Qwen3-TTS (0.6B + 1.7B Base) as the fourth native TTS backend — an autoregressive speech-LLM on pure onnxruntime with ICL voice cloning (required transcript), integrated into the voice-capability model.

**Architecture:** A vendored `qwen3_tts/` runtime (faithful port of the reference `run_pipeline.py` from `zukky/Qwen3-TTS-ONNX-DLL`, Apache-2.0: template builder → prefill → KV decode loop with `code_predictor` ×15 sub-codes/frame → 12 Hz codec decode) wrapped by a `Qwen3TtsOnnxBackend` on the existing seam. Cloning extends the `clip` custom kind with `transcriptRequired` (storage transcript field → mandatory UI input → `refText` on the wire → ICL prompt in the backend).

**Tech Stack:** Python onnxruntime/numpy/librosa/transformers (all already in the shared cu128 venv); React/TypeScript; pytest + vitest.

## Global Constraints

- Correctness gate: sidecar `cd sidecar && .venv/bin/python -m pytest -q`; renderer `npx vitest run <paths>`. `tsc` is NOT a gate. Conventional commits; commits stay LOCAL (no push).
- No new dependency. fp32 only. English-only comments.
- **No behavior change** for MOSS / Supertonic / VITS / Piper voice flows (their `voice_capability` dicts must remain byte-identical — `transcriptRequired` is emitted ONLY for rows with `transcript_required=True`).
- Backend `NAME="qwen3tts_onnx"`, `STREAMING=False`, `CLONES=True`, `sample_rate=24000`. Languages `("zh","en","ja","ko","de","fr","ru","pt","es","it")`.
- Repos (env-overridable): `SOKUJI_QWEN3_TTS_06B_REPO` default `jiangzhuo9357/qwen3-tts-0.6b-onnx`; `SOKUJI_QWEN3_TTS_17B_REPO` default `jiangzhuo9357/qwen3-tts-1.7b-onnx`. **The HF upload (Task 2) requires explicit user confirmation before uploading — STOP and ask.**
- Prompt templates (from the reference Rust `text/prompt.rs`, verbatim): assistant = `<|im_start|>assistant\n{text}<|im_end|>\n<|im_start|>assistant\n`; ref = `<|im_start|>assistant\n{text}<|im_end|>\n`.
- Sampling defaults (reference `main()`): `do_sample=True, top_k=50, top_p=1.0, temperature=0.9, repetition_penalty=1.05`, subtalker identical; `suppress_tokens = [vocab_size-1024 .. vocab_size) minus {eos}`; `eos = talker.codec_eos_token_id`.
- Reference sources live at `.superpowers/qwen3-ref/` (gitignored). Re-fetch if missing:
  ```bash
  mkdir -p .superpowers/qwen3-ref && cd .superpowers/qwen3-ref
  curl -sL https://huggingface.co/zukky/Qwen3-TTS-ONNX-DLL/raw/main/examples/python_dll_call/run_pipeline.py -o run_pipeline.py
  curl -sL https://huggingface.co/zukky/Qwen3-TTS-ONNX-DLL/raw/main/models/Qwen3-TTS-12Hz-0.6B-Base/config.json -o config-0.6b.json
  curl -sL https://raw.githubusercontent.com/SuzukiDaishi/Qwen3-TTS-ONNX-Rust/main/src/text/prompt.rs -o text_prompt.rs
  curl -sL https://raw.githubusercontent.com/SuzukiDaishi/Qwen3-TTS-ONNX-Rust/main/src/audio/mel.rs -o audio_mel.rs
  ```

## File structure

**Sidecar:** NEW `sidecar/sokuji_sidecar/qwen3_tts/{__init__.py,config.py,template.py,sampling.py,mel.py,codec.py,runtime.py}`; MODIFY `tts_backends.py` (backend), `catalog.py` (field + helper + 2 rows), `accel.py` (`_installed`), `native_models.py` (2 repos), `tts_engine.py` (refText threading). NEW `scripts/repack-qwen3-tts-onnx.py`. Test fixture: `sidecar/tests/fixtures/qwen3_tts_config.json` (the 0.6B config, ~5 KB, committed).
**Renderer:** MODIFY `nativeProtocol.ts`, `NativeTtsClient.ts`, `nativeCatalog.ts` (capability type), `nativeVoiceStorage.ts` (transcript), `nativeVoiceStores.ts` (clip store transcript), `VoiceLibrarySection.tsx` (mandatory transcript input), `NativeVoiceSection.tsx` (filter + passthrough), `services/clients/LocalNativeClient.ts` (apply).

---

## Phase 0 — Spike & assets

### Task 1: Spike — decode graph as prefill (zero-length past)

**Files:** Create `.superpowers/qwen3-ref/spike_zero_past.py` (scratch, NOT committed). Deliverable = a recorded verdict, no production code.
**Interfaces — Produces:** a ledger-recorded verdict `PREFILL_DROPPABLE: yes|no` that decides Task 2's file list and is baked into `runtime.py` (which supports both modes regardless).

- [ ] **Step 1: Fetch the two 0.6B talker graphs** (≈3.6 GB, HF cache):
```bash
cd sidecar && .venv/bin/python - <<'PY'
from huggingface_hub import hf_hub_download
for f in ["onnx_kv_06b/talker_prefill.onnx", "onnx_kv_06b/talker_decode.onnx"]:
    print(hf_hub_download("zukky/Qwen3-TTS-ONNX-DLL", f))
PY
```
- [ ] **Step 2: Write and run the spike script**
```python
# .superpowers/qwen3-ref/spike_zero_past.py
import numpy as np, onnxruntime as ort
from huggingface_hub import hf_hub_download
pre = ort.InferenceSession(hf_hub_download("zukky/Qwen3-TTS-ONNX-DLL", "onnx_kv_06b/talker_prefill.onnx"),
                           providers=["CPUExecutionProvider"])
dec = ort.InferenceSession(hf_hub_download("zukky/Qwen3-TTS-ONNX-DLL", "onnx_kv_06b/talker_decode.onnx"),
                           providers=["CPUExecutionProvider"])
rng = np.random.default_rng(0)
T = 8
emb = rng.standard_normal((1, T, 1024)).astype(np.float32)
mask = np.ones((1, T), np.int64)
ref = pre.run(None, {"inputs_embeds": emb, "attention_mask": mask})
feed = {"inputs_embeds": emb, "attention_mask": mask}
for i in dec.get_inputs():
    if i.name.startswith("past_"):
        feed[i.name] = np.zeros((1, 8, 0, 128), np.float32)
try:
    out = dec.run(None, feed)
    ok = np.allclose(ref[0], out[0], atol=1e-3) and np.allclose(ref[1], out[1], atol=1e-3)
    print("PREFILL_DROPPABLE:", "yes" if ok else "no (runs but logits diverge)")
except Exception as e:
    print("PREFILL_DROPPABLE: no —", str(e)[:200])
```
Run: `cd sidecar && .venv/bin/python ../.superpowers/qwen3-ref/spike_zero_past.py`
- [ ] **Step 3: Record the verdict** in the report + ledger (`PREFILL_DROPPABLE: yes|no`). No commit (scratch only).

### Task 2: Repack script + HF upload (USER CONSENT GATE)

**Files:** Create `scripts/repack-qwen3-tts-onnx.py`; Test: manual run (network/publish step — no pytest).
**Interfaces — Consumes:** Task 1 verdict. **Produces:** two HF model repos (layout: `onnx/*.onnx` + `config.json`/`vocab.json`/`merges.txt`/`tokenizer_config.json` at root + README) and their total byte sizes for Task 8.

- [ ] **Step 1: Write the script**
```python
#!/usr/bin/env python3
"""Repack zukky/Qwen3-TTS-ONNX-DLL into two per-size Sokuji repos.
Downloads the needed subset, stages a flat layout, prints total bytes,
and (only with --upload) pushes via huggingface_hub. Apache-2.0 attribution
is written into the staged README."""
import argparse, os, shutil
from huggingface_hub import HfApi, hf_hub_download

SRC = "zukky/Qwen3-TTS-ONNX-DLL"
GRAPHS = ["talker_decode.onnx", "code_predictor.onnx", "code_predictor_embed.onnx",
          "codec_embed.onnx", "text_project.onnx", "speaker_encoder.onnx",
          "tokenizer12hz_encode.onnx", "tokenizer12hz_decode.onnx"]
TOK = ["config.json", "vocab.json", "merges.txt", "tokenizer_config.json"]
SIZES = {"0.6b": ("onnx_kv_06b", "Qwen3-TTS-12Hz-0.6B-Base", "jiangzhuo9357/qwen3-tts-0.6b-onnx"),
         "1.7b": ("onnx_kv",     "Qwen3-TTS-12Hz-1.7B-Base", "jiangzhuo9357/qwen3-tts-1.7b-onnx")}
README = """---\nlicense: apache-2.0\n---\n# Qwen3-TTS {size} Base — ONNX (fp32) for Sokuji\n
Repacked from [zukky/Qwen3-TTS-ONNX-DLL](https://huggingface.co/zukky/Qwen3-TTS-ONNX-DLL)
(itself exported from [QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)). Apache-2.0.\n"""

def stage(size, keep_prefill, out_root):
    subdir, model_dir, dst_repo = SIZES[size]
    graphs = GRAPHS + (["talker_prefill.onnx"] if keep_prefill else [])
    root = os.path.join(out_root, size); os.makedirs(os.path.join(root, "onnx"), exist_ok=True)
    total = 0
    for g in graphs:
        p = hf_hub_download(SRC, f"{subdir}/{g}")
        q = os.path.join(root, "onnx", g); shutil.copyfile(p, q); total += os.path.getsize(q)
    for t in TOK:
        p = hf_hub_download(SRC, f"models/{model_dir}/{t}")
        q = os.path.join(root, t); shutil.copyfile(p, q); total += os.path.getsize(q)
    with open(os.path.join(root, "README.md"), "w") as fh: fh.write(README.format(size=size))
    print(f"{size}: staged {total:,} bytes → {root}  (dst {dst_repo})")
    return root, dst_repo, total

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", nargs="+", default=["0.6b", "1.7b"], choices=list(SIZES))
    ap.add_argument("--keep-prefill", action="store_true", help="spike said PREFILL_DROPPABLE: no")
    ap.add_argument("--out", default=os.path.expanduser("~/qwen3-tts-repack"))
    ap.add_argument("--upload", action="store_true", help="actually push to HF (requires consent)")
    a = ap.parse_args()
    api = HfApi()
    for s in a.sizes:
        root, dst, total = stage(s, a.keep_prefill, a.out)
        if a.upload:
            api.create_repo(dst, repo_type="model", exist_ok=True)
            api.upload_folder(folder_path=root, repo_id=dst, repo_type="model")
            print(f"uploaded {dst} ({total:,} bytes)")
```
- [ ] **Step 2: Stage locally (no upload)**: `cd sidecar && .venv/bin/python ../scripts/repack-qwen3-tts-onnx.py` (add `--keep-prefill` iff Task 1 said `no`). Verify the staged tree + note the printed byte totals.
- [ ] **Step 3: STOP — ask the user for upload consent** (repo names + sizes). Only after explicit yes: rerun with `--upload`. Record the final per-repo totals in the ledger for Task 8.
- [ ] **Step 4: Commit the script**: `git add scripts/repack-qwen3-tts-onnx.py && git commit -m "feat(scripts): Qwen3-TTS ONNX repack/upload script"`

---

## Phase A — Sidecar runtime & backend

### Task 3: `qwen3_tts` config + prompt templates + language map

**Files:** Create `sidecar/sokuji_sidecar/qwen3_tts/__init__.py` (empty), `config.py`, `template.py` (templates/lang part); Copy `.superpowers/qwen3-ref/config-0.6b.json` → `sidecar/tests/fixtures/qwen3_tts_config.json` (committed); Test `sidecar/tests/test_qwen3_config.py`.
**Interfaces — Produces:** `config.load_model_config(model_dir) -> SimpleNamespace` (port of the reference `load_model_config`, lines 642–676 of `run_pipeline.py`: lower-cased `codec_language_id`/`spk_id`/`spk_is_dialect`, `speaker_encoder` mel cfg with defaults n_fft 1024/hop 256/win 1024/mels 128/fmin 0/fmax 12000/sr 24000, top-level `tts_{bos,eos,pad}_token_id`); `template.build_assistant_text(text)`, `template.build_ref_text(text)` (the two verbatim strings above); `template.language_name(short) -> str|None` mapping `{"zh":"chinese","en":"english","ja":"japanese","ko":"korean","de":"german","fr":"french","ru":"russian","pt":"portuguese","es":"spanish","it":"italian"}` (unknown/empty → `None` = auto/nothink).

- [ ] **Step 1: Failing tests** (note: the fixture sits directly in `fixtures/`, so `load_model_config` must accept a config *file path* as well as a directory — implement: if the path is a file, read it, else read `<dir>/config.json`)
```python
# sidecar/tests/test_qwen3_config.py
import os
from sokuji_sidecar.qwen3_tts import config, template
FIX = os.path.join(os.path.dirname(__file__), "fixtures", "qwen3_tts_config.json")

def test_load_model_config_parses_fixture():
    cfg = config.load_model_config(FIX)
    assert cfg.tts_bos_token_id == 151672 and cfg.tts_eos_token_id == 151673 and cfg.tts_pad_token_id == 151671
    assert cfg.talker.codec_bos_id == 2149 and cfg.talker.codec_eos_token_id == 2150
    assert cfg.talker.codec_language_id["english"] == 2050
    assert cfg.talker.num_code_groups == 16 and cfg.talker.vocab_size == 3072
    assert cfg.speaker_encoder.n_fft == 1024 and cfg.speaker_encoder.num_mels == 128

def test_prompt_templates_verbatim():
    assert template.build_assistant_text("Hi") == "<|im_start|>assistant\nHi<|im_end|>\n<|im_start|>assistant\n"
    assert template.build_ref_text("Ref") == "<|im_start|>assistant\nRef<|im_end|>\n"

def test_language_map():
    assert template.language_name("ja") == "japanese"
    assert template.language_name("ja-JP") == "japanese"      # base-tag normalization
    assert template.language_name("xx") is None and template.language_name("") is None
```
- [ ] **Step 2: Run → FAIL** — `cd sidecar && .venv/bin/python -m pytest tests/test_qwen3_config.py -q` (ModuleNotFoundError).
- [ ] **Step 3: Implement** — `config.py`: faithful port of `load_model_config` (reference lines 636–676; add the file-or-dir path handling; also parse `speaker_encoder_config.hop_size/win_size` names as in the reference). `template.py`: the two format strings + `language_name` (strip region tag via `split("-")[0].lower()`). Copy the fixture file.
- [ ] **Step 4: Run → PASS** (3 tests).
- [ ] **Step 5: Commit** — `git add sidecar/sokuji_sidecar/qwen3_tts sidecar/tests/test_qwen3_config.py sidecar/tests/fixtures/qwen3_tts_config.json && git commit -m "feat(sidecar): qwen3_tts config + prompt templates"`

### Task 4: `qwen3_tts/sampling.py`

**Files:** Create `sidecar/sokuji_sidecar/qwen3_tts/sampling.py`; Test `sidecar/tests/test_qwen3_sampling.py`.
**Interfaces — Produces (verbatim ports of reference lines 225–303):** `softmax(logits)`, `apply_suppress_tokens(logits, suppress)`, `apply_repetition_penalty(logits, token_hist, penalty)`, `top_k_top_p_filter(logits, top_k, top_p)`, `sample_next_token(logits, rng, do_sample, top_k, top_p, temperature) -> np.int64[batch]`.

- [ ] **Step 1: Failing tests**
```python
# sidecar/tests/test_qwen3_sampling.py
import numpy as np
from sokuji_sidecar.qwen3_tts import sampling as S

def test_greedy_argmax_when_not_sampling():
    logits = np.array([[0.1, 2.0, -1.0]], np.float32)
    out = S.sample_next_token(logits, np.random.default_rng(0), do_sample=False, top_k=50, top_p=1.0, temperature=0.9)
    assert out.tolist() == [1]

def test_suppress_tokens_masks_ids():
    logits = np.zeros((1, 5), np.float32)
    out = S.apply_suppress_tokens(logits, [3, 4])
    assert out[0, 3] < -1e8 and out[0, 4] < -1e8 and out[0, 0] == 0

def test_repetition_penalty_divides_positive_and_multiplies_negative():
    logits = np.array([[2.0, -2.0]], np.float32)
    hist = np.array([[0, 1]], np.int64)
    out = S.apply_repetition_penalty(logits, hist, 2.0)
    assert np.isclose(out[0, 0], 1.0) and np.isclose(out[0, 1], -4.0)

def test_top_k_keeps_only_k():
    logits = np.array([[1.0, 2.0, 3.0, 4.0]], np.float32)
    out = S.top_k_top_p_filter(logits, top_k=2, top_p=1.0)
    assert (out[0, :2] < -1e8).all() and out[0, 2] == 3.0 and out[0, 3] == 4.0

def test_sampling_deterministic_with_seeded_rng():
    logits = np.log(np.array([[0.05, 0.9, 0.05]], np.float32))
    a = S.sample_next_token(logits, np.random.default_rng(7), True, 50, 1.0, 1.0)
    b = S.sample_next_token(logits, np.random.default_rng(7), True, 50, 1.0, 1.0)
    assert a.tolist() == b.tolist()
```
- [ ] **Step 2: Run → FAIL**; **Step 3: Implement** (verbatim port — read `.superpowers/qwen3-ref/run_pipeline.py:225-303`, rename `_softmax`→`softmax`); **Step 4: Run → PASS** (5); **Step 5: Commit** `feat(sidecar): qwen3_tts sampling primitives`.

### Task 5: `qwen3_tts/mel.py` (speaker-encoder log-mel)

**Files:** Create `sidecar/sokuji_sidecar/qwen3_tts/mel.py`; Test `sidecar/tests/test_qwen3_mel.py`.
**Interfaces — Produces:** `log_mel(samples: np.float32[n], cfg) -> np.float32[n_mels, frames]` — numpy port of the Rust `mel_spectrogram` (`.superpowers/qwen3-ref/audio_mel.rs`): reflect-pad by `(n_fft - hop)//2` (=384), Hann(win) center-padded to n_fft, rfft magnitude `sqrt(re²+im²+1e-9)`, **Slaney** mel filterbank with Slaney norm (`librosa.filters.mel(sr=…, n_fft=…, n_mels=…, fmin=…, fmax=…, htk=False, norm="slaney")`), then `np.log(np.maximum(mel, 1e-5))`. `cfg` is the `speaker_encoder` namespace from Task 3.

- [ ] **Step 1: Failing tests**
```python
# sidecar/tests/test_qwen3_mel.py
import numpy as np, os
from sokuji_sidecar.qwen3_tts import config, mel
FIX = os.path.join(os.path.dirname(__file__), "fixtures", "qwen3_tts_config.json")

def _cfg():
    return config.load_model_config(FIX).speaker_encoder

def test_shape_and_frame_count():
    cfg = _cfg()
    n = 24000  # 1s
    m = mel.log_mel(np.zeros(n, np.float32), cfg)
    pad = (cfg.n_fft - cfg.hop_size) // 2
    frames = 1 + (n + 2 * pad - cfg.n_fft) // cfg.hop_size
    assert m.shape == (cfg.num_mels, frames)

def test_silence_hits_log_floor():
    m = mel.log_mel(np.zeros(4096, np.float32), _cfg())
    assert np.allclose(m, np.log(1e-5), atol=1e-3)

def test_tone_energy_lands_in_expected_band():
    cfg = _cfg()
    t = np.arange(24000) / 24000.0
    tone = np.sin(2 * np.pi * 1000 * t).astype(np.float32)   # 1 kHz
    m = mel.log_mel(tone, cfg)
    band = int(np.argmax(m.mean(axis=1)))
    assert 20 <= band <= 60   # 1 kHz sits in the lower-middle Slaney bands (128 mels, fmax 12k)
```
- [ ] **Step 2: Run → FAIL**; **Step 3: Implement** per the Rust source (frame loop can be vectorized with `np.lib.stride_tricks.sliding_window_view`; keep float64 accumulation for the FFT/magnitude like the Rust); **Step 4: Run → PASS** (3); **Step 5: Commit** `feat(sidecar): qwen3_tts speaker log-mel (Rust-parity)`.

### Task 6: `qwen3_tts/runtime.py` — sessions, placement, AR loop

**Files:** Create `sidecar/sokuji_sidecar/qwen3_tts/runtime.py`; Test `sidecar/tests/test_qwen3_runtime.py`.
**Interfaces — Consumes:** `sampling` (Task 4). **Produces:**
- `build_sessions(onnx_dir, device, threads) -> dict[str, session]` — keys `talker_decode, code_predictor, code_predictor_embed, codec_embed, text_project, speaker_encoder, tokenizer12hz_encode, tokenizer12hz_decode` (+`talker_prefill` iff the file exists). COLD graphs (`speaker_encoder`, `tokenizer12hz_encode`, `text_project`) always `["CPUExecutionProvider"]`; the rest get CUDA+CPU when `device=="cuda"` else CPU (each CUDA session creation wrapped in try/except → CPU fallback, like the reference `_make_session`).
- `Embeddings` class over the three embed sessions (`text_project(ids)`, `codec_embed(ids)`, `code_predictor_embed(ids, step)` — reference lines 306–331).
- `generate_codes(sessions, cfg_talker, inputs_embeds, attention_mask, trailing_text_hidden, tts_pad_embed, *, max_new_tokens, sampling_params: dict, eos_token_id, suppress_tokens, rng) -> (codes_list, hidden_list)` — faithful port of `OnnxTalker.generate_codes` (reference lines 370–532) with ONE addition: **when `talker_prefill` is absent, the initial pass runs `talker_decode` with zero-length past arrays** (`np.zeros((batch, kv_heads, 0, head_dim))` per past input, dims read from the decode graph's input shapes) — and the no-KV re-prefill branch (reference lines 493–499) is unreachable in that mode (decode always returns presents).

- [ ] **Step 1: Failing tests** (fake sessions — the MOSS/Supertonic pattern; this test pins KV threading, 16-group assembly, EOS truncation, suppress):
```python
# sidecar/tests/test_qwen3_runtime.py
import numpy as np
from types import SimpleNamespace
from sokuji_sidecar.qwen3_tts import runtime

H, GROUPS, VOCAB, EOS = 8, 4, 32, 30

class _FakeIO:
    def __init__(self, name): self.name = name

class _FakeDecode:
    """Emits fixed logits; asserts past grows by 1 each call. First-code script: 5, 5, EOS."""
    def __init__(self): self.calls = 0
    def get_inputs(self):
        return [_FakeIO("inputs_embeds"), _FakeIO("attention_mask"),
                _FakeIO("past_key_0"), _FakeIO("past_value_0")]
    def get_outputs(self):
        return [_FakeIO("logits"), _FakeIO("last_hidden"), _FakeIO("present_key_0"), _FakeIO("present_value_0")]
    def run(self, names, feeds):
        t = feeds["inputs_embeds"].shape[1]
        past_len = feeds["past_key_0"].shape[2]
        if self.calls == 0:
            assert past_len == 0          # zero-past initial pass
        logits = np.full((1, t, VOCAB), -5.0, np.float32)
        script = [5, 5, EOS]
        logits[0, -1, script[min(self.calls, 2)]] = 5.0
        self.calls += 1
        present = np.zeros((1, 2, past_len + t, 4), np.float32)
        return [logits, np.zeros((1, 1, H), np.float32), present, present]

class _FakeCodePred:
    def get_outputs(self): return [_FakeIO("logits")]
    def run(self, names, feeds):
        out = np.full((1, VOCAB), -5.0, np.float32); out[0, 7] = 5.0
        return [out]

class _FakeEmbed:
    def __init__(self, outname): self.outname = outname
    def get_outputs(self): return [_FakeIO(self.outname)]
    def run(self, names, feeds):
        ids = feeds["input_ids"]
        return [np.zeros((ids.shape[0], ids.shape[1], H), np.float32)]

def _sessions():
    return {"talker_decode": _FakeDecode(), "code_predictor": _FakeCodePred(),
            "codec_embed": _FakeEmbed("e"), "code_predictor_embed": _FakeEmbed("e")}

def test_ar_loop_zero_past_eos_and_groups():
    cfg = SimpleNamespace(num_code_groups=GROUPS)
    codes, hidden = runtime.generate_codes(
        _sessions(), cfg,
        inputs_embeds=np.zeros((1, 3, H), np.float32),
        attention_mask=np.ones((1, 3), np.int64),
        trailing_text_hidden=np.zeros((1, 2, H), np.float32),
        tts_pad_embed=np.zeros((1, 1, H), np.float32),
        max_new_tokens=10, sampling_params=dict(
            do_sample=False, top_k=50, top_p=1.0, temperature=1.0, repetition_penalty=1.0,
            subtalker_dosample=False, subtalker_top_k=50, subtalker_top_p=1.0, subtalker_temperature=1.0),
        eos_token_id=EOS, suppress_tokens=None, rng=np.random.default_rng(0))
    assert len(codes) == 1
    assert codes[0].shape == (2, GROUPS)            # EOS at step 3 → 2 effective frames
    assert (codes[0][:, 0] == 5).all()              # scripted first codes
    assert (codes[0][:, 1:] == 7).all()             # 3 sub-codes per frame from code_predictor
    assert hidden[0].shape == (2, H)
```
- [ ] **Step 2: Run → FAIL**; **Step 3: Implement** — port `OrtSession`-thin wrapper (name lists), `Embeddings`, `generate_codes` faithfully from the reference (read it), plus `build_sessions` with the COLD/HOT placement and the zero-past initial pass (past shape `(batch, dim1, 0, dim3)` read from the decode graph's declared input shape, symbolic dims defaulting to `(1, 8, 0, 128)`); **Step 4: Run → PASS**; **Step 5: Commit** `feat(sidecar): qwen3_tts AR runtime (zero-past prefill capable)`.

### Task 7: `qwen3_tts/codec.py` + `template.py` talker-input builder

**Files:** Create `sidecar/sokuji_sidecar/qwen3_tts/codec.py`; Extend `template.py`; Test `sidecar/tests/test_qwen3_codec_template.py`.
**Interfaces — Consumes:** `runtime.Embeddings`-shaped object (only `text_project/codec_embed/code_predictor_embed` callables). **Produces:**
- `codec.Codec12Hz(sessions, num_quantizers=16, sample_rate=24000)` with `encode(wav_24k: np.float32[n]) -> np.int64[frames, 16]` and `decode(codes: np.int64[frames,16]) -> np.float32[samples]` — port of `Tokenizer12HzOnnx` (reference lines 535–633) for batch=1, resampling handled by the caller (librosa), including the decode target-length logic (`(codes[...,0] > 0).sum() * 1920`, min with reported `lengths`).
- `template.build_talker_inputs(cfg, emb, input_ids, ref_ids, voice_clone_prompt, language_name) -> (padded, attention_mask, trailing_text_hidden, tts_pad_embed)` — faithful batch=1 port of `build_talker_inputs_np` (reference lines 679–862) with `non_streaming_mode=False`, `speakers=None`, `instruct_ids=None` (Base model, no presets/instructs — drop those parameters and the dialect branch; keep the ICL branch and the no-voice branch intact).

- [ ] **Step 1: Failing tests**
```python
# sidecar/tests/test_qwen3_codec_template.py
import numpy as np, os
from types import SimpleNamespace
from sokuji_sidecar.qwen3_tts import codec, config, template
FIX = os.path.join(os.path.dirname(__file__), "fixtures", "qwen3_tts_config.json")

class _IO:
    def __init__(self, n): self.name = n

class _Enc:
    def get_outputs(self): return [_IO("audio_codes"), _IO("lengths")]
    def run(self, names, feeds):
        n = feeds["input_values"].shape[1]
        frames = max(1, int(np.ceil(n / 1920)))
        return [np.ones((1, frames, 16), np.int64), np.array([frames], np.int64)]

class _Dec:
    def get_outputs(self): return [_IO("audio_values"), _IO("lengths")]
    def run(self, names, feeds):
        frames = feeds["audio_codes"].shape[1]
        return [np.zeros((1, frames * 1920), np.float32), np.array([frames * 1920], np.int64)]

def test_codec_roundtrip_shapes():
    c = codec.Codec12Hz({"tokenizer12hz_encode": _Enc(), "tokenizer12hz_decode": _Dec()})
    codes = c.encode(np.zeros(24000, np.float32))
    assert codes.shape == (13, 16)                      # ceil(24000/1920)
    wav = c.decode(codes)
    assert wav.shape == (13 * 1920,)

class _FakeEmb:
    """text_project returns per-id one-hot-ish rows so layout is inspectable."""
    def __init__(self, h=8): self.h = h
    def text_project(self, ids):
        out = np.zeros((1, ids.shape[1], self.h), np.float32)
        out[0, :, 0] = ids[0].astype(np.float32); return out
    def codec_embed(self, ids):
        out = np.zeros((1, ids.shape[1], self.h), np.float32)
        out[0, :, 1] = ids[0].astype(np.float32); return out
    def code_predictor_embed(self, ids, step):
        out = np.zeros((1, ids.shape[1], self.h), np.float32)
        out[0, :, 2] = ids[0].astype(np.float32); return out

def _cfg(): return config.load_model_config(FIX)

def test_template_no_voice_shapes_and_mask():
    cfg = _cfg(); emb = _FakeEmb()
    ids = np.arange(12, dtype=np.int64)[None, :]        # 3 role + 4 text + 5 trailing
    padded, mask, trail, pad_emb = template.build_talker_inputs(
        cfg, emb, input_ids=ids, ref_ids=None, voice_clone_prompt=None, language_name="english")
    assert padded.ndim == 3 and padded.shape[0] == 1 and padded.shape[2] == 8
    assert mask.shape == (1, padded.shape[1]) and mask.all()
    # trailing hidden = text_project(ids[4:-5]) + tts_eos → 3 text tokens + 1
    assert trail.shape[1] == 4
    assert pad_emb.shape == (1, 1, 8)

def test_template_icl_requires_ref_ids():
    cfg = _cfg(); emb = _FakeEmb()
    ids = np.arange(12, dtype=np.int64)[None, :]
    vcp = {"ref_code": [np.ones((5, 16), np.int64)], "ref_spk_embedding": [np.zeros(8, np.float32)],
           "x_vector_only_mode": [False], "icl_mode": [True]}
    try:
        template.build_talker_inputs(cfg, emb, ids, ref_ids=None, voice_clone_prompt=vcp, language_name=None)
        assert False, "expected ValueError"
    except ValueError:
        pass
```
- [ ] **Step 2: Run → FAIL**; **Step 3: Implement** — ports per the reference (read lines 535–633 and 679–862; batch=1 simplification allowed but keep the math identical; `generate_icl_prompt` inner function kept); **Step 4: Run → PASS** (3); **Step 5: Commit** `feat(sidecar): qwen3_tts codec + talker-input template builder`.

### Task 8: `Qwen3TtsOnnxBackend` + catalog rows + resolver + downloads

**Files:** Modify `sidecar/sokuji_sidecar/tts_backends.py` (append backend), `catalog.py` (field + rows + capability), `accel.py` (`_installed`), `native_models.py`; Test `sidecar/tests/test_qwen3_backend.py` + extend `test_catalog.py`/`test_accel.py`/`test_native_models.py`.
**Interfaces — Consumes:** all of Tasks 3–7. **Produces:** the backend; `TtsModel.transcript_required: bool = False`; `voice_capability()` adds `"transcriptRequired": True` **only when** `custom == "clip"` and the flag is set; two rows; `_installed()["qwen3tts_onnx"] = "onnxruntime"`.

- [ ] **Step 1: Failing tests**
```python
# sidecar/tests/test_qwen3_backend.py  (fake sessions; no download)
import numpy as np
from sokuji_sidecar.tts_backends import Qwen3TtsOnnxBackend

def test_flags():
    assert (Qwen3TtsOnnxBackend.NAME, Qwen3TtsOnnxBackend.STREAMING, Qwen3TtsOnnxBackend.CLONES) \
        == ("qwen3tts_onnx", False, True)

def test_set_voice_requires_loaded_and_builds_icl(monkeypatch):
    b = Qwen3TtsOnnxBackend()
    calls = {}
    b._codec = type("C", (), {"encode": staticmethod(lambda wav: np.ones((4, 16), np.int64))})()
    b._spk_embed = lambda wav: np.zeros(8, np.float32)
    b._tokenize = lambda text: np.arange(6, dtype=np.int64)[None, :]
    b.set_voice(np.zeros(24000, np.float32), 24000, ref_text="hello there")
    vcp = b._voice_prompt
    assert vcp["icl_mode"] == [True] and vcp["ref_code"][0].shape == (4, 16)
    b.set_voice(np.zeros(24000, np.float32), 24000, ref_text="")
    assert b._voice_prompt["x_vector_only_mode"] == [True]   # empty transcript → x-vector fallback

def test_list_builtin_voices_empty():
    assert Qwen3TtsOnnxBackend.list_builtin_voices() == []
```
```python
# append to sidecar/tests/test_catalog.py
def test_qwen3_rows_and_capability():
    for mid, rec in (("qwen3-tts-0.6b", True), ("qwen3-tts-1.7b", False)):
        m = catalog.tts_model(mid)
        assert m and m.clones is True and m.streaming is False and m.sample_rate == 24000
        assert m.transcript_required is True and m.recommended is rec
        assert {d.backend for d in m.deployments} == {"qwen3tts_onnx"}
        assert catalog.voice_capability(m) == {"builtin": "none", "custom": "clip", "transcriptRequired": True}
    # MOSS capability unchanged (no extra key)
    assert catalog.voice_capability(catalog.tts_model("moss-tts-nano")) == {"builtin": "named", "custom": "clip"}
```
```python
# append to sidecar/tests/test_accel.py
def test_qwen3_backend_installed_and_resolvable():
    assert "qwen3tts_onnx" in accel._installed()
    plans = accel.resolve_tts("qwen3-tts-0.6b", override="cpu")
    assert plans and plans[0].backend == "qwen3tts_onnx"
```
```python
# append to sidecar/tests/test_native_models.py
def test_qwen3_download_specs_point_at_per_size_repos():
    assert "qwen3-tts-0.6b-onnx" in native_models.download_specs("qwen3-tts-0.6b")["repos"][0]
    assert "qwen3-tts-1.7b-onnx" in native_models.download_specs("qwen3-tts-1.7b")["repos"][0]
```
- [ ] **Step 2: Run → FAIL**; **Step 3: Implement**:
  - **Backend** (append to `tts_backends.py`): `Qwen3TtsOnnxBackend` with `NAME/STREAMING/CLONES/sample_rate=24000`. `load(model_ref, device, compute_type)`: `snapshot_download(local_files_only=True)` → `runtime.build_sessions(f"{d}/onnx", device, threads)`; `config.load_model_config(d)`; tokenizer = `transformers.AutoTokenizer.from_pretrained(d, local_files_only=True)`; helpers `self._tokenize(text) -> np.int64[1, n]` (`add_special_tokens=False`), `self._spk_embed(wav24k)` (Task 5 `log_mel` → `mels.T[None]` → speaker_encoder session), `self._codec = codec.Codec12Hz(sessions)`; `BackendLoadError` wrap. `set_language(lang)`: `self._lang_name = template.language_name(lang)`. `set_voice(audio, sr, ref_text="")`: resample to 24 k (`librosa.resample`), build `self._voice_prompt = {"ref_code": [codes|None], "ref_spk_embedding": [spk], "x_vector_only_mode": [not ref_text], "icl_mode": [bool(ref_text)]}` and `self._ref_ids = [self._tokenize(template.build_ref_text(ref_text))] if ref_text else None`. `generate(text, speed)` (speed ignored): `input_ids = self._tokenize(template.build_assistant_text(text))` → `template.build_talker_inputs(...)` → `runtime.generate_codes(...)` with the Global-Constraints sampling defaults, `eos=cfg.talker.codec_eos_token_id`, suppress list per Global Constraints, `max_new_tokens=int(os.environ.get("SOKUJI_QWEN3_TTS_MAX_FRAMES", "600"))` → ICL: prepend `ref_code`, decode, cut `ref_len/total_len` proportionally (reference lines 981–995) → `(np.float32, ms)`. No voice set → `voice_clone_prompt=None` path (unconditioned). `list_builtin_voices() -> []` (staticmethod). `unload/is_loaded`.
  - **catalog.py**: `transcript_required: bool = False` on `TtsModel`; in `voice_capability()` after computing the dict: `if custom == "clip" and getattr(model, "transcript_required", False): out["transcriptRequired"] = True`. Two rows after Supertonic (sort_order 2, 3), repos from the env vars (module-level `os.environ.get(...)` like `_MOSS_NANO_LM_REPO`), `size_bytes` = the Task 2 recorded totals (paste the printed numbers).
  - **accel.py** `_installed`: `"qwen3tts_onnx": "onnxruntime",`.
  - **native_models.py**: nothing needed beyond the catalog branch (rows carry `repos`) — verify `download_specs` resolves via the existing `_tm` branch.
- [ ] **Step 4: Run → PASS** + full sidecar suite green; **Step 5: Commit** `feat(sidecar): Qwen3TtsOnnxBackend + catalog rows + transcriptRequired capability`.

### Task 9: `tts_engine` refText threading

**Files:** Modify `sidecar/sokuji_sidecar/tts_engine.py`; Test extend `sidecar/tests/test_tts_engine_supertonic.py` (or a new `test_tts_engine_qwen3.py`).
**Interfaces — Produces:** `TtsEngine.set_voice(self, audio, sr, ref_text=None)` — passes `ref_text=` to the backend **only when** its `set_voice` signature has that parameter (`inspect.signature`); `_h_set_voice` clip branch reads `msg.get("refText")`.

- [ ] **Step 1: Failing test**
```python
# sidecar/tests/test_tts_engine_qwen3.py
import numpy as np
from sokuji_sidecar import tts_engine

class _RefTextBackend:
    def __init__(self): self.got = None
    def set_voice(self, audio, sr, ref_text=""): self.got = (len(audio), sr, ref_text)

class _PlainBackend:
    def __init__(self): self.got = None
    def set_voice(self, audio, sr): self.got = (len(audio), sr)

def test_engine_passes_ref_text_only_when_supported():
    eng = tts_engine.TtsEngine()
    eng._backend = _RefTextBackend()
    eng.set_voice(np.zeros(10, np.float32), 24000, ref_text="hi")
    assert eng._backend.got == (10, 24000, "hi")
    eng._backend = _PlainBackend()
    eng.set_voice(np.zeros(10, np.float32), 24000, ref_text="hi")   # must not raise
    assert eng._backend.got == (10, 24000)

async def test_handler_threads_reftext():
    rec = _RefTextBackend()
    eng = tts_engine.TtsEngine(); eng._backend = rec
    msg = {"type": "set_voice", "sampleRate": 24000, "refText": "hello"}
    await tts_engine._h_set_voice({"tts_engine": eng}, msg, np.zeros(4, np.float32).tobytes(), conn=None)
    assert rec.got[2] == "hello"
```
- [ ] **Step 2: Run → FAIL**; **Step 3: Implement** (`inspect.signature(self._backend.set_voice).parameters`); **Step 4: Run → PASS** + full suite; **Step 5: Commit** `feat(sidecar): thread refText through set_voice for ICL cloning`.

---

## Phase B — Renderer (transcript-aware clip cloning)

### Task 10: Protocol + `setReferenceVoice(refText)`

**Files:** Modify `src/lib/local-inference/native/nativeProtocol.ts` (`voice` gains `transcriptRequired?: boolean`), `NativeTtsClient.ts`; `nativeCatalog.ts` (`VoiceCapability` type gains `transcriptRequired?: boolean` — `voiceCapability` already returns `model.voice` verbatim); Test extend `NativeTtsClient.test.ts` + `nativeCatalog.test.ts`.
**Interfaces — Produces:** `setReferenceVoice(audio: Float32Array, sampleRate: number, refText?: string)` — control message gains `refText` when truthy.

- [ ] **Step 1: Failing tests**
```typescript
// NativeTtsClient.test.ts — reuse the FakeWS harness (bins/sent filters, as the setStyleVoice tests do)
it('setReferenceVoice includes refText when provided', async () => {
  const c = new NativeTtsClient();
  await c.init('qwen3-tts-0.6b');
  await c.setReferenceVoice(new Float32Array([0.1]), 24000, 'hello world');
  const sent = FakeWS.last.sent.filter((s) => typeof s === 'string').map((s) => JSON.parse(s));
  const msg = sent.find((m) => m.type === 'set_voice' && m.sampleRate === 24000);
  expect(msg.refText).toBe('hello world');
});
// nativeCatalog.test.ts
it('voiceCapability passes transcriptRequired through', () => {
  expect(voiceCapability({ voice: { builtin: 'none', custom: 'clip', transcriptRequired: true } } as any))
    .toEqual({ builtin: 'none', custom: 'clip', transcriptRequired: true });
});
```
- [ ] **Step 2: Run → FAIL**; **Step 3: Implement** (`refText` appended to the message object only when non-empty; types updated); **Step 4: Run → PASS**; **Step 5: Commit** `feat(native): refText on set_voice + transcriptRequired capability type`.

### Task 11: Clip storage + store transcript support

**Files:** Modify `src/lib/local-inference/nativeVoiceStorage.ts` (`StoredNativeVoice.transcript?: string`; `addNativeVoice(name, clip, sampleRate, transcript?)`), `src/lib/local-inference/native/nativeVoiceStores.ts`; Test extend `nativeVoiceStores.test.ts` (+ `nativeVoiceStorage` test file if one exists).
**Interfaces — Produces:** `NativeCustomVoice` gains `hasTranscript?: boolean` (OPTIONAL — the clip store always sets it; the Supertonic style store is untouched and leaves it undefined); `NativeVoiceStore.onImport(file, transcript?)` / `onRecord?(clip, sampleRate, transcript?)` (style store ignores the extra arg); clip `resolveApply` payload gains `transcript?: string` (`VoiceApplyPayload` clip variant).

- [ ] **Step 1: Failing tests**
```typescript
// nativeVoiceStores.test.ts (extend the existing mocks: stored clip fixture gains transcript)
it('clip store surfaces transcripts', async () => {
  // mock listNativeVoices → [{id:1, name:'A', audio:[0.5], sampleRate:24000, transcript:'hi'},
  //                          {id:2, name:'B', audio:[0.5], sampleRate:24000}]
  const s = voiceStoreFor('clip', 'qwen3-tts-0.6b')!;
  const list = await s.list();
  expect(list).toEqual([{ id: 1, name: 'A', hasTranscript: true }, { id: 2, name: 'B', hasTranscript: false }]);
  const p = await s.resolveApply(1);
  expect(p).toMatchObject({ kind: 'clip', sampleRate: 24000, transcript: 'hi' });
});
it('clip store onRecord forwards the transcript to storage', async () => {
  const s = voiceStoreFor('clip', 'qwen3-tts-0.6b')!;
  await s.onRecord!(new Float32Array(72000), 24000, 'spoken words');
  expect(vi.mocked(addNativeVoice)).toHaveBeenCalledWith(expect.any(String), expect.anything(), 24000, 'spoken words');
});
```
- [ ] **Step 2: Run → FAIL**; **Step 3: Implement** (storage field + store threading; style store signature widened but arg unused); **Step 4: Run → PASS** (whole `nativeVoiceStores` + storage suites); **Step 5: Commit** `feat(native): clip voices carry an optional transcript`.

### Task 12: Mandatory transcript UI + custom-list filtering

**Files:** Modify `src/components/Settings/sections/VoiceLibrarySection.tsx` (capability gains `transcriptRequired?: boolean`; when true render a labeled text input in the manage toolbar, disable Import/Record until non-empty, pass the value as `onImport(file, transcript)` / `onRecord(clip, sr, transcript)`, clear on success), `NativeVoiceSection.tsx` (pass `transcriptRequired` into the store capability handed to `VoiceLibrarySection`; filter customs to `hasTranscript` when required); Test extend `VoiceLibrarySection.test.tsx` + `NativeVoiceSection.test.tsx`.
**Interfaces — Consumes:** Task 11 store shapes; `voiceCapability(model).transcriptRequired`.

- [ ] **Step 1: Failing tests**
```tsx
// VoiceLibrarySection.test.tsx
it('transcriptRequired gates import behind a non-empty transcript', async () => {
  const onImport = vi.fn();
  render(<VoiceLibrarySection voices={[]} selectedId="" onSelect={() => {}}
    onImport={onImport} onRename={async () => {}} onDelete={async () => {}}
    capability={{ importModes: ['upload'], curation: false, presentation: 'dropdown', transcriptRequired: true }} />);
  // manage details open → import button disabled while transcript empty
  fireEvent.click(screen.getByText(/manage imported voices/i));
  const btn = screen.getByRole('button', { name: /import voice/i });
  expect(btn).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/transcript/i), { target: { value: 'what the clip says' } });
  expect(btn).not.toBeDisabled();
});
// NativeVoiceSection.test.tsx
it('filters custom clips without transcripts for transcriptRequired models', async () => {
  const store = { kind: 'clip', capability: { importModes: ['record','upload'], curation: false, presentation: 'dropdown' },
    list: async () => [{ id: 1, name: 'WithText', hasTranscript: true }, { id: 2, name: 'NoText', hasTranscript: false }],
    onImport: async () => {}, onRecord: async () => {}, rename: async () => {}, delete: async () => {}, resolveApply: async () => null };
  render(<NativeVoiceSection capability={{ builtin: 'none', custom: 'clip', transcriptRequired: true }}
    builtinVoices={[]} store={store as any} selected="" targetLanguage="en"
    onSelect={() => {}} onCustomChanged={() => {}} />);
  expect(await screen.findByText('WithText')).toBeInTheDocument();
  expect(screen.queryByText('NoText')).toBeNull();
});
```
- [ ] **Step 2: Run → FAIL**; **Step 3: Implement** (controlled `transcript` state in `VoiceLibrarySection`; the input renders only when `capability.transcriptRequired`; MOSS/WASM paths — capability without the flag — are pixel-identical); **Step 4: Run → PASS** including existing MOSS/Supertonic/WASM characterization suites; **Step 5: Commit** `feat(native): mandatory transcript capture for ICL clip voices`.

### Task 13: Apply path + final sweeps

**Files:** Modify `src/services/clients/LocalNativeClient.ts` (clip apply passes transcript); Test extend its suite.
**Interfaces — Consumes:** `payload.transcript` (Task 11), `setReferenceVoice(audio, sr, refText?)` (Task 10).

- [ ] **Step 1: Failing test** — in the existing "applies a custom cloned voice" harness, give the stored clip a transcript and assert:
```typescript
expect(ttsClientMock.setReferenceVoice).toHaveBeenCalledWith(expect.any(Float32Array), 24000, 'the transcript');
```
- [ ] **Step 2: Run → FAIL**; **Step 3: Implement** — `if (payload?.kind === 'clip') await this.tts.setReferenceVoice(payload.audio, payload.sampleRate, payload.transcript);`
- [ ] **Step 4: Full sweeps** — `npx vitest run src/lib/local-inference/native src/components/Settings/sections src/services/clients` and `cd sidecar && .venv/bin/python -m pytest -q` → all green.
- [ ] **Step 5: Commit** `feat(native): pass clip transcript through the voice apply path`.

---

## Final verification

- Suites: sidecar pytest + renderer vitest sweeps green (Task 13 Step 4).
- Grep: `grep -rn "qwen3tts_onnx" sidecar/sokuji_sidecar` shows backend/catalog/accel wired; `grep -rn "transcriptRequired" src/ sidecar/` shows the capability threaded end-to-end.
- Manual (RTX 4070, after Task 2 upload + model download in-app): LOCAL_NATIVE → Qwen3-TTS (0.6B) card downloads; record a voice **with transcript** → generate on GPU (`tts_init` resolved device `cuda`, RTF reported ≈0.4); unconditioned generate (no voice) also produces audio; 1.7B row downloads and either fits GPU (prefill dropped) or falls back per the spike verdict; MOSS/Supertonic cards behave exactly as before.
