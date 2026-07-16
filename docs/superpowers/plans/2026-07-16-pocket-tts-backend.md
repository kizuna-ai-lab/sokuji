# Pocket TTS Sidecar Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the orphaned standalone `pocket_engine` WebSocket stage and re-home Pocket TTS (Kyutai CALM zero-shot voice cloning, int8 ONNX) as a registered backend in the sidecar's pluggable TTS system, with five per-language catalog cards, eight predefined voices, and the standard UI download path.

**Architecture:** The sidecar (`sidecar/sokuji_sidecar/`) has a pluggable TTS system: backend classes in `tts_backends.py` self-register into the shared `backends.py` registry; declarative model cards in `catalog.py` map card → `Deployment(backend=NAME, ...)`; `accel.load_with_fallback` instantiates by NAME and calls `load()`. Pocket's ONNX pipeline already exists in three orphaned runtime modules (`pocket_inference.py`, `pocket_bundle.py`, `pocket_tokenizer.py`) plus a fourth (`pocket_engine.py`) that wrapped them as a standalone WS stage — that stage was the sidecar's original Phase-1 scaffold, was un-registered when the pluggable system landed, and is now unreachable. This plan keeps the three runtime modules (extended), deletes the stage, and adds a `PocketOnnxTtsBackend` + 5 cards. The renderer needs **zero changes**: TTS cards flow over the `models_catalog` wire, and `frameworkLabel`'s `endsWith('_onnx') → 'ONNXRuntime'` fallback covers the new backend name.

**Tech Stack:** Python 3.12 + onnxruntime (CPU) + numpy + sentencepiece + huggingface_hub; pytest.

## Context you need before touching anything

**Where the model lives.** The upstream bundles sit in **subfolders of a HF Space** (`KevinAHM/pocket-tts-web`, `repo_type="space"`, `onnx/<bundle>/`), a shape the sidecar's download path deliberately does not speak — `native_models.py` assumes model repos with files at the root, and `TtsModel.repos` is a bare tuple of repo ids. The settled decision is to **mirror each language bundle into a flat model repo** (`jiangzhuo9357/pocket-tts-<lang>-onnx`); Task 5 stages those mirrors and the human uploads them. Five bundles: `english_2026-04`, `german`, `spanish`, `italian`, `portuguese` — 9 files each (5 int8 ONNX + `bundle.json` + `tokenizer.model` + `bos_before_voice.npy` + `voices.bin`), ~198.6 MB per language, all cc-by-4.0.

**What a "predefined voice" is.** `voices.bin` is a custom `PTVB1` container holding, per voice, the **flow-LM transformer KV-cache prefix** (126 frames of a 1000-frame state buffer) that a reference-clip encode would otherwise produce. Loading one means mapping its tensors into the ONNX state slots named by `bundle.json`'s `flow_lm_state_manifest` — NOT running the mimi encoder. All five languages ship the same eight voices: alba, azelma, cosette, eponine, fantine, javert, jean, marius.

**The three mapping mismatches** (authoritative reference: `inference-worker.js` in the Space — functions `stateFromVoiceRecord`, `deriveStep`, `adaptTypedArray`; the byte format's writer is `scripts/export_voice_bins.py` there):
1. The voice's `cache` is `[2,1,126,16,64]` but the manifest slot is `[2,1,1000,16,64]` → embed as a per-axis **prefix**, leaving the manifest's `nan` fill in the tail.
2. voices.bin stores `offset`; the manifest wants `step` → derive: use `step` if present; else `offset` (only when `end_offset` is absent); else `current_end`'s length; else 0.
3. `current_end` has no counterpart in voices.bin → keep the manifest default (`fill: "empty"`, shape `[0]`).

**THE HEAD RISK:** getting this mapping wrong produces audio that **plays but carries the wrong timbre** — the exact failure mode the project already hit once with the BOS-prepend ("the clone is audible but timbre is off"). Shape/finiteness assertions cannot see it. That is why Task 2 pins the mapping structurally against the real `voices.bin` and Task 3's end-to-end test asserts voices are *distinguishable* (see the tests themselves).

## Global Constraints

1. **The two Local providers are peers — never unify them.** Nothing under `src/lib/local-inference/workers/` or `src/lib/local-inference/engine/` may be touched. In fact **this branch must contain ZERO edits under `src/`, `electron/`, or `extension/`** — the renderer's TTS list is wire-driven, and `frameworkLabel` (`src/lib/local-inference/native/nativeCatalog.ts`) already resolves any `*_onnx` backend id to "ONNXRuntime" by suffix. If you believe a renderer edit is needed, stop and report; do not make it.
2. **Exact names, used verbatim everywhere:** backend `NAME = "pocket_onnx"`; class `PocketOnnxTtsBackend`; card ids `pocket-tts-en`, `pocket-tts-de`, `pocket-tts-es`, `pocket-tts-it`, `pocket-tts-pt`; mirror repo defaults `jiangzhuo9357/pocket-tts-<lang>-onnx` with env overrides `SOKUJI_POCKET_TTS_<LANG>_REPO`; preset-voice env `SOKUJI_POCKET_PRESET_VOICE` default `"alba"`; thread env stays **`POCKET_NATIVE_THREADS`** default `"2"` (measured optimum; do NOT rename it to `SOKUJI_TTS_THREADS`, whose default of 4 belongs to MOSS).
3. **CPU-only by measurement.** The card gets exactly one `Deployment("pocket_onnx", "cpu", "int8", <repo>, 1.0)`. Do not add GPU tiers: the int8 seqlen-1 AR decode is memory-bound and already 2.5–6.6× realtime on CPU, and the int8 operator set (MatMulInteger/DynamicQuantizeLinear) has no validated GPU kernel path.
4. **Existing `pocket_inference.py` functions are load-bearing and must not change behavior** (`load_sessions`, `resample_to_24k`, `encode_reference`, `build_voice_conditioned_state`, `generate`, `init_state_from_manifest`, `update_state_from_outputs`, `_filled`, `_meta`, `_run`, `_DT`). This plan only ADDS functions there. The only deletions anywhere are the ones this plan names explicitly.
5. **Gated real-model tests** use the existing `POCKET_MODEL_DIR` env-gate pattern (see `test_pocket_inference.py::test_end_to_end_produces_audio`). The bundle is already cached on this machine; resolve the dir with:
   ```bash
   export HF_HOME=$HOME/.config/Sokuji/hf-cache
   export POCKET_MODEL_DIR=$(/home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -c "from huggingface_hub import snapshot_download; print(snapshot_download(repo_id='KevinAHM/pocket-tts-web', repo_type='space', allow_patterns=['onnx/english_2026-04/*'], local_files_only=True) + '/onnx/english_2026-04')")
   ```
6. **`tsc` is NOT a gate** (repo builds with Vite/esbuild; the gate is vitest/pytest). This branch touches no TS, so don't run tsc at all. Do not run `npm install` — this worktree's `node_modules` is already installed and running install on Linux corrupts `package-lock.json` (drops the `win-core-audio` optional dep). `package-lock.json` must not appear in any commit.
7. **Comments and code in English.** Conventional-commit messages. `scripts/__pycache__/` may show as untracked — stray bytecode, leave it alone. Task 5's `pocket-mirrors/` staging output must never be committed (it gets gitignored).

### Commands

```bash
# Sidecar tests (from the worktree root)
cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/ -q

# One file
cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_pocket_bundle.py -q
```

### Baseline and expected counts

Branch base `d0c2cd28` (main): **769 passed, 15 skipped**. Expected after each task (without `POCKET_MODEL_DIR`; new gated tests count as skipped):

| After | passed | skipped | delta |
|---|---|---|---|
| Task 1 | 772 | 15 | +3 parser tests |
| Task 2 | 780 | 16 | +8 mapping tests, +1 gated |
| Task 3 | 782 | 17 | −3 (stage tests deleted), +5 backend tests, +1 gated |
| Task 4 | 787 | 17 | +1 listing test, +4 matrix rows |
| Task 5 | 787 | 17 | script only |

With `POCKET_MODEL_DIR` exported, the three pocket-gated tests unlock: **790 passed, 14 skipped**. The binding invariant is always **0 failed** plus the stated per-task delta; if a number differs for any other reason, report the discrepancy — do not adjust code or tests to hit a number.

## File Structure

- Modify: `sidecar/sokuji_sidecar/pocket_bundle.py` (add PTVB1 parser + `VOICES_FILE`; delete the Space resolver)
- Modify: `sidecar/sokuji_sidecar/pocket_inference.py` (add the 4 state-mapping functions)
- Modify: `sidecar/sokuji_sidecar/tts_backends.py` (add `PocketOnnxTtsBackend`)
- Modify: `sidecar/sokuji_sidecar/catalog.py` (5 cards + helper)
- Modify: `sidecar/prefetch_models.py` (Space fetch → mirror-repo fetch)
- Delete: `sidecar/sokuji_sidecar/pocket_engine.py`, `sidecar/tests/test_pocket_engine.py`
- Modify tests: `test_pocket_bundle.py`, `test_pocket_inference.py`, `test_tts_backends.py`, `test_catalog.py`, `test_tts_voices.py`, `test_characterization.py`
- Create: `scripts/mirror_pocket_tts.py`; append one line to `.gitignore`

---

### Task 1: PTVB1 parser in `pocket_bundle.py`

**Files:**
- Modify: `sidecar/sokuji_sidecar/pocket_bundle.py`
- Test: `sidecar/tests/test_pocket_bundle.py`

**Interfaces:**
- Produces: `pocket_bundle.VOICES_FILE = "voices.bin"` and `pocket_bundle.parse_voices_bin(path: str) -> dict[str, dict[str, np.ndarray]]` — `{voice_name: {tensor_key: ndarray}}`, arrays already shaped and typed. Raises `ValueError` on a bad magic or unknown dtype code. Tasks 2 and 3 consume both.
- Note: the Space-based resolver in this file (`HF_REPO`/`HF_SUBFOLDER`/`resolve_bundle_dir`) is deleted in **Task 3** together with its only consumer (`pocket_engine.py`), never here — deleting it now would leave `pocket_engine.py:20` referencing a function that no longer exists.

- [ ] **Step 1: Write the failing tests**

In `sidecar/tests/test_pocket_bundle.py`, add `import pytest` under the existing `import numpy as np` line, then append:

```python
def _ptvb_bytes(voices: dict) -> bytes:
    """Mirror of the writer in the upstream Space's scripts/export_voice_bins.py."""
    import struct
    out = bytearray(b"PTVB1")
    out += struct.pack("<I", len(voices))
    for name, tensors in voices.items():
        nb = name.encode("utf-8")
        out += struct.pack("<H", len(nb)) + nb
        out += struct.pack("<H", len(tensors))
        for key, arr in tensors.items():
            kb = key.encode("utf-8")
            out += struct.pack("<H", len(kb)) + kb
            code = {"float32": 0, "int64": 1, "bool": 2}[str(arr.dtype)]
            out += struct.pack("<BB", code, arr.ndim)
            for dim in arr.shape:
                out += struct.pack("<I", dim)
            raw = arr.tobytes(order="C")
            out += struct.pack("<I", len(raw)) + raw
    return bytes(out)


def test_parse_voices_bin_roundtrip(tmp_path):
    voices = {
        "alba": {"layer.0/cache": np.arange(12, dtype=np.float32).reshape(2, 6),
                 "layer.0/offset": np.asarray([126], dtype=np.int64)},
        "javert": {"layer.0/flag": np.asarray([True, False], dtype=np.bool_)},
    }
    p = tmp_path / "voices.bin"
    p.write_bytes(_ptvb_bytes(voices))
    out = pb.parse_voices_bin(str(p))
    assert set(out) == {"alba", "javert"}
    assert np.array_equal(out["alba"]["layer.0/cache"], voices["alba"]["layer.0/cache"])
    assert out["alba"]["layer.0/cache"].dtype == np.float32
    assert out["alba"]["layer.0/offset"].dtype == np.int64
    assert out["alba"]["layer.0/offset"][0] == 126
    assert out["javert"]["layer.0/flag"].dtype == np.bool_
    assert out["javert"]["layer.0/flag"].tolist() == [True, False]


def test_parse_voices_bin_rejects_bad_magic(tmp_path):
    p = tmp_path / "voices.bin"
    p.write_bytes(b"NOPE1" + b"\x00" * 16)
    with pytest.raises(ValueError, match="PTVB1"):
        pb.parse_voices_bin(str(p))


def test_parse_voices_bin_rejects_unknown_dtype(tmp_path):
    import struct
    out = bytearray(b"PTVB1")
    out += struct.pack("<I", 1)
    out += struct.pack("<H", 4) + b"alba" + struct.pack("<H", 1)
    out += struct.pack("<H", 3) + b"a/b" + struct.pack("<BB", 9, 1)
    out += struct.pack("<I", 1) + struct.pack("<I", 4) + b"\x00\x00\x00\x00"
    p = tmp_path / "voices.bin"
    p.write_bytes(bytes(out))
    with pytest.raises(ValueError, match="dtype"):
        pb.parse_voices_bin(str(p))
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_pocket_bundle.py -q`
Expected: 3 FAIL with `AttributeError: module 'sokuji_sidecar.pocket_bundle' has no attribute 'parse_voices_bin'`; the 2 pre-existing tests still pass.

- [ ] **Step 3: Implement the parser**

In `sidecar/sokuji_sidecar/pocket_bundle.py`, change the first line from `import numpy as np` to:

```python
import struct

import numpy as np
```

Add `VOICES_FILE` next to the other filename constants (after the `BOS_FILE = "bos_before_voice.npy"` line):

```python
VOICES_FILE = "voices.bin"
```

Append at the end of the file:

```python
_PTVB_MAGIC = b"PTVB1"
_PTVB_DTYPES = {0: np.float32, 1: np.int64, 2: np.bool_}


def parse_voices_bin(path: str) -> dict[str, dict[str, np.ndarray]]:
    """Parse the PTVB1 predefined-voice container: per voice, the flow-LM
    KV-cache tensors a reference-clip encode would otherwise produce, keyed
    "module.path/tensor_key". Format writer: the upstream Space's
    scripts/export_voice_bins.py. Raises ValueError rather than returning a
    partial dict — a silently-empty parse would read as "no voices"."""
    data = open(path, "rb").read()
    if data[:5] != _PTVB_MAGIC:
        raise ValueError(f"not a PTVB1 file: {path}")
    off = 5
    (n_voices,) = struct.unpack_from("<I", data, off); off += 4
    voices: dict[str, dict[str, np.ndarray]] = {}
    for _ in range(n_voices):
        (name_len,) = struct.unpack_from("<H", data, off); off += 2
        name = data[off:off + name_len].decode("utf-8"); off += name_len
        (n_tensors,) = struct.unpack_from("<H", data, off); off += 2
        tensors: dict[str, np.ndarray] = {}
        for _ in range(n_tensors):
            (key_len,) = struct.unpack_from("<H", data, off); off += 2
            key = data[off:off + key_len].decode("utf-8"); off += key_len
            dtype_code = data[off]; off += 1
            ndim = data[off]; off += 1
            shape = struct.unpack_from("<" + "I" * ndim, data, off); off += 4 * ndim
            (nbytes,) = struct.unpack_from("<I", data, off); off += 4
            dt = _PTVB_DTYPES.get(dtype_code)
            if dt is None:
                raise ValueError(
                    f"unsupported voices.bin dtype code {dtype_code} for {name}/{key}")
            count = nbytes // np.dtype(dt).itemsize
            arr = np.frombuffer(data, dtype=dt, count=count, offset=off)
            tensors[key] = arr.reshape(shape).copy()
            off += nbytes
        voices[name] = tensors
    return voices
```

- [ ] **Step 4: Run the file to verify green**

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_pocket_bundle.py tests/test_pocket_inference.py tests/test_pocket_engine.py -q`
Expected: all pass (5 in test_pocket_bundle; the engine/inference files must be unaffected — `pocket_engine.py` doesn't use the deleted resolver's default path in tests).

- [ ] **Step 5: Full suite + commit**

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/ -q`
Expected: **772 passed, 15 skipped**.

```bash
git add sidecar/sokuji_sidecar/pocket_bundle.py sidecar/tests/test_pocket_bundle.py
git commit -m "feat(sidecar): PTVB1 parser for Pocket TTS predefined voices

voices.bin holds, per predefined voice, the flow-LM KV-cache prefix a
reference-clip encode would otherwise produce."
```

---

### Task 2: Voice-record → flow-state mapping in `pocket_inference.py`

The core of the port, and the head-risk code. Reference semantics: `stateFromVoiceRecord` / `deriveStep` / `adaptTypedArray` in the Space's `inference-worker.js` (quoted in the docstrings below).

**Files:**
- Modify: `sidecar/sokuji_sidecar/pocket_inference.py`
- Test: `sidecar/tests/test_pocket_inference.py`

**Interfaces:**
- Consumes: `pocket_bundle.parse_voices_bin` (Task 1) — in the gated test only.
- Produces: `pocket_inference.state_from_voice_record(meta: dict, record: dict) -> dict` (plus the three helpers `group_voice_record_by_module`, `derive_step`, `adapt_tensor`, individually testable). Task 3's `set_builtin_voice` consumes `state_from_voice_record`.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_pocket_inference.py`:

```python
def test_group_voice_record_by_module_splits_on_first_slash():
    rec = {"a.b/cache": 1, "a.b/offset": 2, "c/x/y": 3, "noslash": 4}
    g = pi.group_voice_record_by_module(rec)
    assert set(g) == {"a.b", "c"}            # keys without a slash are dropped
    assert g["a.b"] == {"cache": 1, "offset": 2}
    assert g["c"] == {"x/y": 3}              # split on the FIRST slash only


def test_derive_step_prefers_explicit_step_and_respects_end_offset_guard():
    assert pi.derive_step({"step": np.asarray([7], np.int64)})[0] == 7
    assert pi.derive_step({"offset": np.asarray([126], np.int64)})[0] == 126
    # offset is trusted only when end_offset is absent (reference impl's guard)
    blocked = {"offset": np.asarray([126], np.int64),
               "end_offset": np.asarray([5], np.int64)}
    assert pi.derive_step(blocked)[0] == 0


def test_derive_step_falls_back_to_current_end_length_then_zero():
    assert pi.derive_step({"current_end": np.zeros(3, np.float32)})[0] == 3
    out = pi.derive_step({})
    assert out.dtype == np.int64 and out.shape == (1,) and out[0] == 0


def test_adapt_tensor_exact_shape_casts_dtype():
    entry = {"dtype": "float32", "shape": [2, 3], "fill": "nan"}
    src = np.arange(6, dtype=np.float64).reshape(2, 3)
    out = pi.adapt_tensor(src, entry)
    assert out.dtype == np.float32 and np.array_equal(out, src.astype(np.float32))


def test_adapt_tensor_same_size_reshapes_flat_data():
    entry = {"dtype": "int64", "shape": [2, 2], "fill": "zeros"}
    out = pi.adapt_tensor(np.arange(4, dtype=np.int64), entry)
    assert out.shape == (2, 2) and out[1, 1] == 3


def test_adapt_tensor_rank_mismatch_returns_manifest_fill():
    entry = {"dtype": "float32", "shape": [2, 2], "fill": "ones"}
    out = pi.adapt_tensor(np.zeros((2, 2, 2), np.float32), entry)  # 8 elems vs 4, rank 3 vs 2
    assert out.shape == (2, 2) and (out == 1).all()


def test_adapt_tensor_prefix_embeds_and_keeps_fill_in_the_tail():
    # The predefined-voice KV cache is a 126-frame prefix of the 1000-frame
    # manifest slot; this is the branch that carries voice identity.
    entry = {"dtype": "float32", "shape": [2, 1, 5], "fill": "nan"}
    src = np.arange(6, dtype=np.float32).reshape(2, 1, 3)
    out = pi.adapt_tensor(src, entry)
    assert np.array_equal(out[:, :, :3], src)
    assert np.isnan(out[:, :, 3:]).all()


def _mini_manifest():
    return [
        {"input_name": "state_0", "dtype": "float32", "shape": [2, 4], "fill": "nan",
         "module": "layer.0", "key": "cache"},
        {"input_name": "state_1", "dtype": "int64", "shape": [1], "fill": "zeros",
         "module": "layer.0", "key": "step"},
        {"input_name": "state_2", "dtype": "float32", "shape": [0], "fill": "empty",
         "module": "layer.0", "key": "current_end"},
    ]


def test_state_from_voice_record_synthetic_prefix_step_and_default():
    record = {"layer.0/cache": np.ones((2, 2), np.float32),
              "layer.0/offset": np.asarray([2], np.int64)}
    st = pi.state_from_voice_record({"flow_lm_state_manifest": _mini_manifest()}, record)
    assert np.array_equal(st["state_0"][:, :2], np.ones((2, 2), np.float32))
    assert np.isnan(st["state_0"][:, 2:]).all()   # untouched tail keeps the nan fill
    assert st["state_1"].dtype == np.int64 and st["state_1"][0] == 2  # step <- offset
    assert st["state_2"].shape == (0,)            # missing key -> manifest default kept


@pytest.mark.skipif(not os.environ.get("POCKET_MODEL_DIR"),
                    reason="set POCKET_MODEL_DIR to a local bundle")
def test_state_from_voice_record_real_alba_mapping():
    """Structural pin against the real voices.bin: the mapped state must carry
    alba's exact cache bytes as a prefix (nan elsewhere) and her offset as the
    step counter. This is the direct guard on the audible-but-wrong-timbre
    failure mode — a mapping that quietly falls back to manifest defaults
    passes every shape/finiteness check but fails this."""
    d = os.environ["POCKET_MODEL_DIR"]
    meta = json.load(open(f"{d}/{pb.METADATA_FILE}"))
    voices = pb.parse_voices_bin(f"{d}/{pb.VOICES_FILE}")
    rec = voices["alba"]
    st = pi.state_from_voice_record(meta, rec)
    entry = next(e for e in meta["flow_lm_state_manifest"]
                 if e["module"] == "transformer.layers.0.self_attn" and e["key"] == "cache")
    cache = rec["transformer.layers.0.self_attn/cache"]
    mapped = st[entry["input_name"]]
    assert mapped.shape == tuple(entry["shape"])
    n = cache.shape[2]
    assert n < entry["shape"][2]                  # it really is a strict prefix
    assert np.array_equal(mapped[:, :, :n], cache)
    assert np.isnan(mapped[:, :, n:]).all()
    step_entry = next(e for e in meta["flow_lm_state_manifest"]
                      if e["module"] == "transformer.layers.0.self_attn" and e["key"] == "step")
    offset = rec["transformer.layers.0.self_attn/offset"].reshape(-1)[0]
    assert st[step_entry["input_name"]].reshape(-1)[0] == offset
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_pocket_inference.py -q`
Expected: 8 FAIL with `AttributeError` (`group_voice_record_by_module` etc. not defined); pre-existing tests pass; the gated test skips.

- [ ] **Step 3: Implement the four functions**

In `sidecar/sokuji_sidecar/pocket_inference.py`, insert after `update_state_from_outputs` (keep everything else untouched):

```python
def group_voice_record_by_module(record: dict) -> dict:
    """{"module.path/key": tensor} -> {"module.path": {"key": tensor}}, split on
    the FIRST slash (module paths contain dots, keys may not contain slashes —
    but mirror the reference impl and split once anyway)."""
    grouped: dict[str, dict] = {}
    for key, value in record.items():
        slash = key.find("/")
        if slash == -1:
            continue
        grouped.setdefault(key[:slash], {})[key[slash + 1:]] = value
    return grouped


def derive_step(module_state: dict) -> np.ndarray:
    """The manifest wants a `step` counter the voice file doesn't store under
    that name (it stores `offset`). Port of the reference deriveStep: step ->
    offset (only when end_offset is absent) -> len(current_end) -> 0."""
    if "step" in module_state:
        return np.asarray([int(np.asarray(module_state["step"]).reshape(-1)[0])], np.int64)
    if "offset" in module_state and "end_offset" not in module_state:
        return np.asarray([int(np.asarray(module_state["offset"]).reshape(-1)[0])], np.int64)
    if "current_end" in module_state:
        return np.asarray([int(np.asarray(module_state["current_end"]).shape[0])], np.int64)
    return np.zeros(1, np.int64)


def adapt_tensor(source: np.ndarray, entry: dict) -> np.ndarray:
    """Fit a voices.bin tensor into a manifest state slot (port of the reference
    adaptTypedArray): exact shape -> cast; same element count -> reshape; rank
    mismatch -> manifest default; otherwise embed as a per-axis prefix and leave
    the manifest fill in the tail. The predefined-voice KV cache is a 126-frame
    prefix of the 1000-frame state buffer — the prefix branch is the one that
    carries voice identity."""
    dt = _DT[entry["dtype"]]
    target_shape = tuple(entry["shape"])
    src = np.asarray(source)
    if src.shape == target_shape:
        return src.astype(dt, copy=True)
    if src.size == int(np.prod(target_shape)):
        return src.astype(dt).reshape(target_shape)
    target = _filled(list(target_shape), entry["dtype"], entry.get("fill"))
    if src.ndim != len(target_shape):
        return target
    sl = tuple(slice(0, min(s, t)) for s, t in zip(src.shape, target_shape))
    target[sl] = src[sl].astype(dt)
    return target


def state_from_voice_record(meta: dict, record: dict) -> dict:
    """Build a flow-LM state dict from a parsed predefined-voice record,
    skipping the mimi encoder + prefill a reference clip would need. Slots the
    record doesn't cover keep their manifest defaults (current_end has no
    stored counterpart); `step` is derived when absent."""
    grouped = group_voice_record_by_module(record)
    state = init_state_from_manifest(meta["flow_lm_state_manifest"])
    for entry in meta["flow_lm_state_manifest"]:
        module_state = grouped.get(entry["module"], {})
        source = module_state.get(entry["key"])
        if source is None and entry["key"] == "step":
            source = derive_step(module_state)
        if source is None:
            continue
        state[entry["input_name"]] = adapt_tensor(source, entry)
    return state
```

- [ ] **Step 4: Run to verify green, then run the gated structural test**

```bash
cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_pocket_inference.py -q
```
Expected: all pass, 1 skipped (gated).

Then export `POCKET_MODEL_DIR` per Global Constraint 5 and re-run the same command.
Expected: the real-alba structural test **passes**. If it fails, the mapping is wrong — fix the mapping, never the test's expectations (they are transcribed from the reference implementation and the real file's bytes).

- [ ] **Step 5: Full suite + commit**

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/ -q` (without POCKET_MODEL_DIR)
Expected: **780 passed, 16 skipped**.

```bash
git add sidecar/sokuji_sidecar/pocket_inference.py sidecar/tests/test_pocket_inference.py
git commit -m "feat(sidecar): map Pocket predefined-voice records into flow-LM state

Port of the reference web demo's stateFromVoiceRecord/deriveStep/adaptTypedArray:
the stored KV cache is a 126-frame prefix of the 1000-frame manifest slot, the
stored 'offset' becomes the manifest's 'step', and slots with no stored
counterpart (current_end) keep their manifest defaults. Wrong mapping here is
the audible-but-wrong-timbre failure mode, so a gated test pins the mapping
byte-exactly against the real voices.bin."
```

---

### Task 3: `PocketOnnxTtsBackend` + retire the standalone stage

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_backends.py`
- Modify: `sidecar/sokuji_sidecar/pocket_bundle.py` (delete the Space resolver — its only consumer dies here)
- Delete: `sidecar/sokuji_sidecar/pocket_engine.py`, `sidecar/tests/test_pocket_engine.py`
- Test: `sidecar/tests/test_tts_backends.py`

**Interfaces:**
- Consumes: Task 1's `parse_voices_bin`/`VOICES_FILE`; Task 2's `state_from_voice_record`; existing `pocket_inference` runtime functions; `backends.register_backend`/`BackendLoadError`.
- Produces: registered backend `"pocket_onnx"` implementing the duck-typed TTS contract (`NAME`/`STREAMING`/`CLONES`/`sample_rate`, `load`, `set_voice(audio, sr)` clip-only, `set_builtin_voice`, `set_speaker` no-op, `generate`, `unload`, `is_loaded`). Task 4's cards reference the NAME.
- Note: `set_voice` takes NO `ref_text` parameter — `TtsEngine.set_voice` introspects the signature and routes Pocket down the clip-only branch (like MOSS). Deleting `pocket_engine.py` removes a `"type": "result"` wire emitter, which is safe for the cross-boundary consistency net: `asr_engine.py` still emits `result`.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_tts_backends.py`:

```python
def test_pocket_onnx_registered_and_flags():
    b = backends.make_backend("pocket_onnx")
    assert b.NAME == "pocket_onnx" and b.STREAMING is False and b.CLONES is True
    assert b.is_loaded is False and b.sample_rate == 24000
    assert b.preset_voice == "alba"


def test_pocket_set_builtin_voice_unknown_raises():
    b = backends.make_backend("pocket_onnx")
    b._voices = {}                      # already "parsed": empty -> nothing matches
    with pytest.raises(backends.BackendLoadError):
        b.set_builtin_voice("nope")


def test_pocket_set_builtin_voice_maps_record_to_flow_state():
    b = backends.make_backend("pocket_onnx")
    b._meta = {"flow_lm_state_manifest": [
        {"input_name": "state_0", "dtype": "float32", "shape": [1, 4], "fill": "nan",
         "module": "layer.0", "key": "cache"},
        {"input_name": "state_1", "dtype": "int64", "shape": [1], "fill": "zeros",
         "module": "layer.0", "key": "step"},
    ]}
    b._voices = {"alba": {"layer.0/cache": np.ones((1, 2), np.float32),
                          "layer.0/offset": np.asarray([2], np.int64)}}
    b.set_builtin_voice("alba")
    assert np.array_equal(b._flow["state_0"][:, :2], np.ones((1, 2), np.float32))
    assert np.isnan(b._flow["state_0"][:, 2:]).all()
    assert b._flow["state_1"][0] == 2


def test_pocket_generate_defaults_to_preset_voice(monkeypatch):
    from sokuji_sidecar import pocket_inference as pi

    class _Tok:
        def encode_ids(self, text):
            return [1, 2, 3]

    class _Sess:
        def run(self, names, feeds):
            return [np.zeros((1, 3, 8), np.float32)]

    b = backends.make_backend("pocket_onnx")
    b._tok = _Tok()
    b._sessions = {"textConditioner": _Sess()}
    b._meta = {}
    applied = []

    def fake_builtin(name):
        applied.append(name)
        b._flow = {"state_0": np.zeros(1, np.float32)}

    monkeypatch.setattr(b, "set_builtin_voice", fake_builtin)
    monkeypatch.setattr(pi, "generate", lambda *a, **k: np.zeros(2400, np.float32))
    samples, ms = b.generate("hello")
    # No voice picked yet -> the preset is applied (the post-load RTF probe
    # generates before the renderer ever sends set_voice).
    assert applied == ["alba"]
    assert samples.shape == (2400,) and ms >= 0


def test_pocket_load_missing_snapshot_raises_backend_load_error(monkeypatch):
    import huggingface_hub

    def boom(**kw):
        raise FileNotFoundError("not cached")

    monkeypatch.setattr(huggingface_hub, "snapshot_download", boom)
    b = backends.make_backend("pocket_onnx")
    with pytest.raises(backends.BackendLoadError):
        b.load("jiangzhuo9357/pocket-tts-en-onnx", "cpu", "int8")
    assert b.is_loaded is False


@pytest.mark.skipif(not os.environ.get("POCKET_MODEL_DIR"),
                    reason="set POCKET_MODEL_DIR to a local Pocket bundle dir")
def test_pocket_backend_builtin_voices_end_to_end(monkeypatch):
    """The KV-mapping failure mode is audio that PLAYS but carries the wrong
    timbre — shape/finiteness checks can't see it. Teeth: with a seeded rng and
    one intra-op thread (bitwise-deterministic), the same builtin voice twice is
    byte-identical while two different voices diverge. A mapping that collapsed
    to manifest defaults (ignoring the record) would make every voice sound the
    same and fail the alba-vs-javert assertion."""
    import huggingface_hub
    d = os.environ["POCKET_MODEL_DIR"]
    monkeypatch.setattr(huggingface_hub, "snapshot_download", lambda **kw: d)
    monkeypatch.setenv("POCKET_NATIVE_THREADS", "1")
    real_rng = np.random.default_rng
    monkeypatch.setattr(np.random, "default_rng", lambda *a, **k: real_rng(0))
    b = backends.make_backend("pocket_onnx")
    b.load("mirror-not-needed-locally", "cpu", "int8")
    assert b.is_loaded and b.sample_rate == 24000
    text = "The quick brown fox jumps over the lazy dog."
    b.set_builtin_voice("alba")
    a1, ms1 = b.generate(text)
    a2, _ = b.generate(text)
    assert np.array_equal(a1, a2)                       # seeded -> deterministic
    assert np.isfinite(a1).all() and len(a1) > 24000 and np.abs(a1).max() > 0.05
    b.set_builtin_voice("javert")
    a3, _ = b.generate(text)
    assert a1.shape != a3.shape or not np.array_equal(a1, a3)
    b.unload()
    assert b.is_loaded is False
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_tts_backends.py -q`
Expected: the 5 new tests FAIL with `BackendLoadError: unknown backend: pocket_onnx` (raised by `make_backend`); the gated one skips; pre-existing tests pass.

- [ ] **Step 3: Implement the backend**

In `sidecar/sokuji_sidecar/tts_backends.py`, insert the class directly above the trailing registration-import block (the `# \`from . import tts_backends\` (tts_engine startup) self-registers mlx_audio_tts` comment near the end of the file). Note the file imports `json as _json`.

```python
@register_backend
class PocketOnnxTtsBackend:
    """Pocket TTS (Kyutai CALM zero-shot voice cloning) via int8 ONNX on CPU.

    One language per model repo — the bundle's flow-LM is language-specific;
    all bundles ship the same eight predefined voices in voices.bin (KV-cache
    prefixes, so picking one skips the reference-encode prefill entirely).
    CPU-only by measurement: the int8 seqlen-1 AR decode is memory-bound and
    runs well above realtime on CPU, while the int8 operator set
    (MatMulInteger/DynamicQuantizeLinear) has no validated GPU kernel path.
    Runtime lives in pocket_inference/pocket_bundle/pocket_tokenizer."""
    NAME = "pocket_onnx"
    STREAMING = False
    CLONES = True

    def __init__(self):
        self._sessions = None
        self._meta = None
        self._bos = None
        self._tok = None
        self._flow = None       # voice-conditioned flow-LM state (KV prefix)
        self._voices = None     # parsed voices.bin, loaded on first builtin pick
        self._dir = None
        self.sample_rate = 24000
        self.preset_voice = os.environ.get("SOKUJI_POCKET_PRESET_VOICE", "alba")

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self.unload()
        try:
            from huggingface_hub import snapshot_download
            from . import pocket_bundle as pb
            from . import pocket_inference as pi
            from .pocket_tokenizer import PocketTokenizer
            d = snapshot_download(repo_id=model_ref, local_files_only=True)
            self._sessions = pi.load_sessions(
                d, int(os.environ.get("POCKET_NATIVE_THREADS", "2")))
            self._meta = _json.load(open(os.path.join(d, pb.METADATA_FILE)))
            self._bos = (pb.parse_npy_float32(os.path.join(d, pb.BOS_FILE))
                         if self._meta.get("insert_bos_before_voice") else None)
            self._tok = PocketTokenizer(os.path.join(d, pb.TOKENIZER_FILE))
            self.sample_rate = int(self._meta.get("sample_rate", pb.SAMPLE_RATE))
            self._dir = d
        except Exception as e:  # missing snapshot / bad bundle -> resolver fallback
            self.unload()
            raise BackendLoadError(str(e))

    # ---- voices ----------------------------------------------------------
    def set_voice(self, audio, sr):
        from . import pocket_inference as pi
        ref = pi.resample_to_24k(np.asarray(audio, dtype=np.float32), int(sr))
        emb = pi.encode_reference(self._sessions, ref)
        self._flow = pi.build_voice_conditioned_state(
            self._sessions, self._meta, emb, self._bos)

    def set_builtin_voice(self, name: str) -> None:
        from . import pocket_bundle as pb
        from . import pocket_inference as pi
        if self._voices is None:
            self._voices = pb.parse_voices_bin(os.path.join(self._dir, pb.VOICES_FILE))
        record = self._voices.get(name)
        if record is None:
            raise BackendLoadError(f"unknown builtin voice: {name}")
        self._flow = pi.state_from_voice_record(self._meta, record)

    def set_speaker(self, sid):
        pass  # Pocket selects voices by name/clip, not a numeric speaker id

    # ---- synthesis -------------------------------------------------------
    def generate(self, text, speed=1.0):
        # `speed` is a deliberate no-op: frame count is EOS-governed (upstream
        # behaviour). No voice picked yet -> apply the preset; the post-load RTF
        # probe generates before the renderer ever sends set_voice, and the
        # predefined-voice path skips the reference-encode prefill entirely.
        from . import pocket_bundle as pb
        from . import pocket_inference as pi
        if self._flow is None:
            self.set_builtin_voice(self.preset_voice)
        t0 = time.time()
        ids = np.array(self._tok.encode_ids(text), np.int64).reshape(1, -1)
        tc = self._sessions["textConditioner"].run(None, {"token_ids": ids})[0]
        out = pi.generate(self._sessions, self._meta, tc, self._flow,
                          lsd_steps=pb.DEFAULT_LSD_STEPS,
                          max_frames=pb.DEFAULT_MAX_FRAMES)
        return out, int((time.time() - t0) * 1000)

    def unload(self) -> None:
        self._sessions = None
        self._meta = None
        self._bos = None
        self._tok = None
        self._flow = None
        self._voices = None
        self._dir = None

    @property
    def is_loaded(self) -> bool:
        return self._sessions is not None
```

- [ ] **Step 4: Run to verify green**

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_tts_backends.py -q`
Expected: all pass; 5 new green, gated skipped.

- [ ] **Step 5: Delete the standalone stage and its Space resolver**

```bash
git rm sidecar/sokuji_sidecar/pocket_engine.py sidecar/tests/test_pocket_engine.py
```

The stage is unreachable (never registered in `__main__._run()`; zero production imports) and its `"set_voice"` handler name collides with `tts_engine.register`'s — the shared handlers dict is composed with plain `dict.update`, so re-registering it would silently steal the key. Its capability now lives in the backend.

With the stage gone, the Space-based resolver in `pocket_bundle.py` has zero consumers (the backend resolves through the standard `snapshot_download`; `prefetch_models.py` carries its own constants, updated in Task 4). Delete these lines from `sidecar/sokuji_sidecar/pocket_bundle.py`:

```python
HF_REPO = "KevinAHM/pocket-tts-web"
HF_SUBFOLDER = "onnx/english_2026-04"


def resolve_bundle_dir(local_dir: str | None = None) -> str:
    """Dev/tests: pass local_dir. Real path: snapshot_download the english bundle."""
    if local_dir:
        return local_dir
    from huggingface_hub import snapshot_download  # HF_HOME set by the caller (env)
    root = snapshot_download(
        repo_id=HF_REPO, repo_type="space",
        allow_patterns=[f"{HF_SUBFOLDER}/*"],
        local_files_only=True,   # offline-first: model fetched by the manager beforehand
    )
    return f"{root}/{HF_SUBFOLDER}"
```

- [ ] **Step 6: Run the gated e2e + the wire-consistency net**

Export `POCKET_MODEL_DIR` per Global Constraint 5, then:

```bash
cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_tts_backends.py -q -k pocket
```
Expected: all pocket tests pass including the end-to-end (allow ~30–60s: it loads 5 ONNX sessions single-threaded and generates three utterances).

Then, from the worktree root, confirm deleting the stage's wire emitters didn't break the cross-boundary net (`asr_engine.py` still emits `result`):

```bash
npx vitest run src/lib/local-inference/native/nativeProtocol.consistency.test.ts
```
Expected: 3 passed. (node_modules is already installed here; never run npm install.)

- [ ] **Step 7: Full suite + commit**

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/ -q` (without POCKET_MODEL_DIR)
Expected: **782 passed, 17 skipped**.

```bash
git add sidecar/sokuji_sidecar/tts_backends.py sidecar/sokuji_sidecar/pocket_bundle.py sidecar/tests/test_tts_backends.py
git commit -m "feat(sidecar): PocketOnnxTtsBackend; retire the standalone pocket stage

Pocket TTS becomes a registered backend in the pluggable TTS system instead of
an unreachable parallel WS stage (the sidecar's original Phase-1 scaffold,
un-registered when the pluggable system landed). Predefined voices load as
KV-cache prefixes via state_from_voice_record — no reference-encode prefill —
and the preset voice is applied lazily so the post-load RTF probe works before
any set_voice arrives. The stage's 'set_voice' handler name collided with
tts_engine's registration (dict.update, last writer wins silently); deleting
the stage removes the trap."
```

---

### Task 4: Catalog cards, allowlist, listing, matrix, prefetch

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py`
- Modify: `sidecar/sokuji_sidecar/accel.py` (the `_installed()` runtime gate — a catalog card whose backend is not in this map is silently filtered out of every plan: NoUsablePlan on every machine)
- Modify: `sidecar/prefetch_models.py`
- Test: `sidecar/tests/test_catalog.py`, `sidecar/tests/test_tts_voices.py`, `sidecar/tests/test_characterization.py`

**Interfaces:**
- Consumes: backend NAME `pocket_onnx` (Task 3).
- Produces: 5 `TtsModel` cards (ids `pocket-tts-{en,de,es,it,pt}`) resolvable by `catalog.tts_model` / `accel.resolve_tts`; download specs flow to `native_models.py` automatically via `repos`.

- [ ] **Step 1: Add the cards**

In `sidecar/sokuji_sidecar/catalog.py`, insert directly above the `TTS_MODELS: list[TtsModel] = [` line:

```python
# Pocket TTS (Kyutai CALM zero-shot voice cloning), int8 ONNX, one bundle per
# language — the flow-LM is language-specific; every bundle ships the same
# eight predefined voices (KV-cache prefixes in voices.bin). Upstream lives in
# SUBFOLDERS of the KevinAHM/pocket-tts-web SPACE, a shape the download path
# deliberately does not speak, so scripts/mirror_pocket_tts.py stages flat
# model-repo mirrors (bundle files + the voices/manifest.json the voice
# listing reads). size_bytes = the 9 upstream files + that 263-byte manifest.
# CPU-only by measurement: int8 seqlen-1 AR decode is memory-bound, 2.5-6.6x
# realtime on CPU, and the int8 operator set has no validated GPU kernel path.
_POCKET_TTS_ROWS = (
    ("en", "English",    4, 198645821),
    ("de", "German",     5, 198646300),
    ("es", "Spanish",    6, 198647361),
    ("it", "Italian",    7, 198646544),
    ("pt", "Portuguese", 8, 198647467),
)


def _pocket_tts_row(lang: str, label: str, order: int, size: int) -> TtsModel:
    repo = os.environ.get(f"SOKUJI_POCKET_TTS_{lang.upper()}_REPO",
                          f"jiangzhuo9357/pocket-tts-{lang}-onnx")
    return TtsModel(
        f"pocket-tts-{lang}", f"Pocket TTS ({label})", (lang,),
        (Deployment("pocket_onnx", "cpu", "int8", repo, 1.0),),
        repos=(repo,), clones=True, streaming=False, named_voices=True,
        sample_rate=24000, sort_order=order, size_bytes=size)
```

Then, inside the `TTS_MODELS` list, insert one line directly after the closing `),` of the `qwen3-tts-1.7b` entry (before the `# piper / vits single-voice models` comment):

```python
    *(_pocket_tts_row(*row) for row in _POCKET_TTS_ROWS),
```

- [ ] **Step 2: Run test_catalog to see the allowlist catch the new backend**

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_catalog.py -q`
Expected: `test_tts_models_have_deployments_languages_and_repos` **FAILS** — `pocket_onnx` is not in its backend allowlist. This is the catalog's own net doing its job on an unknown backend name.

- [ ] **Step 3: Extend the allowlist**

In `sidecar/tests/test_catalog.py`, the assertion inside `test_tts_models_have_deployments_languages_and_repos`:

```python
            assert d.backend in {"sherpa_tts", "moss_onnx", "supertonic",
                                 "qwen3tts_onnx", "mlx_audio_tts"}
```

becomes:

```python
            assert d.backend in {"sherpa_tts", "moss_onnx", "supertonic",
                                 "qwen3tts_onnx", "mlx_audio_tts", "pocket_onnx"}
```

Re-run `tests/test_catalog.py -q`. Expected: all pass (the cpu-floor, unique-id, and per-model loops cover the 5 new cards automatically).

- [ ] **Step 4: Pin the voice listing through the generic bundled-voices branch**

Pocket rides `tts_voices.list_builtin_voices`' existing generic branch (a `voices/manifest.json` in the snapshot root — currently used by Qwen3), so listing needs **no pocket-specific code**; the manifest ships in the mirror repo. Pin that with a test. In `sidecar/tests/test_tts_voices.py`, make sure `import json` is present among the imports (add it below the existing imports if not), then append:

```python
def test_pocket_bundled_voice_manifest_listing(monkeypatch, tmp_path):
    # Pocket rides the generic bundled-voices branch: the mirror repo ships
    # voices/manifest.json (staged by scripts/mirror_pocket_tts.py), so voice
    # listing needs no pocket-specific code path.
    from sokuji_sidecar import tts_voices
    vdir = tmp_path / "voices"
    vdir.mkdir()
    (vdir / "manifest.json").write_text(json.dumps(
        [{"name": "alba", "default": True}] + [{"name": n} for n in
         ["azelma", "cosette", "eponine", "fantine", "javert", "jean", "marius"]]))
    monkeypatch.setattr(tts_voices, "_snapshot_dir", lambda repo: str(tmp_path))
    out = tts_voices.list_builtin_voices("pocket-tts-en")
    assert len(out) == 8
    assert [v["name"] for v in out][:2] == ["alba", "azelma"]
    assert out[0]["default"] is True and out[1]["default"] is False
```

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_tts_voices.py -q`
Expected: all pass.

- [ ] **Step 5: Register the backend in the runtime-installed gate**

Registering a backend takes THREE sites, not two: the `@register_backend` class (Task 3), the catalog card (Step 1), and `accel._installed()` — the map from backend NAME to the Python runtime it needs. A backend absent from that map is never in `machine.installed`, so the planner filters its deployments out and `resolve_tts` raises `NoUsablePlan` on every machine even though the card renders in the UI. (This step exists because exactly that happened on first execution — the Step 6 matrix rows are what caught it.)

In `sidecar/sokuji_sidecar/accel.py`, inside `_installed()`'s `mods` dict, add directly after the `"qwen3tts_onnx": "onnxruntime",` line:

```python
            "pocket_onnx": ("onnxruntime", "sentencepiece"),
```

(Tuple because Pocket hard-requires both: onnxruntime for the five sessions, sentencepiece for `PocketTokenizer`.)

The characterization fixture machines mirror that gate. In `sidecar/tests/test_characterization.py`, extend `_ALL_BACKENDS`:

```python
_ALL_BACKENDS = frozenset({
    "transcribe_cpp", "transcribe_cpp_stream", "sherpa_tts", "moss_onnx",
    "supertonic", "qwen3tts_onnx", "onnx", "llamacpp_qwen", "llamacpp_hunyuan",
    "llamacpp_gemma", "ct2_opus_translate",
})
```

becomes:

```python
_ALL_BACKENDS = frozenset({
    "transcribe_cpp", "transcribe_cpp_stream", "sherpa_tts", "moss_onnx",
    "supertonic", "qwen3tts_onnx", "pocket_onnx", "onnx", "llamacpp_qwen",
    "llamacpp_hunyuan", "llamacpp_gemma", "ct2_opus_translate",
})
```

Do NOT change only the fixture — that would green the matrix while real machines still fail; the production gate in `accel.py` is the fix, the fixture just mirrors it.

Sanity-check the live path (real probe on this machine, not a fixture):

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react/.claude/worktrees/wire-result-collision/sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -c "
from sokuji_sidecar import accel
print([(p.backend, p.tier, p.compute_type, p.artifact) for p in accel.resolve_tts('pocket-tts-en')])"
```
Expected: `[('pocket_onnx', 'cpu', 'int8', 'jiangzhuo9357/pocket-tts-en-onnx')]`.

- [ ] **Step 6: Add the characterization matrix rows**

In `sidecar/tests/test_characterization.py`, append inside the `TTS_MATRIX` list, directly before its closing `]`:

```python
    # Pocket TTS: cpu-only single-deployment card — every machine resolves the
    # same one-plan ladder regardless of GPUs present (like the piper rows).
    ('pocket-tts-en', CPU_ONLY, 'auto', [('pocket_onnx', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/pocket-tts-en-onnx', 1.0)]),
    ('pocket-tts-en', CPU_ONLY, 'cpu', [('pocket_onnx', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/pocket-tts-en-onnx', 1.0)]),
    ('pocket-tts-en', CUDA_12GB, 'auto', [('pocket_onnx', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/pocket-tts-en-onnx', 1.0)]),
    ('pocket-tts-en', APPLE_SILICON, 'auto', [('pocket_onnx', 'cpu', 'cpu', 'int8', 'jiangzhuo9357/pocket-tts-en-onnx', 1.0)]),
```

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_characterization.py -q`
Expected: all pass (+4).

- [ ] **Step 7: Point prefetch at the mirror**

In `sidecar/prefetch_models.py`, replace:

```python
POCKET_REPO = "KevinAHM/pocket-tts-web"
POCKET_SUB = "onnx/english_2026-04"
```

with:

```python
# The english Pocket mirror (flat model repo staged by scripts/mirror_pocket_tts.py).
POCKET_REPO = os.environ.get("SOKUJI_POCKET_TTS_EN_REPO", "jiangzhuo9357/pocket-tts-en-onnx")
```

replace:

```python
    pocket_root = fetch("pocket", repo_id=POCKET_REPO, repo_type="space",
                        allow_patterns=[f"{POCKET_SUB}/*"])
```

with:

```python
    pocket_root = fetch("pocket", repo_id=POCKET_REPO)
```

and replace:

```python
        print(f"  export POCKET_MODEL_DIR={pocket_root}/{POCKET_SUB}")
```

with:

```python
        print(f"  export POCKET_MODEL_DIR={pocket_root}")
```

- [ ] **Step 8: Full suite + commit**

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/ -q`
Expected: **787 passed, 17 skipped**.

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/sokuji_sidecar/accel.py sidecar/prefetch_models.py sidecar/tests/test_catalog.py sidecar/tests/test_tts_voices.py sidecar/tests/test_characterization.py
git commit -m "feat(sidecar): five Pocket TTS language cards (cpu-only, named voices)

One card per language (the flow-LM is language-specific), one cpu/int8
deployment each, repos pointing at flat mirror repos so the standard download
path applies unchanged. Voice listing rides the existing generic
voices/manifest.json branch; the resolver matrix pins that GPU machines still
resolve the cpu-only ladder."
```

---

### Task 5: Mirror staging script + whole-branch verification

**Files:**
- Create: `scripts/mirror_pocket_tts.py`
- Modify: `.gitignore` (one line)

**Interfaces:**
- Consumes: the catalog `size_bytes` literals (Task 4) — the script verifies its staged totals against them, so a drifted mirror is caught before upload.
- Produces: `pocket-mirrors/pocket-tts-<lang>-onnx/` staged dirs for the human to upload. Never committed.

- [ ] **Step 1: Gitignore the staging output**

Append to `.gitignore`:

```
/pocket-mirrors/
```

- [ ] **Step 2: Write the script**

Create `scripts/mirror_pocket_tts.py`:

```python
#!/usr/bin/env python3
"""Stage the five Pocket TTS language bundles as uploadable flat HF model repos.

The upstream bundles live in SUBFOLDERS of the KevinAHM/pocket-tts-web SPACE
(repo_type="space") — a shape the sidecar's download path deliberately does not
speak (native_models.py assumes model repos with files at the root). This
script downloads each Space subfolder, hardlinks the nine bundle files into
pocket-mirrors/pocket-tts-<lang>-onnx/, writes the voices/manifest.json that
tts_voices.list_builtin_voices reads, and verifies each staged total against
the catalog card's size_bytes so a drifted upstream is caught before upload.

Upload each staged dir to its (pre-created) model repo, e.g.:

    hf upload jiangzhuo9357/pocket-tts-en-onnx pocket-mirrors/pocket-tts-en-onnx . --repo-type model
"""
import json
import os
import shutil
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

SPACE = "KevinAHM/pocket-tts-web"
BUNDLES = {"en": "english_2026-04", "de": "german", "es": "spanish",
           "it": "italian", "pt": "portuguese"}
VOICES = ["alba", "azelma", "cosette", "eponine", "fantine", "javert", "jean", "marius"]
# Must equal the catalog cards' size_bytes (nine bundle files + the manifest below).
EXPECTED = {"en": 198645821, "de": 198646300, "es": 198647361,
            "it": 198646544, "pt": 198647467}


def manifest_bytes() -> bytes:
    entries = [{"name": VOICES[0], "default": True}] + [{"name": n} for n in VOICES[1:]]
    return (json.dumps(entries, indent=2) + "\n").encode()


def main() -> int:
    out_root = Path("pocket-mirrors")
    failures = 0
    for lang, sub in BUNDLES.items():
        root = snapshot_download(repo_id=SPACE, repo_type="space",
                                 allow_patterns=[f"onnx/{sub}/*"])
        src = Path(root) / "onnx" / sub
        dst = out_root / f"pocket-tts-{lang}-onnx"
        (dst / "voices").mkdir(parents=True, exist_ok=True)
        total = 0
        for f in sorted(src.iterdir()):
            real = f.resolve()          # deref the HF blob symlink
            target = dst / f.name
            if not target.exists():
                try:
                    os.link(real, target)
                except OSError:         # cross-filesystem fallback
                    shutil.copy2(real, target)
            total += target.stat().st_size
        mf = manifest_bytes()
        (dst / "voices" / "manifest.json").write_bytes(mf)
        total += len(mf)
        ok = total == EXPECTED[lang]
        failures += 0 if ok else 1
        status = "OK" if ok else f"MISMATCH (catalog says {EXPECTED[lang]:,})"
        print(f"  {lang}: {dst}  {total:,} bytes  {status}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Run the script (network access needed)**

```bash
export HF_HOME=$HOME/.config/Sokuji/hf-cache
/home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python scripts/mirror_pocket_tts.py
```
Expected: five ` <lang>: pocket-mirrors/pocket-tts-<lang>-onnx  198,64x,xxx bytes  OK` lines, exit 0 (four bundles download ~200MB each on first run; english is already cached). A `MISMATCH` means upstream changed since the plan was written — stop and report, do not adjust `EXPECTED`.

- [ ] **Step 4: Whole-branch verification**

```bash
# Sidecar, ungated
cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/ -q
```
Expected: **787 passed, 17 skipped, 0 failed**.

```bash
# Sidecar, with the real bundle (resolve POCKET_MODEL_DIR per Global Constraint 5)
cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/ -q
```
Expected: **790 passed, 14 skipped, 0 failed** (the three pocket-gated tests unlock).

```bash
# Zero renderer-side edits (Global Constraint 1)
git diff --stat d0c2cd28..HEAD -- src/ electron/ extension/ package.json package-lock.json
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add scripts/mirror_pocket_tts.py .gitignore
git commit -m "chore(sidecar): mirror-staging script for the Pocket TTS bundles

Stages each Space subfolder as a flat model repo (plus the voices/manifest.json
the voice listing reads) and verifies the staged totals against the catalog
cards' size_bytes, so a drifted upstream is caught before upload."
```

---

## Post-merge (human)

The five mirror repos do not exist until you create and upload them; until then the cards show in the UI but the download 404s. After (or before) merge:

1. Create the five model repos under `jiangzhuo9357/` and upload each staged `pocket-mirrors/pocket-tts-<lang>-onnx/` dir (script docstring has the `hf upload` line; use the huggingface_hub API per house convention). ~199 MB × 5.
2. Sanity-check one end-to-end in the Electron app: download `Pocket TTS (English)` from the model manager, pick a predefined voice, generate; then clone from a mic clip.
3. No `sidecarVersion` bump is needed: this adds a backend and cards but changes no wire message shape — an older app simply never sends `tts_init` with a pocket model id it doesn't know.
