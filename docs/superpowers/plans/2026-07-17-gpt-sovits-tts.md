# GPT-SoVITS TTS (issue #322) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GPT-SoVITS (v2ProPlus) as a Local Native TTS card running torch-free through a vendored, slimmed Genie-TTS ONNX runtime, with both `cpu` and `gpu-cuda` deployment tiers.

**Architecture:** Vendor only Genie-TTS 2.0.2's compute core (inference loop, reference processing, G2P, text splitter) into `sidecar/sokuji_sidecar/gpt_sovits/` — no threads, no global singletons, no env magic, single session set with per-call language (Genie's per-character session duplication cost 3× RAM for nothing we need). Model artifacts are published as fp16 bins + fp32 graphs; a numpy-only expansion step at load time produces the fp32 bins that stock ORT external-data loading resolves natively — the `onnx` package is NOT needed at runtime. Backend follows the Qwen3-TTS pattern (single HF repo with subdirs, refText ICL cloning); CUDA provider handling follows the MOSS pattern (`get_providers()` assertion so `load_measured` does honest fallback).

**Tech Stack:** Python 3.12, onnxruntime (already per-SKU in sidecar), numpy, soxr, soundfile, tokenizers (all already in sidecar requirements). New deps: jieba, pypinyin, g2pM, nltk, pyopenjtalk-plus (+ its sudachi transitives).

## Global Constraints

- `sidecar/.venv` stays torch-free (hard rule). The Genie converter (torch) is one-off/offline only and never enters the sidecar tree.
- All code comments, commit messages, and GitHub artifacts in English; conventional commits.
- No `git push`, no PR creation, no HF uploads, no issue comments without explicit per-action user approval.
- Vendored code keeps upstream MIT attribution: every vendored file gets a provenance header; a LICENSE copy lands in `gpt_sovits/`.
- Torch-free import gate: nothing under `sidecar/sokuji_sidecar/` may import `torch`, `librosa`, or `transformers` (AST-tested like `test_tts_backends_no_librosa_or_transformers_import`).
- Vendor source of truth: the installed wheel copy at `.spike/venv/lib/python3.12/site-packages/genie_tts/` (verify `genie_tts-2.0.2.dist-info` exists before copying).
- Dev venv for tests: run `npm run sidecar:setup -- --no-models` once (creates `sidecar/.venv`); all pytest commands below use `sidecar/.venv/bin/python -m pytest`.
- Card decisions locked by user (2026-07-17): ja G2P ships WITH sudachi dict (quality TODO noted); RoBERTa ships with the card; fp16-publish + install-time numpy expansion; `gpu-cuda` + `cpu` tiers both ship now; jieba_fast → pure-python jieba.
- Model measured facts (GB10): sample rate 32000; CPU RTF ~0.6, CUDA RTF ~0.2; known upstream bugs: "嗯。" crashes zh G2P (we fix it in the vendored copy), idx==0 AR slice returns whole prompt (we guard it).

---

### Task 1: Vendor the G2P tree + text frontend (with the 嗯-crash fix and jieba swap)

**Files:**
- Create: `sidecar/sokuji_sidecar/gpt_sovits/__init__.py`
- Create: `sidecar/sokuji_sidecar/gpt_sovits/LICENSE` (copy of Genie-TTS MIT text)
- Create: `sidecar/sokuji_sidecar/gpt_sovits/assets.py` (replaces genie's env-driven `Core/Resources.py`)
- Create (vendored copies, then edited): `sidecar/sokuji_sidecar/gpt_sovits/g2p/` ← `genie_tts/G2P/` (SymbolsV2.py, Chinese/, English/, Japanese/)
- Create (vendored): `sidecar/sokuji_sidecar/gpt_sovits/text_splitter.py` ← `genie_tts/Utils/TextSplitter.py`
- Create (vendored, adapted): `sidecar/sokuji_sidecar/gpt_sovits/text.py` ← `genie_tts/GetPhonesAndBert.py`
- Modify: `sidecar/requirements.txt` (add 5 pinned deps)
- Test: `sidecar/tests/test_gpt_sovits_g2p.py`

**Interfaces:**
- Produces: `gpt_sovits.assets.configure(chinese_g2p_dir: str, english_g2p_dir: str) -> None` and `gpt_sovits.assets.chinese_g2p_dir() / english_g2p_dir() -> str` (raise `RuntimeError` if unconfigured).
- Produces: `gpt_sovits.text.get_phones_and_bert(text: str, language: str, roberta=None) -> tuple[np.ndarray, np.ndarray]` where `language ∈ {"chinese","english","japanese"}` and `roberta` is an optional `(session, tokenizer)` tuple (None → zero BERT features, shape `(len(phones), 1024)`).
- Produces: `gpt_sovits.text_splitter.TextSplitter` (unchanged upstream API: `feed(chunk) -> list[str]`, `flush() -> list[str]`, `__init__(max_len=40, min_len=5)`).

- [ ] **Step 1: Provision dev venv and verify vendor source**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react/.claude/worktrees/feat+gpt-sovits-tts
npm run sidecar:setup -- --no-models
ls .spike/venv/lib/python3.12/site-packages/genie_tts-2.0.2.dist-info
```
Expected: dist-info dir exists (vendor source verified at 2.0.2).

- [ ] **Step 2: Add new deps to `sidecar/requirements.txt`** (append after the `soxr` line, keeping the file's pin style):

```
# GPT-SoVITS (vendored Genie-TTS runtime) G2P dependencies — issue #322.
# jieba (pure python) replaces upstream's jieba_fast: identical API surface
# (posseg.lcut / cut_for_search / setLogLevel), no C build on aarch64.
jieba==0.42.1
pypinyin==0.55.0
g2pM==0.1.2.5
nltk==3.10.0
# ja G2P. Pulls sudachipy + sudachidict_core (~212MB) — kept deliberately
# (kanji homograph readings); quality follow-up tracked in issue #322.
pyopenjtalk-plus==0.4.1.post8
```

Then install into the dev venv:
```bash
sidecar/.venv/bin/pip install jieba==0.42.1 pypinyin==0.55.0 g2pM==0.1.2.5 nltk==3.10.0 pyopenjtalk-plus==0.4.1.post8
```

- [ ] **Step 3: Copy the vendored files**

```bash
SRC=.spike/venv/lib/python3.12/site-packages/genie_tts
DST=sidecar/sokuji_sidecar/gpt_sovits
mkdir -p $DST/g2p
cp -r $SRC/G2P/Chinese $DST/g2p/chinese
cp -r $SRC/G2P/English $DST/g2p/english
cp -r $SRC/G2P/Japanese $DST/g2p/japanese
cp $SRC/G2P/SymbolsV2.py $DST/g2p/symbols_v2.py
cp $SRC/Utils/TextSplitter.py $DST/text_splitter.py
cp $SRC/GetPhonesAndBert.py $DST/text.py
touch $DST/__init__.py $DST/g2p/__init__.py
```
Fetch the upstream MIT license text into `$DST/LICENSE` (from the genie-tts wheel METADATA or https://github.com/High-Logic/Genie-TTS — it is MIT; if offline, write the standard MIT text with "Copyright (c) High-Logic (Genie-TTS)").

- [ ] **Step 4: Add provenance headers**

Prepend to every vendored `.py` file (adjust the original path per file):
```python
# Vendored from Genie-TTS 2.0.2 (MIT, https://github.com/High-Logic/Genie-TTS),
# original path: genie_tts/G2P/Chinese/ChineseG2P.py. Local modifications are
# marked with "SOKUJI:" comments. See gpt_sovits/LICENSE.
```

- [ ] **Step 5: Write `assets.py`** (new file, full content):

```python
"""Explicit asset-path configuration for the vendored GPT-SoVITS runtime.

Replaces upstream genie_tts.Core.Resources, which resolved paths from env vars
at import time (and blocked on stdin if they were missing). Here the backend
calls configure() with directories inside the downloaded HF snapshot before
any G2P module is imported.
"""
from __future__ import annotations

_chinese_g2p_dir: str | None = None
_english_g2p_dir: str | None = None


def configure(chinese_g2p_dir: str, english_g2p_dir: str) -> None:
    global _chinese_g2p_dir, _english_g2p_dir
    _chinese_g2p_dir = chinese_g2p_dir
    _english_g2p_dir = english_g2p_dir


def _require(value: str | None, name: str) -> str:
    if value is None:
        raise RuntimeError(
            f"gpt_sovits.assets.{name} used before configure() — the backend "
            "must call configure() with the snapshot's G2P dirs first")
    return value


def chinese_g2p_dir() -> str:
    return _require(_chinese_g2p_dir, "chinese_g2p_dir")


def english_g2p_dir() -> str:
    return _require(_english_g2p_dir, "english_g2p_dir")
```

- [ ] **Step 6: Rewire vendored imports**

In every vendored file, apply these mechanical rewrites (grep each pattern to find all sites; original tree is flat genie-relative):
1. `from ..Core.Resources import Chinese_G2P_DIR` (in `g2p/chinese/ChineseG2P.py`) → `from ...gpt_sovits import assets` + replace each use of `Chinese_G2P_DIR` with `assets.chinese_g2p_dir()`. Same for `English_G2P_DIR` in `g2p/english/EnglishG2P.py` → `assets.english_g2p_dir()`.
2. `import jieba_fast as jieba` / `import jieba_fast.posseg as psg` / `from jieba_fast import ...` (in `g2p/chinese/ChineseG2P.py` and `g2p/chinese/ToneSandhi.py`) → same statements with `jieba_fast` → `jieba`. Mark each with `# SOKUJI: jieba_fast -> pure-python jieba (identical API)`.
3. `from ..SymbolsV2 import ...` → `from ..symbols_v2 import ...`; any `from .G2P...`-style absolute genie paths → relative paths within `gpt_sovits/g2p/`.
4. `text.py`: its lazy imports `from .G2P.Chinese.ChineseG2P import chinese_to_phones` etc. → `from .g2p.chinese.ChineseG2P import chinese_to_phones`, `from .g2p.english.EnglishG2P import english_to_phones`, `from .g2p.japanese.JapaneseG2P import japanese_to_phones` (keep them lazy, inside the function bodies).
5. `text.py`: replace its `model_manager.load_roberta_model()` coupling with the explicit parameter — new signature `get_phones_and_bert(text, language, roberta=None)` where the zh branch uses `roberta` if not None (session.run with `input_ids`/`attention_mask`/`repeats` exactly as upstream) else the existing zeros fallback. Keep `BERT_FEATURE_DIM = 1024` as a local constant (upstream `Utils/Constants.py:1`).
6. Delete any `import logging`-side `logging.basicConfig` calls and `warnings.filterwarnings` in vendored files (they were in `Internal.py`, but grep the vendored set to be sure).

- [ ] **Step 7: Fix the 嗯 crash in `g2p/chinese/ToneSandhi.py`**

Upstream bug (spike-verified): vowel-less syllabic nasals (嗯/呣/唔) produce empty finals strings; `_merge_continuous_three_tones` and `_merge_continuous_three_tones_2` index `[-1][-1]` into them and raise IndexError. Guard both loops. Find (in `_merge_continuous_three_tones_2`, and the analogous line in `_merge_continuous_three_tones`):

```python
                and sub_finals_list[i - 1][-1][-1] == "3"
```

Rewrite each affected condition to skip empty entries. In both functions, insert immediately before the condition that indexes `[-1][-1]`:

```python
            # SOKUJI: syllabic nasals (嗯/呣/唔) have empty finals — upstream
            # indexes [-1][-1] into them and crashes (IndexError). Skip merging
            # around empty-final syllables instead.
            if not sub_finals_list[i - 1] or not sub_finals_list[i - 1][-1] \
                    or not sub_finals_list[i][-1] if isinstance(sub_finals_list[i], list) else False:
                continue
```

NOTE to implementer: the exact guard must match the local variable shapes in each function (read the surrounding 10 lines; the invariant to enforce is "never apply `[-1]` to an empty string/list"). Write the failing test FIRST (Step 8) and shape the guard until the full-pipeline test passes; the snippet above is directional, the test is the spec.

- [ ] **Step 8: Write the tests** — `sidecar/tests/test_gpt_sovits_g2p.py` (full content):

```python
"""G2P tests for the vendored GPT-SoVITS runtime.

Asset-dependent tests (zh/en need dict files from the model card) are gated on
SOKUJI_GPT_SOVITS_ASSETS pointing at a local GenieData dir; ja is self-contained.
"""
import os

import pytest

ASSETS = os.environ.get("SOKUJI_GPT_SOVITS_ASSETS", "")
needs_assets = pytest.mark.skipif(
    not (ASSETS and os.path.isdir(os.path.join(ASSETS, "G2P", "ChineseG2P"))),
    reason="SOKUJI_GPT_SOVITS_ASSETS not set to a GenieData dir")


def _configure():
    from sokuji_sidecar.gpt_sovits import assets
    assets.configure(
        chinese_g2p_dir=os.path.join(ASSETS, "G2P", "ChineseG2P"),
        english_g2p_dir=os.path.join(ASSETS, "G2P", "EnglishG2P"),
    )


def test_assets_unconfigured_raises():
    import importlib
    from sokuji_sidecar.gpt_sovits import assets
    importlib.reload(assets)  # reset module state
    with pytest.raises(RuntimeError, match="configure"):
        assets.chinese_g2p_dir()


@needs_assets
def test_chinese_basic_sentence_produces_phones():
    _configure()
    from sokuji_sidecar.gpt_sovits.text import get_phones_and_bert
    seq, bert = get_phones_and_bert("今天天气不错。", "chinese")
    assert seq.size > 0
    assert bert.shape == (seq.size if seq.ndim == 1 else seq.shape[-1], 1024) or bert.shape[1] == 1024


@needs_assets
def test_chinese_syllabic_nasal_does_not_crash():
    # Upstream Genie-TTS 2.0.2 raises IndexError in ToneSandhi for 嗯 (spike
    # 2026-07-16, .spike/out/README.md). The vendored copy must not.
    _configure()
    from sokuji_sidecar.gpt_sovits.text import get_phones_and_bert
    for text in ("嗯。", "嗯", "嗯嗯。"):
        seq, _ = get_phones_and_bert(text, "chinese")
        assert seq.size > 0


@needs_assets
def test_english_basic_sentence_produces_phones():
    _configure()
    from sokuji_sidecar.gpt_sovits.text import get_phones_and_bert
    seq, bert = get_phones_and_bert("The meeting starts at three.", "english")
    assert seq.size > 0


def test_japanese_basic_sentence_produces_phones():
    # pyopenjtalk-plus is self-contained (bundled dict) — no assets needed.
    from sokuji_sidecar.gpt_sovits.text import get_phones_and_bert
    seq, bert = get_phones_and_bert("会議は三時からです。", "japanese")
    assert seq.size > 0


def test_zero_bert_fallback_shape_matches_phones():
    from sokuji_sidecar.gpt_sovits.text import get_phones_and_bert
    seq, bert = get_phones_and_bert("はい。", "japanese", roberta=None)
    assert bert.shape[-1] == 1024


def test_text_splitter_min_len_and_flush():
    from sokuji_sidecar.gpt_sovits.text_splitter import TextSplitter
    ts = TextSplitter(max_len=40, min_len=5)
    parts = ts.feed("短。这是一个足够长的句子，应当被切分出来。")
    parts += ts.flush()
    joined = "".join(parts)
    assert "足够长的句子" in joined
    assert all(p.strip() for p in parts)


def test_vendored_tree_is_torch_free():
    # AST gate: no vendored module may import torch/librosa/transformers.
    import ast, pathlib
    root = pathlib.Path(__file__).resolve().parents[1] / "sokuji_sidecar" / "gpt_sovits"
    banned = {"torch", "librosa", "transformers", "jieba_fast"}
    for py in root.rglob("*.py"):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for n in names:
                assert n.split(".")[0] not in banned, f"{py}: banned import {n}"
```

- [ ] **Step 9: Run the tests, iterate until green**

```bash
cd sidecar
SOKUJI_GPT_SOVITS_ASSETS=$(cd .. && pwd)/.spike/genie_assets/GenieData \
  .venv/bin/python -m pytest tests/test_gpt_sovits_g2p.py -v
```
Expected first run: FAIL (import errors / 嗯 IndexError) → fix per Steps 6-7 → all PASS (ja + splitter + AST tests must pass even without assets: re-run without the env var and expect skips, not failures).

- [ ] **Step 10: Run the whole sidecar suite to catch collateral damage**

```bash
cd sidecar && .venv/bin/python -m pytest tests/ -x -q
```
Expected: PASS (pre-existing suite untouched).

- [ ] **Step 11: Commit**

```bash
git add sidecar/sokuji_sidecar/gpt_sovits sidecar/requirements.txt sidecar/tests/test_gpt_sovits_g2p.py
git commit -m "feat(sidecar): vendor Genie-TTS G2P core for GPT-SoVITS (fixes syllabic-nasal crash, jieba_fast->jieba)"
```

---

### Task 2: Runtime — fp16 bin expansion + ORT session building with honest CUDA fallback

**Files:**
- Create: `sidecar/sokuji_sidecar/gpt_sovits/runtime.py`
- Test: `sidecar/tests/test_gpt_sovits_runtime.py`

**Interfaces:**
- Produces: `ensure_fp32_bins(dir_path: str) -> list[str]` — expands known fp16 bins in `dir_path` per `FP16_TO_FP32` table; idempotent (skips when the fp32 file exists with the expected 2× size); returns list of files written.
- Produces: `FP16_TO_FP32: dict[str, str]` = `{"t2s_shared_fp16.bin": "t2s_shared_fp32.bin", "vits_fp16.bin": "vits_fp32.bin", "prompt_encoder_fp16.bin": "prompt_encoder_fp32.bin", "chinese-hubert-base_weights_fp16.bin": "chinese-hubert-base_weights.bin"}` (fp32 names are what the shipped graphs' external-data entries reference — spike-verified byte-exact, including hubert's suffix-less name).
- Produces: `providers_for(device: str) -> list[str]` — `"cuda"` → `["CUDAExecutionProvider", "CPUExecutionProvider"]` (calls `ort.preload_dlls()` first if available, CUDA branch only, and raises `RuntimeError` if CUDA EP is not in `ort.get_available_providers()`); `"cpu"` → `["CPUExecutionProvider"]`; anything else → `RuntimeError`.
- Produces: `make_session(path: str, device: str) -> ort.InferenceSession` — builds SessionOptions (`intra_op_num_threads` from `SOKUJI_TTS_THREADS` default 4, `graph_optimization_level=ORT_ENABLE_ALL`, `log_severity_level=3`), creates the session, then **asserts the requested EP landed**: for `device=="cuda"`, `"CUDAExecutionProvider" in session.get_providers()` else `RuntimeError` (MOSS `_session` pattern, `moss_tts/ort_runtime.py:401-417`).
- Produces: `MODEL_GRAPHS: tuple[str, ...]` = `("t2s_encoder_fp32.onnx", "t2s_first_stage_decoder_fp32.onnx", "t2s_stage_decoder_fp32.onnx", "vits_fp32.onnx", "prompt_encoder_fp32.onnx")` and `build_model_sessions(model_dir: str, device: str) -> dict[str, ort.InferenceSession]` (keys = graph basenames; `prompt_encoder_fp32.onnx` optional → absent key when file missing, i.e. a plain-v2 model).

- [ ] **Step 1: Write the failing tests** — `sidecar/tests/test_gpt_sovits_runtime.py` (full content):

```python
import os

import numpy as np
import pytest

from sokuji_sidecar.gpt_sovits import runtime


def test_fp16_expansion_roundtrip(tmp_path):
    src = np.array([1.0, -0.5, 2.25, 0.0], dtype=np.float16)
    p16 = tmp_path / "vits_fp16.bin"
    src.tofile(p16)
    written = runtime.ensure_fp32_bins(str(tmp_path))
    p32 = tmp_path / "vits_fp32.bin"
    assert str(p32) in written and p32.exists()
    out = np.fromfile(p32, dtype=np.float32)
    np.testing.assert_array_equal(out, src.astype(np.float32))


def test_fp16_expansion_is_idempotent(tmp_path):
    np.zeros(8, dtype=np.float16).tofile(tmp_path / "t2s_shared_fp16.bin")
    first = runtime.ensure_fp32_bins(str(tmp_path))
    assert first
    mtime = os.path.getmtime(tmp_path / "t2s_shared_fp32.bin")
    second = runtime.ensure_fp32_bins(str(tmp_path))
    assert second == []
    assert os.path.getmtime(tmp_path / "t2s_shared_fp32.bin") == mtime


def test_fp16_expansion_rewrites_on_size_mismatch(tmp_path):
    np.zeros(8, dtype=np.float16).tofile(tmp_path / "vits_fp16.bin")
    (tmp_path / "vits_fp32.bin").write_bytes(b"garbage")
    written = runtime.ensure_fp32_bins(str(tmp_path))
    assert written  # stale/corrupt fp32 replaced
    assert (tmp_path / "vits_fp32.bin").stat().st_size == 8 * 4


def test_providers_for_cpu():
    assert runtime.providers_for("cpu") == ["CPUExecutionProvider"]


def test_providers_for_cuda_requires_available(monkeypatch):
    import onnxruntime as ort
    monkeypatch.setattr(ort, "get_available_providers",
                        lambda: ["CPUExecutionProvider"])
    with pytest.raises(RuntimeError, match="CUDA"):
        runtime.providers_for("cuda")


def test_providers_for_unknown_device():
    with pytest.raises(RuntimeError):
        runtime.providers_for("dml")


class _FakeSession:
    def __init__(self, path, sess_options=None, providers=None):
        self._providers = list(providers or [])
    def get_providers(self):
        # simulate ORT silently dropping CUDA (the issue-#277 class of bug)
        return ["CPUExecutionProvider"]


def test_make_session_raises_when_cuda_silently_drops(monkeypatch, tmp_path):
    import onnxruntime as ort
    monkeypatch.setattr(ort, "get_available_providers",
                        lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"])
    monkeypatch.setattr(ort, "InferenceSession", _FakeSession)
    (tmp_path / "m.onnx").write_bytes(b"")
    with pytest.raises(RuntimeError, match="CUDA"):
        runtime.make_session(str(tmp_path / "m.onnx"), "cuda")


class _HonestSession(_FakeSession):
    def get_providers(self):
        return self._providers


def test_build_model_sessions_optional_prompt_encoder(monkeypatch, tmp_path):
    import onnxruntime as ort
    monkeypatch.setattr(ort, "InferenceSession", _HonestSession)
    for g in ("t2s_encoder_fp32.onnx", "t2s_first_stage_decoder_fp32.onnx",
              "t2s_stage_decoder_fp32.onnx", "vits_fp32.onnx"):
        (tmp_path / g).write_bytes(b"")
    sessions = runtime.build_model_sessions(str(tmp_path), "cpu")
    assert set(sessions) == {"t2s_encoder_fp32.onnx", "t2s_first_stage_decoder_fp32.onnx",
                             "t2s_stage_decoder_fp32.onnx", "vits_fp32.onnx"}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd sidecar && .venv/bin/python -m pytest tests/test_gpt_sovits_runtime.py -v
```
Expected: FAIL ("No module named ...runtime").

- [ ] **Step 3: Write `runtime.py`** (full content):

```python
"""ORT session plumbing for the vendored GPT-SoVITS runtime.

Distribution scheme (spike-verified 2026-07-17, .spike/out/README.md): the HF
repo ships fp16 weight bins; the graphs' external-data entries already reference
the fp32 names with fp32-layout offsets, so a one-time numpy expansion at load
time lets stock ORT resolve the weights natively — no `onnx` package needed.
"""
from __future__ import annotations

import logging
import os

import numpy as np
import onnxruntime as ort

logger = logging.getLogger(__name__)

# fp16 bin -> fp32 name referenced by the shipped graphs (byte-exact 2x sizes;
# note hubert's target has no _fp32 suffix — that is what its graph references).
FP16_TO_FP32 = {
    "t2s_shared_fp16.bin": "t2s_shared_fp32.bin",
    "vits_fp16.bin": "vits_fp32.bin",
    "prompt_encoder_fp16.bin": "prompt_encoder_fp32.bin",
    "chinese-hubert-base_weights_fp16.bin": "chinese-hubert-base_weights.bin",
}

MODEL_GRAPHS = (
    "t2s_encoder_fp32.onnx",
    "t2s_first_stage_decoder_fp32.onnx",
    "t2s_stage_decoder_fp32.onnx",
    "vits_fp32.onnx",
    "prompt_encoder_fp32.onnx",  # v2ProPlus only — optional
)


def ensure_fp32_bins(dir_path: str) -> list[str]:
    """Expand known fp16 bins in dir_path to their fp32 twins. Idempotent."""
    written: list[str] = []
    for name16, name32 in FP16_TO_FP32.items():
        src = os.path.join(dir_path, name16)
        if not os.path.isfile(src):
            continue
        dst = os.path.join(dir_path, name32)
        want = os.path.getsize(src) * 2
        if os.path.isfile(dst) and os.path.getsize(dst) == want:
            continue
        logger.info("expanding %s -> %s (%d bytes)", name16, name32, want)
        np.fromfile(src, dtype=np.float16).astype(np.float32).tofile(dst)
        written.append(dst)
    return written


def providers_for(device: str) -> list[str]:
    if device == "cpu":
        return ["CPUExecutionProvider"]
    if device == "cuda":
        preload = getattr(ort, "preload_dlls", None)
        if callable(preload):  # CUDA-only: resolves cudnn/cublas pip wheels (spec D8)
            preload()
        if "CUDAExecutionProvider" not in ort.get_available_providers():
            raise RuntimeError(
                "CUDAExecutionProvider not available in this onnxruntime build")
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    raise RuntimeError(f"gpt_sovits_onnx: unsupported device {device!r}")


def make_session(path: str, device: str) -> ort.InferenceSession:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = int(os.environ.get("SOKUJI_TTS_THREADS", "4"))
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.log_severity_level = 3
    session = ort.InferenceSession(path, sess_options=opts,
                                   providers=providers_for(device))
    if device == "cuda" and "CUDAExecutionProvider" not in session.get_providers():
        # ORT can silently drop an EP at session creation (missing cuDNN etc.).
        # Fail loudly so load_measured falls back to the honest cpu plan.
        raise RuntimeError(
            f"CUDA EP silently dropped for {os.path.basename(path)}: "
            f"{session.get_providers()}")
    return session


def build_model_sessions(model_dir: str, device: str) -> dict[str, ort.InferenceSession]:
    sessions: dict[str, ort.InferenceSession] = {}
    for graph in MODEL_GRAPHS:
        path = os.path.join(model_dir, graph)
        if not os.path.isfile(path):
            if graph == "prompt_encoder_fp32.onnx":
                continue  # plain-v2 model
            raise FileNotFoundError(path)
        sessions[graph] = make_session(path, device)
    return sessions
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd sidecar && .venv/bin/python -m pytest tests/test_gpt_sovits_runtime.py -v
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/gpt_sovits/runtime.py sidecar/tests/test_gpt_sovits_runtime.py
git commit -m "feat(sidecar): GPT-SoVITS runtime — fp16 bin expansion + ORT sessions with honest CUDA fallback"
```

---

### Task 3: Compute core — reference processing + synthesis loop

**Files:**
- Create (vendored, adapted): `sidecar/sokuji_sidecar/gpt_sovits/reference.py` ← merge of `genie_tts/Audio/Audio.py` + `genie_tts/Audio/ReferenceAudio.py`
- Create (vendored, adapted): `sidecar/sokuji_sidecar/gpt_sovits/inference.py` ← `genie_tts/Core/Inference.py`
- Test: `sidecar/tests/test_gpt_sovits_inference.py`

**Interfaces:**
- Produces: `reference.Reference` dataclass: `audio_32k: np.ndarray (float32)`, `ssl_content: np.ndarray`, `prompt_text: str`, `prompt_language: str` (`"chinese"|"english"|"japanese"`).
- Produces: `reference.build_reference(audio: np.ndarray, sr: int, text: str, language: str, hubert_session) -> Reference` — resamples with soxr to 32k, appends 0.3s silence, warns outside 3-10s (upstream behavior), computes 16k track, runs hubert for `ssl_content`. Input is an in-memory float32 array (upstream took a file path — SOKUJI adaptation).
- Produces: `inference.Synthesizer(sessions: dict, sv_session, roberta)` with `synthesize(text: str, ref: Reference, language: str) -> np.ndarray | None` — the ported t2s+vits loop; returns float32 @32k or `None` when generation degenerates (idx==0 first-step stop, or empty semantic after EOS trim — both SOKUJI guards on spike-documented upstream hazards).

- [ ] **Step 1: Copy the two upstream sources for reference while porting**

```bash
SRC=.spike/venv/lib/python3.12/site-packages/genie_tts
sed -n '1,200p' $SRC/Audio/Audio.py $SRC/Audio/ReferenceAudio.py $SRC/Core/Inference.py
```
Port rather than copy verbatim: these files couple to genie's global `model_manager`/`context`/LRU cache, all of which are dropped.

- [ ] **Step 2: Write failing tests** — `sidecar/tests/test_gpt_sovits_inference.py` (full content):

```python
import numpy as np
import pytest

from sokuji_sidecar.gpt_sovits import inference, reference


class _FakeHubert:
    def run(self, _out, feeds):
        (name, wav16), = feeds.items()
        # ssl frames scale with input length (hubert stride 320 @16k)
        frames = max(1, wav16.shape[-1] // 320)
        return [np.zeros((1, 768, frames), dtype=np.float32)]
    def get_inputs(self):
        class _I: name = "input"
        return [_I()]


def test_build_reference_resamples_and_pads():
    sr = 24000
    audio = np.random.default_rng(0).standard_normal(sr * 4).astype(np.float32) * 0.1
    ref = reference.build_reference(audio, sr, "test transcript", "english", _FakeHubert())
    assert ref.audio_32k.dtype == np.float32
    # 4s content + 0.3s appended silence at 32k
    assert abs(ref.audio_32k.shape[-1] - int(4.3 * 32000)) < 3200
    assert ref.ssl_content.shape[0] == 1
    assert ref.prompt_text == "test transcript"


class _StopImmediatelyDecoder:
    """Stage decoder whose stop condition fires on the very first step."""
    def __init__(self):
        self.calls = 0
    def get_inputs(self):
        class _I:
            def __init__(self, name): self.name = name
        return [_I("y"), _I("y_emb"), _I("kv")]
    def run(self, _out, feeds):
        self.calls += 1
        y = feeds["y"]
        return [y, feeds["y_emb"], np.array(True), feeds["kv"]]


def test_synthesize_returns_none_when_ar_stops_at_step_zero(monkeypatch):
    # Upstream hazard (Inference.py y[:, -idx:] with idx==0 slices the WHOLE
    # sequence incl. prompt tokens -> vocoder replays the reference). The port
    # must return None instead so the backend can surface a clean error.
    syn = inference.Synthesizer.__new__(inference.Synthesizer)
    out = syn._slice_generated(np.zeros((1, 17), dtype=np.int64), idx=0)
    assert out is None


def test_slice_generated_returns_tail_for_positive_idx():
    syn = inference.Synthesizer.__new__(inference.Synthesizer)
    y = np.arange(10, dtype=np.int64).reshape(1, 10)
    out = syn._slice_generated(y, idx=3)
    assert out is not None
    np.testing.assert_array_equal(out.reshape(-1), np.array([7, 8, 9]))


def test_trim_semantic_empty_returns_none():
    syn = inference.Synthesizer.__new__(inference.Synthesizer)
    # first token is already EOS (>=1024) -> empty semantic -> None, not ref echo
    tokens = np.array([[1024, 5, 6]], dtype=np.int64)
    assert syn._trim_at_eos(tokens) is None


def test_trim_semantic_cuts_at_first_eos():
    syn = inference.Synthesizer.__new__(inference.Synthesizer)
    tokens = np.array([[5, 6, 1024, 7]], dtype=np.int64)
    out = syn._trim_at_eos(tokens)
    np.testing.assert_array_equal(out.reshape(-1), np.array([5, 6]))
```

- [ ] **Step 3: Run to verify failure**

```bash
cd sidecar && .venv/bin/python -m pytest tests/test_gpt_sovits_inference.py -v
```
Expected: FAIL (modules missing).

- [ ] **Step 4: Write `reference.py`** (port; full structure, hubert feed names must match the real graph — read them from the session's `get_inputs()` like upstream does):

```python
"""Reference-audio processing for GPT-SoVITS zero-shot cloning.

Ported from genie_tts Audio/Audio.py + Audio/ReferenceAudio.py (MIT, see
LICENSE). SOKUJI changes: input is an in-memory float32 array (the sidecar
receives raw PCM over the wire, not a file); no LRU cache (one active
reference); sessions are passed in explicitly.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import soxr

logger = logging.getLogger(__name__)


@dataclass
class Reference:
    audio_32k: np.ndarray
    ssl_content: np.ndarray
    prompt_text: str
    prompt_language: str


def build_reference(audio: np.ndarray, sr: int, text: str, language: str,
                    hubert_session) -> Reference:
    wav = np.asarray(audio, dtype=np.float32).reshape(-1)
    duration = wav.shape[0] / float(sr)
    if not 3.0 <= duration <= 10.0:
        logger.warning("reference clip is %.1fs; GPT-SoVITS works best with 3-10s",
                       duration)
    wav32 = soxr.resample(wav, sr, 32000) if sr != 32000 else wav
    wav32 = np.concatenate([wav32, np.zeros(int(0.3 * 32000), dtype=np.float32)])
    wav16 = soxr.resample(wav32, 32000, 16000)
    input_name = hubert_session.get_inputs()[0].name
    ssl_content = hubert_session.run(
        None, {input_name: wav16.reshape(1, -1)})[0]
    return Reference(audio_32k=wav32.reshape(1, -1), ssl_content=ssl_content,
                     prompt_text=text, prompt_language=language)
```

NOTE to implementer: before finalizing, diff against upstream `ReferenceAudio.py` for the exact resample order (32k first, then 16k FROM the 32k track — upstream `ReferenceAudio.py:43` resamples 32k→16k) and the exact hubert input rank the real graph expects — validate against `.spike/genie_assets/GenieData/chinese-hubert-base/chinese-hubert-base.onnx` inputs in the E2E task. The unit tests use fakes; the E2E task is the real gate.

- [ ] **Step 5: Write `inference.py`** (port of `Core/Inference.py`). Structure (the t2s/vits `run()` feeds must be copied from upstream verbatim — input names, the `'。' + text` prepend, the 500-step loop):

```python
"""GPT-SoVITS synthesis loop (t2s encoder/decoders + VITS vocoder).

Ported from genie_tts Core/Inference.py (MIT, see LICENSE). SOKUJI changes:
sessions and language are explicit parameters (no globals, no per-character
duplication); two degenerate-generation guards return None instead of letting
the vocoder replay the reference (spike-documented upstream hazards).
"""
from __future__ import annotations

import logging

import numpy as np

from .text import get_phones_and_bert

logger = logging.getLogger(__name__)

MAX_AR_STEPS = 500
EOS_TOKEN = 1024


class Synthesizer:
    def __init__(self, sessions: dict, sv_session=None, roberta=None):
        self._encoder = sessions["t2s_encoder_fp32.onnx"]
        self._first_stage = sessions["t2s_first_stage_decoder_fp32.onnx"]
        self._stage = sessions["t2s_stage_decoder_fp32.onnx"]
        self._vocoder = sessions["vits_fp32.onnx"]
        self._prompt_encoder = sessions.get("prompt_encoder_fp32.onnx")
        self._sv = sv_session
        self._roberta = roberta

    # -- guards (unit-tested separately) --------------------------------
    @staticmethod
    def _slice_generated(y: np.ndarray, idx: int):
        if idx <= 0:
            # AR stopped on the very first step; y[:, -0:] would return the
            # WHOLE sequence including prompt tokens (reference replay bug).
            return None
        return np.expand_dims(y[:, -idx:], axis=0)

    @staticmethod
    def _trim_at_eos(semantic_tokens: np.ndarray):
        eos = np.where(semantic_tokens >= EOS_TOKEN)
        if len(eos[0]) > 0:
            first = eos[-1][0]
            semantic_tokens = semantic_tokens[..., :first]
        if semantic_tokens.size == 0:
            return None
        return semantic_tokens

    def synthesize(self, text: str, ref, language: str):
        ...  # port upstream body here; see porting notes below
```

Porting notes for the `synthesize` body (implementer reads upstream `Core/Inference.py` side by side):
1. Keep `text = '。' + text` (upstream anti-first-sentence-drop hack) and prompt phones from `ref.prompt_text`/`ref.prompt_language` exactly as upstream combines them.
2. `get_phones_and_bert(..., roberta=self._roberta)` for both prompt and target text.
3. v2ProPlus branch: run `self._sv` on the reference track and `self._prompt_encoder` exactly as upstream (`prompt_encoder is not None` selects the branch, mirroring upstream's vocoder feed differences).
4. Replace the `for idx in range(0, 500)` loop verbatim, but after the loop use `self._slice_generated(y, idx)`; on `None` → return `None`.
5. After semantic extraction use `self._trim_at_eos(...)`; on `None` → return `None`.
6. Keep `y[0, -1] = 0` pre-slice write (upstream) and all input-name plumbing via `[inp.name for inp in session.get_inputs()]`.
7. Return the vocoder output squeezed to 1-D float32.
8. Drop upstream's `self.stop_event` entirely (engine is synchronous).

- [ ] **Step 6: Run tests until green**

```bash
cd sidecar && .venv/bin/python -m pytest tests/test_gpt_sovits_inference.py tests/test_gpt_sovits_g2p.py -v
```
Expected: PASS (guards + reference shape tests; real-session correctness lands in Task 7's E2E).

- [ ] **Step 7: Commit**

```bash
git add sidecar/sokuji_sidecar/gpt_sovits/reference.py sidecar/sokuji_sidecar/gpt_sovits/inference.py sidecar/tests/test_gpt_sovits_inference.py
git commit -m "feat(sidecar): GPT-SoVITS compute core — reference pipeline + guarded t2s/vits synthesis"
```

---

### Task 4: Backend class + engine/accel integration

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_backends.py` (append the backend class before the bottom `mlx_tts` self-registration block)
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_installed()`, around lines 124-146: add `"gpt_sovits_onnx": "onnxruntime"` next to the other ORT backends)
- Test: `sidecar/tests/test_gpt_sovits_backend.py`

**Interfaces:**
- Consumes: `runtime.ensure_fp32_bins/build_model_sessions/make_session`, `reference.build_reference`, `inference.Synthesizer`, `assets.configure`, `text_splitter.TextSplitter`.
- Produces: `@register_backend class GptSovitsOnnxBackend` with `NAME="gpt_sovits_onnx"`, `STREAMING=False`, `CLONES=True`; `load(model_ref, device, compute_type, config=None)`; `set_language(lang)`; `set_voice(audio, sr, ref_text="")`; `set_builtin_voice(name)`; `generate(text, speed=1.0) -> (np.ndarray, int)`; `unload()`; `is_loaded`; `sample_rate=32000`.
- Snapshot layout consumed (defined here, produced by Task 6's repo): `model/` (graphs + fp16 bins), `genie_data/chinese-hubert-base/`, `genie_data/speaker_encoder.onnx`, `genie_data/RoBERTa/` (RoBERTa.onnx + `roberta_tokenizer/tokenizer.json`), `genie_data/G2P/ChineseG2P/`, `genie_data/G2P/EnglishG2P/`, `voices/` (manifest.json + `<name>.wav` + `<name>.txt`).

- [ ] **Step 1: Write failing tests** — `sidecar/tests/test_gpt_sovits_backend.py` (full content):

```python
import numpy as np
import pytest

from sokuji_sidecar import tts_backends
from sokuji_sidecar.backends import BackendLoadError, make_backend


def test_flags_and_registration():
    b = make_backend("gpt_sovits_onnx")
    assert b.NAME == "gpt_sovits_onnx"
    assert b.STREAMING is False
    assert b.CLONES is True
    assert not b.is_loaded


def test_installed_mapping_declares_onnxruntime():
    from sokuji_sidecar import accel
    machine = accel.probe()
    assert "gpt_sovits_onnx" in machine.installed


def _loaded_backend(monkeypatch, tmp_path):
    """Backend with all collaborators faked; no real ONNX anywhere."""
    b = make_backend("gpt_sovits_onnx")
    (tmp_path / "model").mkdir()
    gd = tmp_path / "genie_data"
    (gd / "G2P" / "ChineseG2P").mkdir(parents=True)
    (gd / "G2P" / "EnglishG2P").mkdir(parents=True)
    monkeypatch.setattr(tts_backends, "snapshot_download",
                        lambda repo_id, **kw: str(tmp_path))
    from sokuji_sidecar.gpt_sovits import runtime
    monkeypatch.setattr(runtime, "ensure_fp32_bins", lambda d: [])
    monkeypatch.setattr(runtime, "build_model_sessions",
                        lambda d, dev: {"t2s_encoder_fp32.onnx": object(),
                                        "t2s_first_stage_decoder_fp32.onnx": object(),
                                        "t2s_stage_decoder_fp32.onnx": object(),
                                        "vits_fp32.onnx": object(),
                                        "prompt_encoder_fp32.onnx": object()})
    monkeypatch.setattr(runtime, "make_session", lambda p, dev: object())
    b.load("fake/repo", "cpu", "fp32", None)
    return b


def test_load_wraps_errors_in_backend_load_error(monkeypatch, tmp_path):
    b = make_backend("gpt_sovits_onnx")
    monkeypatch.setattr(tts_backends, "snapshot_download",
                        lambda repo_id, **kw: (_ for _ in ()).throw(OSError("no snapshot")))
    with pytest.raises(BackendLoadError):
        b.load("fake/repo", "cpu", "fp32", None)


def test_set_voice_requires_transcript(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    with pytest.raises(ValueError, match="transcript"):
        b.set_voice(np.zeros(24000, dtype=np.float32), 24000, ref_text="")


def test_set_language_normalizes_and_rejects_unknown(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    b.set_language("zh")
    assert b._language == "chinese"
    b.set_language("EN")
    assert b._language == "english"
    b.set_language("ja")
    assert b._language == "japanese"
    b.set_language("")            # empty -> keep default (english)
    with pytest.raises(ValueError):
        b.set_language("ko")


def test_detect_language_for_ref_text():
    from sokuji_sidecar.tts_backends import _gpt_sovits_detect_language
    assert _gpt_sovits_detect_language("不要问你的国家") == "chinese"
    assert _gpt_sovits_detect_language("こんにちは、元気ですか") == "japanese"
    assert _gpt_sovits_detect_language("Ask not what your country") == "english"
    # kanji-only ja is indistinguishable from zh -> zh is the documented default
    assert _gpt_sovits_detect_language("会議") == "chinese"


def test_generate_guards_short_text_with_silence(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    b._reference = object()  # pretend a voice is set
    called = []
    b._synth = type("S", (), {"synthesize": lambda self, *a, **k: called.append(1)})()
    samples, ms = b.generate("嗯。", 1.0)
    assert called == []                      # synthesis never invoked
    assert samples.dtype == np.float32
    assert 0 < samples.shape[0] <= 32000 // 2  # brief silence
    assert float(np.abs(samples).max()) == 0.0


def test_generate_zero_output_raises(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    b._reference = object()
    b._synth = type("S", (), {"synthesize": lambda self, *a, **k: None})()
    with pytest.raises(RuntimeError, match="no audio"):
        b.generate("A normal length sentence for synthesis.", 1.0)


def test_generate_requires_voice(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    with pytest.raises(RuntimeError, match="voice"):
        b.generate("Hello there, this is a test.", 1.0)


def test_generate_g2p_crash_returns_silence(monkeypatch, tmp_path):
    b = _loaded_backend(monkeypatch, tmp_path)
    b._reference = object()
    def _boom(self, *a, **k):
        raise IndexError("string index out of range")
    b._synth = type("S", (), {"synthesize": _boom})()
    samples, ms = b.generate("正常长度的句子应当触发合成路径。", 1.0)
    assert float(np.abs(samples).max()) == 0.0  # degrades to silence, no crash
```

- [ ] **Step 2: Run to verify failure**

```bash
cd sidecar && .venv/bin/python -m pytest tests/test_gpt_sovits_backend.py -v
```
Expected: FAIL (unknown backend name).

- [ ] **Step 3: Implement the backend** in `tts_backends.py` (append; full code):

```python
# ---------------------------------------------------------------------------
# GPT-SoVITS (v2ProPlus) via the vendored Genie-TTS ONNX runtime — issue #322.
# CPU + CUDA tiers; fp16 bins expand to fp32 at load (see gpt_sovits.runtime).

_GPT_SOVITS_LANGS = {"zh": "chinese", "en": "english", "ja": "japanese"}


def _gpt_sovits_detect_language(text: str) -> str:
    """Best-effort language of a reference transcript (wire carries no refLang).

    Kana wins over Han (ja text usually mixes both); Han without kana is
    treated as Chinese — kanji-only Japanese is genuinely ambiguous, zh is the
    documented default. TODO(#322): consider a refLang wire field later.
    """
    if any("぀" <= ch <= "ヿ" for ch in text):
        return "japanese"
    if any("一" <= ch <= "鿿" for ch in text):
        return "chinese"
    return "english"


def _gpt_sovits_effective_len(text: str) -> int:
    """Count phoneme-bearing characters (CJK chars and latin letters)."""
    return sum(1 for ch in text
               if ch.isalpha() or "぀" <= ch <= "ヿ"
               or "一" <= ch <= "鿿")


@register_backend
class GptSovitsOnnxBackend:
    NAME = "gpt_sovits_onnx"
    STREAMING = False
    CLONES = True
    # Inputs shorter than this synthesize unreliably on GPT-SoVITS (upstream
    # short-text hazards, spike 2026-07-16) — return brief silence instead.
    MIN_EFFECTIVE_CHARS = 2

    def __init__(self):
        self.sample_rate = 32000
        self._sessions = None
        self._synth = None
        self._hubert = None
        self._reference = None
        self._language = "english"
        self._snapshot = None

    @property
    def is_loaded(self):
        return self._synth is not None

    def load(self, model_ref, device, compute_type, config=None):
        from .gpt_sovits import assets as _gs_assets
        from .gpt_sovits import runtime as _gs_runtime
        try:
            d = snapshot_download(repo_id=model_ref, local_files_only=True)
            model_dir = os.path.join(d, "model")
            genie_dir = os.path.join(d, "genie_data")
            _gs_runtime.ensure_fp32_bins(model_dir)
            _gs_runtime.ensure_fp32_bins(
                os.path.join(genie_dir, "chinese-hubert-base"))
            _gs_assets.configure(
                chinese_g2p_dir=os.path.join(genie_dir, "G2P", "ChineseG2P"),
                english_g2p_dir=os.path.join(genie_dir, "G2P", "EnglishG2P"))
            self._sessions = _gs_runtime.build_model_sessions(model_dir, device)
            self._hubert = _gs_runtime.make_session(
                os.path.join(genie_dir, "chinese-hubert-base",
                             "chinese-hubert-base.onnx"), device)
            sv = _gs_runtime.make_session(
                os.path.join(genie_dir, "speaker_encoder.onnx"), device)
            roberta = self._load_roberta(genie_dir, device)
            from .gpt_sovits.inference import Synthesizer
            self._synth = Synthesizer(self._sessions, sv_session=sv,
                                      roberta=roberta)
            self._snapshot = d
        except Exception as e:  # noqa: BLE001 — contract: wrap all load failures
            self.unload()
            raise BackendLoadError(f"gpt_sovits_onnx load failed: {e}") from e

    def _load_roberta(self, genie_dir, device):
        from .gpt_sovits import runtime as _gs_runtime
        onnx_path = os.path.join(genie_dir, "RoBERTa", "RoBERTa.onnx")
        tok_path = os.path.join(genie_dir, "RoBERTa", "roberta_tokenizer",
                                "tokenizer.json")
        if not (os.path.isfile(onnx_path) and os.path.isfile(tok_path)):
            return None  # zh prosody degrades to zero BERT features
        from tokenizers import Tokenizer
        return (_gs_runtime.make_session(onnx_path, device),
                Tokenizer.from_file(tok_path))

    def set_language(self, lang):
        if not lang:
            return
        key = lang.lower().split("-")[0]
        if key not in _GPT_SOVITS_LANGS:
            raise ValueError(f"gpt_sovits_onnx does not support language {lang!r}")
        self._language = _GPT_SOVITS_LANGS[key]

    def set_voice(self, audio, sr, ref_text=""):
        if not ref_text or not ref_text.strip():
            raise ValueError(
                "gpt_sovits_onnx cloning requires the reference transcript "
                "(transcript_required=True)")
        from .gpt_sovits.reference import build_reference
        self._reference = build_reference(
            np.asarray(audio, dtype=np.float32), int(sr), ref_text.strip(),
            _gpt_sovits_detect_language(ref_text), self._hubert)

    def set_builtin_voice(self, name):
        base = os.path.join(self._snapshot, "voices", name)
        wav, sr = sf.read(base + ".wav", dtype="float32")
        with open(base + ".txt", encoding="utf-8") as f:
            transcript = f.read().strip()
        self.set_voice(wav, sr, ref_text=transcript)

    def generate(self, text, speed=1.0):
        if self._reference is None:
            raise RuntimeError("gpt_sovits_onnx: no voice set — call set_voice first")
        text = (text or "").strip()
        t0 = time.time()
        if _gpt_sovits_effective_len(text) < self.MIN_EFFECTIVE_CHARS:
            logger.info("gpt_sovits_onnx: input %r below min length; emitting silence",
                        text)
            return np.zeros(int(0.15 * self.sample_rate), dtype=np.float32), 0
        try:
            samples = self._synth.synthesize(text, self._reference, self._language)
        except Exception:
            # zh G2P has known crash inputs (e.g. vowel-less nasals); a live
            # translation session must survive them. Fixed upstream cases are
            # guarded in the vendored ToneSandhi; this is the safety net.
            logger.exception("gpt_sovits_onnx: synthesis failed for %r; emitting silence",
                             text)
            return np.zeros(int(0.15 * self.sample_rate), dtype=np.float32), 0
        if samples is None or samples.size == 0:
            raise RuntimeError("gpt_sovits_onnx: synthesis produced no audio")
        gen_ms = int((time.time() - t0) * 1000)
        return np.asarray(samples, dtype=np.float32).reshape(-1), gen_ms

    def unload(self):
        self._sessions = None
        self._synth = None
        self._hubert = None
        self._reference = None
        self._snapshot = None
```

Check the imports at the top of `tts_backends.py` — `os`, `time`, `numpy as np`, `soundfile as sf`, `snapshot_download`, `logger` all exist for the other backends; reuse them (do not re-import).

- [ ] **Step 4: Add the `_installed()` mapping** in `sidecar/sokuji_sidecar/accel.py` (next to `"qwen3tts_onnx": "onnxruntime"`):

```python
        "gpt_sovits_onnx": "onnxruntime",
```

- [ ] **Step 5: Run tests until green, then the whole suite**

```bash
cd sidecar && .venv/bin/python -m pytest tests/test_gpt_sovits_backend.py -v
cd sidecar && .venv/bin/python -m pytest tests/ -x -q
```
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_backends.py sidecar/sokuji_sidecar/accel.py sidecar/tests/test_gpt_sovits_backend.py
git commit -m "feat(sidecar): gpt_sovits_onnx backend — clone-with-transcript, short-text and G2P-crash guards"
```

---

### Task 5: Catalog card + invariant test updates

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (repo constant near line 388; card in the TTS list next to the qwen3 cards)
- Modify: `sidecar/tests/test_catalog.py` (allowed-backends set, lines ~136-137)
- Test: `sidecar/tests/test_catalog.py` (existing invariants must pass with the new card)

**Interfaces:**
- Consumes: backend name `"gpt_sovits_onnx"` (Task 4).
- Produces: card id `"gpt-sovits-v2pp"`, repo constant `_GPT_SOVITS_REPO` (env `SOKUJI_GPT_SOVITS_REPO`, default `jiangzhuo9357/gpt-sovits-v2pp-onnx`).

- [ ] **Step 1: Add the repo constant** (next to `_QWEN3_TTS_17B_REPO`, `catalog.py:390`):

```python
_GPT_SOVITS_REPO = os.environ.get(
    "SOKUJI_GPT_SOVITS_REPO", "jiangzhuo9357/gpt-sovits-v2pp-onnx")
```

- [ ] **Step 2: Add the card** (after the qwen3-tts-1.7b card):

```python
    # GPT-SoVITS v2ProPlus via the vendored Genie-TTS ONNX runtime (issue #322).
    # gpu-cuda: measured 3x vs CPU on unified-memory aarch64 (GB10, RTF 0.2);
    # x86 discrete-GPU benefit unverified (per-step KV round-trip) — the RTF
    # bench demotes it there if slow. recommended stays False until en/ja
    # quality is validated (upstream reports; sudachi kanji readings).
    TtsModel("gpt-sovits-v2pp", "GPT-SoVITS v2ProPlus",
             ("zh", "en", "ja"),
             (Deployment("gpt_sovits_onnx", "gpu-cuda", "fp32", _GPT_SOVITS_REPO, 1.0,
                         est_bytes=2_500_000_000),
              Deployment("gpt_sovits_onnx", "cpu", "fp32", _GPT_SOVITS_REPO, 1.0)),
             repos=(_GPT_SOVITS_REPO,), clones=True, streaming=False,
             transcript_required=True, named_voices=True, sample_rate=32000,
             recommended=False, sort_order=4, size_bytes=1_360_000_000),
```

(`size_bytes` is finalized in Task 6 Step 4 from the real repo tree.)

- [ ] **Step 3: Extend the allowed-backends invariant** in `sidecar/tests/test_catalog.py` (~line 136): add `"gpt_sovits_onnx"` to the set in `test_tts_models_have_deployments_languages_and_repos`.

- [ ] **Step 4: Run the catalog + planner suites**

```bash
cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py tests/test_planner.py -v
```
Expected: PASS — pay attention to `test_tts_system_has_cpu_floor_and_unique_ids` (cpu row present ✓) and `test_shipped_deployments_are_all_platform_except_gpu_dml` (both rows use default platforms ✓).

- [ ] **Step 5: Verify planner behavior for the new card** (quick REPL sanity, not a committed test — planner tests already cover the tier machinery):

```bash
cd sidecar && .venv/bin/python -c "
from sokuji_sidecar import planner, catalog
from sokuji_sidecar.planner import Machine
m_x86 = Machine(os='linux', arch='x86_64', gpus=(('cuda','NVIDIA RTX 4070',12e9),), installed=frozenset({'onnxruntime','llamacpp'}), ort_cuda=True)
mdl = next(t for t in catalog.TTS_MODELS if t.id == 'gpt-sovits-v2pp')
plans = planner.resolve_deployments(mdl, m_x86, platform='linux')
print([ (p.tier, p.device) for p in plans ])
"
```
Expected: `[('gpu-cuda', 'cuda'), ('cpu', 'cpu')]` (adjust the Machine kwargs to the real dataclass fields — read `accel.py:19-43` — the point is: gpu-cuda ranks first where CUDA exists, cpu-only elsewhere).

- [ ] **Step 6: Full suite + commit**

```bash
cd sidecar && .venv/bin/python -m pytest tests/ -x -q
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(sidecar): GPT-SoVITS v2ProPlus catalog card (cpu + gpu-cuda tiers)"
```

---

### Task 6: HF model repo assembly (script + local tree; upload gated on user consent)

**Files:**
- Create: `scripts/build-gpt-sovits-repo.sh`
- Modify: `sidecar/sokuji_sidecar/catalog.py` (finalize `size_bytes`)

**Interfaces:**
- Produces the repo tree the backend consumes (layout defined in Task 4): `model/`, `genie_data/`, `voices/`, `README.md`.

- [ ] **Step 1: Write `scripts/build-gpt-sovits-repo.sh`** (full content):

```bash
#!/usr/bin/env bash
# Assemble the gpt-sovits-v2pp-onnx HF repo tree (issue #322).
#
# Inputs:
#   $1 = converted model dir (Genie converter output on the BASE checkpoints;
#        one-off torch step, see docs/superpowers/plans/2026-07-17-gpt-sovits-tts.md)
#   $2 = GenieData dir (High-Logic/Genie GenieData/ + GenieData(Optional)/RoBERTa)
#   $3 = output dir
# Publishes fp16 bins only — the sidecar expands them to fp32 at load time.
set -euo pipefail
CONVERTED=$1; GENIE=$2; OUT=$3

mkdir -p "$OUT/model" "$OUT/genie_data/G2P" "$OUT/voices"

# model graphs + fp16 bins + the (already-fp32) encoder bin. NO expanded fp32
# bins — publishing them would double the download for nothing.
for f in t2s_encoder_fp32.onnx t2s_encoder_fp32.bin \
         t2s_first_stage_decoder_fp32.onnx t2s_stage_decoder_fp32.onnx \
         t2s_shared_fp16.bin vits_fp32.onnx vits_fp16.bin \
         prompt_encoder_fp32.onnx prompt_encoder_fp16.bin; do
  cp "$CONVERTED/$f" "$OUT/model/"
done

# runtime assets (hubert stays fp16; RoBERTa + speaker encoder are fp32-only)
cp -r "$GENIE/chinese-hubert-base" "$OUT/genie_data/"
cp "$GENIE/speaker_encoder.onnx" "$OUT/genie_data/"
cp -r "$GENIE/RoBERTa" "$OUT/genie_data/"
cp -r "$GENIE/G2P/ChineseG2P" "$OUT/genie_data/G2P/"
cp -r "$GENIE/G2P/EnglishG2P" "$OUT/genie_data/G2P/"

# default builtin voice: first utterance of the repo benchmark clip (JFK 1961
# inaugural — US government work, public domain), trimmed to ~4.4s.
python3 - "$OUT" <<'EOF'
import sys, soundfile as sf
out = sys.argv[1]
wav, sr = sf.read("benchmark/test-speech-silence-speech.wav", dtype="float32")
sf.write(f"{out}/voices/classic-en.wav", wav[: int(4.4 * sr)], sr)
with open(f"{out}/voices/classic-en.txt", "w") as f:
    f.write("Ask not what your country can do for you. "
            "Ask what you can do for your country.")
EOF
cat > "$OUT/voices/manifest.json" <<'EOF'
[
  {"name": "classic-en", "language": "en", "gender": "m",
   "curated": true, "unstable": false, "default": true}
]
EOF

cat > "$OUT/README.md" <<'EOF'
# GPT-SoVITS v2ProPlus — ONNX (Sokuji Local Native TTS)

Converted from the base pretrained checkpoints of
[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) (MIT) —
[lj1995/GPT-SoVITS](https://huggingface.co/lj1995/GPT-SoVITS) (MIT) —
via [Genie-TTS](https://github.com/High-Logic/Genie-TTS) (MIT).
Runtime assets (chinese-hubert-base, speaker encoder, RoBERTa, G2P dictionaries)
mirrored from [High-Logic/Genie](https://huggingface.co/High-Logic/Genie) (MIT;
hubert originally [TencentGameMate/chinese-hubert-base](https://huggingface.co/TencentGameMate/chinese-hubert-base), MIT;
RoBERTa Apache-2.0).

Weight bins under `model/` and `genie_data/chinese-hubert-base/` are fp16;
the Sokuji sidecar expands them to fp32 in place at load time.

Default voice clip: JFK 1961 inaugural address excerpt (US government work,
public domain).
EOF

du -sb "$OUT"
echo "repo tree assembled at $OUT"
```

```bash
chmod +x scripts/build-gpt-sovits-repo.sh
```

- [ ] **Step 2: Assemble locally from the spike artifacts**

The spike already produced both inputs. Note: `.spike/converted/gpt-sovits-v2pp-base/` currently holds EXPANDED fp32 bins with fp16 quarantined — restore the fp16 layout first:

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react/.claude/worktrees/feat+gpt-sovits-tts
mv .spike/converted/gpt-sovits-v2pp-base/_fp16_quarantine/*.bin .spike/converted/gpt-sovits-v2pp-base/
rm .spike/converted/gpt-sovits-v2pp-base/{t2s_shared_fp32.bin,vits_fp32.bin,prompt_encoder_fp32.bin}
bash scripts/build-gpt-sovits-repo.sh \
  .spike/converted/gpt-sovits-v2pp-base \
  ".spike/genie_assets/GenieData" \
  .spike/hf-repo
```
Expected: `du -sb` around 1.3-1.4 GB; tree has `model/` (9 files), `genie_data/`, `voices/` (3 files), `README.md`.
(RoBERTa was symlinked into GenieData during the spike — `cp -r` follows it; verify `genie_data/RoBERTa/RoBERTa.onnx` is a real ~599MB file.)

- [ ] **Step 3: Point the backend at the local tree and smoke-load** (no upload needed):

```bash
cd sidecar && HF_HUB_OFFLINE=1 .venv/bin/python -c "
import os, sys
# snapshot_download would hit the network; simulate by loading from the local tree
sys.path.insert(0, '.')
from sokuji_sidecar import tts_backends
from sokuji_sidecar.backends import make_backend
import sokuji_sidecar.tts_backends as tb
tb.snapshot_download = lambda repo_id, **kw: os.path.abspath('../.spike/hf-repo')
b = make_backend('gpt_sovits_onnx')
b.load('local', 'cpu', 'fp32', None)
print('loaded ok; builtin voices ->', os.listdir('../.spike/hf-repo/voices'))
b.set_builtin_voice('classic-en')
import numpy as np
samples, ms = b.generate('The quick brown fox jumps over the lazy dog.', 1.0)
print('generated', samples.shape, samples.dtype, ms, 'ms')
"
```
Expected: prints `generated (N,) float32 <ms>` with N ≈ 2-4s × 32000. This is the first REAL end-to-end through the vendored code — expect porting bugs to surface here; fix in `gpt_sovits/` until it passes.

- [ ] **Step 4: Finalize `size_bytes`**

```bash
du -sb .spike/hf-repo
```
Update the card's `size_bytes` in `catalog.py` with the printed byte count; re-run `pytest tests/test_catalog.py -q`.

- [ ] **Step 5: Commit, then PAUSE for upload consent**

```bash
git add scripts/build-gpt-sovits-repo.sh sidecar/sokuji_sidecar/catalog.py
git commit -m "feat(sidecar): GPT-SoVITS repo assembly script; finalize card size_bytes"
```

**STOP: ask the user before any HF upload** (publish action). Proposed upload once approved (huggingface_hub, same pattern as the qwen3 repos under `jiangzhuo9357/`):
```bash
.spike/venv/bin/python -c "
from huggingface_hub import HfApi
api = HfApi()
api.create_repo('jiangzhuo9357/gpt-sovits-v2pp-onnx', repo_type='model', exist_ok=True)
api.upload_folder(folder_path='.spike/hf-repo', repo_id='jiangzhuo9357/gpt-sovits-v2pp-onnx')
"
```

---

### Task 7: End-to-end verification on this machine (CPU + CUDA) + engine-path test

**Files:**
- Test: `sidecar/tests/test_tts_engine_gptsovits.py` (engine wiring, committed)
- Verification only (not committed): whisper transcription of real synth output

**Interfaces:**
- Consumes: everything above + the local repo tree from Task 6.

- [ ] **Step 1: Engine-wiring test** — `sidecar/tests/test_tts_engine_gptsovits.py` (full content, mirrors `test_tts_engine_qwen3.py`'s fake-backend shape):

```python
import numpy as np

from sokuji_sidecar.tts_engine import TtsEngine


class _FakeGptSovits:
    NAME = "gpt_sovits_onnx"
    STREAMING = False
    CLONES = True
    sample_rate = 32000

    def __init__(self):
        self.language = None
        self.voice_args = None

    def set_language(self, lang):
        self.language = lang

    def set_voice(self, audio, sr, ref_text=""):
        self.voice_args = (audio.shape, sr, ref_text)

    def generate(self, text, speed=1.0):
        return np.zeros(32000, dtype=np.float32), 7


def test_engine_threads_language_and_reftext():
    eng = TtsEngine.__new__(TtsEngine)
    eng._backend = _FakeGptSovits()
    eng._native_sr = 32000
    eng.set_voice(np.zeros(24000, dtype=np.float32), 24000, ref_text="hello ref")
    assert eng._backend.voice_args[2] == "hello ref"
    samples, ms = eng.generate("hi there general kenobi", 1.0)
    assert ms == 7
    assert samples.dtype == np.int16  # engine normalizes to Int16@24k
```

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_engine_gptsovits.py -v` → PASS. Commit:
```bash
git add sidecar/tests/test_tts_engine_gptsovits.py
git commit -m "test(sidecar): engine wiring for gpt_sovits_onnx (refText + resample path)"
```

- [ ] **Step 2: Real CPU synthesis via the backend + whisper verification**

Extend the Task 6 Step 3 smoke into three languages, saving wavs to `.spike/out/e2e/`:

```bash
cd sidecar && .venv/bin/python - <<'EOF'
import os, sys
sys.path.insert(0, '.')
import numpy as np, soundfile as sf
import sokuji_sidecar.tts_backends as tb
from sokuji_sidecar.backends import make_backend
tb.snapshot_download = lambda repo_id, **kw: os.path.abspath('../.spike/hf-repo')
b = make_backend('gpt_sovits_onnx')
b.load('local', 'cpu', 'fp32', None)
b.set_builtin_voice('classic-en')
os.makedirs('../.spike/out/e2e', exist_ok=True)
cases = [("zh", "今天的会议改到下午三点，请大家提前准备好相关材料。"),
         ("en", "The meeting has been moved to three o'clock this afternoon."),
         ("ja", "本日の会議は午後三時に変更されました。")]
for lang, text in cases:
    b.set_language(lang)
    samples, ms = b.generate(text, 1.0)
    sf.write(f"../.spike/out/e2e/{lang}.wav", samples, b.sample_rate)
    print(lang, samples.shape[0] / b.sample_rate, "s", ms, "ms")
EOF
```

Then transcribe with the spike venv:
```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react/.claude/worktrees/feat+gpt-sovits-tts
.spike/venv/bin/python - <<'EOF'
from faster_whisper import WhisperModel
m = WhisperModel("small", device="cpu", compute_type="int8")
for lang in ("zh", "en", "ja"):
    segs, _ = m.transcribe(f".spike/out/e2e/{lang}.wav", language=lang, beam_size=5)
    print(lang, "->", "".join(s.text for s in segs).strip())
EOF
```
Expected: transcriptions match the input sentences (same bar as the spike: verbatim modulo punctuation/number-form).

- [ ] **Step 3: CUDA path verification** (this box: aarch64 + the sbsa ORT-GPU wheel lives in `.spike/venv-gpu`; the sidecar venv is CPU-only by SKU, so drive the backend directly from the GPU venv):

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react/.claude/worktrees/feat+gpt-sovits-tts
uv pip install --python .spike/venv-gpu/bin/python jieba==0.42.1 pypinyin==0.55.0 g2pM==0.1.2.5 nltk==3.10.0 pyopenjtalk-plus==0.4.1.post8 tokenizers websockets psutil zstandard
.spike/venv-gpu/bin/python - <<'EOF'
import os, sys, time
sys.path.insert(0, 'sidecar')
import numpy as np, soundfile as sf
import sokuji_sidecar.tts_backends as tb
from sokuji_sidecar.backends import make_backend
tb.snapshot_download = lambda repo_id, **kw: os.path.abspath('.spike/hf-repo')
b = make_backend('gpt_sovits_onnx')
b.load('local', 'cuda', 'fp32', None)
b.set_builtin_voice('classic-en')
b.set_language('zh')
b.generate("预热句子，用于会话初始化。", 1.0)
t0 = time.time()
samples, ms = b.generate("今天的会议改到下午三点，请大家提前准备好相关材料。", 1.0)
wall = time.time() - t0
dur = samples.shape[0] / 32000
print(f"CUDA: {dur:.2f}s audio in {wall:.2f}s -> RTF {wall/dur:.3f}")
sf.write(".spike/out/e2e/zh_cuda.wav", samples, 32000)
EOF
```
Expected: RTF ≈ 0.2 (spike parity) and NO exception — if CUDA silently dropped, `make_session` raises (that's the point). Whisper-verify `zh_cuda.wav` as in Step 2.

- [ ] **Step 4: Full sidecar suite one more time + commit any fixes**

```bash
cd sidecar && .venv/bin/python -m pytest tests/ -q
```
Expected: PASS. Commit fixes if any were needed:
```bash
git add -A sidecar && git commit -m "fix(sidecar): GPT-SoVITS e2e porting fixes"
```

---

### Task 8: sidecarVersion bump + follow-ups

**Files:**
- Modify: `package.json:5` (`"sidecarVersion": "0.1.6"` → `"0.1.7"` — new backend + new requirements need a new bundle)

- [ ] **Step 1: Bump and verify workflow consistency tests**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react/.claude/worktrees/feat+gpt-sovits-tts
# edit package.json sidecarVersion to 0.1.7
sidecar/.venv/bin/python -m pytest sidecar/tests/test_build_sidecar_bundle.py sidecar/tests/test_sidecar_bundles_workflow.py sidecar/tests/test_sku_requirements.py -q
```
Expected: PASS (the sku-requirements tests also validate the Task 1 requirements additions).

- [ ] **Step 2: Renderer consistency net**

```bash
npm run test -- src/lib/local-inference/native/nativeProtocol.consistency.test.ts
```
Expected: PASS (no new message types were added).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(sidecar): bump sidecarVersion to 0.1.7 for gpt_sovits_onnx backend"
```

- [ ] **Step 4: Present follow-ups to the user (do NOT file issues without approval)** — draft list:
  1. ja G2P quality validation (sudachi kanji readings kept; upstream ja prosody path) — from user decision "带上，可能效果不好".
  2. en quality validation before flipping `recommended` (upstream reports).
  3. `gpu-dml` row (AR loop on DirectML unmeasured).
  4. x86 discrete-GPU measurement (4070) — per-step KV round-trip may nullify CUDA gain; consider IOBinding rework upstream/vendored.
  5. True-fp16 CUDA graphs (tensor cores; halves VRAM) — beyond parity, optimization only.
  6. Upstream bug reports to High-Logic/Genie-TTS: ToneSandhi syllabic-nasal IndexError; idx==0 reference-replay slice.
  7. refLang wire field so reference-transcript language stops being heuristic.

---

## Self-Review Notes

- Spec coverage: vendor (T1-T3), backend+guards (T4), catalog card cpu+gpu-cuda (T5), HF hosting fp16 scheme (T6), tests mirroring qwen3 shapes (T1-T5, T7), e2e + whisper verification (T7), version bump (T8). User decisions 1-5 all encoded (sudachi kept T1, RoBERTa in repo T6, fp16-publish T2/T6, GPU tier T5, jieba swap T1).
- Known intentional deviations from "complete code": vendored-file bodies (G2P tree, synthesize loop) are copy+diff instructions against a pinned upstream source that exists in-tree at `.spike/venv/.../genie_tts` — reproducing thousands of unchanged upstream lines in the plan would be noise; the tests are the spec for every modification.
- Type consistency: `build_model_sessions` keys are graph basenames; `Synthesizer.__init__` consumes the same keys; backend passes `sessions` dict through. `providers_for`/`make_session` naming consistent across T2 usage in T4.
- The engine calls `generate(text, speed)` positionally — backend signature `generate(self, text, speed=1.0)` matches.
