# Native Supertonic-3 TTS + Voice Capability Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a native TTS voice-capability model (`voice: { builtin, custom }`, single-sourced from the sidecar) that drives all native voice UI/storage/apply; retrofit MOSS/VITS/Piper onto it; add Supertonic 3 as the first `custom: 'style'` model.

**Architecture:** The sidecar catalog declares each TTS model's `voice` capability; the renderer derives control + storage + apply from it (no per-model branches). A uniform `NativeVoiceStore` (clip over `nativeVoiceStorage`, style over `voiceStorage`) is selected by `custom` kind. `SupertonicBackend` ports the WASM worker's 4-stage diffusion pipeline (fp32, CPU/CUDA EP).

**Tech Stack:** Python `onnxruntime`/`numpy`/`huggingface_hub` (shared venv, no new dep); React/TypeScript; pytest + vitest.

## Global Constraints

- TypeScript strict; English-only comments. Conventional commits.
- Correctness gate: sidecar `cd sidecar && .venv/bin/python -m pytest -q`; renderer `npx vitest run <path>`. `tsc` is NOT a gate.
- No new sidecar dependency (onnxruntime, shared cu128 venv). GPU = CUDA EP; CPU floor. Both Supertonic tiers ship.
- Ship the published Supertonic **fp32** ONNX as-is (no self-export/fp16).
- **No behavior change** for MOSS/VITS/Piper — the retrofit is structural. Add characterization tests before relocating logic.
- Capability enums: `builtin ∈ {none, range, named}`, `custom ∈ {none, clip, style}`. Map: Piper `{none,none}`, VITS `{range,none}`, MOSS `{named,clip}`, Supertonic `{named,style}`.
- `ttsVoice` scheme unchanged & uniform: `builtin:<Name>` / `custom:<id>` (active store key) / `sid:<n>` / `''`. WASM `sidMapping` (sid+10) is NOT used natively.
- Preset names/genders match the WASM manifest: sid `[F1..F5,M1..M5]` → `[Sarah,Lily,Jessica,Olivia,Emily,Alex,James,Robert,Sam,Daniel]`, gender `F×5,M×5`; `defaultSid=7` (Robert); `totalStep=16`.
- Commits stay LOCAL (no push/PR).

## File structure

**Sidecar:** NEW `supertonic_frontend.py`; MODIFY `tts_backends.py`, `catalog.py`, `native_models.py`, `accel.py`, `tts_voices.py`, `tts_engine.py`.
**Renderer:** NEW `lib/local-inference/native/nativeVoiceStores.ts`; MODIFY `nativeProtocol.ts`, `NativeTtsClient.ts`, `nativeCatalog.ts`, `nativeTtsVoiceReconciliation.ts`, `components/Settings/sections/NativeVoiceSection.tsx`, `NativeModelManagementSection.tsx`, `services/clients/LocalNativeClient.ts`. REUSE unchanged: `VoiceLibrarySection.tsx`, `voiceStorage.ts`, `nativeVoiceStorage.ts`.

---

## Phase A — Sidecar backend & capability

### Task 1: Supertonic text frontend (pure)

**Files:** Create `sidecar/sokuji_sidecar/supertonic_frontend.py`; Test `sidecar/tests/test_supertonic_frontend.py`
**Interfaces — Produces:** `preprocess_text(text, lang, available_langs: set) -> str`; `apply_indexer(text, indexer: list) -> list[int]` (`indexer[charcode]`; `-1`→`0`).

- [ ] **Step 1: Failing test**

```python
# sidecar/tests/test_supertonic_frontend.py
from sokuji_sidecar.supertonic_frontend import preprocess_text, apply_indexer
AVAIL = {"en", "ko", "ja", "de", "es", "fr", "it", "ru"}

def test_preprocess_wraps_supported_lang_and_normalizes():
    assert preprocess_text("Hello  world", "en", AVAIL) == "<en>Hello world.</en>"

def test_preprocess_unsupported_lang_falls_back_to_na():
    assert preprocess_text("Hola", "xx", AVAIL) == "<na>Hola.</na>"

def test_apply_indexer_maps_charcodes_and_drops_unsupported():
    idx = [-1] * 128; idx[ord("A")] = 5
    assert apply_indexer("A", idx) == [5]
    assert apply_indexer("B", idx) == [0]
```

- [ ] **Step 2: Run → FAIL** — `cd sidecar && .venv/bin/python -m pytest tests/test_supertonic_frontend.py -q` (ModuleNotFoundError).

- [ ] **Step 3: Implement** (port of worker `preprocessText`/`applyIndexer`)

```python
# sidecar/sokuji_sidecar/supertonic_frontend.py
"""Supertonic 3 text frontend — torch-free port of the WASM worker's
preprocessText + applyIndexer (supertonic-tts.worker.ts)."""
import re
import unicodedata

_EMOJI = re.compile(
    "[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F77F\U0001F780-\U0001F7FF\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF\U0001FA00-\U0001FA6F\U0001FA70-\U0001FAFF"
    "☀-⛿✀-➿\U0001F1E6-\U0001F1FF]+")
_REPLACE = {"–": "-", "‑": "-", "—": "-", "_": " ", "“": '"', "”": '"',
            "‘": "'", "’": "'", "´": "'", "`": "'", "[": " ", "]": " ",
            "|": " ", "/": " ", "#": " ", "→": " ", "←": " "}
_EXPR = {"@": " at ", "e.g.,": "for example,", "i.e.,": "that is,"}
_TERMINAL = set(".!?;:,'\")]}…。」』】〉》›»")


def preprocess_text(text, lang, available_langs):
    text = unicodedata.normalize("NFKD", text)
    text = _EMOJI.sub("", text)
    for k, v in _REPLACE.items():
        text = text.replace(k, v)
    text = re.sub(r"[♥☆♡©\\]", "", text)
    for k, v in _EXPR.items():
        text = text.replace(k, v)
    for a, b in ((" ,", ","), (" .", "."), (" !", "!"), (" ?", "?"),
                 (" ;", ";"), (" :", ":"), (" '", "'")):
        text = text.replace(a, b)
    for dup in ('""', "''", "``"):
        while dup in text:
            text = text.replace(dup, dup[0])
    text = re.sub(r"\s+", " ", text).strip()
    if not text or text[-1] not in _TERMINAL:
        text += "."
    eff = lang if lang in available_langs else None
    return f"<{eff}>{text}</{eff}>" if eff else f"<na>{text}</na>"


def apply_indexer(text, indexer):
    out = []
    for ch in text:
        c = ord(ch)
        v = indexer[c] if 0 <= c < len(indexer) else -1
        out.append(v if v is not None and v >= 0 else 0)
    return out
```

- [ ] **Step 4: Run → PASS** — same command, 3 pass.
- [ ] **Step 5: Commit** — `git add sidecar/sokuji_sidecar/supertonic_frontend.py sidecar/tests/test_supertonic_frontend.py && git commit -m "feat(sidecar): Supertonic text frontend"`

---

### Task 2: `SupertonicBackend` load + generate

**Files:** Modify `sidecar/sokuji_sidecar/tts_backends.py`; Test `sidecar/tests/test_supertonic_backend.py`
**Interfaces — Consumes:** `supertonic_frontend`, `register_backend`, `BackendLoadError`. **Produces:** `SupertonicBackend` (`NAME="supertonic"`, `STREAMING=False`, `CLONES=False`, `sample_rate`, `load`, `set_language`, `generate(text,speed)->(np.float32,int)`, `unload`, `is_loaded`).

- [ ] **Step 1: Failing test** (fake sessions — no download)

```python
# sidecar/tests/test_supertonic_backend.py
import numpy as np
from sokuji_sidecar.tts_backends import SupertonicBackend
CHUNK = 512 * 6

class _FakeSession:
    def __init__(self, out): self._out = out
    def get_outputs(self): return [type("O", (), {"name": self._out})()]
    def run(self, names, feeds):
        if "style_dp" in feeds: return [np.array([0.2], np.float32)]      # duration
        if "style_ttl" in feeds and "text_ids" in feeds: return [np.zeros((1, 4, 256), np.float32)]  # text_enc
        if "noisy_latent" in feeds: return [feeds["noisy_latent"]]        # vector_estimator
        return [np.zeros((1, feeds["latent"].shape[2] * CHUNK), np.float32)]  # vocoder

def _install(b):
    b._sess = {"dp": _FakeSession("duration"), "tenc": _FakeSession("text_emb"),
               "vest": _FakeSession("denoised_latent"), "voc": _FakeSession("wav_tts")}
    b._cfg = {"ae": {"sample_rate": 44100, "base_chunk_size": 512},
              "ttl": {"latent_dim": 24, "chunk_compress_factor": 6}}
    b._indexer = [1] * 70000
    b._voice = (np.zeros((1, 50, 256), np.float32), np.zeros((1, 8, 16), np.float32))
    b.sample_rate = 44100; b._total_step = 2

def test_generate_returns_float32_44k():
    b = SupertonicBackend(); _install(b); b.set_language("en")
    samples, ms = b.generate("Hello world.", 1.0)
    assert samples.dtype == np.float32 and samples.ndim == 1 and samples.size > 0
    assert isinstance(ms, int)

def test_backend_flags():
    assert (SupertonicBackend.NAME, SupertonicBackend.STREAMING, SupertonicBackend.CLONES) == ("supertonic", False, False)
```

- [ ] **Step 2: Run → FAIL** — `cd sidecar && .venv/bin/python -m pytest tests/test_supertonic_backend.py -q` (ImportError).

- [ ] **Step 3: Implement** — append to `tts_backends.py`

```python
# --- appended to sidecar/sokuji_sidecar/tts_backends.py ---
import json as _json
from . import supertonic_frontend as _sf

_SUPERTONIC_PRESET_CODES = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]
SUPERTONIC_VOICE_NAMES = ["Sarah", "Lily", "Jessica", "Olivia", "Emily",
                          "Alex", "James", "Robert", "Sam", "Daniel"]
_SUPERTONIC_GENDERS = ["F"] * 5 + ["M"] * 5
_SUPERTONIC_AVAILABLE_LANGS = {
    "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr",
    "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk",
    "sl", "sv", "tr", "uk", "vi"}


@register_backend
class SupertonicBackend:
    """Supertonic 3: non-AR 4-stage raw-onnxruntime diffusion TTS (port of
    supertonic-tts.worker.ts). provider='cuda' on GPU else cpu. Non-streaming,
    non-cloning; voices are pre-computed style vectors (10 presets + uploaded
    custom JSONs via set_style_voice)."""
    NAME = "supertonic"
    STREAMING = False
    CLONES = False
    _MODEL_FILES = {"dp": "onnx/duration_predictor.onnx", "tenc": "onnx/text_encoder.onnx",
                    "vest": "onnx/vector_estimator.onnx", "voc": "onnx/vocoder.onnx"}

    def __init__(self):
        self._sess = None; self._cfg = None; self._indexer = None
        self._presets = None; self._voice = None
        self.sample_rate = 44100; self._total_step = 16; self._default_sid = 7; self._lang = ""

    def load(self, model_ref, device, compute_type):
        self._sess = None
        try:
            import onnxruntime as ort
            from huggingface_hub import snapshot_download
            d = snapshot_download(repo_id=model_ref, local_files_only=True)
            provider = (["CUDAExecutionProvider", "CPUExecutionProvider"]
                        if device == "cuda" else ["CPUExecutionProvider"])
            opts = ort.SessionOptions()
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.log_severity_level = 3
            opts.intra_op_num_threads = int(os.environ.get("SOKUJI_TTS_THREADS", "4"))
            self._sess = {k: ort.InferenceSession(f"{d}/{f}", sess_options=opts, providers=provider)
                          for k, f in self._MODEL_FILES.items()}
            with open(f"{d}/onnx/tts.json") as fh: self._cfg = _json.load(fh)
            with open(f"{d}/onnx/unicode_indexer.json") as fh: self._indexer = _json.load(fh)
            self.sample_rate = int(self._cfg["ae"]["sample_rate"])
            self._presets = {}
            for sid, code in enumerate(_SUPERTONIC_PRESET_CODES):
                with open(f"{d}/voice_styles/{code}.json") as fh: vj = _json.load(fh)
                self._presets[sid] = (self._as_tensor(vj["style_ttl"]), self._as_tensor(vj["style_dp"]))
            self._voice = self._presets[self._default_sid]
        except Exception as e:
            raise BackendLoadError(str(e))

    @staticmethod
    def _as_tensor(field):
        return np.asarray(field["data"], dtype=np.float32).reshape(field["dims"])

    def set_language(self, lang):
        self._lang = (lang or "").split("-")[0].lower()

    def _run(self, key, feeds):
        s = self._sess[key]; names = [o.name for o in s.get_outputs()]
        return dict(zip(names, s.run(names, feeds)))

    def generate(self, text, speed=1.0):
        t0 = time.time()
        style_ttl, style_dp = self._voice
        base = self._cfg["ae"]["base_chunk_size"]; ccf = self._cfg["ttl"]["chunk_compress_factor"]
        chunk = base * ccf; latent_dim = self._cfg["ttl"]["latent_dim"] * ccf
        processed = _sf.preprocess_text(text, self._lang, _SUPERTONIC_AVAILABLE_LANGS)
        text_ids = np.array([_sf.apply_indexer(processed, self._indexer)], dtype=np.int64)
        text_mask = np.ones((1, 1, text_ids.shape[1]), dtype=np.float32)
        dur = self._run("dp", {"text_ids": text_ids, "style_dp": style_dp, "text_mask": text_mask})
        d = float(np.asarray(next(iter(dur.values()))).reshape(-1)[0])
        if speed and speed > 0: d = d / speed
        tenc = self._run("tenc", {"text_ids": text_ids, "style_ttl": style_ttl, "text_mask": text_mask})
        text_emb = next(iter(tenc.values())).astype(np.float32)
        wav_len = int(d * self.sample_rate)
        latent_len = max(1, (wav_len + chunk - 1) // chunk)
        lat = (np.random.randn(1, latent_dim, latent_len) * np.sqrt(0.7)).astype(np.float32)
        latent_mask = np.ones((1, 1, latent_len), dtype=np.float32)
        total_step = np.array([self._total_step], dtype=np.float32)
        for step in range(self._total_step):
            r = self._run("vest", {"noisy_latent": lat, "text_emb": text_emb, "style_ttl": style_ttl,
                                   "latent_mask": latent_mask, "text_mask": text_mask,
                                   "current_step": np.array([step], dtype=np.float32), "total_step": total_step})
            lat = next(iter(r.values())).astype(np.float32)
        voc = self._run("voc", {"latent": lat})
        wav = np.asarray(next(iter(voc.values())), dtype=np.float32).reshape(-1)
        return (wav[:wav_len] if 0 < wav_len <= wav.size else wav), int((time.time() - t0) * 1000)

    def unload(self):
        self._sess = None; self._presets = None; self._voice = None

    @property
    def is_loaded(self):
        return self._sess is not None
```

- [ ] **Step 4: Run → PASS** — 2 pass.
- [ ] **Step 5: Commit** — `git add sidecar/sokuji_sidecar/tts_backends.py sidecar/tests/test_supertonic_backend.py && git commit -m "feat(sidecar): SupertonicBackend 4-stage generate"`

---

### Task 3: `SupertonicBackend` voice selection

**Files:** Modify `tts_backends.py`; Test extend `test_supertonic_backend.py`
**Interfaces — Produces:** `set_speaker(sid)`, `set_builtin_voice(name)`, `set_style_voice(style_ttl, style_dp)`, `list_builtin_voices() -> [{"voice","gender"}]`.

- [ ] **Step 1: Failing test**

```python
# append to test_supertonic_backend.py
from sokuji_sidecar.tts_backends import SUPERTONIC_VOICE_NAMES

def test_set_speaker_and_builtin_select_presets():
    b = SupertonicBackend()
    b._presets = {i: (np.full((1,50,256), i, np.float32), np.full((1,8,16), i, np.float32)) for i in range(10)}
    b._default_sid = 7
    b.set_speaker(3); assert b._voice[0][0,0,0] == 3
    b.set_builtin_voice("Alex"); assert b._voice[0][0,0,0] == 5
    b.set_speaker(99); assert b._voice[0][0,0,0] == 7

def test_set_style_voice_applies_arrays():
    b = SupertonicBackend()
    b.set_style_voice(np.ones((1,50,256), np.float32), np.ones((1,8,16), np.float32))
    assert b._voice[0].shape == (1,50,256) and b._voice[1].shape == (1,8,16)

def test_list_builtin_voices():
    v = SupertonicBackend().list_builtin_voices()
    assert [x["voice"] for x in v] == SUPERTONIC_VOICE_NAMES
    assert [x["gender"] for x in v] == ["F"]*5 + ["M"]*5
```

- [ ] **Step 2: Run → FAIL** (cannot import `SUPERTONIC_VOICE_NAMES` — already defined in Task 2, so the failure is the missing methods → `AttributeError`).
- [ ] **Step 3: Implement** — add methods to `SupertonicBackend`

```python
    def set_speaker(self, sid):
        if self._presets is None: return
        self._voice = self._presets.get(int(sid), self._presets[self._default_sid])

    def set_builtin_voice(self, name):
        try: self.set_speaker(SUPERTONIC_VOICE_NAMES.index(name))
        except ValueError: self.set_speaker(self._default_sid)

    def set_style_voice(self, style_ttl, style_dp):
        self._voice = (np.asarray(style_ttl, dtype=np.float32), np.asarray(style_dp, dtype=np.float32))

    @staticmethod
    def list_builtin_voices():
        return [{"voice": n, "gender": g} for n, g in zip(SUPERTONIC_VOICE_NAMES, _SUPERTONIC_GENDERS)]
```

- [ ] **Step 4: Run → PASS** (5 pass).
- [ ] **Step 5: Commit** — `git commit -am "feat(sidecar): Supertonic preset/style voice selection"`

---

### Task 4: Catalog capability model + rows

**Files:** Modify `sidecar/sokuji_sidecar/catalog.py`; Test extend `sidecar/tests/test_catalog.py`
**Interfaces — Produces:** `TtsModel` gains `named_voices: bool=False`, `style_voices: bool=False`. `catalog.voice_capability(model) -> {"builtin": str, "custom": str}`. MOSS row gets `named_voices=True`; Supertonic row added (`named_voices=True, style_voices=True`).

- [ ] **Step 1: Failing test**

```python
# append to sidecar/tests/test_catalog.py
from sokuji_sidecar import catalog

def test_voice_capability_map():
    cap = catalog.voice_capability
    assert cap(catalog.tts_model("moss-tts-nano")) == {"builtin": "named", "custom": "clip"}
    assert cap(catalog.tts_model("supertonic-3")) == {"builtin": "named", "custom": "style"}
    assert cap(catalog.tts_model("csukuangfj/vits-icefall-zh-aishell3")) == {"builtin": "range", "custom": "none"}
    assert cap(catalog.tts_model("csukuangfj/vits-piper-en_US-amy-low")) == {"builtin": "none", "custom": "none"}

def test_supertonic_row():
    m = catalog.tts_model("supertonic-3")
    assert m and m.num_speakers == 10 and m.sample_rate == 44100
    assert m.clones is False and m.style_voices is True and m.named_voices is True
    assert m.repos == ("Supertone/supertonic-3",)
    assert {d.backend for d in m.deployments} == {"supertonic"}
    assert {d.tier for d in m.deployments} == {"gpu-cuda", "cpu"}
```

- [ ] **Step 2: Run → FAIL** — `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -q` (no `voice_capability`, no row).
- [ ] **Step 3: Implement** — in `catalog.py`

```python
# in class TtsModel(_ModelBase): add after num_speakers
    named_voices: bool = False       # has named preset voices (dropdown), not a bare sid range
    style_voices: bool = False       # custom voices are uploaded style-vector JSONs (Supertonic)

# module-level helper (near tts_model)
def voice_capability(model: "TtsModel") -> dict:
    """Two-axis native voice capability derived from static catalog facts.
    builtin: named (preset dropdown) | range (sid slider) | none (single voice).
    custom:  clip (reference audio)  | style (uploaded JSON) | none."""
    custom = "clip" if model.clones else "style" if model.style_voices else "none"
    builtin = "named" if model.named_voices else "range" if model.num_speakers > 1 else "none"
    return {"builtin": builtin, "custom": custom}

# near _MOSS_NANO_LM_REPO
SUPERTONIC_LANGS = ("en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et",
                    "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl",
                    "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi")

# on the MOSS TtsModel(...) row, add named_voices=True (keep clones=True):
#   clones=True, streaming=True, named_voices=True, sample_rate=48000, ...

# append this row to TTS_MODELS (after MOSS, before the piper rows):
    TtsModel("supertonic-3", "Supertonic 3", SUPERTONIC_LANGS,
             (Deployment("supertonic", "gpu-cuda", "fp32", "Supertone/supertonic-3", 1.0),
              Deployment("supertonic", "cpu", "fp32", "Supertone/supertonic-3", 1.0)),
             repos=("Supertone/supertonic-3",), clones=False, streaming=False,
             named_voices=True, style_voices=True, sample_rate=44100, num_speakers=10,
             recommended=True, sort_order=1, size_bytes=400_600_000),
```

- [ ] **Step 4: Run → PASS** — `tests/test_catalog.py` all green.
- [ ] **Step 5: Commit** — `git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py && git commit -m "feat(sidecar): voice_capability model + Supertonic row + MOSS named flag"`

---

### Task 5: Download ignore + Task 6: resolver install

*(Two small sidecar edits; one task each is overkill — bundle as one deliverable with two tests.)*

**Files:** Modify `native_models.py`, `accel.py`; Test extend `test_native_models.py`, `test_accel.py`

- [ ] **Step 1: Failing tests**

```python
# test_native_models.py
def test_supertonic_download_ignores_samples_and_images():
    spec = native_models.download_specs("supertonic-3")
    assert "Supertone/supertonic-3" in spec["repos"]
    assert "audio_samples/*" in spec.get("ignore", []) and "img/*" in spec.get("ignore", [])

# test_accel.py
def test_supertonic_installed_and_resolvable():
    assert "supertonic" in accel._installed()
    plans = accel.resolve_tts("supertonic-3", override="cpu")
    assert plans and plans[0].backend == "supertonic"
```

- [ ] **Step 2: Run → FAIL** (no ignore; supertonic not installed).
- [ ] **Step 3: Implement**
  - `native_models.py` `_base_specs`, in the catalog-model branch:
    ```python
    if _tm is not None:
        spec = {"repos": list(_tm.repos), "urls": list(_tm.urls)}
        if model_id == "supertonic-3":
            spec["ignore"] = ["audio_samples/*", "img/*"]
        return spec
    ```
    Confirm `download()` passes `ignore_patterns=spec.get("ignore")` to `snapshot_download` (grep `snapshot_download` in `native_models.py`; wire it if missing).
  - `accel.py` `_installed` `mods` dict: add `"supertonic": "onnxruntime",`.
- [ ] **Step 4: Run → PASS** — `tests/test_native_models.py tests/test_accel.py` green.
- [ ] **Step 5: Commit** — `git commit -am "feat(sidecar): Supertonic download ignore + resolver install"`

---

### Task 7: `list_tts_voices` Supertonic presets

**Files:** Modify `tts_voices.py`; Test extend `test_tts_voices.py`
**Interfaces — Produces:** `list_builtin_voices("supertonic-3")` returns 10 presets `{name, language:None, gender, curated:True, unstable:False, default:(name=="Robert")}` without a download.

- [ ] **Step 1: Failing test**

```python
# append to test_tts_voices.py
def test_supertonic_presets_without_download():
    v = tts_voices.list_builtin_voices("supertonic-3")
    assert [x["name"] for x in v] == ["Sarah","Lily","Jessica","Olivia","Emily","Alex","James","Robert","Sam","Daniel"]
    assert next(x for x in v if x["name"] == "Robert")["default"] is True
    assert all(x["gender"] in ("F","M") for x in v)
```

- [ ] **Step 2: Run → FAIL** (Supertonic id → MOSS-manifest path → []).
- [ ] **Step 3: Implement** — at the top of `list_builtin_voices`

```python
def list_builtin_voices(model_id=None):
    from . import catalog
    m = catalog.tts_model(model_id) if model_id else None
    if m is not None and getattr(m, "style_voices", False):
        from .tts_backends import SupertonicBackend
        return [{"name": x["voice"], "language": None, "gender": x["gender"],
                 "curated": True, "unstable": False, "default": (x["voice"] == "Robert")}
                for x in SupertonicBackend.list_builtin_voices()]
    out = []
    # ... existing MOSS loop unchanged ...
```

- [ ] **Step 4: Run → PASS** — `tests/test_tts_voices.py` green.
- [ ] **Step 5: Commit** — `git commit -am "feat(sidecar): list_tts_voices Supertonic presets"`

---

### Task 8: Thread language + decode `styleVoice` + emit `voice` in catalog

**Files:** Modify `tts_engine.py`, `accel.py`; Test `sidecar/tests/test_tts_engine_supertonic.py`
**Interfaces — Produces:** `TtsEngine.init(...)` calls `backend.set_language(language)` when supported; `TtsEngine.set_style_voice(ttl, dp)`; `_h_set_voice` decodes the `styleVoice` binary variant. `accel._h_models_catalog` emits `"voice": catalog.voice_capability(mdl)` for tts models.

- [ ] **Step 1: Failing test**

```python
# sidecar/tests/test_tts_engine_supertonic.py
import numpy as np
from sokuji_sidecar import tts_engine

class _Rec:
    def __init__(self): self.style = None
    def set_style_voice(self, ttl, dp): self.style = (ttl, dp)

async def test_set_voice_style_variant_decodes():
    ttl = np.arange(50*256, dtype=np.float32); dp = np.arange(8*16, dtype=np.float32)
    rec = _Rec()
    state = {"tts_engine": rec}
    msg = {"type": "set_voice", "styleVoice": {"ttlDims": [1,50,256], "dpDims": [1,8,16]}}
    await tts_engine._h_set_voice(state, msg, ttl.tobytes() + dp.tobytes(), conn=None)
    assert rec.style[0].shape == (1,50,256) and rec.style[1].shape == (1,8,16)
    assert rec.style[1].flatten()[-1] == 8*16 - 1
```

*(Language threading is exercised via `SupertonicBackend.set_language` in Task 2; init-level threading is verified by `hasattr` guard code review + the full-suite run.)*

- [ ] **Step 2: Run → FAIL** (`_h_set_voice` ignores `styleVoice`).
- [ ] **Step 3: Implement** — in `tts_engine.py`
  - In `TtsEngine.init`, after the backend is resolved: `if hasattr(self._backend, "set_language"): self._backend.set_language(language or "")`.
  - Add `def set_style_voice(self, ttl, dp): self._backend.set_style_voice(ttl, dp)` on `TtsEngine`.
  - In `_h_set_voice`, BEFORE the name/sid/clip branches:
    ```python
    style = msg.get("styleVoice")
    if style is not None:
        import numpy as _np
        buf = _np.frombuffer(binary_in or b"", dtype=_np.float32)
        n = int(_np.prod(style["ttlDims"]))
        ttl = buf[:n].reshape(style["ttlDims"]).astype(_np.float32)
        dp = buf[n:n + int(_np.prod(style["dpDims"]))].reshape(style["dpDims"]).astype(_np.float32)
        state["tts_engine"].set_style_voice(ttl, dp)
        return {"type": "ok", "id": msg.get("id")}, None
    ```
  - In `accel.py` `_h_models_catalog`, for the tts kind, add `entry["voice"] = catalog.voice_capability(mdl)` (mirror the existing `numSpeakers`/`clones` emission).
- [ ] **Step 4: Run → PASS**; then **full sidecar suite** `cd sidecar && .venv/bin/python -m pytest -q` → all green.
- [ ] **Step 5: Commit** — `git add sidecar/sokuji_sidecar/tts_engine.py sidecar/sokuji_sidecar/accel.py sidecar/tests/test_tts_engine_supertonic.py && git commit -m "feat(sidecar): language threading, styleVoice decode, emit voice capability"`

---

## Phase B — Renderer capability retrofit

### Task 9: Protocol + `setStyleVoice`

**Files:** Modify `nativeProtocol.ts`, `NativeTtsClient.ts`; Test extend `NativeTtsClient.test.ts`
**Interfaces — Produces:** `NativeModelInfo.voice?: { builtin: 'none'|'range'|'named'; custom: 'none'|'clip'|'style' }`; `set_voice` message `styleVoice?: { ttlDims:number[]; dpDims:number[] }`; `NativeTtsClient.setStyleVoice(styleTtl:{dims,data}, styleDp:{dims,data})`.

- [ ] **Step 1: Failing test** (reuse the file's `FakeWS`, capturing binary + json frames)

```typescript
it('setStyleVoice sends a binary frame then a styleVoice control message', async () => {
  // Using the existing FakeWS harness: capture ArrayBuffer sends into `bins`, JSON into `sent`.
  const c = /* connected NativeTtsClient */;
  await c.setStyleVoice({ dims: [1, 2], data: [1, 2] }, { dims: [1, 1], data: [9] });
  expect(new Float32Array(bins.at(-1)!)).toEqual(new Float32Array([1, 2, 9]));
  expect(sent.find((m) => m.styleVoice)!.styleVoice).toEqual({ ttlDims: [1, 2], dpDims: [1, 1] });
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/lib/local-inference/native/NativeTtsClient.test.ts`.
- [ ] **Step 3: Implement**

```typescript
// nativeProtocol.ts — add to NativeModelInfo:
//   voice?: { builtin: 'none' | 'range' | 'named'; custom: 'none' | 'clip' | 'style' };
// and to the set_voice client message shape:
//   styleVoice?: { ttlDims: number[]; dpDims: number[] };

// NativeTtsClient.ts — after setReferenceVoice:
  async setStyleVoice(styleTtl: { dims: number[]; data: number[] },
                      styleDp: { dims: number[]; data: number[] }): Promise<void> {
    const ttl = Float32Array.from(styleTtl.data), dp = Float32Array.from(styleDp.data);
    const buf = new Float32Array(ttl.length + dp.length);
    buf.set(ttl, 0); buf.set(dp, ttl.length);
    this.ws!.send(buf.buffer);
    await this.send({ type: 'set_voice', styleVoice: { ttlDims: styleTtl.dims, dpDims: styleDp.dims } });
  }
```

- [ ] **Step 4: Run → PASS**.
- [ ] **Step 5: Commit** — `git add src/lib/local-inference/native/nativeProtocol.ts src/lib/local-inference/native/NativeTtsClient.ts src/lib/local-inference/native/NativeTtsClient.test.ts && git commit -m "feat(native): voice capability field + setStyleVoice protocol"`

---

### Task 10: `voiceCapability` replaces `voiceShape`

**Files:** Modify `nativeCatalog.ts` + its consumers (`NativeVoiceSection.tsx`, `NativeModelManagementSection.tsx` currently import `voiceShape`); Test extend `nativeCatalog.test.ts`
**Interfaces — Produces:** `voiceCapability(model: NativeModelInfo): { builtin: 'none'|'range'|'named'; custom: 'none'|'clip'|'style' }` (reads `model.voice`, falls back to derive from `clones`/`numSpeakers` for safety). `voiceShape` is **kept** here (additive) so its consumers stay green; it is deleted in Task 13 once the last consumer migrates. `sidFromTtsVoice`/`ttsVoiceForSid` stay.

- [ ] **Step 1: Failing test**

```typescript
import { voiceCapability } from './nativeCatalog';
it('reads the capability from the sidecar voice field', () => {
  expect(voiceCapability({ voice: { builtin: 'named', custom: 'style' } } as any)).toEqual({ builtin: 'named', custom: 'style' });
});
it('falls back to derive when voice is absent', () => {
  expect(voiceCapability({ clones: true } as any)).toEqual({ builtin: 'named', custom: 'clip' });
  expect(voiceCapability({ numSpeakers: 174 } as any)).toEqual({ builtin: 'range', custom: 'none' });
  expect(voiceCapability({ } as any)).toEqual({ builtin: 'none', custom: 'none' });
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`.
- [ ] **Step 3: Implement**

```typescript
// nativeCatalog.ts — replace voiceShape with:
export type VoiceBuiltin = 'none' | 'range' | 'named';
export type VoiceCustom = 'none' | 'clip' | 'style';
export interface VoiceCapability { builtin: VoiceBuiltin; custom: VoiceCustom; }

export function voiceCapability(model: NativeModelInfo | undefined): VoiceCapability {
  if (model?.voice) return model.voice;
  const custom: VoiceCustom = model?.clones ? 'clip' : 'none';
  const builtin: VoiceBuiltin = model?.clones ? 'named' : (model?.numSpeakers ?? 1) > 1 ? 'range' : 'none';
  return { builtin, custom };
}
```

Do NOT touch the consumers yet — `voiceShape` stays exported and the existing `voiceShape` call sites in `NativeVoiceSection.tsx`/`NativeModelManagementSection.tsx` keep working. Tasks 12–13 migrate them to `voiceCapability`, and Task 13 deletes `voiceShape`.

- [ ] **Step 4: Run → PASS** (`nativeCatalog.test.ts`; consumer suites still green because `voiceShape` is untouched).
- [ ] **Step 5: Commit** — `git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts && git commit -m "feat(native): voiceCapability replaces voiceShape"`

---

### Task 11: `NativeVoiceStore` abstraction (clip + style)

**Files:** Create `src/lib/local-inference/native/nativeVoiceStores.ts` + move clip validation here from `NativeVoiceSection.tsx`; Test `src/lib/local-inference/native/nativeVoiceStores.test.ts`
**Interfaces — Consumes:** `nativeVoiceStorage` (`listNativeVoices`, `addNativeVoice(name,clip,sr)`, `renameNativeVoice`, `deleteNativeVoice`, `getNativeVoice(id)->{audio:number[],sampleRate}`), `voiceStorage` (`listVoices/addVoice/renameVoice/deleteVoice/getVoice`), `VoiceLibraryCapability`. **Produces:**

```typescript
export interface NativeCustomVoice { id: number; name: string; }
export type VoiceApplyPayload =
  | { kind: 'clip'; audio: Float32Array; sampleRate: number }
  | { kind: 'style'; styleTtl: { dims: number[]; data: number[] }; styleDp: { dims: number[]; data: number[] } };
export interface NativeVoiceStore {
  kind: 'clip' | 'style';
  capability: VoiceLibraryCapability;
  list(): Promise<NativeCustomVoice[]>;
  onImport(file: File): Promise<void>;
  onRecord?(clip: Float32Array, sampleRate: number): Promise<void>;
  rename(id: number, name: string): Promise<void>;
  delete(id: number): Promise<void>;
  resolveApply(id: number): Promise<VoiceApplyPayload | null>;
}
export function voiceStoreFor(custom: VoiceCustom, modelId: string): NativeVoiceStore | null; // 'none' -> null
export function validateVoiceClip(clip: Float32Array, sampleRate: number): 'too_short'|'too_long'|'silent'|null; // moved from NativeVoiceSection
```

- [ ] **Step 1: Failing test**

```typescript
// nativeVoiceStores.test.ts  (mock both storages)
import { voiceStoreFor } from './nativeVoiceStores';
vi.mock('../nativeVoiceStorage', () => ({
  listNativeVoices: vi.fn().mockResolvedValue([{ id: 1, name: 'Clip', audio: [0.5], sampleRate: 24000 }]),
  getNativeVoice: vi.fn().mockResolvedValue({ id: 1, name: 'Clip', audio: [0.5], sampleRate: 24000 }),
  addNativeVoice: vi.fn(), renameNativeVoice: vi.fn(), deleteNativeVoice: vi.fn(),
}));
vi.mock('../voiceStorage', () => ({
  listVoices: vi.fn().mockResolvedValue([{ id: 2, name: 'Style', jsonData: new Blob([JSON.stringify({ style_ttl: { dims: [1], data: [3] }, style_dp: { dims: [1], data: [4] } })]) }]),
  getVoice: vi.fn().mockImplementation(async () => ({ id: 2, name: 'Style', jsonData: new Blob([JSON.stringify({ style_ttl: { dims: [1], data: [3] }, style_dp: { dims: [1], data: [4] } })]) })),
  addVoice: vi.fn(), renameVoice: vi.fn(), deleteVoice: vi.fn(), VoiceImportError: class extends Error {},
}));

it('clip store resolves audio payload', async () => {
  const s = voiceStoreFor('clip', 'moss-tts-nano')!;
  expect(s.kind).toBe('clip');
  expect(s.capability.importModes).toEqual(['record', 'upload']);
  expect((await s.list())[0]).toEqual({ id: 1, name: 'Clip' });
  const p = await s.resolveApply(1);
  expect(p).toEqual({ kind: 'clip', audio: new Float32Array([0.5]), sampleRate: 24000 });
});
it('style store resolves style payload', async () => {
  const s = voiceStoreFor('style', 'supertonic-3')!;
  expect(s.kind).toBe('style');
  expect(s.capability.importModes).toEqual(['upload']);
  const p = await s.resolveApply(2);
  expect(p).toEqual({ kind: 'style', styleTtl: { dims: [1], data: [3] }, styleDp: { dims: [1], data: [4] } });
});
it('none -> null', () => { expect(voiceStoreFor('none', 'x')).toBeNull(); });
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/lib/local-inference/native/nativeVoiceStores.test.ts`.
- [ ] **Step 3: Implement** `nativeVoiceStores.ts` — clip store wraps `nativeVoiceStorage` (onImport decodes+downmixes+validates audio → `addNativeVoice`; onRecord validates → `addNativeVoice`; resolveApply → `{kind:'clip', audio:new Float32Array(stored.audio), sampleRate}`; capability `{importModes:['record','upload'], accept:'audio/*', curation:false, presentation:'dropdown'}`). Style store wraps `voiceStorage` (onImport → `addVoice(modelId, name, file)`; resolveApply → parse `getVoice(id).jsonData` → `{kind:'style', styleTtl:style_ttl, styleDp:style_dp}`; capability `{importModes:['upload'], curation:false, presentation:'dropdown'}`). Move `validateVoiceClip` + `downmixToMono` from `NativeVoiceSection.tsx` into this module (keep exports) and re-export `validateVoiceClip` for its existing test. `onImport`/`onRecord` throw a coded error (`VoiceCaptureError { code }` for clip; `VoiceImportError` re-thrown for style) so the section can surface a message.

- [ ] **Step 4: Run → PASS** (3 pass); the pre-existing `validateVoiceClip` test (now importing from the new module or re-exported by the section) stays green.
- [ ] **Step 5: Commit** — `git add src/lib/local-inference/native/nativeVoiceStores.ts src/lib/local-inference/native/nativeVoiceStores.test.ts src/components/Settings/sections/NativeVoiceSection.tsx && git commit -m "feat(native): NativeVoiceStore abstraction (clip + style)"`

---

### Task 12: `NativeVoiceSection` capability switch

**Files:** Modify `NativeVoiceSection.tsx`; Test `NativeVoiceSection.test.tsx`
**Interfaces — Consumes:** `voiceCapability` type, `NativeVoiceStore` (injected), `VoiceLibrarySection`. **Produces:** props change from `{ shape, numSpeakers, customVoices, onCaptured, ... }` to `{ capability: VoiceCapability, numSpeakers?, builtinVoices, store: NativeVoiceStore | null, selected, targetLanguage, isSessionActive?, onSelect, onCustomChanged }`. Behaviour: `capability.builtin==='range'` → slider (unchanged); else → `VoiceLibrarySection` composed from `builtinVoices` (ids `builtin:<Name>`) + `store.list()` customs (ids `custom:<id>`), `capability={store.capability}`, `onImport={store.onImport}`, `onRecord={store.onRecord}`, `onRename/onDelete` → `store.rename/delete` + `onCustomChanged()`. Capture errors from the store are surfaced inline.

- [ ] **Step 1: Failing test**

```tsx
import { render, screen } from '@testing-library/react';
import NativeVoiceSection from './NativeVoiceSection';
const styleStore = { kind: 'style', capability: { importModes: ['upload'], curation: false, presentation: 'dropdown' },
  list: async () => [{ id: 3, name: 'MyVoice' }], onImport: async () => {}, rename: async () => {}, delete: async () => {}, resolveApply: async () => null };

it('named+style renders presets + custom voices via VoiceLibrarySection', async () => {
  render(<NativeVoiceSection capability={{ builtin: 'named', custom: 'style' }}
    builtinVoices={[{ name: 'Sarah', curated: true, unstable: false, default: false } as any]}
    store={styleStore as any} selected="" targetLanguage="en" numSpeakers={10}
    onSelect={() => {}} onCustomChanged={() => {}} />);
  expect(await screen.findByText('Sarah')).toBeInTheDocument();
  expect(await screen.findByText('MyVoice')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /record/i })).toBeNull();  // upload-only
});
it('range renders the speaker slider', () => {
  render(<NativeVoiceSection capability={{ builtin: 'range', custom: 'none' }} builtinVoices={[]} store={null}
    selected="sid:2" targetLanguage="en" numSpeakers={174} onSelect={() => {}} onCustomChanged={() => {}} />);
  expect(screen.getByRole('slider')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/components/Settings/sections/NativeVoiceSection.test.tsx`.
- [ ] **Step 3: Implement** — rewrite `NativeVoiceSection` to the capability/store shape. Compose entries: builtins ordered via `curatedBuiltinVoices(targetLanguage, builtinVoices)` → `builtin:<Name>` entries; `store.list()` → `custom:<id>` entries (`removable:true`). Render `VoiceLibrarySection` with `capability={store.capability}`, wiring `onImport`/`onRecord`/`onRename`/`onDelete` to the store (rename/delete take `custom:<id>` → `Number(id.slice('custom:'.length))`). Keep the `range` slider branch (`sidFromTtsVoice`/`ttsVoiceForSid`). Keep the inline capture-error surface; map clip codes as before, show `VoiceImportError.message` for style. `capability.builtin==='none' && capability.custom==='none'` → `null`.

- [ ] **Step 4: Run → PASS** (both tests).
- [ ] **Step 5: Commit** — `git add src/components/Settings/sections/NativeVoiceSection.tsx src/components/Settings/sections/NativeVoiceSection.test.tsx && git commit -m "feat(native): NativeVoiceSection capability switch (store-driven)"`

---

### Task 13: `NativeModelManagementSection` store-driven wiring

**Files:** Modify `NativeModelManagementSection.tsx`, `nativeCatalog.ts` (delete `voiceShape`); Test extend `NativeModelManagementSection.test.tsx`
**Interfaces — Consumes:** `voiceCapability`, `voiceStoreFor`. **Produces:** the selected-TTS card computes `capability = voiceCapability(catalog[reserveTtsId])` and `store = useMemo(() => voiceStoreFor(capability.custom, reserveTtsId), [...])`; loads `builtinVoices` (existing `nativeListTtsVoices`) + `customVoices` (via `store.list()`); renders `<NativeVoiceSection capability={capability} numSpeakers={...} builtinVoices={builtinVoices} store={store} selected={settings.ttsVoice} onSelect={(id)=>update({ttsVoice:id})} onCustomChanged={reloadCustom} />`. No MOSS-specific or Supertonic-specific code — one path for all.

- [ ] **Step 1: Failing test** (mock `voiceStorage`; a mock catalog whose selected TTS is `supertonic-3` with `voice:{builtin:'named',custom:'style'}`)

```tsx
vi.mock('../../../lib/local-inference/voiceStorage', () => ({
  listVoices: vi.fn().mockResolvedValue([{ id: 3, name: 'MyVoice', jsonData: new Blob(['{}']) }]),
  addVoice: vi.fn(), renameVoice: vi.fn(), deleteVoice: vi.fn(), getVoice: vi.fn(), VoiceImportError: class extends Error {},
}));
it('renders imported style voices for a selected Supertonic model', async () => {
  // render with the file's catalog-mock helper, selected tts = supertonic-3
  expect(await screen.findByText('MyVoice')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/components/Settings/sections/NativeModelManagementSection.test.tsx`.
- [ ] **Step 3: Implement** — replace the `ttsShape`/`builtinVoices`/`customVoices`/`handleVoiceRename`/`handleVoiceDelete` block with the store-driven version:

```tsx
const capability = voiceCapability(catalog[reserveTtsId || '']);
const store = useMemo(() => voiceStoreFor(capability.custom, reserveTtsId || ''), [capability.custom, reserveTtsId]);
const [builtinVoices, setBuiltinVoices] = useState<NativeVoiceInfo[]>([]);
const [customVoices, setCustomVoices] = useState<{ id: number; name: string }[]>([]);
const reloadCustom = useCallback(() => {
  if (!store) { setCustomVoices([]); return; }
  store.list().then(setCustomVoices).catch(() => setCustomVoices([]));
}, [store]);
useEffect(() => {
  if (capability.builtin === 'named') {
    let c = false;
    nativeListTtsVoices(reserveTtsId || undefined).then((v) => { if (!c) setBuiltinVoices(v); }).catch(() => { if (!c) setBuiltinVoices([]); });
    reloadCustom();
    return () => { c = true; };
  }
  setBuiltinVoices([]); setCustomVoices([]);
}, [capability.builtin, reserveTtsId, reloadCustom]);
```

Render (in the TTS card body): `capability.builtin !== 'none' || capability.custom !== 'none'` → `<NativeVoiceSection capability={capability} numSpeakers={catalog[reserveTtsId||'']?.numSpeakers} builtinVoices={builtinVoices} store={store} selected={settings.ttsVoice} targetLanguage={settings.targetLanguage} isSessionActive={isSessionActive} onSelect={(id) => update({ ttsVoice: id })} onCustomChanged={reloadCustom} />`. Drop the old `nativeVoiceStorage` imports/handlers from this file (they now live inside the clip store). This is the last `voiceShape` consumer — now **delete `voiceShape` (and the `VoiceShape` type) from `nativeCatalog.ts`** and confirm `grep -rn "voiceShape" src/` is empty.

- [ ] **Step 4: Run → PASS** — this file's suite green, including any MOSS characterization tests (behavior unchanged).
- [ ] **Step 5: Commit** — `git add src/components/Settings/sections/NativeModelManagementSection.tsx src/lib/local-inference/native/nativeCatalog.ts src/components/Settings/sections/NativeModelManagementSection.test.tsx && git commit -m "feat(native): store-driven voice wiring; delete voiceShape"`

---

### Task 14: `LocalNativeClient` + reconciliation — capability apply

**Files:** Modify `LocalNativeClient.ts`, `nativeTtsVoiceReconciliation.ts`; Test extend `nativeTtsVoiceReconciliation.test.ts`
**Interfaces — Consumes:** `voiceCapability`, `voiceStoreFor`, `NativeVoiceStore.resolveApply`, `NativeTtsClient.setStyleVoice`. **Produces:** apply path resolves `ttsVoice` per capability — `builtin:<Name>`→`setVoice`; `sid:<n>`→`setSpeaker`; `custom:<id>`→`store.resolveApply(id)`→`setReferenceVoice`|`setStyleVoice`. `reconcileTtsVoice(ttsVoice, customIds, targetLanguage, voices, hasCustom)` (rename `clones`→`hasCustom`, true when `capability.custom !== 'none'`).

- [ ] **Step 1: Failing test**

```typescript
import { reconcileTtsVoice } from './nativeTtsVoiceReconciliation';
it('drops a missing custom id for any custom-capable model', () => {
  const voices = [{ name: 'Robert', default: true } as any];
  expect(reconcileTtsVoice('custom:99', [3], 'en', voices, true)).toBe('builtin:Robert');
  expect(reconcileTtsVoice('custom:3', [3], 'en', voices, true)).toBe('custom:3');
});
it('passes through when the model has no custom voices', () => {
  expect(reconcileTtsVoice('builtin:X', [], 'en', [], false)).toBe('builtin:X');
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts`.
- [ ] **Step 3: Implement**
  - `nativeTtsVoiceReconciliation.ts`: rename the `clones` param to `hasCustom`; logic identical (`if (!hasCustom) return ttsVoice; if (!ttsVoice) return default; if custom: and id∉customIds → default`).
  - `LocalNativeClient.ts` apply block (~:114):
    ```typescript
    const cap = voiceCapability(/* the selected TTS NativeModelInfo */);
    const store = voiceStoreFor(cap.custom, /* modelId */);
    const customIds = store ? (await store.list()).map((v) => v.id) : [];
    const voice = reconcileTtsVoice(config.ttsVoice ?? '', customIds, config.targetLanguage, voiceList, cap.custom !== 'none');
    if (voice.startsWith('builtin:')) {
      await this.tts.setVoice?.(voice.slice('builtin:'.length));
    } else if (voice.startsWith('custom:') && store) {
      const payload = await store.resolveApply(Number(voice.slice('custom:'.length)));
      if (payload?.kind === 'clip') await this.tts.setReferenceVoice(payload.audio, payload.sampleRate);
      else if (payload?.kind === 'style') await this.tts.setStyleVoice(payload.styleTtl, payload.styleDp);
    } else {
      await this.tts.setSpeaker(sidFromTtsVoice(voice));
    }
    ```
- [ ] **Step 4: Run → PASS**; then the **native renderer suite** `npx vitest run src/lib/local-inference/native src/components/Settings/sections src/services/clients` → all green.
- [ ] **Step 5: Commit** — `git add src/services/clients/LocalNativeClient.ts src/lib/local-inference/native/nativeTtsVoiceReconciliation.ts src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts && git commit -m "feat(native): capability-driven voice apply (clip/style/preset)"`

---

## Final verification

- Sidecar: `cd sidecar && .venv/bin/python -m pytest -q` → green.
- Renderer: `npx vitest run src/lib/local-inference/native src/components/Settings/sections src/services/clients` → green.
- Grep: `grep -rn "voiceShape" src/` → empty (fully replaced by `voiceCapability`).
- Manual (Electron, model downloaded): LOCAL_NATIVE → **MOSS** card unchanged (named presets + record/upload clip clone); **VITS** unchanged (slider); **Supertonic 3** card shows 10 named presets + upload-JSON "My Voices", GPU generate works, importing a valid style JSON adds a custom voice that generates.
