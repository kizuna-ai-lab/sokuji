# Native TranslateGemma + HY-MT2 Translation Backends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TranslateGemma-4B and Hunyuan-MT2 (1.8B/7B) as native transformers translation backends, selectable in the LOCAL_NATIVE provider.

**Architecture:** Two new backend classes (`gemma_translate`, `hunyuan_translate`) registered into the existing backend registry, three catalog rows, three `download_specs` entries, and three renderer descriptors. The translation engine, resolver, VRAM gate, and resolved-memory display are reused unchanged.

**Tech Stack:** Python sidecar (transformers 5.13, torch 2.x+cu128), React/TypeScript renderer, pytest + vitest.

## Global Constraints

- Sidecar runs transformers 5.13 / torch 2.x+cu128; `Gemma3ForConditionalGeneration`, `Gemma3ForCausalLM`, and `hunyuan_v1_dense` are all native to this transformers.
- **No `trust_remote_code`** anywhere — HY-MT2 loads with plain `AutoModelForCausalLM` (native arch, no `auto_map`).
- **Gemma loads text-only via `AutoTokenizer` + `Gemma3ForConditionalGeneration`** — never `AutoProcessor` (torchvision gate).
- Only a bf16 GPU tier + a float32 CPU floor per model. No FP8/GGUF/NVFP4, no variant selector (deferred to spec (b)).
- Greedy decode (`do_sample=False`) — deterministic and testable, consistent with the existing backends.
- `translate_engine.py` is NOT modified.
- All docs/comments in English. Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Run all sidecar commands from `sidecar/` using `.venv/bin/python` / `.venv/bin/pytest`.

---

### Task 1: Catalog rows + helper rename

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (the `_qwen_translate_row` helper and `TRANSLATE_MODELS` list, ~lines 99-118)
- Test: `sidecar/tests/test_catalog.py`

**Interfaces:**
- Consumes: existing `Deployment`, `TranslateModel`, `translate_model(id)`.
- Produces: catalog ids `translategemma-4b` (backend `gemma_translate`), `hy-mt2-1.8b` and `hy-mt2-7b` (backend `hunyuan_translate`), each with a `gpu-cuda`/`bfloat16` + `cpu`/`float32` deployment pair. Helper renamed `_qwen_translate_row` → `_llm_translate_row`.

- [ ] **Step 1: Write the failing test**

Add to `sidecar/tests/test_catalog.py`:

```python
def test_new_llm_translate_rows():
    from sokuji_sidecar import catalog
    g = catalog.translate_model("translategemma-4b")
    assert g is not None
    assert g.name == "TranslateGemma 4B"
    assert {d.tier for d in g.deployments} == {"gpu-cuda", "cpu"}
    assert all(d.backend == "gemma_translate" for d in g.deployments)
    assert g.deployments[0].artifact == "google/translategemma-4b-it"

    for mid, repo in [("hy-mt2-1.8b", "tencent/Hy-MT2-1.8B"),
                      ("hy-mt2-7b", "tencent/Hy-MT2-7B")]:
        h = catalog.translate_model(mid)
        assert h is not None and all(d.backend == "hunyuan_translate" for d in h.deployments)
        assert h.deployments[0].artifact == repo
        assert {d.tier for d in h.deployments} == {"gpu-cuda", "cpu"}
        # bf16 on GPU, float32 on CPU (mirrors the Qwen rows)
        gpu = next(d for d in h.deployments if d.tier == "gpu-cuda")
        cpu = next(d for d in h.deployments if d.tier == "cpu")
        assert gpu.compute_type == "bfloat16" and cpu.compute_type == "float32"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_catalog.py::test_new_llm_translate_rows -v`
Expected: FAIL — `translate_model("translategemma-4b")` returns `None` (assert on `g is not None`).

- [ ] **Step 3: Rename the helper and add the rows**

In `sidecar/sokuji_sidecar/catalog.py`, rename `_qwen_translate_row` to `_llm_translate_row` and update the `TRANSLATE_MODELS` list to use the new name plus the three new rows. Replace the helper definition and the list:

```python
def _llm_translate_row(mid, name, repo, backend, sort_order, recommended=False):
    return TranslateModel(mid, name, ("multi",), (
        Deployment(backend, "gpu-cuda", "bfloat16", repo, 1.0),
        Deployment(backend, "cpu", "float32", repo, 1.0),
    ), recommended=recommended, sort_order=sort_order)


TRANSLATE_MODELS: list[TranslateModel] = [
    _llm_translate_row("qwen2.5-0.5b", "Qwen 2.5 0.5B",
                       QWEN25_REPO, "qwen_translate", 1, recommended=True),
    _llm_translate_row("qwen3-0.6b", "Qwen 3 0.6B",
                       "Qwen/Qwen3-0.6B", "qwen_translate", 2, recommended=True),
    _llm_translate_row("qwen3.5-0.8b", "Qwen 3.5 0.8B",
                       "Qwen/Qwen3.5-0.8B", "qwen35_translate", 3),
    _llm_translate_row("qwen3.5-2b", "Qwen 3.5 2B",
                       "Qwen/Qwen3.5-2B", "qwen35_translate", 4),
    _llm_translate_row("translategemma-4b", "TranslateGemma 4B",
                       "google/translategemma-4b-it", "gemma_translate", 5),
    _llm_translate_row("hy-mt2-1.8b", "Hunyuan-MT2 1.8B",
                       "tencent/Hy-MT2-1.8B", "hunyuan_translate", 6),
    _llm_translate_row("hy-mt2-7b", "Hunyuan-MT2 7B",
                       "tencent/Hy-MT2-7B", "hunyuan_translate", 7),
]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/pytest tests/test_catalog.py -v`
Expected: PASS (new test + all existing catalog tests — the rename is internal).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(native): catalog rows for TranslateGemma + HY-MT2 translate models

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Download mapping

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`download_specs`, ~lines 24-60)
- Test: `sidecar/tests/test_native_models.py`

**Interfaces:**
- Consumes: existing `download_specs(model_id)` contract returning `{repos: [...], urls: [...], [ignore: [...]]}`.
- Produces: download specs for `translategemma-4b`, `hy-mt2-1.8b`, `hy-mt2-7b`.

- [ ] **Step 1: Write the failing test**

Add to `sidecar/tests/test_native_models.py`:

```python
def test_download_specs_new_translate_models():
    from sokuji_sidecar import native_models as nm
    assert nm.download_specs("translategemma-4b")["repos"] == ["google/translategemma-4b-it"]
    h18 = nm.download_specs("hy-mt2-1.8b")
    assert h18["repos"] == ["tencent/Hy-MT2-1.8B"]
    assert h18["ignore"] == ["train/*"]
    h7 = nm.download_specs("hy-mt2-7b")
    assert h7["repos"] == ["tencent/Hy-MT2-7B"]
    assert h7["ignore"] == ["train/*"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_native_models.py::test_download_specs_new_translate_models -v`
Expected: FAIL — `download_specs("translategemma-4b")` falls through to `{"repos": ["translategemma-4b"], "urls": []}` (assert on repos mismatch).

- [ ] **Step 3: Add the branches**

In `download_specs`, immediately before the final `return {"repos": [model_id], "urls": []}`, add:

```python
    if model_id == "translategemma-4b":
        return {"repos": ["google/translategemma-4b-it"], "urls": []}
    if model_id in ("hy-mt2-1.8b", "hy-mt2-7b"):
        # train/ holds only training scripts (deepspeed/llama-factory) — skip; weights only.
        repo = "tencent/Hy-MT2-1.8B" if model_id == "hy-mt2-1.8b" else "tencent/Hy-MT2-7B"
        return {"repos": [repo], "urls": [], "ignore": ["train/*"]}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/pytest tests/test_native_models.py -v`
Expected: PASS (new test + existing mapping tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_native_models.py
git commit -m "feat(native): download specs for TranslateGemma + HY-MT2

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `hunyuan_translate` backend

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_backends.py` (append a helper + class after `Qwen35TranslateBackend`)
- Test: `sidecar/tests/test_translate_backends.py`

**Interfaces:**
- Consumes: `register_backend`, `BackendLoadError` (from `.backends`), `_clean_output` (existing module helper). The test mocks `_fake_tok(captured)` / `_fake_model()` / `FakeInputs` already defined in the test file. Catalog id `hy-mt2-1.8b` (Task 1) and its download spec (Task 2) for the gated GPU test.
- Produces: `HunyuanTranslateBackend` (NAME `hunyuan_translate`) and module helper `_hunyuan_prompt(tgt) -> str`. The backend exposes `load(model_ref, device, compute_type)`, `translate(text, system_prompt, src, tgt, wrap) -> (str, int)`, `unload()`, `is_loaded`.

- [ ] **Step 1: Write the failing tests**

Add to `sidecar/tests/test_translate_backends.py`:

```python
def test_hunyuan_registered():
    assert backends._BACKENDS.get("hunyuan_translate") is tb.HunyuanTranslateBackend


def test_hunyuan_prompt_mentions_target_only():
    p = tb._hunyuan_prompt("English")
    assert "into English" in p and "only output" in p.lower()


def test_hunyuan_single_user_message_with_target_and_wrap():
    captured = []
    b = tb.HunyuanTranslateBackend()
    b._tok = _fake_tok(captured)
    b._model = _fake_model()
    b._device = "cpu"
    out, n = b.translate("hi", "", "Japanese", "English", wrap=True)
    assert out == "translated" and n == 7
    # HY-MT2 format: a single user turn, instruction + (wrapped) text concatenated.
    assert len(captured) == 1 and captured[0]["role"] == "user"
    content = captured[0]["content"]
    assert isinstance(content, str)
    assert content.startswith("Translate the following text into English.")
    assert content.endswith("<transcript>hi</transcript>")


def test_hunyuan_load_raises_on_failure(monkeypatch):
    import sys
    fake = MagicMock()
    fake.AutoModelForCausalLM.from_pretrained.side_effect = RuntimeError("no weights")
    monkeypatch.setitem(sys.modules, "transformers", fake)
    b = tb.HunyuanTranslateBackend()
    with pytest.raises(backends.BackendLoadError):
        b.load("tencent/Hy-MT2-1.8B", "cuda", "bfloat16")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_translate_backends.py -k hunyuan -v`
Expected: FAIL — `tb.HunyuanTranslateBackend` / `tb._hunyuan_prompt` do not exist (AttributeError).

- [ ] **Step 3: Implement the helper and backend**

Append to `sidecar/sokuji_sidecar/translate_backends.py`:

```python
def _hunyuan_prompt(tgt: str) -> str:
    t = tgt or "the target language"
    # HY-MT2's documented English instruction; the model auto-detects the source.
    return (f"Translate the following text into {t}. Note that you should only "
            "output the translated result without any additional explanation: ")


@register_backend
class HunyuanTranslateBackend:
    NAME = "hunyuan_translate"

    def __init__(self):
        self._model = None
        self._tok = None
        self._device = "cpu"

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            # hunyuan_v1_dense is native to transformers 5.13 (no auto_map, no
            # modeling_*.py in the repo) → plain AutoModelForCausalLM, no trust_remote_code.
            from transformers import AutoModelForCausalLM, AutoTokenizer
            dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
            self._tok = AutoTokenizer.from_pretrained(model_ref, local_files_only=True)
            self._model = AutoModelForCausalLM.from_pretrained(
                model_ref, dtype=dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str, wrap: bool) -> tuple[str, int]:
        import torch
        instr = system_prompt or _hunyuan_prompt(tgt)
        body = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "user", "content": f"{instr}{body}"}]
        prompt = self._tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self._tok(prompt, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=512, do_sample=False)
        gen = out[0][inputs["input_ids"].shape[1]:]
        return _clean_output(self._tok.decode(gen, skip_special_tokens=True)), int(gen.shape[0])

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_translate_backends.py -k hunyuan -v`
Expected: PASS (4 hunyuan tests).

- [ ] **Step 5: Add the gated real-GPU test**

Append to `sidecar/tests/test_translate_backends.py`:

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads Hy-MT2-1.8B + needs CUDA)")
def test_hunyuan_translate_real_gpu():
    from sokuji_sidecar import translate_engine
    eng = translate_engine.TranslateEngine()
    eng.init(model_id="hy-mt2-1.8b", source_lang="Chinese", target_lang="English", device="cuda")
    assert eng.resolved["device"] == "cuda"
    out, ms = eng.translate("你好，最近怎么样？")
    assert isinstance(out, str) and out.strip() and ms >= 0
    eng.close()
```

- [ ] **Step 6: Verify the gated test is collected and skipped (no GPU run here)**

Run: `.venv/bin/pytest tests/test_translate_backends.py -k hunyuan -v`
Expected: PASS for the 4 unit tests; `test_hunyuan_translate_real_gpu` shows SKIPPED (the controller runs it with `SOKUJI_RUN_GPU=1` during Real-GPU Validation).

- [ ] **Step 7: Commit**

```bash
git add sidecar/sokuji_sidecar/translate_backends.py sidecar/tests/test_translate_backends.py
git commit -m "feat(native): hunyuan_translate backend for HY-MT2

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `gemma_translate` backend

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_backends.py` (append a map, helper, and class)
- Test: `sidecar/tests/test_translate_backends.py`

**Interfaces:**
- Consumes: `register_backend`, `BackendLoadError`, `_clean_output`, the test mocks, catalog id `translategemma-4b` (Task 1) + its download spec (Task 2).
- Produces: `GemmaTranslateBackend` (NAME `gemma_translate`), module map `_GEMMA_LANG_CODE`, helper `_gemma_code(name) -> str`. Same backend method signatures as Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `sidecar/tests/test_translate_backends.py`:

```python
def test_gemma_registered():
    assert backends._BACKENDS.get("gemma_translate") is tb.GemmaTranslateBackend


def test_gemma_code_maps_names_and_passes_through():
    assert tb._gemma_code("Japanese") == "ja"
    assert tb._gemma_code("English") == "en"
    assert tb._gemma_code("Klingon") == "Klingon"   # unknown → pass through
    assert tb._gemma_code("zh") == "zh"             # already a code → pass through


def test_gemma_text_only_message_with_bcp47_codes():
    captured = []
    b = tb.GemmaTranslateBackend()
    b._tok = _fake_tok(captured)
    b._model = _fake_model()
    b._device = "cpu"
    out, n = b.translate("hi", "", "Japanese", "English", wrap=False)
    assert out == "translated" and n == 7
    assert len(captured) == 1 and captured[0]["role"] == "user"
    content = captured[0]["content"]
    # TranslateGemma's multimodal-style content list with per-message lang codes.
    assert isinstance(content, list) and len(content) == 1
    entry = content[0]
    assert entry["type"] == "text"
    assert entry["source_lang_code"] == "ja"
    assert entry["target_lang_code"] == "en"
    assert entry["text"] == "hi"


def test_gemma_load_raises_when_class_missing(monkeypatch):
    import sys
    fake = MagicMock()
    del fake.Gemma3ForConditionalGeneration   # attribute access raises AttributeError
    monkeypatch.setitem(sys.modules, "transformers", fake)
    b = tb.GemmaTranslateBackend()
    with pytest.raises(backends.BackendLoadError):
        b.load("google/translategemma-4b-it", "cuda", "bfloat16")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_translate_backends.py -k gemma -v`
Expected: FAIL — `tb.GemmaTranslateBackend` / `tb._gemma_code` do not exist.

- [ ] **Step 3: Implement the map, helper, and backend**

Append to `sidecar/sokuji_sidecar/translate_backends.py`:

```python
# Full English language name -> BCP-47 code for TranslateGemma's chat-template
# source_lang_code/target_lang_code fields. The engine passes full names; unknown
# names (or values that are already codes) pass through unchanged.
_GEMMA_LANG_CODE = {
    "English": "en", "Chinese": "zh", "Japanese": "ja", "Korean": "ko",
    "French": "fr", "German": "de", "Spanish": "es", "Portuguese": "pt",
    "Italian": "it", "Russian": "ru", "Arabic": "ar", "Hindi": "hi",
    "Dutch": "nl", "Vietnamese": "vi", "Thai": "th", "Indonesian": "id",
    "Turkish": "tr", "Polish": "pl", "Ukrainian": "uk", "Greek": "el",
}


def _gemma_code(name: str) -> str:
    return _GEMMA_LANG_CODE.get(name, name)


@register_backend
class GemmaTranslateBackend:
    NAME = "gemma_translate"

    def __init__(self):
        self._model = None
        self._tok = None
        self._device = "cpu"

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            # Text-only: drive AutoTokenizer + the text model class, NOT AutoProcessor.
            # TranslateGemma is a Gemma-3 VLM; AutoProcessor builds an image/video
            # processor that hard-requires torchvision (no wheel for this torch build).
            from transformers import Gemma3ForConditionalGeneration, AutoTokenizer
            dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
            self._tok = AutoTokenizer.from_pretrained(model_ref, local_files_only=True)
            self._model = Gemma3ForConditionalGeneration.from_pretrained(
                model_ref, dtype=dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str, wrap: bool) -> tuple[str, int]:
        import torch
        # TranslateGemma is driven by per-message source/target language codes, not a
        # free-text instruction — system_prompt is not applicable to its template.
        body = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "user", "content": [{
            "type": "text",
            "source_lang_code": _gemma_code(src),
            "target_lang_code": _gemma_code(tgt),
            "text": body,
        }]}]
        prompt = self._tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self._tok(prompt, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=256, do_sample=False)
        gen = out[0][inputs["input_ids"].shape[1]:]
        return _clean_output(self._tok.decode(gen, skip_special_tokens=True)), int(gen.shape[0])

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_translate_backends.py -k gemma -v`
Expected: PASS (4 gemma tests).

- [ ] **Step 5: Add the gated real-GPU test (validates the chat-template path)**

Append to `sidecar/tests/test_translate_backends.py`:

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads TranslateGemma-4B + needs CUDA + Gemma license)")
def test_gemma_translate_real_gpu():
    # Also the validation gate for the AutoTokenizer chat-template path: if the
    # tokenizer lacks the template, this fails and the backend needs the manual-prompt
    # fallback noted in the spec.
    from sokuji_sidecar import translate_engine
    eng = translate_engine.TranslateEngine()
    eng.init(model_id="translategemma-4b", source_lang="Japanese", target_lang="English", device="cuda")
    assert eng.resolved["device"] == "cuda"
    out, ms = eng.translate("こんにちは、お元気ですか？")
    assert isinstance(out, str) and out.strip() and ms >= 0
    eng.close()
```

- [ ] **Step 6: Verify the gated test is collected and skipped**

Run: `.venv/bin/pytest tests/test_translate_backends.py -k gemma -v`
Expected: PASS for the 4 unit tests; `test_gemma_translate_real_gpu` shows SKIPPED.

- [ ] **Step 7: Commit**

```bash
git add sidecar/sokuji_sidecar/translate_backends.py sidecar/tests/test_translate_backends.py
git commit -m "feat(native): gemma_translate backend for TranslateGemma (text-only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Renderer model descriptors

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (`NATIVE_TRANSLATION`, ~lines 36-42)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Consumes: existing `NATIVE_TRANSLATION: NativeModelOption[]` and `NativeModelOption` shape (`{ id, label, languages?, recommended?, sortOrder? }`).
- Produces: three new picker entries with ids matching the catalog (`translategemma-4b`, `hy-mt2-1.8b`, `hy-mt2-7b`).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/local-inference/native/nativeCatalog.test.ts`:

```typescript
import { NATIVE_TRANSLATION } from './nativeCatalog';

describe('NATIVE_TRANSLATION new models', () => {
  it('includes TranslateGemma and HY-MT2 with ids matching the sidecar catalog', () => {
    const byId = Object.fromEntries(NATIVE_TRANSLATION.map((m) => [m.id, m]));
    expect(byId['translategemma-4b']?.label).toBe('TranslateGemma 4B');
    expect(byId['hy-mt2-1.8b']?.label).toBe('Hunyuan-MT2 1.8B');
    expect(byId['hy-mt2-7b']?.label).toBe('Hunyuan-MT2 7B');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `byId['translategemma-4b']` is undefined.

- [ ] **Step 3: Add the entries**

In `src/lib/local-inference/native/nativeCatalog.ts`, add to the `NATIVE_TRANSLATION` array (before the `opus-mt` entry or after `qwen3.5-2b` — order is cosmetic via `sortOrder`):

```typescript
  { id: 'translategemma-4b', label: 'TranslateGemma 4B', languages: ['multi'], sortOrder: 6 },
  { id: 'hy-mt2-1.8b', label: 'Hunyuan-MT2 1.8B', languages: ['multi'], sortOrder: 7 },
  { id: 'hy-mt2-7b', label: 'Hunyuan-MT2 7B', languages: ['multi'], sortOrder: 8 },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS (new test + existing nativeCatalog tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): list TranslateGemma + HY-MT2 in the translation picker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Real-GPU Validation (controller, after all tasks)

The two gated tests (`test_hunyuan_translate_real_gpu`, `test_gemma_translate_real_gpu`) are the hardware gate — run them once on the RTX 4070 after the tasks complete:

```bash
cd sidecar
SOKUJI_RUN_GPU=1 .venv/bin/pytest tests/test_translate_backends.py -k "real_gpu and (hunyuan or gemma)" -v
```

Expected: both PASS. The Gemma case confirms the `AutoTokenizer` chat-template path works; if it errors on the template, apply the manual-prompt fallback (build the prompt string from Gemma's documented format) in `GemmaTranslateBackend.translate` and re-run. This downloads Hy-MT2-1.8B (~3.6 GB) and TranslateGemma-4B (~8.6 GB, Gemma license must be accepted on the configured HF token).

## Full Suite Check

After Task 5, confirm nothing regressed:

```bash
cd sidecar && .venv/bin/pytest -q          # sidecar
npm test -- src/lib/local-inference/native # renderer native
```
Expected: all green (gated GPU tests SKIPPED without `SOKUJI_RUN_GPU`).
