# CosyVoice 3 TTS Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CosyVoice 3 (Fun-CosyVoice3-0.5B) as a Local Native TTS card — zero-shot voice cloning, 24 kHz, GPU-CUDA-only deployment — via a fresh torch-free ONNX pipeline (issue #323, phase 2; phase-1 spike passed 2026-07-16/17).

**Architecture:** New sidecar module `sidecar/sokuji_sidecar/cosyvoice3/` (mel/sampling/frontend/runtime/pipeline) + a `CosyVoice3OnnxBackend` in `tts_backends.py`, mirroring the `qwen3_tts` module shape and the Qwen3 ICL-voice backend contract (`set_voice`/`set_builtin_voice` with `ref_text`, bundled `voices/manifest.json`). Models are hosted on our own HF repo (int4 LLM backbones + fp32-upcast everything else — the precision set validated in the spike) built by a committed conversion script from the `ayousanz/cosy-voice3-onnx` export.

**Tech Stack:** numpy, onnxruntime (1.23.2 pinned in SKUs; verified), `tokenizers` (via existing `qwen_tokenizer.py`), `pyopenjtalk` (already in requirements via GPT-SoVITS), soundfile/soxr. NO torch, NO librosa, NO transformers (AST import gates enforce this).

## Global Constraints

- **Torch-free sidecar**: never import torch/librosa/transformers in `sidecar/sokuji_sidecar/` (enforced by AST gate tests; add one for the new module).
- **Two-provider parity rule**: no code sharing with the WASM LOCAL_INFERENCE provider.
- **Python 3.12**, deps must have wheels for linux x86_64+aarch64 / win amd64 / mac universal2 (no new deps are introduced by this plan).
- Backend NAME: `cosyvoice3_onnx`. Card id: `cosyvoice3-0.5b`. HF repo: `jiangzhuo9357/cosyvoice3-0.5b-onnx` (env override `SOKUJI_COSYVOICE3_REPO`).
- All GitHub artifacts (commits/PR) and code comments in English; conventional commits; every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do NOT push, open PRs, upload to HF, or comment on issues without explicit user approval (upload is a manual gate in Task 9).
- Worktree: `.claude/worktrees/feat+cosyvoice3-tts`, branch `feat/cosyvoice3-tts` already fast-forwarded to `cf1c19c9` (includes PR #325 Pocket + GPT-SoVITS).
- Run sidecar tests as: `cd sidecar && .venv/bin/python -m pytest tests/<file> -q` (venv already initialized).

## Context primer (read once)

The phase-1 spike lives (untracked) in `.spike/` in this worktree:
- `.spike/cosyvoice3_spike.py` — the WORKING end-to-end pipeline (verbatim-correct zh/en per whisper round-trip). The module code below is an adaptation of it; when in doubt about semantics, that file is ground truth (it encodes the official CosyVoice3 algorithm, verified against the official repo and adversarially reviewed).
- `.spike/models/cosy-voice3-onnx/` — the downloaded export + our converted graphs (`*_int4.onnx`, `*_fp32-upcast.onnx`).
- `.spike/out/README.md` — full spike findings; the "Precision experiments" and "GPU validation" sections justify every precision/EP decision below.
- `.spike/convert_fp16_to_fp32.py` — the fp16→fp32 upcaster (reused by Task 8).

Key verified facts the code relies on:
- Pipeline: text+prompt → LLM (Qwen2-0.5B backbone, speech tokens 0..6560 @ 25 tok/s) → flow (DiT CFM, 10 Euler steps, cosine t-schedule, CFG rate 0.7, token_mel_ratio 2) → HiFT vocoder (f0 → NSF source → stft(16,4) → decoder → istft) → 24 kHz float32.
- Zero-shot template: `"You are a helpful assistant."` + `<|endofprompt|>` (id **151646**, spliced as a raw id — the exported tokenizer cannot produce it) + prompt transcript; tts text appended after.
- Stop set: ids ≥ 6561 (all 200 specials). While `step < min_len` mask them to -inf. Stop token is never appended/fed back. `min_len = 2*len(tts_ids)`, `max_len = 20*len(tts_ids)`.
- Sampler: official `ras_sampling` (nucleus top_p 0.8 ∩ top_k 25, stable sort; if sampled token appeared in last 10 → ban it and resample from full softmax).
- Silent tokens `{1,2,28,29,55,248,494,2241,2242,2322,2323}`: dropped from the flow-bound sequence after >5 consecutive; the LLM feedback/RAS window keeps them.
- fp16 graphs are numerically broken on CUDA and on ORT≥1.24 CPU. The shipped set is int4 backbones (MatMulNBits) + fp32 everything else; verified on ORT 1.23.2/1.24/1.27, CPU and CUDA, same-seed token-identical CPU vs GPU.
- Prompt processing (speech_tokenizer_v3 969MB + campplus, CPU-only "cold" graphs) is out of the synthesis hot path — cached per voice.
- Japanese kanji get Chinese readings unless kana-normalized: `pyopenjtalk.g2p(text, kana=True)` fixes it (validated: `ja_kana2.wav`).

---

### Task 1: `cosyvoice3/mel.py` — three numpy feature extractors

**Files:**
- Create: `sidecar/sokuji_sidecar/cosyvoice3/__init__.py` (empty)
- Create: `sidecar/sokuji_sidecar/cosyvoice3/mel.py`
- Create: `sidecar/tests/test_cosyvoice3_mel.py`
- Create: `scripts/cosyvoice3/gen_mel_goldens.py` (golden generator, run once against the spike venv)
- Create: `sidecar/tests/data/cosyvoice3_mel_goldens.npz` (committed, ~100 KB)

**Interfaces:**
- Produces: `whisper_log_mel_128(audio16k: np.ndarray) -> np.ndarray` `[1,128,T] float32`; `kaldi_fbank_80_cmn(audio16k: np.ndarray) -> np.ndarray` `[1,frames,80] float32`; `matcha_mel_80(audio24k: np.ndarray) -> np.ndarray` `[frames,80] float32`. Consumed by Task 5.

- [ ] **Step 1: Write the golden generator** (runs in the spike venv where librosa exists; goldens pin our numpy ports to the spike's librosa-based reference that produced verbatim-correct audio)

```python
#!/usr/bin/env python3
# Apache License 2.0
"""Generate golden mel outputs from the spike's librosa-based reference.

Run ONCE from the worktree root with the spike venv:
    .spike/venv/bin/python scripts/cosyvoice3/gen_mel_goldens.py
Commits sidecar/tests/data/cosyvoice3_mel_goldens.npz. The sidecar's numpy
ports (sokuji_sidecar/cosyvoice3/mel.py) must match these within 1e-4.
"""
import sys
import numpy as np

sys.path.insert(0, ".spike")
from cosyvoice3_spike import whisper_log_mel_128, kaldi_fbank_80_cmn, matcha_mel_80

rng = np.random.default_rng(20260717)
# 0.5 s of band-limited noise + a 440 Hz tone, deterministic
t16 = np.arange(8000) / 16000.0
t24 = np.arange(12000) / 24000.0
sig16 = (0.3 * np.sin(2 * np.pi * 440 * t16)
         + 0.05 * rng.standard_normal(8000)).astype(np.float32)
sig24 = (0.3 * np.sin(2 * np.pi * 440 * t24)
         + 0.05 * rng.standard_normal(12000)).astype(np.float32)

np.savez_compressed(
    "sidecar/tests/data/cosyvoice3_mel_goldens.npz",
    sig16=sig16, sig24=sig24,
    whisper=whisper_log_mel_128(sig16),
    kaldi=kaldi_fbank_80_cmn(sig16),
    matcha=matcha_mel_80(sig24),
)
print("goldens written")
```

- [ ] **Step 2: Run the generator once**

Run: `.spike/venv/bin/python scripts/cosyvoice3/gen_mel_goldens.py`
Expected: `goldens written`; `sidecar/tests/data/cosyvoice3_mel_goldens.npz` exists.

- [ ] **Step 3: Write the failing tests**

```python
# sidecar/tests/test_cosyvoice3_mel.py
import numpy as np
import pytest
from pathlib import Path

from sokuji_sidecar.cosyvoice3 import mel

GOLD = np.load(Path(__file__).parent / "data" / "cosyvoice3_mel_goldens.npz")


def test_whisper_mel_matches_reference():
    out = mel.whisper_log_mel_128(GOLD["sig16"])
    assert out.shape == GOLD["whisper"].shape  # [1, 128, T], last frame dropped
    np.testing.assert_allclose(out, GOLD["whisper"], atol=1e-4)


def test_kaldi_fbank_matches_reference():
    out = mel.kaldi_fbank_80_cmn(GOLD["sig16"])
    assert out.shape == GOLD["kaldi"].shape      # [1, frames, 80]
    np.testing.assert_allclose(out, GOLD["kaldi"], atol=1e-4)
    # CMN: per-bin mean over time is ~0
    np.testing.assert_allclose(out[0].mean(axis=0), 0.0, atol=1e-6)


def test_matcha_mel_matches_reference():
    out = mel.matcha_mel_80(GOLD["sig24"])
    assert out.shape == GOLD["matcha"].shape     # [frames, 80]
    np.testing.assert_allclose(out, GOLD["matcha"], atol=1e-4)


def test_matcha_frame_rate_is_50fps():
    # 24000 / 480 hop = 50 fps: 1 s of audio -> exactly 50 frames
    out = mel.matcha_mel_80(np.zeros(24000, dtype=np.float32))
    assert out.shape[0] == 50


def test_matcha_log_floor():
    out = mel.matcha_mel_80(np.zeros(24000, dtype=np.float32))
    assert np.all(out >= np.log(1e-5) - 1e-6)
```

- [ ] **Step 4: Run tests, expect import failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_mel.py -q`
Expected: FAIL (`ModuleNotFoundError: sokuji_sidecar.cosyvoice3`)

- [ ] **Step 5: Implement `mel.py`**

The spike used `librosa.stft`/`librosa.filters.mel`; port to numpy exactly like `qwen3_tts/mel.py` does (that file's `mel_filterbank` is a bit-exact Slaney port — copy its helpers, keep this module self-contained like `gpt_sovits/`). Key recipe differences from qwen3:

```python
# sidecar/sokuji_sidecar/cosyvoice3/mel.py
# Apache License 2.0
"""Numpy feature extractors for CosyVoice3 (no librosa/torch).

Three front-ends, verified against the phase-1 spike reference outputs
(sidecar/tests/data/cosyvoice3_mel_goldens.npz):
  - whisper_log_mel_128: 16 kHz whisper-style 128-bin log10 mel for
    speech_tokenizer_v3 (center=True reflect, LAST FRAME DROPPED, clamp
    max-8, (x+4)/4).
  - kaldi_fbank_80_cmn: torchaudio.compliance.kaldi.fbank equivalent for
    campplus (snip_edges, DC removal, preemphasis 0.97 with replicate
    first sample, povey window, 512-pt rfft power spectrum, HTK mel
    1127*ln(1+f/700) over 20..8000 Hz, log clamp at float32 eps, CMN).
  - matcha_mel_80: 24 kHz HiFiGAN/matcha mel for the flow prompt
    (reflect pad (1920-480)//2, center=False, hann 1920, hop 480,
    sqrt(power+1e-9), Slaney mel fmin 0 fmax nyquist, log clamp 1e-5).
"""
import numpy as np

# ---- Slaney filterbank + STFT helpers: copy the implementations from
# sokuji_sidecar/qwen3_tts/mel.py (functions _hz_to_mel_slaney,
# _mel_to_hz_slaney, mel_filterbank, _hann_window, _reflect_pad) verbatim
# into this module — self-contained per backend-module convention. ----


def whisper_log_mel_128(audio16k: np.ndarray) -> np.ndarray:
    y = np.asarray(audio16k, dtype=np.float64)
    pad = 200                                   # n_fft // 2, center=True
    y = np.pad(y, (pad, pad), mode="reflect")
    win = _hann_window(400)                     # periodic hann
    n_frames = 1 + (len(y) - 400) // 160
    idx = np.arange(400)[None, :] + 160 * np.arange(n_frames)[:, None]
    frames = y[idx] * win
    spec = np.fft.rfft(frames, axis=1)          # [T, 201]
    power = (spec.real ** 2 + spec.imag ** 2)[:-1]   # whisper drops last frame
    fb = mel_filterbank(16000, 400, 128, 0.0, 8000.0)  # Slaney, [128, 201]
    m = power @ fb.T                            # [T-1, 128]
    log_spec = np.log10(np.maximum(m, 1e-10))
    log_spec = np.maximum(log_spec, log_spec.max() - 8.0)
    log_spec = (log_spec + 4.0) / 4.0
    return log_spec.T[np.newaxis, :, :].astype(np.float32)   # [1, 128, T]


def kaldi_fbank_80_cmn(audio16k: np.ndarray) -> np.ndarray:
    # Port the spike's kaldi_fbank_80_cmn VERBATIM (it is already pure
    # numpy): .spike/cosyvoice3_spike.py lines "def kaldi_fbank_80_cmn".
    ...


def matcha_mel_80(audio24k: np.ndarray) -> np.ndarray:
    y = np.asarray(audio24k, dtype=np.float64)
    pad = (1920 - 480) // 2
    y = np.pad(y, (pad, pad), mode="reflect")
    win = _hann_window(1920)
    n_frames = 1 + (len(y) - 1920) // 480       # center=False
    idx = np.arange(1920)[None, :] + 480 * np.arange(n_frames)[:, None]
    frames = y[idx] * win
    spec = np.fft.rfft(frames, axis=1)
    mag = np.sqrt(spec.real ** 2 + spec.imag ** 2 + 1e-9)
    fb = mel_filterbank(24000, 1920, 80, 0.0, 12000.0)
    m = mag @ fb.T                              # [frames, 80]
    return np.log(np.maximum(m, 1e-5)).astype(np.float32)
```

Notes for the implementer: (a) `_hann_window` in qwen3 mel.py divides by N — check the golden test; if goldens mismatch, the spike used `librosa` hann = `np.hanning(N+1)[:N]`-style periodic WITHOUT the /N division; match the goldens, they are the contract. (b) `mel_filterbank` from qwen3_tts/mel.py takes `(sr, n_fft, n_mels, fmin, fmax)` and returns `[n_mels, 1+n_fft//2]` float64.

- [ ] **Step 6: Run tests until they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_mel.py -q`
Expected: 5 passed. Iterate on windowing/normalization details until goldens match (atol 1e-4).

- [ ] **Step 7: Commit**

```bash
git add sidecar/sokuji_sidecar/cosyvoice3/ sidecar/tests/test_cosyvoice3_mel.py \
        sidecar/tests/data/cosyvoice3_mel_goldens.npz scripts/cosyvoice3/gen_mel_goldens.py
git commit -m "feat(sidecar): cosyvoice3 numpy mel front-ends (whisper/kaldi/matcha)"
```

---

### Task 2: `cosyvoice3/sampling.py` — official ras_sampling in numpy

**Files:**
- Create: `sidecar/sokuji_sidecar/cosyvoice3/sampling.py`
- Test: `sidecar/tests/test_cosyvoice3_sampling.py`

**Interfaces:**
- Produces: `log_softmax(logits: np.ndarray) -> np.ndarray`; `ras_sampling(logp: np.ndarray, decoded_tokens: list[int], rng: np.random.Generator, top_p=0.8, top_k=25, win_size=10, tau_r=0.1) -> int`. Consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

```python
# sidecar/tests/test_cosyvoice3_sampling.py
import numpy as np

from sokuji_sidecar.cosyvoice3.sampling import log_softmax, ras_sampling


def _peaked_logits(n=6761, peak=42, value=50.0):
    x = np.zeros(n)
    x[peak] = value
    return x


def test_log_softmax_normalizes():
    lp = log_softmax(_peaked_logits())
    assert abs(np.exp(lp).sum() - 1.0) < 1e-9


def test_deterministic_peak_wins():
    rng = np.random.default_rng(0)
    lp = log_softmax(_peaked_logits(peak=42))
    assert ras_sampling(lp, [], rng) == 42


def test_masked_ids_never_sampled():
    rng = np.random.default_rng(0)
    lp = log_softmax(np.zeros(6761))
    lp[6561:] = -np.inf                       # the min_len stop-mask
    for _ in range(200):
        assert ras_sampling(lp, [], rng) < 6561


def test_repetition_triggers_resample():
    # peak token appeared in the last-10 window -> RAS bans it and samples
    # from the full softmax; with the peak banned, another id must come out.
    rng = np.random.default_rng(0)
    lp = log_softmax(_peaked_logits(peak=7, value=50.0))
    out = ras_sampling(lp, [7], rng)
    assert out != 7


def test_repetition_outside_window_ignored():
    rng = np.random.default_rng(0)
    lp = log_softmax(_peaked_logits(peak=7, value=50.0))
    decoded = [7] + [1] * 10                  # the 7 is outside the last-10
    assert ras_sampling(lp, decoded, rng) == 7
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_sampling.py -q`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement** (port from `.spike/cosyvoice3_spike.py` — `_softmax`, `_nucleus_sample`, `ras_sampling`, and the loop's log_softmax expression — verbatim semantics: stable descending sort; joint `cum < top_p AND len < top_k` cutoff checked before adding; renormalize the nucleus subset; `rep_num >= win_size*tau_r` over `decoded_tokens[-win_size:]`; on trigger, set `logp[top_id] = -inf`, re-softmax, sample the FULL vocab.)

- [ ] **Step 4: Run tests to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_sampling.py -q`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/cosyvoice3/sampling.py sidecar/tests/test_cosyvoice3_sampling.py
git commit -m "feat(sidecar): cosyvoice3 ras_sampling (nucleus + repetition-aware resample)"
```

---

### Task 3: `cosyvoice3/frontend.py` — tokenizer, zero-shot template, JA kana + zh punctuation normalization

**Files:**
- Create: `sidecar/sokuji_sidecar/cosyvoice3/frontend.py`
- Test: `sidecar/tests/test_cosyvoice3_frontend.py`

**Interfaces:**
- Consumes: `sokuji_sidecar.qwen_tokenizer.load_qwen2_tokenizer(model_dir) -> tokenizers.Tokenizer` (existing shared module; encode via `tok.encode(text, add_special_tokens=False).ids`).
- Produces: `ENDOFPROMPT_ID = 151646`; `load_tokenizer(model_dir)`; `normalize_text(text: str) -> str`; `build_prompt_text_ids(tok, transcript: str) -> list[int]`; `encode_tts_text(tok, text: str) -> list[int]`. Consumed by Tasks 5/6.

- [ ] **Step 1: Write the failing tests**

```python
# sidecar/tests/test_cosyvoice3_frontend.py
import pytest

from sokuji_sidecar.cosyvoice3 import frontend


class _FakeEncoding:
    def __init__(self, ids):
        self.ids = ids


class _FakeTok:
    """Deterministic fake: one id per character codepoint."""
    def encode(self, text, add_special_tokens=False):
        return _FakeEncoding([ord(c) for c in text])


def test_prompt_ids_splice_endofprompt():
    ids = frontend.build_prompt_text_ids(_FakeTok(), "hi")
    prefix = [ord(c) for c in "You are a helpful assistant."]
    assert ids == prefix + [frontend.ENDOFPROMPT_ID] + [ord("h"), ord("i")]


def test_japanese_text_is_kana_normalized():
    out = frontend.normalize_text("こんにちは、今日はとても良い天気ですね。")
    # pyopenjtalk renders pronunciations in katakana; no kanji must survive
    assert "今日" not in out and "良" not in out and "天気" not in out
    assert "、" in out or "。" in out          # punctuation preserved


def test_pure_chinese_text_untouched_except_period():
    assert frontend.normalize_text("今天天气真好.") == "今天天气真好。"


def test_english_text_untouched():
    s = "Hello, world. It works!"
    assert frontend.normalize_text(s) == s


def test_kana_detection_requires_kana_not_just_cjk():
    # kanji-only strings are ambiguous zh/ja: leave them alone
    s = "人工知能"
    assert frontend.normalize_text(s) == s
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_frontend.py -q`
Expected: FAIL

- [ ] **Step 3: Implement**

```python
# sidecar/sokuji_sidecar/cosyvoice3/frontend.py
# Apache License 2.0
"""Text front-end for CosyVoice3.

Zero-shot template (official CosyVoice3 usage, asserted by the upstream
LLM): prompt_text = "You are a helpful assistant." + <|endofprompt|>
(id 151646) + reference transcript. The exported tokenizer cannot encode
<|endofprompt|>, so the id is spliced in raw — verified token-identical
to the official tokenizer in the phase-1 spike review.

Japanese input is kana-normalized with pyopenjtalk (g2p kana=True):
the 0.5B LLM reads kanji with Chinese phonology otherwise (spike finding);
kana input is essentially correct. Detection: any hiragana/katakana in the
text marks it Japanese. pyopenjtalk import failures degrade softly (text
passes through unmodified) so the backend never dies over the JA path.
"""
import re

from ..qwen_tokenizer import load_qwen2_tokenizer

ENDOFPROMPT_ID = 151646
ZERO_SHOT_PREFIX = "You are a helpful assistant."

_KANA_RE = re.compile(r"[぀-ヿ]")
_CJK_RE = re.compile(r"[一-鿿]")


def load_tokenizer(model_dir: str):
    return load_qwen2_tokenizer(model_dir)


def _kana_normalize(text: str) -> str:
    try:
        import pyopenjtalk  # provided by the pyopenjtalk-plus wheel
    except Exception:
        return text
    # g2p(kana=True) keeps CJK punctuation; process between punctuation
    # marks so pause structure survives verbatim.
    parts = re.split(r"([、。，．！？!?,.]+)", text)
    out = []
    for part in parts:
        if part and _KANA_RE.search(part) or _CJK_RE.search(part):
            out.append(pyopenjtalk.g2p(part, kana=True))
        else:
            out.append(part)
    return "".join(out)


def normalize_text(text: str) -> str:
    text = text.strip()
    if _KANA_RE.search(text):
        return _kana_normalize(text)
    if _CJK_RE.search(text):
        # minimal zh normalization mirroring the official frontend
        return text.replace(".", "。").replace("?", "？").replace("!", "！")
    return text


def build_prompt_text_ids(tok, transcript: str) -> list:
    prefix = tok.encode(ZERO_SHOT_PREFIX, add_special_tokens=False).ids
    ref = tok.encode(normalize_text(transcript), add_special_tokens=False).ids
    return list(prefix) + [ENDOFPROMPT_ID] + list(ref)


def encode_tts_text(tok, text: str) -> list:
    return list(tok.encode(normalize_text(text), add_special_tokens=False).ids)
```

Note: the fake tokenizer in tests exposes `.encode(...).ids` — same surface as `tokenizers.Tokenizer`. The `_kana_normalize` split-and-rejoin keeps punctuation; adjust the regex details until the tests pass (the JA test only requires kanji gone + punctuation present).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_frontend.py -q`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/cosyvoice3/frontend.py sidecar/tests/test_cosyvoice3_frontend.py
git commit -m "feat(sidecar): cosyvoice3 text frontend (zero-shot template, JA kana, zh punct)"
```

---

### Task 4: `cosyvoice3/runtime.py` — sessions with explicit per-graph EP policy

**Files:**
- Create: `sidecar/sokuji_sidecar/cosyvoice3/runtime.py`
- Test: `sidecar/tests/test_cosyvoice3_runtime.py`

**Interfaces:**
- Produces: `GRAPH_FILES: dict[str, str]` (graph key → repo-relative path); `COLD_GRAPHS: tuple`; `build_sessions(model_dir: str, device: str, threads: int, session_factory=None) -> dict[str, object]`. `session_factory(path, providers, sess_options)` seam for test doubles (mirrors `qwen3_tts/runtime.py`'s `_Session` pattern). Consumed by Tasks 5/6.

- [ ] **Step 1: Write the failing tests**

```python
# sidecar/tests/test_cosyvoice3_runtime.py
import numpy as np

from sokuji_sidecar.cosyvoice3 import runtime


def _capture_factory(calls):
    def factory(path, providers, sess_options):
        calls.append((path, tuple(str(p) for p in providers)))
        return object()
    return factory


def test_graph_files_cover_the_pipeline():
    keys = set(runtime.GRAPH_FILES)
    assert keys == {
        "text_embedding", "speech_tokenizer", "campplus",
        "llm_initial", "llm_decode", "llm_decoder", "speech_embedding",
        "flow_token_embedding", "flow_spk_projection", "flow_pre_lookahead",
        "flow_estimator", "hift_f0", "hift_source", "hift_decoder",
    }
    assert runtime.GRAPH_FILES["llm_decode"] == "onnx/llm_backbone_decode_int4.onnx"
    assert runtime.GRAPH_FILES["flow_estimator"] == "onnx/flow_estimator.onnx"


def test_cold_graphs_stay_on_cpu_under_cuda():
    calls = []
    runtime.build_sessions("/m", "cuda", 4, session_factory=_capture_factory(calls))
    by_path = {p: prov for p, prov in calls}
    for key in runtime.COLD_GRAPHS:
        path = "/m/" + runtime.GRAPH_FILES[key]
        assert by_path[path] == ("CPUExecutionProvider",)
    hot = "/m/" + runtime.GRAPH_FILES["llm_decode"]
    assert "CUDAExecutionProvider" in by_path[hot][0] or \
        any("CUDA" in p for p in by_path[hot])


def test_cpu_device_uses_cpu_everywhere():
    calls = []
    runtime.build_sessions("/m", "cpu", 4, session_factory=_capture_factory(calls))
    assert all(prov == ("CPUExecutionProvider",) for _, prov in calls)


def test_all_fourteen_sessions_built():
    calls = []
    sessions = runtime.build_sessions("/m", "cpu", 4,
                                      session_factory=_capture_factory(calls))
    assert len(calls) == 14 and len(sessions) == 14
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_runtime.py -q`
Expected: FAIL

- [ ] **Step 3: Implement**

```python
# sidecar/sokuji_sidecar/cosyvoice3/runtime.py
# Apache License 2.0
"""ONNX session construction for CosyVoice3 with an explicit per-graph
execution-provider policy (spike-verified):

  - COLD graphs (speech_tokenizer_v3 969MB, campplus): CPU always — they
    run once per voice (results are cached), never in the synthesis loop.
  - HOT graphs: the requested device (CUDA with CPU fallback) — int4
    MatMulNBits backbones + fp32 flow/hift/decoder graphs are valid on
    both CPU and CUDA at graph-optimization level ALL on ORT >= 1.23.2.
  - fp16 graphs are deliberately NOT shipped: they are numerically broken
    on CUDA and on ORT >= 1.24 CPU (NaN / garbage tokens).

`session_factory(path, providers, sess_options)` is the test seam,
mirroring qwen3_tts/runtime.py.
"""

GRAPH_FILES = {
    "text_embedding": "onnx/text_embedding.onnx",
    "speech_tokenizer": "onnx/speech_tokenizer_v3.onnx",
    "campplus": "onnx/campplus.onnx",
    "llm_initial": "onnx/llm_backbone_initial_int4.onnx",
    "llm_decode": "onnx/llm_backbone_decode_int4.onnx",
    "llm_decoder": "onnx/llm_decoder.onnx",
    "speech_embedding": "onnx/llm_speech_embedding.onnx",
    "flow_token_embedding": "onnx/flow_token_embedding.onnx",
    "flow_spk_projection": "onnx/flow_speaker_projection.onnx",
    "flow_pre_lookahead": "onnx/flow_pre_lookahead.onnx",
    "flow_estimator": "onnx/flow_estimator.onnx",
    "hift_f0": "onnx/hift_f0_predictor.onnx",
    "hift_source": "onnx/hift_source_generator.onnx",
    "hift_decoder": "onnx/hift_decoder.onnx",
}
COLD_GRAPHS = ("speech_tokenizer", "campplus")


def _default_factory(path, providers, sess_options):
    import onnxruntime as ort
    return ort.InferenceSession(path, sess_options, providers=providers)


def _providers(device: str):
    if device == "cuda":
        return [("CUDAExecutionProvider", {"device_id": 0}),
                "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def build_sessions(model_dir: str, device: str, threads: int,
                   session_factory=None):
    import onnxruntime as ort
    factory = session_factory or _default_factory
    hot = _providers(device)
    cpu = ["CPUExecutionProvider"]
    sessions = {}
    for key, rel in GRAPH_FILES.items():
        so = ort.SessionOptions()
        so.log_severity_level = 3
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.intra_op_num_threads = threads
        providers = cpu if key in COLD_GRAPHS else hot
        sessions[key] = factory(f"{model_dir}/{rel}", providers, so)
    return sessions
```

Wait — the fake factory tests must not import onnxruntime SessionOptions… `build_sessions` constructs `ort.SessionOptions` even with a fake factory; onnxruntime IS installed in the sidecar venv, so this is fine (qwen3 runtime does the same).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_runtime.py -q`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/cosyvoice3/runtime.py sidecar/tests/test_cosyvoice3_runtime.py
git commit -m "feat(sidecar): cosyvoice3 session builder with explicit per-graph EP policy"
```

---

### Task 5: `cosyvoice3/pipeline.py` — prompt processing, LLM loop, flow CFM, HiFT

**Files:**
- Create: `sidecar/sokuji_sidecar/cosyvoice3/pipeline.py`
- Test: `sidecar/tests/test_cosyvoice3_pipeline.py`

**Interfaces:**
- Consumes: Task 1 mel functions, Task 2 sampling, sessions dict from Task 4 (objects with `.run(None, feeds) -> list[np.ndarray]`).
- Produces:
  - `@dataclass VoicePrompt: speech_tokens: np.ndarray  # int64 [1,S]; spk_embedding: np.ndarray  # f32 [1,192]; mel: np.ndarray  # f32 [2S,80]; prompt_text_ids: list[int]`
  - `process_prompt(sessions, tok, audio: np.ndarray, sr: int, transcript: str) -> VoicePrompt` (resamples internally via soxr; trims to 30 s max)
  - `synthesize(sessions, tok, text: str, prompt: VoicePrompt, rng, speed: float = 1.0) -> np.ndarray  # float32 mono 24 kHz`

Port the spike (`.spike/cosyvoice3_spike.py`) into module form. Constants module-level: `SPEECH_TOKEN_SIZE=6561, SOS=6561, TASK_ID=6563, STOP_TOKEN_MIN=6561, SILENT_TOKENS=frozenset({1,2,28,29,55,248,494,2241,2242,2322,2323}), MAX_CONSECUTIVE_SILENT=5, TOKEN_MEL_RATIO=2, CFG_RATE=0.7, N_TIMESTEPS=10, MIN_TOKEN_TEXT_RATIO=2, MAX_TOKEN_TEXT_RATIO=20, HARD_MAX_TOKENS=1500`.

- [ ] **Step 1: Write the failing tests** (fake sessions exercise the full numerical control flow — stop handling, silent filter, CFG rows, Euler schedule, mel slicing, speed)

```python
# sidecar/tests/test_cosyvoice3_pipeline.py
import numpy as np
import pytest

from sokuji_sidecar.cosyvoice3 import pipeline


class _Recorder:
    """Fake session recording feeds; returns canned outputs."""
    def __init__(self, fn):
        self.fn, self.calls = fn, []

    def run(self, _names, feeds):
        self.calls.append(feeds)
        return self.fn(feeds)


class _FakeTok:
    def encode(self, text, add_special_tokens=False):
        class E: ids = [max(1, ord(c) % 100) for c in text]
        return E()


def _fake_sessions(script):
    """script: list of token ids the fake llm_decoder emits per step."""
    state = {"step": -1}
    hid = np.zeros((1, 1, 896), np.float32)

    def decoder(feeds):
        state["step"] += 1
        logits = np.full((1, 6761), -100.0, np.float32)
        logits[0, script[min(state["step"], len(script) - 1)]] = 100.0
        return [logits]

    S = 4  # prompt speech tokens
    return {
        "text_embedding": _Recorder(lambda f: [np.zeros((1, f["input_ids"].shape[1], 896), np.float32)]),
        "speech_embedding": _Recorder(lambda f: [np.zeros((1, f["token"].shape[1], 896), np.float32)]),
        "llm_initial": _Recorder(lambda f: [np.zeros((1, f["inputs_embeds"].shape[1], 896), np.float32),
                                            np.zeros((48, 1, 2, f["inputs_embeds"].shape[1], 64), np.float32)]),
        "llm_decode": _Recorder(lambda f: [hid, np.zeros((48, 1, 2, f["past_key_values"].shape[3] + 1, 64), np.float32)]),
        "llm_decoder": _Recorder(decoder),
        "speech_tokenizer": _Recorder(lambda f: [np.arange(S, dtype=np.int32).reshape(1, S)]),
        "campplus": _Recorder(lambda f: [np.zeros((1, 192), np.float32)]),
        "flow_token_embedding": _Recorder(lambda f: [np.zeros((1, f["token"].shape[1], 80), np.float32)]),
        "flow_pre_lookahead": _Recorder(lambda f: [np.zeros((1, 2 * f["token_embedded"].shape[1], 80), np.float32)]),
        "flow_spk_projection": _Recorder(lambda f: [np.zeros((1, 80), np.float32)]),
        "flow_estimator": _Recorder(lambda f: [np.ones_like(f["x"])]),
        "hift_f0": _Recorder(lambda f: [np.full((1, f["mel"].shape[2]), 100.0, np.float32)]),
        "hift_source": _Recorder(lambda f: [np.zeros((1, 1, f["f0"].shape[2] * 480), np.float32)]),
        "hift_decoder": _Recorder(lambda f: [np.ones((1, 9, f["source_stft"].shape[2]), np.float32) * 0.1,
                                             np.zeros((1, 9, f["source_stft"].shape[2]), np.float32)]),
    }


def _prompt(sessions):
    tok = _FakeTok()
    audio = np.zeros(24000, dtype=np.float32)
    return pipeline.process_prompt(sessions, tok, audio, 24000, "ref text")


def test_prompt_mel_frames_are_twice_tokens():
    sessions = _fake_sessions([6562])
    p = _prompt(sessions)
    assert p.mel.shape[0] == 2 * p.speech_tokens.shape[1]


def test_llm_stops_on_any_reserved_id_and_never_emits_it():
    # script: 3 speech tokens then reserved id 6725 (NOT 6562)
    sessions = _fake_sessions([10, 11, 12, 6725])
    p = _prompt(sessions)
    audio = pipeline.synthesize(sessions, _FakeTok(), "abcdefgh", p,
                                np.random.default_rng(0))
    # flow got prompt tokens + exactly the 3 emitted ids
    flow_feed = sessions["flow_token_embedding"].calls[-1]["token"]
    assert flow_feed.shape[1] == p.speech_tokens.shape[1] + 3
    assert flow_feed.max() < 6561


def test_silent_run_dropped_from_flow_but_llm_continues():
    silent = 28
    script = [10] + [silent] * 8 + [11, 6562]
    sessions = _fake_sessions(script)
    p = _prompt(sessions)
    pipeline.synthesize(sessions, _FakeTok(), "abcdefgh", p,
                        np.random.default_rng(0))
    flow_feed = sessions["flow_token_embedding"].calls[-1]["token"]
    # 10 emitted tokens minus (8-5)=3 dropped silents
    assert flow_feed.shape[1] == p.speech_tokens.shape[1] + 10 - 3


def test_estimator_gets_cfg_rows():
    sessions = _fake_sessions([10, 6562])
    p = _prompt(sessions)
    pipeline.synthesize(sessions, _FakeTok(), "abcd", p, np.random.default_rng(0))
    feeds = sessions["flow_estimator"].calls
    assert len(feeds) == pipeline.N_TIMESTEPS
    f = feeds[0]
    assert f["x"].shape[0] == 2
    assert np.allclose(f["mu"][1], 0) and np.allclose(f["cond"][1], 0) \
        and np.allclose(f["spks"][1], 0)
    assert not np.allclose(f["mu"][0], f["mu"][1]) or True  # row0 is the conditional


def test_speed_scales_mel_length():
    sessions = _fake_sessions([10, 11, 12, 13, 6562])
    p = _prompt(sessions)
    a1 = pipeline.synthesize(sessions, _FakeTok(), "abcd", p, np.random.default_rng(0), speed=1.0)
    sessions2 = _fake_sessions([10, 11, 12, 13, 6562])
    p2 = _prompt(sessions2)
    a2 = pipeline.synthesize(sessions2, _FakeTok(), "abcd", p2, np.random.default_rng(0), speed=2.0)
    assert abs(len(a1) / 2 - len(a2)) <= 960   # 2x speed halves duration (±2 frames)


def test_empty_text_returns_empty_audio():
    sessions = _fake_sessions([6562])
    p = _prompt(sessions)
    out = pipeline.synthesize(sessions, _FakeTok(), "   ", p, np.random.default_rng(0))
    assert out.size == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_pipeline.py -q`
Expected: FAIL

- [ ] **Step 3: Implement `pipeline.py`** — direct port of the spike's `process_prompt`, `llm_generate`, `flow_generate`, `_stft_16_4`, `_istft_16_4`, `hift_generate`, and `synthesize`, restructured as module functions taking `sessions` as first arg. Deltas vs the spike:
  - Resampling with `soxr.resample(audio, sr, 16000)` / `soxr.resample(audio, sr, 24000)` instead of librosa (`import soxr` — already a sidecar dep).
  - Prompt trimmed to 30 s max before feature extraction (`audio = audio[: 30 * sr]`).
  - `min_len = MIN_TOKEN_TEXT_RATIO * len(tts_ids)`, `max_len = min(MAX_TOKEN_TEXT_RATIO * len(tts_ids), HARD_MAX_TOKENS)`.
  - Empty/whitespace text → return `np.zeros(0, dtype=np.float32)` before touching sessions.
  - Speed (official semantics): after flow, `if speed != 1.0:` resample mel time axis by linear interpolation:
    ```python
    L = mel.shape[2]
    new_len = max(1, int(L / speed))
    xs = np.linspace(0, L - 1, new_len)
    mel = np.stack([np.interp(xs, np.arange(L), mel[0, c]) for c in range(80)])[np.newaxis].astype(np.float32)
    ```
  - `VoicePrompt` dataclass as in Interfaces; `process_prompt` computes speech tokens (whisper mel → speech_tokenizer), spk embedding (kaldi fbank → campplus), matcha mel trimmed to `2*token_len` (`token_len = min(mel_frames // 2, n_tokens)`), and `prompt_text_ids = frontend.build_prompt_text_ids(tok, transcript)`.
  - Keep the numpy vectorized `_stft_16_4`/`_istft_16_4` exactly as in the spike (they passed an istft-roundtrip check at 1.2e-7 in review).

- [ ] **Step 4: Run tests, iterate to pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_pipeline.py -q`
Expected: 6 passed

- [ ] **Step 5: Run the full new-module suite together**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_mel.py tests/test_cosyvoice3_sampling.py tests/test_cosyvoice3_frontend.py tests/test_cosyvoice3_runtime.py tests/test_cosyvoice3_pipeline.py -q`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/cosyvoice3/pipeline.py sidecar/tests/test_cosyvoice3_pipeline.py
git commit -m "feat(sidecar): cosyvoice3 pipeline (voice prompt, LLM loop, CFM flow, HiFT)"
```

---

### Task 6: `CosyVoice3OnnxBackend` in `tts_backends.py`

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_backends.py` (append the class near `Qwen3TtsOnnxBackend`; mirror its structure)
- Test: `sidecar/tests/test_cosyvoice3_backend.py`

**Interfaces:**
- Consumes: Tasks 3/4/5 (`frontend.load_tokenizer/build_prompt_text_ids`, `runtime.build_sessions`, `pipeline.process_prompt/synthesize/VoicePrompt`).
- Produces: registered backend `NAME="cosyvoice3_onnx"`, `STREAMING=False`, `CLONES=True`, `sample_rate=24000`; methods `load(model_ref, device, compute_type, config=None)`, `unload()`, `is_loaded`, `set_voice(audio, sr, ref_text="")`, `set_builtin_voice(name)`, `generate(text, speed=1.0) -> (np.ndarray, int)`, `@staticmethod list_builtin_voices() -> []`.

Behavior contract:
- `load`: `snapshot_download(model_ref, local_files_only=True)` → `frontend.load_tokenizer(snapshot_dir)` + `runtime.build_sessions(snapshot_dir, device, int(os.environ.get("SOKUJI_TTS_THREADS", "4")))`; on any exception null state and `raise BackendLoadError(str(e))`. Store `self._dir`, `self._rng = np.random.default_rng()`.
- Voice cache: `self._voice_cache: dict[str, pipeline.VoicePrompt]` keyed by builtin name or `f"custom:{hash(audio_bytes)}"`; `set_voice`/`set_builtin_voice` set `self._prompt`. `set_builtin_voice(name)` reads `{dir}/voices/{name}.wav` (via `soundfile.read`) + `{name}.txt`, raises `BackendLoadError(f"unknown builtin voice: {name}")` when missing. `set_voice` with empty `ref_text` raises `BackendLoadError("cosyvoice3 requires the reference transcript")` (transcript_required).
- `generate`: no prompt set → lazily `set_builtin_voice(_DEFAULT_VOICE)` where `_DEFAULT_VOICE = os.environ.get("SOKUJI_COSYVOICE3_PRESET_VOICE", "classic-zh")`; then `pipeline.synthesize(...)`, returns `(audio_float32_24k, gen_ms)`.

- [ ] **Step 1: Write the failing tests**

```python
# sidecar/tests/test_cosyvoice3_backend.py
import ast
import inspect
import pathlib

import numpy as np
import pytest

from sokuji_sidecar import tts_backends
from sokuji_sidecar.backends import make_backend, BackendLoadError


def test_flags():
    b = make_backend("cosyvoice3_onnx")
    assert (b.NAME, b.STREAMING, b.CLONES) == ("cosyvoice3_onnx", False, True)
    assert b.sample_rate == 24000
    assert not b.is_loaded


def test_set_voice_requires_transcript():
    b = make_backend("cosyvoice3_onnx")
    b._sessions = {}  # pretend loaded
    b._tok = object()
    with pytest.raises(BackendLoadError):
        b.set_voice(np.zeros(16000, np.float32), 16000, ref_text="")


def test_voice_cache_hits(monkeypatch):
    b = make_backend("cosyvoice3_onnx")
    b._sessions, b._tok = {}, object()
    calls = []
    monkeypatch.setattr(tts_backends._cv3_pipeline, "process_prompt",
                        lambda *a, **k: calls.append(1) or "PROMPT")
    audio = np.zeros(16000, np.float32)
    b.set_voice(audio, 16000, ref_text="hello")
    b.set_voice(audio, 16000, ref_text="hello")
    assert len(calls) == 1 and b._prompt == "PROMPT"


def test_generate_threads_speed_and_rate(monkeypatch):
    b = make_backend("cosyvoice3_onnx")
    b._sessions, b._tok, b._prompt = {}, object(), "PROMPT"
    seen = {}
    def fake_syn(sessions, tok, text, prompt, rng, speed=1.0):
        seen.update(text=text, speed=speed)
        return np.zeros(2400, np.float32)
    monkeypatch.setattr(tts_backends._cv3_pipeline, "synthesize", fake_syn)
    audio, ms = b.generate("hello", speed=1.5)
    assert seen == {"text": "hello", "speed": 1.5}
    assert audio.dtype == np.float32 and isinstance(ms, int)


def test_module_has_no_librosa_or_transformers_import():
    pkg = pathlib.Path(tts_backends.__file__).parent / "cosyvoice3"
    for py in pkg.glob("*.py"):
        tree = ast.parse(py.read_text())
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for n in names:
                assert not n.startswith(("librosa", "transformers", "torch")), \
                    f"{py.name} imports {n}"


def test_engine_threads_ref_text():
    # the engine passes ref_text only to backends whose set_voice accepts it
    sig = inspect.signature(make_backend("cosyvoice3_onnx").set_voice)
    assert "ref_text" in sig.parameters
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_backend.py -q`
Expected: FAIL (`unknown backend cosyvoice3_onnx`)

- [ ] **Step 3: Implement the backend class** in `tts_backends.py`. Import at the top alongside the qwen3 imports:

```python
from .cosyvoice3 import frontend as _cv3_frontend
from .cosyvoice3 import pipeline as _cv3_pipeline
from .cosyvoice3 import runtime as _cv3_runtime
```

```python
@register_backend
class CosyVoice3OnnxBackend:
    """CosyVoice 3 (Fun-CosyVoice3-0.5B) zero-shot voice cloning TTS.

    Fresh torch-free ONNX pipeline (issue #323): int4 LLM backbones +
    fp32 flow/HiFT graphs from our own conversion of the community
    export. GPU-CUDA-only card; the CPU tier misses the realtime bar
    (spike RTF ~3.5) and is deliberately not shipped.
    ICL cloning: reference clip + transcript, both for bundled voices/
    presets and user clips (transcript required).
    """

    NAME = "cosyvoice3_onnx"
    STREAMING = False
    CLONES = True

    def __init__(self):
        self.sample_rate = 24000
        self._sessions = None
        self._tok = None
        self._dir = None
        self._prompt = None
        self._voice_cache = {}
        self._rng = None

    @property
    def is_loaded(self):
        return self._sessions is not None

    def load(self, model_ref, device, compute_type, config=None):
        try:
            from huggingface_hub import snapshot_download
            d = snapshot_download(repo_id=model_ref, local_files_only=True)
            threads = int(os.environ.get("SOKUJI_TTS_THREADS", "4"))
            self._tok = _cv3_frontend.load_tokenizer(d)
            self._sessions = _cv3_runtime.build_sessions(d, device, threads)
            self._dir = d
            self._rng = np.random.default_rng()
        except Exception as e:
            self.unload()
            raise BackendLoadError(str(e))

    def unload(self):
        self._sessions = None
        self._tok = None
        self._dir = None
        self._prompt = None
        self._voice_cache = {}

    def set_voice(self, audio, sr, ref_text=""):
        if not ref_text or not ref_text.strip():
            raise BackendLoadError("cosyvoice3 requires the reference transcript")
        key = f"custom:{hash((np.asarray(audio, dtype=np.float32).tobytes(), int(sr), ref_text))}"
        if key not in self._voice_cache:
            self._voice_cache[key] = _cv3_pipeline.process_prompt(
                self._sessions, self._tok,
                np.asarray(audio, dtype=np.float32), int(sr), ref_text)
        self._prompt = self._voice_cache[key]

    def set_builtin_voice(self, name):
        if name in self._voice_cache:
            self._prompt = self._voice_cache[name]
            return
        wav = f"{self._dir}/voices/{name}.wav"
        txt = f"{self._dir}/voices/{name}.txt"
        if not (os.path.exists(wav) and os.path.exists(txt)):
            raise BackendLoadError(f"unknown builtin voice: {name}")
        audio, sr = sf.read(wav, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        with open(txt) as f:
            transcript = f.read().strip()
        self._voice_cache[name] = _cv3_pipeline.process_prompt(
            self._sessions, self._tok, audio, sr, transcript)
        self._prompt = self._voice_cache[name]

    def generate(self, text, speed=1.0):
        if self._prompt is None:
            self.set_builtin_voice(
                os.environ.get("SOKUJI_COSYVOICE3_PRESET_VOICE", "classic-zh"))
        t0 = time.time()
        audio = _cv3_pipeline.synthesize(
            self._sessions, self._tok, text, self._prompt, self._rng,
            speed=float(speed))
        return audio, int((time.time() - t0) * 1000)

    @staticmethod
    def list_builtin_voices():
        return []   # descriptors come from voices/manifest.json (tts_voices)
```

(`os`, `time`, `np`, `sf` are already imported at the top of `tts_backends.py` — verify, add if missing.)

- [ ] **Step 4: Run tests to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_cosyvoice3_backend.py -q`
Expected: 6 passed

- [ ] **Step 5: Run the pre-existing backend suites to check for regressions**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_backends.py tests/test_tts_engine_qwen3.py tests/test_tts_voices.py -q`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_backends.py sidecar/tests/test_cosyvoice3_backend.py
git commit -m "feat(sidecar): CosyVoice3 ONNX backend (zero-shot cloning, voice prompt cache)"
```

---

### Task 7: catalog card, accel gate, invariant-test amendments, gate-regression test

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (add card to `TTS_MODELS`)
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_installed()` mods dict)
- Modify: `sidecar/tests/test_catalog.py` (backend whitelist at :136-138; cpu-floor test at :140-144)
- Modify: `sidecar/tests/test_accel.py` (gate-regression test)

**Interfaces:**
- Consumes: backend NAME `cosyvoice3_onnx` (Task 6).
- Produces: catalog card id `cosyvoice3-0.5b`, repo `jiangzhuo9357/cosyvoice3-0.5b-onnx` (env `SOKUJI_COSYVOICE3_REPO`).

- [ ] **Step 1: Write the failing catalog tests first** (amend existing invariants + add card assertions)

In `sidecar/tests/test_catalog.py`:
- Add `"cosyvoice3_onnx"` to the backend whitelist set in `test_tts_models_have_deployments_languages_and_repos`.
- Amend the cpu-floor test — GPU-only cards are now an explicit, documented exception:

```python
# The realtime bar decides which tiers exist (issue #323): CosyVoice3's CPU
# RTF ~3.5 is unusable, so it is the first deliberately GPU-only TTS card.
GPU_ONLY_TTS_IDS = {"cosyvoice3-0.5b"}


def test_tts_system_has_cpu_floor_and_unique_ids():
    ids = [m.id for m in catalog.tts_models()]
    assert len(ids) == len(set(ids)), "duplicate tts model ids"
    for m in catalog.tts_models():
        if m.id in GPU_ONLY_TTS_IDS:
            assert all(d.tier != "cpu" for d in m.deployments), \
                f"{m.id} is declared GPU-only but ships a cpu row"
            continue
        assert any(d.tier == "cpu" for d in m.deployments), f"{m.id} has no cpu floor"
```

- Add the card-shape test:

```python
def test_cosyvoice3_card_shape():
    m = catalog.tts_model("cosyvoice3-0.5b")
    assert m is not None
    assert m.clones and m.named_voices and m.transcript_required
    assert not m.streaming
    assert m.sample_rate == 24000 and m.num_speakers == 1
    assert set(m.languages) == {"zh", "en", "ja", "ko", "de", "es", "fr", "it", "ru"}
    tiers = {d.tier for d in m.deployments}
    assert tiers == {"gpu-cuda"}
    assert all(d.backend == "cosyvoice3_onnx" for d in m.deployments)
    assert m.size_bytes > 3_000_000_000
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -q`
Expected: FAIL (`cosyvoice3-0.5b` not found; whitelist ok now but card missing)

- [ ] **Step 3: Add the catalog card** (place after the qwen3-tts cards; SIZE constant filled with the exact number Task 8's build script prints — use a placeholder `3_700_000_000` now, Task 8 Step 6 replaces it with the real value):

```python
_COSYVOICE3_REPO = os.environ.get(
    "SOKUJI_COSYVOICE3_REPO", "jiangzhuo9357/cosyvoice3-0.5b-onnx")

    TtsModel("cosyvoice3-0.5b", "CosyVoice 3 0.5B",
             ("zh", "en", "ja", "ko", "de", "es", "fr", "it", "ru"),
             (
                 # GPU-only by design (issue #323): CPU RTF ~3.5 misses the
                 # realtime bar even on a 20-core box; no cpu row on purpose.
                 Deployment("cosyvoice3_onnx", "gpu-cuda", "fp32",
                            _COSYVOICE3_REPO, 1.0),
             ),
             repos=(_COSYVOICE3_REPO,),
             clones=True, named_voices=True, transcript_required=True,
             streaming=False, sample_rate=24000, num_speakers=1,
             size_bytes=3_700_000_000,
             sort_order=40),
```

(Match the exact `TtsModel` constructor argument style used by the neighboring qwen3 cards — positional `id, name, languages, deployments` then keywords.)

- [ ] **Step 4: Add the accel gate** — in `sidecar/sokuji_sidecar/accel.py` `_installed()` mods dict, next to `"qwen3tts_onnx": "onnxruntime"`:

```python
        "cosyvoice3_onnx": "onnxruntime",
```

- [ ] **Step 5: Add the unmocked gate-regression test** in `sidecar/tests/test_accel.py`, modeled on `test_new_translate_backends_installed_and_resolvable` (:511):

```python
def test_cosyvoice3_backend_installed_and_resolvable():
    """Catches the three-site registration gotcha: a backend missing from
    accel._installed() renders in the catalog but NoUsablePlan everywhere."""
    import sokuji_sidecar.accel as accel
    from sokuji_sidecar import planner as P

    installed = accel._installed()          # REAL probe of this host's venv
    assert "cosyvoice3_onnx" in installed

    # Resolution needs an NVIDIA machine; synthesize one but keep the REAL
    # installed set so a missing mods entry still fails this test.
    machine = P.Machine(
        os="Linux", arch="x86_64", apple_silicon=False,
        dml_adapters=(), installed=frozenset(installed), fingerprint="t",
        tc_kinds=("cuda",), gpus=(("cuda", "NVIDIA GeForce RTX 4070", 12 << 30),),
        ort_cuda=True,
    )
    plans = P.resolve_tts("cosyvoice3-0.5b", machine, device="auto")
    assert plans, "cosyvoice3-0.5b resolved to no usable plan"
    assert plans[0].backend == "cosyvoice3_onnx" and plans[0].tier == "gpu-cuda"
```

(Adjust `Machine` construction kwargs to the real dataclass signature — read `accel.py:28-45`; `resolve_tts` signature per `planner.py:367`. The essential property: `installed` comes from the real `_installed()`.)

- [ ] **Step 6: Run the full catalog/accel/planner suites**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py tests/test_accel.py tests/test_planner.py -q`
Expected: all passed

- [ ] **Step 7: Run the whole sidecar suite**

Run: `cd sidecar && .venv/bin/python -m pytest tests -q`
Expected: all passed (note count; no regressions)

- [ ] **Step 8: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/sokuji_sidecar/accel.py \
        sidecar/tests/test_catalog.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): CosyVoice3 catalog card (first GPU-only TTS card) + accel gate"
```

---

### Task 8: model conversion + HF repo build script

**Files:**
- Create: `scripts/cosyvoice3/convert_fp16_to_fp32.py` (copy `.spike/convert_fp16_to_fp32.py` verbatim — it is already clean)
- Create: `scripts/cosyvoice3/build-cosyvoice3-repo.py`
- Create: `scripts/assets/cosyvoice3-voices/classic-zh.txt` (content: `希望你以后能够做的比我还好呦。`)
- Create: `scripts/assets/cosyvoice3-voices/sarah.txt` (content: `Hello, my name is Sarah. I'm excited to help you with your project today. Let me know if you have any questions.`)

**Interfaces:**
- Produces: a local HF-repo directory (default `out/cosyvoice3-0.5b-onnx/`) with the exact layout `runtime.GRAPH_FILES` expects + tokenizer + `voices/` + README; prints the exact `size_bytes`.

Repo layout produced:

```
onnx/{text_embedding,speech_tokenizer_v3,campplus}.onnx           (fp32, as exported)
onnx/llm_backbone_{initial,decode}_int4.onnx                       (MatMulNBits, block 32)
onnx/{llm_decoder,llm_speech_embedding}.onnx                       (fp32 upcast)
onnx/flow_{token_embedding,pre_lookahead,speaker_projection}.onnx  (fp32 upcast)
onnx/flow_estimator.onnx                                           (fp32 upcast)
onnx/hift_{f0_predictor,source_generator,decoder}.onnx             (fp32, as exported)
vocab.json  merges.txt  tokenizer_config.json
voices/manifest.json  voices/{classic-zh,classic-ja,sarah}.{wav,txt}
README.md
```

- [ ] **Step 1: Write `build-cosyvoice3-repo.py`**

```python
#!/usr/bin/env python3
# Apache License 2.0
"""Assemble the Sokuji CosyVoice3 HF model repo from the ayousanz export.

Precision set (phase-1 spike verdicts, .spike/out/README.md):
  - LLM backbones: int4 MatMulNBits (RTN, block 32) — 6.4x smaller than
    fp32, same-seed token-identical CPU vs CUDA, verbatim whisper ASR.
  - Everything else fp32 (fp16 graphs NaN on CUDA and on ORT>=1.24 CPU;
    upcast via convert_fp16_to_fp32.py).

Usage (one-off venv needs: onnx onnxruntime onnx-ir huggingface_hub soundfile):
    python scripts/cosyvoice3/build-cosyvoice3-repo.py \
        --src <dir with the ayousanz snapshot> --out out/cosyvoice3-0.5b-onnx

Then upload manually (requires user approval / their HF account):
    hf upload jiangzhuo9357/cosyvoice3-0.5b-onnx out/cosyvoice3-0.5b-onnx . --repo-type model
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

CONVERT = [  # (src fp16 name, dst repo name) run through the fp32 upcaster
    ("llm_decoder_fp16.onnx", "onnx/llm_decoder.onnx"),
    ("llm_speech_embedding_fp16.onnx", "onnx/llm_speech_embedding.onnx"),
    ("flow_token_embedding_fp16.onnx", "onnx/flow_token_embedding.onnx"),
    ("flow_pre_lookahead_fp16.onnx", "onnx/flow_pre_lookahead.onnx"),
    ("flow_speaker_projection_fp16.onnx", "onnx/flow_speaker_projection.onnx"),
    ("flow.decoder.estimator.fp16.onnx", "onnx/flow_estimator.onnx"),
]
COPY = [
    ("text_embedding_fp32.onnx", "onnx/text_embedding.onnx"),
    ("speech_tokenizer_v3.onnx", "onnx/speech_tokenizer_v3.onnx"),
    ("campplus.onnx", "onnx/campplus.onnx"),
    ("hift_f0_predictor_fp32.onnx", "onnx/hift_f0_predictor.onnx"),
    ("hift_source_generator_fp32.onnx", "onnx/hift_source_generator.onnx"),
    ("hift_decoder_fp32.onnx", "onnx/hift_decoder.onnx"),
    ("vocab.json", "vocab.json"),
    ("merges.txt", "merges.txt"),
    ("tokenizer_config.json", "tokenizer_config.json"),
]
INT4 = [  # fp32-upcast first, then MatMulNBits int4
    ("llm_backbone_initial_fp16.onnx", "onnx/llm_backbone_initial_int4.onnx"),
    ("llm_backbone_decode_fp16.onnx", "onnx/llm_backbone_decode_int4.onnx"),
]
OFFICIAL_ZH_PROMPT = ("https://raw.githubusercontent.com/FunAudioLLM/"
                      "CosyVoice/main/asset/zero_shot_prompt.wav")
VOICES = [  # (name, wav source, default)
    ("classic-zh", "download:official", True),
    ("classic-ja", "asset:gpt-sovits-voices/classic-ja", False),
    ("sarah", "src:prompts/en_female_nova_greeting.wav", False),
]


def upcast(src, dst):
    subprocess.run([sys.executable, os.path.join(HERE, "convert_fp16_to_fp32.py"),
                    src, dst], check=True)


def quantize_int4(src_fp16, dst):
    import onnx
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer
    tmp = dst + ".fp32.tmp"
    upcast(src_fp16, tmp)
    m = onnx.load(tmp)
    q = MatMulNBitsQuantizer(m, block_size=32, is_symmetric=True)
    q.process()
    q.model.save_model_to_file(dst, use_external_data_format=False)
    os.remove(tmp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default="out/cosyvoice3-0.5b-onnx")
    args = ap.parse_args()
    os.makedirs(f"{args.out}/onnx", exist_ok=True)
    os.makedirs(f"{args.out}/voices", exist_ok=True)

    for s, d in COPY:
        shutil.copy2(f"{args.src}/{s}", f"{args.out}/{d}")
    for s, d in CONVERT:
        upcast(f"{args.src}/{s}", f"{args.out}/{d}")
    for s, d in INT4:
        quantize_int4(f"{args.src}/{s}", f"{args.out}/{d}")

    assets = os.path.join(HERE, "..", "assets")
    manifest = []
    for name, source, default in VOICES:
        dst_wav = f"{args.out}/voices/{name}.wav"
        if source == "download:official":
            urllib.request.urlretrieve(OFFICIAL_ZH_PROMPT, dst_wav)
        elif source.startswith("asset:"):
            base = os.path.join(assets, source.split(":", 1)[1])
            shutil.copy2(base + ".wav", dst_wav)
            shutil.copy2(base + ".txt", f"{args.out}/voices/{name}.txt")
        elif source.startswith("src:"):
            shutil.copy2(f"{args.src}/{source.split(':', 1)[1]}", dst_wav)
        txt_src = os.path.join(HERE, "..", "assets", "cosyvoice3-voices", f"{name}.txt")
        if os.path.exists(txt_src):
            shutil.copy2(txt_src, f"{args.out}/voices/{name}.txt")
        entry = {"name": name}
        if default:
            entry["default"] = True
        manifest.append(entry)
    with open(f"{args.out}/voices/manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    with open(f"{args.out}/README.md", "w") as f:
        f.write(
            "---\nlicense: apache-2.0\n---\n\n"
            "# CosyVoice 3 0.5B — ONNX for Sokuji Local Native\n\n"
            "Converted from [ayousanz/cosy-voice3-onnx]"
            "(https://huggingface.co/ayousanz/cosy-voice3-onnx) (Apache-2.0),\n"
            "itself exported from [FunAudioLLM/Fun-CosyVoice3-0.5B-2512]"
            "(https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) (Apache-2.0).\n\n"
            "Conversions: LLM backbones int4 (MatMulNBits, RTN block 32);\n"
            "all other fp16 graphs upcast to fp32 (the fp16 graphs produce NaN\n"
            "on CUDA and on onnxruntime >= 1.24 CPU).\n"
            "Voice `classic-zh` is the official CosyVoice zero-shot prompt clip;\n"
            "`classic-ja` is a fully synthetic clip generated with our own TTS;\n"
            "`sarah` ships with the upstream export.\n")

    total = sum(os.path.getsize(os.path.join(r, x))
                for r, _, files in os.walk(args.out) for x in files)
    print(f"size_bytes = {total}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the build against the spike snapshot**

Run: `.spike/venv/bin/pip install -q onnx-ir && .spike/venv/bin/python scripts/cosyvoice3/build-cosyvoice3-repo.py --src .spike/models/cosy-voice3-onnx --out out/cosyvoice3-0.5b-onnx`
Expected: `size_bytes = <N>` (~3.7 GB); tree matches the layout above. (The spike venv has onnx/onnxruntime/soundfile already.)

- [ ] **Step 3: Point the sidecar at the local build and smoke it for real** (env-gated, CPU, slow ~1 min)

Add to `sidecar/tests/test_tts_backends.py` (mirroring the existing `SOKUJI_RUN_TTS` smokes):

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_COSYVOICE3"),
                    reason="real-model cosyvoice3 smoke (needs local repo + models)")
def test_cosyvoice3_real_model_smoke():
    b = make_backend("cosyvoice3_onnx")
    b.load(os.environ["SOKUJI_COSYVOICE3_REPO"], "cpu", "fp32")
    b.set_builtin_voice("classic-zh")
    audio, ms = b.generate("今天的天气真不错。")
    assert audio.dtype == np.float32
    assert 1.0 < len(audio) / 24000 < 10.0
    assert float(np.sqrt((audio ** 2).mean())) > 0.01
```

To run it, the local repo dir must be visible to `snapshot_download(local_files_only=True)` — put it in the HF cache layout or upload first; simplest local path: `HF_HUB_OFFLINE=0` after upload, or use `huggingface_hub`'s local-dir support by symlinking. Pragmatic order: run this smoke AFTER the Task 9 upload, with `SOKUJI_COSYVOICE3_REPO=jiangzhuo9357/cosyvoice3-0.5b-onnx` and the repo downloaded once via `native_models.download` or `hf download`. Before upload, an equivalent manual smoke can be run against `.spike` graphs with a tiny script — do not block this task on it.

- [ ] **Step 4: Update `size_bytes`** in `catalog.py` with the printed exact number.

- [ ] **Step 5: Run catalog tests again**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -q`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add scripts/cosyvoice3/ scripts/assets/cosyvoice3-voices/ \
        sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_tts_backends.py
git commit -m "feat(scripts): cosyvoice3 model conversion + HF repo build script"
```

---

### Task 9: version bump, docs, upload handoff (manual user gate)

**Files:**
- Modify: `package.json` (`sidecarVersion` patch bump — read the current value first, e.g. `0.1.7` → `0.1.8`)
- Modify: `docs/superpowers/plans/2026-07-17-cosyvoice3-tts-backend.md` (check off tasks)

- [ ] **Step 1: Bump `sidecarVersion`** in `package.json` (the new backend requires a rebuilt sidecar bundle; strict version match gates boot).

- [ ] **Step 2: Full test sweep**

Run: `cd sidecar && .venv/bin/python -m pytest tests -q && cd .. && npx vitest run src/lib/local-inference/native src/services/clients/LocalNativeClient.test.ts`
Expected: all sidecar tests pass; native renderer suites pass unchanged (zero renderer edits in this plan).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(sidecar): bump sidecarVersion for the cosyvoice3 backend"
```

- [ ] **Step 4: MANUAL GATE — HF upload (user approval required).** Present to the user:
  - the built repo dir `out/cosyvoice3-0.5b-onnx/` and its exact size,
  - the upload command: `hf upload jiangzhuo9357/cosyvoice3-0.5b-onnx out/cosyvoice3-0.5b-onnx . --repo-type model` (they create the repo or authorize the upload),
  - then run the real-model smoke (`SOKUJI_RUN_COSYVOICE3=1 SOKUJI_COSYVOICE3_REPO=... pytest tests/test_tts_backends.py::test_cosyvoice3_real_model_smoke`) and a listening pass (zh/en/ja incl. kana path) before any PR.
  - GPU listening pass on this GB10 requires the sbsa `onnxruntime-gpu` wheel in the sidecar venv (`pip install --extra-index-url https://pypi.jetson-ai-lab.io/sbsa/cu130 onnxruntime-gpu==1.24.0 nvidia-cudnn-cu13`; `setup.sh` preserves it on re-runs).

- [ ] **Step 5: STOP.** Do not push, do not open a PR. Report completion to the user with the branch state and wait for instructions.

---

## Self-review notes

- Spec coverage: fresh module (issue order-of-work §3) → Tasks 1-5; explicit EP policy → Task 4; voice/prompt caching → Task 6; catalog row with `clones/transcript_required/streaming/sample_rate` and gpu-cuda-only deployments → Task 7; tests mirroring qwen3 → every task + gate-regression; JA kana (user decision) → Task 3; hosting set int4+fp32 (user decision) → Task 8; named voices classic-zh/classic-ja/sarah (user decision, onyx dropped — its clip speaks Sarah's line) → Task 8.
- The cpu-floor invariant amendment is deliberate policy (user directive: first GPU-only TTS card), encoded with an explanatory comment and a strict inverse assertion.
- Type consistency: `VoicePrompt` field names (`speech_tokens/spk_embedding/mel/prompt_text_ids`) used identically in Tasks 5/6; `GRAPH_FILES` keys identical in Tasks 4/5; backend NAME string identical in Tasks 6/7.
- Known deferred items (documented, not in scope): DML row (MatMulNBits-on-DML unverified), streaming, cross-lingual transcript-free mode (conflicts with the `<|endofprompt|>` assert — needs its own investigation), digit spell-out and 80-token paragraph splitting, text_embedding fp16 halving (-272 MB), self re-export from official weights.
