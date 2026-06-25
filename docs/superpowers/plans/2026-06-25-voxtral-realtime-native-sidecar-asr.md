# Voxtral Mini 4B Realtime — Native Sidecar ASR (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mistralai/Voxtral-Mini-4B-Realtime-2602` as a GPU ASR model in the native Python sidecar, run **offline per VAD segment** through the existing `AsrBackend` seam (a drop-in peer of Qwen3-ASR / Cohere).

**Architecture:** A new `VoxtralRealtimeBackend` (transformers-native, GPU bf16) registered under the existing `@register_backend` registry; the resolver self-gates it on `transformers.models.voxtral_realtime`; one declarative `catalog.py` row; a `native_models.download_specs` branch with a new `ignore` key (to skip the 8.86 GB Mistral-format duplicate); one renderer catalog row; the `mistral-common[audio]` dep added to `setup.sh`; and a `SOKUJI_RUN_GPU`-gated real smoke test.

**Tech Stack:** Python (sidecar), HuggingFace transformers `5.13.0.dev0` (the PR-#43838 fork already pinned — `voxtral_realtime` ships in it, no bump), torch cu128, `mistral-common[audio]`, sherpa-onnx silero VAD; TypeScript/Vitest (renderer); pytest (sidecar).

## Global Constraints

(Copied verbatim from the spec — every task implicitly includes these.)

- **Model id (catalog):** `voxtral-mini-4b-realtime`. **HF repo (artifact):** `mistralai/Voxtral-Mini-4B-Realtime-2602`. **Backend NAME:** `voxtral_realtime`. **Self-gate module:** `transformers.models.voxtral_realtime`.
- **GPU-only, bf16.** No CPU deployment. `load()` on `device == "cpu"` raises `BackendLoadError`.
- **Languages (13, exact order):** `en, fr, es, de, ru, zh, ja, it, pt, nl, ar, hi, ko`.
- **`recommended = False` / `recommended` unset** (Phase 1); **`sort_order = 9`** (sidecar) and **`sortOrder = 9`** (renderer) — appended after Qwen3 (8); no existing rows shift.
- **Offline load uses the snapshot-DIR pattern**, NOT the repo-id pattern: `mistral_common` ignores `local_files_only`/`HF_HUB_OFFLINE`, so resolve `d = snapshot_download(repo, local_files_only=True)` and load the processor + model from `d`.
- **Download skips `consolidated.safetensors`** (8.86 GB Mistral-format duplicate; transformers uses `model.safetensors`) via a new optional `ignore` key on the `download_specs` dict, honored in `download()` and `model_size()`. The key defaults to `[]` and is inert for every existing model.
- **Dependency:** `mistral-common[audio]>=1.9.0` is required (the processor's tokenizer is `MistralCommonBackend`); added to `sidecar/setup.sh`.
- **Transcribe is audio-only:** no chat template, no language hint (multilingual auto-detect), no prompt slicing — `batch_decode(generate(**inputs), skip_special_tokens=True)[0]`. Generation length is the model's audio-derived auto-length (do NOT pass `max_new_tokens`).
- **TARGET_RATE = 16000** (already a module constant in `backends.py`).
- **Correctness gates:** `pytest` (sidecar) + `vitest` (renderer), NOT `tsc`. English-only comments.
- **Run sidecar pytest from the `sidecar/` dir** with the venv: `sidecar/.venv/bin/python -m pytest`.

---

### Task 1: `VoxtralRealtimeBackend` (the backend adapter)

**Files:**
- Modify: `sidecar/sokuji_sidecar/backends.py` (append a new `@register_backend` class after `CohereTransformersBackend`, ~line 282)
- Test: `sidecar/tests/test_backends.py` (append fakes + tests after the Cohere tests)

**Interfaces:**
- Consumes: `backends.register_backend`, `backends.make_backend`, `backends.AsrResult`, `backends.BackendLoadError`, `backends.TARGET_RATE` (all already defined).
- Produces: a backend registered under `NAME = "voxtral_realtime"` honoring the `load(model_ref, device, compute_type)` / `transcribe(samples, language) -> AsrResult` / `unload()` / `is_loaded` contract. Later tasks (catalog, resolver, smoke) reference the string `"voxtral_realtime"`.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_backends.py`:

```python
def test_voxtral_realtime_is_gpu_only():
    b = backends.make_backend("voxtral_realtime")
    with pytest.raises(backends.BackendLoadError):
        b.load("mistralai/Voxtral-Mini-4B-Realtime-2602", "cpu", "bfloat16")


def _install_fake_voxtral(monkeypatch, *, decoded="  hello world  ", fail=False):
    cap = {}

    class FakeFeat:
        def to(self, dtype):
            cap["feat_dtype"] = dtype
            return self

    class FakeBatch(dict):
        def to(self, device):
            cap["inp_device"] = device
            return self

    class FakeProc:
        # Voxtral realtime processor: positional audio + sampling_rate + return_tensors.
        # No language (multilingual auto-detect), no chat template. If the backend ever
        # passed language=, this signature would TypeError — guarding that contract.
        def __call__(self, samples, sampling_rate, return_tensors):
            cap["sr"] = sampling_rate
            cap["n_samples"] = len(samples)
            b = FakeBatch()
            b["input_features"] = FakeFeat()
            b["input_ids"] = "IDS"
            return b

        def batch_decode(self, seq, skip_special_tokens):
            cap["decoded_seq"] = seq
            cap["skip_special"] = skip_special_tokens
            return [decoded]

    class FakeModel:
        def to(self, device):
            cap["model_device"] = device
            return self

        def eval(self):
            return self

        def generate(self, **kw):
            cap["gen_kw"] = kw
            return "OUT"

    class FakeAutoProcessor:
        @staticmethod
        def from_pretrained(path, local_files_only=False):
            cap["proc_path"] = path
            cap["proc_local_files_only"] = local_files_only
            return FakeProc()

    class FakeVoxtral:
        @staticmethod
        def from_pretrained(path, dtype, local_files_only=False):
            if fail:
                raise RuntimeError("voxtral_realtime missing")
            cap["model_path"] = path
            cap["dtype"] = dtype
            cap["model_local_files_only"] = local_files_only
            return FakeModel()

    tmod = types.ModuleType("transformers")
    tmod.AutoProcessor = FakeAutoProcessor
    tmod.VoxtralRealtimeForConditionalGeneration = FakeVoxtral
    monkeypatch.setitem(sys.modules, "transformers", tmod)

    hub = types.ModuleType("huggingface_hub")

    def fake_snapshot(repo, local_files_only=False):
        cap["snap_repo"] = repo
        cap["snap_local_files_only"] = local_files_only
        return f"/fake/snapshot/{repo}"

    hub.snapshot_download = fake_snapshot
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)

    torch_mod = types.ModuleType("torch")
    torch_mod.bfloat16 = "BF16"
    torch_mod.float16 = "F16"
    torch_mod.inference_mode = contextlib.nullcontext
    torch_mod.cuda = types.SimpleNamespace(empty_cache=lambda: None, is_available=lambda: True)
    monkeypatch.setitem(sys.modules, "torch", torch_mod)
    return cap


def test_voxtral_realtime_load_and_transcribe(monkeypatch):
    cap = _install_fake_voxtral(monkeypatch)
    b = backends.make_backend("voxtral_realtime")
    assert not b.is_loaded
    b.load("mistralai/Voxtral-Mini-4B-Realtime-2602", "cuda", "bfloat16")
    assert b.is_loaded
    # Offline load resolves the snapshot DIR (local_files_only) and loads the processor
    # + model FROM that dir — mistral_common ignores local_files_only on a repo id.
    assert cap["snap_repo"] == "mistralai/Voxtral-Mini-4B-Realtime-2602"
    assert cap["snap_local_files_only"] is True
    assert cap["proc_path"] == "/fake/snapshot/mistralai/Voxtral-Mini-4B-Realtime-2602"
    assert cap["model_path"] == "/fake/snapshot/mistralai/Voxtral-Mini-4B-Realtime-2602"
    assert cap["dtype"] == "BF16"            # bfloat16 → torch.bfloat16
    assert cap["model_device"] == "cuda"
    assert cap["model_local_files_only"] is True
    r = b.transcribe(np.zeros(16000, np.float32), "en")
    assert r.text == "hello world"           # decoded + stripped, audio-only → no prefix/slice
    assert cap["feat_dtype"] == "BF16"        # input_features cast to model dtype
    assert cap["sr"] == 16000                 # TARGET_RATE
    assert cap["skip_special"] is True
    assert cap["gen_kw"]["do_sample"] is False
    assert "max_new_tokens" not in cap["gen_kw"]   # audio-derived auto-length, no cap
    b.unload()
    assert not b.is_loaded


def test_voxtral_realtime_load_failure_raises(monkeypatch):
    _install_fake_voxtral(monkeypatch, fail=True)
    b = backends.make_backend("voxtral_realtime")
    with pytest.raises(backends.BackendLoadError):
        b.load("mistralai/Voxtral-Mini-4B-Realtime-2602", "cuda", "bfloat16")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -k voxtral -v`
Expected: FAIL — `BackendLoadError: unknown backend: voxtral_realtime` (the backend isn't registered yet). `test_voxtral_realtime_is_gpu_only` may pass-by-accident because `make_backend` raises `BackendLoadError` for the unknown name; that's fine, the other two must fail.

- [ ] **Step 3: Implement the backend**

Append to `sidecar/sokuji_sidecar/backends.py` (after the `CohereTransformersBackend` class):

```python
@register_backend
class VoxtralRealtimeBackend:
    """Voxtral Mini 4B Realtime via native transformers
    (VoxtralRealtimeForConditionalGeneration). model_ref is the HF repo; GPU-tier (bf16),
    loaded with .to(device) (no accelerate). Phase 1 runs the STREAMING model OFFLINE: one
    whole VAD segment per generate() — audio-only input, transcript-only output (no chat
    template, no prompt slice). Multilingual auto-detect, so the language arg is recorded,
    not passed. The processor's tokenizer is mistral_common's, which ignores
    local_files_only; so load() resolves the snapshot DIR and loads the processor from it."""
    NAME = "voxtral_realtime"

    def __init__(self):
        self._model = None
        self._proc = None
        self._device = "cpu"
        self._dtype = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._proc = None
        if device == "cpu":
            raise BackendLoadError("voxtral_realtime is GPU-only")
        try:
            import torch
            from huggingface_hub import snapshot_download
            from transformers import VoxtralRealtimeForConditionalGeneration, AutoProcessor
            self._dtype = torch.bfloat16 if compute_type in ("bfloat16", "auto") else torch.float16
            # mistral_common's tokenizer loader ignores local_files_only / HF_HUB_OFFLINE and
            # tries to hit the hub; loading from the resolved snapshot DIR makes it read the
            # cached tekken.json locally. SherpaBackend uses the same dir-resolve idiom.
            d = snapshot_download(model_ref, local_files_only=True)
            self._proc = AutoProcessor.from_pretrained(d)
            self._model = VoxtralRealtimeForConditionalGeneration.from_pretrained(
                d, dtype=self._dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:  # missing voxtral_realtime module, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        import torch
        inp = self._proc(samples, sampling_rate=TARGET_RATE, return_tensors="pt").to(self._device)
        if "input_features" in inp:  # features are float32, model is bf16
            inp["input_features"] = inp["input_features"].to(self._dtype)
        with torch.inference_mode():
            out = self._model.generate(**inp, do_sample=False)  # audio-derived auto-length
        text = self._proc.batch_decode(out, skip_special_tokens=True)[0]
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -k voxtral -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/backends.py sidecar/tests/test_backends.py
git commit -m "feat(sidecar): VoxtralRealtimeBackend (Voxtral Mini 4B Realtime, GPU bf16, offline)"
```

---

### Task 2: Catalog row

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (the `Deployment.backend` doc comment, line ~14; append an `AsrModel` row to `ASR_MODELS`, after the `qwen3-asr-1.7b` row ~line 67)
- Test: `sidecar/tests/test_catalog.py` (extend the allowed-backend set, line 9; add a row test)

**Interfaces:**
- Consumes: the backend NAME string `"voxtral_realtime"` (Task 1), `catalog.AsrModel`, `catalog.Deployment`.
- Produces: `catalog.asr_model("voxtral-mini-4b-realtime")` returning an `AsrModel` whose single `Deployment` is `("voxtral_realtime", "gpu-cuda", "bfloat16", "mistralai/Voxtral-Mini-4B-Realtime-2602")`, `recommended=False`, `sort_order=9`. Task 3 (resolver) and Task 4 (download) reference the id.

- [ ] **Step 1: Write the failing tests**

In `sidecar/tests/test_catalog.py`, modify the allowed-backend set in `test_models_have_deployments_and_languages` (line 9) to include the new backend:

```python
            assert d.backend in {"ctranslate2", "sherpa", "transformers", "qwen3asr", "cohere_transformers", "voxtral_realtime"}
```

Then append a new test:

```python
def test_voxtral_realtime_row():
    m = catalog.asr_model("voxtral-mini-4b-realtime")
    assert m is not None
    assert m.name == "Voxtral Mini 4B Realtime"
    assert m.languages == ("en", "fr", "es", "de", "ru", "zh", "ja", "it", "pt", "nl", "ar", "hi", "ko")
    assert m.recommended is False        # Phase 1: offline mode; promote when streaming lands
    assert m.sort_order == 9             # appended after Qwen3 (8); no existing rows shift
    d = m.deployments[0]
    assert (d.backend, d.tier, d.compute_type, d.artifact) == \
        ("voxtral_realtime", "gpu-cuda", "bfloat16", "mistralai/Voxtral-Mini-4B-Realtime-2602")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -k voxtral -v`
Expected: FAIL — `AttributeError: 'NoneType' object has no attribute 'name'` (`asr_model` returns `None`; the row doesn't exist yet).

- [ ] **Step 3: Add the catalog row**

In `sidecar/sokuji_sidecar/catalog.py`, update the `Deployment.backend` doc comment (line ~14) to list the new backend:

```python
    backend: str        # backend NAME: "ctranslate2" | "sherpa" | "transformers" | "qwen3asr" | "cohere_transformers" | "voxtral_realtime"
```

Then append this row to the `ASR_MODELS` list, immediately after the `qwen3-asr-1.7b` `AsrModel(...)` entry (keep it the last element):

```python
    AsrModel("voxtral-mini-4b-realtime", "Voxtral Mini 4B Realtime",
             ("en", "fr", "es", "de", "ru", "zh", "ja", "it", "pt", "nl", "ar", "hi", "ko"),
             (Deployment("voxtral_realtime", "gpu-cuda", "bfloat16",
                         "mistralai/Voxtral-Mini-4B-Realtime-2602", 1.0),),
             recommended=False, sort_order=9),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -v`
Expected: PASS (all catalog tests, including the new `test_voxtral_realtime_row` and the updated allowed-backend set).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(sidecar): voxtral-mini-4b-realtime catalog row (gpu-cuda bf16, 13 langs)"
```

---

### Task 3: Resolver self-gate

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_installed()` `mods` dict, ~line 69)
- Test: `sidecar/tests/test_accel.py` (append three tests after the Cohere gate tests, ~line 425)

**Interfaces:**
- Consumes: `catalog.asr_model("voxtral-mini-4b-realtime")` (Task 2), `accel._installed`, `accel.resolve_deployments`, `accel.Machine`, `accel.Gpu`.
- Produces: `_installed()` includes `"voxtral_realtime"` iff `transformers.models.voxtral_realtime` imports; the resolver yields a single `gpu-cuda` plan on an NVIDIA box with the runtime installed, and `[]` otherwise (no CPU floor).

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_accel.py`:

```python
def test_voxtral_realtime_gated_on_voxtral_realtime_module(monkeypatch):
    import importlib.util as iu
    from sokuji_sidecar import accel
    real = iu.find_spec

    def absent(name, *a, **k):
        if name == "transformers.models.voxtral_realtime":
            return None
        return real(name, *a, **k)
    monkeypatch.setattr(accel.importlib.util, "find_spec", absent)
    assert "voxtral_realtime" not in accel._installed()

    def present(name, *a, **k):
        if name == "transformers.models.voxtral_realtime":
            return object()
        return real(name, *a, **k)
    monkeypatch.setattr(accel.importlib.util, "find_spec", present)
    assert "voxtral_realtime" in accel._installed()


def test_voxtral_resolves_gpu_on_nvidia_with_runtime():
    from sokuji_sidecar import accel, catalog
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      nvidia=(accel.Gpu(vendor="nvidia", name="x", vram_mb=12000),),
                      apple_silicon=False, dml_adapters=(),
                      installed=frozenset({"voxtral_realtime", "transformers"}),
                      fingerprint="testfp")
    plans = accel.resolve_deployments(catalog.asr_model("voxtral-mini-4b-realtime"), m)
    assert [p.device for p in plans] == ["cuda"]
    assert plans[0].backend == "voxtral_realtime" and plans[0].compute_type == "bfloat16"


def test_voxtral_model_unavailable_without_runtime():
    from sokuji_sidecar import accel, catalog
    m = accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                      nvidia=(accel.Gpu(vendor="nvidia", name="x", vram_mb=12000),),
                      apple_silicon=False, dml_adapters=(),
                      installed=frozenset({"ctranslate2", "sherpa", "transformers"}),  # no voxtral_realtime
                      fingerprint="testfp")
    plans = accel.resolve_deployments(catalog.asr_model("voxtral-mini-4b-realtime"), m)
    assert plans == []     # GPU-only + runtime absent → no usable deployment
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -k voxtral -v`
Expected: FAIL — `test_voxtral_realtime_gated_on_voxtral_realtime_module`'s second assert fails (`_installed()` has no `voxtral_realtime` entry, so even with the module present it's not added), and `test_voxtral_resolves_gpu_on_nvidia_with_runtime` returns `[]` (the `installed` set names a backend the resolver never maps).

- [ ] **Step 3: Add the self-gate entry**

In `sidecar/sokuji_sidecar/accel.py`, inside `_installed()`'s `mods` dict (after the `cohere_transformers` entry, ~line 69), add:

```python
            # voxtral_realtime needs the native voxtral_realtime model (transformers >=5.2;
            # present in our 5.13 fork). Same self-gate as qwen3asr/cohere.
            "voxtral_realtime": "transformers.models.voxtral_realtime"}
```

(Move the closing `}` from the previous `cohere_transformers` line onto this new last entry — the dict literal ends here.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -k voxtral -v`
Expected: PASS (3 tests). Also run the full file to confirm no regression: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): self-gate voxtral_realtime on transformers.models.voxtral_realtime"
```

---

### Task 4: Download spec + `ignore` mechanism (skip `consolidated.safetensors`)

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`download_specs` branch ~line 44; `model_size` loop ~line 60-64; `download` file-listing loop ~line 155-159)
- Test: `sidecar/tests/test_native_models.py` (append tests)

**Interfaces:**
- Consumes: nothing new (the model id `"voxtral-mini-4b-realtime"` is a literal).
- Produces: `download_specs("voxtral-mini-4b-realtime")` → `{"repos": ["mistralai/Voxtral-Mini-4B-Realtime-2602"], "urls": [], "ignore": ["consolidated.safetensors"]}`; `download()` and `model_size()` honor the optional `ignore` key (default `[]`). `model_status()` needs no change (it checks for orphan `.incomplete` blobs, not the full expected file list, so a never-fetched `consolidated.safetensors` is simply absent and harmless).

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_native_models.py`:

```python
def test_download_specs_voxtral_skips_consolidated():
    spec = nm.download_specs("voxtral-mini-4b-realtime")
    assert spec["repos"] == ["mistralai/Voxtral-Mini-4B-Realtime-2602"]
    assert spec["urls"] == []
    assert spec["ignore"] == ["consolidated.safetensors"]


def test_existing_specs_have_no_ignore_key():
    # The ignore key is additive: every pre-existing model omits it (consumers use .get).
    assert "ignore" not in nm.download_specs("cohere-transcribe-03-2026")
    assert "ignore" not in nm.download_specs("qwen3-asr-1.7b")


def test_download_honors_ignore_list(monkeypatch):
    """The ignore list keeps consolidated.safetensors out of the fetched file set,
    so transformers' model.safetensors is fetched but the 8.86GB duplicate is not."""
    import huggingface_hub
    fetched = []

    class _Api:
        def list_repo_files(self, repo):
            return ["model.safetensors", "consolidated.safetensors", "config.json", "tekken.json"]

    monkeypatch.setattr(nm, "download_specs", lambda m: {
        "repos": ["r"], "urls": [], "ignore": ["consolidated.safetensors"]})
    monkeypatch.setattr(huggingface_hub, "HfApi", _Api)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda repo, fname: fetched.append(fname))

    async def send(_m):
        pass

    status = asyncio.run(nm.download("voxtral-mini-4b-realtime", send))
    assert status == "ready"
    assert "consolidated.safetensors" not in fetched
    assert "model.safetensors" in fetched and "tekken.json" in fetched


def test_model_size_excludes_ignored_files(monkeypatch):
    import huggingface_hub

    class _Sib:
        def __init__(self, name, size):
            self.rfilename = name
            self.size = size

    class _Info:
        siblings = [_Sib("model.safetensors", 8_000_000_000),
                    _Sib("consolidated.safetensors", 8_000_000_000),
                    _Sib("config.json", 1000)]

    class _Api:
        def repo_info(self, repo, files_metadata=False):
            return _Info()

    monkeypatch.setattr(nm, "download_specs", lambda m: {
        "repos": ["r"], "urls": [], "ignore": ["consolidated.safetensors"]})
    monkeypatch.setattr(huggingface_hub, "HfApi", _Api)
    nm._SIZE_CACHE.clear()
    assert nm.model_size("voxtral-mini-4b-realtime") == 8_000_001_000  # consolidated excluded
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_native_models.py -k "voxtral or ignore or ignored" -v`
Expected: FAIL — `download_specs("voxtral-mini-4b-realtime")` hits the fallthrough returning `{"repos": ["voxtral-mini-4b-realtime"], "urls": []}` (no `ignore`, wrong repo); the download/size tests fail because the loops don't filter.

- [ ] **Step 3: Add the branch + honor `ignore`**

In `sidecar/sokuji_sidecar/native_models.py`:

(a) In `download_specs`, before the final `return {"repos": [model_id], "urls": []}` fallthrough (~line 44), add:

```python
    if model_id == "voxtral-mini-4b-realtime":
        # Repo ships model.safetensors (HF, needed) + consolidated.safetensors (Mistral
        # format, 8.86GB, unused by transformers) — skip the duplicate.
        return {"repos": ["mistralai/Voxtral-Mini-4B-Realtime-2602"], "urls": [],
                "ignore": ["consolidated.safetensors"]}
```

(b) In `model_size`, change the repo loop to skip ignored files:

```python
    api = HfApi()
    ignore = set(specs.get("ignore", []))
    for repo in specs["repos"]:
        try:
            info = api.repo_info(repo, files_metadata=True)
            total += sum((s.size or 0) for s in (info.siblings or []) if s.rfilename not in ignore)
        except Exception:
            pass
```

(c) In `download`, change the file-listing loop to skip ignored files:

```python
    api = HfApi()
    ignore = set(specs.get("ignore", []))
    files = []
    for repo in specs["repos"]:
        try:
            files.extend((repo, f) for f in api.list_repo_files(repo) if f not in ignore)
        except Exception:
            pass
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_native_models.py -v`
Expected: PASS (all native_models tests, including the 4 new ones; the existing `test_download_specs_mapping`, `test_download_specs_cohere`, etc. still pass — `ignore` is additive).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_native_models.py
git commit -m "feat(sidecar): voxtral download_specs + ignore key (skip consolidated.safetensors)"
```

---

### Task 5: `mistral-common[audio]` dependency in `setup.sh`

**Files:**
- Modify: `sidecar/setup.sh` (the stage-runtime pip install line, ~line 40, and its comment)

**Interfaces:**
- Consumes: nothing.
- Produces: a fresh `setup.sh` run installs `mistral-common[audio]>=1.9.0`, so `VoxtralRealtimeProcessor` loads on a clean venv. (No unit test — `setup.sh` is shell; verification is the import check below + Task 7's GPU smoke.)

- [ ] **Step 1: Edit setup.sh**

In `sidecar/setup.sh`, find the stage-runtime install line:

```bash
"$PY" -m pip install -q "$TRANSFORMERS_REF" sherpa-onnx faster-whisper sacremoses librosa
```

Replace it with (adds `mistral-common[audio]` — the Voxtral Realtime processor's tokenizer backend):

```bash
"$PY" -m pip install -q "$TRANSFORMERS_REF" sherpa-onnx faster-whisper sacremoses librosa "mistral-common[audio]>=1.9.0"
```

And extend the comment just above that line (the `# transformers→tokenizers ...` block) with one line:

```bash
# mistral-common[audio]→VoxtralRealtimeProcessor tokenizer (MistralCommonBackend).
```

- [ ] **Step 2: Verify the dependency is importable in the venv**

(The venv already has `mistral-common` from earlier work; this confirms the package name the edit installs is correct.)

Run: `sidecar/.venv/bin/python -c "import mistral_common; from transformers import VoxtralRealtimeProcessor; print('ok', mistral_common.__version__)"`
Expected: `ok 1.x.x` (no ImportError).

- [ ] **Step 3: Verify setup.sh parses (syntax only — do NOT run the full installer)**

Run: `bash -n sidecar/setup.sh && echo "syntax ok"`
Expected: `syntax ok`.

- [ ] **Step 4: Commit**

```bash
git add sidecar/setup.sh
git commit -m "build(sidecar): install mistral-common[audio] for Voxtral Realtime processor"
```

---

### Task 6: Renderer catalog row

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (`NATIVE_ASR` array, after the `qwen3-asr-1.7b` row, ~line 31)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts` (add a test inside the `describe('nativeCatalog', ...)` block)

**Interfaces:**
- Consumes: the `NativeModelOption` type (`{ id, label, languages?, recommended?, sortOrder? }`), `NATIVE_ASR`, `compatibleNativeAsr` (all already exported).
- Produces: a `NATIVE_ASR` entry `{ id: 'voxtral-mini-4b-realtime', sortOrder: 9 }` (no `recommended`), surfaced by `compatibleNativeAsr`/`nativeAsrCards` for its 13 languages.

- [ ] **Step 1: Write the failing test**

In `src/lib/local-inference/native/nativeCatalog.test.ts`, add inside the `describe('nativeCatalog', () => { ... })` block:

```typescript
  it('includes Voxtral Mini 4B Realtime (not recommended, sortOrder 9, 13 langs)', () => {
    const v = NATIVE_ASR.find((m) => m.id === 'voxtral-mini-4b-realtime');
    expect(v).toBeDefined();
    expect(v!.label).toBe('Voxtral Mini 4B Realtime');
    expect(v!.recommended).toBeFalsy();
    expect(v!.sortOrder).toBe(9);
    expect(v!.languages).toEqual(['en', 'fr', 'es', 'de', 'ru', 'zh', 'ja', 'it', 'pt', 'nl', 'ar', 'hi', 'ko']);
    // listed for a supported language (ja), behind the recommended rows
    expect(compatibleNativeAsr('ja').map((m) => m.id)).toContain('voxtral-mini-4b-realtime');
    // dropped for a language it lacks (Thai 'th' — Qwen3 has it, Voxtral does not)
    expect(compatibleNativeAsr('th').map((m) => m.id)).not.toContain('voxtral-mini-4b-realtime');
    // does not displace cohere as the recommended leader for a shared language
    expect(compatibleNativeAsr('zh')[0].id).toBe('cohere-transcribe-03-2026');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/local-inference/native/nativeCatalog.test.ts -t "Voxtral"`
Expected: FAIL — `expect(v).toBeDefined()` fails (`NATIVE_ASR.find(...)` is `undefined`; the row doesn't exist).

- [ ] **Step 3: Add the renderer row**

In `src/lib/local-inference/native/nativeCatalog.ts`, append to the `NATIVE_ASR` array, immediately after the `qwen3-asr-1.7b` line (it becomes the last entry):

```typescript
  { id: 'voxtral-mini-4b-realtime', label: 'Voxtral Mini 4B Realtime', languages: ['en', 'fr', 'es', 'de', 'ru', 'zh', 'ja', 'it', 'pt', 'nl', 'ar', 'hi', 'ko'], sortOrder: 9 },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS (the new test plus all existing `nativeCatalog` tests — the not-recommended/sortOrder-9 row doesn't disturb the recommended-first ordering the other tests assert).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): Voxtral Mini 4B Realtime renderer catalog row (sortOrder 9)"
```

---

### Task 7: GPU smoke test (`SOKUJI_RUN_GPU`)

**Files:**
- Test: `sidecar/tests/test_backends.py` (append the gated real smoke after `test_voxtral_realtime_load_failure_raises`)

**Interfaces:**
- Consumes: `VoxtralRealtimeBackend` via `backends.make_backend("voxtral_realtime")` (Task 1); `mistral-common[audio]` (Task 5); the cached `CohereTransformersBackend` for the coexistence check.
- Produces: a `SOKUJI_RUN_GPU`-gated test that downloads the model (HF-format only), loads it, transcribes a real English clip to a non-empty transcript, prints RTF, and verifies Cohere still loads after Voxtral `unload()` + `empty_cache()`.

- [ ] **Step 1: Write the gated smoke test**

Append to `sidecar/tests/test_backends.py`:

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads mistralai/Voxtral-Mini-4B-Realtime-2602 ~8.9GB; needs CUDA + mistral-common[audio])")
def test_voxtral_realtime_real_gpu_smoke():
    # Real flow: manager downloads first (HF-format only, skipping the consolidated dup),
    # backend loads from cache via the snapshot-dir offline path.
    import wave
    from huggingface_hub import snapshot_download
    snapshot_download("mistralai/Voxtral-Mini-4B-Realtime-2602",
                      ignore_patterns=["consolidated.safetensors", "*.gitattributes"])
    b = backends.make_backend("voxtral_realtime")
    b.load("mistralai/Voxtral-Mini-4B-Realtime-2602", "cuda", "bfloat16")
    assert b.is_loaded
    # real English speech (sense-voice test clip) → a non-empty transcript
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    t0 = time.perf_counter()
    r = b.transcribe(audio, "en")
    rtf = (time.perf_counter() - t0) / (len(audio) / 16000.0)
    assert isinstance(r.text, str) and r.text.strip(), f"empty transcript on real speech: {r.text!r}"
    print(f"voxtral-mini-4b-realtime RTF={rtf:.4f}")
    b.unload()
    # coexistence regression: Cohere still loads after Voxtral unload + empty_cache
    import torch
    torch.cuda.empty_cache()
    c = backends.make_backend("cohere_transformers")
    c.load("AEmotionStudio/cohere-transcribe-03-2026-models", "cuda", "bfloat16")
    assert c.is_loaded
    c.unload()
```

- [ ] **Step 2: Verify it is collected and SKIPS without the env flag**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -k voxtral_realtime_real_gpu_smoke -v`
Expected: `SKIPPED` (1 skipped) with the reason text — the gate works; no GPU download happens in normal runs.

- [ ] **Step 3: (Optional, on a CUDA box) run the real smoke**

Run: `cd sidecar && SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_backends.py -k voxtral_realtime_real_gpu_smoke -v -s`
Expected: PASS, printing `voxtral-mini-4b-realtime RTF=~0.45` and a non-empty English transcript. (The model + Cohere are already cached on the dev 4070 from the brainstorming benchmark.)

- [ ] **Step 4: Commit**

```bash
git add sidecar/tests/test_backends.py
git commit -m "test(sidecar): GPU-gated Voxtral Realtime smoke (RTF + Cohere coexistence)"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: all prior tasks.
- Produces: green sidecar pytest + renderer vitest, confirming no regression across the integration.

- [ ] **Step 1: Run the full sidecar test suite**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: PASS (the GPU/model-gated tests `SKIPPED` without their env flags; everything else green).

- [ ] **Step 2: Run the renderer native-catalog tests**

Run: `npm run test -- src/lib/local-inference/native/`
Expected: PASS (nativeCatalog + NativeModelClient + NativeAsrClient suites green).

- [ ] **Step 3: Build the renderer (wiring sanity, not a correctness gate)**

Run: `npm run build`
Expected: build completes (the new catalog row is plain data; no type errors introduced).

- [ ] **Step 4: Commit (only if Steps 1-3 surfaced fixes)**

If any step required a fix, commit it:

```bash
git add -A
git commit -m "test(native): green sidecar + renderer suites for Voxtral Realtime"
```

If all three passed with no changes, there is nothing to commit — skip.
