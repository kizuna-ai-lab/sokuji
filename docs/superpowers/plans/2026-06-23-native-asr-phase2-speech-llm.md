# Native ASR Phase 2 — Speech-LLM Tier (transformers/Granite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the speech-LLM ASR tier via a `TransformersBackend` adapter running IBM Granite Speech 4.1, GPU-only, proven on the dev 4070.

**Architecture:** A third `AsrBackend` adapter (`TransformersBackend`, NAME `"transformers"`) joins CTranslate2/Sherpa behind the same contract. It lazy-imports torch/transformers, loads Granite via `AutoProcessor` + `AutoModelForSpeechSeq2Seq.from_pretrained(repo, dtype=bf16).to(device)`, and transcribes a VAD segment via Granite's `<|audio|>` chat template → processor → generate → decode. Granite gets GPU-only catalog rows; the Phase-0/1 resolver + fallback + benchmark resolve and measure them unchanged.

**Tech Stack:** Python 3.10, `transformers 5.12.1`, `torch 2.11.0+cu128` + `torchaudio` (CUDA — already installed and proven: Granite transcribes at RTF 0.042 on the RTX 4070), `numpy`, pytest. Sidecar package `sokuji_sidecar` under `sidecar/`.

## Global Constraints

- **Proven on the dev box:** `torch 2.11.0+cu128` + `torchaudio 2.11.0+cu128` installed; `AutoModelForSpeechSeq2Seq.from_pretrained("ibm-granite/granite-speech-4.1-2b-plus", dtype=torch.bfloat16).to("cuda")` loads (≈56s, VRAM 4.22GB) and transcribes correctly at RTF 0.042. The env-gated proof runs with `SOKUJI_RUN_GPU=1`.
- **`.to(device)`, NOT `device_map`** — avoids the `accelerate` dependency (not installed).
- **GPU-only Granite:** the catalog rows declare ONLY a `gpu-cuda`/`bfloat16` `transformers` deployment — NO `cpu` deployment. On a non-NVIDIA (or no-transformers) machine `resolve` raises `NoUsablePlan` (gated off, like Voxtral). Full-precision 2B on CPU isn't real-time.
- **Lazy heavy imports:** `torch`/`transformers` imported INSIDE `TransformersBackend.load()`/`transcribe()`, never at module top.
- **The CPU-floor invariant is now SYSTEM-level**, not per-model: GPU-only models are allowed; the system still always has a CPU floor via Whisper/sense-voice.
- **Backend name string:** `"transformers"`. Granite repos: `ibm-granite/granite-speech-4.1-2b` (base, +ja) and `ibm-granite/granite-speech-4.1-2b-plus` (cached smoke).
- **Run tests with** `.venv/bin/python -m pytest <paths> -q` from `sidecar/`. Baseline: 70 passed / 10 skipped.
- **Commit messages:** Conventional Commits. No hand-written trailers.
- **Out of scope:** llama.cpp/GGUF backend (next increment), MLX (macOS), renderer integration, the production `-2b` (ja) download beyond catalog declaration.

---

## File Structure

**Modify:**
- `sidecar/sokuji_sidecar/backends.py` — add `TransformersBackend` (+ the Granite system/ASR prompt constants).
- `sidecar/sokuji_sidecar/accel.py` — `_installed()` gains `"transformers"`.
- `sidecar/sokuji_sidecar/catalog.py` — add the two Granite GPU-only rows.
- `sidecar/tests/test_backends.py` — fake-transformers unit tests.
- `sidecar/tests/test_accel.py` — `_installed` test + Granite resolve / NoUsablePlan tests + the env-gated real-GPU proof.
- `sidecar/tests/test_catalog.py` — relax the cpu-floor invariant to system-level + extend the backend allowlist + Granite language regression.

---

## Task 1: TransformersBackend adapter

**Files:**
- Modify: `sidecar/sokuji_sidecar/backends.py`
- Test: `sidecar/tests/test_backends.py`

**Interfaces:**
- Consumes: `register_backend`, `AsrResult`, `BackendLoadError`, `make_backend` (Phase 0).
- Produces: `TransformersBackend` with `NAME = "transformers"`. `load(model_ref, device, compute_type)` builds `AutoProcessor` + `AutoModelForSpeechSeq2Seq.from_pretrained(model_ref, dtype=torch.bfloat16 if compute_type=="bfloat16" else torch.float16).to(device).eval()`. `transcribe(samples, language)` runs Granite's chat template (`<|audio|>` user prompt) → processor → `generate` → decode → `AsrResult`. `unload()` drops refs + `torch.cuda.empty_cache()`. Construction failure raises `BackendLoadError`.

- [ ] **Step 1: Write the failing test** (append to `test_backends.py`)

```python
import contextlib


def _install_fake_transformers(monkeypatch, *, fail=False):
    cap = {}

    class FakeIds:
        shape = (1, 4)  # prompt length 4

    class FakeInputs(dict):
        def to(self, device):
            cap["to_device"] = device
            return self

    class FakeTok:
        def apply_chat_template(self, chat, tokenize, add_generation_prompt):
            cap["chat"] = chat
            return "PROMPT_TEXT"
        def decode(self, tokens, skip_special_tokens=True):
            return "  the tribal chieftain  "

    class FakeProc:
        tokenizer = FakeTok()
        def __call__(self, ptext, samples, device, return_tensors):
            cap["proc_call"] = (ptext, len(samples), device, return_tensors)
            return FakeInputs({"input_ids": FakeIds()})

    class FakeOut:
        def __getitem__(self, idx):  # out[0, 4:]
            cap["slice"] = idx
            return ["a", "b"]

    class FakeModel:
        def to(self, device):
            cap["model_device"] = device
            return self
        def eval(self):
            return self
        def generate(self, **kw):
            cap["generate_kw"] = kw
            return FakeOut()

    class FakeAutoProcessor:
        @staticmethod
        def from_pretrained(repo):
            if fail:
                raise RuntimeError("model not found")
            cap["proc_repo"] = repo
            return FakeProc()

    class FakeAutoModel:
        @staticmethod
        def from_pretrained(repo, dtype):
            cap["model_repo"] = repo
            cap["dtype"] = dtype
            return FakeModel()

    tmod = types.ModuleType("transformers")
    tmod.AutoProcessor = FakeAutoProcessor
    tmod.AutoModelForSpeechSeq2Seq = FakeAutoModel
    monkeypatch.setitem(sys.modules, "transformers", tmod)

    torch_mod = types.ModuleType("torch")
    torch_mod.bfloat16 = "BF16"
    torch_mod.float16 = "F16"
    torch_mod.inference_mode = contextlib.nullcontext
    torch_mod.cuda = types.SimpleNamespace(empty_cache=lambda: None, is_available=lambda: True)
    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    return cap


def test_transformers_load_and_transcribe(monkeypatch):
    cap = _install_fake_transformers(monkeypatch)
    b = backends.make_backend("transformers")
    assert not b.is_loaded
    b.load("ibm-granite/granite-speech-4.1-2b", "cuda", "bfloat16")
    assert b.is_loaded
    assert cap["model_repo"] == "ibm-granite/granite-speech-4.1-2b"
    assert cap["dtype"] == "BF16"          # bfloat16 → torch.bfloat16
    assert cap["model_device"] == "cuda"
    out = b.transcribe(np.zeros(16000, np.float32), "en")
    assert out.text == "the tribal chieftain"   # decoded + stripped
    assert "<|audio|>" in cap["chat"][-1]["content"]   # audio placeholder in the user prompt
    assert cap["generate_kw"]["do_sample"] is False
    b.unload()
    assert not b.is_loaded


def test_transformers_load_failure_raises(monkeypatch):
    _install_fake_transformers(monkeypatch, fail=True)
    b = backends.make_backend("transformers")
    with pytest.raises(backends.BackendLoadError):
        b.load("bad/repo", "cuda", "bfloat16")
```

(`sys`, `types`, `numpy as np`, `pytest` are already imported at the top of `test_backends.py` from Phase 0/1; add `import contextlib` to the top with them rather than mid-file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_backends.py -k transformers -q`
Expected: FAIL — `BackendLoadError: unknown backend: transformers`.

- [ ] **Step 3: Write the implementation** (append to `backends.py`)

```python
_GRANITE_SYSTEM = ("Knowledge Cutoff Date: April 2024.\n"
                   "You are Granite, developed by IBM. You are a helpful AI assistant")
_GRANITE_ASR_PROMPT = "<|audio|> can you transcribe the speech into a written format?"


@register_backend
class TransformersBackend:
    """HuggingFace transformers speech-LLM (Granite Speech 4.1). model_ref is the
    HF repo id; GPU-tier (bf16). Loaded via .to(device) (no accelerate). The
    Granite chat template is encapsulated here; a future model would add its own."""
    NAME = "transformers"

    def __init__(self):
        self._model = None
        self._proc = None
        self._device = "cpu"

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._proc = None
        try:
            import torch
            from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
            dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float16
            self._proc = AutoProcessor.from_pretrained(model_ref)
            self._model = AutoModelForSpeechSeq2Seq.from_pretrained(
                model_ref, dtype=dtype).to(device).eval()
            self._device = device
        except Exception as e:  # missing torch/transformers, no CUDA, OOM → resolver handles
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        import torch
        tok = self._proc.tokenizer
        chat = [{"role": "system", "content": _GRANITE_SYSTEM},
                {"role": "user", "content": _GRANITE_ASR_PROMPT}]
        ptext = tok.apply_chat_template(chat, tokenize=False, add_generation_prompt=True)
        inputs = self._proc(ptext, samples, device=self._device, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=256, do_sample=False, num_beams=1)
        text = tok.decode(out[0, inputs["input_ids"].shape[-1]:], skip_special_tokens=True)
        return AsrResult(text.strip(), language)

    def unload(self) -> None:
        self._model = None
        self._proc = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_backends.py -q`
Expected: PASS (existing backend tests + the 2 new transformers tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/backends.py sidecar/tests/test_backends.py
git commit -m "feat(sidecar): TransformersBackend adapter (Granite Speech via transformers)"
```

---

## Task 2: probe detects the transformers backend

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py`
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Produces: `accel._installed()` now includes `"transformers"` when the `transformers` package is importable (so a `transformers` deployment is only offered on a machine that has it).

- [ ] **Step 1: Write the failing test** (append to `test_accel.py`)

```python
def test_installed_includes_transformers():
    # transformers is a sidecar dependency → detected by _installed()
    assert "transformers" in accel._installed()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_accel.py -k installed_includes_transformers -q`
Expected: FAIL — `"transformers"` not in the installed set (not yet in the `_installed` map).

- [ ] **Step 3: Add transformers to the detection map** (`accel.py`)

In `_installed()`, add the `transformers` entry to the `mods` dict:

```python
def _installed() -> frozenset:
    mods = {"ctranslate2": "faster_whisper", "sherpa": "sherpa_onnx",
            "onnx": "onnxruntime", "llamacpp": "llama_cpp", "mlx": "mlx_lm",
            "transformers": "transformers"}
    return frozenset(b for b, mod in mods.items() if importlib.util.find_spec(mod) is not None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_accel.py -k installed_includes_transformers -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): probe detects the transformers backend"
```

---

## Task 3: Granite GPU-only catalog rows + system-level CPU-floor invariant

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py`
- Test: `sidecar/tests/test_catalog.py`, `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `Deployment`, `AsrModel` (Phase 0); `accel.resolve`/`NoUsablePlan`, the `_machine` test helper (Phase 0/1).
- Produces: `ASR_MODELS` gains `granite-speech-4.1-2b` (en/fr/de/es/pt/ja) and `granite-speech-4.1-2b-plus` (en/fr/de/es/pt), each with a SINGLE `Deployment("transformers", "gpu-cuda", "bfloat16", <repo>, 1.0)` — GPU-only. `resolve("granite-*")` returns `[Plan(transformers, gpu-cuda, cuda, bfloat16, <repo>)]` on a machine with `nvidia` + `"transformers"` installed; raises `NoUsablePlan` otherwise.

- [ ] **Step 1: Write the failing tests**

Append to `test_accel.py`:

```python
def test_granite_resolves_gpu_only_on_nvidia_with_transformers():
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),), installed=frozenset({"transformers"}))
    plans = accel.resolve("granite-speech-4.1-2b", machine=m)
    assert [p.device for p in plans] == ["cuda"]   # gpu-only → single plan, no cpu floor
    assert plans[0].backend == "transformers" and plans[0].compute_type == "bfloat16"


def test_granite_gated_off_on_cpu_only_machine():
    # no nvidia → gpu-cuda filtered → no plan → NoUsablePlan (gated off)
    with pytest.raises(accel.NoUsablePlan):
        accel.resolve("granite-speech-4.1-2b",
                      machine=_machine(installed=frozenset({"transformers"})))


def test_granite_gated_off_without_transformers_installed():
    # has a GPU but transformers not installed → backend filtered → NoUsablePlan
    with pytest.raises(accel.NoUsablePlan):
        accel.resolve("granite-speech-4.1-2b",
                      machine=_machine(nvidia=(accel.Gpu("nvidia", "x", 0),),
                                       installed=frozenset({"ctranslate2"})))
```

Append to `test_catalog.py` (the Granite language regression):

```python
def test_granite_language_regression():
    assert catalog.asr_model("granite-speech-4.1-2b").languages == ("en", "fr", "de", "es", "pt", "ja")
    assert catalog.asr_model("granite-speech-4.1-2b-plus").languages == ("en", "fr", "de", "es", "pt")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_accel.py -k granite tests/test_catalog.py -k granite -q`
Expected: FAIL — `granite-speech-4.1-2b` is not in the catalog (`ValueError: unknown asr model` / `asr_model(...) is None`).

- [ ] **Step 3: Add the Granite rows** (`catalog.py`)

Append these two `AsrModel` entries to `ASR_MODELS` (after `whisper-tiny`):

```python
    AsrModel("granite-speech-4.1-2b", "Granite Speech 4.1 (2B)", ("en", "fr", "de", "es", "pt", "ja"),
             (Deployment("transformers", "gpu-cuda", "bfloat16", "ibm-granite/granite-speech-4.1-2b", 1.0),),
             sort_order=5),
    AsrModel("granite-speech-4.1-2b-plus", "Granite Speech 4.1 (2B+)", ("en", "fr", "de", "es", "pt"),
             (Deployment("transformers", "gpu-cuda", "bfloat16", "ibm-granite/granite-speech-4.1-2b-plus", 1.0),),
             sort_order=6),
```

- [ ] **Step 4: Fix the now-too-strict CPU-floor invariant** (`test_catalog.py`)

Adding GPU-only Granite breaks `test_every_model_has_a_cpu_deployment_and_languages` (Granite has no CPU deployment). The spec permits GPU-only models; the CPU floor is a SYSTEM invariant, not per-model. **Replace** that test with these two:

```python
def test_models_have_deployments_and_languages():
    for m in catalog.asr_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        for d in m.deployments:
            assert d.backend in {"ctranslate2", "sherpa", "transformers"}


def test_system_has_a_cpu_floor():
    # GPU-only models (Granite/Voxtral) are allowed; the SYSTEM still always has a
    # CPU floor via Whisper / sense-voice.
    assert any(any(d.tier == "cpu" for d in m.deployments) for m in catalog.asr_models())
```

(Delete the old `test_every_model_has_a_cpu_deployment_and_languages`. The backend allowlist now includes `"transformers"`.)

- [ ] **Step 5: Run the new + existing catalog/accel suites**

Run: `.venv/bin/python -m pytest tests/test_catalog.py tests/test_accel.py -q`
Expected: PASS — Granite resolves gpu-only / gates off correctly; the system-CPU-floor invariant passes (Whisper/sense-voice provide it); the Granite language regression passes; all Phase-0/1 resolver tests still pass.

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): GPU-only Granite catalog rows; CPU floor is now a system invariant"
```

---

## Task 4: Real-GPU proof on the 4070 + full verification

**Files:**
- Modify: `sidecar/tests/test_accel.py` (env-gated real-GPU Granite test)

**Interfaces:**
- Consumes: everything above + the real CUDA torch + the cached `granite-speech-4.1-2b-plus`.

- [ ] **Step 1: Write the env-gated real-GPU test** (append to `test_accel.py`)

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (NVIDIA GPU + CUDA torch + transformers + Granite cached)")
def test_real_gpu_granite_transcribes(tmp_path, monkeypatch):
    monkeypatch.setenv("SOKUJI_BENCH_DIR", str(tmp_path))  # isolate the bench cache
    accel.probe(force=True)
    plans = accel.resolve("granite-speech-4.1-2b-plus")
    assert plans[0].device == "cuda" and plans[0].backend == "transformers", \
        f"expected transformers/cuda, got {[(p.backend, p.device) for p in plans]}"
    backend, plan, _notice = accel.load_with_fallback(plans)
    try:
        from huggingface_hub import snapshot_download
        import wave
        d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
        w = wave.open(f"{d}/test_wavs/en.wav", "rb")
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        text = backend.transcribe(audio, None).text.lower()
        assert "gold" in text or "tribal" in text, f"unexpected transcript: {text!r}"
        rtf = accel.measure_rtf(backend, plan, "granite-speech-4.1-2b-plus", accel.probe(), force=True)
        assert rtf is not None and rtf < 1.0, f"speech-LLM should be faster than realtime on GPU, rtf={rtf}"
    finally:
        backend.unload()
```

- [ ] **Step 2: Run the full pure suite (no GPU env) — confirm green + skips**

Run: `.venv/bin/python -m pytest -q`
Expected: all pure tests pass; the new GPU test shows as skipped (no `SOKUJI_RUN_GPU`). No failures. (Pure tests use the fake transformers module; the real torch/transformers are not imported on the pure path.)

- [ ] **Step 3: Run the real-GPU Granite proof on the 4070**

Run: `SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_accel.py -k "real_gpu_granite" -q`
Expected: PASS — `resolve("granite-speech-4.1-2b-plus")` returns transformers/cuda, the backend loads Granite on the GPU (~56s first load), transcribes the test wav to text containing "gold"/"tribal", and the benchmark RTF is < 1.0. This is the Phase-2 speech-LLM GPU proof. (Takes ~1 min for the model load.)

- [ ] **Step 4: Confirm no regression in the Phase-0/1 GPU proofs**

Run: `SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_accel.py -k "real_gpu" -q`
Expected: PASS — the Phase-1 Whisper-cuda proof AND the new Granite proof both pass (the Granite rows didn't disturb Whisper resolution).

- [ ] **Step 5: Commit**

```bash
git add sidecar/tests/test_accel.py
git commit -m "test(sidecar): env-gated GPU proof — Granite speech-LLM transcribes on the 4070"
```

---

## Self-Review

**Spec coverage:**
- `TransformersBackend` adapter (load/transcribe/unload, Granite chat template, bf16, `.to(device)`) → Task 1.
- GPU-only Granite catalog rows (`-2b` +ja, `-2b-plus` cached) → Task 3.
- `probe._installed` gains `"transformers"` → Task 2.
- Resolver reuse: Granite resolves gpu-only / gates off via `NoUsablePlan` → Task 3 (no resolver change needed — the Phase-0/1 `resolve`/`load_with_fallback`/`measure_rtf` handle it).
- The GPU-only error contract (NoUsablePlan when gated; AllPlansFailed if a GPU load fails) → falls out of the Phase-0/1 chain + the gpu-only rows (verified by Task 3's gating tests; the AllPlansFailed-on-load-fail path is the existing Phase-0 behavior, unchanged).
- Env-gated GPU proof → Task 4.
- **Deferred (noted):** llama.cpp/GGUF, MLX, renderer integration, the `-2b` ja download path. Out of scope, consistent with the spec.

**Placeholder scan:** none — every step has complete code + exact commands. The CPU-floor-invariant correction (Task 3 Step 4) is shown in full, not described.

**Type consistency:** `TransformersBackend.NAME == "transformers"` matches the catalog `Deployment(backend="transformers", ...)` (Task 3) and `_installed()`'s `"transformers"` key (Task 2). `compute_type="bfloat16"` (catalog) maps to `torch.bfloat16` in `load` (Task 1). `measure_rtf(backend, plan, model_id, machine, *, force=False)` (Phase 1) is called with the same shape in Task 4. The Granite repos are identical strings between the catalog rows (Task 3) and the GPU proof (Task 4: `"granite-speech-4.1-2b-plus"`).

## Notes / decisions

- **Granite is GPU-only by decision** (user-confirmed): full-precision 2B on CPU isn't real-time, so no CPU deployment. The system CPU-floor invariant moves from per-model to system-level (Task 3 Step 4) — the spec explicitly permits GPU-only models.
- **No `accelerate`, no `device_map`:** `.to(device)` is the proven path; keeps the dep set lean.
- **The Granite chat template is hardcoded in the backend** (Granite-only for now). A future speech-LLM model would add its own template — but YAGNI until the llama.cpp/Qwen increment.
- **56s model load** at first `init()` is the session-start cost (a 2B model → GPU), consistent with the existing blocking-init pattern; the transcribe itself is ~0.3s.
