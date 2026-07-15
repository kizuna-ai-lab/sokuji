# accel.py Planner/Loader Split + Declarative Model Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the sidecar's 1187-line `accel.py` into a pure `planner.py` (deployment planning) + an effectful `accel.py` Loader, collapse its duplicated benchmark/quant logic, and replace imperative per-model special-casing with declarative catalog-card fields — all behaviour-preserving.

**Architecture:** `accel.py` today fuses six responsibilities (hardware probe, tier gating, quant selection ×~2.5, benchmark ×3, VRAM-gated load, RPC handlers). We extract the pure planning surface into `planner.py` so it is table-testable without monkeypatching; the effectful half (probe/download/load/measure) stays in `accel.py` as the Loader. Model-specific facts currently hard-coded as `if model_id == …` / substring branches become declarative fields on the catalog cards, threaded to backends via a new `Plan.config`. The sherpa-onnx uncatalogued-voice synthesis moves to `catalog.py`.

**Tech Stack:** Python 3, the sidecar package `sidecar/sokuji_sidecar/`, `pytest` (tests live beside the code, e.g. `sidecar/tests/test_accel.py`). Run the sidecar test suite with the sidecar's own runner (see Global Constraints).

## Global Constraints

- **Behaviour-preserving refactor.** Every task must keep the characterisation suite (Task 1) green. No change to what any model resolves to, downloads, or sends over the wire. The one deliberate non-change: TTS runtime capabilities (`sample_rate`/`STREAMING`/`CLONES`) stay read off the loaded backend object (site 4), NOT the card.
- **No wire-protocol / renderer changes.** This is entirely `sidecar/sokuji_sidecar/*.py`. Do not touch `src/` or the RPC envelope.
- **Local Inference (WASM) and Local Native (sidecar) are PEER providers** — do not introduce any cross-provider abstraction (see CONTEXT.md).
- **Preserve the deep islands verbatim:** the `load_with_fallback` proactive VRAM gate + honest-OOM policy (`accel.py:678-730`) stays in the Loader unchanged; `LlamaServerProc`, `asr_engine.run_stream`, `load_with_fallback` are not restructured.
- **Public planner API stays stable:** `resolve` / `resolve_translate` / `resolve_tts` keep their names and return types; callers switch from `accel.resolve*` to `planner.resolve*` but signatures are unchanged.
- **Test layout & runner:** sidecar tests live in `sidecar/tests/test_*.py` and import the package by name (`from sokuji_sidecar import accel`). Run from the `sidecar/` dir with the sidecar venv (`.venv`, created by `sidecar/setup.sh`; override via `SOKUJI_VENV`): `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -q` (adjust the file per task; whole suite = `.venv/bin/python -m pytest tests -q`). If `.venv` is absent, run `sidecar/setup.sh` first. There is no `pytest.ini`/`conftest.py`; pytest picks up `tests/` from the `sidecar/` CWD. New test files (`test_characterization.py`, `test_planner.py`) go in `sidecar/tests/`.

---

## File Structure

- `sidecar/sokuji_sidecar/planner.py` — **NEW.** Pure deployment planning: `resolve` / `resolve_translate` / `resolve_tts`, `_tier_available`, `_platform_ok`, `_tc_pick_quant`, `_llamacpp_variant_row`, `select_variant`, `_apply_bench`, `_quant_budget_bytes`, `_weight_factor`, the shared `_fit_walk` skeleton, and the TIER tables. No I/O.
- `sidecar/sokuji_sidecar/accel.py` — **BECOMES the Loader.** Keeps `probe`, `Machine`, `device_free_bytes`/`ram_free_bytes`, `_downloaded_quants`/`snapshot_download`/`_model_weight_bytes`, `bench_load`/`bench_save`, `load_with_fallback`/`load_measured`, `measure_*`, `_LEDGER`, the RPC handlers `_h_*` + `register`. Adds `Plan.config`. Imports planning functions from `planner`.
- `sidecar/sokuji_sidecar/catalog.py` — adds declarative fields (`download_ignore`, `disable_thinking`, `append_no_think`, `cuda_variant_subdir`) + `resolve_tts_card(id)` (the relocated sherpa synthesis).
- `sidecar/sokuji_sidecar/native_models.py` — `_base_specs` reads `card.download_ignore` instead of the two `if model_id ==` branches.
- `sidecar/sokuji_sidecar/translate_backends.py` — `LlamaCppQwenBackend` reads thinking flags from `Plan.config` instead of `self._ref` substring; `load()` gains an optional `config` param.
- `sidecar/sokuji_sidecar/tts_backends.py` — `Qwen3TtsOnnxBackend.load` reads `cuda_variant_subdir` from `config`; `load()` gains the optional `config` param.
- `sidecar/sokuji_sidecar/backends.py` — the shared backend `load()` signature gains the optional `config` param (base/interface).
- `sidecar/tests/test_characterization.py` — **NEW.** The behaviour safety net (Task 1).
- `sidecar/tests/test_planner.py` — **NEW.** Table-driven pure planner tests (Task 10).
- `sidecar/tests/test_accel.py` — pruned of the monkeypatch-heavy planner tests now covered purely (Task 10).

---

## Task 1: Characterisation safety net

**Files:**
- Create: `sidecar/tests/test_characterization.py`

**Interfaces:**
- Consumes (current, pre-refactor): `accel.resolve(model_id, override, machine=None)`, `accel.resolve_translate(...)`, `accel.resolve_tts(model_id, override, machine=None)`, `accel._tc_pick_quant`, `accel._llamacpp_variant_row`, `accel.select_variant`, `accel.Machine`.
- Produces: a frozen set of expected `Plan`/pick outputs later tasks must not change.

- [ ] **Step 1: Enumerate the matrix.** Read `accel.Machine` fields and `catalog.py` to list: (a) 3-4 `Machine` fixtures — `cpu_only`, `cuda_12gb`, `cuda_24gb`, `apple_silicon` — constructed directly (the planner surface accepts an explicit `machine=`, so NO monkeypatching of `probe` is needed); (b) a representative model id per domain (≥2 ASR e.g. `sense-voice`, a transcribe.cpp GGUF ASR; ≥2 translate incl. `qwen3-0.6b` and `qwen3.5-0.8b` and an Opus pair; ≥3 TTS incl. `moss-tts-nano`, `qwen3-tts-0.6b`, a carded sherpa `csukuangfj/vits-piper-en_US-amy-low`, and an UNcatalogued sherpa id e.g. `csukuangfj/vits-piper-en_US-ryan-medium`).

- [ ] **Step 2: Write the snapshot test.** For each (model, machine, override in {"auto","cpu"}) call the matching `accel.resolve*` and assert the returned `Plan` list equals a hard-coded expected list (backend/tier/device/compute_type/artifact/rank per plan). Do the same for direct `_tc_pick_quant` / `select_variant` / `_llamacpp_variant_row` calls across the machine fixtures with representative `downloaded` sets ({}, all-downloaded). Capture the ACTUAL current values by running once and pasting them in — these are the invariant, not aspirational values.

```python
# sidecar/tests/test_characterization.py  (shape; fill real values)
from sokuji_sidecar import accel

CUDA_12GB = accel.Machine(...)   # mirror probe() output for a 12GB CUDA box
# ... other fixtures ...

def test_resolve_tts_moss_cuda12():
    plans = accel.resolve_tts("moss-tts-nano", "auto", machine=CUDA_12GB)
    assert [(p.backend, p.tier, p.device, p.compute_type, p.artifact) for p in plans] == [
        # (... paste the ACTUAL output ...)
    ]
```

- [ ] **Step 3: Run it green against current code.**

Run: `cd sidecar && python -m pytest tests/test_characterization.py -q`
Expected: PASS (it encodes current behaviour).

- [ ] **Step 4: Commit.**

```bash
git add sidecar/tests/test_characterization.py
git commit -m "test(sidecar): characterisation snapshot of accel planner outputs"
```

**This suite is re-run after EVERY later task and must stay identical-green.** It is the correctness contract for the whole refactor.

---

## Task 2: Extract `planner.py` (pure move)

**Files:**
- Create: `sidecar/sokuji_sidecar/planner.py`
- Modify: `sidecar/sokuji_sidecar/accel.py` (remove the moved functions; import them back for its own internal use / re-expose is NOT needed — see below)
- Modify: `sidecar/sokuji_sidecar/asr_engine.py`, `translate_engine.py`, `tts_engine.py` (update `accel.resolve*` → `planner.resolve*`)

**Interfaces:**
- Produces: `planner.resolve(model_id, override, machine=None)`, `planner.resolve_translate(...)`, `planner.resolve_tts(model_id, override, machine=None)` (identical signatures/returns to today's `accel.*`), plus the pure helpers.
- Consumes: `planner` imports the Loader-owned inputs it needs (`accel.probe` is passed in as `machine`, so the Planner does NOT import `accel` for probing; `bench`/`downloaded` are passed as arguments — confirm no residual `accel.` call remains inside moved functions; if a moved function calls a Loader-only helper (`_model_weight_bytes`, `device_free_bytes`, `bench_load`, `_downloaded_quants`), that call site is the seam — the value must arrive as a parameter, matching how `resolve` already threads `bench`/`downloaded`).

- [ ] **Step 1: Move the pure functions verbatim** from `accel.py` into `planner.py`: `resolve`, `resolve_translate`, `resolve_tts`, `_resolve_model`, `_tier_available`, `_platform_ok`, `_tc_pick_quant`, `_llamacpp_variant_row`, `select_variant`, `_apply_bench`, `_quant_budget_bytes`, `_weight_factor`, and the module constants they use (`TIER_RANK`, `TIER_DEVICE`, `_TC_*`, `_LLAMA_*`, `_VARIANT_QUALITY`, `_VARIANT_WEIGHT_FACTOR`, `_is_llamacpp`, `_format_ready` if pure). Move `Plan` (the dataclass) to `planner.py` too (it is the Planner's output type) and have `accel.py` import it.

- [ ] **Step 2: Resolve the I/O seams.** Any moved function that still calls a Loader-only effectful helper must instead receive that value as an argument. `resolve`/`resolve_translate` already accept `bench`/`downloaded`; verify `resolve_tts` and `_resolve_model` do too, and lift any lingering `bench_load()` / `_downloaded_quants()` / `_model_weight_bytes()` call up to the Loader caller. (`resolve_tts`'s sherpa synthesis is handled in Task 9 — leave it calling `catalog` for now.)

- [ ] **Step 3: Rewire imports.** `accel.py`: `from .planner import Plan, resolve, resolve_translate, resolve_tts` where the Loader (`load_measured`, `_h_*`) still needs them internally. Update the three engines' `accel.resolve*(...)` call sites to `planner.resolve*(...)` (add `from . import planner`). Grep to confirm: `grep -rn "accel\.resolve" sidecar/sokuji_sidecar` returns only intended re-exports.

- [ ] **Step 4: Run characterisation + sidecar suite.**

Run: `cd sidecar && python -m pytest tests/test_characterization.py tests/test_accel.py -q`
Expected: PASS (pure move; outputs unchanged).

- [ ] **Step 5: Commit.**

```bash
git add sidecar/sokuji_sidecar/planner.py sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/asr_engine.py sidecar/sokuji_sidecar/translate_engine.py sidecar/sokuji_sidecar/tts_engine.py
git commit -m "refactor(sidecar): extract pure planner.py from accel.py"
```

---

## Task 3: Collapse `measure_*` ×3

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`measure_rtf`/`measure_tps`/`measure_rtf_tts`)
- Test: `sidecar/tests/test_accel.py` (existing measure tests must stay green)

**Interfaces:**
- Produces: unchanged public `measure_rtf(backend, plan, model_id, machine, *, force=False)`, `measure_tps(...)`, `measure_rtf_tts(...)` — same names/signatures/return semantics; internally delegating to one `_measure`.

- [ ] **Step 1: Add the shared skeleton.**

```python
def _measure(backend, plan, model_id, machine, *, ns, run, force=False):
    """Cache-by-bench-key benchmark skeleton. `ns` namespaces the key
    (""/"tps:"/"tts:"); `run(backend)` performs the driver + metric and
    returns a float, or None to skip caching. Never raises (returns None)."""
    try:
        key = ns + _bench_key(machine.fingerprint, model_id, plan.backend, plan.device, plan.compute_type)
        cache = bench_load()
        if not force and key in cache:
            return cache[key]
        val = run(backend)
        if val is None:
            return None
        cache[key] = val
        bench_save(cache)
        return val
    except Exception:
        return None
```

- [ ] **Step 2: Rewrite the three as thin wrappers** whose `run` closures hold ONLY the driver + metric that differs (clip+transcribe+elapsed/BENCH_SECONDS for rtf; warmup+translate+n_new/dt for tps; generate+(gen_ms/1000)/audio_s for tts). Keep the `None`-guards inside each `run` (tps: `dt<=0 or n_new<=0`; tts: `audio_s<=0`). The `ns` values are `""`, `"tps:"`, `"tts:"` exactly.

- [ ] **Step 3: Run.**

Run: `cd sidecar && python -m pytest tests/test_characterization.py tests/test_accel.py -k "measure or bench" -q`
Expected: PASS (same keys, same values).

- [ ] **Step 4: Commit.**

```bash
git commit -am "refactor(sidecar): collapse measure_rtf/tps/rtf_tts into one skeleton"
```

---

## Task 4: Extract the quant-picker `_fit_walk` skeleton

**Files:**
- Modify: `sidecar/sokuji_sidecar/planner.py` (`_tc_pick_quant`, `_llamacpp_variant_row`, `select_variant`)

**Interfaces:**
- Produces: a shared `_fit_walk(candidates, *, budget, downloaded, gpu_possible)` that encodes the common nucleus — restrict to `downloaded` (when non-empty), apply the gpu guard, walk size-descending and return the largest candidate fully resident within `budget` (or the fallback per the caller). Each picker keeps its OWN size-map construction (with its own resident constant `_TC_RESIDENT_FACTOR` / `_LLAMA_RESIDENT_FACTOR` / fp8→1.5) and its OWN tail (ASR curated-vs-all rungs; llamacpp Apple-Silicon-unified + `_LLAMA_MIN_FIT_FRACTION`; select_variant's `_VARIANT_QUALITY` tie-break and non-llamacpp budget formula).

- [ ] **Step 1: Read the three pickers** (`planner.py`: `_tc_pick_quant`, `_llamacpp_variant_row`, `select_variant`) and identify the exact shared lines (the downloaded-restriction block, the `gpu_possible` guard, the descending fit-walk). Confirm the resident factor is applied in each caller's size-map (NOT the walk) so it need not be a `_fit_walk` parameter beyond the pre-sized candidates.

- [ ] **Step 2: Write a failing micro-test** for `_fit_walk` alone (table-driven): given a sized candidate list + budget + downloaded filter + gpu flag, assert it returns the expected pick, including the "nothing fits" case. Run to confirm it fails (helper not defined).

Run: `cd sidecar && python -m pytest tests/test_planner.py -k fit_walk -q` → FAIL.

- [ ] **Step 3: Implement `_fit_walk`** and refactor each picker to build its sized candidates + call `_fit_walk`, then apply its distinct tail. Do NOT merge the tails.

- [ ] **Step 4: Run characterisation + planner + accel suites.**

Run: `cd sidecar && python -m pytest tests/test_characterization.py tests/test_planner.py tests/test_accel.py -q`
Expected: PASS — **characterisation is the guard that all three pickers still return identical picks.**

- [ ] **Step 5: Commit.**

```bash
git commit -am "refactor(sidecar): extract shared _fit_walk from the three quant pickers"
```

---

## Task 5: Card fields + `Plan.config` + `load()` config plumbing (inert)

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (add fields + populate rows)
- Modify: `sidecar/sokuji_sidecar/planner.py` (`Plan` gains `config`; the Planner fills it from the card)
- Modify: `sidecar/sokuji_sidecar/backends.py`, `translate_backends.py`, `tts_backends.py` (backend `load()` gains optional `config=None`; accepted, not yet read)
- Modify: `sidecar/sokuji_sidecar/accel.py` (`load_measured` passes `plan.config` to `backend.load`)

**Interfaces:**
- Produces: `catalog._ModelBase.download_ignore: tuple[str, ...] = ()`; `catalog.TranslateModel.disable_thinking: bool = False`, `append_no_think: bool = False`; `catalog.TtsModel.cuda_variant_subdir: str | None = None`. `planner.Plan.config: PlanConfig` (a small frozen dataclass carrying `variant_subdir`, `disable_thinking`, `append_no_think`; default all-inert). Backend `load(self, model_ref, device, compute_type, config=None)`.
- **This whole task is behaviour-inert:** fields are added and populated but nothing READS them yet (reads land in Tasks 6-8). Characterisation stays green because no output changes.

- [ ] **Step 1: Add the card fields** to `_ModelBase` / `TranslateModel` / `TtsModel` (keyword defaults per the docstring at `catalog.py:30-32` — safe for all call sites). Populate the affected rows to MATCH current behaviour exactly: `supertonic-3` → `download_ignore=("audio_samples/*","img/*")`; `csukuangfj/vits-zh-aishell3` → `download_ignore=("G_AISHELL.pth","rule.far","vits-aishell3.int8.onnx")`; `qwen3-0.6b` → `disable_thinking=True, append_no_think=True`; `qwen3.5-0.8b`/`qwen3.5-2b` → `disable_thinking=True`; `qwen3-tts-0.6b`/`qwen3-tts-1.7b` → `cuda_variant_subdir="onnx-bf16"`.

- [ ] **Step 2: Add `PlanConfig` + `Plan.config`** in `planner.py` (frozen dataclass, all fields defaulting inert). In the Planner, populate `Plan.config` from the resolved card (thinking flags from `TranslateModel`, `variant_subdir` from `TtsModel`). Default `PlanConfig()` when the card has no such fields.

- [ ] **Step 3: Thread `config` through `load()`.** Add `config=None` to the shared backend `load` signature (`backends.py` base + every subclass in `translate_backends.py`/`tts_backends.py`/others — mechanical). Update `accel.load_measured` to call `backend.load(plan.artifact, plan.device, plan.compute_type, plan.config)`. No backend reads `config` yet.

- [ ] **Step 4: Run full sidecar suite + characterisation.**

Run: `cd sidecar && python -m pytest tests -q`
Expected: PASS (inert addition).

- [ ] **Step 5: Commit.**

```bash
git commit -am "feat(sidecar): declarative card fields + Plan.config plumbing (inert)"
```

---

## Task 6: Migrate `download_ignore` read

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`_base_specs`)
- Test: `sidecar/tests/test_native_models.py` (or wherever `_base_specs` is tested)

**Interfaces:**
- Consumes: `card.download_ignore` (Task 5). `_base_specs` already holds the card (`_tm = tts_model(model_id)`).

- [ ] **Step 1: Write/adjust a failing test** asserting `_base_specs("supertonic-3")["ignore"] == ["audio_samples/*", "img/*"]` and the vits-zh-aishell3 case, driven by the card field (not the hard-coded branch).

- [ ] **Step 2: Replace the two `if model_id == …: spec["ignore"] = [...]` branches** with `if _tm.download_ignore: spec["ignore"] = list(_tm.download_ignore)`.

- [ ] **Step 3: Run.**

Run: `cd sidecar && python -m pytest tests/test_native_models.py tests/test_characterization.py -q`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git commit -am "refactor(sidecar): read download_ignore from the card, not model-id branches"
```

---

## Task 7: Migrate qwen3.5 thinking read

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_backends.py` (`_LlamaCppBase.load` stores `config`; `LlamaCppQwenBackend._payload` reads it)
- Test: `sidecar/tests/test_translate_backends.py`

**Interfaces:**
- Consumes: `config.disable_thinking`, `config.append_no_think` (Task 5).

- [ ] **Step 1: Failing test.** With a `LlamaCppQwenBackend` whose stored config has `disable_thinking=True, append_no_think=True` (qwen3-0.6b), assert `_payload(...)` sets `chat_template_kwargs={"enable_thinking": False}` AND appends `/no_think`; with `disable_thinking=True, append_no_think=False` (qwen3.5), assert `enable_thinking:False` set and NO `/no_think`. Cover the plain-model case (both False) → neither.

- [ ] **Step 2: Store config at load.** In `_LlamaCppBase.load`, set `self._config = config or PlanConfig()` (import `PlanConfig` from `planner`). In `LlamaCppQwenBackend._payload`, replace the `ref = self._ref.lower(); if "qwen3.5" in ref or "qwen3-" in ref …` block with reads of `self._config.disable_thinking` / `self._config.append_no_think`.

- [ ] **Step 3: Run.**

Run: `cd sidecar && python -m pytest tests/test_translate_backends.py tests/test_characterization.py -q`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git commit -am "refactor(sidecar): drive qwen thinking mode from Plan.config, not the .5 substring"
```

---

## Task 8: Migrate onnx-bf16 read

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_backends.py` (`Qwen3TtsOnnxBackend.load`)
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_model_weight_bytes` gains a `variant_subdir` param, sourced by its caller from `plan.config`)
- Test: `sidecar/tests/test_tts_backends.py`, `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `config.variant_subdir` (Task 5).

- [ ] **Step 1: Failing tests.** (a) `Qwen3TtsOnnxBackend.load` with `config.variant_subdir="onnx-bf16"` + device `cuda` + an existing `onnx-bf16/` dir → `variant_dir` points at it; with device `cpu` or `config.variant_subdir=None` → `variant_dir is None`. (b) `_model_weight_bytes(path, variant_subdir="onnx-bf16")` de-dupes the same-named fp32 graphs; `_model_weight_bytes(path, variant_subdir=None)` counts everything.

- [ ] **Step 2: Replace the hard-coded `"onnx-bf16"`** at both sites with the passed value. In `Qwen3TtsOnnxBackend.load`, use `self._config.variant_subdir` (set from `config` like Task 7). In `_model_weight_bytes`, add a `variant_subdir: str | None = None` param and have `load_measured` pass `plan.config.variant_subdir` (llamacpp/non-onnx plans pass `None`). Keep the `device == "cuda"` gate in the backend.

- [ ] **Step 3: Run.**

Run: `cd sidecar && python -m pytest tests/test_tts_backends.py tests/test_accel.py tests/test_characterization.py -q`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git commit -am "refactor(sidecar): read onnx-bf16 variant subdir from the card, kill cross-file dup"
```

---

## Task 9: Relocate the sherpa synthesis to `catalog.py`

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (add `resolve_tts_card(model_id)` + move `_SHERPA_TTS_HINTS`)
- Modify: `sidecar/sokuji_sidecar/planner.py` (`resolve_tts` calls `catalog.resolve_tts_card`, drops the synthesis + `_SHERPA_TTS_HINTS`)
- Test: `sidecar/tests/test_catalog.py`

**Interfaces:**
- Produces: `catalog.resolve_tts_card(model_id) -> TtsModel | None` — returns the static card, else a synthesised ad-hoc `TtsModel` for ids matching `_SHERPA_TTS_HINTS`, else `None`.

- [ ] **Step 1: Failing test.** `catalog.resolve_tts_card("moss-tts-nano")` returns the static card; `catalog.resolve_tts_card("csukuangfj/vits-piper-xx-yy")` returns a synthesised `TtsModel` with the same fields the current `accel.resolve_tts` synthesis produces (`sherpa_tts` cpu deployment, `repos=(id,)`, `sample_rate=16000`); an unknown non-sherpa id returns `None`.

- [ ] **Step 2: Move** `_SHERPA_TTS_HINTS` and the synthesis block from `planner.resolve_tts` (originally `accel.py:502-513`) into `catalog.resolve_tts_card` (place it next to `_sherpa_tts_row`). `planner.resolve_tts` becomes: `model = catalog.resolve_tts_card(model_id); if model is None: raise ValueError(...); return _resolve_model(model, model_id, override, machine or ...)`.

- [ ] **Step 3: Run characterisation** (its UNcatalogued-sherpa fixture from Task 1 is the guard that synthesis is byte-identical after the move).

Run: `cd sidecar && python -m pytest tests/test_catalog.py tests/test_characterization.py -q`
Expected: PASS. Then `grep -rn "_SHERPA_TTS_HINTS\|onnx-bf16\|qwen3\.5\" in\|qwen3-\" in" sidecar/sokuji_sidecar/planner.py sidecar/sokuji_sidecar/accel.py` → no model-string special-casing remains in planner/accel.

- [ ] **Step 4: Commit.**

```bash
git commit -am "refactor(sidecar): move sherpa uncatalogued-voice synthesis into catalog.resolve_tts_card"
```

---

## Task 10: Table-driven planner tests + prune redundant monkeypatch tests

**Files:**
- Create/extend: `sidecar/tests/test_planner.py`
- Modify: `sidecar/tests/test_accel.py` (remove planner tests now covered purely; keep Loader tests)

**Interfaces:**
- Consumes: `planner.resolve*` / `_tc_pick_quant` / `select_variant` / `_llamacpp_variant_row` / `_fit_walk` — all pure, called with explicit `Machine` fixtures and no monkeypatching.

- [ ] **Step 1: Write table-driven planner tests** in `test_planner.py`: parametrised over `(model, machine, downloaded, expected_plan_or_pick)` using constructed `Machine` fixtures. These replace the monkeypatch-heavy planning cases in `test_accel.py`. Cover the branches the old tests covered (tier gating, quant selection, downloaded restriction, gpu guard, the three picker tails).

- [ ] **Step 2: Prune `test_accel.py`.** Remove the planning tests that constructed a `Machine` + injected `FakeBackend`s solely to exercise `resolve`/pick (now in `test_planner.py`). KEEP the genuinely-effectful Loader tests (`load_with_fallback`/`load_measured`/`measure_*`/probe/ledger). Record the before/after `monkeypatch` count in the commit body.

- [ ] **Step 3: Run the whole sidecar suite + characterisation.**

Run: `cd sidecar && python -m pytest tests -q`
Expected: PASS. Confirm coverage of the planner did not drop (the table tests must exercise every branch the pruned tests did).

- [ ] **Step 4: Commit.**

```bash
git commit -am "test(sidecar): table-driven planner tests; prune redundant monkeypatch planning tests"
```

---

## Self-Review

- **Spec coverage:** module split (Tasks 2), measure DRY (3), quant DRY (4), card pipeline incl. all three sites — download_ignore (6), qwen3.5 (7), onnx-bf16 (8) — sherpa relocation (9), test rework (10), all under the characterisation net (1). site 4 (tts reflection) deliberately untouched — no task changes `tts_engine.py:50-54`.
- **Behaviour preservation:** every task re-runs `test_characterization.py`; Tasks 5-8 are structured so the data addition (5) precedes each read-migration (6-8), each byte-identical to the branch it replaces.
- **Type/name consistency:** `Plan.config: PlanConfig` defined in Task 5 is consumed by Tasks 7 (`disable_thinking`/`append_no_think`) and 8 (`variant_subdir`); `resolve_tts_card` defined in Task 9 is consumed by `planner.resolve_tts`. `load(self, model_ref, device, compute_type, config=None)` is the uniform signature from Task 5 onward.
- **Deep islands:** `load_with_fallback` / VRAM gate stay verbatim in the Loader; `_fit_walk` (Task 4) touches only the shared nucleus, not the three tails.
