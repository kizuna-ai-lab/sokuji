# Native Metadata Single-Sourcing — Plan 1: Sidecar (additive)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Python sidecar carry every LOCAL_NATIVE model/voice fact the renderer will need — a complete TTS model catalog (all piper models, repo-path ids, `num_speakers`), an extended `models_catalog` payload, rich built-in voice descriptors, and runtime speaker-id selection — all **additively**, so the current renderer keeps working unchanged.

**Architecture:** Pure-Python changes to `catalog.py` (TTS model rows + `num_speakers`), `accel.py` (`models_catalog` payload), `tts_backends.py` + `tts_engine.py` (sherpa `set_speaker(sid)` + a `set_voice {sid}` form), and `tts_voices.py` (voice metadata table + a new `list_builtin_voices()` descriptor function). Every change is additive: new fields, new functions, new message forms. The breaking `list_tts_voices` wire-shape change is deferred to Plan 2 (paired with its renderer consumer). The current renderer ignores the new `models_catalog` fields and never lists TTS models from it, so the app is unaffected by this plan.

**Tech Stack:** Python 3.10, `sherpa_onnx`, `huggingface_hub`, pytest. Spec: `docs/superpowers/specs/2026-06-30-native-model-metadata-single-source-design.md`.

## Global Constraints

- Sidecar tests run from the sidecar venv: `cd sidecar && .venv/bin/python -m pytest`. Never bare `pytest`.
- English only for all code, comments, and commit messages.
- Conventional-commit messages. Every commit ends with these two trailers verbatim:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS`
- Commits stay LOCAL. Do NOT push, open PRs, or mark anything ready.
- Every change in this plan is additive — do not remove or rename any existing function, field, or message form. The renderer must keep compiling and running against the sidecar after each task.
- TTS model ids are the **repo path** (e.g. `csukuangfj/vits-piper-en_US-amy-low`) so they match the renderer's persisted `ttsModel` values — no migration.

---

### Task 1: Complete the TTS catalog (repo-path ids + `num_speakers`)

Port every piper TTS model the renderer hardcodes in `src/lib/local-inference/native/nativeCatalog.ts` `NATIVE_TTS_BY_LANG` into the sidecar `TTS_MODELS`, using repo-path ids, and add a `num_speakers` field to `TtsModel`. The two existing short-id sherpa rows (`piper-en-amy`, `vits-icefall-zh-aishell3`) are replaced by repo-path-id rows.

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py:192-233` (`TtsModel` dataclass, `_sherpa_tts_row`, `TTS_MODELS`)
- Test: `sidecar/tests/test_catalog.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `TtsModel` gains `num_speakers: int = 1`.
  - `_sherpa_tts_row(mid, name, langs, repo, sort_order, sr, urls=(), recommended=False, num_speakers=1)`.
  - `catalog.tts_models()` returns MOSS + all piper models; piper ids are repo paths.

- [ ] **Step 1: Write the failing test**

Add to `sidecar/tests/test_catalog.py`:

```python
def test_tts_models_use_repo_path_ids_and_have_num_speakers():
    tts = {m.id: m for m in catalog.tts_models()}
    # MOSS keeps its short id; piper models are keyed by their HF repo path.
    assert "moss-tts-nano" in tts
    assert "csukuangfj/vits-piper-en_US-amy-low" in tts
    assert "csukuangfj/vits-piper-de_DE-thorsten-low" in tts
    # Every TTS model carries num_speakers >= 1, and a piper id IS its repo.
    for m in catalog.tts_models():
        assert m.num_speakers >= 1, f"{m.id} num_speakers"
    amy = tts["csukuangfj/vits-piper-en_US-amy-low"]
    assert amy.repos == ("csukuangfj/vits-piper-en_US-amy-low",)
    assert amy.num_speakers == 1
    # A multi-speaker model exposes a range.
    assert tts["csukuangfj/vits-piper-en_US-libritts_r-medium"].num_speakers > 1


def test_tts_languages_cover_the_renderer_set():
    langs = set()
    for m in catalog.tts_models():
        langs.update(m.languages)
    # Languages the renderer's NATIVE_TTS_BY_LANG offered must all survive.
    assert {"en", "de", "es", "fr", "it", "ru", "zh"} <= langs
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py::test_tts_models_use_repo_path_ids_and_have_num_speakers -v`
Expected: FAIL — `KeyError: 'csukuangfj/vits-piper-en_US-amy-low'` (only the short-id rows exist) or `AttributeError: num_speakers`.

- [ ] **Step 3: Add `num_speakers` to `TtsModel` and `_sherpa_tts_row`**

In `sidecar/sokuji_sidecar/catalog.py`, edit the `TtsModel` dataclass (lines 192-204) to add the field after `sort_order`:

```python
@dataclass(frozen=True)
class TtsModel:
    id: str
    name: str
    languages: tuple[str, ...]
    deployments: tuple[Deployment, ...]
    repos: tuple[str, ...] = ()      # HF repos to download
    urls: tuple[str, ...] = ()       # extra files (e.g. a vocoder .onnx)
    clones: bool = False             # zero-shot voice cloning from a reference clip
    streaming: bool = False          # intra-utterance audio-delta streaming
    sample_rate: int = 24000         # native rate (engine resamples to 24k)
    recommended: bool = False
    sort_order: int = 99
    num_speakers: int = 1            # 1 = single voice; >1 = a 0..N-1 speaker range
```

Edit `_sherpa_tts_row` (lines 207-212) to take and pass `num_speakers`:

```python
def _sherpa_tts_row(mid, name, langs, repo, sort_order, sr, urls=(), recommended=False, num_speakers=1):
    return TtsModel(mid, name, langs, (
        Deployment("sherpa_tts", "gpu-cuda", "fp32", repo, 1.0),
        Deployment("sherpa_tts", "cpu", "fp32", repo, 1.0),
    ), repos=(repo,), urls=tuple(urls), sample_rate=sr,
       recommended=recommended, sort_order=sort_order, num_speakers=num_speakers)
```

- [ ] **Step 4: Replace the piper rows in `TTS_MODELS` with the full repo-path-id list**

Replace the two existing `_sherpa_tts_row(...)` calls (lines 229-232) — keep the MOSS row untouched — with the full set ported from the renderer's `NATIVE_TTS_BY_LANG` (a piper repo's display name is its renderer label; `sr` heuristic: `-medium` → 22050, `-low`/`-x_low` → 16000; the runtime reads the model's real rate at load, so this is advisory):

```python
    # piper / vits single-voice models (one repo = one model = one voice).
    _sherpa_tts_row("csukuangfj/vits-piper-en_US-amy-low", "Amy (US)", ("en",),
                    "csukuangfj/vits-piper-en_US-amy-low", 10, 16000, recommended=True),
    _sherpa_tts_row("csukuangfj/vits-piper-en_US-libritts_r-medium", "LibriTTS (US)", ("en",),
                    "csukuangfj/vits-piper-en_US-libritts_r-medium", 11, 22050, num_speakers=904),
    _sherpa_tts_row("csukuangfj/vits-piper-en_US-ryan-low", "Ryan (US)", ("en",),
                    "csukuangfj/vits-piper-en_US-ryan-low", 12, 16000),
    _sherpa_tts_row("csukuangfj/vits-piper-en_US-lessac-medium", "Lessac (US)", ("en",),
                    "csukuangfj/vits-piper-en_US-lessac-medium", 13, 22050),
    _sherpa_tts_row("csukuangfj/vits-piper-en_GB-alan-low", "Alan (GB)", ("en",),
                    "csukuangfj/vits-piper-en_GB-alan-low", 14, 16000),
    _sherpa_tts_row("csukuangfj/vits-piper-de_DE-thorsten-low", "Thorsten", ("de",),
                    "csukuangfj/vits-piper-de_DE-thorsten-low", 15, 16000),
    _sherpa_tts_row("csukuangfj/vits-piper-de_DE-eva_k-x_low", "Eva K", ("de",),
                    "csukuangfj/vits-piper-de_DE-eva_k-x_low", 16, 16000),
    _sherpa_tts_row("csukuangfj/vits-piper-de_DE-kerstin-low", "Kerstin", ("de",),
                    "csukuangfj/vits-piper-de_DE-kerstin-low", 17, 16000),
    _sherpa_tts_row("csukuangfj/vits-piper-es_ES-davefx-medium", "DaveFX (ES)", ("es",),
                    "csukuangfj/vits-piper-es_ES-davefx-medium", 18, 22050),
    _sherpa_tts_row("csukuangfj/vits-piper-es_ES-carlfm-x_low", "CarlFM (ES)", ("es",),
                    "csukuangfj/vits-piper-es_ES-carlfm-x_low", 19, 16000),
    _sherpa_tts_row("csukuangfj/vits-piper-es_MX-ald-medium", "Ald (MX)", ("es",),
                    "csukuangfj/vits-piper-es_MX-ald-medium", 20, 22050),
    _sherpa_tts_row("csukuangfj/vits-piper-fr_FR-siwis-medium", "Siwis", ("fr",),
                    "csukuangfj/vits-piper-fr_FR-siwis-medium", 21, 22050),
    _sherpa_tts_row("csukuangfj/vits-piper-fr_FR-gilles-low", "Gilles", ("fr",),
                    "csukuangfj/vits-piper-fr_FR-gilles-low", 22, 16000),
    _sherpa_tts_row("csukuangfj/vits-piper-fr_FR-tom-medium", "Tom", ("fr",),
                    "csukuangfj/vits-piper-fr_FR-tom-medium", 23, 22050),
    _sherpa_tts_row("csukuangfj/vits-piper-it_IT-riccardo-x_low", "Riccardo", ("it",),
                    "csukuangfj/vits-piper-it_IT-riccardo-x_low", 24, 16000),
    _sherpa_tts_row("csukuangfj/vits-piper-it_IT-paola-medium", "Paola", ("it",),
                    "csukuangfj/vits-piper-it_IT-paola-medium", 25, 22050),
    _sherpa_tts_row("csukuangfj/vits-piper-ru_RU-denis-medium", "Denis", ("ru",),
                    "csukuangfj/vits-piper-ru_RU-denis-medium", 26, 22050),
    _sherpa_tts_row("csukuangfj/vits-piper-ru_RU-irina-medium", "Irina", ("ru",),
                    "csukuangfj/vits-piper-ru_RU-irina-medium", 27, 22050),
    _sherpa_tts_row("csukuangfj/vits-piper-ru_RU-dmitri-medium", "Dmitri", ("ru",),
                    "csukuangfj/vits-piper-ru_RU-dmitri-medium", 28, 22050),
    _sherpa_tts_row("csukuangfj/vits-piper-zh_CN-huayan-medium", "Huayan", ("zh",),
                    "csukuangfj/vits-piper-zh_CN-huayan-medium", 29, 22050),
    _sherpa_tts_row("csukuangfj/vits-icefall-zh-aishell3", "VITS (zh, aishell3)", ("zh",),
                    "csukuangfj/vits-icefall-zh-aishell3", 30, 16000, num_speakers=174),
```

- [ ] **Step 5: Confirm the multi-speaker counts (libritts_r, aishell3) against the real models**

These two rows declare `num_speakers` (904, 174). Verify them against the actual ONNX before trusting the slider range. If either model is downloaded in the sidecar cache, run (replace the repo as needed):

Run:
```bash
cd sidecar && .venv/bin/python -c "
import sherpa_onnx, os
from huggingface_hub import snapshot_download
for repo in ('csukuangfj/vits-piper-en_US-libritts_r-medium', 'csukuangfj/vits-icefall-zh-aishell3'):
    try:
        d = snapshot_download(repo_id=repo, local_files_only=True)
        onnx = next(f for f in os.listdir(d) if f.endswith('.onnx') and not f.endswith('.onnx.json'))
        cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=f'{d}/{onnx}', tokens=f'{d}/tokens.txt'), provider='cpu'))
        print(repo, sherpa_onnx.OfflineTts(cfg).num_speakers)
    except Exception as e:
        print(repo, 'not cached / skip:', e)
"
```
Expected: prints each repo's real `num_speakers`. If a printed value differs from the catalog (904 / 174), correct that row's `num_speakers=` to the printed integer. If a model isn't cached, leave the declared value (the slider max is advisory and can be corrected later).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -v`
Expected: PASS (all catalog tests, including the two new ones).

- [ ] **Step 7: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(sidecar): complete TTS catalog with repo-path ids + num_speakers

Port all piper TTS models into TTS_MODELS keyed by repo path (= renderer
selectId, no migration); add TtsModel.num_speakers (single piper=1, multi-speaker
libritts_r/aishell3 >1) so the catalog can drive the speaker-id voice control.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 2: Extend `models_catalog` payload (`kind=tts` + order/repo/kind + TTS fields)

`_h_models_catalog` today serves only `asr` / `translate` and emits `{id,name,languages,recommended,tiers}`. Add a `tts` kind and enrich every entry with `order`, `repo`, `kind`, and (TTS only) `numSpeakers`/`clones`/`streaming`. Additive — existing fields stay.

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py:654-672` (`_h_models_catalog`)
- Test: `sidecar/tests/test_accel.py`

**Interfaces:**
- Consumes: `catalog.tts_models()` with `num_speakers` (Task 1).
- Produces: `models_catalog_result.models[]` entries gain `order:int`, `repo:str`, `kind:str`; TTS entries also `numSpeakers:int`, `clones:bool`, `streaming:bool`.

- [ ] **Step 1: Write the failing test**

Add to `sidecar/tests/test_accel.py`:

```python
import asyncio
from sokuji_sidecar import accel


def _catalog(kind):
    state = {}; accel.register(state)
    reply, _ = asyncio.run(state["handlers"]["models_catalog"](
        state, {"id": 1, "type": "models_catalog", "kind": kind}, None, None))
    return {m["id"]: m for m in reply["models"]}


def test_models_catalog_asr_carries_order_repo_kind():
    asr = _catalog("asr")
    sv = asr["sense-voice"]
    assert sv["kind"] == "asr"
    assert isinstance(sv["order"], int)
    assert sv["repo"]  # non-empty default repo


def test_models_catalog_tts_kind_lists_models_with_voice_fields():
    tts = _catalog("tts")
    moss = tts["moss-tts-nano"]
    assert moss["kind"] == "tts" and moss["clones"] is True
    assert moss["numSpeakers"] >= 1 and "streaming" in moss
    amy = tts["csukuangfj/vits-piper-en_US-amy-low"]
    assert amy["clones"] is False and amy["numSpeakers"] == 1
    assert amy["repo"] == "csukuangfj/vits-piper-en_US-amy-low"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py::test_models_catalog_tts_kind_lists_models_with_voice_fields -v`
Expected: FAIL — `kind=tts` yields ASR models (the handler defaults non-`translate` to ASR), so `KeyError: 'moss-tts-nano'`.

- [ ] **Step 3: Implement the extended handler**

Replace `_h_models_catalog` (lines 654-672) in `sidecar/sokuji_sidecar/accel.py`:

```python
async def _h_models_catalog(state, msg, _b, conn=None):
    from . import catalog
    m = probe()
    kind = msg.get("kind", "asr")
    if kind == "translate":
        source = catalog.translate_models()
    elif kind == "tts":
        source = catalog.tts_models()
    else:
        source = catalog.asr_models()
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
        repo = mdl.repos[0] if kind == "tts" else mdl.deployments[0].artifact
        entry = {"id": mdl.id, "name": mdl.name, "languages": list(mdl.languages),
                 "recommended": mdl.recommended, "tiers": tiers,
                 "order": mdl.sort_order, "repo": repo, "kind": kind}
        if kind == "tts":
            entry["numSpeakers"] = mdl.num_speakers
            entry["clones"] = mdl.clones
            entry["streaming"] = mdl.streaming
        out.append(entry)
    return {"type": "models_catalog_result", "id": msg.get("id"), "models": out}, None
```

Also delete the obsolete note at `catalog.py:36-38` ("`sort_order` is advisory and NOT sent over the models_catalog wire ... renderer owns card ordering") — the sidecar now sends `order`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): models_catalog adds kind=tts + order/repo/kind + voice fields

models_catalog now serves TTS models and enriches every entry with order, repo,
and kind; TTS entries also carry numSpeakers/clones/streaming so the renderer can
pick the single/range/list voice control. Additive — existing fields unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 3: Sherpa speaker-id selection (`set_speaker` + `set_voice {sid}` form)

`SherpaTtsBackend.generate` hardcodes `sid=0`. Add `set_speaker(sid)`, have `generate` use the stored sid, give `MossOnnxTtsBackend` a no-op `set_speaker` (interface uniformity; MOSS uses named voices), expose `set_speaker` on `TtsEngine`, and add a `sid` form to `_h_set_voice`. Additive — existing forms unchanged.

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_backends.py:32-72` (`SherpaTtsBackend`), MOSS backend (add no-op)
- Modify: `sidecar/sokuji_sidecar/tts_engine.py:64-68` (engine wrapper), `:139-146` (`_h_set_voice`)
- Test: `sidecar/tests/test_tts_backends.py`, `sidecar/tests/test_tts_engine.py`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `SherpaTtsBackend.set_speaker(sid: int)` → stores `self._sid`; `generate`/`generate` use it.
  - `MossOnnxTtsBackend.set_speaker(sid)` → no-op.
  - `TtsEngine.set_speaker(sid: int)` → delegates to backend.
  - `_h_set_voice` with `{ "sid": n }` (no `voice`, no binary) → `engine.set_speaker(n)`.

- [ ] **Step 1: Write the failing tests**

Add to `sidecar/tests/test_tts_backends.py`:

```python
from sokuji_sidecar.tts_backends import SherpaTtsBackend


class _FakeOfflineTts:
    sample_rate = 16000
    def __init__(self): self.calls = []
    def generate(self, text, sid=0, speed=1.0):
        self.calls.append(sid)
        class _A: samples = [0.0]
        return _A()


def test_sherpa_generate_uses_selected_speaker():
    b = SherpaTtsBackend()
    b._tts = _FakeOfflineTts()
    b.set_speaker(7)
    b.generate("hello")
    assert b._tts.calls == [7]


def test_sherpa_defaults_to_speaker_zero():
    b = SherpaTtsBackend()
    b._tts = _FakeOfflineTts()
    b.generate("hello")
    assert b._tts.calls == [0]
```

Add to `sidecar/tests/test_tts_engine.py`:

```python
import asyncio
from sokuji_sidecar import tts_engine


def test_set_voice_sid_form_routes_to_set_speaker():
    seen = {}
    class _Eng:
        def set_speaker(self, sid): seen["sid"] = sid
        def set_builtin_voice(self, name): seen["name"] = name
        def set_voice(self, audio, sr): seen["clip"] = (len(audio), sr)
    state = {"tts_engine": _Eng(), "handlers": {}}
    tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["set_voice"](
        state, {"id": 3, "type": "set_voice", "sid": 5}, None, None))
    assert seen == {"sid": 5}
    assert reply == {"type": "ok", "id": 3}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_backends.py::test_sherpa_generate_uses_selected_speaker tests/test_tts_engine.py::test_set_voice_sid_form_routes_to_set_speaker -v`
Expected: FAIL — `AttributeError: 'SherpaTtsBackend' object has no attribute 'set_speaker'`; the handler ignores `sid`.

- [ ] **Step 3: Add speaker state to `SherpaTtsBackend`**

In `sidecar/sokuji_sidecar/tts_backends.py`, edit `SherpaTtsBackend.__init__` (lines 32-34) and `set_voice`/`generate` (lines 66-72):

```python
    def __init__(self):
        self._tts = None
        self.sample_rate = 16000
        self._sid = 0

    def set_voice(self, audio, sr):
        pass  # non-cloning

    def set_speaker(self, sid):
        self._sid = int(sid)

    def generate(self, text, speed=1.0):
        t0 = time.time()
        audio = self._tts.generate(text, sid=self._sid, speed=speed)
        return np.asarray(audio.samples, dtype=np.float32), int((time.time() - t0) * 1000)
```

- [ ] **Step 4: Add a no-op `set_speaker` to `MossOnnxTtsBackend`**

In the same file, inside `MossOnnxTtsBackend` next to `set_builtin_voice` (around line 167), add:

```python
    def set_speaker(self, sid):
        pass  # MOSS selects voices by name/clip, not a numeric speaker id
```

- [ ] **Step 5: Add `set_speaker` to the engine wrapper and the `sid` form to the handler**

In `sidecar/sokuji_sidecar/tts_engine.py`, add to the `TtsEngine` wrapper next to `set_builtin_voice` (lines 64-68):

```python
    def set_speaker(self, sid):
        self._backend.set_speaker(int(sid))
```

Replace `_h_set_voice` (lines 139-146) so the `sid` form is checked before the clip fallback:

```python
async def _h_set_voice(state, msg, binary_in, conn=None):
    name = msg.get("voice")
    sid = msg.get("sid")
    if name:                                  # built-in by name (no binary frame)
        state["tts_engine"].set_builtin_voice(str(name))
    elif sid is not None:                     # numeric speaker id (range models)
        state["tts_engine"].set_speaker(int(sid))
    else:                                     # custom clone from clip
        audio = np.frombuffer(binary_in, dtype=np.float32) if binary_in else np.zeros(0, np.float32)
        state["tts_engine"].set_voice(audio, int(msg.get("sampleRate", 24000)))
    return {"type": "ok", "id": msg.get("id")}, None
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_backends.py tests/test_tts_engine.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_backends.py sidecar/sokuji_sidecar/tts_engine.py sidecar/tests/test_tts_backends.py sidecar/tests/test_tts_engine.py
git commit -m "feat(sidecar): sherpa speaker-id selection (set_speaker + set_voice sid form)

SherpaTtsBackend.generate used a hardcoded sid=0; add set_speaker(sid) and a
set_voice {sid} message form so multi-speaker VITS models can pick a speaker.
MOSS gets a no-op set_speaker (it selects by name/clip). Additive.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

### Task 4: Built-in voice descriptors (`list_builtin_voices`) + voice metadata table

Add the sidecar-side voice metadata table (mirroring the renderer's `BUILTIN_VOICE_META` + `DEFAULT_VOICE_BY_LANG`) and a new `list_builtin_voices()` that returns rich descriptors. Keep the existing `list_builtin_voice_names()` (the `list_tts_voices` handler still uses it; Plan 2 swaps the handler to descriptors). Additive.

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_voices.py`
- Test: `sidecar/tests/test_tts_voices.py`

**Interfaces:**
- Consumes: `list_builtin_voice_names(model_id)` (existing).
- Produces: `tts_voices.list_builtin_voices(model_id=None) -> list[dict]`, each
  `{ "name": str, "language": str|None, "curated": bool, "unstable": bool, "default": bool }`.

- [ ] **Step 1: Write the failing test**

Add to `sidecar/tests/test_tts_voices.py`:

```python
def test_list_builtin_voices_annotates_names_with_metadata(monkeypatch):
    monkeypatch.setattr(tts_voices, "list_builtin_voice_names",
                        lambda model=None: ["Ava", "Adam", "Xiaoyu", "Mortis"])
    out = {v["name"]: v for v in tts_voices.list_builtin_voices("moss-tts-nano")}
    assert out["Ava"] == {"name": "Ava", "language": "en", "curated": True,
                          "unstable": False, "default": True}
    assert out["Adam"]["unstable"] is True and out["Adam"]["curated"] is False
    assert out["Xiaoyu"]["default"] is True and out["Xiaoyu"]["language"] == "zh"
    # A voice with no language entry is never a per-language default.
    assert out["Mortis"]["language"] is None and out["Mortis"]["default"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_voices.py::test_list_builtin_voices_annotates_names_with_metadata -v`
Expected: FAIL — `AttributeError: module 'sokuji_sidecar.tts_voices' has no attribute 'list_builtin_voices'`.

- [ ] **Step 3: Add the metadata table and descriptor function**

Append to `sidecar/sokuji_sidecar/tts_voices.py`:

```python
# Built-in MOSS voice curation — our editorial product judgment (mirrors the old
# renderer BUILTIN_VOICE_META). Quality verified for English (Ava reliably clean);
# others are best-effort by language. Unstable voices stay reachable behind
# "show all" (see issue #277).
_VOICE_META = {
    "Ava":    {"language": "en", "curated": True},
    "Bella":  {"language": "en", "curated": True},
    "Adam":   {"language": "en", "unstable": True},
    "Nathan": {"language": "en"},
    "Trump":  {"language": "en"},
    "Xiaoyu": {"language": "zh", "curated": True},
    "Yuewen": {"language": "zh", "curated": True},
    "Lingyu": {"language": "zh"},
    "Junhao": {"language": "zh"},
    "Zhiming":{"language": "zh", "unstable": True},
    "Weiguo": {"language": "zh"},
    "Saki":   {"language": "ja", "curated": True},
    "Soyo":   {"language": "ja", "curated": True},
    "Umiri":  {"language": "ja"},
    "Mei":    {"language": "ja"},
    "Anon":   {"language": "ja", "unstable": True},
    "Arisa":  {"language": "ja"},
    "Mortis": {"unstable": True},
}
_DEFAULT_VOICE_BY_LANG = {"en": "Ava", "zh": "Xiaoyu", "ja": "Saki"}


def list_builtin_voices(model_id=None):
    """Rich built-in voice descriptors: each manifest voice name annotated with
    our curation metadata. [] when the model isn't downloaded. The single source
    of built-in voice facts for the renderer (replaces its BUILTIN_VOICE_META)."""
    out = []
    for name in list_builtin_voice_names(model_id):
        meta = _VOICE_META.get(name, {})
        lang = meta.get("language")
        out.append({
            "name": name,
            "language": lang,
            "curated": bool(meta.get("curated")),
            "unstable": bool(meta.get("unstable")),
            "default": (_DEFAULT_VOICE_BY_LANG.get(lang) == name) if lang else False,
        })
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_voices.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_voices.py sidecar/tests/test_tts_voices.py
git commit -m "feat(sidecar): list_builtin_voices descriptors + voice metadata table

Move the MOSS built-in voice curation (language/curated/unstable/default) into the
sidecar and expose list_builtin_voices() returning rich descriptors — the single
source the renderer will read instead of its hardcoded BUILTIN_VOICE_META. Keeps
list_builtin_voice_names() (handler swap happens in Plan 2).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FwG2ZVytakArmYteZcoutS"
```

---

## Final check

Run the full sidecar suite to confirm no regression:

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: PASS (all pre-existing tests + the new ones).

This plan leaves the wire **additive**: the renderer still works unchanged (it ignores the new `models_catalog` fields, doesn't list TTS models from it, and `list_tts_voices` still returns `string[]`). Plan 2 flips the renderer onto this data and makes the `list_tts_voices` descriptor swap together with its consumer.
