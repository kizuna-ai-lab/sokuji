# Fun-ASR-MLT-Nano (offline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 31-language `FunAudioLLM/Fun-ASR-MLT-Nano-2512` speech-LLM as an offline GPU+CPU ASR backend, by generalizing the existing FunASR SenseVoice backend into a shared config-driven `_FunAsrBackend`.

**Architecture:** Backend-layer-only change. A new `funasr_nano` backend reuses the `funasr.AutoModel` seam (the same one SenseVoice uses) but feeds audio as a temp wav (Fun-ASR-Nano's chat-template input needs a file path, not a bare ndarray) and passes output through unchanged (clean punctuated text, no tags). Catalog/accel/download/renderer rows wire it into the resolver and UI. The WS transport, silero-VAD segmentation, and result envelope are untouched.

**Tech Stack:** Python (funasr 1.3.14, torch cu128, soundfile), pytest; TypeScript renderer catalog + vitest.

## Global Constraints

- **No new pip dependency.** funasr (1.3.14) already ships the `fun_asr_nano` model code; `tiktoken` (the `multilingual.tiktoken` tokenizer) and `soundfile` are already present transitively (funasr / librosa). Do NOT add packages.
- **`trust_remote_code=True`** is required to load Fun-ASR-Nano (the code is the pinned funasr package's `funasr/models/fun_asr_nano/model.py`, not arbitrary remote code). `remote_code` is NOT needed (verified).
- **`compute_type` is `float32`** for both tiers — the model loads fp32, 869M params (verified). Do not label it float16/bfloat16.
- **Both `gpu-cuda` and `cpu` tiers** ship — CPU RTF is 0.22–0.32 (real-time), verified on the dev box.
- **SenseVoice behavior is preserved byte-for-byte** — the refactor must not change `FunAsrSenseVoiceBackend`'s output, generate kwargs, or device handling.
- **Input contract: file path.** Fun-ASR-Nano's `data_template` raises on a bare ndarray; feed a temp wav and pass `input=[path]`.
- **Text-only output**: take `res[0]["text"]` verbatim (already clean + punctuated); do NOT call `rich_transcription_postprocess` (it injects emoji).
- English-only comments; conventional commits.

## Phase-0 verification (COMPLETED — values below are measured, not assumed)

Run on the dev RTX 4070 (funasr 1.3.14, torch 2.11.0+cu128), feeding the cached
sherpa SenseVoice test clips (zh/en/ja/ko/yue) as temp wavs:

| device | RTF | load | VRAM | correctness |
|--------|-----|------|------|-------------|
| cuda:0 | 0.047–0.100 | ~17 s | 3579 MB peak | all 5 langs correct |
| cpu    | 0.223–0.317 | ~18 s | —    | all 5 langs correct |

- Model: 869M params, **float32**. `AutoModel(model=REPO, hub="hf", device=dev, trust_remote_code=True, disable_update=True)` loads on both devices.
- Input: `generate(input=[wav_path], language="auto", use_itn=True)` works; a bare ndarray raises `'NoneType' object is not iterable` in `data_template`.
- Output keys: `key, text, text_tn, label, ctc_text, ctc_timestamps, timestamps`; `text` is clean punctuated transcript, **no `<|tags|>`**. `language="auto"` auto-detects all 5 correctly.
- 31-language list (from the model card; no JSON `languages` key exists):
  `zh, en, yue, ja, ko, vi, id, th, ms, fil, ar, hi, bg, hr, cs, da, nl, et, fi, el, hu, ga, lv, lt, mt, pl, pt, ro, sk, sl, sv`.

## File Structure

- `sidecar/sokuji_sidecar/backends.py` — generalize `FunAsrSenseVoiceBackend` → `_FunAsrBackend` base + `_FunAsrConfig`; add `FunAsrNanoBackend` + temp-wav feed.
- `sidecar/sokuji_sidecar/catalog.py` — add `FUN_ASR_MLT_REPO` + the `fun-asr-mlt-nano` row.
- `sidecar/sokuji_sidecar/accel.py` — `_installed()` maps `funasr_nano → funasr`.
- `sidecar/sokuji_sidecar/native_models.py` — `download_specs("fun-asr-mlt-nano")`.
- `sidecar/tests/test_backends.py` — extend `_install_fake_funasr`; add Nano tests.
- `sidecar/tests/test_catalog.py`, `test_accel.py`, `test_native_models.py` — row assertions.
- `src/lib/local-inference/native/nativeCatalog.ts` (+ `.test.ts`) — renderer row.

---

### Task 1: Generalize backend into shared `_FunAsrBackend` (behavior-preserving)

**Files:**
- Modify: `sidecar/sokuji_sidecar/backends.py:354-415` (the `_strip_sensevoice_tags` + `FunAsrSenseVoiceBackend` block)
- Modify: `sidecar/tests/test_backends.py:610-633` (`_install_fake_funasr`)

**Interfaces:**
- Produces: `_FunAsrConfig(trust_remote_code: bool, feed: str, postprocess: Callable[[str], tuple[str, str|None]])`; `_passthrough(text)->(str, None)`; `_FunAsrBackend` base with `load/transcribe/unload/is_loaded` and `_generate_tempwav`; `FunAsrSenseVoiceBackend(NAME="funasr_sensevoice")` subclass (unchanged behavior).
- Consumes: existing `AsrResult`, `BackendLoadError`, `register_backend`, `TARGET_RATE`, `_strip_sensevoice_tags`.

- [ ] **Step 1: Update the fake funasr fixture to accept `trust_remote_code` + both generate shapes**

In `sidecar/tests/test_backends.py`, replace the `FakeAutoModel` inside `_install_fake_funasr` (lines 614-623):

```python
    class FakeAutoModel:
        def __init__(self, model, hub, device, disable_update, trust_remote_code=False):
            if fail:
                raise RuntimeError("funasr load failed")
            cap["init"] = dict(model=model, hub=hub, device=device,
                               disable_update=disable_update,
                               trust_remote_code=trust_remote_code)

        def generate(self, input, **kw):
            cap["gen"] = dict(n=len(input), **kw)
            return [] if empty else [{"text": text}]
```

- [ ] **Step 2: Run the existing SenseVoice backend tests — they must still pass (and now capture trust_remote_code)**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -k funasr -q`
Expected: PASS (the fixture change is backward-compatible; generate still records `fs`/`language`/`use_itn`/`batch_size_s` via `**kw`).

- [ ] **Step 3: Refactor `backends.py` — shared base + SenseVoice subclass**

Add `from typing import Callable` to the imports at the top of `backends.py` (after `from dataclasses import dataclass`). Then replace the block at lines 366-415 (the `@register_backend class FunAsrSenseVoiceBackend: ...` definition) with:

```python
@dataclass(frozen=True)
class _FunAsrConfig:
    trust_remote_code: bool
    feed: str   # "ndarray" (SenseVoice) | "tempwav" (Fun-ASR-Nano chat-template needs a path)
    postprocess: Callable[[str], "tuple[str, str | None]"]


def _passthrough(text: str) -> "tuple[str, None]":
    """Fun-ASR-Nano emits clean, natively-punctuated text with no tags."""
    return text.strip(), None


class _FunAsrBackend:
    """Shared FunASR AutoModel offline backend. Subclasses set NAME + CONFIG.
    Honors the device given; the cuda guard rejects cuda when torch has no CUDA
    runtime (FunASR would silently run on CPU) so load_with_fallback steps to the
    correctly-labelled cpu plan. One generate() per VAD segment."""
    CONFIG: _FunAsrConfig

    def __init__(self):
        self._m = None

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
        self._m = None
        try:
            from funasr import AutoModel
            if device == "cuda":
                import torch
                if not torch.cuda.is_available():
                    raise BackendLoadError("cuda requested but torch has no CUDA runtime")
                dev = "cuda:0"
            else:
                dev = device
            self._m = AutoModel(model=model_ref, hub="hf", device=dev,
                                trust_remote_code=self.CONFIG.trust_remote_code,
                                disable_update=True)
        except BackendLoadError:
            raise
        except Exception as e:  # missing funasr, OOM, bad repo → resolver falls back
            raise BackendLoadError(str(e))

    def transcribe(self, samples, language) -> AsrResult:
        if self.CONFIG.feed == "tempwav":
            res = self._generate_tempwav(samples, language)
        else:
            res = self._m.generate(input=samples, fs=TARGET_RATE, cache={},
                                   language=(language or "auto"), use_itn=True,
                                   batch_size_s=60)
        if not res or not isinstance(res, list) or "text" not in res[0]:
            return AsrResult("", None)  # funasr returned nothing (empty/silent segment)
        text, lang = self.CONFIG.postprocess(res[0]["text"])
        return AsrResult(text, lang)

    def _generate_tempwav(self, samples, language):
        # Fun-ASR-Nano's data_template builds its chat-style input from a FILE PATH;
        # a bare ndarray raises in data_template. Write the VAD segment to a temp wav
        # and pass the path (the official, verified contract). soundfile ships via librosa.
        import os
        import tempfile
        import soundfile as sf
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        try:
            sf.write(tmp.name, samples, TARGET_RATE)
            return self._m.generate(input=[tmp.name],
                                    language=(language or "auto"), use_itn=True)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

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


@register_backend
class FunAsrSenseVoiceBackend(_FunAsrBackend):
    """FunASR SenseVoiceSmall (PyTorch). model_ref is the HF repo id
    (FunAudioLLM/SenseVoiceSmall). Serves BOTH gpu-cuda (float32) and cpu
    (float32) tiers — honors the device it is given (no GPU-only guard).
    Non-autoregressive encoder+CTC: one generate() per VAD segment. Output
    lang/emotion/event tags are stripped to a clean transcript."""
    NAME = "funasr_sensevoice"
    CONFIG = _FunAsrConfig(trust_remote_code=False, feed="ndarray",
                           postprocess=_strip_sensevoice_tags)
```

(Leave `_SV_TAG` and `_strip_sensevoice_tags` at lines 354-363 exactly as they are.)

- [ ] **Step 4: Run the full backend suite — SenseVoice behavior unchanged**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -q`
Expected: PASS (all existing tests, including the SenseVoice funasr tests, the cuda-guard tests, and empty-result test).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/backends.py sidecar/tests/test_backends.py
git commit -m "refactor(sidecar): generalize FunASR backend into shared _FunAsrBackend"
```

---

### Task 2: Add `FunAsrNanoBackend` (`funasr_nano`)

**Files:**
- Modify: `sidecar/sokuji_sidecar/backends.py` (append after `FunAsrSenseVoiceBackend`)
- Modify: `sidecar/tests/test_backends.py` (append after the SenseVoice funasr tests)

**Interfaces:**
- Consumes: `_FunAsrBackend`, `_FunAsrConfig`, `_passthrough`, `register_backend`, `_install_fake_funasr`.
- Produces: `FunAsrNanoBackend(NAME="funasr_nano")` — `trust_remote_code=True`, `feed="tempwav"`, `postprocess=_passthrough`.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/tests/test_backends.py`:

```python
def test_funasr_nano_config_and_load(monkeypatch):
    cap = _install_fake_funasr(monkeypatch, text="你好世界")
    b = backends.make_backend("funasr_nano")
    b.load("FunAudioLLM/Fun-ASR-MLT-Nano-2512", "cuda", "float32")
    assert b.is_loaded
    assert cap["init"]["model"] == "FunAudioLLM/Fun-ASR-MLT-Nano-2512"
    assert cap["init"]["device"] == "cuda:0"
    assert cap["init"]["trust_remote_code"] is True      # Nano needs remote code


def test_funasr_nano_transcribe_feeds_tempwav_path(monkeypatch):
    # Fun-ASR-Nano takes a file path, not a bare ndarray: transcribe must call
    # generate(input=[<path>], ...) WITHOUT the SenseVoice fs/cache/batch_size_s kwargs.
    cap = _install_fake_funasr(monkeypatch, text="你好世界")
    b = backends.make_backend("funasr_nano")
    b.load("FunAudioLLM/Fun-ASR-MLT-Nano-2512", "cuda", "float32")
    out = b.transcribe(np.zeros(16000, np.float32), "zh")
    assert out.text == "你好世界" and out.language is None   # passthrough, no tags
    assert cap["gen"]["n"] == 1                  # input is a 1-element list (a path)
    assert cap["gen"]["language"] == "zh"
    assert cap["gen"]["use_itn"] is True
    assert "fs" not in cap["gen"] and "batch_size_s" not in cap["gen"]


def test_funasr_nano_rejects_cuda_without_torch_cuda(monkeypatch):
    cap = _install_fake_funasr(monkeypatch, cuda_available=False)
    b = backends.make_backend("funasr_nano")
    with pytest.raises(backends.BackendLoadError):
        b.load("FunAudioLLM/Fun-ASR-MLT-Nano-2512", "cuda", "float32")
    assert "init" not in cap and not b.is_loaded


def test_funasr_nano_honors_cpu(monkeypatch):
    cap = _install_fake_funasr(monkeypatch, cuda_available=False, text="hi")
    b = backends.make_backend("funasr_nano")
    b.load("FunAudioLLM/Fun-ASR-MLT-Nano-2512", "cpu", "float32")
    assert b.is_loaded and cap["init"]["device"] == "cpu"


def test_funasr_nano_empty_result_returns_blank(monkeypatch):
    _install_fake_funasr(monkeypatch, empty=True)
    b = backends.make_backend("funasr_nano")
    b.load("FunAudioLLM/Fun-ASR-MLT-Nano-2512", "cuda", "float32")
    out = b.transcribe(np.zeros(16000, np.float32), None)
    assert out.text == "" and out.language is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -k funasr_nano -q`
Expected: FAIL with `unknown backend: funasr_nano`.

- [ ] **Step 3: Implement the backend**

Append after `FunAsrSenseVoiceBackend` in `backends.py`:

```python
@register_backend
class FunAsrNanoBackend(_FunAsrBackend):
    """FunASR Fun-ASR-Nano family (SenseVoice audio encoder + Qwen3-0.6B LLM
    decoder). model_ref is the HF repo id (FunAudioLLM/Fun-ASR-MLT-Nano-2512).
    Serves gpu-cuda (float32) + cpu (float32); both real-time. trust_remote_code
    loads the fun_asr_nano model code shipped in funasr. Output is clean,
    natively-punctuated text (no tags). Input is fed as a temp wav because the
    model's chat-template input is built from a file path, not a bare ndarray."""
    NAME = "funasr_nano"
    CONFIG = _FunAsrConfig(trust_remote_code=True, feed="tempwav",
                           postprocess=_passthrough)
```

- [ ] **Step 4: Run the tests**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_backends.py -k funasr -q`
Expected: PASS (all SenseVoice + Nano tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/backends.py sidecar/tests/test_backends.py
git commit -m "feat(sidecar): add funasr_nano backend (Fun-ASR-Nano, tempwav feed)"
```

---

### Task 3: Catalog row + accel install gate

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (add `FUN_ASR_MLT_REPO` near `SENSE_VOICE_REPO`; add the row to `ASR_MODELS`)
- Modify: `sidecar/sokuji_sidecar/accel.py` (the `_installed()` mods dict)
- Modify: `sidecar/tests/test_catalog.py`, `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `AsrModel`, `Deployment`, backend name `"funasr_nano"`.
- Produces: catalog id `"fun-asr-mlt-nano"` with two `funasr_nano` deployments (gpu-cuda + cpu, both float32).

- [ ] **Step 1: Write failing catalog test**

Append to `sidecar/tests/test_catalog.py`:

```python
def test_fun_asr_mlt_nano_row():
    m = catalog.asr_model("fun-asr-mlt-nano")
    assert m is not None and m.name == "Fun-ASR MLT Nano"
    assert m.recommended is True
    assert len(m.languages) == 31
    assert m.languages[:6] == ("zh", "en", "yue", "ja", "ko", "vi")
    assert [(d.backend, d.tier, d.compute_type) for d in m.deployments] == [
        ("funasr_nano", "gpu-cuda", "float32"),
        ("funasr_nano", "cpu", "float32"),
    ]
    assert all(d.artifact == catalog.FUN_ASR_MLT_REPO for d in m.deployments)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py::test_fun_asr_mlt_nano_row -q`
Expected: FAIL (`asr_model("fun-asr-mlt-nano")` is None).

- [ ] **Step 3: Add the constant + row**

In `catalog.py`, after the `SENSE_VOICE_REPO = ...` line add:

```python
FUN_ASR_MLT_REPO = os.environ.get("SOKUJI_FUNASR_NANO_REPO", "FunAudioLLM/Fun-ASR-MLT-Nano-2512")
```

Then append this entry to the end of the `ASR_MODELS` list (after the `voxtral-mini-4b-realtime` row):

```python
    AsrModel("fun-asr-mlt-nano", "Fun-ASR MLT Nano",
             ("zh", "en", "yue", "ja", "ko", "vi", "id", "th", "ms", "fil", "ar",
              "hi", "bg", "hr", "cs", "da", "nl", "et", "fi", "el", "hu", "ga",
              "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "sv"),
             (Deployment("funasr_nano", "gpu-cuda", "float32", FUN_ASR_MLT_REPO, 1.0),
              Deployment("funasr_nano", "cpu", "float32", FUN_ASR_MLT_REPO, 1.0)),
             recommended=True, sort_order=11),
```

- [ ] **Step 4: Allow the new backend in the catalog backend-set assertion**

In `sidecar/tests/test_catalog.py`, the `test_models_have_deployments_and_languages` test asserts `d.backend in {...}`. Add `"funasr_nano"` to that set.

- [ ] **Step 5: Map the install gate**

In `sidecar/sokuji_sidecar/accel.py`, find the `_installed()` mods dict (it maps `"funasr_sensevoice": "funasr"`) and add the line:

```python
        "funasr_nano": "funasr",
```

- [ ] **Step 6: Write failing accel resolve test**

Append to `sidecar/tests/test_accel.py`:

```python
def test_fun_asr_mlt_nano_resolves_gpu_and_cpu(monkeypatch):
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"funasr_nano"}))
    # explicit cuda override -> gpu-cuda plan first
    plan = accel.resolve("fun-asr-mlt-nano", "cuda", _machine_with_cuda())
    assert plan[0].backend == "funasr_nano" and plan[0].tier == "gpu-cuda"
    # explicit cpu override -> cpu plan
    plan_cpu = accel.resolve("fun-asr-mlt-nano", "cpu", _machine_with_cuda())
    assert plan_cpu[0].tier == "cpu"
```

> NOTE for the implementer: `test_accel.py` already has a helper to build a machine
> with a CUDA GPU (used by the existing SenseVoice/Whisper resolve tests). Reuse that
> exact helper name instead of `_machine_with_cuda()` if it differs — grep the file
> for the existing resolve tests (e.g. the sense-voice one) and copy its machine setup.

- [ ] **Step 7: Run the catalog + accel suites**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py tests/test_accel.py -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/sokuji_sidecar/accel.py \
        sidecar/tests/test_catalog.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): catalog + install gate for fun-asr-mlt-nano"
```

---

### Task 4: Download spec

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py` (the `download_specs` model→repo mapping)
- Modify: `sidecar/tests/test_native_models.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `download_specs("fun-asr-mlt-nano") == {"repos": ["FunAudioLLM/Fun-ASR-MLT-Nano-2512"], "urls": []}`.

- [ ] **Step 1: Write the failing test**

Append to `sidecar/tests/test_native_models.py`:

```python
def test_download_specs_fun_asr_mlt_nano(monkeypatch):
    monkeypatch.delenv('SOKUJI_FUNASR_NANO_REPO', raising=False)
    spec = nm.download_specs('fun-asr-mlt-nano')
    assert spec['repos'] == ['FunAudioLLM/Fun-ASR-MLT-Nano-2512']
    assert spec['urls'] == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_native_models.py::test_download_specs_fun_asr_mlt_nano -q`
Expected: FAIL (the model id isn't mapped → likely returns the bare id or raises).

- [ ] **Step 3: Add the mapping**

In `native_models.py`, locate `download_specs` and the `sense-voice` branch (it returns `{"repos": [SENSE_VOICE_REPO], "urls": [VAD_URL]}`). Add a sibling branch for the new id. Add a module-level constant near the other repo constants:

```python
FUN_ASR_MLT_REPO = os.environ.get("SOKUJI_FUNASR_NANO_REPO", "FunAudioLLM/Fun-ASR-MLT-Nano-2512")
```

and inside `download_specs`, before the generic/fallthrough return:

```python
    if model_id == "fun-asr-mlt-nano":
        return {"repos": [FUN_ASR_MLT_REPO], "urls": []}
```

> NOTE: match the exact branching style already used for `sense-voice` in this
> function (if/elif chain vs dict).
>
> **CORRECTION (PR #270 review):** the `"urls": []` above is wrong. The engine's
> silero VAD (`silero_vad.onnx`) is a *downloaded* artifact `AsrEngine._init_vad()`
> loads for every ASR model, so an offline-only install of this model needs it.
> The shipped code treats the VAD as a shared dependency: `download_specs` appends
> `VAD_URL` for any ASR-catalog model and `delete_model` keeps the shared file.
> See the design doc's "Post-implementation correction" note.

- [ ] **Step 4: Run the native_models suite**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_native_models.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_native_models.py
git commit -m "feat(sidecar): download spec for fun-asr-mlt-nano"
```

---

### Task 5: Renderer catalog row

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (append to `NATIVE_ASR`)
- Modify: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Consumes: the `NativeModelOption` shape already in the file.
- Produces: a `fun-asr-mlt-nano` option mirroring the sidecar row.

- [ ] **Step 1: Write the failing test**

Append a test inside the `describe('nativeCatalog', ...)` block in `nativeCatalog.test.ts`:

```typescript
  it('includes fun-asr-mlt-nano as a recommended 31-language ASR option', () => {
    const m = NATIVE_ASR.find((x) => x.id === 'fun-asr-mlt-nano');
    expect(m).toBeTruthy();
    expect(m!.label).toBe('Fun-ASR MLT Nano');
    expect(m!.recommended).toBe(true);
    expect(m!.languages).toHaveLength(31);
    expect(m!.languages.slice(0, 5)).toEqual(['zh', 'en', 'yue', 'ja', 'ko']);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL (no `fun-asr-mlt-nano` row).

- [ ] **Step 3: Add the renderer row**

Append to the `NATIVE_ASR` array in `nativeCatalog.ts` (after the last entry):

```typescript
  { id: 'fun-asr-mlt-nano', label: 'Fun-ASR MLT Nano', languages: ['zh', 'en', 'yue', 'ja', 'ko', 'vi', 'id', 'th', 'ms', 'fil', 'ar', 'hi', 'bg', 'hr', 'cs', 'da', 'nl', 'et', 'fi', 'el', 'hu', 'ga', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv'], recommended: true, sortOrder: 11 },
```

> NOTE: if the last existing entry already uses `sortOrder: 11`, use the next
> integer instead — grep the file for the current max `sortOrder`. Ordering is
> advisory (the renderer owns card order); just keep it unique.

- [ ] **Step 4: Run the renderer test**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(ui): add fun-asr-mlt-nano to native ASR catalog"
```

---

### Task 6: Gated GPU smoke test (real model)

**Files:**
- Modify: `sidecar/tests/test_backends.py` (append a gated smoke test)

**Interfaces:**
- Consumes: the real `funasr_nano` backend + the cached sherpa SenseVoice test wav.

- [ ] **Step 1: Add the gated smoke test**

Append to `sidecar/tests/test_backends.py`:

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_ASR_MODEL"),
                    reason="set SOKUJI_RUN_ASR_MODEL=1 (downloads/loads Fun-ASR-MLT-Nano, needs CUDA)")
def test_funasr_nano_real_transcribe_smoke():
    import soundfile as sf
    wav = ("/home/jiangzhuo/.cache/huggingface/hub/"
           "models--csukuangfj--sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/"
           "snapshots/2365baeacb507f821a0c8120fcee3d484dba7a07/test_wavs/en.wav")
    samples, sr = sf.read(wav, dtype="float32")
    assert sr == 16000
    b = backends.make_backend("funasr_nano")
    b.load("FunAudioLLM/Fun-ASR-MLT-Nano-2512", "cuda", "float32")
    out = b.transcribe(samples, "auto")
    b.unload()
    assert out.text and "tribal" in out.text.lower()   # verified transcript content
```

> NOTE: the `os` and `pytest` imports already exist at the top of `test_backends.py`.
> The wav path is the cached clip used to verify SenseVoice; if absent, the test is
> simply not run (it's gated off by default).

- [ ] **Step 2: Run it (gated) to confirm the real path works**

Run: `cd sidecar && SOKUJI_RUN_ASR_MODEL=1 .venv/bin/python -m pytest tests/test_backends.py::test_funasr_nano_real_transcribe_smoke -q -s`
Expected: PASS (loads the model on GPU, transcribes "...tribal chieftain...").

- [ ] **Step 3: Run the whole sidecar suite (ungated) + commit**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: PASS (gated smoke test is skipped without the env var).

```bash
git add sidecar/tests/test_backends.py
git commit -m "test(sidecar): gated GPU smoke test for funasr_nano"
```

---

## Self-Review

**Spec coverage:** Backend generalization (Task 1) ✓; funasr_nano backend + tempwav feed + passthrough (Task 2) ✓; catalog row with gpu+cpu float32 tiers + 31 langs (Task 3) ✓; install gate (Task 3) ✓; download spec (Task 4) ✓; renderer row (Task 5) ✓; gated smoke (Task 6) ✓; SenseVoice preserved (Task 1, regression run) ✓; `trust_remote_code` honest, compute_type float32, no new deps (Global Constraints) ✓. Streaming/vLLM correctly absent (out of scope).

**Placeholder scan:** No "TBD"/"add error handling" placeholders — all code is concrete. Two `> NOTE` callouts ask the implementer to match an existing helper/branch style (machine-builder in test_accel, sense-voice branch in download_specs, max sortOrder) rather than guess; these are grounding instructions, not missing content, because the surrounding style is in files the implementer reads.

**Type consistency:** `_FunAsrConfig(trust_remote_code, feed, postprocess)` is constructed identically in both subclasses; `feed` values `"ndarray"`/`"tempwav"` match the `transcribe` branch; `_passthrough` and `_strip_sensevoice_tags` share the `(str)->(str, str|None)` shape; backend NAME `"funasr_nano"` is identical across catalog, accel, download spec, and tests; `FUN_ASR_MLT_REPO` constant name is identical in catalog and native_models.
