# GPU-native SenseVoice via FunASR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run SenseVoiceSmall on the GPU (and CPU) in the native sidecar via a PyTorch FunASR backend, replacing the CPU-only sherpa-onnx path for SenseVoice.

**Architecture:** Add one new ASR backend class (`FunAsrSenseVoiceBackend`) behind the existing `backends.py` duck-typed seam, mirroring the torch-based `TransformersBackend`. Point the `sense-voice` catalog row at two FunASR deployments (`gpu-cuda` + `cpu`) so the resolver prefers GPU, honors an explicit device override, and keeps a CPU floor. Transport/VAD/engine layers are untouched.

**Tech Stack:** Python, FunASR (PyTorch), torch (cu128 for GPU / CPU build for fallback), HuggingFace Hub, pytest.

## Global Constraints

- Backend seam: implement `load(model_ref, device, compute_type)`, `transcribe(samples, language) -> AsrResult`, `unload()`, `is_loaded`. Raise `BackendLoadError(reason)` on load failure (drives resolver fallback). Copied verbatim from `backends.py`.
- `transcribe` receives `np.float32` mono audio @ 16000 Hz (`TARGET_RATE = 16000`); returns `AsrResult(text, language)`. **Text-only**: strip all `<|…|>` tags; no emotion/event plumbing.
- Backend `device` arg is `"cuda"` or `"cpu"` (the resolver maps tier `gpu-cuda` → device `"cuda"`). FunASR wants `"cuda:0"`.
- **Honor the device given** — the FunASR backend must serve BOTH cpu and gpu (no GPU-only guard, unlike `Qwen3AsrBackend`).
- Model artifact (HF repo): `FunAudioLLM/SenseVoiceSmall`, env-overridable via `SOKUJI_ASR_REPO`.
- `sherpa-onnx` stays a dependency (TTS uses it via `sherpa_tts.py`). `SherpaBackend` is retained as harmless dead code; only the SenseVoice *catalog/resolution* switches to FunASR.
- Run tests from the `sidecar/` directory: `python -m pytest`.
- Unit tests fake heavy deps via `monkeypatch.setitem(sys.modules, …)` — no real torch/funasr needed for Tasks 1–3.
- Real on-hardware tests are gated by `SOKUJI_RUN_GPU=1` and skipped otherwise.

---

### Task 0: Provision the sidecar environment & verify clean baseline

**Files:**
- None modified. Environment setup only.

**Interfaces:**
- Consumes: nothing.
- Produces: a working `sidecar/.venv` with the base ML stack so subsequent tasks' tests run.

- [ ] **Step 1: Provision the venv via the project's setup script**

Run (from the worktree root):
```bash
cd sidecar
bash setup.sh
```
Expected: creates `.venv`, installs base requirements + pytest, torch (CPU), the pinned transformers fork, sherpa-onnx, faster-whisper. Takes several minutes (git install of transformers fork + downloads). Note: GPU torch is provisioned separately and is only needed for the Task 4 smoke test; the CPU torch from setup.sh is fine for Tasks 1–3.

- [ ] **Step 2: Run the full baseline test suite**

Run:
```bash
cd sidecar
.venv/bin/python -m pytest -q
```
Expected: all tests pass; tests gated by `SOKUJI_RUN_GPU` / `SOKUJI_RUN_ASR_MODEL` are skipped. If any non-gated test fails, STOP and report — the baseline must be green before changes.

- [ ] **Step 3: No commit** (environment only, `.venv` is gitignored).

---

### Task 1: FunASR SenseVoice backend + tag-stripping helper

**Files:**
- Modify: `sidecar/sokuji_sidecar/backends.py` (append new helper + class after `VoxtralRealtimeBackend`, end of file)
- Test: `sidecar/tests/test_backends.py` (append)

**Interfaces:**
- Consumes: `register_backend`, `make_backend`, `AsrResult`, `BackendLoadError`, `TARGET_RATE` from `backends.py`.
- Produces:
  - `backends._strip_sensevoice_tags(text: str) -> tuple[str, str | None]` — returns `(clean_text, language_or_None)`.
  - `backends.FunAsrSenseVoiceBackend` with `NAME = "funasr_sensevoice"`, implementing the standard seam.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_backends.py`:

```python
def test_strip_sensevoice_tags():
    raw = "<|en|><|NEUTRAL|><|Speech|><|withitn|>hello world"
    assert backends._strip_sensevoice_tags(raw) == ("hello world", "en")
    assert backends._strip_sensevoice_tags("<|yue|><|HAPPY|><|Speech|>呢几个字") == ("呢几个字", "yue")
    # no tags → no language
    assert backends._strip_sensevoice_tags("  plain text  ") == ("plain text", None)
    # leading tag that is not a language code (not lowercase) → language None
    assert backends._strip_sensevoice_tags("<|NEUTRAL|>x") == ("x", None)


def _install_fake_funasr(monkeypatch, *, text="<|en|><|NEUTRAL|><|Speech|><|withitn|>hello world", fail=False):
    cap = {}

    class FakeAutoModel:
        def __init__(self, model, hub, device, disable_update):
            if fail:
                raise RuntimeError("funasr load failed")
            cap["init"] = dict(model=model, hub=hub, device=device, disable_update=disable_update)

        def generate(self, input, fs, cache, language, use_itn, batch_size_s):
            cap["gen"] = dict(n=len(input), fs=fs, language=language,
                              use_itn=use_itn, batch_size_s=batch_size_s)
            return [{"text": text}]

    fmod = types.ModuleType("funasr")
    fmod.AutoModel = FakeAutoModel
    monkeypatch.setitem(sys.modules, "funasr", fmod)

    torch_mod = types.ModuleType("torch")
    torch_mod.cuda = types.SimpleNamespace(empty_cache=lambda: None, is_available=lambda: True)
    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    return cap


def test_funasr_sensevoice_load_and_transcribe_gpu(monkeypatch):
    cap = _install_fake_funasr(monkeypatch)
    b = backends.make_backend("funasr_sensevoice")
    assert not b.is_loaded
    b.load("FunAudioLLM/SenseVoiceSmall", "cuda", "float16")
    assert b.is_loaded
    assert cap["init"]["model"] == "FunAudioLLM/SenseVoiceSmall"
    assert cap["init"]["hub"] == "hf"
    assert cap["init"]["device"] == "cuda:0"        # "cuda" tier → cuda:0
    assert cap["init"]["disable_update"] is True
    out = b.transcribe(np.zeros(16000, np.float32), None)
    assert out.text == "hello world" and out.language == "en"   # tags stripped, lang parsed
    assert cap["gen"]["fs"] == 16000                # TARGET_RATE
    assert cap["gen"]["use_itn"] is True
    assert cap["gen"]["language"] == "auto"         # None → "auto"
    b.unload()
    assert not b.is_loaded


def test_funasr_sensevoice_honors_cpu_device(monkeypatch):
    cap = _install_fake_funasr(monkeypatch)
    b = backends.make_backend("funasr_sensevoice")
    b.load("FunAudioLLM/SenseVoiceSmall", "cpu", "float32")  # must NOT raise (honors cpu)
    assert b.is_loaded
    assert cap["init"]["device"] == "cpu"


def test_funasr_sensevoice_passes_language_through(monkeypatch):
    cap = _install_fake_funasr(monkeypatch)
    b = backends.make_backend("funasr_sensevoice")
    b.load("FunAudioLLM/SenseVoiceSmall", "cuda", "float16")
    b.transcribe(np.zeros(16000, np.float32), "zh")
    assert cap["gen"]["language"] == "zh"           # explicit language passed through


def test_funasr_sensevoice_load_failure_raises(monkeypatch):
    _install_fake_funasr(monkeypatch, fail=True)
    b = backends.make_backend("funasr_sensevoice")
    with pytest.raises(backends.BackendLoadError):
        b.load("FunAudioLLM/SenseVoiceSmall", "cuda", "float16")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd sidecar
.venv/bin/python -m pytest tests/test_backends.py -k "funasr or strip_sensevoice" -v
```
Expected: FAIL — `AttributeError: module 'sokuji_sidecar.backends' has no attribute '_strip_sensevoice_tags'` and `BackendLoadError: unknown backend: funasr_sensevoice`.

- [ ] **Step 3: Write the implementation**

Append to the end of `sidecar/sokuji_sidecar/backends.py`:

```python
import re

_SV_TAG = re.compile(r"<\|([^|]*)\|>")


def _strip_sensevoice_tags(text):
    """SenseVoice prefixes transcripts with <|lang|><|emotion|><|event|><|withitn|>.
    Return (clean_text, language) for text-only output. The first tag is the
    language code (lowercase, e.g. 'en'); emotion/event tags are not lowercase."""
    tags = _SV_TAG.findall(text)
    lang = tags[0] if tags and tags[0].islower() else None
    return _SV_TAG.sub("", text).strip(), lang


@register_backend
class FunAsrSenseVoiceBackend:
    """FunASR SenseVoiceSmall (PyTorch). model_ref is the HF repo id
    (FunAudioLLM/SenseVoiceSmall). Serves BOTH gpu-cuda (float16) and cpu
    (float32) tiers — honors the device it is given (no GPU-only guard).
    Non-autoregressive encoder+CTC: one generate() per VAD segment. Output
    lang/emotion/event tags are stripped to a clean transcript."""
    NAME = "funasr_sensevoice"

    def __init__(self):
        self._m = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._m = None
        try:
            from funasr import AutoModel
            dev = "cuda:0" if device.startswith("cuda") else device
            self._m = AutoModel(model=model_ref, hub="hf", device=dev,
                                disable_update=True)
        except Exception as e:  # missing funasr, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        res = self._m.generate(input=samples, fs=TARGET_RATE, cache={},
                               language=(language or "auto"), use_itn=True,
                               batch_size_s=60)
        text, lang = _strip_sensevoice_tags(res[0]["text"])
        return AsrResult(text, lang)

    def unload(self) -> None:
        self._m = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    @property
    def is_loaded(self) -> bool:
        return self._m is not None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd sidecar
.venv/bin/python -m pytest tests/test_backends.py -k "funasr or strip_sensevoice" -v
```
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full backends suite (no regressions)**

Run:
```bash
cd sidecar
.venv/bin/python -m pytest tests/test_backends.py -q
```
Expected: all pass (existing sherpa/transformers/etc. tests unaffected; the new backend isn't in the catalog yet).

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/backends.py sidecar/tests/test_backends.py
git commit -m "feat(sidecar): FunASR SenseVoice backend (gpu+cpu)"
```

---

### Task 2: Switch the SenseVoice catalog row & install gate to FunASR

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py:7-9` (repo constant default), `catalog.py:41-43` (sense-voice row), `catalog.py:14` (backend comment — cosmetic)
- Modify: `sidecar/sokuji_sidecar/accel.py:60-73` (`_installed` mods — add funasr gate)
- Test: `sidecar/tests/test_catalog.py`, `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `FunAsrSenseVoiceBackend` (`NAME="funasr_sensevoice"`) from Task 1.
- Produces: `catalog.asr_model("sense-voice")` now has two deployments — `("funasr_sensevoice", "gpu-cuda", "float16", SENSE_VOICE_REPO, 1.0)` and `("funasr_sensevoice", "cpu", "float32", SENSE_VOICE_REPO, 1.0)`; `accel._installed()` maps `"funasr_sensevoice" → "funasr"`.

- [ ] **Step 1: Update the failing tests first**

In `sidecar/tests/test_catalog.py`:

Replace the backend-set assertion in `test_models_have_deployments_and_languages` (add `"funasr_sensevoice"`):
```python
            assert d.backend in {"ctranslate2", "sherpa", "transformers", "qwen3asr",
                                 "cohere_transformers", "voxtral_realtime", "funasr_sensevoice"}
```

Replace `test_sense_voice_uses_sherpa_whisper_uses_ctranslate2` entirely with:
```python
def test_sense_voice_uses_funasr_whisper_uses_ctranslate2():
    assert catalog.asr_model("sense-voice").deployments[0].backend == "funasr_sensevoice"
    assert catalog.asr_model("whisper-tiny").deployments[0].backend == "ctranslate2"


def test_sense_voice_row_has_gpu_and_cpu_funasr():
    m = catalog.asr_model("sense-voice")
    assert m.recommended is True and m.sort_order == 1
    assert [(d.backend, d.tier, d.compute_type) for d in m.deployments] == [
        ("funasr_sensevoice", "gpu-cuda", "float16"),
        ("funasr_sensevoice", "cpu", "float32"),
    ]
    assert all(d.artifact == catalog.SENSE_VOICE_REPO for d in m.deployments)
```

In `sidecar/tests/test_accel.py`, update the four SenseVoice-coupled tests:

`test_resolve_real_catalog_sense_voice_cpu` (line 87 + 90):
```python
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "funasr_sensevoice"}))
    accel.probe(force=True)
    plans = accel.resolve("sense-voice")
    assert plans[0].backend == "funasr_sensevoice" and plans[0].device == "cpu"
```

`test_models_catalog_handler_cpu_machine` (line 154 + 163-164):
```python
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"ctranslate2", "funasr_sensevoice"}))
```
```python
    sv_tiers = by_id["sense-voice"]["tiers"]
    assert sv_tiers == [
        {"tier": "gpu-cuda", "backend": "funasr_sensevoice", "available": False},
        {"tier": "cpu", "backend": "funasr_sensevoice", "available": True},
    ]
```

Replace `test_sense_voice_has_no_gpu_deployment` (lines 201-203) with:
```python
def test_sense_voice_resolves_gpu_when_present():
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),),
                 installed=frozenset({"funasr_sensevoice"}))
    plans = accel.resolve("sense-voice", machine=m)
    assert [p.device for p in plans] == ["cuda", "cpu"]  # GPU preferred, CPU floor survives
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd sidecar
.venv/bin/python -m pytest tests/test_catalog.py tests/test_accel.py -k "sense_voice or models_have or models_catalog_handler_cpu" -v
```
Expected: FAIL — sense-voice still resolves to `sherpa`, has one cpu tier, and `funasr_sensevoice` not in `_installed()`.

- [ ] **Step 3: Implement the catalog + gate change**

In `sidecar/sokuji_sidecar/catalog.py`, change the repo default (lines 7-9):
```python
SENSE_VOICE_REPO = os.environ.get("SOKUJI_ASR_REPO", "FunAudioLLM/SenseVoiceSmall")
```

Replace the sense-voice row (lines 41-43):
```python
    AsrModel("sense-voice", "SenseVoice", ("zh", "en", "ja", "ko", "yue"),
             (Deployment("funasr_sensevoice", "gpu-cuda", "float16", SENSE_VOICE_REPO, 1.0),
              Deployment("funasr_sensevoice", "cpu", "float32", SENSE_VOICE_REPO, 1.0)),
             recommended=True, sort_order=1),
```

Update the `Deployment.backend` comment (line 14) to include the new backend (cosmetic):
```python
    backend: str        # backend NAME: "ctranslate2" | "sherpa" | "transformers" | "qwen3asr" | "cohere_transformers" | "voxtral_realtime" | "funasr_sensevoice"
```

In `sidecar/sokuji_sidecar/accel.py`, add the funasr gate inside the `mods` dict in `_installed()` (after the `"sherpa"` entry, around line 61):
```python
            "funasr_sensevoice": "funasr",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd sidecar
.venv/bin/python -m pytest tests/test_catalog.py tests/test_accel.py -q
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/sokuji_sidecar/accel.py sidecar/tests/test_catalog.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): resolve SenseVoice to FunASR gpu+cpu tiers"
```

---

### Task 3: Repoint download/prefetch to the FunASR model repo

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py:12` (repo constant)
- Modify: `sidecar/sokuji_sidecar/prefetch_models.py:16-17` (prefetch repo)
- Test: `sidecar/tests/test_native_models.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `native_models.download_specs("sense-voice")` → `{"repos": ["FunAudioLLM/SenseVoiceSmall"], "urls": [VAD_URL]}`; prefetch fetches the FunASR repo.

- [ ] **Step 1: Update tests first**

In `sidecar/tests/test_native_models.py`, the existing `test_download_specs_mapping` (line 13-14) already asserts against `nm.SENSE_VOICE_REPO`, so it stays valid after the constant changes — no edit needed there. Update the gated real test that hardcodes the old repo id (around line 66-69) to the new repo:
```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_ASR_MODEL"),
                    reason='set SOKUJI_RUN_ASR_MODEL=1 (uses the cached sense-voice repo)')
def test_real_status_of_sense_voice_repo():
    # sense-voice was downloaded by Tier-0; a bogus id must be absent.
    assert nm.model_status('FunAudioLLM/SenseVoiceSmall') == 'ready'
```
(Keep the bogus-id absent assertion if present on the following lines unchanged.)

Add an explicit mapping assertion to `test_download_specs_mapping` (after the existing `sv = …` block, line 13-14):
```python
    assert sv['repos'] == ['FunAudioLLM/SenseVoiceSmall']
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd sidecar
.venv/bin/python -m pytest tests/test_native_models.py -k "download_specs_mapping" -v
```
Expected: FAIL — `download_specs('sense-voice')['repos']` is still the sherpa repo.

- [ ] **Step 3: Implement the repo repoint**

In `sidecar/sokuji_sidecar/native_models.py` (line 12):
```python
SENSE_VOICE_REPO = "FunAudioLLM/SenseVoiceSmall"
```

In `sidecar/sokuji_sidecar/prefetch_models.py` (lines 16-17):
```python
ASR_REPO = os.environ.get(
    "SOKUJI_ASR_REPO", "FunAudioLLM/SenseVoiceSmall")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd sidecar
.venv/bin/python -m pytest tests/test_native_models.py -q
```
Expected: all pass (gated real tests skipped).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/sokuji_sidecar/prefetch_models.py sidecar/tests/test_native_models.py
git commit -m "feat(sidecar): download SenseVoice from FunAudioLLM/SenseVoiceSmall"
```

---

### Task 4: Add the `funasr` dependency & on-hardware smoke test

**Files:**
- Modify: `sidecar/setup.sh:44` (add `funasr` to the ML install line)
- Test: `sidecar/tests/test_backends.py` (append a real GPU+CPU smoke test, gated)

**Interfaces:**
- Consumes: `FunAsrSenseVoiceBackend` from Task 1; the cached `FunAudioLLM/SenseVoiceSmall` repo.
- Produces: a `SOKUJI_RUN_GPU`-gated test proving real cuda + cpu transcription on a known clip.

- [ ] **Step 1: Add the dependency**

In `sidecar/setup.sh`, append `funasr` to the ML install command (line 44):
```bash
"$PY" -m pip install -q "$TRANSFORMERS_REF" sherpa-onnx faster-whisper sacremoses librosa "mistral-common[audio]>=1.9.0" funasr
```

- [ ] **Step 2: Install funasr into the existing venv**

Run:
```bash
cd sidecar
.venv/bin/python -m pip install -q funasr
.venv/bin/python -c "import funasr, torch; print('funasr', funasr.__version__, '| torch', torch.__version__, '| cuda', torch.cuda.is_available())"
```
Expected: prints a funasr version and `cuda True` (requires a CUDA torch build in this venv — provision cu128 torch if `cuda False`).

- [ ] **Step 3: Write the real smoke test**

Append to `sidecar/tests/test_backends.py`:

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads FunAudioLLM/SenseVoiceSmall ~900MB; needs CUDA torch + funasr)")
def test_funasr_sensevoice_real_gpu_and_cpu_smoke():
    # Real flow: manager downloads first, backend loads from cache. Use a known
    # English clip (sense-voice test wav) → a non-empty transcript on cuda AND cpu.
    import wave
    from huggingface_hub import snapshot_download
    snapshot_download("FunAudioLLM/SenseVoiceSmall")  # populate HF cache
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    dur = len(audio) / 16000.0

    for device in ("cuda", "cpu"):
        b = backends.make_backend("funasr_sensevoice")
        b.load("FunAudioLLM/SenseVoiceSmall", device, "float16" if device == "cuda" else "float32")
        assert b.is_loaded
        b.transcribe(audio, "en")          # warmup (excluded from RTF)
        t0 = time.perf_counter()
        r = b.transcribe(audio, "en")
        rtf = (time.perf_counter() - t0) / dur
        assert isinstance(r.text, str) and r.text.strip(), f"empty transcript on {device}: {r.text!r}"
        assert "<|" not in r.text, f"tags not stripped on {device}: {r.text!r}"
        assert r.language == "en"
        print(f"funasr sensevoice {device} RTF={rtf:.4f} text={r.text!r}")
        b.unload()
```

- [ ] **Step 4: Run the smoke test on the GPU machine**

Run:
```bash
cd sidecar
SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_backends.py -k "funasr_sensevoice_real" -v -s
```
Expected: PASS. Prints two RTF lines — cuda (~0.004) and cpu (~0.03) — both with a non-empty English transcript and no `<|` tags.

- [ ] **Step 5: Run the full suite once more (no regressions)**

Run:
```bash
cd sidecar
.venv/bin/python -m pytest -q
```
Expected: all pass; `SOKUJI_RUN_*` gated tests skipped (unless explicitly enabled).

- [ ] **Step 6: Commit**

```bash
git add sidecar/setup.sh sidecar/tests/test_backends.py
git commit -m "feat(sidecar): add funasr dep + SenseVoice GPU/CPU smoke test"
```

---

## Self-Review

**Spec coverage:**
- Backend `FunAsrSenseVoiceBackend`, honors device (no GPU guard), text-only tag strip → Task 1. ✓
- Two catalog deployments (gpu-cuda + cpu), replace sherpa for SenseVoice → Task 2. ✓
- Install gate `funasr_sensevoice → funasr` → Task 2. ✓
- Download spec + prefetch repoint to `FunAudioLLM/SenseVoiceSmall` → Task 3. ✓
- `funasr` added to `setup.sh` → Task 4. ✓
- Transport/engine/VAD untouched → no task touches `server.py`/`__main__.py`/`asr_engine.py`. ✓
- Testing plan (tag-strip unit, backend smoke cpu+gpu, resolver, regression) → Tasks 1, 2, 4. ✓
- Risk: sherpa-onnx retained for TTS; `SherpaBackend` kept as dead code (deviates from spec's optional deletion suggestion — chosen to avoid TTS-dependency breakage and heavy accel-test churn; spec explicitly marks deletion optional). Documented in Global Constraints. ✓

**Deviation from spec (intentional, noted for reviewer):** the spec's §2 suggested `rich_transcription_postprocess` as the preferred tag handler. That function converts non-neutral emotion/event tags into **emojis**, which violates the locked "text-only clean transcript" decision. The plan uses a deterministic regex strip (`_strip_sensevoice_tags`) instead — guarantees no emojis/tags ever, and mirrors the existing `_strip_qwen_prefix` idiom.

**Placeholder scan:** none — every code/step is concrete.

**Type consistency:** `_strip_sensevoice_tags` returns `(str, str|None)` used consistently in `transcribe`; `NAME="funasr_sensevoice"` identical across backend, catalog deployments, `_installed` gate, and all test assertions; artifact `FunAudioLLM/SenseVoiceSmall` identical in catalog (`SENSE_VOICE_REPO`), `native_models`, `prefetch_models`, and the smoke test.
