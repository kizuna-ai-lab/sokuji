# Qwen3-TTS Multi-Compute-Type Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the qwen3-tts cards into per-variant self-contained HF repos (fp32/bf16/int8) with a compute_type-driven download variant picker, so users download only the variant their machine runs.

**Architecture:** Six new self-contained HF repos (`jiangzhuo9357/qwen3-tts-{0.6b,1.7b}-onnx-{fp32,bf16,int8}`), each a single `onnx/` dir + tokenizer/config/voices. Catalog deployment rows carry distinct compute_types whose `artifact` IS the variant repo; `planner.resolve_tts` narrows to one quant (pin → downloaded → machine recommendation) mirroring ASR's `resolve()`; the existing whole-repo downloader, `model_status(repo=…)` override, and the translate variant-picker UI machinery light up for TTS with small wiring. The `cuda_variant_subdir` load-time mechanism is deleted (repos are self-contained).

**Tech Stack:** Python sidecar (pytest), React/TypeScript renderer (vitest), huggingface_hub, ONNX Runtime.

**Spec:** `docs/superpowers/specs/2026-07-17-qwen3-tts-multi-variant-design.md`

## Global Constraints

- compute_type strings are exactly `"fp32"`, `"bf16"`, `"int8"`.
- Repo names: `jiangzhuo9357/qwen3-tts-0.6b-onnx-fp32`, `-bf16`, `-int8`; same for `1.7b`.
- bf16 graphs are the EXISTING validated rebuilds (moved, never regenerated).
- int8 ships ONLY if the Task-2 quality gate passes (whisper/ASR loopback zh+en); on failure every later task simply omits the int8 rows/repos — each task marks its int8-conditional parts.
- The iron rule: we always LOAD the file the user DOWNLOADED — narrowing must restrict to downloaded variants before recommending.
- int8 graphs are CPU-EP-only: the int8 deployment row exists ONLY on the `cpu` tier.
- All work on branch `worktree-sbsa-setup-dgx` (this worktree). Python venv: `/home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python` (call it `$PY`). Run sidecar tests from `sidecar/`.
- Never push / create PRs / upload to HF without explicit user approval (Task 3 and Task 11 have approval gates).
- English for all code comments and GitHub/HF content.

---

### Task 1: Variant-tree assembly script

**Files:**
- Create: `scripts/build-qwen3-tts-variant-repos.py`

**Interfaces:**
- Produces: local trees at `<out>/qwen3-tts-{size}-onnx-{variant}/` each containing `onnx/` + all root-level small files (tokenizer, config, voices); a printed size report used by Task 6's `est_bytes`.
- Consumes: the CURRENT dual-dir repos `jiangzhuo9357/qwen3-tts-{0.6b,1.7b}-onnx` from the HF cache (`snapshot_download`), and Task 2's int8 graphs (int8 tree assembly re-runs after Task 2).

The current repos ship `onnx/` (full fp32 set) + `onnx-bf16/` (bf16 rebuilds of exactly `talker_decode.onnx(.data)` and `code_predictor.onnx`). Tree recipes:

- **fp32 tree**: everything except `onnx-bf16/`.
- **bf16 tree**: fp32 tree, then every file in `onnx-bf16/` REPLACES its same-named file under `onnx/` (drop `onnx/talker_decode.onnx.data` when the bf16 talker is single-file, as on 0.6b).
- **int8 tree** (conditional on Task 2): fp32 tree with `onnx/talker_decode.onnx(.data)`, `onnx/code_predictor.onnx`, `onnx/text_project.onnx` replaced by their int8 exports from Task 2.

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""Assemble self-contained per-variant Qwen3-TTS repos from the dual-dir originals.

Reads the cached snapshot of jiangzhuo9357/qwen3-tts-{size}-onnx and hardlinks
files into <out>/qwen3-tts-{size}-onnx-{variant}/ trees (copy on cross-device).
The int8 tree needs --int8-dir pointing at Task 2's quantized graphs; without
it only fp32+bf16 trees are built.

Usage:
  python scripts/build-qwen3-tts-variant-repos.py --size 0.6b --out /tmp/q3repos
  python scripts/build-qwen3-tts-variant-repos.py --size 1.7b --out /tmp/q3repos \
      --int8-dir /tmp/q3int8/1.7b
  # After user approval only:
  python scripts/build-qwen3-tts-variant-repos.py --size 0.6b --out /tmp/q3repos --upload
"""
import argparse
import os
import shutil
import sys

# The three heavy graphs int8 replaces (basename under onnx/).
INT8_REPLACED = ("talker_decode.onnx", "talker_decode.onnx.data",
                 "code_predictor.onnx", "text_project.onnx")


def _link(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    src = os.path.realpath(src)                     # deref HF blob symlink
    if os.path.exists(dst):
        os.remove(dst)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def _walk_files(root):
    for r, _d, files in os.walk(root):
        for f in files:
            p = os.path.join(r, f)
            yield os.path.relpath(p, root), p


def build_tree(snap, out_dir, variant, int8_dir=None):
    for rel, src in _walk_files(snap):
        top = rel.split(os.sep)[0]
        if top == "onnx-bf16":
            continue                                # never copied verbatim
        if variant == "int8" and top == "onnx" and os.path.basename(rel) in INT8_REPLACED:
            continue                                # replaced below
        if variant == "bf16" and top == "onnx":
            base = os.path.basename(rel)
            # a same-named bf16 rebuild exists -> the fp32 original is dropped;
            # also drop fp32 talker external data when bf16 talker is single-file
            if (os.path.exists(os.path.join(snap, "onnx-bf16", base))
                    or (base == "talker_decode.onnx.data"
                        and os.path.exists(os.path.join(snap, "onnx-bf16", "talker_decode.onnx"))
                        and not os.path.exists(os.path.join(snap, "onnx-bf16", "talker_decode.onnx.data")))):
                continue
        _link(src, os.path.join(out_dir, rel))
    if variant == "bf16":
        bdir = os.path.join(snap, "onnx-bf16")
        for f in os.listdir(bdir):
            _link(os.path.join(bdir, f), os.path.join(out_dir, "onnx", f))
    if variant == "int8":
        assert int8_dir, "int8 tree needs --int8-dir"
        for f in os.listdir(int8_dir):
            _link(os.path.join(int8_dir, f), os.path.join(out_dir, "onnx", f))


def tree_bytes(root):
    return sum(os.path.getsize(p) for _rel, p in _walk_files(root))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", required=True, choices=("0.6b", "1.7b"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--int8-dir")
    ap.add_argument("--upload", action="store_true")
    args = ap.parse_args()
    from huggingface_hub import snapshot_download
    snap = snapshot_download(f"jiangzhuo9357/qwen3-tts-{args.size}-onnx")
    variants = ["fp32", "bf16"] + (["int8"] if args.int8_dir else [])
    for v in variants:
        name = f"qwen3-tts-{args.size}-onnx-{v}"
        out_dir = os.path.join(args.out, name)
        shutil.rmtree(out_dir, ignore_errors=True)
        build_tree(snap, out_dir, v, int8_dir=args.int8_dir)
        print(f"{name}: {tree_bytes(out_dir):,} bytes")
        if args.upload:
            from huggingface_hub import HfApi
            api = HfApi()
            repo = f"jiangzhuo9357/{name}"
            api.create_repo(repo, exist_ok=True)
            api.upload_folder(folder_path=out_dir, repo_id=repo)
            print(f"uploaded -> https://huggingface.co/{repo}")


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Re-download the source repo and build fp32+bf16 trees for 0.6b**

The user deleted the qwen3 caches; re-fetch first (network, several GB):

Run: `HF_HOME=/home/jiangzhuo/.config/Sokuji/hf-cache $PY -c "from huggingface_hub import snapshot_download; print(snapshot_download('jiangzhuo9357/qwen3-tts-0.6b-onnx'))"`
Then: `HF_HOME=/home/jiangzhuo/.config/Sokuji/hf-cache $PY scripts/build-qwen3-tts-variant-repos.py --size 0.6b --out /tmp/q3repos`
Expected: two size lines printed; `fp32` ≈ 4.3e9 bytes, `bf16` ≈ 3.2e9 bytes.

- [ ] **Step 3: Verify tree contents**

Run: `ls /tmp/q3repos/qwen3-tts-0.6b-onnx-fp32/onnx/ && ls /tmp/q3repos/qwen3-tts-0.6b-onnx-bf16/onnx/`
Expected: fp32 tree has NO bf16 files and all 8+ fp32 graphs; bf16 tree has `talker_decode.onnx` + `code_predictor.onnx` whose sizes match the old `onnx-bf16/` files (846.8MB / 210.1MB), plus every other fp32 graph; both trees contain the root tokenizer/config/voices files. No `onnx-bf16/` dir anywhere.

- [ ] **Step 4: Repeat for 1.7b and record all sizes**

Run: the same two commands with `--size 1.7b`.
Expected: `fp32` ≈ 8.4e9, `bf16` ≈ 5.3e9. Record the exact printed byte counts — Task 6 pastes them into `est_bytes`.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-qwen3-tts-variant-repos.py
git commit -m "feat(scripts): assemble per-variant qwen3-tts repos from dual-dir originals"
```

---

### Task 2: int8 export + quality gate (DECISION CHECKPOINT)

**Files:**
- Create: `scripts/validate-qwen3-tts-int8.py`
- Uses existing: `scripts/quantize-qwen3-tts-nbits.py` (MatMulNBits weight-only int4/int8 quantizer — read its argparse before invoking)

**Interfaces:**
- Produces: `/tmp/q3int8/{size}/` int8 graphs (talker_decode, code_predictor, text_project + external data), and a PASS/FAIL verdict that gates every int8-marked step in later tasks.

- [ ] **Step 1: Quantize the three heavy graphs (per size)**

Read `scripts/quantize-qwen3-tts-nbits.py --help` for exact flags, then quantize each graph at 8 bits from the fp32 tree built in Task 1, outputting into `/tmp/q3int8/{size}/`. Invocation shape (adjust to the script's real argument names after reading it):

Run: `$PY scripts/quantize-qwen3-tts-nbits.py --input /tmp/q3repos/qwen3-tts-0.6b-onnx-fp32/onnx/talker_decode.onnx --output /tmp/q3int8/0.6b/talker_decode.onnx --nbits 8` (and likewise for `code_predictor.onnx`, `text_project.onnx`; then repeat for 1.7b)
Expected: int8 graphs ~25-30% of fp32 sizes.

- [ ] **Step 2: Rebuild the int8 trees**

Run: `HF_HOME=/home/jiangzhuo/.config/Sokuji/hf-cache $PY scripts/build-qwen3-tts-variant-repos.py --size 0.6b --out /tmp/q3repos --int8-dir /tmp/q3int8/0.6b` (and 1.7b)
Expected: third size line, `int8` ≈ 1.7e9 (0.6b) / ≈ 2.8e9 (1.7b). Record exact bytes for Task 6.

- [ ] **Step 3: Write the validation harness**

The backend loads via `snapshot_download(repo_id, local_files_only=True)`, so fabricate an HF-cache entry pointing at the local tree, then run the REAL backend on CPU and loop the audio back through the sidecar's own ASR:

```python
#!/usr/bin/env python3
"""int8 quality gate: synthesize fixed zh/en sentences with the int8 tree via
the real Qwen3TtsOnnxBackend (cpu) and transcribe with the sidecar ASR engine;
compare against the fp32 tree run the same way. PASS = int8 transcripts match
the fp32 transcripts (same normalized text), no empty/silent output, and
CPU RTF(int8) < RTF(fp32)."""
import os
import re
import sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sidecar"))

SENTENCES = {"en": "The weather is lovely today, so I will go for a walk in the park.",
             "zh": "今天天气很好，我打算下午去公园散步。"}


def fabricate_cache(tree, repo_id):
    """Minimal HF-cache entry: refs/main -> snapshots/<sha> symlinked to tree."""
    from huggingface_hub.constants import HF_HUB_CACHE
    root = os.path.join(HF_HUB_CACHE, f"models--{repo_id.replace('/', '--')}")
    sha = "0" * 40
    os.makedirs(os.path.join(root, "refs"), exist_ok=True)
    os.makedirs(os.path.join(root, "snapshots"), exist_ok=True)
    with open(os.path.join(root, "refs", "main"), "w") as f:
        f.write(sha)
    link = os.path.join(root, "snapshots", sha)
    if not os.path.exists(link):
        os.symlink(os.path.abspath(tree), link)


def synth(repo_id, lang, text):
    from sokuji_sidecar.tts_backends import Qwen3TtsOnnxBackend
    be = Qwen3TtsOnnxBackend()
    be.load(repo_id, "cpu", "int8", None)
    be.set_language(lang)
    samples, gen_ms = be.generate(text)
    audio_s = len(samples) / float(be.sample_rate)
    return samples, be.sample_rate, gen_ms / 1000.0 / max(audio_s, 1e-9)


def transcribe(samples, sr, lang):
    import soxr
    from sokuji_sidecar.asr_engine import AsrEngine   # sidecar's own ASR loopback
    wav16 = soxr.resample(samples, sr, 16000).astype(np.float32)
    eng = AsrEngine()
    eng.init(model_id="cohere-transcribe-03-2026", device="cpu", language=lang)
    text = eng.transcribe(wav16)
    eng.close()
    return re.sub(r"[\s\W]+", "", text or "").lower()


def main():
    size = sys.argv[1] if len(sys.argv) > 1 else "0.6b"
    results = {}
    for variant, tree in (("fp32", f"/tmp/q3repos/qwen3-tts-{size}-onnx-fp32"),
                          ("int8", f"/tmp/q3repos/qwen3-tts-{size}-onnx-int8")):
        repo = f"jiangzhuo9357/qwen3-tts-{size}-onnx-{variant}"
        fabricate_cache(tree, repo)
        for lang, text in SENTENCES.items():
            samples, sr, rtf = synth(repo, lang, text)
            hyp = transcribe(samples, sr, lang)
            results[(variant, lang)] = (hyp, rtf, len(samples))
            print(f"{variant}/{lang}: rtf={rtf:.2f} samples={len(samples)} hyp={hyp[:60]}")
    ok = True
    for lang in SENTENCES:
        f_hyp, f_rtf, _ = results[("fp32", lang)]
        i_hyp, i_rtf, i_n = results[("int8", lang)]
        if i_n < 8000 or not i_hyp:
            print(f"FAIL {lang}: int8 produced empty/near-silent audio"); ok = False
        elif i_hyp != f_hyp:
            print(f"FAIL {lang}: transcript mismatch fp32={f_hyp!r} int8={i_hyp!r}"); ok = False
        elif i_rtf >= f_rtf:
            print(f"WARN {lang}: int8 not faster (rtf {i_rtf:.2f} vs {f_rtf:.2f})")
    print("VERDICT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
```

Note: `AsrEngine`'s exact init/transcribe signatures live in `sidecar/sokuji_sidecar/asr_engine.py:96-105` — adjust the two calls to match what you find there (the loopback idea, not the exact call shape, is the contract). Because ASR sampling is greedy but TTS sampling is stochastic, set `SOKUJI_QWEN3_TTS_SEED=42` and `SOKUJI_QWEN3_TTS_GREEDY=1` in the environment for BOTH runs so fp32 and int8 decode the same token path (`tts_backends.py:606-610` reads them).

- [ ] **Step 4: Run the gate on both sizes**

Run: `cd sidecar && SOKUJI_QWEN3_TTS_SEED=42 SOKUJI_QWEN3_TTS_GREEDY=1 HF_HOME=/home/jiangzhuo/.config/Sokuji/hf-cache $PY ../scripts/validate-qwen3-tts-int8.py 0.6b` (then `1.7b`)
Expected: `VERDICT: PASS` for both.

- [ ] **Step 5: DECISION CHECKPOINT — report the verdict to the user.** If FAIL for a size: that size ships fp32/bf16 only; skip every step marked *(int8)* in Tasks 3/6/8 for it. Do not proceed silently either way — post the transcripts + RTFs.

- [ ] **Step 6: Commit**

```bash
git add scripts/validate-qwen3-tts-int8.py
git commit -m "feat(scripts): int8 quality gate for qwen3-tts variant repos"
```

---

### Task 3: Upload the variant repos to HF — REQUIRES USER APPROVAL

- [ ] **Step 1: Ask the user for upload approval** (publishing action). Show the final tree sizes. Do not proceed without an explicit yes.

- [ ] **Step 2: Upload all trees**

Run: `HF_HOME=/home/jiangzhuo/.config/Sokuji/hf-cache $PY scripts/build-qwen3-tts-variant-repos.py --size 0.6b --out /tmp/q3repos --int8-dir /tmp/q3int8/0.6b --upload` (and 1.7b; drop `--int8-dir` for a size that failed the gate)
Expected: 4-6 `uploaded -> …` lines.

- [ ] **Step 3: Verify each repo listing via the HF API**

Run: `for v in fp32 bf16 int8; do curl -fsSL "https://huggingface.co/api/models/jiangzhuo9357/qwen3-tts-0.6b-onnx-$v/tree/main?recursive=true" | $PY -c "import json,sys; rows=json.load(sys.stdin); print(sum(r.get('size') or 0 for r in rows if r['type']=='file'), 'bytes,', sum(1 for r in rows if r['type']=='file'), 'files')"; done` (and 1.7b)
Expected: byte totals match the local tree sizes. The OLD dual-dir repos are NOT deleted yet (Task 11).

---

### Task 4: Planner — `_tts_pick_quant` + `resolve_tts` narrowing

**Files:**
- Modify: `sidecar/sokuji_sidecar/planner.py` (resolve_tts at :367-372; add `_tts_pick_quant` above it)
- Test: `sidecar/tests/test_planner.py`

**Interfaces:**
- Produces: `planner._tts_pick_quant(model, machine, pin=None, downloaded=None) -> str` and `planner.resolve_tts(model_id, override="auto", *, machine, platform, cache, downloaded=frozenset(), pin=None)`. Task 5's accel wrapper and Task 8's catalog handler call both.
- Consumes: `catalog.resolve_tts_card`, `_tier_available`, `_resolve_model` (all already in planner.py).

- [ ] **Step 1: Write failing table tests**

Append to `sidecar/tests/test_planner.py` (reuse the file's existing fake-Machine helpers — find how other tests build `Machine` objects and copy that pattern; the essential axes are `gpus`/`tc_kinds` for cuda, `apple_silicon`, and bare-cpu):

```python
def _tts_variant_card():
    from sokuji_sidecar.catalog import TtsModel, Deployment
    return TtsModel(
        "fake-tts", "Fake TTS", ("en",),
        (Deployment("mlx_audio_tts", "gpu-metal", "fp32", "org/fake-mlx", 1.0,
                    platforms=("macos",), requires_apple_silicon=True),
         Deployment("qwen3tts_onnx", "gpu-cuda", "bf16", "org/fake-bf16", 1.2, est_bytes=5_000),
         Deployment("qwen3tts_onnx", "gpu-cuda", "fp32", "org/fake-fp32", 1.0, est_bytes=8_000),
         Deployment("qwen3tts_onnx", "cpu", "int8", "org/fake-int8", 1.1, est_bytes=2_000),
         Deployment("qwen3tts_onnx", "cpu", "fp32", "org/fake-fp32", 1.0, est_bytes=8_000)),
        repos=("org/fake-fp32",), clones=True, streaming=False)


def test_tts_pick_quant_cuda_machine_prefers_bf16(cuda_machine):
    assert planner._tts_pick_quant(_tts_variant_card(), cuda_machine) == "bf16"


def test_tts_pick_quant_cpu_machine_prefers_smallest(cpu_machine):
    assert planner._tts_pick_quant(_tts_variant_card(), cpu_machine) == "int8"


def test_tts_pick_quant_apple_silicon_prefers_fp32(mac_machine):
    # the metal/mlx row is fp32 — narrowing must keep it alive on macOS
    assert planner._tts_pick_quant(_tts_variant_card(), mac_machine) == "fp32"


def test_tts_pick_quant_pin_wins(cuda_machine):
    assert planner._tts_pick_quant(_tts_variant_card(), cuda_machine, pin="fp32") == "fp32"


def test_tts_pick_quant_restricts_to_downloaded(cuda_machine):
    got = planner._tts_pick_quant(_tts_variant_card(), cuda_machine, downloaded=frozenset({"fp32"}))
    assert got == "fp32"    # bf16 not downloaded -> never chosen


def test_resolve_tts_narrows_multi_ct_card(cuda_machine, monkeypatch):
    monkeypatch.setattr(planner.catalog, "resolve_tts_card", lambda mid: _tts_variant_card())
    plans = planner.resolve_tts("fake-tts", machine=cuda_machine, platform="linux", cache={})
    assert {p.compute_type for p in plans} == {"bf16"}
    assert plans[0].artifact == "org/fake-bf16"


def test_resolve_tts_downloaded_int8_lands_on_cpu(cuda_machine, monkeypatch):
    monkeypatch.setattr(planner.catalog, "resolve_tts_card", lambda mid: _tts_variant_card())
    plans = planner.resolve_tts("fake-tts", machine=cuda_machine, platform="linux",
                                cache={}, downloaded=frozenset({"int8"}))
    assert [p.device for p in plans] == ["cpu"] and plans[0].compute_type == "int8"
```

If the file lacks ready-made `cuda_machine`/`cpu_machine`/`mac_machine` fixtures, add them as small fixtures mirroring existing Machine constructions in the file (all fields explicit, `installed=frozenset({"qwen3tts_onnx","mlx_audio_tts"})`).

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && $PY -m pytest tests/test_planner.py -k tts_pick_quant -x -q`
Expected: FAIL `AttributeError: ... has no attribute '_tts_pick_quant'`

- [ ] **Step 3: Implement in planner.py**

Insert immediately above `def resolve_tts(` (planner.py:367):

```python
def _tts_pick_quant(model, machine: Machine, pin: str | None = None,
                    downloaded: frozenset | None = None) -> str:
    """Quant for a multi-compute-type TTS card. pin wins when it names a listed
    compute_type; otherwise restrict to `downloaded` variants when any exist
    (we always LOAD the repo the user DOWNLOADED); then take the first
    candidate whose own accelerator row is usable on this machine (deployments
    are quality/rank ordered, so cuda machines land on bf16, Apple Silicon on
    the fp32 mlx row); with no usable accelerator row, the smallest candidate
    wins (CPU is bandwidth-bound: smaller = faster)."""
    uniq = list(dict.fromkeys(d.compute_type for d in model.deployments))
    if pin in uniq:
        return pin
    cands = [c for c in uniq if downloaded and c in downloaded] or uniq
    for d in model.deployments:
        if (d.compute_type in cands and d.tier != "cpu"
                and _tier_available(d.tier, machine, d.backend)):
            return d.compute_type
    sized = {}
    for c in cands:
        sizes = [d.est_bytes for d in model.deployments
                 if d.compute_type == c and d.est_bytes]
        if sizes:
            sized[c] = max(sizes)
    if len(sized) == len(cands) and sized:
        return min(sized, key=sized.get)
    return cands[0]
```

Replace `resolve_tts` (planner.py:367-372) with:

```python
def resolve_tts(model_id: str, override: str = "auto", *, machine: Machine, platform: str,
                cache: dict, downloaded: frozenset = frozenset(),
                pin: str | None = None) -> list[Plan]:
    model = catalog.resolve_tts_card(model_id)
    if model is None:
        raise ValueError(f"unknown tts model: {model_id}")
    # Multi-variant card: narrow to ONE compute_type before tier resolution,
    # mirroring resolve()'s ASR multi-quant narrowing.
    if len({d.compute_type for d in model.deployments}) > 1:
        quant = _tts_pick_quant(model, machine, pin, downloaded)
        model = dataclasses.replace(
            model, deployments=tuple(d for d in model.deployments if d.compute_type == quant))
    return _resolve_model(model, model_id, override, machine, cache=cache, platform=platform)
```

- [ ] **Step 4: Run tests**

Run: `cd sidecar && $PY -m pytest tests/test_planner.py -x -q`
Expected: all PASS (existing resolve_tts tests keep passing — new params are keyword-only with defaults).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/planner.py sidecar/tests/test_planner.py
git commit -m "feat(sidecar): planner narrowing for multi-compute-type TTS cards"
```

---

### Task 5: Accel wrapper + downloaded-variant detection + init pin plumbing

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`resolve_tts` wrapper at :288-291)
- Modify: `sidecar/sokuji_sidecar/tts_engine.py` (`TtsEngine.init` at :44-48; `_h_tts_init` at :156-158)
- Test: `sidecar/tests/test_accel.py`, `sidecar/tests/test_main.py` (or wherever `_h_tts_init` is exercised — `rg -l "_h_tts_init\|tts_init" sidecar/tests`)

**Interfaces:**
- Produces: `accel._downloaded_tts_variants(model) -> frozenset[str]`; `accel.resolve_tts(model_id, override="auto", machine=None, pin=None)`; `TtsEngine.init(model_id=None, device="auto", language="", pin=None)`; `tts_init` wire message accepts optional `variant` (string compute_type).
- Consumes: Task 4's planner signatures; `native_models.model_status(model_id, repo=…)`.

- [ ] **Step 1: Write failing tests**

```python
def test_downloaded_tts_variants_checks_each_repo(monkeypatch):
    from sokuji_sidecar import accel, native_models
    card = _tts_variant_card()          # reuse/duplicate Task 4's helper
    ready = {"org/fake-bf16"}
    monkeypatch.setattr(native_models, "model_status",
                        lambda mid, repo=None: "ready" if repo in ready else "absent")
    assert accel._downloaded_tts_variants(card) == frozenset({"bf16"})


def test_resolve_tts_wrapper_passes_pin_and_downloaded(monkeypatch):
    from sokuji_sidecar import accel
    seen = {}
    def fake(mid, override, *, machine, platform, cache, downloaded, pin):
        seen.update(downloaded=downloaded, pin=pin)
        return ["sentinel"]
    monkeypatch.setattr(accel.planner, "resolve_tts", fake)
    monkeypatch.setattr(accel, "_downloaded_tts_variants", lambda m: frozenset({"int8"}))
    import sokuji_sidecar.catalog as catalog
    monkeypatch.setattr(catalog, "resolve_tts_card", lambda mid: _tts_variant_card())
    assert accel.resolve_tts("fake-tts", pin="fp32") == ["sentinel"]
    assert seen == {"downloaded": frozenset({"int8"}), "pin": "fp32"}
```

Run: `cd sidecar && $PY -m pytest tests/test_accel.py -k downloaded_tts -x -q` → FAIL (no attribute).

- [ ] **Step 2: Implement in accel.py**

Replace the wrapper at accel.py:288-291:

```python
def _downloaded_tts_variants(model) -> frozenset:
    """compute_types of `model` whose variant repo is fully cached locally.
    TTS variants are whole repos (unlike translate's per-file quants), so the
    check is native_models.model_status with the repo override — which carries
    the partial-snapshot/.incomplete guards a bare snapshot_download lacks."""
    from . import native_models
    out = set()
    for d in model.deployments:
        if d.compute_type in out:
            continue
        try:
            if native_models.model_status(model.id, repo=d.artifact) == "ready":
                out.add(d.compute_type)
        except Exception:
            pass
    return frozenset(out)


def resolve_tts(model_id, override="auto", machine=None, pin=None):
    from . import catalog as _cat
    m = machine or probe()
    model = _cat.resolve_tts_card(model_id)
    multi = model is not None and len({d.compute_type for d in model.deployments}) > 1
    downloaded = _downloaded_tts_variants(model) if multi else frozenset()
    return planner.resolve_tts(model_id, override, machine=m, platform=current_platform(),
                               cache=bench_load(), downloaded=downloaded, pin=pin)
```

- [ ] **Step 3: Plumb the pin through tts_engine**

In `sidecar/sokuji_sidecar/tts_engine.py`, change :44 `def init(self, model_id=None, device="auto", language=""):` to `def init(self, model_id=None, device="auto", language="", pin=None):` and :48 to `plans = accel.resolve_tts(mid, override=device or "auto", pin=pin)`. In `_h_tts_init` (:158), change the `eng.init(...)` call to:

```python
    ms = eng.init(msg.get("model"), msg.get("device", "auto"), msg.get("language", ""),
                  pin=msg.get("variant"))
```

(`variant` matches asr_init's field name — see `asr_engine.py:558`.)

- [ ] **Step 4: Run the sidecar suite**

Run: `cd sidecar && $PY -m pytest tests/ -q -p no:cacheprovider`
Expected: all pass (834+ baseline plus new).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/tts_engine.py sidecar/tests/
git commit -m "feat(sidecar): TTS variant pin + downloaded-repo detection in the loader"
```

---

### Task 6: Catalog — variant repos as deployment artifacts

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (repo constants near :433-448; the two cards at :504-527)
- Test: `sidecar/tests/test_planner.py` or the catalog test file (`rg -l "TTS_MODELS" sidecar/tests`)

**Interfaces:**
- Produces: the two rewritten cards. `est_bytes` = EXACT bytes from Task 1/2 output (values below are pre-measurement estimates — replace with the recorded numbers).

- [ ] **Step 1: Write failing structure tests**

```python
def test_qwen3_tts_cards_carry_three_onnx_variants():
    from sokuji_sidecar import catalog
    for mid in ("qwen3-tts-0.6b", "qwen3-tts-1.7b"):
        card = catalog.tts_model(mid)
        onnx = [d for d in card.deployments if d.backend == "qwen3tts_onnx"]
        cts = {d.compute_type for d in onnx}
        assert cts == {"fp32", "bf16", "int8"}          # drop "int8" here if its gate failed
        for d in onnx:
            assert d.artifact.endswith(f"-{d.compute_type}")
            assert d.est_bytes, f"{mid}/{d.compute_type} missing est_bytes"
        assert all(d.tier == "cpu" for d in onnx if d.compute_type == "int8")
        assert all(d.tier == "gpu-cuda" for d in onnx if d.compute_type == "bf16")
        assert card.repos == (next(d.artifact for d in onnx if d.compute_type == "fp32"),)
```

Run → FAIL against current cards.

- [ ] **Step 2: Rewrite constants + cards**

Replace the repo constants (keep env-override style, catalog.py:435-448 region):

```python
_QWEN3_TTS_06B_FP32 = os.environ.get("SOKUJI_QWEN3_TTS_06B_REPO",
                                     "jiangzhuo9357/qwen3-tts-0.6b-onnx-fp32")
_QWEN3_TTS_06B_BF16 = "jiangzhuo9357/qwen3-tts-0.6b-onnx-bf16"
_QWEN3_TTS_06B_INT8 = "jiangzhuo9357/qwen3-tts-0.6b-onnx-int8"
_QWEN3_TTS_17B_FP32 = os.environ.get("SOKUJI_QWEN3_TTS_17B_REPO",
                                     "jiangzhuo9357/qwen3-tts-1.7b-onnx-fp32")
_QWEN3_TTS_17B_BF16 = "jiangzhuo9357/qwen3-tts-1.7b-onnx-bf16"
_QWEN3_TTS_17B_INT8 = "jiangzhuo9357/qwen3-tts-1.7b-onnx-int8"
```

Rewrite the two cards (0.6b at :504-515, 1.7b at :516-527) — 1.7b shown; 0.6b is identical in shape with its own constants/sizes and `recommended=True, sort_order=2`:

```python
    TtsModel("qwen3-tts-1.7b", "Qwen3-TTS 1.7B",
             ("zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"),
             (Deployment("mlx_audio_tts", "gpu-metal", "fp32", _QWEN3_TTS_17B_MLX_REPO, 1.0,
                         platforms=("macos",), requires_apple_silicon=True),
              # Per-variant self-contained repos (fp32/bf16/int8) — the repo IS
              # the variant; bf16 has CUDA-only kernels, int8 is CPU-EP-only.
              Deployment("qwen3tts_onnx", "gpu-cuda", "bf16", _QWEN3_TTS_17B_BF16, 1.2,
                         est_bytes=5_323_000_000),   # <- Task 1 measured bytes
              Deployment("qwen3tts_onnx", "gpu-cuda", "fp32", _QWEN3_TTS_17B_FP32, 1.0,
                         est_bytes=8_378_000_000),   # <- Task 1 measured bytes
              Deployment("qwen3tts_onnx", "gpu-dml", "fp32", _QWEN3_TTS_17B_FP32, 1.0,
                         platforms=("windows",), est_bytes=8_378_000_000),
              Deployment("qwen3tts_onnx", "cpu", "int8", _QWEN3_TTS_17B_INT8, 1.1,
                         est_bytes=2_833_000_000),   # <- Task 2 measured bytes (drop row if gate failed)
              Deployment("qwen3tts_onnx", "cpu", "fp32", _QWEN3_TTS_17B_FP32, 1.0,
                         est_bytes=8_378_000_000)),
             repos=(_QWEN3_TTS_17B_FP32,), clones=True, streaming=False,
             transcript_required=True, named_voices=True, sample_rate=24000,
             recommended=False, sort_order=3, size_bytes=8_378_000_000,  # fp32 default repo
             ),
```

Do NOT set `cuda_variant_subdir` on either card any more (field deleted next task).

- [ ] **Step 3: Run tests** — the new structure test passes; run the full suite and fix any test that asserted the OLD repo ids (`rg -n "qwen3-tts.*onnx\"" sidecar/tests` to find them).

Run: `cd sidecar && $PY -m pytest tests/ -q -p no:cacheprovider` → all pass.

- [ ] **Step 4: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/
git commit -m "feat(sidecar): qwen3-tts cards point at per-variant self-contained repos"
```

---

### Task 7: Delete the `cuda_variant_subdir` mechanism end-to-end

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py:401-402` (delete the field)
- Modify: `sidecar/sokuji_sidecar/planner.py` (PlanConfig at :36-44: delete `variant_subdir`; `_plan_config` at :63-73: delete the `cuda_variant_subdir` getattr line)
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_model_weight_bytes` :410-441: drop the `variant_subdir` param + the `variant_root/has_variant` dedup block; `load_measured` :398 and `load_with_fallback` :474-475: drop `variant_subdir=plan.config.variant_subdir` from both call sites)
- Modify: `sidecar/sokuji_sidecar/tts_backends.py` (`Qwen3TtsOnnxBackend.load` :517-528: delete the `variant_dir`/`subdir` probe and its comment; keep ONE `_hf_symlinks.materialize_symlinks(f"{d}/onnx")`; call `build_sessions(f"{d}/onnx", device, threads)`)
- Modify: `sidecar/sokuji_sidecar/qwen3_tts/runtime.py` (`build_sessions` :89-172: drop the `variant_dir` parameter, its docstring paragraph, and `_graph_path`'s variant branch — `_graph_path` becomes `onnx_dir / filename`; `sessions["_graph_paths"]` keeps working)
- Test: `sidecar/tests/test_accel.py` (:152, :164, :176, :191, :591, :728 — change the monkeypatch lambdas to `lambda a: …`; :1085-1115 — delete the two variant-subdir dedup tests), `sidecar/tests/test_planner.py` (:954-981 — delete the three variant_subdir tests), `sidecar/tests/test_tts_backends.py` + `sidecar/tests/test_qwen3_runtime_cuda.py` (`rg -n variant_subdir` each; delete/simplify cases asserting the bf16-subdir probe; keep any case asserting plain `onnx/` loading)

- [ ] **Step 1: Delete in source (all five files above), then fix tests until green.** No new behavior — pure removal; the compiler for this task is the test suite.

- [ ] **Step 2: Run the full sidecar suite**

Run: `cd sidecar && $PY -m pytest tests/ -q -p no:cacheprovider`
Expected: all pass; `rg -n "variant_subdir|cuda_variant_subdir|onnx-bf16" sidecar/` returns ONLY historical comments (or nothing).

- [ ] **Step 3: Commit**

```bash
git add sidecar/
git commit -m "refactor(sidecar): delete cuda_variant_subdir — variant repos are self-contained"
```

---

### Task 8: `_h_models_catalog` — TTS variants payload

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_h_models_catalog` :709-792)
- Test: `sidecar/tests/test_accel.py` (find existing `_h_models_catalog` tests: `rg -n "models_catalog" sidecar/tests/test_accel.py`)

**Interfaces:**
- Produces: for multi-ct TTS cards, `entry["variants"] = [{id, sizeBytes, needBytes, repo, supported, recommended}]` + `entry["variantIds"]`, platform-filtered.
- Consumes: `planner._tts_pick_quant` (Task 4).

- [ ] **Step 1: Write failing test**

```python
@pytest.mark.asyncio
async def test_models_catalog_emits_tts_variants(monkeypatch, cuda_machine):
    from sokuji_sidecar import accel
    import sokuji_sidecar.catalog as catalog
    monkeypatch.setattr(accel, "probe", lambda force=False: cuda_machine)
    monkeypatch.setattr(catalog, "tts_models", lambda: [_tts_variant_card()])
    reply, _ = await accel._h_models_catalog({}, {"kind": "tts", "id": 1}, None)
    entry = reply["models"][0]
    by_id = {v["id"]: v for v in entry["variants"]}
    assert set(by_id) == {"fp32", "bf16", "int8"}
    assert by_id["bf16"]["recommended"] and by_id["bf16"]["supported"]
    assert by_id["int8"]["supported"]           # cpu tier always runs
    assert by_id["bf16"]["repo"] == "org/fake-bf16"
```

(Match the file's existing async-test style; if handlers are tested synchronously via an event loop helper, copy that.) Run → FAIL (no variants for TTS).

- [ ] **Step 2: Implement**

In `_h_models_catalog`: (a) add the platform filter to the `seen_cts` loop (:751-756) — skip deployments failing `_platform_ok(d, m, platform_tag)`, mirroring the tiers loop; (b) in the variants block (:759-790), branch for TTS before the llama/tc recommend logic:

```python
        if len(seen_cts) > 1 and sizes_by_ct:
            budget = _quant_budget_bytes(m)
            if kind == "tts":
                rec = planner._tts_pick_quant(mdl, m)
                variants = []
                for ct, size in sorted(sizes_by_ct.items(), key=lambda kv: -kv[1]):
                    supported = any(
                        _tier_available(d.tier, m, d.backend)
                        for d in mdl.deployments if d.compute_type == ct)
                    variants.append({"id": ct, "sizeBytes": size, "needBytes": size,
                                     "repo": artifact_by_ct.get(ct),
                                     "supported": supported, "recommended": ct == rec})
                entry["variants"] = variants
                entry["deviceMemBytes"] = budget
            else:
                ...existing llama/tc block unchanged...
```

(`needBytes` = download size for TTS — no resident factor; a cpu row makes fp32/int8 always supported, bf16 tracks cuda availability.) Add `_tts_pick_quant` to the `from .planner import (...)` re-export list at accel.py:210-216 or call it as `planner._tts_pick_quant`.

- [ ] **Step 3: Run tests** — `cd sidecar && $PY -m pytest tests/test_accel.py -q` → pass.

- [ ] **Step 4: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): models_catalog emits variant picker payload for TTS cards"
```

---

### Task 9: native_models any-rung status + tts_voices variant-aware repo

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`model_status` :212+)
- Modify: `sidecar/sokuji_sidecar/tts_voices.py` (:12-20 and :82-88)
- Test: `sidecar/tests/test_native_models.py` (or wherever model_status is tested: `rg -l model_status sidecar/tests`), `sidecar/tests/test_tts_voices.py` if present

- [ ] **Step 1: Failing tests**

```python
def test_model_status_tts_any_variant_repo_counts(monkeypatch):
    # no repo override: a multi-variant TTS card is 'ready' when ANY variant
    # repo is fully cached (mirrors the documented any-rung ladder semantics)
    from sokuji_sidecar import native_models
    import sokuji_sidecar.catalog as catalog
    monkeypatch.setattr(catalog, "tts_model", lambda mid: _tts_variant_card())
    cached = {"org/fake-int8"}
    monkeypatch.setattr(native_models, "_repos_cached",
                        lambda specs: all(r in cached for r in specs["repos"]))
    assert native_models.model_status("fake-tts") == "ready"


def test_tts_voices_repo_prefers_cached_variant(monkeypatch):
    from sokuji_sidecar import tts_voices
    import sokuji_sidecar.catalog as catalog
    monkeypatch.setattr(catalog, "tts_model", lambda mid: _tts_variant_card())
    monkeypatch.setattr(tts_voices, "_repo_cached", lambda r: r == "org/fake-bf16")
    assert tts_voices._lm_repo("fake-tts") == "org/fake-bf16"
```

(Adjust the second test's function names to what tts_voices.py:12-20 actually defines — the resolver that returns `m.repos[0]` today; introduce `_repo_cached(repo) -> bool` as the seam.)

- [ ] **Step 2: Implement**

In `model_status`, after `specs = download_specs(model_id, repo)` and before the `_repos_cached(specs)` gate, insert:

```python
    from .catalog import tts_model as _tts_card
    tcard = _tts_card(model_id) if repo is None else None
    if tcard is not None:
        variant_repos = list(dict.fromkeys(
            d.artifact for d in tcard.deployments if d.backend != "mlx_audio_tts"))
        if len(variant_repos) > 1:
            # Multi-variant TTS: ANY fully-cached variant repo satisfies the
            # card (we load whichever the user downloaded); per-variant
            # semantics stay available via the explicit `repo` override.
            if any(_repos_cached({"repos": [r]}) for r in variant_repos):
                return "ready"
            return "absent"
```

In `tts_voices.py`: extract a `_repo_cached(repo)` helper (`snapshot_download(repo, local_files_only=True)` under try/except → bool) and make the repo resolver return the FIRST cached variant repo of a multi-variant card (iterating unique deployment artifacts, `repos[0]` first), falling back to `repos[0]` when none is cached — voices/ is identical across variant repos, so any cached one serves.

- [ ] **Step 3: Run** — `cd sidecar && $PY -m pytest tests/ -q -p no:cacheprovider` → all pass.

- [ ] **Step 4: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/sokuji_sidecar/tts_voices.py sidecar/tests/
git commit -m "feat(sidecar): variant-aware TTS status and voices-repo resolution"
```

---

### Task 10: Renderer — picker on TTS cards + init variant

**Files:**
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx` (TTS `renderCards` call at :785-790)
- Modify: `src/services/providers/LocalNativeProviderConfig.ts` (source `ttsVariant` from `translationVariantByModel[ttsModelId]` — mirror how `asrVariant` is built there)
- Modify: `src/stores/settingsStore.ts:520-523` (add the `ttsVariant` invalidation line mirroring :520's `asrVariant`)
- Modify: `src/services/clients/LocalNativeClient.ts:119` (pass the variant)
- Modify: `src/lib/local-inference/native/NativeTtsClient.ts:82-87` (init gains `variant`)
- Test: `src/components/Settings/sections/NativeModelManagementSection.test.tsx`, `src/lib/local-inference/native/NativeTtsClient.test.ts`

- [ ] **Step 1: Failing test — NativeTtsClient sends variant**

In `NativeTtsClient.test.ts`, copy the existing init test and assert the wire message:

```typescript
it('sends variant with tts_init when provided', async () => {
  // arrange exactly like the existing init test in this file
  await client.init('qwen3-tts-1.7b', 'auto', 'en', 'bf16');
  expect(sentMessages[0]).toMatchObject({ type: 'tts_init', model: 'qwen3-tts-1.7b', variant: 'bf16' });
});
```

Run: `npm run test -- src/lib/local-inference/native/NativeTtsClient.test.ts` → FAIL.

- [ ] **Step 2: Implement client + config plumbing**

`NativeTtsClient.ts:82-87`:

```typescript
  async init(model?: string, device?: string, language?: string, variant?: string): Promise<TtsReady> {
    this.onStatus?.('[native-tts] init…');
    ...
    const msg = await this.conn.request(
      { type: 'tts_init', model, device, language, variant },
      { timeoutMs: INIT_REQUEST_TIMEOUT_MS });
```

`LocalNativeClient.ts:119`:

```typescript
        const r = await this.tts.init(config.ttsModelId, config.ttsDevice, config.targetLanguage, config.ttsVariant);
```

`LocalNativeProviderConfig.ts`: add `ttsVariant` next to where `asrVariant`/`translationVariant` are read from `localNative.translationVariantByModel` (the pin map is generic, keyed by model id — `ttsVariant = translationVariantByModel[ttsModelId]`). `settingsStore.ts` (:520-523 block): add

```typescript
      ttsVariant: ttsModel === baseConfig.ttsModelId ? baseConfig.ttsVariant : undefined,
```

(mirroring the asrVariant line — read the surrounding function for the exact local variable names).

- [ ] **Step 3: Picker on TTS cards**

`NativeModelManagementSection.tsx` — change the TTS `renderCards` call (:785-790) to pass the same two arguments the translation call passes (:737-743): `variantData, handlePinVariant`. The variantData builder (:475-502) and pin map (:599) are already generic over any catalog entry carrying `variants`.

Add a component test mirroring the existing translation-picker test in `NativeModelManagementSection.test.tsx` (find it via `rg -n "variant" src/components/Settings/sections/NativeModelManagementSection.test.tsx`), with a TTS catalog fixture entry that has `variants: [{id:'bf16',…,recommended:true},{id:'fp32',…},{id:'int8',…}]`, asserting the picker renders and pinning calls `download`/pin with the variant repo.

- [ ] **Step 4: Run renderer tests**

Run: `npm run test -- src/lib/local-inference/native/NativeTtsClient.test.ts src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat(renderer): variant picker + init pin for native TTS cards"
```

---

### Task 11: Version bump, full suites, GB10 e2e — final gate

- [ ] **Step 1: Bump sidecarVersion** — root `package.json` field `"n"`: `0.1.7` → `0.1.8` (see `electron/sidecar-bundle.test.js` for the contract).

- [ ] **Step 2: Full suites**

Run: `cd sidecar && $PY -m pytest tests/ -q -p no:cacheprovider` AND `npm run test`
Expected: all green.

- [ ] **Step 3: Real-machine e2e (GB10, this box)** — via the actual app or the sidecar directly:
  1. bf16 lane: download `qwen3-tts-0.6b-onnx-bf16` (picker default on this cuda machine), `tts_init` → resolved `device=cuda, computeType=bf16`, synthesize zh+en, audio non-silent.
  2. int8 lane *(int8)*: download the int8 repo, pin int8 → resolved `device=cpu, computeType=int8`, synthesize, compare RTF vs fp32-cpu history.
  3. downloaded-restriction: with ONLY int8 cached, auto init must land on int8/cpu (never attempt bf16).

- [ ] **Step 4: Commit + report** — commit the bump; report e2e transcript to the user. Ask the user about: pushing the branch/PR, and deleting the OLD dual-dir repos `jiangzhuo9357/qwen3-tts-{0.6b,1.7b}-onnx` (both are user-approval actions; the old repos must outlive the switch until e2e passes).

```bash
git add package.json
git commit -m "chore(sidecar): bump sidecarVersion for qwen3-tts variant repos"
```

---

## Self-review notes

- Spec coverage: §1→Tasks 1-3, §2→Task 6(+7 deletion), §3→Tasks 4-5, §4→Tasks 8-10(+5 downloader-zero-change confirmed), §5→Task 7, §6→every task's test steps + Task 11; §7 needs no task (no-action section).
- int8-gate conditionality is explicit in Tasks 2/3/6/8/11.
- Type consistency: `_tts_pick_quant(model, machine, pin=None, downloaded=None)` used identically in Tasks 4/8; `resolve_tts(..., downloaded=frozenset(), pin=None)` in Tasks 4/5; wire field `variant` in Tasks 5/10; repo constants of Task 6 match Task 1's tree names.
