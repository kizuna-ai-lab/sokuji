# Opus-MT → CTranslate2 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Opus-MT translation runtime (`marian_onnx.py` numpy loop on onnxruntime) with CTranslate2 int8 — ~11× faster per sentence, 40% less RAM — using self-converted, self-hosted model assets.

**Architecture:** A new `Ct2OpusSession` wraps `ctranslate2.Translator` + the pair's SentencePiece models; a new `ct2_opus_translate` backend replaces `opus_onnx_translate` behind the existing registry seam, so `TranslateEngine`/`accel` code is untouched except the per-backend dependency map and catalog rows. Model assets are our own int8 CT2 conversions of the 13 Helsinki-NLP pairs (4 of 13 `gaudi/*-ctranslate2` repos are broken — missing `model.bin` — so we convert all 13 ourselves for supply-chain safety), hosted as per-pair HF model repos mirroring the gaudi file layout.

**Tech Stack:** ctranslate2 4.8.x (runtime, CPU int8), sentencepiece (already pinned), huggingface_hub (already pinned); offline conversion uses `ct2-transformers-converter` in a throwaway venv (torch allowed there — the sidecar itself stays torch-free).

## Global Constraints

- Sidecar runtime stays torch-free (`tests/test_torch_free_gate.py` must keep passing).
- Model card ids (`opus-mt-ja-en`, …) and the wire protocol do not change; only `Deployment.backend` / `artifact` / sizes change.
- Source tokens MUST get `</s>` appended manually (CT2 Marian conversions ship `add_source_eos=false`; without it output degenerates into repetition loops).
- Greedy decoding (`beam_size=1`) to match current behavior; do not add a beam knob (YAGNI).
- All comments/docs in English. Conventional commit messages.
- HF uploads and any `git push` are operator-gated (explicit user consent per action).
- HF org for hosted repos: `jiangzhuo9357` (confirm with user before upload; repo names `opus-mt-<pair>-ct2`).

---

### Task 1: Conversion script + local ja-en conversion + parity check

**Files:**
- Create: `scripts/convert-opus-ct2.py`
- Create (output, not committed): `model-packs/opus-ct2/opus-mt-ja-en-ct2/`

**Interfaces:**
- Produces: converted model dirs with exactly `config.json`, `model.bin`, `shared_vocabulary.json`, `source.spm`, `target.spm` — the file set Tasks 2/4 rely on.

- [ ] **Step 1: Create a throwaway conversion venv** (torch lives here, never in the sidecar venv)

```bash
python3 -m venv /tmp/ct2-convert-venv
/tmp/ct2-convert-venv/bin/pip install -q "ctranslate2==4.8.1" "transformers>=4.40,<5" torch --index-url https://download.pytorch.org/whl/cpu sentencepiece
```

- [ ] **Step 2: Write the conversion script**

```python
#!/usr/bin/env python3
"""Convert the 13 Helsinki-NLP opus-mt pairs used by the native sidecar to
CTranslate2 int8. Run inside a venv that has ctranslate2 + transformers +
torch (CPU build is fine). The sidecar runtime never imports these.

Output layout mirrors gaudi/opus-mt-*-ctranslate2 (config.json, model.bin,
shared_vocabulary.json, source.spm, target.spm) so the runtime treats our
repos and gaudi's identically.

Usage:
  python scripts/convert-opus-ct2.py [pair ...]      # default: all 13
"""
import shutil
import subprocess
import sys
from pathlib import Path

PAIRS = ["ru-en", "zh-en", "en-zh", "hu-en", "en-es", "en-ar", "en-ru",
         "es-en", "en-vi", "ar-en", "ja-en", "en-jap", "ko-en"]
OUT_ROOT = Path(__file__).resolve().parent.parent / "model-packs" / "opus-ct2"

def convert(pair: str) -> None:
    src_repo = f"Helsinki-NLP/opus-mt-{pair}"
    out_dir = OUT_ROOT / f"opus-mt-{pair}-ct2"
    if (out_dir / "model.bin").exists():
        print(f"[skip] {pair} already converted")
        return
    shutil.rmtree(out_dir, ignore_errors=True)
    subprocess.run(
        ["ct2-transformers-converter", "--model", src_repo,
         "--output_dir", str(out_dir), "--quantization", "int8",
         "--copy_files", "source.spm", "target.spm"],
        check=True)
    have = {p.name for p in out_dir.iterdir()}
    need = {"config.json", "model.bin", "shared_vocabulary.json",
            "source.spm", "target.spm"}
    missing = need - have
    if missing:
        raise SystemExit(f"{pair}: converter output missing {missing}")
    print(f"[ok] {pair} -> {out_dir}")

if __name__ == "__main__":
    for pair in (sys.argv[1:] or PAIRS):
        convert(pair)
```

- [ ] **Step 3: Convert ja-en only and verify the file set**

Run: `/tmp/ct2-convert-venv/bin/python scripts/convert-opus-ct2.py ja-en && ls model-packs/opus-ct2/opus-mt-ja-en-ct2/`
Expected: `[ok] ja-en …` and the five required files present.

- [ ] **Step 4: Parity check against the verified gaudi ja-en model**

The benchmark already proved gaudi's ja-en conversion produces fluent output. Compare our conversion's output to gaudi's on 5 sentences:

```bash
/tmp/ct2-convert-venv/bin/python - <<'EOF'
import ctranslate2, sentencepiece, huggingface_hub, os
def load(d):
    tr = ctranslate2.Translator(d, device="cpu", compute_type="int8")
    sp_s = sentencepiece.SentencePieceProcessor(model_file=os.path.join(d, "source.spm"))
    sp_t = sentencepiece.SentencePieceProcessor(model_file=os.path.join(d, "target.spm"))
    return tr, sp_s, sp_t
def tr1(bundle, text):
    tr, sp_s, sp_t = bundle
    toks = sp_s.encode(text, out_type=str)[:510] + ["</s>"]
    return sp_t.decode(tr.translate_batch([toks], beam_size=1)[0].hypotheses[0]).strip()
ours = load("model-packs/opus-ct2/opus-mt-ja-en-ct2")
theirs = load(huggingface_hub.snapshot_download("gaudi/opus-mt-ja-en-ctranslate2"))
sents = ["これでいいですか。", "会議は何時からですか。",
         "資料は昨日メールで送りましたので、確認をお願いします。",
         "今日中に報告書を仕上げないといけないので、少し残業します。",
         "この前教えてもらったレストラン、すごく美味しかったです。"]
for s in sents:
    a, b = tr1(ours, s), tr1(theirs, s)
    print(("SAME " if a == b else "DIFF "), s, "->", a, ("| gaudi: " + b) if a != b else "")
EOF
```

Expected: all five translate to fluent English; identical or near-identical to gaudi (same converter, same quantization — minor diffs acceptable, empty/garbled output is a failure).

- [ ] **Step 5: Commit the script**

```bash
git add scripts/convert-opus-ct2.py
git commit -m "feat(sidecar): add Opus-MT to CTranslate2 conversion script"
```

---

### Task 2: `Ct2OpusSession` runtime wrapper

**Files:**
- Create: `sidecar/sokuji_sidecar/ct2_opus.py`
- Test: `sidecar/tests/test_ct2_opus.py`

**Interfaces:**
- Produces: `Ct2OpusSession(model_dir: str)` with `translate(text: str, max_new_tokens: int = 512) -> tuple[str, int]` — same contract `MarianOnnxSession` had; Task 3's backend consumes it.

- [ ] **Step 1: Write the failing tests** (stub ctranslate2 + sentencepiece — CI has no model files)

```python
import sys
import types

import pytest


class StubSp:
    """SentencePieceProcessor stand-in: 1 char = 1 piece; decode joins."""
    def __init__(self, model_file):
        self.model_file = model_file
    def encode(self, text, out_type=str):
        return list(text)
    def decode(self, pieces):
        return "".join(pieces)


class StubResult:
    def __init__(self, hyp):
        self.hypotheses = [hyp]


class StubTranslator:
    def __init__(self, model_dir, device, compute_type, inter_threads):
        assert device == "cpu" and compute_type == "int8"
        self.calls = []
    def translate_batch(self, batches, beam_size, max_decoding_length):
        self.calls.append((batches, beam_size, max_decoding_length))
        # echo the source pieces minus the trailing </s>, prefixed
        return [StubResult(["T:"] + batches[0][:-1])]


@pytest.fixture
def ct2(monkeypatch):
    fake_ct2 = types.SimpleNamespace(Translator=StubTranslator)
    fake_sp = types.SimpleNamespace(SentencePieceProcessor=StubSp)
    monkeypatch.setitem(sys.modules, "ctranslate2", fake_ct2)
    monkeypatch.setitem(sys.modules, "sentencepiece", fake_sp)
    from sokuji_sidecar import ct2_opus
    return ct2_opus


def test_translate_appends_source_eos_and_decodes(ct2):
    s = ct2.Ct2OpusSession("/models/x")
    text, n = s.translate("abc")
    batches, beam, _maxlen = s._translator.calls[0]
    assert batches[0] == ["a", "b", "c", "</s>"]   # manual EOS appended
    assert beam == 1                                # greedy, matches old loop
    assert text == "T:abc"
    assert n == 4                                   # hypothesis token count


def test_translate_truncates_at_510_pieces(ct2):
    s = ct2.Ct2OpusSession("/models/x")
    s.translate("x" * 600)
    batches, _, _ = s._translator.calls[0]
    assert len(batches[0]) == 511                   # 510 pieces + </s>
    assert batches[0][-1] == "</s>"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_ct2_opus.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'sokuji_sidecar.ct2_opus'`

- [ ] **Step 3: Write the implementation**

```python
"""Opus-MT translation via CTranslate2 (int8, CPU).

Replaces the former marian_onnx numpy decode loop (~11x slower; also had the
ignored-bad_words_ids empty-output bug). Model dirs mirror the
gaudi/opus-mt-*-ctranslate2 layout: config.json, model.bin,
shared_vocabulary.json, source.spm, target.spm.

These conversions ship add_source_eos=false, so the source token sequence
must end with an explicit </s> — omitting it degenerates into repetition
loops. Source length is capped at 510 pieces (+eos) to stay under Marian's
512 positional-embedding limit."""
import os

_SRC_MAX_PIECES = 510


class Ct2OpusSession:
    def __init__(self, model_dir: str):
        import ctranslate2
        import sentencepiece
        self._translator = ctranslate2.Translator(
            model_dir, device="cpu", compute_type="int8", inter_threads=1)
        self._src = sentencepiece.SentencePieceProcessor(
            model_file=os.path.join(model_dir, "source.spm"))
        self._tgt = sentencepiece.SentencePieceProcessor(
            model_file=os.path.join(model_dir, "target.spm"))

    def translate(self, text: str, max_new_tokens: int = 512) -> tuple[str, int]:
        pieces = self._src.encode(text, out_type=str)[:_SRC_MAX_PIECES] + ["</s>"]
        result = self._translator.translate_batch(
            [pieces], beam_size=1, max_decoding_length=max_new_tokens)
        hyp = result[0].hypotheses[0]
        return self._tgt.decode(hyp).strip(), len(hyp)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_ct2_opus.py -q`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/ct2_opus.py sidecar/tests/test_ct2_opus.py
git commit -m "feat(sidecar): add CTranslate2 Opus-MT session wrapper"
```

---

### Task 3: Swap the translate backend + dependency map

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_backends.py` (imports, docstring line for opus, and the `OpusOnnxTranslateBackend` class, currently at :250-283)
- Modify: `sidecar/sokuji_sidecar/accel.py:157` (backend→module dependency map)
- Test: `sidecar/tests/test_translate_backends.py` (`TestOpusOnnx` class at :130-158)

**Interfaces:**
- Consumes: `Ct2OpusSession` from Task 2.
- Produces: registered backend NAME `ct2_opus_translate` with the standard contract `load(model_ref, device, compute_type)` / `translate(text, system_prompt, src, tgt, wrap) -> tuple[str, int]` / `unload()` / `is_loaded` — Task 4's catalog rows point at this name.

- [ ] **Step 1: Update the tests first** (rename class, stub `Ct2OpusSession`)

Replace the whole `TestOpusOnnx` class in `sidecar/tests/test_translate_backends.py` with:

```python
class TestCt2Opus:
    def test_load_and_translate(self, monkeypatch, tmp_path):
        from sokuji_sidecar import translate_backends as tb

        class StubSession:
            def __init__(self, model_dir):
                self.model_dir = model_dir
            def translate(self, text, max_new_tokens=512):
                return f"UEBERSETZT:{text}", 4
        monkeypatch.setattr(tb, "Ct2OpusSession", StubSession)
        b = backends.make_backend("ct2_opus_translate")
        b.load(str(tmp_path), "cpu", "int8")
        assert b.is_loaded
        # direction is pair-baked: prompt/src/tgt/wrap are ignored
        text, n = b.translate("guten tag", "sys", "de", "en", True)
        assert text == "UEBERSETZT:guten tag" and n == 4
        b.unload()
        assert not b.is_loaded

    def test_load_error_wrapped(self, monkeypatch, tmp_path):
        from sokuji_sidecar import translate_backends as tb

        def boom(model_dir):
            raise RuntimeError("no such file")
        monkeypatch.setattr(tb, "Ct2OpusSession", boom)
        b = backends.make_backend("ct2_opus_translate")
        with pytest.raises(backends.BackendLoadError):
            b.load(str(tmp_path), "cpu", "int8")
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_translate_backends.py -q`
Expected: FAIL — `KeyError`/unknown backend `ct2_opus_translate`

- [ ] **Step 3: Swap the backend implementation**

In `sidecar/sokuji_sidecar/translate_backends.py`:

Replace the import line
```python
from .marian_onnx import MarianOnnxSession
```
with
```python
from .ct2_opus import Ct2OpusSession
```

Replace the module-docstring registry line
```
  opus_onnx_translate — MarianMT via ONNX Runtime, MarianOnnxSession
                        (pair-baked direction).
```
with
```
  ct2_opus_translate  — Opus-MT via CTranslate2 int8, Ct2OpusSession
                        (pair-baked direction).
```

Replace the whole `OpusOnnxTranslateBackend` class with:

```python
@register_backend
class Ct2OpusTranslateBackend:
    NAME = "ct2_opus_translate"

    def __init__(self):
        self._session = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._session = None
        try:
            path = model_ref
            if not os.path.isdir(path):
                from huggingface_hub import snapshot_download
                path = snapshot_download(model_ref, local_files_only=True)
            self._session = Ct2OpusSession(path)
        except Exception as e:
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str,
                  wrap: bool) -> tuple[str, int]:
        # The translation direction is baked into the model — system_prompt,
        # src, tgt and wrap are intentionally ignored.
        return self._session.translate(text)

    def unload(self) -> None:
        self._session = None

    @property
    def is_loaded(self) -> bool:
        return self._session is not None
```

In `sidecar/sokuji_sidecar/accel.py:157`, replace
```python
            "opus_onnx_translate": ("onnxruntime", "tokenizers")}
```
with
```python
            "ct2_opus_translate": ("ctranslate2", "sentencepiece")}
```

- [ ] **Step 4: Run the translate test files**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_translate_backends.py tests/test_translate_engine.py tests/test_backends.py -q`
Expected: PASS except any test still referencing `opus_onnx_translate` via catalog (fixed in Task 4 — if `test_catalog.py`/`test_accel.py` fail on the backend name here, note it and proceed; Task 4 makes the suite green).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/translate_backends.py sidecar/sokuji_sidecar/accel.py sidecar/tests/test_translate_backends.py
git commit -m "feat(sidecar): switch Opus-MT backend to CTranslate2"
```

---

### Task 4: Catalog rows + download file set

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (`_opus_repo` :249-250, `_opus_row` :269-274, backend name in Deployment, size comment :286-288, sizes in `TRANSLATE_MODELS` :308-314)
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`OPUS_FILES` :20-25)
- Test: `sidecar/tests/test_catalog.py`, `sidecar/tests/test_native_models.py` (adjust any assertions naming `opus_onnx_translate`, `Xenova/`, or the old file list)

**Interfaces:**
- Consumes: backend NAME `ct2_opus_translate` (Task 3).
- Produces: `_opus_repo(mid) == f"jiangzhuo9357/{mid}-ct2"`; `OPUS_FILES == ["config.json", "model.bin", "shared_vocabulary.json", "source.spm", "target.spm"]` — Task 7's uploads must match this layout exactly.

- [ ] **Step 1: Update tests first**

In `sidecar/tests/test_catalog.py` and `sidecar/tests/test_native_models.py`, update every assertion that references `opus_onnx_translate` → `ct2_opus_translate`, `Xenova/opus-mt-` → `jiangzhuo9357/opus-mt-` (+ `-ct2` suffix), and the old six-file ONNX list → the new five-file CT2 list. Add one explicit regression test to `test_native_models.py`:

```python
def test_opus_files_are_the_ct2_set():
    from sokuji_sidecar import native_models
    assert native_models.OPUS_FILES == [
        "config.json", "model.bin", "shared_vocabulary.json",
        "source.spm", "target.spm"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py tests/test_native_models.py -q`
Expected: FAIL on the updated assertions.

- [ ] **Step 3: Update catalog.py**

```python
def _opus_repo(mid: str) -> str:
    return f"jiangzhuo9357/{mid}-ct2"
```

In `_opus_row`, change the Deployment line to:

```python
        Deployment("ct2_opus_translate", "cpu", "int8", _opus_repo(mid), 1.0),
```

Update the size comment block (:286-288) to say the sizes are the 5-file sums of our `*-ct2` repos (see `OPUS_FILES`), and refresh each `_opus_row(...)` size literal from the uploaded repos (exact command in Task 7 Step 4 — until then the old literals remain but the suite must not assert on them).

- [ ] **Step 4: Update native_models.py**

Replace `OPUS_FILES` (and its comment) with:

```python
# The exact CTranslate2 export files the ct2_opus_translate backend reads
# (see ct2_opus.Ct2OpusSession). Our jiangzhuo9357/opus-mt-*-ct2 repos mirror
# the gaudi/opus-mt-*-ctranslate2 layout; pin the file set instead of
# snapshotting the repo.
OPUS_FILES = ["config.json", "model.bin", "shared_vocabulary.json",
              "source.spm", "target.spm"]
```

- [ ] **Step 5: Run the full sidecar suite**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: PASS (except `test_marian_onnx.py`, removed in Task 6 — if it fails due to unrelated import changes, that is a Task 3 regression: stop and fix).

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_catalog.py sidecar/tests/test_native_models.py
git commit -m "feat(sidecar): point Opus-MT cards at self-hosted CT2 assets"
```

---

### Task 5: Runtime dependency

**Files:**
- Modify: `sidecar/requirements.txt`
- Modify: `sidecar/setup.sh` (comment only — the "Stage runtimes" block at :30-36)

**Interfaces:**
- Produces: `ctranslate2==4.8.1` importable in the sidecar venv (consumed by Task 2's real runtime path and Task 7's e2e).

- [ ] **Step 1: Add the pin**

In `sidecar/requirements.txt`, after the `tokenizers>=0.20` line add:

```
# Opus-MT translation runtime (CPU int8; ~11x the old ORT numpy loop)
ctranslate2==4.8.1
```

Update the `setup.sh` stage-runtimes comment line `Translate -> llama-server binary (downloaded on demand) + Opus ONNX` to `Translate -> llama-server binary (downloaded on demand) + Opus CTranslate2`.

- [ ] **Step 2: Install + import check**

Run: `cd sidecar && .venv/bin/pip install -q -r requirements.txt && .venv/bin/python -c "import ctranslate2; print(ctranslate2.__version__)"`
Expected: `4.8.1`

- [ ] **Step 3: Commit**

```bash
git add sidecar/requirements.txt sidecar/setup.sh
git commit -m "feat(sidecar): add ctranslate2 runtime dependency"
```

---

### Task 6: Delete the Marian ONNX path

**Files:**
- Delete: `sidecar/sokuji_sidecar/marian_onnx.py`
- Delete: `sidecar/tests/test_marian_onnx.py`

- [ ] **Step 1: Delete + sweep for stragglers**

```bash
git rm sidecar/sokuji_sidecar/marian_onnx.py sidecar/tests/test_marian_onnx.py
grep -rn "marian\|opus_onnx" sidecar/ --include="*.py" ; echo "exit=$?"
```
Expected: grep exits 1 (no matches).

- [ ] **Step 2: Full suite**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: PASS, and `tests/test_torch_free_gate.py` still green.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(sidecar): remove Marian ONNX translation path"
```

---

### Task 7: Convert all pairs, upload, refresh sizes, end-to-end

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (size literals in `_opus_row(...)` calls :308-314)

**Interfaces:**
- Consumes: conversion script (Task 1), `OPUS_FILES` layout (Task 4).

- [ ] **Step 1: Convert the remaining 12 pairs**

Run: `/tmp/ct2-convert-venv/bin/python scripts/convert-opus-ct2.py`
Expected: 13 `[ok]`/`[skip]` lines; every output dir has the 5 required files.

- [ ] **Step 2: 🔒 OPERATOR GATE — upload to HF** (needs user consent + token; confirm org/naming first)

```bash
/tmp/ct2-convert-venv/bin/pip install -q huggingface_hub
/tmp/ct2-convert-venv/bin/python - <<'EOF'
from huggingface_hub import HfApi
from pathlib import Path
api = HfApi()   # HF_TOKEN from env
for d in sorted(Path("model-packs/opus-ct2").iterdir()):
    repo = f"jiangzhuo9357/{d.name}"
    api.create_repo(repo, exist_ok=True)
    api.upload_folder(folder_path=str(d), repo_id=repo,
                      allow_patterns=["config.json", "model.bin",
                                      "shared_vocabulary.json",
                                      "source.spm", "target.spm"])
    print("uploaded", repo)
EOF
```

- [ ] **Step 3: Regenerate the catalog size literals from the uploaded repos**

```bash
python3 - <<'EOF'
import json, urllib.request
PAIRS = ["ru-en","zh-en","en-zh","hu-en","en-es","en-ar","en-ru",
         "es-en","en-vi","ar-en","ja-en","en-jap","ko-en"]
NEED = {"config.json","model.bin","shared_vocabulary.json","source.spm","target.spm"}
for p in PAIRS:
    url = f"https://huggingface.co/api/models/jiangzhuo9357/opus-mt-{p}-ct2/tree/main"
    files = json.load(urllib.request.urlopen(url))
    total = sum(f["size"] for f in files if f["path"] in NEED)
    print(f'{p}: {total}')
EOF
```

Copy each printed total into the matching `_opus_row("<src>", "<tgt>", <order>, <size>)` literal in `catalog.py:308-314`, and update the comment at :286-288 to name the new basis (5-file CT2 sums, dated).

- [ ] **Step 4: End-to-end through the real engine** (ja-en; includes the 4 sentences the old loop returned empty)

```bash
cd sidecar && .venv/bin/python - <<'EOF'
import asyncio, sys
sys.path.insert(0, ".")
from sokuji_sidecar.native_models import download
from sokuji_sidecar.translate_engine import TranslateEngine

async def send(msg):          # progress sink; download() awaits it per chunk
    pass
asyncio.run(download("opus-mt-ja-en", send))   # pulls the 5 pinned files

eng = TranslateEngine()
ms = eng.init("opus-mt-ja-en", device="cpu")
print("init", ms, "ms; resolved:", eng.resolved)
assert eng.resolved["backend"] == "ct2_opus_translate"
sents = ["会議は何時からですか。",
         "この前教えてもらったレストラン、すごく美味しかったです。",
         "昨日の会議で話し合った内容をまとめて資料にしました。",
         "最近リモートワークが増えたおかげで通勤時間が減って助かっています。",
         "これでいいですか。"]
for s in sents:
    out, elapsed_ms = eng.translate(s)   # translate() returns (text, elapsed_ms)
    assert out.strip(), f"EMPTY translation for {s!r}"
    print(f"{elapsed_ms:5d}ms  {s} -> {out}")
eng.close()
EOF
```

Expected: `backend == ct2_opus_translate`, no empty outputs (old-bug regression), per-sentence times in the tens of milliseconds. (Signatures verified against `translate_engine.py:14` — `init(model_id, source_lang, target_lang, device, ...)` — and `native_models.py:290` — `async def download(model_id, send, ...)`.)

- [ ] **Step 5: Full suite + commit**

```bash
cd sidecar && .venv/bin/python -m pytest -q
git add sidecar/sokuji_sidecar/catalog.py
git commit -m "feat(sidecar): finalize CT2 Opus asset sizes from hosted repos"
```

---

## Post-plan notes (explicitly NOT tasks)

- Old Xenova ONNX snapshots in users' HF caches become orphans; they are
  harmless and reclaimable via the existing model-delete path or a cache
  clear. No automatic migration (YAGNI).
- WASM `local_inference` keeps using Xenova ONNX via transformers.js —
  unaffected by this plan.
- `beam_size` stays 1; the benchmark showed beam-2 costs +30% for a quality
  bump — revisit only if translation-quality feedback asks for it.
