# Native Supertonic-3 TTS Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supertonic 3 as a third native (Electron sidecar) TTS backend — a non-autoregressive 4-stage raw-onnxruntime diffusion pipeline — with a WASM-parity voice card (10 named presets + custom style-vector JSON import).

**Architecture:** A new `SupertonicBackend` in the sidecar ports the WASM worker's 4-stage pipeline (`duration_predictor → text_encoder → vector_estimator ×16 → vocoder`, fp32, CPU/CUDA EP) and plugs into the existing seam (`catalog.TtsModel` → `accel.resolve_tts` → `TtsEngine` → `list_tts_voices`). The renderer reuses the native `'list'` voice shape + shared `VoiceLibrarySection`, generalized for a "style" voice kind: custom voices come from the shared `voiceStorage` (IndexedDB, style-vector JSONs) and apply via a new `set_voice` `styleVoice` protocol variant.

**Tech Stack:** Python `onnxruntime` (shared cu128 venv, no new dep), `numpy`, `huggingface_hub`; React/TypeScript renderer; pytest (sidecar) + vitest (renderer).

## Global Constraints

- TypeScript strict; English-only comments/docs. Conventional commits.
- Tests are the correctness gate: sidecar `cd sidecar && .venv/bin/python -m pytest -q`; renderer `npx vitest run <path>`. `tsc` is NOT repo-clean and is NOT a gate.
- No new sidecar dependency — Supertonic runs on the existing `onnxruntime` in the shared cu128 venv. GPU = CUDA EP; CPU is the floor. Both tiers ship.
- Ship the published **fp32** ONNX as-is (no self-export, no fp16 — fp16 measured no benefit).
- Preset names/genders match the WASM manifest: sid order `[F1,F2,F3,F4,F5,M1,M2,M3,M4,M5]` → `[Sarah, Lily, Jessica, Olivia, Emily, Alex, James, Robert, Sam, Daniel]`, F1–F5 gender `F`, M1–M5 gender `M`. `defaultSid = 7` (Robert). `totalStep = 16`.
- Do NOT regress: WASM Supertonic card, shared `VoiceLibrarySection`/`voiceStorage`/`sidMapping`, native MOSS/VITS/Piper voice shapes, or the native `builtin:`/`custom:`/`sid:` `ttsVoice` scheme for MOSS.
- Commits stay LOCAL (no push/PR).

## Refinements vs. spec (both are simplifications)

1. **Native uses its own `ttsVoice` scheme**, not WASM's `ttsSpeakerId`/`sidMapping`. Presets → `builtin:<Name>`; custom → `custom:<voiceStorageDbKey>`. `sidMapping.ts` (a WASM sid+10 concept) is NOT used on native.
2. **The custom-voice path is generalized by "voice kind"**: MOSS = `'clip'` (`nativeVoiceStorage`, audio, `setReferenceVoice`); Supertonic = `'style'` (`voiceStorage`, JSON, `setStyleVoice`). The kind is derived from the catalog (`clones` true → clip; a new `styleVoices` capability → style), not a `"supertonic"` string check.

## File structure

**Sidecar (`sidecar/sokuji_sidecar/`):**
- `supertonic_frontend.py` (NEW) — pure text frontend (preprocess + unicode indexer). One responsibility, unit-testable without ORT.
- `tts_backends.py` (MODIFY) — add `SupertonicBackend`.
- `catalog.py` (MODIFY) — `SUPERTONIC_LANGS` + Supertonic `TtsModel` row + a `style_voices: bool` field on `TtsModel`.
- `native_models.py` (MODIFY) — download ignore `audio_samples/*`, `img/*`.
- `accel.py` (MODIFY) — `_installed()` gets `"supertonic": "onnxruntime"`.
- `tts_voices.py` (MODIFY) — `_SUPERTONIC_VOICES` presets + `list_builtin_voices` dispatch.
- `tts_engine.py` (MODIFY) — thread `language` to the backend (`set_language`).
- `server.py` (MODIFY) — `_h_set_voice` decodes the `styleVoice` binary variant. (Handler lives in `tts_engine.py`; see Task 8.)

**Renderer (`src/`):**
- `lib/local-inference/native/nativeProtocol.ts` (MODIFY) — `set_voice` `styleVoice` field.
- `lib/local-inference/native/NativeTtsClient.ts` (MODIFY) — `setStyleVoice(styleTtl, styleDp)`.
- `lib/local-inference/native/nativeCatalog.ts` (MODIFY) — `voiceShape` → `'list'` for style-voice models; expose `styleVoices` capability.
- `components/Settings/sections/NativeVoiceSection.tsx` (MODIFY) — style-voice branch (JSON upload, parent-provided custom voices).
- `components/Settings/sections/NativeModelManagementSection.tsx` (MODIFY) — Supertonic voice state (`voiceStorage`) + wiring.
- `services/clients/LocalNativeClient.ts` (MODIFY) — style-voice apply (`custom:` → `voiceStorage` → `setStyleVoice`).
- `lib/local-inference/native/nativeTtsVoiceReconciliation.ts` (MODIFY) — reconcile `custom:` against `voiceStorage` ids for style-voice models.

---

### Task 1: Supertonic text frontend (pure)

**Files:**
- Create: `sidecar/sokuji_sidecar/supertonic_frontend.py`
- Test: `sidecar/tests/test_supertonic_frontend.py`

**Interfaces:**
- Produces: `preprocess_text(text: str, lang: str, available_langs: set[str]) -> str` and `apply_indexer(text: str, indexer: list[int]) -> list[int]` (indexer is the `unicode_indexer.json` list: `indexer[charcode]` = token id, `-1` = unsupported → `0`).

- [ ] **Step 1: Write the failing test**

```python
# sidecar/tests/test_supertonic_frontend.py
from sokuji_sidecar.supertonic_frontend import preprocess_text, apply_indexer

AVAIL = {"en", "ko", "ja", "de", "es", "fr", "it", "ru"}

def test_preprocess_wraps_supported_lang_and_normalizes():
    out = preprocess_text("Hello  world", "en", AVAIL)
    assert out == "<en>Hello world.</en>"   # collapse spaces, add terminal '.', wrap

def test_preprocess_unsupported_lang_falls_back_to_na():
    assert preprocess_text("Hola", "xx", AVAIL) == "<xx?na>"  # placeholder, see step 3

def test_apply_indexer_maps_charcodes_and_drops_unsupported():
    # indexer of length 128: code 65 ('A') -> 5, everything else -1
    idx = [-1] * 128
    idx[ord("A")] = 5
    assert apply_indexer("A", idx) == [5]
    assert apply_indexer("B", idx) == [0]   # -1 -> 0
```

> Note: the `test_preprocess_unsupported_lang_falls_back_to_na` assertion is a stand-in; replace it in Step 3 with the real expected string once the port is written (it must equal `"<na>Hola.</na>"`). Fix the test to `assert preprocess_text("Hola", "xx", AVAIL) == "<na>Hola.</na>"` before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_supertonic_frontend.py -q`
Expected: FAIL (`ModuleNotFoundError: sokuji_sidecar.supertonic_frontend`).

- [ ] **Step 3: Implement `supertonic_frontend.py`** (direct port of `supertonic-tts.worker.ts` `preprocessText` + `applyIndexer`)

```python
# sidecar/sokuji_sidecar/supertonic_frontend.py
"""Supertonic 3 text frontend — a torch-free port of the WASM worker's
preprocessText + applyIndexer (src/lib/local-inference/workers/supertonic-tts.worker.ts).
Char-level: NFKD normalize, strip emoji, apply punctuation replacements, wrap in
<lang>...</lang> (or <na> when the language is unknown/unsupported), then map each
character to a token id via the unicode indexer (indexer[charcode]; -1 -> 0)."""
import re
import unicodedata

_EMOJI = re.compile(
    "[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F77F\U0001F780-\U0001F7FF\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF\U0001FA00-\U0001FA6F\U0001FA70-\U0001FAFF"
    "☀-⛿✀-➿\U0001F1E6-\U0001F1FF]+")

_REPLACE = {
    "–": "-", "‑": "-", "—": "-", "_": " ",
    "“": '"', "”": '"', "‘": "'", "’": "'",
    "´": "'", "`": "'",
    "[": " ", "]": " ", "|": " ", "/": " ", "#": " ",
    "→": " ", "←": " ",
}
_EXPR = {"@": " at ", "e.g.,": "for example,", "i.e.,": "that is,"}
_TERMINAL = set(".!?;:,'\")]}…。」』】〉》›»")


def preprocess_text(text: str, lang: str, available_langs: set) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = _EMOJI.sub("", text)
    for k, v in _REPLACE.items():
        text = text.replace(k, v)
    text = re.sub(r"[♥☆♡©\\]", "", text)
    for k, v in _EXPR.items():
        text = text.replace(k, v)
    text = (text.replace(" ,", ",").replace(" .", ".").replace(" !", "!")
                .replace(" ?", "?").replace(" ;", ";").replace(" :", ":")
                .replace(" '", "'"))
    while '""' in text:
        text = text.replace('""', '"')
    while "''" in text:
        text = text.replace("''", "'")
    while "``" in text:
        text = text.replace("``", "`")
    text = re.sub(r"\s+", " ", text).strip()
    if not text or text[-1] not in _TERMINAL:
        text += "."
    eff = lang if lang in available_langs else None
    return f"<{eff}>{text}</{eff}>" if eff else f"<na>{text}</na>"


def apply_indexer(text: str, indexer: list) -> list:
    out = []
    for ch in text:
        code = ord(ch)
        v = indexer[code] if 0 <= code < len(indexer) else -1
        out.append(v if v is not None and v >= 0 else 0)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_supertonic_frontend.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/supertonic_frontend.py sidecar/tests/test_supertonic_frontend.py
git commit -m "feat(sidecar): Supertonic text frontend (preprocess + unicode indexer)"
```

---

### Task 2: `SupertonicBackend` load + generate

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_backends.py` (append a new `@register_backend` class after `MossOnnxTtsBackend`)
- Test: `sidecar/tests/test_supertonic_backend.py`

**Interfaces:**
- Consumes: `supertonic_frontend.preprocess_text` / `apply_indexer` (Task 1); `backends.register_backend`, `backends.BackendLoadError`.
- Produces: `SupertonicBackend` with `NAME="supertonic"`, `STREAMING=False`, `CLONES=False`, `sample_rate`, `load(model_ref, device, compute_type)`, `generate(text, speed) -> (np.float32, int)`, `set_language(lang)`, `unload()`, `is_loaded`. Voice methods added in Task 3.

- [ ] **Step 1: Write the failing test** (mock the 4 ORT sessions so the test needs no model download)

```python
# sidecar/tests/test_supertonic_backend.py
import json
import numpy as np
import pytest
from sokuji_sidecar.tts_backends import SupertonicBackend

LATENT_DIM = 24 * 6            # ttl.latent_dim * chunk_compress_factor
CHUNK = 512 * 6               # ae.base_chunk_size * ttl.chunk_compress_factor

def _fake_cfg():
    return {"ae": {"sample_rate": 44100, "base_chunk_size": 512},
            "ttl": {"latent_dim": 24, "chunk_compress_factor": 6}}

class _FakeSession:
    def __init__(self, outputs): self._outputs = outputs
    def get_outputs(self): return [type("O", (), {"name": n})() for n in self._outputs]
    def run(self, names, feeds):
        # duration -> [[0.2s]] ; text_encoder -> text_emb ; vector_estimator -> denoised ;
        # vocoder -> wav sized latentLen*CHUNK
        if "text_ids" in feeds and "style_dp" in feeds:            # duration_predictor
            return [np.array([0.2], np.float32)]
        if "text_ids" in feeds and "style_ttl" in feeds:           # text_encoder
            return [np.zeros((1, 4, 256), np.float32)]
        if "noisy_latent" in feeds:                                # vector_estimator
            return [feeds["noisy_latent"]]
        latent = feeds["latent"]                                   # vocoder
        n = latent.shape[2] * CHUNK
        return [np.zeros((1, n), np.float32)]

def _install(monkeypatch, backend):
    backend._sess = {k: _FakeSession(out) for k, out in {
        "dp": ["duration"], "tenc": ["text_emb"],
        "vest": ["denoised_latent"], "voc": ["wav_tts"]}.items()}
    backend._cfg = _fake_cfg()
    backend._indexer = [1] * 70000          # every char -> token 1
    backend._voice = (np.zeros((1, 50, 256), np.float32), np.zeros((1, 8, 16), np.float32))
    backend.sample_rate = 44100
    backend._total_step = 2

def test_generate_returns_float32_44k(monkeypatch):
    b = SupertonicBackend()
    _install(monkeypatch, b)
    b.set_language("en")
    samples, ms = b.generate("Hello world.", 1.0)
    assert samples.dtype == np.float32
    assert samples.ndim == 1 and samples.size > 0
    assert isinstance(ms, int)

def test_backend_flags():
    assert SupertonicBackend.NAME == "supertonic"
    assert SupertonicBackend.STREAMING is False
    assert SupertonicBackend.CLONES is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_supertonic_backend.py -q`
Expected: FAIL (`ImportError: cannot import name 'SupertonicBackend'`).

- [ ] **Step 3: Implement `SupertonicBackend` (load + generate)** — append to `tts_backends.py`

```python
# --- appended to sidecar/sokuji_sidecar/tts_backends.py ---
import json as _json
from . import supertonic_frontend as _sf

# sid order MUST match the renderer's PRESET_VOICE_ORDER (sidMapping.ts) and the
# WASM manifest names. F1..F5 -> Sarah..Emily (F), M1..M5 -> Alex..Daniel (M).
_SUPERTONIC_PRESET_CODES = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]
_SUPERTONIC_AVAILABLE_LANGS = {
    "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr",
    "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk",
    "sl", "sv", "tr", "uk", "vi",
}


@register_backend
class SupertonicBackend:
    """Supertonic 3: non-autoregressive 4-stage raw-onnxruntime diffusion TTS
    (duration_predictor -> text_encoder -> vector_estimator xN -> vocoder). A
    torch-free port of supertonic-tts.worker.ts. provider='cuda' on GPU, else cpu.
    Non-streaming, non-cloning; voices are pre-computed style vectors (10 presets
    + uploaded custom JSONs applied via set_style_voice)."""
    NAME = "supertonic"
    STREAMING = False
    CLONES = False

    _MODEL_FILES = {"dp": "onnx/duration_predictor.onnx", "tenc": "onnx/text_encoder.onnx",
                    "vest": "onnx/vector_estimator.onnx", "voc": "onnx/vocoder.onnx"}

    def __init__(self):
        self._sess = None
        self._cfg = None
        self._indexer = None
        self._presets = None       # sid -> (style_ttl, style_dp)
        self._voice = None         # current (style_ttl, style_dp)
        self.sample_rate = 44100
        self._total_step = 16
        self._default_sid = 7
        self._lang = ""

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
            with open(f"{d}/onnx/tts.json") as fh:
                self._cfg = _json.load(fh)
            with open(f"{d}/onnx/unicode_indexer.json") as fh:
                self._indexer = _json.load(fh)
            self.sample_rate = int(self._cfg["ae"]["sample_rate"])
            self._presets = {}
            for sid, code in enumerate(_SUPERTONIC_PRESET_CODES):
                with open(f"{d}/voice_styles/{code}.json") as fh:
                    vj = _json.load(fh)
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
        s = self._sess[key]
        names = [o.name for o in s.get_outputs()]
        return dict(zip(names, s.run(names, feeds)))

    def generate(self, text, speed=1.0):
        t0 = time.time()
        style_ttl, style_dp = self._voice
        base = self._cfg["ae"]["base_chunk_size"]
        ccf = self._cfg["ttl"]["chunk_compress_factor"]
        ldim = self._cfg["ttl"]["latent_dim"]
        chunk = base * ccf
        latent_dim = ldim * ccf

        processed = _sf.preprocess_text(text, self._lang, _SUPERTONIC_AVAILABLE_LANGS)
        ids = _sf.apply_indexer(processed, self._indexer)
        text_ids = np.array([ids], dtype=np.int64)
        text_mask = np.ones((1, 1, text_ids.shape[1]), dtype=np.float32)

        dur = self._run("dp", {"text_ids": text_ids, "style_dp": style_dp, "text_mask": text_mask})
        d = float(np.asarray(next(iter(dur.values()))).reshape(-1)[0])
        if speed and speed > 0:
            d = d / speed
        tenc = self._run("tenc", {"text_ids": text_ids, "style_ttl": style_ttl, "text_mask": text_mask})
        text_emb = next(iter(tenc.values())).astype(np.float32)

        wav_len = int(d * self.sample_rate)
        latent_len = max(1, (wav_len + chunk - 1) // chunk)
        lat = (np.random.randn(1, latent_dim, latent_len) * np.sqrt(0.7)).astype(np.float32)
        latent_mask = np.ones((1, 1, latent_len), dtype=np.float32)
        total_step = np.array([self._total_step], dtype=np.float32)
        for step in range(self._total_step):
            r = self._run("vest", {
                "noisy_latent": lat, "text_emb": text_emb, "style_ttl": style_ttl,
                "latent_mask": latent_mask, "text_mask": text_mask,
                "current_step": np.array([step], dtype=np.float32), "total_step": total_step})
            lat = next(iter(r.values())).astype(np.float32)
        voc = self._run("voc", {"latent": lat})
        wav = np.asarray(next(iter(voc.values())), dtype=np.float32).reshape(-1)
        return wav[:wav_len] if wav_len and wav_len <= wav.size else wav, int((time.time() - t0) * 1000)

    def unload(self):
        self._sess = None
        self._presets = None
        self._voice = None

    @property
    def is_loaded(self):
        return self._sess is not None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_supertonic_backend.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_backends.py sidecar/tests/test_supertonic_backend.py
git commit -m "feat(sidecar): SupertonicBackend 4-stage diffusion generate (default voice)"
```

---

### Task 3: `SupertonicBackend` voice selection (presets + style + list)

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_backends.py` (add methods to `SupertonicBackend`)
- Test: `sidecar/tests/test_supertonic_backend.py` (extend)

**Interfaces:**
- Produces on `SupertonicBackend`: `set_speaker(sid: int)`, `set_builtin_voice(name: str)`, `set_style_voice(style_ttl: np.ndarray, style_dp: np.ndarray)`, `list_builtin_voices() -> list[dict]` (each `{"voice", "gender"}`). Name↔sid via the module-level `SUPERTONIC_VOICE_NAMES` list (Sarah…Daniel).

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_supertonic_backend.py
from sokuji_sidecar.tts_backends import SUPERTONIC_VOICE_NAMES

def test_voice_names_order_matches_spec():
    assert SUPERTONIC_VOICE_NAMES == ["Sarah","Lily","Jessica","Olivia","Emily",
                                      "Alex","James","Robert","Sam","Daniel"]

def test_set_speaker_and_builtin_select_presets(monkeypatch):
    b = SupertonicBackend()
    _install(monkeypatch, b)
    b._presets = {i: (np.full((1,50,256), i, np.float32), np.full((1,8,16), i, np.float32))
                  for i in range(10)}
    b.set_speaker(3)
    assert b._voice[0][0,0,0] == 3
    b.set_builtin_voice("Alex")            # sid 5
    assert b._voice[0][0,0,0] == 5
    b.set_speaker(99)                       # out of range -> default sid
    assert b._voice[0][0,0,0] == b._default_sid

def test_set_style_voice_applies_arrays():
    b = SupertonicBackend()
    ttl = np.ones((1,50,256), np.float32); dp = np.ones((1,8,16), np.float32)
    b.set_style_voice(ttl, dp)
    assert b._voice[0].shape == (1,50,256) and b._voice[1].shape == (1,8,16)

def test_list_builtin_voices_genders():
    voices = SupertonicBackend().list_builtin_voices()
    assert [v["voice"] for v in voices] == SUPERTONIC_VOICE_NAMES
    assert [v["gender"] for v in voices] == ["F"]*5 + ["M"]*5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_supertonic_backend.py -q`
Expected: FAIL (`cannot import name 'SUPERTONIC_VOICE_NAMES'`).

- [ ] **Step 3: Implement voice methods** — add to `tts_backends.py`

```python
# add near _SUPERTONIC_PRESET_CODES in tts_backends.py
SUPERTONIC_VOICE_NAMES = ["Sarah", "Lily", "Jessica", "Olivia", "Emily",
                          "Alex", "James", "Robert", "Sam", "Daniel"]
_SUPERTONIC_GENDERS = ["F"] * 5 + ["M"] * 5

# add these methods to class SupertonicBackend:
    def set_speaker(self, sid):
        sid = int(sid)
        if self._presets is None:
            return
        self._voice = self._presets.get(sid, self._presets[self._default_sid])

    def set_builtin_voice(self, name):
        try:
            self.set_speaker(SUPERTONIC_VOICE_NAMES.index(name))
        except ValueError:
            self.set_speaker(self._default_sid)

    def set_style_voice(self, style_ttl, style_dp):
        self._voice = (np.asarray(style_ttl, dtype=np.float32),
                       np.asarray(style_dp, dtype=np.float32))

    @staticmethod
    def list_builtin_voices():
        return [{"voice": n, "gender": g}
                for n, g in zip(SUPERTONIC_VOICE_NAMES, _SUPERTONIC_GENDERS)]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_supertonic_backend.py -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_backends.py sidecar/tests/test_supertonic_backend.py
git commit -m "feat(sidecar): Supertonic preset/style voice selection + list"
```

---

### Task 4: Catalog row + `style_voices` field

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py`
- Test: `sidecar/tests/test_catalog.py` (extend)

**Interfaces:**
- Consumes: `Deployment`, `TtsModel`, `TTS_MODELS`, `tts_model` (existing).
- Produces: `TtsModel` gains `style_voices: bool = False`; a Supertonic row `tts_model("supertonic-3")` with `num_speakers=10`, `clones=False`, `streaming=False`, `style_voices=True`, `sample_rate=44100`, both deployments, `size_bytes=400_600_000`.

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_catalog.py
from sokuji_sidecar import catalog

def test_supertonic_catalog_row():
    m = catalog.tts_model("supertonic-3")
    assert m is not None
    assert m.num_speakers == 10
    assert m.clones is False and m.streaming is False
    assert m.style_voices is True
    assert m.sample_rate == 44100
    assert m.repos == ("Supertone/supertonic-3",)
    backends = {d.backend for d in m.deployments}
    tiers = {d.tier for d in m.deployments}
    assert backends == {"supertonic"}
    assert tiers == {"gpu-cuda", "cpu"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py::test_supertonic_catalog_row -q`
Expected: FAIL (`m is None`).

- [ ] **Step 3: Implement** — in `catalog.py` add the field and the row

```python
# in class TtsModel(_ModelBase): add this field after num_speakers
    style_voices: bool = False       # voices are uploaded style-vector JSONs (Supertonic), not clips

# module-level, near _MOSS_NANO_LM_REPO
SUPERTONIC_LANGS = ("en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et",
                    "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl",
                    "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi")

# append this row to the TTS_MODELS list (after the MOSS row, before the piper rows)
    TtsModel("supertonic-3", "Supertonic 3", SUPERTONIC_LANGS,
             (Deployment("supertonic", "gpu-cuda", "fp32", "Supertone/supertonic-3", 1.0),
              Deployment("supertonic", "cpu", "fp32", "Supertone/supertonic-3", 1.0)),
             repos=("Supertone/supertonic-3",), clones=False, streaming=False,
             style_voices=True, sample_rate=44100, num_speakers=10,
             recommended=True, sort_order=1, size_bytes=400_600_000),
```

- [ ] **Step 4: Run tests to verify they pass** (row test + the whole catalog suite stays green)

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_catalog.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(sidecar): catalog Supertonic row + style_voices field"
```

---

### Task 5: Download spec — ignore `audio_samples/` + `img/`

**Files:**
- Modify: `sidecar/sokuji_sidecar/native_models.py` (`_base_specs`)
- Test: `sidecar/tests/test_native_models.py` (extend)

**Interfaces:**
- Consumes: `_base_specs`, `download_specs` (existing). `_base_specs` returns `{"repos": [...], "urls": [...]}` and MAY include `"ignore": [...]`.
- Produces: `download_specs("supertonic-3")` includes repo `Supertone/supertonic-3` and `ignore` covering `audio_samples/*` and `img/*`.

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_native_models.py
from sokuji_sidecar import native_models

def test_supertonic_download_ignores_samples_and_images():
    spec = native_models.download_specs("supertonic-3")
    assert "Supertone/supertonic-3" in spec["repos"]
    assert "audio_samples/*" in spec.get("ignore", [])
    assert "img/*" in spec.get("ignore", [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_native_models.py::test_supertonic_download_ignores_samples_and_images -q`
Expected: FAIL (no `ignore` key — the catalog-model branch returns only repos/urls).

- [ ] **Step 3: Implement** — in `native_models.py` `_base_specs`, special-case Supertonic before the generic catalog-model return

```python
# in _base_specs, replace the current catalog-model block:
    _tm = _tts_model(model_id) if model_id else None
    if _tm is not None:
        spec = {"repos": list(_tm.repos), "urls": list(_tm.urls)}
        if model_id == "supertonic-3":
            # The repo ships ~14MB of audio_samples/*.wav + img/*.png that the
            # runtime never loads (onnx/* + voice_styles/* are the payload).
            spec["ignore"] = ["audio_samples/*", "img/*"]
        return spec
```

> The downloader (`download` in `native_models.py`) already threads `spec.get("ignore")` into `snapshot_download(ignore_patterns=...)`. Verify this in Step 4; if `download` does not read `ignore`, add `ignore_patterns=spec.get("ignore")` to its `snapshot_download` call (grep `snapshot_download` in `native_models.py`).

- [ ] **Step 4: Run test + confirm downloader honors `ignore`**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_native_models.py -q`
Expected: PASS. Also `grep -n "ignore" sidecar/sokuji_sidecar/native_models.py` — confirm `download()` passes `ignore_patterns`; if absent, wire it and re-run.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/native_models.py sidecar/tests/test_native_models.py
git commit -m "feat(sidecar): Supertonic download ignores audio_samples/img"
```

---

### Task 6: Resolver installs `supertonic`

**Files:**
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_installed`)
- Test: `sidecar/tests/test_accel.py` (extend)

**Interfaces:**
- Consumes: `_installed()`, `resolve_tts` (existing). `resolve_tts("supertonic-3")` uses the catalog row's deployments; a plan is buildable only when the backend name is in `_installed()`.
- Produces: `_installed()` includes `"supertonic"` whenever `onnxruntime` is importable.

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_accel.py
from sokuji_sidecar import accel

def test_supertonic_backend_installed_and_resolvable():
    assert "supertonic" in accel._installed()          # onnxruntime is present in the venv
    plans = accel.resolve_tts("supertonic-3", override="cpu")
    assert plans and plans[0].backend == "supertonic"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py::test_supertonic_backend_installed_and_resolvable -q`
Expected: FAIL (`"supertonic" not in _installed()`).

- [ ] **Step 3: Implement** — in `accel.py` `_installed`, add to the `mods` dict

```python
            "sherpa_tts": "sherpa_onnx",
            "moss_onnx": "onnxruntime",
            "supertonic": "onnxruntime",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_accel.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/accel.py sidecar/tests/test_accel.py
git commit -m "feat(sidecar): register supertonic backend in resolver"
```

---

### Task 7: `list_tts_voices` returns Supertonic presets

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_voices.py`
- Test: `sidecar/tests/test_tts_voices.py` (extend)

**Interfaces:**
- Consumes: `SupertonicBackend.list_builtin_voices` (Task 3), `catalog.tts_model` (for `style_voices`).
- Produces: `list_builtin_voices("supertonic-3")` returns the 10 presets `{name, language, gender, curated:True, unstable:False, default:(name=="Robert")}` WITHOUT reading any snapshot (presets are static). MOSS behavior unchanged.

- [ ] **Step 1: Write the failing test**

```python
# append to sidecar/tests/test_tts_voices.py
from sokuji_sidecar import tts_voices

def test_supertonic_presets_listed_without_download():
    voices = tts_voices.list_builtin_voices("supertonic-3")
    assert [v["name"] for v in voices] == ["Sarah","Lily","Jessica","Olivia","Emily",
                                           "Alex","James","Robert","Sam","Daniel"]
    assert all(v["gender"] in ("F", "M") for v in voices)
    assert next(v for v in voices if v["name"] == "Robert")["default"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_voices.py::test_supertonic_presets_listed_without_download -q`
Expected: FAIL (Supertonic id resolves to its repo and the MOSS-manifest path returns `[]`).

- [ ] **Step 3: Implement** — dispatch in `tts_voices.list_builtin_voices`

```python
# at top of list_builtin_voices(model_id=None), before the MOSS manifest loop:
def list_builtin_voices(model_id=None):
    """Rich built-in voice descriptors ... (existing docstring)."""
    from . import catalog
    m = catalog.tts_model(model_id) if model_id else None
    if m is not None and getattr(m, "style_voices", False):
        from .tts_backends import SupertonicBackend
        _default = "Robert"
        return [{
            "name": v["voice"], "language": None, "gender": v["gender"],
            "curated": True, "unstable": False, "default": (v["voice"] == _default),
        } for v in SupertonicBackend.list_builtin_voices()]
    out = []
    # ... existing MOSS loop unchanged ...
```

> `NativeVoiceInfo` (renderer) already carries `name/language?/curated/unstable/default`. Adding `gender` is additive and harmless; the renderer reads `gender` for the preset label. Confirm the `models_catalog`/`list_tts_voices` JSON passes extra fields through (it serializes the dict as-is).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_voices.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_voices.py sidecar/tests/test_tts_voices.py
git commit -m "feat(sidecar): list_tts_voices returns Supertonic presets"
```

---

### Task 8: Thread `language` to the backend + decode `styleVoice`

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_engine.py` (`TtsEngine.init` calls `backend.set_language`; `_h_set_voice` handles `styleVoice`)
- Test: `sidecar/tests/test_tts_engine.py` (extend or create)

**Interfaces:**
- Consumes: `SupertonicBackend.set_language`, `set_style_voice` (Tasks 2–3). The `set_voice` control message may carry `styleVoice: {ttlDims:[...], dpDims:[...]}` preceded by ONE binary frame = `float32(style_ttl.flatten()) ++ float32(style_dp.flatten())`.
- Produces: `TtsEngine.init(..., language)` calls `self._backend.set_language(language)` when the backend supports it; `_h_set_voice` decodes the binary+dims into two arrays and calls `backend.set_style_voice(...)`.

- [ ] **Step 1: Write the failing test**

```python
# sidecar/tests/test_tts_engine_supertonic.py
import numpy as np
from sokuji_sidecar import tts_engine

class _Rec:
    STREAMING = False; CLONES = False; sample_rate = 44100; is_loaded = True
    def __init__(self): self.lang = None; self.style = None
    def set_language(self, l): self.lang = l
    def set_style_voice(self, ttl, dp): self.style = (ttl, dp)
    def generate(self, *a, **k): return np.zeros(0, np.float32), 0
    def unload(self): pass

def test_init_threads_language():
    eng = tts_engine.TtsEngine()
    rec = _Rec(); eng._backend = rec
    tts_engine.TtsEngine.set_language_if_supported(eng, "ja")   # helper, see step 3
    assert rec.lang == "ja"

async def test_set_voice_style_variant_decodes(monkeypatch):
    ttl = np.arange(50*256, dtype=np.float32); dp = np.arange(8*16, dtype=np.float32)
    binary = ttl.tobytes() + dp.tobytes()
    rec = _Rec()
    state = {"tts_engine": type("E", (), {"set_style_voice": rec.set_style_voice})()}
    msg = {"type": "set_voice", "styleVoice": {"ttlDims": [1,50,256], "dpDims": [1,8,16]}}
    await tts_engine._h_set_voice(state, msg, binary, conn=None)
    assert rec.style[0].shape == (1,50,256) and rec.style[1].shape == (1,8,16)
    assert rec.style[0].flatten()[0] == 0 and rec.style[1].flatten()[-1] == 8*16-1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_engine_supertonic.py -q`
Expected: FAIL (no `set_language_if_supported`; `_h_set_voice` ignores `styleVoice`).

- [ ] **Step 3: Implement** — in `tts_engine.py`

```python
# In TtsEngine.init(...), after self._backend is resolved and before returning, add:
        if hasattr(self._backend, "set_language"):
            self._backend.set_language(language or "")

# Add a tiny helper used by the test + a TtsEngine.set_style_voice passthrough:
    def set_style_voice(self, style_ttl, style_dp):
        self._backend.set_style_voice(style_ttl, style_dp)

    @staticmethod
    def set_language_if_supported(engine, language):
        if hasattr(engine._backend, "set_language"):
            engine._backend.set_language(language or "")

# In _h_set_voice(state, msg, binary_in, conn=None), add a branch BEFORE the
# existing name/sid/clip branches:
    style = msg.get("styleVoice")
    if style is not None:
        import numpy as _np
        ttl_dims = style["ttlDims"]; dp_dims = style["dpDims"]
        buf = _np.frombuffer(binary_in or b"", dtype=_np.float32)
        n_ttl = int(_np.prod(ttl_dims))
        ttl = buf[:n_ttl].reshape(ttl_dims).astype(_np.float32)
        dp = buf[n_ttl:n_ttl + int(_np.prod(dp_dims))].reshape(dp_dims).astype(_np.float32)
        state["tts_engine"].set_style_voice(ttl, dp)
        return {"type": "ok", "id": msg.get("id")}, None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_tts_engine_supertonic.py -q`
Expected: PASS. Then run the whole sidecar suite: `cd sidecar && .venv/bin/python -m pytest -q` — all green.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_engine.py sidecar/tests/test_tts_engine_supertonic.py
git commit -m "feat(sidecar): thread language + decode styleVoice set_voice variant"
```

---

### Task 9: Protocol + client — `setStyleVoice`

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts`, `src/lib/local-inference/native/NativeTtsClient.ts`
- Test: `src/lib/local-inference/native/NativeTtsClient.test.ts` (extend)

**Interfaces:**
- Consumes: existing `set_voice` control-message send + binary-frame pattern (`setReferenceVoice`).
- Produces: `NativeTtsClient.setStyleVoice(styleTtl: {dims:number[]; data:number[]}, styleDp: {dims:number[]; data:number[]}): Promise<void>` — sends ONE binary frame (`Float32(ttl.data) ++ Float32(dp.data)`) then `{ type:'set_voice', styleVoice:{ ttlDims, dpDims } }`.

- [ ] **Step 1: Write the failing test** (extend the existing `FakeWS` test)

```typescript
// append inside describe('NativeModelClient' ... ) or a new describe in NativeTtsClient.test.ts
it('setStyleVoice sends a binary frame then a styleVoice control message', async () => {
  const sent: any[] = []; const bins: ArrayBuffer[] = [];
  // Minimal fake WS capturing both frames (reuse the file's FakeWS pattern):
  // ... construct client with a fake ws whose send() pushes JSON to `sent`
  //     and ArrayBuffers to `bins` ...
  const c = /* new NativeTtsClient(...) connected */;
  await c.setStyleVoice({ dims: [1, 2], data: [1, 2] }, { dims: [1, 1], data: [9] });
  expect(bins.length).toBe(1);
  expect(new Float32Array(bins[0])).toEqual(new Float32Array([1, 2, 9]));
  const ctrl = sent.find((m) => m.type === 'set_voice' && m.styleVoice);
  expect(ctrl.styleVoice).toEqual({ ttlDims: [1, 2], dpDims: [1, 1] });
});
```

> Use the same fake-WebSocket harness already present in `NativeTtsClient.test.ts` / `NativeModelClient.test.ts` (the `FakeWS` class); capture `send(ArrayBuffer)` into `bins` and `send(string)` JSON into `sent`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeTtsClient.test.ts`
Expected: FAIL (`c.setStyleVoice is not a function`).

- [ ] **Step 3: Implement**

```typescript
// nativeProtocol.ts — extend the set_voice message shape (find the SetVoiceMsg / client-msg union
// that carries { type:'set_voice'; voice?; sid?; sampleRate? }) and add:
//   styleVoice?: { ttlDims: number[]; dpDims: number[] };

// NativeTtsClient.ts — add after setReferenceVoice:
  /** Apply an uploaded Supertonic custom voice (style vectors). */
  async setStyleVoice(
    styleTtl: { dims: number[]; data: number[] },
    styleDp: { dims: number[]; data: number[] },
  ): Promise<void> {
    const ttl = Float32Array.from(styleTtl.data);
    const dp = Float32Array.from(styleDp.data);
    const buf = new Float32Array(ttl.length + dp.length);
    buf.set(ttl, 0); buf.set(dp, ttl.length);
    this.ws!.send(buf.buffer);                         // binary frame precedes the control message
    await this.send({ type: 'set_voice', styleVoice: { ttlDims: styleTtl.dims, dpDims: styleDp.dims } });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/NativeTtsClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeProtocol.ts src/lib/local-inference/native/NativeTtsClient.ts src/lib/local-inference/native/NativeTtsClient.test.ts
git commit -m "feat(native): setStyleVoice + set_voice styleVoice protocol variant"
```

---

### Task 10: `voiceShape` → `'list'` for style-voice models

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts`
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts` (extend)

**Interfaces:**
- Consumes: `NativeModelInfo` (needs a `styleVoices?: boolean` field — added here + in `nativeProtocol.ts` + emitted by the sidecar `models_catalog` from `mdl.style_voices`).
- Produces: `voiceShape(model)` returns `'list'` when `model.styleVoices` OR `model.clones` is true; `'range'` when `numSpeakers>1`; else `'none'`. Add `isStyleVoiceModel(model): boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to nativeCatalog.test.ts
import { voiceShape, isStyleVoiceModel } from './nativeCatalog';
const supertonic = { id: 'supertonic-3', clones: false, streaming: false,
  numSpeakers: 10, styleVoices: true } as any;

it('style-voice model gets the list shape (named presets), not range', () => {
  expect(voiceShape(supertonic)).toBe('list');
  expect(isStyleVoiceModel(supertonic)).toBe(true);
});
it('multi-speaker non-style model still gets range', () => {
  expect(voiceShape({ clones: false, numSpeakers: 174, styleVoices: false } as any)).toBe('range');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL (Supertonic → `'range'`; `isStyleVoiceModel` undefined).

- [ ] **Step 3: Implement** — in `nativeCatalog.ts` `voiceShape` (currently `clones→list, numSpeakers>1→range, else none`)

```typescript
export function isStyleVoiceModel(model: NativeModelInfo): boolean {
  return !!model.styleVoices;
}

export function voiceShape(model: NativeModelInfo): VoiceShape {
  if (model.clones || model.styleVoices) return 'list';
  if ((model.numSpeakers ?? 1) > 1) return 'range';
  return 'none';
}
```

Also add `styleVoices?: boolean;` to `NativeModelInfo` in `nativeProtocol.ts`, and in the sidecar `accel.py` `_h_models_catalog` emit `"styleVoices": getattr(mdl, "style_voices", False)` for the tts kind (mirror the existing `numSpeakers`/`clones` emission).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeProtocol.ts src/lib/local-inference/native/nativeCatalog.test.ts sidecar/sokuji_sidecar/accel.py
git commit -m "feat(native): style-voice models take the list voice shape"
```

---

### Task 11: `NativeVoiceSection` style-voice branch

**Files:**
- Modify: `src/components/Settings/sections/NativeVoiceSection.tsx`
- Test: `src/components/Settings/sections/NativeVoiceSection.test.tsx` (extend/create)

**Interfaces:**
- Consumes: `VoiceLibrarySection`, `curatedBuiltinVoices`, `defaultTtsVoice` (existing).
- Produces: a new optional prop `voiceKind?: 'clip' | 'style'` (default `'clip'`) and, when `'style'`, props `styleCustomVoices: { id: number; name: string }[]`, `onImportStyleVoice: (file: File) => Promise<void>`. In `'style'` mode: custom entries are `custom:<id>` from `styleCustomVoices`; import capability is `{ importModes: ['upload'], curation: false, presentation: 'dropdown' }` (JSON, no record); `onImport` calls `onImportStyleVoice`; NO clip validation/`addNativeVoice`.

- [ ] **Step 1: Write the failing test**

```tsx
// NativeVoiceSection.test.tsx
import { render, screen } from '@testing-library/react';
import NativeVoiceSection from './NativeVoiceSection';

it('style voiceKind renders presets + style custom voices, upload-only', () => {
  render(<NativeVoiceSection
    voiceKind="style" shape="list"
    builtinVoices={[{ name: 'Sarah', curated: true, unstable: false, default: false } as any]}
    customVoices={[]} styleCustomVoices={[{ id: 3, name: 'MyVoice' }]}
    selected="" targetLanguage="en" numSpeakers={10}
    onSelect={() => {}} onCaptured={() => {}} onRename={async () => {}} onDelete={async () => {}}
    onImportStyleVoice={async () => {}} />);
  expect(screen.getByText('Sarah')).toBeInTheDocument();
  expect(screen.getByText('MyVoice')).toBeInTheDocument();
  // No record button in style mode (upload-only): the record affordance is absent.
  expect(screen.queryByRole('button', { name: /record/i })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Settings/sections/NativeVoiceSection.test.tsx`
Expected: FAIL (`voiceKind`/`styleCustomVoices`/`onImportStyleVoice` unknown; MyVoice not rendered).

- [ ] **Step 3: Implement** — add the props and a `'style'` branch to `NativeVoiceSection`

```tsx
// Add to NativeVoiceSectionProps:
  voiceKind?: 'clip' | 'style';
  styleCustomVoices?: { id: number; name: string }[];
  onImportStyleVoice?: (file: File) => Promise<void>;

// Destructure with defaults: voiceKind = 'clip', styleCustomVoices = [], onImportStyleVoice.
// In the 'list' render path, when voiceKind === 'style', build voices from builtins +
// styleCustomVoices and render VoiceLibrarySection with the Supertonic capability:
  if (shape === 'list' && voiceKind === 'style') {
    const { curated, rest } = curatedBuiltinVoices(targetLanguage, builtinVoices);
    const styleVoices: VoiceEntry[] = [
      ...curated.map((v) => ({ id: `builtin:${v.name}`, label: v.name, group: 'builtin' as const, removable: false, meta: { curated: true, unstable: v.unstable, language: v.language } })),
      ...rest.map((v) => ({ id: `builtin:${v.name}`, label: v.name, group: 'builtin' as const, removable: false, meta: { curated: false, unstable: v.unstable, language: v.language } })),
      ...(styleCustomVoices ?? []).map((v) => ({ id: `custom:${v.id}`, label: v.name, group: 'custom' as const, removable: true })),
    ];
    const selectedId = selected || defaultTtsVoice(targetLanguage, builtinVoices);
    return (
      <VoiceLibrarySection
        voices={styleVoices}
        selectedId={selectedId}
        onSelect={onSelect}
        onImport={(file) => onImportStyleVoice!(file)}
        onRename={onRename}
        onDelete={onDelete}
        capability={{ importModes: ['upload'], curation: false, presentation: 'dropdown' }}
        isSessionActive={isSessionActive}
      />
    );
  }
```

> Place this branch AFTER the `shape === 'range'` block and BEFORE the existing clip-based `'list'` return. The clip path (MOSS) is unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Settings/sections/NativeVoiceSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/NativeVoiceSection.tsx src/components/Settings/sections/NativeVoiceSection.test.tsx
git commit -m "feat(native): NativeVoiceSection style-voice branch (upload JSON)"
```

---

### Task 12: `NativeModelManagementSection` Supertonic voice state

**Files:**
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx`
- Test: `src/components/Settings/sections/NativeModelManagementSection.test.tsx` (extend)

**Interfaces:**
- Consumes: `voiceStorage.listVoices/addVoice/renameVoice/deleteVoice` (`src/lib/local-inference/voiceStorage.ts`), `isStyleVoiceModel` (Task 10), `NativeVoiceSection` `voiceKind='style'` (Task 11).
- Produces: when the selected TTS model `isStyleVoiceModel`, the section loads `voiceStorage.listVoices('supertonic-3')` into `styleCustomVoices` state, and passes `voiceKind='style'`, `styleCustomVoices`, `onImportStyleVoice`, `onRename`, `onDelete` (all bound to `voiceStorage`) to `NativeVoiceSection`. MOSS/VITS paths unchanged.

- [ ] **Step 1: Write the failing test** (mock `voiceStorage`)

```tsx
// in NativeModelManagementSection.test.tsx
vi.mock('../../../lib/local-inference/voiceStorage', () => ({
  listVoices: vi.fn().mockResolvedValue([{ id: 3, name: 'MyVoice', engine: 'supertonic-3' }]),
  addVoice: vi.fn(), renameVoice: vi.fn(), deleteVoice: vi.fn(),
  VoiceImportError: class extends Error {},
}));
it('renders imported style voices for a selected Supertonic model', async () => {
  // Arrange a mock native catalog whose selected TTS model is supertonic-3 with styleVoices:true,
  // render the section, wait for the voiceStorage.listVoices effect, and assert 'MyVoice' appears.
  // (Follow the existing test's catalog-mock + render pattern.)
});
```

> Fill the test body using the file's existing catalog-mock/render helpers (the suite already renders this component with a mock `nativeModelStore` catalog). Assert `screen.findByText('MyVoice')`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: FAIL (no style-voice wiring; 'MyVoice' never rendered).

- [ ] **Step 3: Implement** — add Supertonic voice state + handlers, mirroring the WASM `ModelManagementSection` Supertonic block (`:504`, `:513`, `:564`, `:583`, `:591`) and the MOSS custom-voice wiring already in this file

```tsx
import * as voiceStorage from '../../../lib/local-inference/voiceStorage';
import { isStyleVoiceModel } from '../../../lib/local-inference/native/nativeCatalog';

// state:
const [styleCustomVoices, setStyleCustomVoices] = useState<{ id: number; name: string }[]>([]);
const selectedTts = /* the selected TTS NativeModelInfo (existing derivation in this file) */;
const styleModel = !!selectedTts && isStyleVoiceModel(selectedTts);

const reloadStyleVoices = useCallback(async () => {
  if (!styleModel) { setStyleCustomVoices([]); return; }
  const list = await voiceStorage.listVoices('supertonic-3');
  setStyleCustomVoices(list.map((v) => ({ id: v.id, name: v.name })));
}, [styleModel]);
useEffect(() => { void reloadStyleVoices(); }, [reloadStyleVoices]);

const handleImportStyleVoice = useCallback(async (file: File) => {
  await voiceStorage.addVoice('supertonic-3', file.name.replace(/\.[^./\\]+$/, '') || 'Imported voice', file);
  await reloadStyleVoices();
}, [reloadStyleVoices]);
const handleRenameStyleVoice = useCallback(async (id: string, name: string) => {
  await voiceStorage.renameVoice(Number(id.slice('custom:'.length)), name); await reloadStyleVoices();
}, [reloadStyleVoices]);
const handleDeleteStyleVoice = useCallback(async (id: string) => {
  await voiceStorage.deleteVoice(Number(id.slice('custom:'.length))); await reloadStyleVoices();
}, [reloadStyleVoices]);

// Where NativeVoiceSection is rendered for the selected TTS card, when styleModel pass:
//   voiceKind="style"
//   styleCustomVoices={styleCustomVoices}
//   onImportStyleVoice={handleImportStyleVoice}
//   onRename={handleRenameStyleVoice}
//   onDelete={handleDeleteStyleVoice}
// else keep the existing (clip) props unchanged.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: PASS (and the file's other tests stay green).

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/NativeModelManagementSection.tsx src/components/Settings/sections/NativeModelManagementSection.test.tsx
git commit -m "feat(native): wire Supertonic style-voice library into the model panel"
```

---

### Task 13: `LocalNativeClient` style-voice apply + reconciliation

**Files:**
- Modify: `src/services/clients/LocalNativeClient.ts`, `src/lib/local-inference/native/nativeTtsVoiceReconciliation.ts`
- Test: `src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts` (extend) + `LocalNativeClient` apply test if one exists

**Interfaces:**
- Consumes: `NativeTtsClient.setStyleVoice` (Task 9), `voiceStorage.getVoice` (parse `jsonData` Blob → `{ style_ttl, style_dp }`), `isStyleVoiceModel` (Task 10).
- Produces: for a style-voice model, `reconcileTtsVoice` reconciles `custom:<id>` against `voiceStorage` ids (default → `builtin:Robert`); the apply path resolves `custom:<id>` via `voiceStorage.getVoice(id)` → `setStyleVoice(style_ttl, style_dp)`; `builtin:<Name>` → `setVoice(name)`.

- [ ] **Step 1: Write the failing test**

```typescript
// nativeTtsVoiceReconciliation.test.ts — style-voice model default
import { reconcileTtsVoice } from './nativeTtsVoiceReconciliation';
it('style-voice model reconciles empty selection to the default preset', () => {
  // signature extended with a styleVoices flag; empty -> defaultTtsVoice(...) which for
  // Supertonic presets resolves to a builtin:<Name> (Robert is the default in list_tts_voices).
  const voices = [{ name: 'Robert', default: true, curated: true } as any];
  expect(reconcileTtsVoice('', [], 'en', voices, /*clones*/ false, /*styleVoices*/ true))
    .toBe('builtin:Robert');
});
it('style-voice model drops a custom id that no longer exists', () => {
  const voices = [{ name: 'Robert', default: true } as any];
  expect(reconcileTtsVoice('custom:99', [3], 'en', voices, false, true)).toBe('builtin:Robert');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts`
Expected: FAIL (current `reconcileTtsVoice` returns `ttsVoice` unchanged when `!clones`).

- [ ] **Step 3: Implement**

```typescript
// nativeTtsVoiceReconciliation.ts — add a styleVoices param; treat style-voice like clones
// for reconciliation (custom ids must exist; empty -> language default builtin):
export function reconcileTtsVoice(
  ttsVoice: string, customVoiceIds: number[], targetLanguage: string,
  voices: NativeVoiceInfo[], clones: boolean, styleVoices = false,
): string {
  if (!clones && !styleVoices) return ttsVoice;
  if (!ttsVoice) return defaultTtsVoice(targetLanguage, voices);
  if (ttsVoice.startsWith('custom:')) {
    const id = Number(ttsVoice.slice('custom:'.length));
    if (!customVoiceIds.includes(id)) return defaultTtsVoice(targetLanguage, voices);
  }
  return ttsVoice;
}
```

```typescript
// LocalNativeClient.ts — where the ready `r` is known and the voice is applied (~:114):
// pass styleVoices to reconcile and branch the custom apply.
import { isStyleVoiceModel } from '../../lib/local-inference/native/nativeCatalog';
import * as voiceStorage from '../../lib/local-inference/voiceStorage';
// ...
const style = /* the selected model's styleVoices flag from the native catalog */;
const customIds = style
  ? (await voiceStorage.listVoices('supertonic-3')).map((v) => v.id)
  : nativeCustomIds; // existing MOSS ids
const voice = reconcileTtsVoice(config.ttsVoice ?? '', customIds, config.targetLanguage, voiceList, !!r.clones, style);
if (voice.startsWith('builtin:')) {
  await this.tts.setVoice?.(voice.slice('builtin:'.length));
} else if (voice.startsWith('custom:')) {
  const id = Number(voice.slice('custom:'.length));
  if (style) {
    const stored = await voiceStorage.getVoice(id);
    if (stored) {
      const parsed = JSON.parse(await stored.jsonData.text());   // { style_ttl:{dims,data}, style_dp:{dims,data} }
      await this.tts.setStyleVoice(parsed.style_ttl, parsed.style_dp);
    }
  } else {
    const stored = /* existing nativeVoiceStorage.getNativeVoice(id) */;
    if (stored) await this.tts.setReferenceVoice(new Float32Array(stored.audio), stored.sampleRate);
  }
} else {
  await this.tts.setSpeaker(sidFromTtsVoice(voice));
}
```

- [ ] **Step 4: Run tests to verify they pass** (reconciliation + full native renderer suite)

Run: `npx vitest run src/lib/local-inference/native/ src/components/Settings/sections/NativeVoiceSection.test.tsx src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/LocalNativeClient.ts src/lib/local-inference/native/nativeTtsVoiceReconciliation.ts src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts
git commit -m "feat(native): apply Supertonic style voices (custom -> setStyleVoice)"
```

---

## Final verification (after all tasks)

- Sidecar: `cd sidecar && .venv/bin/python -m pytest -q` → all green.
- Renderer: `npx vitest run src/lib/local-inference/native src/components/Settings/sections src/services/clients` → all green.
- Grep sanity: `grep -rn "supertonic" sidecar/sokuji_sidecar/*.py` shows backend + catalog + voices + accel wired; `grep -rn "styleVoice" src/lib/local-inference/native` shows protocol + client + apply.
- Manual (Electron, requires the model downloaded): select LOCAL_NATIVE → Supertonic 3 card shows 10 named presets + "My Voices" upload; selecting a preset and generating produces audio on GPU; importing a valid style JSON adds a custom voice that generates.
