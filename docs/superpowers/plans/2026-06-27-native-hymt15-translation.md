# Native HY-MT1.5 Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HY-MT1.5 (1.8B + 7B, each + FP8) to the native sidecar translation catalog with full HY-MT2 parity — a data-only feature reusing the `hunyuan_translate` backend.

**Architecture:** HY-MT1.5 shares HY-MT2's `hunyuan_v1_dense` arch, so no backend/gate/prompt change. Add 2 `_with_fp8(_llm_translate_row(...))` catalog rows, a `hy-mt15-*` download branch, and 2 renderer cards.

**Tech Stack:** Python (sidecar: transformers, pytest), TypeScript (renderer: nativeCatalog, vitest).

## Global Constraints

- Backend is the existing `hunyuan_translate` — **no new backend, gate, or prompt change**. HY-MT1.5 is fed HY-MT2's prompt by design.
- Catalog ids: `hy-mt15-1.8b`, `hy-mt15-7b` (drop the WASM `-translation` suffix; match the native HY-MT2 id convention).
- Repos (exact, verified — note Tencent's uppercase `HY`, unlike HY-MT2's `Hy`): `tencent/HY-MT1.5-1.8B`, `tencent/HY-MT1.5-1.8B-FP8`, `tencent/HY-MT1.5-7B`, `tencent/HY-MT1.5-7B-FP8`.
- Each row: `[gpu-cuda bfloat16, cpu float32]` + an FP8 `gpu-cuda` variant via `_with_fp8` (min_capability `(8, 9)`).
- Download spec for `hy-mt15-*` returns `{"repos": [...], "urls": []}` with **no `ignore` key** (these repos carry only weights/tokenizer/config — no `train/`/`imgs/`).
- Sort order: catalog `sort_order` 8/9 (after `hy-mt2-7b` = 7); renderer `sortOrder` 9/10 (after `hy-mt2-7b` = 8).
- Renderer card `selectId === downloadId ===` catalog id; `languages: ['multi']`.
- Sidecar test env: prefix pytest with `SOKUJI_BENCH_DIR=$(mktemp -d)`. The two `test_accel.py` gating tests (`voxtral_realtime`, `hunyuan_translate` installed-checks) fail under this worktree's older transformers — pre-existing, unrelated to this work.

---

### Task 1: Sidecar catalog rows + download mapping

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (2 rows after the `hy-mt2-7b` row)
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`hy-mt15-*` branch after the `hy-mt2` branch)
- Test: `sidecar/tests/test_catalog.py`, `sidecar/tests/test_native_models.py`, `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: existing `catalog._llm_translate_row(mid, name, repo, backend, sort_order, recommended=False)`, `catalog._with_fp8(row, fp8_repo)`, `native_models._base_specs`.
- Produces: `catalog.translate_model("hy-mt15-1.8b")` / `"hy-mt15-7b"` (backend `hunyuan_translate`, FP8 variant); `native_models.download_specs("hy-mt15-1.8b")` → `{"repos": ["tencent/HY-MT1.5-1.8B"], "urls": []}`.

- [ ] **Step 1: Write the failing catalog tests**

Append to `sidecar/tests/test_catalog.py`:

```python
def test_hymt15_translate_rows():
    from sokuji_sidecar import catalog
    for mid, repo in [("hy-mt15-1.8b", "tencent/HY-MT1.5-1.8B"),
                      ("hy-mt15-7b", "tencent/HY-MT1.5-7B")]:
        h = catalog.translate_model(mid)
        assert h is not None and all(d.backend == "hunyuan_translate" for d in h.deployments)
        assert h.deployments[0].artifact == repo
        gpu = next(d for d in h.deployments if d.tier == "gpu-cuda" and d.compute_type == "bfloat16")
        cpu = next(d for d in h.deployments if d.tier == "cpu")
        assert gpu.compute_type == "bfloat16" and cpu.compute_type == "float32"


def test_hymt15_has_fp8_variant():
    from sokuji_sidecar import catalog
    for mid, fp8_repo in [("hy-mt15-1.8b", "tencent/HY-MT1.5-1.8B-FP8"),
                          ("hy-mt15-7b", "tencent/HY-MT1.5-7B-FP8")]:
        m = catalog.translate_model(mid)
        fp8 = [d for d in m.deployments if d.compute_type == "fp8"]
        assert len(fp8) == 1
        assert fp8[0].tier == "gpu-cuda"
        assert fp8[0].backend == "hunyuan_translate"
        assert fp8[0].artifact == fp8_repo
        assert fp8[0].min_capability == (8, 9)
```

Append to `sidecar/tests/test_accel.py` (the resolve path depends on the catalog
rows added in Step 3, so it belongs with this step's RED→GREEN, not the download
step's):

```python
def test_resolve_translate_hymt15_prefers_gpu(monkeypatch):
    from sokuji_sidecar import accel
    monkeypatch.setattr(accel, "_format_ready", lambda ct: True)
    monkeypatch.setattr(accel, "_est_bytes", lambda d: 1 * 1024**3)  # 1 GiB, fits any GPU
    m = _machine(nvidia=(accel.Gpu("nvidia", "RTX 4070", 12288, (8, 9)),),
                 installed=frozenset({"hunyuan_translate"}))
    plans = accel.resolve_translate("hy-mt15-1.8b", "auto", m)
    assert plans[0].device == "cuda"
    assert plans[-1].device == "cpu"
    assert all(p.backend == "hunyuan_translate" for p in plans)
    assert plans[0].artifact.startswith("tencent/HY-MT1.5-1.8B")  # bf16 or FP8 variant
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_catalog.py -k hymt15 tests/test_accel.py::test_resolve_translate_hymt15_prefers_gpu -v`
Expected: FAIL — `translate_model` returns `None` / `resolve_translate` raises `unknown translate model: hy-mt15-1.8b`.

- [ ] **Step 3: Add the catalog rows**

In `sidecar/sokuji_sidecar/catalog.py`, in the `TRANSLATE_MODELS` list, insert immediately after the `hy-mt2-7b` row (the `_with_fp8(... "tencent/Hy-MT2-7B-FP8")` entry) and before the first `_opus_row(...)`:

```python
    _with_fp8(_llm_translate_row("hy-mt15-1.8b", "Hunyuan-MT1.5 1.8B",
                                 "tencent/HY-MT1.5-1.8B", "hunyuan_translate", 8),
              "tencent/HY-MT1.5-1.8B-FP8"),
    _with_fp8(_llm_translate_row("hy-mt15-7b", "Hunyuan-MT1.5 7B",
                                 "tencent/HY-MT1.5-7B", "hunyuan_translate", 9),
              "tencent/HY-MT1.5-7B-FP8"),
```

- [ ] **Step 4: Run the catalog + resolve tests to verify they pass**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_catalog.py -k hymt15 tests/test_accel.py::test_resolve_translate_hymt15_prefers_gpu -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Write the failing download-spec test**

Append to `sidecar/tests/test_native_models.py`:

```python
def test_download_specs_hymt15():
    from sokuji_sidecar import native_models as nm
    assert nm.download_specs("hy-mt15-1.8b") == {"repos": ["tencent/HY-MT1.5-1.8B"], "urls": []}
    assert nm.download_specs("hy-mt15-7b") == {"repos": ["tencent/HY-MT1.5-7B"], "urls": []}
    # clean repos → no ignore key
    assert "ignore" not in nm.download_specs("hy-mt15-1.8b")
    # FP8 variant download rides the repo-override path
    assert nm.download_specs("hy-mt15-7b", repo="tencent/HY-MT1.5-7B-FP8")["repos"] == ["tencent/HY-MT1.5-7B-FP8"]
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_native_models.py::test_download_specs_hymt15 -v`
Expected: FAIL — download falls through to `{"repos": ["hy-mt15-1.8b"], "urls": []}` (no `tencent/` prefix).

- [ ] **Step 7: Add the download branch**

In `sidecar/sokuji_sidecar/native_models.py`, in `_base_specs`, insert immediately after the `hy-mt2` branch (the `if model_id in ("hy-mt2-1.8b", "hy-mt2-7b"): ...` block) and before the `if model_id.startswith("opus-mt-"):` branch:

```python
    if model_id in ("hy-mt15-1.8b", "hy-mt15-7b"):
        # HY-MT1.5 repos carry only weights + tokenizer + config (no train/imgs).
        repo = "tencent/HY-MT1.5-1.8B" if model_id == "hy-mt15-1.8b" else "tencent/HY-MT1.5-7B"
        return {"repos": [repo], "urls": []}
```

- [ ] **Step 8: Run the download test to verify it passes**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_native_models.py::test_download_specs_hymt15 -v`
Expected: PASS.

- [ ] **Step 9: Run the full sidecar catalog/native_models suites for regressions**

Run: `cd sidecar && SOKUJI_BENCH_DIR=$(mktemp -d) python -m pytest tests/test_catalog.py tests/test_native_models.py -q`
Expected: all pass (no new failures).

- [ ] **Step 10: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_catalog.py sidecar/tests/test_native_models.py sidecar/tests/test_accel.py
git commit -m "feat(native): HY-MT1.5 catalog rows + download mapping (1.8B/7B, +FP8)"
```

---

### Task 2: Renderer cards

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (`NATIVE_TRANSLATION` + the `nativeTranslationCards` base list)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Consumes: the `NativeModelOption` / `NativeModelCardSpec` shapes already in the file.
- Produces: `NATIVE_TRANSLATION` and `nativeTranslationCards(...)` include `hy-mt15-1.8b` and `hy-mt15-7b` (ids match the Task 1 catalog ids).

- [ ] **Step 1: Update the two exact-match tests + add label assertions**

In `src/lib/local-inference/native/nativeCatalog.test.ts`:

Update the `nativeTranslationCards('zh', 'en')` exact-match assertion (the `toEqual([...])` ending in `'opus-mt-zh-en'`) to insert the two HY-MT1.5 ids before `opus-mt-zh-en`:

```javascript
    expect(ids).toEqual(['qwen2.5-0.5b', 'qwen3-0.6b', 'qwen3.5-0.8b', 'qwen3.5-2b', 'translategemma-4b', 'hy-mt2-1.8b', 'hy-mt2-7b', 'hy-mt15-1.8b', 'hy-mt15-7b', 'opus-mt-zh-en']);
```

Update the `NATIVE_TRANSLATION.map((m) => m.id)` exact-match assertion to append the two ids:

```javascript
    expect(NATIVE_TRANSLATION.map((m) => m.id)).toEqual(['qwen2.5-0.5b', 'qwen3-0.6b', 'qwen3.5-0.8b', 'qwen3.5-2b', 'translategemma-4b', 'hy-mt2-1.8b', 'hy-mt2-7b', 'hy-mt15-1.8b', 'hy-mt15-7b']);
```

Add a new `it(...)` inside the existing `describe('NATIVE_TRANSLATION new models', ...)` block:

```javascript
    it('exposes HY-MT1.5 1.8B + 7B as selectable multilingual cards', () => {
      const byId = Object.fromEntries(NATIVE_TRANSLATION.map((m) => [m.id, m]));
      expect(byId['hy-mt15-1.8b']?.label).toBe('Hunyuan-MT1.5 1.8B');
      expect(byId['hy-mt15-7b']?.label).toBe('Hunyuan-MT1.5 7B');
      expect(byId['hy-mt15-1.8b']?.languages).toEqual(['multi']);
      const cards = nativeTranslationCards('zh', 'en');
      const c = Object.fromEntries(cards.map((x) => [x.selectId, x]));
      expect(c['hy-mt15-1.8b']).toMatchObject({ selectId: 'hy-mt15-1.8b', downloadId: 'hy-mt15-1.8b' });
      expect(c['hy-mt15-7b']).toMatchObject({ selectId: 'hy-mt15-7b', downloadId: 'hy-mt15-7b' });
    });
```

- [ ] **Step 2: Run the renderer tests to verify they fail**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — `hy-mt15-*` absent from both lists.

- [ ] **Step 3: Add the cards to both lists**

In `src/lib/local-inference/native/nativeCatalog.ts`, in `NATIVE_TRANSLATION`, insert after the `hy-mt2-7b` entry:

```typescript
  { id: 'hy-mt15-1.8b', label: 'Hunyuan-MT1.5 1.8B', languages: ['multi'], sortOrder: 9 },
  { id: 'hy-mt15-7b', label: 'Hunyuan-MT1.5 7B', languages: ['multi'], sortOrder: 10 },
```

In the `nativeTranslationCards` function's `base` array, insert after the `hy-mt2-7b` entry:

```typescript
    { selectId: 'hy-mt15-1.8b', downloadId: 'hy-mt15-1.8b', name: 'Hunyuan-MT1.5 1.8B', languages: ['multi'], sortOrder: 9 },
    { selectId: 'hy-mt15-7b', downloadId: 'hy-mt15-7b', name: 'Hunyuan-MT1.5 7B', languages: ['multi'], sortOrder: 10 },
```

- [ ] **Step 4: Run the renderer tests to verify they pass**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS (all nativeCatalog tests, including the updated exact-match assertions and the new HY-MT1.5 block).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): HY-MT1.5 1.8B + 7B cards in the translation picker"
```

---

## Notes for the implementer

- **No backend/gate change:** HY-MT1.5 is `hunyuan_v1_dense` (same as HY-MT2), so `hunyuan_translate` and its `_installed` gate already cover it. Do not add a backend or gate entry.
- **FP8 needs no renderer work:** the variant picker derives variants from the catalog deployments added in Task 1, so FP8 surfaces automatically.
- **Repo casing:** `tencent/HY-MT1.5-*` (uppercase `HY`). HY-MT2 uses `tencent/Hy-MT2-*`. Don't normalize them to match.
