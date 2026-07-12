# Native Resolved Memory & Degrade Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a native session starts, show which stage ran on which device (and *why*, on a degrade) plus the real VRAM/RAM it consumed — in the existing estimate area + model cards.

**Architecture:** Measure each model's footprint as a load-time delta (reserved-VRAM delta for cuda, RSS delta for cpu) in a shared `accel.load_measured` helper; carry `memoryBytes` + the gate `notice` (as `fallbackReason`) through the existing `ReadyMsg → client → resolved store` pipe; render via pure helpers in `nativeCatalog.ts`.

**Tech Stack:** Python sidecar (pytest), React/TypeScript renderer (vitest), Zustand store.

## Global Constraints

- All memory measurement is **best-effort**: `None` or non-positive → omit `memoryBytes`. **Never show a negative or zero memory number.**
- One `memoryBytes` field on the wire, interpreted as VRAM vs RAM by the existing `device` field. No separate `vramBytes`/`ramBytes`.
- Degrade signal: `device === 'cpu' && fallbackReason` (a non-null `notice` from `load_with_fallback`). No separate requested-vs-resolved comparison.
- Reuse the existing `model-ok` (`#10a37f`) / `model-warn` color semantics already used by the TTS chip in `NativeModelManagementSection`. No new design tokens.
- TTS is **not** measured (no `resolved` entry); excluded from the actual readout.
- English-only comments. Conventional-commit messages. No `psutil` dependency.

---

### Task 1: `accel.load_measured` + `_rss_bytes`

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (add after `load_with_fallback`, near the `_cuda_free_bytes` helpers ~line 218)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: existing `load_with_fallback(plans) -> (backend, plan, notice)`, `_cuda_free_bytes() -> int|None`.
- Produces:
  - `_rss_bytes() -> int | None`
  - `load_measured(plans) -> tuple[backend, plan, notice, memory_bytes: int | None]`

- [ ] **Step 1: Write the failing tests**

Add to `sidecar/tests/test_accel.py` (after the existing `test_gpu_only_oom_raises_honest_vram_message`):

```python
def test_load_measured_reports_vram_delta_for_cuda(monkeypatch):
    free = iter([10 * _GIB, 2 * _GIB])  # before, after -> 8 GiB used
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: next(free))
    monkeypatch.setattr(accel, "_rss_bytes", lambda: 1000)
    monkeypatch.setattr(accel, "load_with_fallback",
                        lambda plans: ("BE", _plan("cuda"), None))
    backend, plan, notice, mem = accel.load_measured([_plan("cuda")])
    assert backend == "BE" and plan.device == "cuda" and notice is None
    assert mem == 8 * _GIB


def test_load_measured_reports_rss_delta_for_cpu(monkeypatch):
    rss = iter([1000 * _GIB // 1000, 1400 * _GIB // 1000])  # +400/1000 GiB
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: None)
    monkeypatch.setattr(accel, "_rss_bytes", lambda: next(rss))
    monkeypatch.setattr(accel, "load_with_fallback",
                        lambda plans: ("BE", _plan("cpu"), "cuda skipped; using CPU"))
    _b, plan, notice, mem = accel.load_measured([_plan("cpu")])
    assert plan.device == "cpu" and notice == "cuda skipped; using CPU"
    assert mem == 400 * _GIB // 1000


def test_load_measured_omits_memory_when_unmeasurable(monkeypatch):
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: None)
    monkeypatch.setattr(accel, "_rss_bytes", lambda: None)
    monkeypatch.setattr(accel, "load_with_fallback",
                        lambda plans: ("BE", _plan("cuda"), None))
    _b, _p, _n, mem = accel.load_measured([_plan("cuda")])
    assert mem is None


def test_load_measured_omits_nonpositive_delta(monkeypatch):
    free = iter([2 * _GIB, 3 * _GIB])  # "after" higher than "before" -> delta < 0
    monkeypatch.setattr(accel, "_cuda_free_bytes", lambda: next(free))
    monkeypatch.setattr(accel, "load_with_fallback",
                        lambda plans: ("BE", _plan("cuda"), None))
    _b, _p, _n, mem = accel.load_measured([_plan("cuda")])
    assert mem is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -k load_measured -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'load_measured'`

- [ ] **Step 3: Implement `_rss_bytes` and `load_measured`**

In `sidecar/sokuji_sidecar/accel.py`, add immediately after the `load_with_fallback` function:

```python
def _rss_bytes():
    """Best-effort resident set size of this process, in bytes. Linux reads
    /proc/self/status (VmRSS, KiB); other platforms fall back to
    resource.getrusage (ru_maxrss: KiB on Linux, bytes on macOS). None on
    failure, so the memory readout degrades to 'unknown' rather than guessing."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except Exception:
        pass
    try:
        import resource
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return rss if platform.system() == "Darwin" else rss * 1024
    except Exception:
        return None


def load_measured(plans: list):
    """load_with_fallback + measure the loaded model's footprint on its RESOLVED
    device: reserved-VRAM delta for cuda, RSS delta for cpu. Best-effort — memory
    is None when unmeasurable or non-positive (e.g. no CUDA, allocator noise, a
    failed-then-freed GPU attempt during a degrade). Returns
    (backend, plan, notice, memory_bytes)."""
    vram_before = _cuda_free_bytes()
    rss_before = _rss_bytes()
    backend, plan, notice = load_with_fallback(plans)
    memory = None
    if plan.device == "cuda" and vram_before is not None:
        vram_after = _cuda_free_bytes()
        if vram_after is not None:
            delta = vram_before - vram_after
            memory = delta if delta > 0 else None
    elif plan.device == "cpu" and rss_before is not None:
        rss_after = _rss_bytes()
        if rss_after is not None:
            delta = rss_after - rss_before
            memory = delta if delta > 0 else None
    return backend, plan, notice, memory
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -q`
Expected: PASS (all accel tests, including the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(native): add load_measured for per-model device memory footprint"
```

---

### Task 2: Translate engine — carry memory + fallback reason

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_engine.py:27-33` (the `load_with_fallback` call + resolved build)
- Test: `sidecar/tests/test_translate_engine.py:54-70` (two existing patches) + new test

**Interfaces:**
- Consumes: `accel.load_measured(plans) -> (backend, plan, notice, memory_bytes)` (Task 1).
- Produces: `TranslateEngine.resolved` may now contain `memoryBytes: int` and `fallbackReason: str`. These flow to the wire unchanged via the existing `reply.update(resolved)` at `translate_engine.py:68`.

- [ ] **Step 1: Update the two existing tests that patch `load_with_fallback`**

In `sidecar/tests/test_translate_engine.py`, change the patches in `test_init_uses_resolver_and_sets_resolved` (line ~58) and `test_close_unloads_prior_backend_before_reinit` (line ~78) from `load_with_fallback` to `load_measured` returning the 4-tuple:

```python
# in test_init_uses_resolver_and_sets_resolved:
    monkeypatch.setattr(accel, "load_measured", lambda plans: (fake_backend, fake_plan, None, None))

# in test_close_unloads_prior_backend_before_reinit:
    backends_iter = iter([(first, plan, None, None), (second, plan, None, None)])
    monkeypatch.setattr(accel, "load_measured", lambda plans: next(backends_iter))
```

(Leave the `resolve_translate` / `measure_tps` patches as-is.)

- [ ] **Step 2: Write the new failing test**

Add to `sidecar/tests/test_translate_engine.py`:

```python
def test_init_stores_memory_and_fallback_reason(monkeypatch):
    from sokuji_sidecar import accel
    from unittest.mock import MagicMock
    fake_plan = MagicMock(backend="qwen_translate", device="cpu", compute_type="float32")
    monkeypatch.setattr(accel, "resolve_translate", lambda mid, override=None: ["plan"])
    monkeypatch.setattr(accel, "load_measured",
                        lambda plans: (MagicMock(), fake_plan, "cuda skipped (needs ~6.1 GiB, 2.1 GiB free); using CPU", 4_200_000_000))
    monkeypatch.setattr(accel, "measure_tps", lambda *a, **k: None)
    eng = translate_engine.TranslateEngine()
    eng.init(model_id="qwen3.5-2b", source_lang="ja", target_lang="en")
    assert eng.resolved["memoryBytes"] == 4_200_000_000
    assert "using CPU" in eng.resolved["fallbackReason"]
```

- [ ] **Step 3: Run the new test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_translate_engine.py -k memory_and_fallback -q`
Expected: FAIL — `KeyError: 'memoryBytes'` (engine still calls `load_with_fallback`, doesn't store memory).

- [ ] **Step 4: Implement**

In `sidecar/sokuji_sidecar/translate_engine.py`, replace lines 27-33:

```python
        self._backend, plan, notice, mem = accel.load_measured(plans)
        tps = accel.measure_tps(self._backend, plan, model_id or "qwen2.5-0.5b", accel.probe())
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        if tps is not None:
            self.resolved["tokensPerSec"] = round(tps, 1)
        if mem is not None:
            self.resolved["memoryBytes"] = mem
        if notice:
            self.resolved["fallbackReason"] = notice
```

- [ ] **Step 5: Run the translate-engine suite to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_translate_engine.py -q`
Expected: PASS (existing + new).

- [ ] **Step 6: Commit**

```bash
git add sidecar/sokuji_sidecar/translate_engine.py sidecar/tests/test_translate_engine.py
git commit -m "feat(native): translate engine reports memoryBytes + fallbackReason"
```

---

### Task 3: ASR engine — carry memory + fallback reason (offline + streaming)

**Files:**
- Modify: `sidecar/sokuji_sidecar/asr_engine.py:96-102` (offline `init`), `:408-412` (`_resolve_streaming_backend`), `:184` (`init_streaming` resolved build)
- Test: `sidecar/tests/test_asr_engine.py` (offline patches ~124/207/220/274, streaming helper ~368) + new tests

**Interfaces:**
- Consumes: `accel.load_measured(plans) -> (backend, plan, notice, memory_bytes)` (Task 1).
- Produces: `AsrEngine.resolved` may contain `memoryBytes` + `fallbackReason`; **streaming `init_streaming` now sets `self.resolved`** (previously it didn't, so streaming ASR reported no device). Flows to wire via `reply.update(resolved)` at `asr_engine.py:472-473`.

- [ ] **Step 1: Update existing tests to patch `load_measured` and the streaming helper**

In `sidecar/tests/test_asr_engine.py`, change every `monkeypatch.setattr(accel, "load_with_fallback", ...)` to `load_measured` with a 4-tuple:

```python
# test_engine_init_uses_resolver (~131):
    monkeypatch.setattr(accel, "load_measured", lambda plans: (_FakeBackend(), fake_plan, None, None))
# test_engine_init_measures_and_stores_rtf (~207):
    monkeypatch.setattr(accel, "load_measured", lambda plans: (_FakeBackend(), fake_plan, None, None))
# test_engine_init_omits_rtf_when_benchmark_returns_none (~220):
    monkeypatch.setattr(accel, "load_measured", lambda plans: (_FakeBackend(), fake_plan, None, None))
# test_engine_frees_old_model_on_reinit_and_close (~274) — adapt fake_load to 4-tuple:
    def fake_load(plans):
        return next(backends_iter)  # each item is (backend, plan, None, None)
    monkeypatch.setattr(accel, "load_measured", fake_load)
```

For `test_engine_frees_old_model_on_reinit_and_close`, also update its `backends_iter` items to 4-tuples (append `, None`).

In the `_streaming_engine` helper (~line 368), make the patched resolver return the 4-tuple:

```python
    fake_plan = type("P", (), {"backend": "voxtral_realtime",
                               "device": "cuda", "compute_type": "bfloat16"})()
    monkeypatch.setattr(eng, "_resolve_streaming_backend",
                        lambda model, device: (backend, fake_plan, None, None))
```

- [ ] **Step 2: Write the new failing tests**

Add to `sidecar/tests/test_asr_engine.py`:

```python
def test_offline_init_stores_memory_and_fallback_reason(monkeypatch):
    from sokuji_sidecar import accel, asr_engine
    fake_plan = type("P", (), {"backend": "ctranslate2", "device": "cpu", "compute_type": "int8"})()
    monkeypatch.setattr(accel, "resolve", lambda mid, override=None: ["plan"])
    monkeypatch.setattr(accel, "load_measured",
                        lambda plans: (_FakeBackend(), fake_plan, "cuda skipped; using CPU", 4_200_000_000))
    monkeypatch.setattr(accel, "measure_rtf", lambda *a, **k: None)
    eng = asr_engine.AsrEngine()
    eng.init("sense-voice", "en", 16000, None, None, None, "auto")
    assert eng.resolved["memoryBytes"] == 4_200_000_000
    assert "using CPU" in eng.resolved["fallbackReason"]


def test_streaming_init_sets_resolved_device_and_memory(monkeypatch):
    from sokuji_sidecar import asr_engine
    eng = asr_engine.AsrEngine()
    backend = type("B", (), {"STREAMING": True, "open_stream": lambda self: object(),
                             "unload": lambda self: None})()
    fake_plan = type("P", (), {"backend": "voxtral_realtime", "device": "cuda", "compute_type": "bfloat16"})()
    monkeypatch.setattr(eng, "_resolve_streaming_backend",
                        lambda model, device: (backend, fake_plan, None, 8_000_000_000))
    monkeypatch.setattr(eng, "_init_vad", lambda *a, **k: None)
    eng.init_streaming(model_id="voxtral-mini-4b-realtime", language="en", device="auto")
    assert eng.resolved["device"] == "cuda"
    assert eng.resolved["memoryBytes"] == 8_000_000_000
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -k "stores_memory or streaming_init_sets_resolved" -q`
Expected: FAIL — offline `KeyError: 'memoryBytes'`; streaming `AttributeError`/`None` (`resolved` never set, and `_resolve_streaming_backend` returns a bare backend).

- [ ] **Step 4: Implement — offline `init`**

In `sidecar/sokuji_sidecar/asr_engine.py`, replace line 96 and extend the resolved build (96-102):

```python
        self._backend, plan, notice, mem = accel.load_measured(plans)
        self._language = language or None
        rtf = accel.measure_rtf(self._backend, plan, model_id or "sense-voice", accel.probe())
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        if rtf is not None:
            self.resolved["rtf"] = round(rtf, 3)
        if mem is not None:
            self.resolved["memoryBytes"] = mem
        if notice:
            self.resolved["fallbackReason"] = notice
```

- [ ] **Step 5: Implement — streaming path**

Replace `_resolve_streaming_backend` (lines 408-412):

```python
    def _resolve_streaming_backend(self, model_id, device):
        from . import accel
        plans = accel.resolve(model_id or "voxtral-mini-4b-realtime", override=device or "auto")
        return accel.load_measured(plans)   # (backend, plan, notice, memory_bytes)
```

And in `init_streaming`, replace line 184 (`self._backend = self._resolve_streaming_backend(model_id, device)`) with:

```python
        self._backend, plan, notice, mem = self._resolve_streaming_backend(model_id, device)
        self.resolved = {"backend": plan.backend, "device": plan.device,
                         "computeType": plan.compute_type}
        if mem is not None:
            self.resolved["memoryBytes"] = mem
        if notice:
            self.resolved["fallbackReason"] = notice
```

- [ ] **Step 6: Run the asr-engine suite to verify pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_asr_engine.py -q`
Expected: PASS (existing + 2 new; real-GPU tests still skip without a GPU).

- [ ] **Step 7: Commit**

```bash
git add sidecar/sokuji_sidecar/asr_engine.py sidecar/tests/test_asr_engine.py
git commit -m "feat(native): ASR engine reports memoryBytes + fallbackReason (incl. streaming resolved)"
```

---

### Task 4: Wire `memoryBytes` through the protocol + native clients

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts:2-5` (`ReadyMsg`)
- Modify: `src/lib/local-inference/native/NativeAsrClient.ts:69-78` (init return)
- Modify: `src/lib/local-inference/native/NativeTranslateClient.ts:56-62` (init return)
- Test: existing client tests must still pass (no new test — it's pure passthrough typing).

**Interfaces:**
- Consumes: `ReadyMsg` carries `memoryBytes?: number` and `fallbackReason?: string` (the latter already declared).
- Produces:
  - `NativeAsrClient.init(...)` returns `{ loadTimeMs, backend?, device?, computeType?, rtf?, memoryBytes?, fallbackReason? }`
  - `NativeTranslateClient.init(...)` returns `{ loadTimeMs, backend?, device?, computeType?, tokensPerSec?, memoryBytes?, fallbackReason? }`

- [ ] **Step 1: Add `memoryBytes` to `ReadyMsg`**

In `src/lib/local-inference/native/nativeProtocol.ts`, line 4 — add `memoryBytes?: number;`:

```ts
  backend?: string; device?: string; computeType?: string; rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string;
```

- [ ] **Step 2: Forward the fields in `NativeAsrClient.init`**

In `src/lib/local-inference/native/NativeAsrClient.ts`, widen the return type (line ~70) and the returned object (line ~78):

```ts
  ): Promise<{ loadTimeMs: number; backend?: string; device?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string }> {
```

```ts
    return { loadTimeMs: r.loadTimeMs, backend: r.backend, device: r.device, computeType: r.computeType, rtf: r.rtf, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason };
```

- [ ] **Step 3: Forward the fields in `NativeTranslateClient.init`**

In `src/lib/local-inference/native/NativeTranslateClient.ts`, widen the return type (line ~57) and returned object (line ~62):

```ts
      Promise<{ loadTimeMs: number; backend?: string; device?: string; computeType?: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string }> {
```

```ts
    return { loadTimeMs: r.loadTimeMs, backend: r.backend, device: r.device, computeType: r.computeType, tokensPerSec: r.tokensPerSec, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason };
```

- [ ] **Step 4: Run the native client suites to verify pass**

Run: `npx vitest run src/lib/local-inference/native`
Expected: PASS (no behavior change; types widened).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeProtocol.ts src/lib/local-inference/native/NativeAsrClient.ts src/lib/local-inference/native/NativeTranslateClient.ts
git commit -m "feat(native): forward memoryBytes + fallbackReason from ready message"
```

---

### Task 5: Store the resolved memory + reason

**Files:**
- Modify: `src/stores/nativeModelStore.ts:44-49` (resolved types + setters)
- Modify: `src/services/clients/LocalNativeClient.ts:58,66` (setter calls)
- Test: `src/services/clients/LocalNativeClient.test.ts` (existing + a new assertion)

**Interfaces:**
- Consumes: `NativeAsrClient.init` / `NativeTranslateClient.init` returns (Task 4).
- Produces: store types
  - `asrResolved: { model: string; device: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null`
  - `translationResolved: { model: string; device: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null`

- [ ] **Step 1: Write the failing test**

Add to `src/services/clients/LocalNativeClient.test.ts`, in the `LocalNativeClient session channel` describe block (after the existing `stores the resolved plan` test):

```ts
  it('stores measured memory + fallback reason from the resolved plan', async () => {
    const asr = {
      onResult: null as any, onError: null as any,
      init: async () => ({ loadTimeMs: 5, device: 'cuda', rtf: 0.02, memoryBytes: 8_000_000_000 }),
      feedAudio() {}, flush: async () => {}, dispose() {},
    };
    const translate = {
      onError: null as any,
      init: async () => ({ device: 'cpu', memoryBytes: 4_200_000_000, fallbackReason: 'cuda skipped; using CPU' }),
      translate: async () => ({ translatedText: 'x', inferenceTimeMs: 1 }), dispose() {},
    };
    const c = new LocalNativeClient({ asr, translate, tts: fakeTts() });
    c.setEventHandlers({});
    await c.connect(cfg);
    const st = useNativeModelStore.getState();
    expect(st.asrResolved).toMatchObject({ device: 'cuda', memoryBytes: 8_000_000_000 });
    expect(st.translationResolved).toMatchObject({ device: 'cpu', memoryBytes: 4_200_000_000, fallbackReason: 'cuda skipped; using CPU' });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts -t "measured memory"`
Expected: FAIL — `memoryBytes`/`fallbackReason` are `undefined` (setters don't carry them).

- [ ] **Step 3: Widen the store types + setters**

In `src/stores/nativeModelStore.ts`, lines 44-49:

```ts
  asrResolved: { model: string; device: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null;

  translationResolved: { model: string; device: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null;

  setAsrResolved: (r: { model: string; device: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
  setTranslationResolved: (r: { model: string; device: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
```

- [ ] **Step 4: Pass the fields in `LocalNativeClient.connect`**

In `src/services/clients/LocalNativeClient.ts`, update the two setter calls:

```ts
      store.setTranslationResolved({ model: config.translationModelId ?? '', device: tr.device ?? 'cpu', tokensPerSec: tr.tokensPerSec, memoryBytes: tr.memoryBytes, fallbackReason: tr.fallbackReason });
```

```ts
        store.setAsrResolved({ model: config.asrModelId, device: res.device ?? 'cpu', rtf: res.rtf, memoryBytes: res.memoryBytes, fallbackReason: res.fallbackReason });
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts`
Expected: PASS (existing 10 + new).

- [ ] **Step 6: Commit**

```bash
git add src/stores/nativeModelStore.ts src/services/clients/LocalNativeClient.ts src/services/clients/LocalNativeClient.test.ts
git commit -m "feat(native): store resolved memoryBytes + fallbackReason per stage"
```

---

### Task 6: Pure render helpers in `nativeCatalog.ts`

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (add after `estimateNativeMemoryByDevice`)
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Produces:
  - `formatMemMb(mb: number) -> string` ("8.1 GB" / "120 MB")
  - `actualNativeMemoryByDevice(...resolveds) -> { vramMb: number; ramMb: number }`
  - `resolvedTierState(resolved) -> { tier: string; degraded: boolean; memoryMb?: number } | null`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/local-inference/native/nativeCatalog.test.ts`. First extend the import on line 2 to include `formatMemMb, actualNativeMemoryByDevice, resolvedTierState`. Then add:

```ts
  describe('formatMemMb', () => {
    it('renders GB at/over 1024 MB, MB below', () => {
      expect(formatMemMb(8294)).toBe('8.1 GB');
      expect(formatMemMb(120)).toBe('120 MB');
      expect(formatMemMb(1024)).toBe('1.0 GB');
    });
  });

  describe('actualNativeMemoryByDevice', () => {
    const MB = 1_048_576;
    it('sums memoryBytes by real device (degraded translation lands in RAM)', () => {
      const asr = { model: 'voxtral', device: 'cuda', memoryBytes: 8000 * MB };
      const tr = { model: 'qwen', device: 'cpu', memoryBytes: 4000 * MB, fallbackReason: 'low VRAM' };
      expect(actualNativeMemoryByDevice(asr, tr)).toEqual({ vramMb: 8000, ramMb: 4000 });
    });
    it('skips stages with no measured bytes', () => {
      const asr = { model: 'voxtral', device: 'cuda' };
      expect(actualNativeMemoryByDevice(asr, null)).toEqual({ vramMb: 0, ramMb: 0 });
    });
  });

  describe('resolvedTierState', () => {
    const MB = 1_048_576;
    it('maps a live GPU plan to a non-degraded gpu tier with memory', () => {
      expect(resolvedTierState({ model: 'v', device: 'cuda', memoryBytes: 8294 * MB }))
        .toEqual({ tier: 'gpu-cuda', degraded: false, memoryMb: 8294 });
    });
    it('flags a CPU plan WITH a fallback reason as degraded', () => {
      expect(resolvedTierState({ model: 'q', device: 'cpu', memoryBytes: 4000 * MB, fallbackReason: 'low VRAM' }))
        .toEqual({ tier: 'cpu', degraded: true, memoryMb: 4000 });
    });
    it('a CPU plan WITHOUT a reason is chosen-CPU, not degraded', () => {
      expect(resolvedTierState({ model: 'q', device: 'cpu' }))
        .toEqual({ tier: 'cpu', degraded: false, memoryMb: undefined });
    });
    it('returns null for no resolved', () => {
      expect(resolvedTierState(null)).toBeNull();
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — the three helpers are not exported.

- [ ] **Step 3: Implement the helpers**

In `src/lib/local-inference/native/nativeCatalog.ts`, add after `estimateNativeMemoryByDevice`:

```ts
/** A resolved stage as stored after a session — device + the measured footprint
 *  on that device, plus the gate's fallback notice when it was moved off GPU. */
export interface NativeResolved { model: string; device: string; memoryBytes?: number; fallbackReason?: string; }

/** Format a megabyte figure: GB (one decimal) at/over 1024 MB, MB below. */
export function formatMemMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

/** Sum the ACTUAL measured footprint of the resolved stages by their real
 *  device — VRAM for cuda, RAM otherwise. Stages with no measured bytes are
 *  skipped (so a not-yet-measured stage doesn't show a phantom 0). Replaces the
 *  pre-session estimate once a session has resolved. */
export function actualNativeMemoryByDevice(
  ...resolveds: (NativeResolved | null | undefined)[]
): { vramMb: number; ramMb: number } {
  let vramMb = 0;
  let ramMb = 0;
  for (const r of resolveds) {
    if (!r?.memoryBytes) continue;
    const mb = Math.round(r.memoryBytes / 1_048_576);
    if (r.device === 'cpu') ramMb += mb; else vramMb += mb;
  }
  return { vramMb, ramMb };
}

/** Derive the model-card "live" tier badge from a resolved stage: the real tier,
 *  whether it degraded (CPU with a fallback reason — the gate moved it off GPU),
 *  and the measured memory in MB. null when nothing has resolved yet (the card
 *  then shows the catalog capability tier instead). */
export function resolvedTierState(
  resolved: NativeResolved | null | undefined,
): { tier: string; degraded: boolean; memoryMb?: number } | null {
  if (!resolved) return null;
  return {
    tier: resolved.device === 'cpu' ? 'cpu' : `gpu-${resolved.device}`,
    degraded: resolved.device === 'cpu' && !!resolved.fallbackReason,
    memoryMb: resolved.memoryBytes ? Math.round(resolved.memoryBytes / 1_048_576) : undefined,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): pure helpers for actual memory split + resolved tier state"
```

---

### Task 7: Model-card tier tag — capability vs live, memory, degrade chip

**Files:**
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx:102-126` (resolved-tier block)
- Modify: `src/components/Settings/sections/ModelManagementSection.scss` (where `.model-card__lang-tag` is defined) for the live/accel/warn tag styling
- Test: covered by Task 6 helper tests (JSX stays thin); no new render test.

**Interfaces:**
- Consumes: `resolvedTierState`, `formatMemMb`, `tierLabel`, `formatRtf`, `formatTps` from `nativeCatalog.ts`; the `resolved` object (already in scope as `resolved`, matched via `showResolved`).

- [ ] **Step 1: Add the imports**

In `src/components/Settings/sections/NativeModelManagementSection.tsx`, add `resolvedTierState`, `formatMemMb` to the existing import from `nativeCatalog` (it already imports `tierLabel`, `formatRtf`, `formatTps`).

- [ ] **Step 2: Replace the resolved-tier block (lines 102-126)**

```tsx
              {(() => {
                // The active card shows the RESOLVED device as a LIVE badge (highlighted,
                // colored: green when accelerated, warn when the gate moved it to CPU),
                // with the measured speed + memory. Idle cards show the muted catalog
                // capability tier. Match selectId OR downloadId (translation resolves to
                // its artifact id = downloadId).
                const showResolved = !!resolved && (resolved.model === spec.selectId || resolved.model === spec.downloadId);
                const view = showResolved ? resolvedTierState(resolved) : null;
                const tier = view ? view.tier : activeTier?.tier;
                if (!tier) return null;
                const tl = tierLabel(tier);
                let metric = '';
                if (showResolved && resolved) {
                  if (resolved.rtf !== undefined) metric = ` · ${formatRtf(resolved.rtf)}`;
                  else if (resolved.tokensPerSec !== undefined) metric = ` · ${formatTps(resolved.tokensPerSec)}`;
                  if (view?.memoryMb) metric += ` · ${formatMemMb(view.memoryMb)}`;
                }
                // --live = highlighted (any resolved stage); --accel = green (a GPU
                // tier, via tierLabel().accel); --warn = red (degraded CPU). A
                // chosen-CPU stage gets --live only → highlighted but neutral.
                const cls = 'model-card__lang-tag'
                  + (view ? ' model-card__lang-tag--live' : '')
                  + (view && !view.degraded && tl.accel ? ' model-card__lang-tag--accel' : '')
                  + (view?.degraded ? ' model-card__lang-tag--warn' : '');
                return (
                  <>
                    <span className={cls}>
                      <TierIcon tier={tier} size={10} />{tl.label}{metric}
                    </span>
                    {view?.degraded && (
                      <span className="model-card__lang-tag model-card__lang-tag--warn"
                            title={resolved!.fallbackReason}>
                        ⚠ Low VRAM → CPU
                      </span>
                    )}
                  </>
                );
              })()}
```

- [ ] **Step 3: Add the SCSS for the live/accel/warn tag**

In `src/components/Settings/sections/ModelManagementSection.scss`, near the existing `.model-card__lang-tag` rule, add (reuse the project palette — green `#10a37f`, warn red `#e74c3c`):

```scss
.model-card__lang-tag--live { font-weight: 600; }           // highlighted (neutral): chosen-CPU
.model-card__lang-tag--accel { border-color: #10a37f; color: #10a37f; }  // GPU live
.model-card__lang-tag--warn  { border-color: #e74c3c; color: #e74c3c; }  // degraded CPU
```

(If `model-card__lang-tag` has no `border`, add `border: 1px solid currentColor;` to the base class so the `--accel`/`--warn` border colors show. Check the existing rule first and only add what's missing.)

- [ ] **Step 4: Verify build + native suites**

Run: `npx vitest run src/lib/local-inference/native src/components/Settings/sections`
Expected: PASS (no regressions; the change is render-only and exercised by Task 6 helpers).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/NativeModelManagementSection.tsx src/components/Settings/sections/ModelManagementSection.scss
git commit -m "feat(native): live tier badge with memory + degrade chip on model cards"
```

---

### Task 8: Estimate area — swap to actuals + degrade note

**Files:**
- Modify: `src/components/Settings/sections/ProviderSection.tsx` (the `nativeMemoryEstimate` memo region ~143-147 and the render block ~533-543)
- Test: covered by Task 6 helpers; no new render test.

**Interfaces:**
- Consumes: `useNativeAsrResolved`, `useNativeTranslationResolved` (from `nativeModelStore`), `actualNativeMemoryByDevice`, `formatMemMb` (from `nativeCatalog`), and the existing `nativeMemoryEstimate`.

- [ ] **Step 1: Import the resolved hooks + helpers**

In `src/components/Settings/sections/ProviderSection.tsx`:
- Add `useNativeAsrResolved`, `useNativeTranslationResolved` to the import from `../../../stores/nativeModelStore`.
- Add `actualNativeMemoryByDevice`, `formatMemMb` to the import from `../../../lib/local-inference/native/nativeCatalog`.

- [ ] **Step 2: Compute actuals + match guard (after the `nativeMemoryEstimate` memo, ~line 147)**

```tsx
  const asrResolved = useNativeAsrResolved();
  const translationResolved = useNativeTranslationResolved();
  // Once a session resolves, replace the pre-session estimate with what's REALLY
  // in use — but only when the resolved stages still match the current selection
  // (else a prior session's numbers would mislead). Resolution carries the real
  // device, so a VRAM-degraded translation correctly shows up under RAM.
  const nativeActual = useMemo(() => {
    if (provider !== Provider.LOCAL_NATIVE) return null;
    const trCards = nativeTranslationCards(localNativeSettings.sourceLanguage, localNativeSettings.targetLanguage);
    const trCard = trCards.find(c => c.selectId === localNativeSettings.translationModel) || trCards.find(c => c.selectId === '');
    const asrMatch = !!asrResolved && asrResolved.model === localNativeSettings.asrModel;
    const trMatch = !!translationResolved && translationResolved.model === trCard?.downloadId;
    if (!asrMatch || !trMatch) return null;
    const mem = actualNativeMemoryByDevice(asrResolved, translationResolved);
    const degraded = [asrResolved, translationResolved].some(r => r?.device === 'cpu' && r?.fallbackReason);
    return { ...mem, degraded };
  }, [provider, asrResolved, translationResolved, localNativeSettings.asrModel,
    localNativeSettings.translationModel, localNativeSettings.sourceLanguage, localNativeSettings.targetLanguage]);
```

- [ ] **Step 3: Replace the render block (the `nativeMemoryEstimate` block ~533-543)**

```tsx
            {nativeActual ? (
              <div className="memory-estimate">
                <Cpu size={11} />
                <span className="memory-estimate__label">In use</span>
                {nativeActual.vramMb > 0 && <span>VRAM {formatMemMb(nativeActual.vramMb)}</span>}
                {nativeActual.ramMb > 0 && <span>RAM {formatMemMb(nativeActual.ramMb)}</span>}
                {nativeActual.degraded && (
                  <span className="memory-estimate__warn">Translation on CPU — not enough VRAM</span>
                )}
              </div>
            ) : nativeMemoryEstimate && (nativeMemoryEstimate.vramMb > 0 || nativeMemoryEstimate.ramMb > 0) && (
              <div className="memory-estimate">
                <Cpu size={11} />
                <span className="memory-estimate__label">Estimated</span>
                {nativeMemoryEstimate.vramMb > 0 && <span>VRAM ~{formatMemMb(nativeMemoryEstimate.vramMb)}</span>}
                {nativeMemoryEstimate.ramMb > 0 && <span>RAM ~{formatMemMb(nativeMemoryEstimate.ramMb)}</span>}
              </div>
            )}
```

(Note: this also swaps the existing inline GB/MB ternaries to `formatMemMb`, keeping one formatter.)

- [ ] **Step 4: Add minimal SCSS for the label + warn**

In `src/components/Settings/Settings.scss`, next to the existing `.memory-estimate` rule:

```scss
.memory-estimate__label { opacity: 0.7; }
.memory-estimate__warn { color: #e74c3c; }
```

- [ ] **Step 5: Verify build + suites**

Run: `npx vitest run src/components/Settings/sections src/lib/local-inference/native`
Expected: PASS.

- [ ] **Step 6: Typecheck the touched files (no NEW errors)**

Run: `npx tsc --noEmit 2>&1 | grep -E "ProviderSection|NativeModelManagementSection|nativeCatalog|LocalNativeClient|nativeModelStore|NativeAsrClient|NativeTranslateClient"`
Expected: no new errors from these files (the repo has ~pre-existing errors elsewhere; compare against a clean `git stash` baseline if anything appears).

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/sections/ProviderSection.tsx src/components/Settings/sections/ProviderSection.scss
git commit -m "feat(native): show actual VRAM/RAM in use + degrade note after connect"
```

---

## Verification (real GPU — manual, hardware-gated)

After Task 8, on the RTX 4070 with the app-downloaded Voxtral + Qwen3.5-2B (the same setup that verified the VRAM gate), extend `$CLAUDE_JOB_DIR/tmp/vram_e2e.py` to call the engines (not just `load_measured`) and assert:
- ASR (Voxtral, streaming) `resolved.device == 'cuda'` and `resolved.memoryBytes` ≈ 8 GB.
- Translation (Qwen3.5-2B) `resolved.device == 'cpu'`, `resolved.memoryBytes` > 0, and `resolved.fallbackReason` set.

Then launch the app, pick both as Auto, start a conversation, and confirm in settings:
- ASR card: green live `GPU·CUDA · …× · ~8 GB`.
- Translation card: warn `CPU · ~4 GB` + `⚠ Low VRAM → CPU` (notice on hover).
- Estimate area: `In use · VRAM 8.x GB · RAM 4.x GB` + `Translation on CPU — not enough VRAM`.

---

## Notes / out of scope

- **TTS** is not measured (no `resolved` entry; ~60 MB) — deferred to the TTS rework. The actual readout covers ASR + translation only.
- **Opus-MT** translation loads via `OpusMtTranslator` (not `load_with_fallback`), so it has no `memoryBytes`; its card shows device + speed without a memory figure, and `actualNativeMemoryByDevice` simply omits it. Acceptable (CPU-only, ~100 MB).
