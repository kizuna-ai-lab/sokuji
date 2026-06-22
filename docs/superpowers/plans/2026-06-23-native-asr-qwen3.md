# Qwen3-ASR-1.7B (GPU tier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Qwen3-ASR-1.7B as a GPU-tier ASR model in the LOCAL_NATIVE sidecar — a new `Qwen3AsrBackend` (qwen-asr package) + one catalog/download/renderer row each — for SOTA CJK + context-biased accuracy.

**Architecture:** One new `AsrBackend` adapter mirroring the Granite `TransformersBackend` (lazy import, `BackendLoadError`, `@register_backend`), plus pure-data rows in `catalog.py` / `native_models.download_specs` / `nativeCatalog.ts`. Resolver, RTF benchmark, and download manager are unchanged in shape. GPU-only this increment.

**Tech Stack:** Python sidecar (`sokuji_sidecar`, pytest), `qwen-asr==0.0.6` (HF transformers under the hood), React/TS renderer (vitest), bf16 on CUDA.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-23-native-asr-qwen3-design.md`.
- **GPU-only** this increment: a single `gpu-cuda` deployment; `load(..., device="cpu", ...)` must raise `BackendLoadError`.
- **`recommended=True`** on `qwen3-asr-1.7b`; do **not** change SenseVoice/Whisper flags.
- Languages tuple (sidecar) and array (renderer) must be **verbatim equal**: `("zh","en","ja","ko","yue","ar","de","es","fr","it","pt","ru","th","vi","hi","id")`.
- `artifact` / download repo = `Qwen/Qwen3-ASR-1.7B`. Backend `NAME = "qwen3asr"`. Catalog id / download id / renderer id = `qwen3-asr-1.7b`.
- `samples` reaching `transcribe(samples, language)` are **float32 @16k in [-1,1]** (`asr_engine.py:100`) — pass straight to qwen-asr's `(samples, 16000)`. No int16 conversion.
- Correctness gates: **pytest** (sidecar) / **vitest** (renderer) / `npm run build` (renderer wiring). NOT tsc.
- English-only comments. Conventional Commits. **No push/PR/merge without explicit consent.**
- Reuse the Granite pattern verbatim where possible (`backends.py` `TransformersBackend`, `catalog.py` Granite rows, `native_models.download_specs` Granite branch).

---

## Task 1: Dependency spike (GATING — not TDD, no production code)

**Why:** `qwen-asr==0.0.6` reportedly pins `transformers==4.57.6`; our main venv runs `transformers 5.12.1` (for Granite) + `torch 2.11.0+cu128`. We must learn whether they coexist **before** writing backend code, and derive a **safe main-venv install recipe** that does NOT downgrade transformers (which could break Granite).

**Files:** none committed except the outcome note (see Step 5).

- [ ] **Step 1: Inspect qwen-asr's actual transformers constraint (no main-venv mutation)**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react/.claude/worktrees/native-sidecar-phase1/sidecar
mkdir -p "$CLAUDE_JOB_DIR/tmp/qwen-spike" 2>/dev/null || mkdir -p /tmp/qwen-spike
python3 -m venv /tmp/qwen-spike/venv
/tmp/qwen-spike/venv/bin/pip install -q qwen-asr==0.0.6 2>&1 | tail -5
/tmp/qwen-spike/venv/bin/pip show transformers | grep -E '^(Name|Version)'   # what version did qwen-asr pull?
/tmp/qwen-spike/venv/bin/pip show qwen-asr | grep -iE 'Requires'             # its declared deps
```
Expected: reveals the transformers version qwen-asr resolves to (confirm/deny the `==4.57.6` pin) and its other deps (nagisa, soynlp, sox, etc.).

- [ ] **Step 2: Does qwen-asr RUN on transformers 5.12.1?**

```bash
/tmp/qwen-spike/venv/bin/pip install -q 'transformers==5.12.1'   # force-bump in the THROWAWAY venv
/tmp/qwen-spike/venv/bin/python -c "from qwen_asr import Qwen3ASRModel; print('import OK on 5.12.1')"
```
Expected PASS → qwen-asr tolerates 5.12.1 (we can keep our transformers). Expected FAIL → it genuinely needs 4.57.6.

- [ ] **Step 3: Does Granite run on transformers 4.57.6? (only if Step 2 failed)**

```bash
/tmp/qwen-spike/venv/bin/pip install -q 'transformers==4.57.6'
/tmp/qwen-spike/venv/bin/python -c "from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor; import transformers; print('granite class present on', transformers.__version__)"
```
(If a granite-speech model class import works on 4.57.6, a shared downgrade is an option.)

- [ ] **Step 4: DECISION GATE**

Decide from Steps 1–3:
- **A. Coexist** (qwen-asr runs on 5.12.1, OR both run on one shared version) → the **safe main-venv recipe** is recorded (e.g. `pip install qwen-asr==0.0.6` then `pip install 'transformers==5.12.1'` to restore, OR `--no-deps` + explicitly install its non-transformers deps). **Proceed to Task 2.**
- **B. Cannot coexist** → the GPU Qwen3-ASR backend needs **isolation** (separate venv via subprocess, or a second sidecar process). This changes the architecture. **STOP. Do not write backend code. Report to the user with the spike evidence** (the exact failures from Steps 2–3) for a follow-up design decision.

- [ ] **Step 5: Record the outcome**

Write the decision + the validated main-venv install recipe into `.superpowers/sdd/qwen3-spike.md` (gitignored scratch) AND as a short note appended to the plan's progress ledger. Remove the throwaway venv: `rm -rf /tmp/qwen-spike`. No production commit in this task.

---

## Task 2: `Qwen3AsrBackend` + `_qwen_lang` helper

**Files:**
- Modify: `sidecar/sokuji_sidecar/backends.py` (append after `TransformersBackend`)
- Test: `sidecar/tests/test_backends.py`

**Interfaces:**
- Consumes: `AsrResult`, `BackendLoadError`, `register_backend`, `make_backend`, `TARGET_RATE` (all in `backends.py`).
- Produces: module-level `_QWEN_LANG` dict + `_qwen_lang(language) -> str|None`; class `Qwen3AsrBackend` (`NAME="qwen3asr"`) with `load/transcribe/unload/is_loaded`. `transcribe(samples, language)` calls `self._model.transcribe(audio=(samples, TARGET_RATE), language=_qwen_lang(language), context="")` and returns `AsrResult(text, lang)`.

- [ ] **Step 1: Write the failing tests** (append to `test_backends.py`; `sys`, `types`, `numpy as np`, `pytest`, `backends` are already imported)

```python
def test_qwen_lang_mapping():
    assert backends._qwen_lang("ja") == "Japanese"
    assert backends._qwen_lang("ZH") == "Chinese"   # case-insensitive
    assert backends._qwen_lang("") is None
    assert backends._qwen_lang(None) is None
    assert backends._qwen_lang("xx") is None


def test_qwen3asr_is_gpu_only():
    b = backends.make_backend("qwen3asr")
    with pytest.raises(backends.BackendLoadError):
        b.load("Qwen/Qwen3-ASR-1.7B", "cpu", "bfloat16")


def _install_fake_qwen_asr(monkeypatch, *, text=" hi", lang="English"):
    captured = {}

    class _FakeResult:
        def __init__(self):
            self.text = text
            self.language = lang

    class _FakeModel:
        @classmethod
        def from_pretrained(cls, model_ref, **kw):
            captured["model_ref"] = model_ref
            captured["kw"] = kw
            return cls()

        def transcribe(self, audio, language, context):
            captured["audio"] = audio
            captured["language"] = language
            captured["context"] = context
            return [_FakeResult()]

    mod = types.ModuleType("qwen_asr")
    mod.Qwen3ASRModel = _FakeModel
    monkeypatch.setitem(sys.modules, "qwen_asr", mod)
    return captured


def test_qwen3asr_load_and_transcribe(monkeypatch):
    captured = _install_fake_qwen_asr(monkeypatch)
    b = backends.make_backend("qwen3asr")
    b.load("Qwen/Qwen3-ASR-1.7B", "cuda", "bfloat16")
    assert b.is_loaded
    r = b.transcribe(np.zeros(16000, np.float32), "ja")
    assert r.text == "hi"                       # stripped
    assert r.language == "English"              # from the fake result
    assert captured["language"] == "Japanese"   # _qwen_lang("ja")
    assert captured["audio"][1] == 16000        # TARGET_RATE
    assert captured["context"] == ""
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -k qwen -v`
Expected: FAIL — `_qwen_lang`/`qwen3asr` don't exist yet (`AttributeError` / unknown backend).

- [ ] **Step 3: Implement the backend** (append to `backends.py`)

```python
_QWEN_LANG = {
    "zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean",
    "yue": "Cantonese", "ar": "Arabic", "de": "German", "es": "Spanish",
    "fr": "French", "it": "Italian", "pt": "Portuguese", "ru": "Russian",
    "th": "Thai", "vi": "Vietnamese", "hi": "Hindi", "id": "Indonesian",
}


def _qwen_lang(language):
    """Map our ISO source hint to Qwen's full-name language string; None = auto-detect."""
    return _QWEN_LANG.get((language or "").lower()) or None


@register_backend
class Qwen3AsrBackend:
    """Qwen3-ASR speech-LLM via the qwen-asr package. model_ref is the HF repo id;
    GPU-tier (bf16). GPU-only this increment — the CPU 0.6B sherpa tier is deferred."""
    NAME = "qwen3asr"

    def __init__(self):
        self._model = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        if device == "cpu":
            raise BackendLoadError("qwen3asr is GPU-only (no CPU deployment)")
        try:
            import torch
            from qwen_asr import Qwen3ASRModel
            dtype = torch.bfloat16 if compute_type in ("bfloat16", "auto") else torch.float16
            self._model = Qwen3ASRModel.from_pretrained(
                model_ref, dtype=dtype, device_map=device,
                max_inference_batch_size=1, max_new_tokens=256)
        except Exception as e:  # missing package/deps, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        # samples = float32 @16k VAD segment (asr_engine.py); qwen-asr takes it directly.
        results = self._model.transcribe(
            audio=(samples, TARGET_RATE), language=_qwen_lang(language), context="")
        r = results[0]
        return AsrResult(r.text.strip(), getattr(r, "language", language))

    def unload(self) -> None:
        self._model = None
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

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -v`
Expected: PASS (the new qwen tests + all pre-existing backend tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/backends.py sidecar/tests/test_backends.py
git commit -m "feat(sidecar): Qwen3AsrBackend (qwen-asr, GPU-only) + language map"
```

---

## Task 3: Catalog row

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (append to `ASR_MODELS`)
- Test: `sidecar/tests/test_catalog.py`

**Interfaces:**
- Consumes: `Deployment`, `AsrModel`, `ASR_MODELS`, `asr_model()` (in `catalog.py`).
- Produces: an `AsrModel("qwen3-asr-1.7b", ...)` row with a single `Deployment("qwen3asr","gpu-cuda","bfloat16","Qwen/Qwen3-ASR-1.7B",1.0)`, `recommended=True`, `sort_order=7`.

- [ ] **Step 1: Write the failing tests** (edit `test_catalog.py`)

First, update the allowed-backend set in `test_models_have_deployments_and_languages` to include the new backend:

```python
            assert d.backend in {"ctranslate2", "sherpa", "transformers", "qwen3asr"}
```

Then append a frozen fixture + flag/deployment assertions:

```python
def test_qwen3_asr_row():
    m = catalog.asr_model("qwen3-asr-1.7b")
    assert m is not None
    assert m.languages == ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
                           "fr", "it", "pt", "ru", "th", "vi", "hi", "id")
    assert m.recommended is True
    assert m.sort_order == 7
    assert len(m.deployments) == 1
    d = m.deployments[0]
    assert (d.backend, d.tier, d.compute_type, d.artifact) == \
        ("qwen3asr", "gpu-cuda", "bfloat16", "Qwen/Qwen3-ASR-1.7B")
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -v`
Expected: FAIL — `asr_model("qwen3-asr-1.7b")` is `None`.

- [ ] **Step 3: Add the catalog row** (append inside `ASR_MODELS`, after the granite rows)

```python
    AsrModel("qwen3-asr-1.7b", "Qwen3-ASR 1.7B",
             ("zh", "en", "ja", "ko", "yue", "ar", "de", "es",
              "fr", "it", "pt", "ru", "th", "vi", "hi", "id"),
             (Deployment("qwen3asr", "gpu-cuda", "bfloat16", "Qwen/Qwen3-ASR-1.7B", 1.0),),
             recommended=True, sort_order=7),
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -v`
Expected: PASS (incl. `test_system_has_a_cpu_floor` — Whisper/sense-voice still provide the CPU floor; this GPU-only row is fine like Granite).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(sidecar): catalog row for qwen3-asr-1.7b (gpu-cuda, recommended)"
```

---

## Task 4: `download_specs` mapping

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`download_specs`)
- Test: `sidecar/tests/test_native_models.py` (`test_download_specs_mapping`)

**Interfaces:**
- Produces: `download_specs("qwen3-asr-1.7b")` returns `{"repos": ["Qwen/Qwen3-ASR-1.7B"], "urls": []}`.

- [ ] **Step 1: Write the failing assertion** (add to `test_download_specs_mapping`, after the granite asserts)

```python
    assert nm.download_specs('qwen3-asr-1.7b')['repos'] == ['Qwen/Qwen3-ASR-1.7B']
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_native_models.py::test_download_specs_mapping -v`
Expected: FAIL — falls through to the bare-id default `['qwen3-asr-1.7b']`.

- [ ] **Step 3: Add the explicit branch** (in `download_specs`, before the final fallthrough `return {"repos": [model_id], "urls": []}`)

```python
    if model_id == "qwen3-asr-1.7b":
        # Explicit branch: a missing one would use the bare id as the repo (the
        # Granite silent-'ready' bug). Standard HF snapshot — no urls.
        return {"repos": ["Qwen/Qwen3-ASR-1.7B"], "urls": []}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_native_models.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_native_models.py
git commit -m "feat(sidecar): download_specs branch for qwen3-asr-1.7b"
```

---

## Task 5: Renderer catalog row

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (`NATIVE_ASR`)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Consumes: `NativeModelOption` (`{ id, label, languages, recommended?, sortOrder? }`), `NATIVE_ASR`.
- Produces: a `NATIVE_ASR` row `{ id: 'qwen3-asr-1.7b', label: 'Qwen3-ASR 1.7B', languages: [16 codes], recommended: true, sortOrder: 7 }`. The languages array equals the sidecar catalog tuple verbatim.

- [ ] **Step 1: Write the failing test** (append to `nativeCatalog.test.ts`, inside the existing top-level `describe`)

```typescript
  it('includes qwen3-asr-1.7b with the verbatim sidecar language set', () => {
    const q = NATIVE_ASR.find((m) => m.id === 'qwen3-asr-1.7b');
    expect(q).toBeTruthy();
    expect(q!.languages).toEqual(['zh','en','ja','ko','yue','ar','de','es','fr','it','pt','ru','th','vi','hi','id']);
    expect(q!.recommended).toBe(true);
    expect(q!.sortOrder).toBe(7);
    // sense-voice / whisper-base stay the recommended-first picks for their languages
    expect(nativeAsrCards('zh')[0].selectId).toBe('sense-voice');
    expect(nativeAsrCards('de')[0].selectId).toBe('whisper-base');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — no `qwen3-asr-1.7b` row.

- [ ] **Step 3: Add the renderer row** (in `NATIVE_ASR`, after the granite rows)

```typescript
  { id: 'qwen3-asr-1.7b', label: 'Qwen3-ASR 1.7B', languages: ['zh','en','ja','ko','yue','ar','de','es','fr','it','pt','ru','th','vi','hi','id'], recommended: true, sortOrder: 7 },
```

- [ ] **Step 4: Run the full renderer catalog suite + build**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS (the new test + all pre-existing; the `incompatibleNativeAsr('de')==['sense-voice']` and `('zh')` granite assertions are unaffected — qwen3 supports both de and zh so it's never in those incompatible lists).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): renderer catalog row for qwen3-asr-1.7b"
```

---

## Task 6: GPU-gated real smoke (env-dependent — needs Task 1 outcome A)

**Files:**
- Test: `sidecar/tests/test_backends.py` (a new skip-gated test)

**Prerequisite:** Task 1 confirmed coexistence (outcome A). Before this test can run, install qwen-asr into the **main** venv using the recipe Task 1 validated (one that **preserves transformers 5.12.1** — verify `pip show transformers` still reads 5.12.1 afterward, and that Granite still imports). This is a stateful env change like the earlier cu128 torch install; it is NOT committed.

- [ ] **Step 1: Install qwen-asr into the main venv (per Task 1 recipe), then sanity-check Granite is intact**

```bash
cd sidecar
# <Task-1 recipe>, e.g.:  .venv/bin/pip install qwen-asr==0.0.6 && .venv/bin/pip install 'transformers==5.12.1'
.venv/bin/pip show transformers | grep Version    # MUST still be 5.12.1
.venv/bin/python -c "from transformers import AutoModelForSpeechSeq2Seq; print('granite class OK')"
.venv/bin/python -c "from qwen_asr import Qwen3ASRModel; print('qwen-asr OK')"
```
Expected: transformers 5.12.1 preserved; both imports OK. If transformers got downgraded → stop, this is outcome B — report to the user.

- [ ] **Step 2: Write the GPU-gated smoke test** (append to `test_backends.py`)

```python
import os


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_GPU"),
                    reason="set SOKUJI_RUN_GPU=1 (downloads Qwen/Qwen3-ASR-1.7B, needs CUDA)")
def test_qwen3asr_real_gpu_smoke():
    import time
    b = backends.make_backend("qwen3asr")
    b.load("Qwen/Qwen3-ASR-1.7B", "cuda", "bfloat16")
    assert b.is_loaded
    clip = np.zeros(16000 * 3, np.float32)   # 3 s of silence — exercises the path
    t0 = time.perf_counter()
    r = b.transcribe(clip, "en")
    rtf = (time.perf_counter() - t0) / 3.0
    assert isinstance(r.text, str)           # may be empty for silence; must not raise
    print(f"qwen3-asr-1.7b RTF={rtf:.4f}")
    b.unload()
```

- [ ] **Step 3: Run the smoke (GPU box only)**

Run: `cd sidecar && SOKUJI_RUN_GPU=1 .venv/bin/python -m pytest tests/test_backends.py::test_qwen3asr_real_gpu_smoke -v -s`
Expected: PASS; prints an RTF. Note the RTF + VRAM in the report. Without the flag the test SKIPS (so CI/non-GPU stays green).

- [ ] **Step 4: Run the whole sidecar suite (no flag) to confirm nothing regressed**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: all pass, the GPU smoke skips.

- [ ] **Step 5: Commit**

```bash
git add sidecar/tests/test_backends.py
git commit -m "test(sidecar): GPU-gated Qwen3-ASR real smoke (RTF)"
```

---

## Self-Review

**Spec coverage:**
- `Qwen3AsrBackend` (new class, GPU-only, qwen-asr API, `_QWEN_LANG`) → Task 2.
- Catalog row (gpu-cuda, recommended, sort 7, 16 langs) → Task 3.
- `download_specs` explicit branch → Task 4.
- `nativeCatalog.ts` row (languages == sidecar verbatim) → Task 5.
- GPU smoke + RTF → Task 6.
- Dependency spike (the spec's gating risk) → Task 1.
- Language handling (explicit-else-auto) → Task 2 (`_qwen_lang`).
- Non-goals (CPU 0.6B, hotword UI, flash-attn) → correctly absent.

**Placeholder scan:** none — every code step is complete. The one deliberate deferral is Task 6's "Task-1 recipe" for the install command, which is genuinely a Task-1 output (the safe recipe can't be known until the spike runs); Step 1 states the invariant it must satisfy (transformers stays 5.12.1).

**Type/name consistency:** `qwen3-asr-1.7b` (catalog/download/renderer id), `qwen3asr` (backend NAME + the catalog `Deployment.backend` + the `test_catalog` allowed set), `Qwen/Qwen3-ASR-1.7B` (artifact + download repo), the 16-language tuple (identical in Task 3 sidecar / Task 5 renderer / their tests). `_qwen_lang`/`_QWEN_LANG` consistent across Task 2 impl + test. `transcribe(samples, language)` matches the existing backend signature; `samples` float32 pass-through.

## Notes

- **Task ordering:** Task 1 gates everything. Tasks 2–5 are mock/data/renderer and need **no** qwen-asr install — safe to do on any machine once Task 1 says "coexist". Task 6 is the only task needing the real install + a GPU.
- **If Task 1 returns outcome B (isolation):** stop after Task 1 and re-open the design (subprocess/separate-venv) with the user — Tasks 2 and 6 would change materially (the backend would shell out instead of importing qwen_asr in-process).
