# Native Qwen Translation: version ladder + device selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the LOCAL_NATIVE sidecar translation engine ASR-parity AUTO/CPU/GPU device selection and a selectable Qwen version ladder (2.5-0.5B, 3-0.6B, 3.5-0.8B, 3.5-2B), reusing the existing `accel.py` resolver.

**Architecture:** Add a translation catalog mirroring the ASR `AsrModel`/`Deployment` data model; add a `resolve_translate()` sibling to the stage-agnostic resolver; add two transformers backends split by architecture (CausalLM for 2.5/3, the Qwen3.5 VLM class for 3.5, used text-only); wire a `device` parameter through the engine, the WS contract, the renderer client, settings, catalog, and UI.

**Tech Stack:** Python sidecar (`sidecar/sokuji_sidecar/*.py`, pytest), HuggingFace transformers (PyTorch), React/TypeScript renderer (Zustand stores, vitest), WebSocket JSON contract.

## Global Constraints

Copied verbatim from the spec; every task implicitly includes these:

- **Single transformers backend strategy** — GPU and CPU both via transformers (`.to(device)` + dtype). No CTranslate2/GGUF/quantized CPU path in this increment. CPU = float32, GPU = bfloat16.
- **Every translation model carries two deployments**: `gpu-cuda` (bfloat16) + `cpu` (float32). AUTO degrades to CPU; explicit CPU always has a plan.
- **Self-gate Qwen3.5** — the `qwen35_translate` backend is reported available only when `transformers.models.qwen3_5` is importable. If absent, the two Qwen3.5 rows disappear (no broken card, no hard failure).
- **Opus-MT untouched** — the `OpusMtTranslator` branch (onnxruntime, no device) stays as-is. The legacy `""`/`"qwen"` download id → `Qwen/Qwen2.5-0.5B-Instruct` (overridable via `SOKUJI_TRANSLATE_MODEL`) is preserved.
- **Text-only** — Qwen3.5 is a VLM class but fed text only (no image tokens).
- **Exact native id → repo map:** `qwen2.5-0.5b`→`Qwen/Qwen2.5-0.5B-Instruct`, `qwen3-0.6b`→`Qwen/Qwen3-0.6B`, `qwen3.5-0.8b`→`Qwen/Qwen3.5-0.8B`, `qwen3.5-2b`→`Qwen/Qwen3.5-2B`.
- **Device wire values:** `'auto' | 'cpu' | 'cuda'` (default `'auto'`).

---

## File Structure

**Sidecar (Python):**
- `sidecar/sokuji_sidecar/catalog.py` — add `TranslateModel`, `TRANSLATE_MODELS`, `translate_models()`, `translate_model()`.
- `sidecar/sokuji_sidecar/accel.py` — extract `_resolve_model()`, add `resolve_translate()`, extend `_installed()` map, add `kind` to `_h_models_catalog`.
- `sidecar/sokuji_sidecar/translate_backends.py` — **new**: `QwenTranslateBackend`, `Qwen35TranslateBackend`, `_default_prompt`, `_strip_think`.
- `sidecar/sokuji_sidecar/translate_engine.py` — `init(device=...)`, `close()`, resolver wiring, `resolved` echo, handler reads `device`.
- `sidecar/sokuji_sidecar/native_models.py` — `download_specs` rows for the four ids.
- Tests: `sidecar/tests/test_catalog.py`, `test_accel.py`, `test_translate_backends.py` (new), `test_translate_engine.py`, `test_native_models.py`.

**Renderer (TypeScript):**
- `src/stores/settingsStore.ts` — `translationDevice` field + default + session-config line.
- `src/services/interfaces/IClient.ts` — `translationDevice?` on `LocalNativeSessionConfig`.
- `src/lib/local-inference/native/NativeTranslateClient.ts` — `init(..., device?)` sends `device`, returns resolved.
- `src/services/clients/LocalNativeClient.ts` — pass `config.translationDevice`; record resolved.
- `src/stores/nativeModelStore.ts` — `translationResolved` state + setter.
- `src/lib/local-inference/native/nativeCatalog.ts` — four Qwen translation rows.
- `src/components/Settings/sections/NativeModelManagementSection.tsx` — translation device segmented control.
- Tests: colocated `*.test.ts(x)`.

---

## Task 1: Translation catalog

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py`
- Test: `sidecar/tests/test_catalog.py`

**Interfaces:**
- Consumes: existing `Deployment` dataclass.
- Produces: `TranslateModel(id, name, languages, deployments, recommended=False, sort_order=99)`; `translate_models() -> list[TranslateModel]`; `translate_model(model_id) -> TranslateModel | None`. Backend NAMEs used in rows: `"qwen_translate"`, `"qwen35_translate"`.

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_catalog.py`:

```python
def test_translate_models_have_deployments_and_cpu_floor():
    for m in catalog.translate_models():
        assert m.deployments, f"{m.id} has no deployments"
        assert m.languages, f"{m.id} has no languages"
        assert any(d.tier == "cpu" for d in m.deployments), f"{m.id} lacks a cpu floor"
        for d in m.deployments:
            assert d.backend in {"qwen_translate", "qwen35_translate"}


def test_translate_model_ids_unique_and_lookup():
    ids = [m.id for m in catalog.translate_models()]
    assert len(ids) == len(set(ids))
    assert catalog.translate_model("does-not-exist") is None


def test_translate_rows_map_to_qwen_repos():
    expected = {
        "qwen2.5-0.5b": ("qwen_translate", "Qwen/Qwen2.5-0.5B-Instruct"),
        "qwen3-0.6b": ("qwen_translate", "Qwen/Qwen3-0.6B"),
        "qwen3.5-0.8b": ("qwen35_translate", "Qwen/Qwen3.5-0.8B"),
        "qwen3.5-2b": ("qwen35_translate", "Qwen/Qwen3.5-2B"),
    }
    for mid, (backend, repo) in expected.items():
        m = catalog.translate_model(mid)
        assert m is not None, f"missing {mid}"
        tiers = [(d.backend, d.tier, d.compute_type, d.artifact) for d in m.deployments]
        assert (backend, "gpu-cuda", "bfloat16", repo) in tiers
        assert (backend, "cpu", "float32", repo) in tiers
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && python -m pytest tests/test_catalog.py::test_translate_rows_map_to_qwen_repos -v`
Expected: FAIL with `AttributeError: module 'sokuji_sidecar.catalog' has no attribute 'translate_models'`.

- [ ] **Step 3: Write minimal implementation**

In `sidecar/sokuji_sidecar/catalog.py`, after the `AsrModel` definition and `asr_model()` (end of file region), add:

```python
@dataclass(frozen=True)
class TranslateModel:
    id: str
    name: str
    languages: tuple[str, ...]   # ("multi",) means any language
    deployments: tuple[Deployment, ...]
    recommended: bool = False
    sort_order: int = 99


def _qwen_translate_row(mid, name, repo, backend, sort_order, recommended=False):
    return TranslateModel(mid, name, ("multi",), (
        Deployment(backend, "gpu-cuda", "bfloat16", repo, 1.0),
        Deployment(backend, "cpu", "float32", repo, 1.0),
    ), recommended=recommended, sort_order=sort_order)


TRANSLATE_MODELS: list[TranslateModel] = [
    _qwen_translate_row("qwen2.5-0.5b", "Qwen 2.5 0.5B",
                        "Qwen/Qwen2.5-0.5B-Instruct", "qwen_translate", 1, recommended=True),
    _qwen_translate_row("qwen3-0.6b", "Qwen 3 0.6B",
                        "Qwen/Qwen3-0.6B", "qwen_translate", 2, recommended=True),
    _qwen_translate_row("qwen3.5-0.8b", "Qwen 3.5 0.8B",
                        "Qwen/Qwen3.5-0.8B", "qwen35_translate", 3),
    _qwen_translate_row("qwen3.5-2b", "Qwen 3.5 2B",
                        "Qwen/Qwen3.5-2B", "qwen35_translate", 4),
]


def translate_models() -> list[TranslateModel]:
    return TRANSLATE_MODELS


def translate_model(model_id: str) -> TranslateModel | None:
    return next((m for m in TRANSLATE_MODELS if m.id == model_id), None)
```

Also extend the `Deployment.backend` comment to mention the two new names (optional, keeps the doc accurate).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && python -m pytest tests/test_catalog.py -v`
Expected: PASS (all, including the three new tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(sidecar): translation catalog with Qwen 2.5/3/3.5 version ladder"
```

---

## Task 2: Resolver generalization + `resolve_translate` + gating

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`resolve()` body → `_resolve_model()`, add `resolve_translate()`, extend `_installed()` map)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `catalog.translate_model()` (Task 1); existing `resolve_deployments`, `load_with_fallback`, `probe`, `Machine`, `bench_load`, `_bench_key`, `TIER_DEVICE`, `NoUsablePlan`.
- Produces: `resolve_translate(model_id, override="auto", machine=None) -> list[Plan]` (raises `ValueError` on unknown id, `NoUsablePlan` if no plan). `_installed()` now includes `"qwen_translate"` and `"qwen35_translate"`.

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_accel.py`:

```python
def test_resolve_translate_prefers_gpu():
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),),
                 installed=frozenset({"qwen_translate"}))
    plans = accel.resolve_translate("qwen2.5-0.5b", "auto", m)
    assert [p.device for p in plans] == ["cuda", "cpu"]
    assert plans[0].artifact == "Qwen/Qwen2.5-0.5B-Instruct"


def test_resolve_translate_cpu_only_machine():
    m = _machine(installed=frozenset({"qwen_translate"}))
    plans = accel.resolve_translate("qwen3-0.6b", "auto", m)
    assert [p.device for p in plans] == ["cpu"]


def test_resolve_translate_override_cpu_pins_front():
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),),
                 installed=frozenset({"qwen_translate"}))
    plans = accel.resolve_translate("qwen3-0.6b", "cpu", m)
    assert [p.device for p in plans] == ["cpu", "cuda"]


def test_resolve_translate_qwen35_self_gates_off():
    # transformers lacks qwen3_5 → qwen35_translate not installed → no plan.
    m = _machine(nvidia=(accel.Gpu("nvidia", "x", 0),),
                 installed=frozenset({"qwen_translate"}))
    with pytest.raises(accel.NoUsablePlan):
        accel.resolve_translate("qwen3.5-0.8b", "auto", m)


def test_resolve_translate_unknown_id_raises():
    with pytest.raises(ValueError):
        accel.resolve_translate("nope", "auto", _machine())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && python -m pytest tests/test_accel.py::test_resolve_translate_prefers_gpu -v`
Expected: FAIL with `AttributeError: module 'sokuji_sidecar.accel' has no attribute 'resolve_translate'`.

- [ ] **Step 3: Write minimal implementation**

In `sidecar/sokuji_sidecar/accel.py`, replace the body of `resolve()` (currently lines ~165-182) with a shared helper + two entry points:

```python
def _resolve_model(model, model_id: str, override: str, machine: Machine) -> list[Plan]:
    cache = bench_load()
    bench = {}
    for d in model.deployments:
        device = TIER_DEVICE[d.tier]
        key = _bench_key(machine.fingerprint, model_id, d.backend, device, d.compute_type)
        if key in cache:
            bench[(d.backend, device, d.compute_type)] = cache[key]
    plans = resolve_deployments(model, machine, override, bench=bench or None)
    if not plans:
        raise NoUsablePlan(model_id)
    return plans


def resolve(model_id: str, override: str = "auto", machine: Machine | None = None) -> list[Plan]:
    from . import catalog
    model = catalog.asr_model(model_id)
    if model is None:
        raise ValueError(f"unknown asr model: {model_id}")
    return _resolve_model(model, model_id, override, machine or probe())


def resolve_translate(model_id: str, override: str = "auto", machine: Machine | None = None) -> list[Plan]:
    from . import catalog
    model = catalog.translate_model(model_id)
    if model is None:
        raise ValueError(f"unknown translate model: {model_id}")
    return _resolve_model(model, model_id, override, machine or probe())
```

In `_installed()`'s `mods` dict (currently ~lines 61-73), add two entries:

```python
        # translation: 2.5/3 are CausalLM (always present with transformers); 3.5 is the
        # qwen3_5 VLM class (self-gates off until transformers ships it), used text-only.
        "qwen_translate": "transformers",
        "qwen35_translate": "transformers.models.qwen3_5",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && python -m pytest tests/test_accel.py -v`
Expected: PASS (all existing + 5 new). The existing ASR `resolve` tests still pass (behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): resolve_translate + qwen translate backend gating"
```

---

## Task 3: Translation backends

**Files:**
- Create: `sidecar/sokuji_sidecar/translate_backends.py`
- Test: `sidecar/tests/test_translate_backends.py`

**Interfaces:**
- Consumes: `backends.register_backend`, `backends.BackendLoadError`.
- Produces: `QwenTranslateBackend` (NAME `"qwen_translate"`) and `Qwen35TranslateBackend` (NAME `"qwen35_translate"`), both with `load(model_ref, device, compute_type)`, `translate(text, system_prompt, src, tgt, wrap) -> str`, `unload()`, `is_loaded`. Module-level `_default_prompt(src, tgt) -> str` and `_strip_think(text) -> str`. Registered into the shared `backends._BACKENDS` on import.

- [ ] **Step 1: Write the failing test**

Create `sidecar/tests/test_translate_backends.py`:

```python
from unittest.mock import MagicMock
import pytest
from sokuji_sidecar import translate_backends as tb
from sokuji_sidecar import backends


class FakeInputs(dict):
    def to(self, device):
        return self


def _fake_tok(captured):
    tok = MagicMock()

    def apply_chat_template(messages, **kw):
        captured.clear()
        captured.extend(messages)
        return "PROMPT"
    tok.apply_chat_template.side_effect = apply_chat_template
    tok.side_effect = lambda prompt, **kw: FakeInputs(input_ids=MagicMock(shape=[1, 5]))
    tok.decode.return_value = "translated"
    return tok


def _fake_model():
    model = MagicMock()
    gen_out = MagicMock()
    gen_out.__getitem__ = MagicMock(return_value=MagicMock())  # out[0]
    model.generate.return_value = [gen_out]
    return model


def test_backends_are_registered():
    assert backends._BACKENDS.get("qwen_translate") is tb.QwenTranslateBackend
    assert backends._BACKENDS.get("qwen35_translate") is tb.Qwen35TranslateBackend


def test_default_prompt_mentions_langs():
    p = tb._default_prompt("Japanese", "English")
    assert "Japanese" in p and "English" in p and "only" in p.lower()


def test_strip_think_removes_block():
    assert tb._strip_think("<think>reasoning</think>  hello") == "hello"
    assert tb._strip_think("plain") == "plain"


def test_qwen3_appends_no_think_and_wraps():
    captured = []
    b = tb.QwenTranslateBackend()
    b._tok = _fake_tok(captured)
    b._model = _fake_model()
    b._device = "cpu"
    b._ref = "Qwen/Qwen3-0.6B"
    b.translate("hi", "", "Japanese", "English", wrap=True)
    sys_msg = next(m for m in captured if m["role"] == "system")
    user_msg = next(m for m in captured if m["role"] == "user")
    assert sys_msg["content"].endswith("/no_think")
    assert user_msg["content"] == "<transcript>hi</transcript>"


def test_qwen25_no_no_think_and_bare():
    captured = []
    b = tb.QwenTranslateBackend()
    b._tok = _fake_tok(captured)
    b._model = _fake_model()
    b._device = "cpu"
    b._ref = "Qwen/Qwen2.5-0.5B-Instruct"
    b.translate("hi", "", "Japanese", "English", wrap=False)
    sys_msg = next(m for m in captured if m["role"] == "system")
    user_msg = next(m for m in captured if m["role"] == "user")
    assert "/no_think" not in sys_msg["content"]
    assert user_msg["content"] == "hi"


def test_qwen35_load_raises_when_class_missing(monkeypatch):
    # Simulate a transformers without Qwen3_5ForConditionalGeneration.
    import sys
    fake_transformers = MagicMock()
    del fake_transformers.Qwen3_5ForConditionalGeneration  # attribute access raises AttributeError
    monkeypatch.setitem(sys.modules, "transformers", fake_transformers)
    b = tb.Qwen35TranslateBackend()
    with pytest.raises(backends.BackendLoadError):
        b.load("Qwen/Qwen3.5-0.8B", "cuda", "bfloat16")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && python -m pytest tests/test_translate_backends.py::test_backends_are_registered -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'sokuji_sidecar.translate_backends'`.

- [ ] **Step 3: Write minimal implementation**

Create `sidecar/sokuji_sidecar/translate_backends.py`:

```python
"""Translation backend adapters (transformers, text-only). Mirror the ASR
backends' load()/unload() contract but expose translate() instead of
transcribe(). Registered into the shared backends registry on import.

  qwen_translate    — Qwen 2.5 / 3, AutoModelForCausalLM (/no_think for Qwen3).
  qwen35_translate  — Qwen 3.5, Qwen3_5ForConditionalGeneration (VLM class), text-only.

Both support CPU (float32) and GPU (bfloat16) via .to(device)."""
from .backends import register_backend, BackendLoadError


def _default_prompt(src: str, tgt: str) -> str:
    s = src or "the source language"
    t = tgt or "the target language"
    return (f"You are a translator. Translate the text from {s} to {t}. "
            "Output only the translation, no explanations, no refusal.")


def _strip_think(text: str) -> str:
    """Defensive: drop any <think>…</think> reasoning block a model emits."""
    if "</think>" in text:
        return text.split("</think>", 1)[1].strip()
    return text.strip()


@register_backend
class QwenTranslateBackend:
    NAME = "qwen_translate"

    def __init__(self):
        self._model = None
        self._tok = None
        self._device = "cpu"
        self._ref = ""

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer
            dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
            self._tok = AutoTokenizer.from_pretrained(model_ref, local_files_only=True)
            self._model = AutoModelForCausalLM.from_pretrained(
                model_ref, torch_dtype=dtype, local_files_only=True).to(device).eval()
            self._device = device
            self._ref = model_ref
        except Exception as e:  # missing torch/transformers, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str, wrap: bool) -> str:
        import torch
        sys_p = system_prompt or _default_prompt(src, tgt)
        if "qwen3" in self._ref.lower():        # Qwen3 thinking-mode off; Qwen2.5 ignores it
            sys_p = f"{sys_p} /no_think"
        user = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "system", "content": sys_p},
                    {"role": "user", "content": user}]
        prompt = self._tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self._tok(prompt, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=512, do_sample=False)
        gen = out[0][inputs["input_ids"].shape[1]:]
        return _strip_think(self._tok.decode(gen, skip_special_tokens=True))

    def unload(self) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None


@register_backend
class Qwen35TranslateBackend:
    NAME = "qwen35_translate"

    def __init__(self):
        self._model = None
        self._proc = None
        self._device = "cpu"

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._proc = None
        try:
            import torch
            from transformers import Qwen3_5ForConditionalGeneration, AutoProcessor
            dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
            self._proc = AutoProcessor.from_pretrained(model_ref, local_files_only=True)
            self._model = Qwen3_5ForConditionalGeneration.from_pretrained(
                model_ref, dtype=dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:  # missing qwen3_5 class, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str, wrap: bool) -> str:
        import torch
        sys_p = system_prompt or _default_prompt(src, tgt)   # Qwen3.5 is non-thinking by default
        user = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "system", "content": [{"type": "text", "text": sys_p}]},
                    {"role": "user", "content": [{"type": "text", "text": user}]}]
        prompt = self._proc.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self._proc(text=prompt, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=512, do_sample=False)
        gen = out[0][inputs["input_ids"].shape[1]:]
        return _strip_think(self._proc.batch_decode([gen], skip_special_tokens=True)[0])

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && python -m pytest tests/test_translate_backends.py -v`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/translate_backends.py sidecar/tests/test_translate_backends.py
git commit -m "feat(sidecar): qwen_translate + qwen35_translate transformers backends"
```

---

## Task 4: Engine wiring (device, close, resolved, handler)

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_engine.py`
- Test: `sidecar/tests/test_translate_engine.py`

**Interfaces:**
- Consumes: `accel.resolve_translate`, `accel.load_with_fallback` (Task 2); `translate_backends` (Task 3, imported for registration); backend `.translate(text, system_prompt, src, tgt, wrap)` + `.unload()`.
- Produces: `TranslateEngine.init(model_id=None, source_lang="", target_lang="", device="auto") -> int`; `TranslateEngine.close()`; `self.resolved` dict; `translate_init` reply merges `resolved`. `translate()` now delegates to the loaded backend (or Opus).

- [ ] **Step 1: Write the failing test**

The existing `FakeTranslate.init` in `test_translate_engine.py` has signature `(model_id=None, source_lang="", target_lang="")`. Update it to accept `device` and add tests for the new behavior. Replace the `FakeTranslate` class and add tests:

```python
class FakeTranslate:
    def init(self, model_id=None, source_lang="", target_lang="", device="auto"):
        self.langs = (source_lang, target_lang)
        self.device = device
        self.resolved = {"backend": "qwen_translate", "device": "cuda", "computeType": "bfloat16"}
        return 21

    def translate(self, text, system_prompt="", wrap_transcript=False):
        return f"<{text}>", 8


def test_translate_init_echoes_device_and_resolved():
    st = make_state()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "translate_init", "id": 1, "sourceLang": "ja",
                        "targetLang": "en", "device": "cuda"})))
    assert reply["type"] == "ready" and reply["id"] == 1 and reply["loadTimeMs"] == 21
    assert reply["backend"] == "qwen_translate"
    assert reply["device"] == "cuda"
    assert reply["computeType"] == "bfloat16"
    assert st["translate_engine"].device == "cuda"
```

Add a real-engine test (mocking the resolver + backend) for `close()`/resolver wiring:

```python
def test_init_uses_resolver_and_sets_resolved(monkeypatch):
    from sokuji_sidecar import accel
    fake_backend = MagicMock()
    fake_plan = MagicMock(backend="qwen_translate", device="cuda", compute_type="bfloat16")
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None: ["plan"])
    monkeypatch.setattr(accel, "load_with_fallback", lambda plans: (fake_backend, fake_plan, None))

    eng = translate_engine.TranslateEngine()
    eng.init(model_id="qwen2.5-0.5b", source_lang="ja", target_lang="en", device="cuda")
    assert eng.resolved == {"backend": "qwen_translate", "device": "cuda", "computeType": "bfloat16"}
    assert eng._backend is fake_backend

    fake_backend.translate.return_value = "hola->hi"
    out, ms = eng.translate("hola", wrap_transcript=True)
    fake_backend.translate.assert_called_once_with("hola", "", "ja", "en", True)
    assert out == "hola->hi" and ms >= 0


def test_close_unloads_prior_backend_before_reinit(monkeypatch):
    from sokuji_sidecar import accel
    first, second = MagicMock(), MagicMock()
    plan = MagicMock(backend="qwen_translate", device="cpu", compute_type="float32")
    backends_iter = iter([(first, plan, None), (second, plan, None)])
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None: ["plan"])
    monkeypatch.setattr(accel, "load_with_fallback", lambda plans: next(backends_iter))

    eng = translate_engine.TranslateEngine()
    eng.init(model_id="qwen2.5-0.5b", source_lang="ja", target_lang="en")
    eng.init(model_id="qwen3-0.6b", source_lang="ja", target_lang="en")
    first.unload.assert_called_once()   # prior backend freed before loading the next
    assert eng._backend is second
```

Note: the existing `test_wrap_transcript_wraps_user_content` exercised the old inline Qwen path in `translate()`. That path moves into the backend (Task 3 covers it). Update that test to set `eng._backend` to a fake and assert delegation, OR delete it (the backend test now covers wrap). Replace its body with:

```python
def test_translate_delegates_to_backend_when_loaded():
    eng = translate_engine.TranslateEngine()
    eng._opus = None
    eng._backend = MagicMock()
    eng._backend.translate.return_value = "translated"
    eng._src, eng._tgt = "Japanese", "English"
    out, _ = eng.translate("hello", wrap_transcript=True)
    eng._backend.translate.assert_called_once_with("hello", "", "Japanese", "English", True)
    assert out == "translated"
```

(Keep `test_wrap_transcript_not_applied_to_opus`, `test_opus_to_qwen_switch_clears_opus`, the skipif real-model tests — but `test_opus_to_qwen_switch_clears_opus` must monkeypatch the resolver since the Qwen branch no longer loads transformers directly. Update its Step-2 section: after switching to Qwen, patch `accel.resolve_translate`/`accel.load_with_fallback` so it doesn't hit real models, and assert `eng._opus is None`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && python -m pytest tests/test_translate_engine.py::test_init_uses_resolver_and_sets_resolved -v`
Expected: FAIL (current `init()` has no `device` param / no `resolved` / no `_backend`).

- [ ] **Step 3: Write minimal implementation**

Rewrite `sidecar/sokuji_sidecar/translate_engine.py`'s `TranslateEngine` and `_h_translate_init`:

```python
import time
from . import translate_backends  # noqa: F401 — registers qwen_translate/qwen35_translate


class TranslateEngine:
    def __init__(self):
        self._tok = None
        self._model = None
        self._opus = None
        self._backend = None
        self._src = ""
        self._tgt = ""
        self.resolved = None

    def init(self, model_id=None, source_lang="", target_lang="", device="auto"):
        t0 = time.time()
        self.close()                       # VRAM hygiene: free any prior model first
        self._src, self._tgt = source_lang, target_lang
        if model_id and "opus-mt" in model_id:
            from .opus_mt import OpusMtTranslator
            onnx_repo = model_id if "/" in model_id else f"Xenova/{model_id}"
            self._opus = OpusMtTranslator(onnx_repo)
            self.resolved = {"backend": "opus_mt", "device": "cpu", "computeType": "int8"}
            return int((time.time() - t0) * 1000)
        self._opus = None
        from . import accel
        plans = accel.resolve_translate(model_id or "qwen2.5-0.5b", override=device or "auto")
        self._backend, plan, _notice = accel.load_with_fallback(plans)
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        return int((time.time() - t0) * 1000)

    def translate(self, text, system_prompt="", wrap_transcript=False):
        t0 = time.time()
        if not text.strip():
            return "", 0
        if self._opus is not None:
            return self._opus.translate(text), int((time.time() - t0) * 1000)
        out = self._backend.translate(text, system_prompt, self._src, self._tgt, wrap_transcript)
        return out, int((time.time() - t0) * 1000)

    def close(self):
        if self._backend is not None:
            try:
                self._backend.unload()
            except Exception:
                pass
            self._backend = None
        self._opus = None
        self._tok = None
        self._model = None


async def _h_translate_init(state, msg, _b, conn=None):
    ms = state["translate_engine"].init(
        msg.get("model"), msg.get("sourceLang", ""), msg.get("targetLang", ""),
        msg.get("device", "auto"))
    reply = {"type": "ready", "id": msg.get("id"), "loadTimeMs": ms}
    resolved = getattr(state["translate_engine"], "resolved", None)
    if resolved:
        reply.update(resolved)
    return reply, None
```

Keep `_h_translate` and `register()` unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && python -m pytest tests/test_translate_engine.py -v`
Expected: PASS (updated + new tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/translate_engine.py sidecar/tests/test_translate_engine.py
git commit -m "feat(sidecar): translate engine device selection + VRAM-safe re-init"
```

---

## Task 5: Download mapping + catalog feed `kind`

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`download_specs`)
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_h_models_catalog`)
- Test: `sidecar/tests/test_native_models.py`, `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `catalog.translate_models()` (Task 1).
- Produces: `download_specs(mid)` rows for the four ids; `models_catalog` message accepts `kind: "asr" | "translate"` (default `"asr"`).

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_native_models.py`:

```python
def test_download_specs_qwen_translate_repos():
    from sokuji_sidecar import native_models as nm
    assert nm.download_specs("qwen2.5-0.5b")["repos"] == ["Qwen/Qwen2.5-0.5B-Instruct"]
    assert nm.download_specs("qwen3-0.6b")["repos"] == ["Qwen/Qwen3-0.6B"]
    assert nm.download_specs("qwen3.5-0.8b")["repos"] == ["Qwen/Qwen3.5-0.8B"]
    assert nm.download_specs("qwen3.5-2b")["repos"] == ["Qwen/Qwen3.5-2B"]
```

Append to `sidecar/tests/test_accel.py`:

```python
def test_models_catalog_kind_translate_returns_qwen_rows(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(
        nvidia=(accel.Gpu("nvidia", "x", 0),), installed=frozenset({"qwen_translate"})))
    reply, _ = asyncio.run(accel._h_models_catalog(
        {}, {"type": "models_catalog", "id": 1, "kind": "translate"}, None))
    ids = [m["id"] for m in reply["models"]]
    assert "qwen2.5-0.5b" in ids and "qwen3-0.6b" in ids
    row = next(m for m in reply["models"] if m["id"] == "qwen2.5-0.5b")
    tiers = {t["tier"]: t["available"] for t in row["tiers"]}
    assert tiers["gpu-cuda"] is True and tiers["cpu"] is True


def test_models_catalog_kind_defaults_to_asr(monkeypatch):
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine())
    reply, _ = asyncio.run(accel._h_models_catalog(
        {}, {"type": "models_catalog", "id": 2}, None))
    ids = [m["id"] for m in reply["models"]]
    assert "sense-voice" in ids       # ASR catalog, unchanged default
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && python -m pytest tests/test_native_models.py::test_download_specs_qwen_translate_repos tests/test_accel.py::test_models_catalog_kind_translate_returns_qwen_rows -v`
Expected: FAIL (download rows missing; `_h_models_catalog` ignores `kind`).

- [ ] **Step 3: Write minimal implementation**

In `sidecar/sokuji_sidecar/native_models.py`, inside `download_specs(model_id)`, before the final fallthrough/return, add:

```python
    if model_id == "qwen2.5-0.5b":
        return {"repos": ["Qwen/Qwen2.5-0.5B-Instruct"], "urls": []}
    if model_id == "qwen3-0.6b":
        return {"repos": ["Qwen/Qwen3-0.6B"], "urls": []}
    if model_id == "qwen3.5-0.8b":
        return {"repos": ["Qwen/Qwen3.5-0.8B"], "urls": []}
    if model_id == "qwen3.5-2b":
        return {"repos": ["Qwen/Qwen3.5-2B"], "urls": []}
```

(The existing `""`/`"qwen"` → `Qwen/Qwen2.5-0.5B-Instruct` line stays first; the new ids are distinct.)

In `sidecar/sokuji_sidecar/accel.py`, change `_h_models_catalog` to honor `kind`:

```python
async def _h_models_catalog(state, msg, _b, conn=None):
    from . import catalog
    m = probe()
    kind = msg.get("kind", "asr")
    source = catalog.translate_models() if kind == "translate" else catalog.asr_models()
    wanted = msg.get("models")
    if wanted and not isinstance(wanted, list):
        wanted = [wanted]
    models = source
    if wanted:
        models = [x for x in models if x.id in wanted]
    out = []
    for mdl in models:
        tiers = [{"tier": d.tier, "backend": d.backend,
                  "available": d.backend in m.installed and _tier_available(d.tier, m)}
                 for d in mdl.deployments]
        out.append({"id": mdl.id, "name": mdl.name, "languages": list(mdl.languages),
                    "recommended": mdl.recommended, "tiers": tiers})
    return {"type": "models_catalog_result", "id": msg.get("id"), "models": out}, None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && python -m pytest tests/test_native_models.py tests/test_accel.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full sidecar suite**

Run: `cd sidecar && python -m pytest -q`
Expected: PASS (no regressions across catalog/accel/backends/engine/native_models).

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/sokuji_sidecar/accel.py sidecar/tests/test_native_models.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): qwen translate download specs + models_catalog kind"
```

---

## Task 6: Renderer settings — `translationDevice`

**Files:**
- Modify: `src/stores/settingsStore.ts` (interface field, default, session-config line)
- Modify: `src/services/interfaces/IClient.ts` (`translationDevice?`)
- Test: `src/stores/settingsStore.test.ts` (or the existing settings test file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `settings.translationDevice: 'auto' | 'cpu' | 'cuda'` (default `'auto'`); `LocalNativeSessionConfig.translationDevice?: string`; session config includes `translationDevice`.

- [ ] **Step 1: Write the failing test**

Add to the settings store test (mirror however `asrDevice` is tested; if no such test exists, create `src/stores/settingsStore.translationDevice.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { useSettingsStore } from './settingsStore';

describe('translationDevice setting', () => {
  it('defaults to auto', () => {
    expect(useSettingsStore.getState().translationDevice).toBe('auto');
  });
  it('is updatable', () => {
    useSettingsStore.getState().update({ translationDevice: 'cuda' });
    expect(useSettingsStore.getState().translationDevice).toBe('cuda');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/settingsStore.translationDevice.test.ts`
Expected: FAIL (`translationDevice` is `undefined`).

- [ ] **Step 3: Write minimal implementation**

In `src/stores/settingsStore.ts`:
- After the `asrDevice` field (line ~198) add:
  ```ts
  translationDevice: 'auto' | 'cpu' | 'cuda'; // override the sidecar's translation device selection
  ```
- After the `asrDevice: 'auto',` default (line ~393) add:
  ```ts
  translationDevice: 'auto',
  ```
- In the session-config builder, after `asrDevice: settings.asrDevice,` (line ~738) add:
  ```ts
  translationDevice: settings.translationDevice,
  ```

In `src/services/interfaces/IClient.ts`, after `asrDevice?: string;` (line ~208) add:
```ts
  translationDevice?: string;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/settingsStore.translationDevice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/services/interfaces/IClient.ts src/stores/settingsStore.translationDevice.test.ts
git commit -m "feat(native): translationDevice setting + session config"
```

---

## Task 7: NativeTranslateClient device arg + LocalNativeClient wiring + resolved store

**Files:**
- Modify: `src/lib/local-inference/native/NativeTranslateClient.ts`
- Modify: `src/services/clients/LocalNativeClient.ts`
- Modify: `src/stores/nativeModelStore.ts` (add `translationResolved` + setter)
- Test: `src/lib/local-inference/native/NativeTranslateClient.test.ts`

**Interfaces:**
- Consumes: `LocalNativeSessionConfig.translationDevice` (Task 6); sidecar `ready` reply with `backend/device/computeType` (already in `ReadyMsg`).
- Produces: `NativeTranslateClient.init(sourceLang, targetLang, modelId?, device?) -> { loadTimeMs, backend?, device?, computeType? }`; `nativeModelStore.translationResolved` state + `setTranslationResolved`.

- [ ] **Step 1: Write the failing test**

Update `FakeWS.send` in `NativeTranslateClient.test.ts` to echo device, and add a test:

```ts
// In FakeWS.send, the translate_init branch:
if (msg.type === 'translate_init') queueMicrotask(() =>
  this.onmessage?.({ data: JSON.stringify({
    type: 'ready', id: msg.id, loadTimeMs: 3,
    backend: 'qwen_translate', device: msg.device ?? 'auto', computeType: 'bfloat16' }) }));
```

```ts
it('sends device and returns resolved fields', async () => {
  const c = new NativeTranslateClient();
  const r = await c.init('es', 'en', 'qwen3-0.6b', 'cuda');
  expect(r.loadTimeMs).toBe(3);
  expect(r.device).toBe('cuda');
  expect(r.backend).toBe('qwen_translate');
  expect(r.computeType).toBe('bfloat16');
});
```

(Keep the existing `inits with langs and translates` test; its `init('es','en')` call still works since `modelId`/`device` are optional and `r.loadTimeMs` is still `3`. Update its assertion from `toEqual({ loadTimeMs: 3 })` to `expect(r.loadTimeMs).toBe(3)` since the return now carries optional resolved fields.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeTranslateClient.test.ts`
Expected: FAIL (`init` ignores device / returns only `loadTimeMs`).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/local-inference/native/NativeTranslateClient.ts`, replace `init`:

```ts
  async init(sourceLang: string, targetLang: string, modelId?: string, device?: string):
      Promise<{ loadTimeMs: number; backend?: string; device?: string; computeType?: string }> {
    await this.connect();
    this.onStatus?.('[native-translate] init…');
    const msg = await this.send({ type: 'translate_init', sourceLang, targetLang, model: modelId, device });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    return { loadTimeMs: r.loadTimeMs, backend: r.backend, device: r.device, computeType: r.computeType };
  }
```

In `src/stores/nativeModelStore.ts`, mirror `asrResolved`:
- In the state interface (near line 44): `translationResolved: { model: string; device: string } | null;`
- In the actions interface (near line 46): `setTranslationResolved: (r: { model: string; device: string } | null) => void;`
- In the initial state (near line 70): `translationResolved: null,`
- In the implementation (near line 172): `setTranslationResolved: (r) => set({ translationResolved: r }),`
- Optional selector (near line 181): `export const useNativeTranslationResolved = () => useNativeModelStore((s) => s.translationResolved);`

In `src/services/clients/LocalNativeClient.ts`, the current flow is:

```ts
    await this.translate.init(config.sourceLanguage, config.targetLanguage, config.translationModelId);  // line ~55
    const store = useNativeModelStore.getState();                                                        // line ~56
    store.setAsrLoading(true);
```

Replace those two lines so the device is passed and the resolved device is recorded *after* `store` is obtained (avoid referencing `store` before its declaration):

```ts
    const tr = await this.translate.init(
      config.sourceLanguage, config.targetLanguage, config.translationModelId, config.translationDevice);
    const store = useNativeModelStore.getState();
    store.setTranslationResolved({ model: config.translationModelId ?? '', device: tr.device ?? 'cpu' });
    store.setAsrLoading(true);
```

(`useNativeModelStore` is already imported and used for `setAsrResolved` just below.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/NativeTranslateClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/NativeTranslateClient.ts src/services/clients/LocalNativeClient.ts src/stores/nativeModelStore.ts src/lib/local-inference/native/NativeTranslateClient.test.ts
git commit -m "feat(native): translate client sends device, records resolved"
```

---

## Task 8: Native catalog translation rows

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (`NATIVE_TRANSLATION`)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Consumes: existing `NativeModelOption` type + `resolveNativeTranslation` behavior.
- Produces: `NATIVE_TRANSLATION` includes `qwen2.5-0.5b`, `qwen3-0.6b`, `qwen3.5-0.8b`, `qwen3.5-2b` rows (plus the existing `''` default + `opus-mt`).

- [ ] **Step 1: Write the failing test**

Add to `nativeCatalog.test.ts`:

```ts
import { NATIVE_TRANSLATION } from './nativeCatalog';

it('exposes the four Qwen translation versions', () => {
  const ids = NATIVE_TRANSLATION.map((o) => o.id);
  expect(ids).toEqual(expect.arrayContaining([
    'qwen2.5-0.5b', 'qwen3-0.6b', 'qwen3.5-0.8b', 'qwen3.5-2b',
  ]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL (rows absent).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/local-inference/native/nativeCatalog.ts`, replace `NATIVE_TRANSLATION` (lines ~36-39):

```ts
export const NATIVE_TRANSLATION: NativeModelOption[] = [
  { id: 'qwen2.5-0.5b', label: 'Qwen 2.5 0.5B', languages: ['multi'], recommended: true, sortOrder: 1 },
  { id: 'qwen3-0.6b', label: 'Qwen 3 0.6B', languages: ['multi'], recommended: true, sortOrder: 2 },
  { id: 'qwen3.5-0.8b', label: 'Qwen 3.5 0.8B', languages: ['multi'], sortOrder: 3 },
  { id: 'qwen3.5-2b', label: 'Qwen 3.5 2B', languages: ['multi'], sortOrder: 4 },
  { id: 'opus-mt', label: 'Opus-MT (fast)', sortOrder: 5 },
];
```

Note: the legacy `''` default row is removed in favor of explicit `qwen2.5-0.5b`. Verify `resolveNativeTranslation` (in the same file) still maps an empty/unknown selection to a valid download id — if it special-cased `''`→`'qwen'`, keep that branch so persisted empty selections resolve to `qwen2.5-0.5b`'s download. If a test asserts the `''` row exists, update it to assert `qwen2.5-0.5b` is the recommended default instead.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS (new + existing, after any `''`-row assertion update).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): Qwen 2.5/3/3.5 translation rows in native catalog"
```

---

## Task 9: Translation device UI control

**Files:**
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx`
- Test: manual (UI) — covered by typecheck + the store/catalog tests above. Optionally extend a component test if one exists.

**Interfaces:**
- Consumes: `settings.translationDevice` + `update` (Task 6); `gpuTierAvailable(catalog)` (already imported for ASR).
- Produces: a translation `ModelGroup` device segmented control mirroring the ASR one.

- [ ] **Step 1: Locate the translation ModelGroup**

Find the translation group in `NativeModelManagementSection.tsx` (the `ModelGroup` for translation, analogous to the ASR group at line ~300, that renders translation cards with `'translationModel'`). It currently has no `model-group__device-control`.

- [ ] **Step 2: Add the device control**

Inside the translation `ModelGroup`, immediately before its `renderCards(...)` call, insert a device control identical in structure to the ASR one (lines ~301-335) but bound to `translationDevice`:

```tsx
        <div className="model-group__device-control">
          <div className="model-group__device-label">
            {t('models.computeDevice', 'Compute device')}
            <Tooltip
              content={t('models.computeDeviceTooltip', 'Which device runs the translation model. Auto picks the fastest available (GPU when present); CPU works everywhere but is slower for large models; GPU requires a CUDA GPU.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
            </Tooltip>
          </div>
          {(() => {
            const gpuAvail = gpuTierAvailable(catalog);
            const deviceValue = settings.translationDevice === 'cuda' && !gpuAvail ? 'auto' : settings.translationDevice;
            const opts: Array<['auto' | 'cpu' | 'cuda', string]> = [
              ['auto', t('models.deviceAuto', 'Auto')],
              ['cpu', t('models.deviceCpu', 'CPU')],
              ...(gpuAvail ? [['cuda', t('models.deviceGpu', 'GPU')] as ['cuda', string]] : []),
            ];
            return (
              <div className="segmented-control">
                {opts.map(([mode, label]) => (
                  <button
                    key={mode}
                    className={`segmented-option ${deviceValue === mode ? 'active' : ''}`}
                    onClick={() => { if (deviceValue !== mode) update({ translationDevice: mode }); }}
                    disabled={isSessionActive}
                  >
                    {label}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
```

(All referenced symbols — `gpuTierAvailable`, `catalog`, `settings`, `update`, `isSessionActive`, `Tooltip`, `CircleHelp`, `t` — are already in scope from the ASR control.)

- [ ] **Step 3: Typecheck + build the renderer**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "NativeModelManagementSection\|settingsStore\|nativeCatalog\|NativeTranslateClient" || echo "no new type errors in touched files"`
Expected: no new errors in the touched files (the repo has pre-existing tsc errors; only assert the touched files are clean).

- [ ] **Step 4: Run the renderer test suite for touched areas**

Run: `npx vitest run src/lib/local-inference/native src/stores/settingsStore.translationDevice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/NativeModelManagementSection.tsx
git commit -m "feat(native): translation compute-device control (Auto/CPU/GPU)"
```

---

## Task 10: GPU smoke tests (opt-in) + verification

**Files:**
- Test: `sidecar/tests/test_translate_backends.py`

**Interfaces:**
- Consumes: real transformers + CUDA + downloaded models.

- [ ] **Step 1: Add opt-in GPU smoke tests**

Append to `sidecar/tests/test_translate_backends.py`:

```python
import os


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads models + needs CUDA)")
@pytest.mark.parametrize("model_id", ["qwen2.5-0.5b", "qwen3-0.6b"])
def test_qwen_translate_real_gpu(model_id):
    from sokuji_sidecar import translate_engine
    eng = translate_engine.TranslateEngine()
    eng.init(model_id=model_id, source_lang="Spanish", target_lang="English", device="cuda")
    assert eng.resolved["device"] == "cuda"
    out, ms = eng.translate("Hola, ¿cómo estás?")
    assert isinstance(out, str) and out.strip() and ms >= 0


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads models + needs CUDA + qwen3_5)")
def test_qwen35_translate_real_gpu_if_available():
    import importlib.util
    if importlib.util.find_spec("transformers.models.qwen3_5") is None:
        pytest.skip("transformers lacks qwen3_5 — Qwen3.5 rows self-gate off")
    from sokuji_sidecar import translate_engine
    eng = translate_engine.TranslateEngine()
    eng.init(model_id="qwen3.5-0.8b", source_lang="Spanish", target_lang="English", device="cuda")
    out, _ = eng.translate("Hola, ¿cómo estás?")
    assert isinstance(out, str) and out.strip()
```

- [ ] **Step 2: Verify Qwen3.5 class availability in the sidecar venv**

Run: `cd sidecar && python -c "import importlib.util; print('qwen3_5:', importlib.util.find_spec('transformers.models.qwen3_5') is not None)"`
Expected: prints `qwen3_5: True` or `qwen3_5: False`. If `False`, the two Qwen3.5 rows self-gate off (correct, non-blocking) — note it in the PR description; do not pin transformers in this increment.

- [ ] **Step 3: Run the opt-in GPU smoke locally (if a CUDA box is available)**

Run: `cd sidecar && SOKUJI_RUN_GPU=1 python -m pytest tests/test_translate_backends.py -k real_gpu -v`
Expected: PASS for `qwen2.5-0.5b` / `qwen3-0.6b`; the Qwen3.5 test PASSES or SKIPS depending on Step 2.

- [ ] **Step 4: Commit**

```bash
git add sidecar/tests/test_translate_backends.py
git commit -m "test(sidecar): opt-in GPU smoke for native qwen translation"
```

---

## Final verification

- [ ] **Full sidecar suite:** `cd sidecar && python -m pytest -q` → all pass.
- [ ] **Renderer touched tests:** `npx vitest run src/lib/local-inference/native src/stores src/services/clients` → all pass.
- [ ] **Typecheck touched files** are clean (repo has pre-existing tsc errors; only the touched files must be clean).
- [ ] **Manual smoke (optional):** run the Electron app, start a LOCAL_NATIVE translation session, pick each Qwen version, toggle Auto/CPU/GPU, confirm the `ready` reply's resolved device matches the selection (GPU when CUDA present, CPU fallback otherwise).
