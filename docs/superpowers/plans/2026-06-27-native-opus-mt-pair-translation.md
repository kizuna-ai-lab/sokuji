# Native Opus-MT Pair Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 13 high-usage Opus-MT language pairs to the LOCAL_NATIVE sidecar as a first-class PyTorch MarianMT translate backend (GPU bf16 + CPU floor) with per-pair, opt-in model cards.

**Architecture:** A new `opus_translate` backend (`AutoModelForSeq2SeqLM`, direct `generate()`) sits beside the existing LLM translate backends and reuses the catalog → `resolve_translate` → `load_with_fallback` machinery. Source weights come from `Helsinki-NLP/opus-mt-{src}-{tgt}` (one repo = weights + tokenizer). The renderer gains pair-specific cards filtered by the active source→target language.

**Tech Stack:** Python (sidecar: transformers MarianMT, pytest), TypeScript (renderer: nativeCatalog, vitest).

## Global Constraints

- Backend name: `opus_translate`. Self-gates on `transformers` (MarianMT is core — no `trust_remote_code`, no special module).
- All model/tokenizer loads use `local_files_only=True` (offline-first; per PR #265 review).
- No FP8 / quantized variants for Opus-MT (bf16 is ~300 MB).
- Source repos: `Helsinki-NLP/opus-mt-{src}-{tgt}` (NOT the `Xenova/*` ONNX exports).
- The 13 pairs (id tokens): `ru-en`, `zh-en`, `en-zh`, `hu-en`, `en-es`, `en-ar`, `en-ru`, `es-en`, `en-vi`, `ar-en`, `ja-en`, `en-jap`, `ko-en`.
- `ja`/`jap`: the id/repo for en→ja keeps the Helsinki "jap" token (`opus-mt-en-jap`), but the renderer match-codes use canonical `ja`. ja→en is `opus-mt-ja-en`.
- Renderer language matching uses bare ISO codes via the existing module-private `canonLang` (the native picker emits bare codes like `'en'`/`'zh'`/`'ja'`).
- Opus-MT is opt-in: never a default; the recommended Qwen 2.5 0.5B stays default.
- Sidecar test env: prefix pytest with `SOKUJI_BENCH_DIR=$(mktemp -d)`. Two unrelated `test_accel.py` gating tests (`voxtral_realtime`, `hunyuan_translate`) fail under system Python (transformers version) — that is pre-existing and not caused by this work.

---

### Task 1: `opus_translate` backend + install gate (sidecar)

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_backends.py` (append a new backend class)
- Modify: `sidecar/sokuji_sidecar/accel.py` (add `opus_translate` to `_installed` mods dict, ~line 99)
- Test: `sidecar/tests/test_translate_backends.py` (append), `sidecar/tests/test_accel.py` (append)

**Interfaces:**
- Produces: `translate_backends.OpusTranslateBackend` with `NAME = "opus_translate"`, registered into `backends._BACKENDS`. Methods match the existing backend contract: `load(model_ref, device, compute_type)`, `translate(text, system_prompt, src, tgt, wrap) -> (str, int)`, `unload()`, `is_loaded` property.
- Consumes: `backends.register_backend`, `backends.BackendLoadError` (already imported in the module).

- [ ] **Step 1: Write the failing backend test**

Append to `sidecar/tests/test_translate_backends.py` (reuses the file's existing `FakeInputs`):

```python
def test_opus_backend_registered():
    assert backends._BACKENDS.get("opus_translate") is tb.OpusTranslateBackend


def test_opus_translate_runs_seq2seq_and_ignores_prompt():
    import torch  # noqa: F401  (translate imports torch internally)
    b = tb.OpusTranslateBackend()
    # Seq2seq generate returns the translation tokens directly (no input slice).
    seq = MagicMock()
    seq.shape = [4]                     # 4 output tokens → int-able count
    model = MagicMock()
    model.generate.return_value = [seq]
    tok = MagicMock()
    tok.side_effect = lambda text, **kw: FakeInputs(input_ids=MagicMock(shape=[1, 3]))
    tok.decode.return_value = "  translated  "
    b._model = model
    b._tok = tok
    b._device = "cpu"
    out, n = b.translate("hello", "ignored-prompt", "ja", "en", True)
    assert out == "translated"          # stripped
    assert n == 4
    assert model.generate.called
    # Marian is pair-baked: no chat template is ever applied.
    assert not tok.apply_chat_template.called
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_translate_backends.py::test_opus_backend_registered tests/test_translate_backends.py::test_opus_translate_runs_seq2seq_and_ignores_prompt -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'OpusTranslateBackend'`.

- [ ] **Step 3: Implement the backend**

Append to `sidecar/sokuji_sidecar/translate_backends.py`:

```python
@register_backend
class OpusTranslateBackend:
    NAME = "opus_translate"

    def __init__(self):
        self._model = None
        self._tok = None
        self._device = "cpu"

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._model = None
        self._tok = None
        try:
            import torch
            # MarianMT is a small seq2seq model, core to transformers (no
            # trust_remote_code, no VLM processor). bf16 on GPU, float32 on CPU.
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
            dtype = torch.bfloat16 if compute_type == "bfloat16" else torch.float32
            self._tok = AutoTokenizer.from_pretrained(model_ref, local_files_only=True)
            self._model = AutoModelForSeq2SeqLM.from_pretrained(
                model_ref, dtype=dtype, local_files_only=True).to(device).eval()
            self._device = device
        except Exception as e:  # missing torch/transformers, no CUDA, OOM → resolver falls back
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str, wrap: bool) -> tuple[str, int]:
        # The translation direction is baked into the model — system_prompt, src,
        # tgt and wrap are intentionally ignored. generate() emits only the
        # translation tokens (no input prefix to slice off).
        import torch
        inputs = self._tok(text, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            out = self._model.generate(**inputs, max_new_tokens=512, do_sample=False)
        seq = out[0]
        return self._tok.decode(seq, skip_special_tokens=True).strip(), int(seq.shape[-1])

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

- [ ] **Step 4: Run the backend test to verify it passes**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_translate_backends.py::test_opus_backend_registered tests/test_translate_backends.py::test_opus_translate_runs_seq2seq_and_ignores_prompt -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Write the failing install-gate test**

Append to `sidecar/tests/test_accel.py`:

```python
def test_opus_translate_self_gates_on_transformers(monkeypatch):
    from sokuji_sidecar import accel
    real = accel.importlib.util.find_spec

    def present(name, *a, **k):
        if name == "transformers":
            return object()
        return real(name, *a, **k)
    monkeypatch.setattr(accel.importlib.util, "find_spec", present)
    assert "opus_translate" in accel._installed()
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_accel.py::test_opus_translate_self_gates_on_transformers -v`
Expected: FAIL — `opus_translate` not in the installed set.

- [ ] **Step 7: Add the gate**

In `sidecar/sokuji_sidecar/accel.py`, inside the `mods` dict in `_installed()` (right after the `qwen_translate` entry, ~line 96), add:

```python
            # Opus-MT MarianMT: AutoModelForSeq2SeqLM is core transformers (always
            # present with transformers), so this self-gates on transformers alone.
            "opus_translate": "transformers",
```

- [ ] **Step 8: Run the gate test to verify it passes**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_accel.py::test_opus_translate_self_gates_on_transformers -v`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add sidecar/sokuji_sidecar/translate_backends.py sidecar/sokuji_sidecar/accel.py sidecar/tests/test_translate_backends.py sidecar/tests/test_accel.py
git commit -m "feat(native): opus_translate MarianMT backend + install gate"
```

---

### Task 2: Catalog rows + download mapping (sidecar)

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (add `_opus_row` helper + 13 rows to `TRANSLATE_MODELS`)
- Modify: `sidecar/sokuji_sidecar/native_models.py` (add `opus-mt-*` branch to `_base_specs`)
- Test: `sidecar/tests/test_catalog.py` (append), `sidecar/tests/test_native_models.py` (append), `sidecar/tests/test_accel.py` (append)

**Interfaces:**
- Consumes: `catalog.TranslateModel`, `catalog.Deployment` (already defined in the module), the `opus_translate` backend name from Task 1.
- Produces: `catalog.translate_model("opus-mt-zh-en")` returns a `TranslateModel` with backend `opus_translate` and `[gpu-cuda bf16, cpu float32]` deployments; `native_models.download_specs("opus-mt-zh-en")` returns `{"repos": ["Helsinki-NLP/opus-mt-zh-en"], "urls": []}`.

- [ ] **Step 1: Write the failing catalog + resolver tests**

Append to `sidecar/tests/test_catalog.py`:

```python
def test_opus_rows_present_with_expected_shape():
    from sokuji_sidecar import catalog
    m = catalog.translate_model("opus-mt-zh-en")
    assert m is not None
    assert m.name == "Opus-MT (zh → en)"
    backends = {d.backend for d in m.deployments}
    tiers = [d.tier for d in m.deployments]
    assert backends == {"opus_translate"}
    assert tiers == ["gpu-cuda", "cpu"]            # no fp8 variant
    assert all(d.artifact == "Helsinki-NLP/opus-mt-zh-en" for d in m.deployments)


def test_opus_en_ja_uses_jap_repo_but_ja_display():
    from sokuji_sidecar import catalog
    m = catalog.translate_model("opus-mt-en-jap")
    assert m is not None
    assert m.name == "Opus-MT (en → ja)"           # display maps jap→ja
    assert m.deployments[0].artifact == "Helsinki-NLP/opus-mt-en-jap"


def test_all_13_opus_pairs_registered():
    from sokuji_sidecar import catalog
    ids = {m.id for m in catalog.translate_models()}
    for pid in ["opus-mt-ru-en", "opus-mt-zh-en", "opus-mt-en-zh", "opus-mt-hu-en",
                "opus-mt-en-es", "opus-mt-en-ar", "opus-mt-en-ru", "opus-mt-es-en",
                "opus-mt-en-vi", "opus-mt-ar-en", "opus-mt-ja-en", "opus-mt-en-jap",
                "opus-mt-ko-en"]:
        assert pid in ids, pid
```

Append to `sidecar/tests/test_accel.py`:

```python
def test_resolve_translate_opus_prefers_gpu_then_cpu(monkeypatch):
    from sokuji_sidecar import accel
    # Same fixture shape as test_resolve_translate_prefers_gpu: stub format
    # readiness + size estimate so select_variant picks the GPU deterministically
    # without a network size lookup.
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes", lambda d: 1 * 1024**3)  # 1 GiB, fits any GPU
    m = _machine(nvidia=(accel.Gpu("nvidia", "RTX 4070", 12288, (8, 9)),),
                 installed=frozenset({"opus_translate"}))
    plans = accel.resolve_translate("opus-mt-zh-en", "auto", m)
    assert [p.device for p in plans] == ["cuda", "cpu"]
    assert all(p.backend == "opus_translate" for p in plans)
    assert plans[0].artifact == "Helsinki-NLP/opus-mt-zh-en"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_catalog.py -k opus tests/test_accel.py::test_resolve_translate_opus_prefers_gpu_then_cpu -v`
Expected: FAIL — `translate_model` returns `None` / `unknown translate model`.

- [ ] **Step 3: Add the helper + rows**

In `sidecar/sokuji_sidecar/catalog.py`, after `_with_fp8` (~line 124) and before `TRANSLATE_MODELS`, add:

```python
# Opus-MT display: the en→ja repo keeps Helsinki's "jap" token, but the card
# should read "ja". Only this one code is remapped for the label.
_OPUS_DISP = {"jap": "ja"}


def _opus_disp(code):
    return _OPUS_DISP.get(code, code)


def _opus_row(src, tgt, sort_order):
    mid = f"opus-mt-{src}-{tgt}"
    repo = f"Helsinki-NLP/{mid}"
    name = f"Opus-MT ({_opus_disp(src)} → {_opus_disp(tgt)})"
    return TranslateModel(mid, name, (src, tgt), (
        Deployment("opus_translate", "gpu-cuda", "bfloat16", repo, 1.0),
        Deployment("opus_translate", "cpu", "float32", repo, 1.0),
    ), sort_order=sort_order)
```

Then, inside the `TRANSLATE_MODELS` list, append these 13 rows after the `hy-mt2-7b` row (keep the closing `]`):

```python
    _opus_row("ru", "en", 20),
    _opus_row("zh", "en", 21),
    _opus_row("en", "zh", 22),
    _opus_row("hu", "en", 23),
    _opus_row("en", "es", 24),
    _opus_row("en", "ar", 25),
    _opus_row("en", "ru", 26),
    _opus_row("es", "en", 27),
    _opus_row("en", "vi", 28),
    _opus_row("ar", "en", 29),
    _opus_row("ja", "en", 30),
    _opus_row("en", "jap", 31),
    _opus_row("ko", "en", 32),
```

- [ ] **Step 4: Run the catalog + resolver tests to verify they pass**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_catalog.py -k opus tests/test_accel.py::test_resolve_translate_opus_prefers_gpu_then_cpu -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Write the failing download-spec test**

Append to `sidecar/tests/test_native_models.py`:

```python
def test_download_specs_opus_maps_to_helsinki_repo():
    from sokuji_sidecar import native_models as nm
    assert nm.download_specs("opus-mt-zh-en") == {"repos": ["Helsinki-NLP/opus-mt-zh-en"], "urls": []}
    assert nm.download_specs("opus-mt-en-jap") == {"repos": ["Helsinki-NLP/opus-mt-en-jap"], "urls": []}
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_native_models.py::test_download_specs_opus_maps_to_helsinki_repo -v`
Expected: FAIL — falls through to `{"repos": ["opus-mt-zh-en"], ...}`.

- [ ] **Step 7: Add the download mapping**

In `sidecar/sokuji_sidecar/native_models.py`, inside `_base_specs(model_id)`, add this branch near the other translation ids (before the final `return {"repos": [model_id], "urls": []}`):

```python
    if model_id.startswith("opus-mt-"):
        return {"repos": [f"Helsinki-NLP/{model_id}"], "urls": []}
```

- [ ] **Step 8: Run the download-spec test to verify it passes**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_native_models.py::test_download_specs_opus_maps_to_helsinki_repo -v`
Expected: PASS.

- [ ] **Step 9: Run the full sidecar translate/catalog/native_models suites for regressions**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_catalog.py tests/test_native_models.py tests/test_translate_backends.py -q`
Expected: all pass (no new failures; the pre-existing `test_accel.py` gating failures are not in this set).

- [ ] **Step 10: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_catalog.py sidecar/tests/test_native_models.py sidecar/tests/test_accel.py
git commit -m "feat(native): catalog rows + download mapping for 13 Opus-MT pairs"
```

---

### Task 3: Renderer pair-specific cards (`nativeCatalog.ts`)

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (add `NATIVE_OPUS_PAIRS` + rewrite `nativeTranslationCards`)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts` (update one existing assertion + add new ones)

**Interfaces:**
- Consumes: the module-private `canonLang` and the `NativeModelCardSpec` interface (both already in the file).
- Produces: `nativeTranslationCards(src, tgt)` returns the 7 multilingual cards always, plus any Opus-MT card whose canonicalized `src`→`tgt` matches the arguments. Card ids match the sidecar catalog ids from Task 2 (e.g. `opus-mt-zh-en`).

- [ ] **Step 1: Update the existing exact-match test + add new pair tests**

In `src/lib/local-inference/native/nativeCatalog.test.ts`, change the assertion in the test `'exposes the four Qwen translation versions plus the speech-LLM translators'` (currently the exact 7-id `toEqual` for `nativeTranslationCards('zh', 'en')`) to expect the appended pair card:

```javascript
    expect(ids).toEqual(['qwen2.5-0.5b', 'qwen3-0.6b', 'qwen3.5-0.8b', 'qwen3.5-2b', 'translategemma-4b', 'hy-mt2-1.8b', 'hy-mt2-7b', 'opus-mt-zh-en']);
```

Then add a new `it(...)` block inside the top-level `describe('nativeCatalog', ...)`:

```javascript
  describe('Opus-MT pair cards', () => {
    it('appends the matching pair card after the multilingual models', () => {
      const ids = nativeTranslationCards('zh', 'en').map((c) => c.selectId);
      expect(ids).toContain('opus-mt-zh-en');
      expect(ids.indexOf('opus-mt-zh-en')).toBeGreaterThan(ids.indexOf('hy-mt2-7b')); // opt-in, after defaults
    });

    it('shows only the pair matching the active direction', () => {
      const enJa = nativeTranslationCards('en', 'ja').map((c) => c.selectId);
      expect(enJa).toContain('opus-mt-en-jap');   // id keeps Helsinki "jap"
      expect(enJa).not.toContain('opus-mt-ja-en'); // reverse direction hidden
      const jaEn = nativeTranslationCards('ja', 'en').map((c) => c.selectId);
      expect(jaEn).toContain('opus-mt-ja-en');
      expect(jaEn).not.toContain('opus-mt-en-jap');
    });

    it('shows no Opus-MT card for an unsupported pair', () => {
      const ids = nativeTranslationCards('de', 'fr').map((c) => c.selectId);
      expect(ids.some((id) => id.startsWith('opus-mt-'))).toBe(false);
    });

    it('opus cards keep downloadId === selectId', () => {
      const opus = nativeTranslationCards('zh', 'en').filter((c) => c.selectId.startsWith('opus-mt-'));
      expect(opus.length).toBeGreaterThan(0);
      expect(opus.every((c) => c.downloadId === c.selectId)).toBe(true);
    });
  });
```

- [ ] **Step 2: Run the renderer tests to verify they fail**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `opus-mt-zh-en` absent (the current `nativeTranslationCards` ignores its args and returns only the 7 multilingual cards).

- [ ] **Step 3: Add the pair list + rewrite `nativeTranslationCards`**

In `src/lib/local-inference/native/nativeCatalog.ts`, add this list immediately above the existing `nativeTranslationCards` function (~line 333):

```typescript
/**
 * Opus-MT pair models (PostHog-used pairs). One pair = one card; opt-in, shown
 * only when the active source→target matches. `src`/`tgt` are canonical bare
 * codes for matching the picker; `id` matches the sidecar catalog id (keeps the
 * Helsinki "jap" token for en→ja). Sorted after the multilingual models.
 */
const NATIVE_OPUS_PAIRS: { id: string; name: string; src: string; tgt: string; sortOrder: number }[] = [
  { id: 'opus-mt-ru-en', name: 'Opus-MT (ru → en)', src: 'ru', tgt: 'en', sortOrder: 20 },
  { id: 'opus-mt-zh-en', name: 'Opus-MT (zh → en)', src: 'zh', tgt: 'en', sortOrder: 21 },
  { id: 'opus-mt-en-zh', name: 'Opus-MT (en → zh)', src: 'en', tgt: 'zh', sortOrder: 22 },
  { id: 'opus-mt-hu-en', name: 'Opus-MT (hu → en)', src: 'hu', tgt: 'en', sortOrder: 23 },
  { id: 'opus-mt-en-es', name: 'Opus-MT (en → es)', src: 'en', tgt: 'es', sortOrder: 24 },
  { id: 'opus-mt-en-ar', name: 'Opus-MT (en → ar)', src: 'en', tgt: 'ar', sortOrder: 25 },
  { id: 'opus-mt-en-ru', name: 'Opus-MT (en → ru)', src: 'en', tgt: 'ru', sortOrder: 26 },
  { id: 'opus-mt-es-en', name: 'Opus-MT (es → en)', src: 'es', tgt: 'en', sortOrder: 27 },
  { id: 'opus-mt-en-vi', name: 'Opus-MT (en → vi)', src: 'en', tgt: 'vi', sortOrder: 28 },
  { id: 'opus-mt-ar-en', name: 'Opus-MT (ar → en)', src: 'ar', tgt: 'en', sortOrder: 29 },
  { id: 'opus-mt-ja-en', name: 'Opus-MT (ja → en)', src: 'ja', tgt: 'en', sortOrder: 30 },
  { id: 'opus-mt-en-jap', name: 'Opus-MT (en → ja)', src: 'en', tgt: 'ja', sortOrder: 31 },
  { id: 'opus-mt-ko-en', name: 'Opus-MT (ko → en)', src: 'ko', tgt: 'en', sortOrder: 32 },
];
```

Then replace the body of `nativeTranslationCards` (the function currently named `nativeTranslationCards(_src, _tgt)`) with:

```typescript
export function nativeTranslationCards(src: string, tgt: string): NativeModelCardSpec[] {
  const base: NativeModelCardSpec[] = [
    { selectId: 'qwen2.5-0.5b', downloadId: 'qwen2.5-0.5b', name: 'Qwen 2.5 0.5B', languages: ['multi'], recommended: true, sortOrder: 1 },
    { selectId: 'qwen3-0.6b', downloadId: 'qwen3-0.6b', name: 'Qwen 3 0.6B', languages: ['multi'], recommended: true, sortOrder: 2 },
    { selectId: 'qwen3.5-0.8b', downloadId: 'qwen3.5-0.8b', name: 'Qwen 3.5 0.8B', languages: ['multi'], sortOrder: 3 },
    { selectId: 'qwen3.5-2b', downloadId: 'qwen3.5-2b', name: 'Qwen 3.5 2B', languages: ['multi'], sortOrder: 4 },
    { selectId: 'translategemma-4b', downloadId: 'translategemma-4b', name: 'TranslateGemma 4B', languages: ['multi'], sortOrder: 6 },
    { selectId: 'hy-mt2-1.8b', downloadId: 'hy-mt2-1.8b', name: 'Hunyuan-MT2 1.8B', languages: ['multi'], sortOrder: 7 },
    { selectId: 'hy-mt2-7b', downloadId: 'hy-mt2-7b', name: 'Hunyuan-MT2 7B', languages: ['multi'], sortOrder: 8 },
  ];
  const wantSrc = canonLang(src);
  const wantTgt = canonLang(tgt);
  const opus: NativeModelCardSpec[] = NATIVE_OPUS_PAIRS
    .filter((p) => canonLang(p.src) === wantSrc && canonLang(p.tgt) === wantTgt)
    .map((p) => ({
      selectId: p.id, downloadId: p.id, name: p.name,
      languages: [p.src, p.tgt], sortOrder: p.sortOrder,
    }));
  return [...base, ...opus];
}
```

- [ ] **Step 4: Run the renderer tests to verify they pass**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS (all `nativeCatalog` tests, including the updated exact-match test and the new `Opus-MT pair cards` block).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): pair-specific Opus-MT cards in the translation picker"
```

---

## Notes for the implementer

- **Why `_src`/`_tgt` became `src`/`tgt`:** the old `nativeTranslationCards` ignored its arguments (underscore-prefixed). Task 3 makes them meaningful. The caller (`ProviderSection.tsx:128`) already passes `localNative.sourceLanguage`/`targetLanguage`, so no caller change is needed.
- **No `resolve_translate` change:** opus rows have no FP8 variant; the existing `select_variant` + CPU-floor path handles a variant-less model. If `resolve_translate` raises for an opus id, check `select_variant`'s no-variant handling rather than special-casing opus.
- **Per-pair Helsinki repo existence** is assumed (all 13 were used in the field via the WASM provider's ONNX exports, which were converted from these Helsinki repos). If a download fails for a specific pair at runtime, that single pair's repo id needs verifying — it does not change the design.
- **`sentencepiece` runtime dep:** `MarianTokenizer` (loaded by `AutoTokenizer` for these repos) requires `sentencepiece` in the sidecar venv. The unit tests mock the tokenizer, so they won't catch its absence. Before a real session, verify it imports: `cd sidecar && python -c "import sentencepiece"`. If it fails, add `sentencepiece` to `sidecar/requirements.txt` (it is likely already a transitive dep of the existing translators, but confirm).
