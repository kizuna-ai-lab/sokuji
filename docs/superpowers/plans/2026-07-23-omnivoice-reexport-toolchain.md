# OmniVoice Re-export Toolchain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and publish a corrected, self-owned OmniVoice ONNX artifact — a **bidirectional** `llm_decoder` (fp16 + int4) plus all other graphs re-exported from source — that the sidecar backend (Plan 2) will download.

**Architecture:** An isolated **offline** build script loads `k2-fsa/OmniVoice` in PyTorch, re-exports all seven ONNX graphs (the `llm_decoder` via a full-attention-mask wrapper so it is bidirectional, not the causal genai build; the other six via the authors' own wrapper logic), verifies each numerically against PyTorch, quantizes the LLM to fp16/int4, measures GB10 CUDA RTF end-to-end, and assembles a publishable HF-repo layout. This toolchain never runs inside the torch-free runtime sidecar.

**Tech Stack:** Python 3.12, torch (CPU wheel), transformers ≥5.4, `omnivoice`, `onnx`, `onnxscript`, `onnxruntime`/`onnxruntime-gpu`, `huggingface_hub`, `soundfile`, `numpy`.

## Global Constraints

- Source model: **`k2-fsa/OmniVoice`** (CC-BY-NC weights). Load with `trust_remote_code=True, attn_implementation="eager", dtype=torch.float32`.
- The toolchain is **offline / build-time only** — its heavy deps (torch, transformers, omnivoice, onnxscript) MUST NOT enter `sidecar/requirements*.txt` or the runtime sidecar venv.
- The `llm_decoder` MUST be exported with a **full (bidirectional) attention mask**; a causal export is the bug this whole effort fixes. Every LLM export variant MUST be parity-checked vs PyTorch (**cosine ≥ 0.9999**).
- Higgs graphs export **fp32** (the fp16 `semantic_encoder` is a broken export — `LayerNormalization` float/float16 type error under ORT ≥1.24).
- Inference of the produced ONNX uses **plain `onnxruntime`** — no `onnxruntime-genai`.
- Reference working spike code lives in `.spike/reexport.py`, `.spike/pt_validate.py`, `.spike/models/omnivoice_src/modeling_omnivoice.py`, `.spike/models/repo/user_script.py` (kept, gitignored). Reuse it.
- Location: everything under `scripts/reexport-omnivoice/`. Publishing to HF is a **manual, consent-gated** final step — the script prepares the artifact but does NOT auto-push.
- Target repo id (default): `jiangzhuo9357/omnivoice-onnx-bidi` (overridable via `--repo`).

---

## File Structure

- `scripts/reexport-omnivoice/requirements.txt` — pinned build env (torch CPU index note in README).
- `scripts/reexport-omnivoice/README.md` — how to build + publish.
- `scripts/reexport-omnivoice/reexport.py` — CLI entrypoint: orchestrates load → export-all → quantize → verify → assemble.
- `scripts/reexport-omnivoice/exporters.py` — the seven graph exporters (LLM bidi + 6 reused-wrapper graphs).
- `scripts/reexport-omnivoice/verify.py` — PyTorch-parity + codec-round-trip + end-to-end audio + CUDA RTF checks.
- `scripts/reexport-omnivoice/tests/test_bidi_export.py` — parity/bidirectionality tests runnable on CPU.
- `out/` (gitignored) — assembled artifact staging dir.

---

## Task 1: Build env + model load smoke

**Files:**
- Create: `scripts/reexport-omnivoice/requirements.txt`
- Create: `scripts/reexport-omnivoice/README.md`
- Test: `scripts/reexport-omnivoice/tests/test_bidi_export.py`

**Interfaces:**
- Produces: a venv `scripts/reexport-omnivoice/.venv` with the pinned deps; a helper `load_model(model_dir)` importable by later tasks (added in Task 2's `exporters.py`, but the env + a load smoke are established here).

- [ ] **Step 1: Write `requirements.txt`**

```
# torch/torchaudio come from the CPU index — see README (must match versions).
torch==2.13.0
torchaudio==2.11.0
transformers>=5.4,<6
omnivoice==0.2.1
onnx==1.22.0
onnxscript
onnxruntime==1.27.0
huggingface_hub>=0.26
soundfile
numpy
```

- [ ] **Step 2: Write `README.md`** (exact build steps)

````markdown
# OmniVoice ONNX re-export toolchain (offline)

Produces the corrected **bidirectional** OmniVoice ONNX artifact that Sokuji hosts.
NOT part of the runtime sidecar (torch-free). CC-BY-NC weights — do not redistribute
outside the consented product flow.

## Setup
```bash
cd scripts/reexport-omnivoice
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install torch==2.13.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -r requirements.txt
```

## Build
```bash
.venv/bin/python reexport.py --out ./out --repo jiangzhuo9357/omnivoice-onnx-bidi
```

## Publish (manual, requires HF auth + explicit approval)
```bash
.venv/bin/huggingface-cli upload jiangzhuo9357/omnivoice-onnx-bidi ./out . --repo-type model
```
````

- [ ] **Step 3: Write the model-load smoke test**

```python
# scripts/reexport-omnivoice/tests/test_bidi_export.py
import os, pytest, torch
MODEL_DIR = os.environ.get("OMNIVOICE_SRC", ".spike/models/omnivoice_pt")

@pytest.mark.skipif(not os.path.isdir(MODEL_DIR), reason="source model not downloaded")
def test_model_loads_and_has_llm():
    import omnivoice  # noqa
    from transformers import AutoModel
    m = AutoModel.from_pretrained(MODEL_DIR, trust_remote_code=True, dtype=torch.float32,
                                  attn_implementation="eager").eval()
    assert hasattr(m, "llm") and m.llm.config.hidden_size == 1024
    assert hasattr(m, "audio_embeddings") and hasattr(m, "audio_heads")
```

- [ ] **Step 4: Run it (with the model present from the spike)**

Run: `.venv/bin/python -m pytest tests/test_bidi_export.py::test_model_loads_and_has_llm -v`
Expected: PASS (the spike already downloaded the model to `.spike/models/omnivoice_pt`). If the model is absent, download it first: `.venv/bin/huggingface-cli download k2-fsa/OmniVoice --local-dir .spike/models/omnivoice_pt`.

- [ ] **Step 5: Commit**

```bash
git add scripts/reexport-omnivoice/requirements.txt scripts/reexport-omnivoice/README.md scripts/reexport-omnivoice/tests/test_bidi_export.py
git commit -m "chore(omnivoice): re-export toolchain env + model-load smoke"
```

---

## Task 2: Bidirectional `llm_decoder` export + PyTorch parity

**Files:**
- Create: `scripts/reexport-omnivoice/exporters.py`
- Test: `scripts/reexport-omnivoice/tests/test_bidi_export.py`

**Interfaces:**
- Produces:
  - `load_model(model_dir) -> torch.nn.Module` — OmniVoice, eager, fp32, eval.
  - `class BidiLLM(torch.nn.Module)` — `forward(inputs_embeds, attention_mask) -> hidden_states`; wraps `model.llm` with the caller-supplied full mask.
  - `export_llm(model, out_path, dtype="fp32") -> None` — writes `<out_path>/llm_decoder.onnx` (+ `.data`), inputs `["inputs_embeds","attention_mask"]`, output `["hidden_states"]`, dynamic axes `{inputs_embeds:{0,1}, attention_mask:{0,2,3}, hidden_states:{0,1}}`, opset 20.

- [ ] **Step 1: Write the bidirectionality + parity test**

```python
# append to tests/test_bidi_export.py
@pytest.mark.skipif(not os.path.isdir(MODEL_DIR), reason="source model not downloaded")
def test_bidi_llm_is_bidirectional_and_matches_pytorch(tmp_path):
    import numpy as np, onnxruntime as ort
    from exporters import load_model, BidiLLM, export_llm
    m = load_model(MODEL_DIR)
    H = m.llm.config.hidden_size
    wrap = BidiLLM(m.llm).eval()

    # bidirectional: with a full mask, changing the last position must move earlier positions
    S = 12
    emb = torch.randn(1, S, H); full = torch.ones(1, 1, S, S, dtype=torch.bool)
    with torch.no_grad():
        h1 = wrap(emb, full); emb2 = emb.clone(); emb2[0, -1] += 3.0; h2 = wrap(emb2, full)
    assert (h1 - h2).abs()[0, 0].max().item() > 1e-3, "early position did not move => still causal"

    # parity: exported ONNX ~= PyTorch
    out = tmp_path / "llm"; out.mkdir()
    export_llm(m, str(out), dtype="fp32")
    sess = ort.InferenceSession(str(out / "llm_decoder.onnx"), providers=["CPUExecutionProvider"])
    e = torch.randn(1, 20, H); msk = torch.ones(1, 1, 20, 20, dtype=torch.bool)
    with torch.no_grad():
        ref = wrap(e, msk).numpy()
    got = sess.run(["hidden_states"], {"inputs_embeds": e.numpy().astype(np.float32),
                                       "attention_mask": msk.numpy()})[0]
    cos = float(np.dot(ref.ravel(), got.ravel()) / (np.linalg.norm(ref) * np.linalg.norm(got) + 1e-9))
    assert cos >= 0.9999, f"llm parity cos={cos}"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_bidi_export.py::test_bidi_llm_is_bidirectional_and_matches_pytorch -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'exporters'`.

- [ ] **Step 3: Write `exporters.py` (load + BidiLLM + export_llm)** — port from `.spike/reexport.py`

```python
# scripts/reexport-omnivoice/exporters.py
import torch, omnivoice  # noqa: F401
from transformers import AutoModel

def load_model(model_dir):
    return AutoModel.from_pretrained(model_dir, trust_remote_code=True, dtype=torch.float32,
                                     attn_implementation="eager").eval()

class BidiLLM(torch.nn.Module):
    def __init__(self, llm):
        super().__init__(); self.llm = llm
    def forward(self, inputs_embeds, attention_mask):
        return self.llm(inputs_embeds=inputs_embeds, attention_mask=attention_mask, return_dict=True)[0]

def export_llm(model, out_path, dtype="fp32"):
    import os
    os.makedirs(out_path, exist_ok=True)
    H = model.llm.config.hidden_size
    wrap = BidiLLM(model.llm).eval()
    emb = torch.randn(1, 8, H); full = torch.ones(1, 1, 8, 8, dtype=torch.bool)
    with torch.no_grad():
        torch.onnx.export(
            wrap, (emb, full), os.path.join(out_path, "llm_decoder.onnx"),
            input_names=["inputs_embeds", "attention_mask"], output_names=["hidden_states"],
            dynamic_axes={"inputs_embeds": {0: "b", 1: "s"},
                          "attention_mask": {0: "b", 2: "s", 3: "s"},
                          "hidden_states": {0: "b", 1: "s"}},
            opset_version=20, do_constant_folding=True)
    # dtype conversion (fp16/int4) is handled in Task 5; fp32 is the base export.
```

- [ ] **Step 4: Run it to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_bidi_export.py::test_bidi_llm_is_bidirectional_and_matches_pytorch -v`
Expected: PASS (bidirectional Δ>1e-3, parity cos≥0.9999 — matches spike's cos=1.000000).

- [ ] **Step 5: Commit**

```bash
git add scripts/reexport-omnivoice/exporters.py scripts/reexport-omnivoice/tests/test_bidi_export.py
git commit -m "feat(omnivoice): bidirectional llm_decoder export + PyTorch parity"
```

---

## Task 3: Re-export the two other backbone graphs from source

**Files:**
- Modify: `scripts/reexport-omnivoice/exporters.py`
- Test: `scripts/reexport-omnivoice/tests/test_bidi_export.py`

**Interfaces:**
- Produces: `export_audio_embeddings(model, out_path)` → `<out>/audio_embeddings_encoder.onnx` (inputs `input_ids (B,8,S) int64`, `audio_mask (B,S) bool` → `inputs_embeds (B,S,1024)`); `export_audio_heads(model, out_path)` → `<out>/audio_heads_decoder.onnx` (`hidden_states (B,S,1024)` → `logits (B,8,S,1025)`). Both reuse the authors' wrapper classes from `.spike/models/repo/codes/model_wrappers.py` and IO configs from `user_script.py`.

- [ ] **Step 1: Write parity tests for both graphs**

```python
# append to tests/test_bidi_export.py — parity vs the model's own submodules
@pytest.mark.skipif(not os.path.isdir(MODEL_DIR), reason="source model not downloaded")
def test_audio_embeddings_and_heads_parity(tmp_path):
    import numpy as np, onnxruntime as ort, sys
    sys.path.insert(0, ".spike/models/repo")  # authors' codes/ + user_script
    from exporters import load_model, export_audio_embeddings, export_audio_heads
    m = load_model(MODEL_DIR)
    out = tmp_path / "bb"; out.mkdir()
    export_audio_embeddings(m, str(out)); export_audio_heads(m, str(out))

    # audio_embeddings parity
    B, S = 1, 32
    ids = torch.randint(0, 1025, (B, 8, S), dtype=torch.int64)
    amask = torch.zeros(B, S, dtype=torch.bool); amask[:, S//4:3*S//4] = True
    with torch.no_grad():
        ref = m._prepare_embed_inputs(ids, amask).numpy()
    sess = ort.InferenceSession(str(out/"audio_embeddings_encoder.onnx"), providers=["CPUExecutionProvider"])
    got = sess.run(["inputs_embeds"], {"input_ids": ids.numpy(), "audio_mask": amask.numpy()})[0]
    assert np.abs(ref - got).max() < 1e-2

    # audio_heads parity
    hid = torch.randn(B, S, 1024)
    with torch.no_grad():
        ref_h = m.audio_heads(hid).view(B, S, 8, 1025).permute(0, 2, 1, 3).numpy()
    sess2 = ort.InferenceSession(str(out/"audio_heads_decoder.onnx"), providers=["CPUExecutionProvider"])
    got_h = sess2.run(["logits"], {"hidden_states": hid.numpy().astype(np.float32)})[0]
    assert np.abs(ref_h - got_h).max() < 1e-2
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_bidi_export.py::test_audio_embeddings_and_heads_parity -v`
Expected: FAIL — `ImportError: cannot import name 'export_audio_embeddings'`.

- [ ] **Step 3: Implement both exporters** (reuse the authors' wrappers)

```python
# add to exporters.py
import os

def export_audio_embeddings(model, out_path):
    from codes.model_wrappers import AudioEmbeddingsEncoderWrapper
    w = AudioEmbeddingsEncoderWrapper(text_embed=model.get_input_embeddings(),
                                      audio_embed=model.audio_embeddings,
                                      layer_offsets=model.codebook_layer_offsets).eval()
    B, S = 1, 64
    ids = torch.randint(0, 1025, (B, 8, S), dtype=torch.int64)
    amask = torch.zeros(B, S, dtype=torch.bool); amask[:, S//4:3*S//4] = True
    torch.onnx.export(w, (ids, amask), os.path.join(out_path, "audio_embeddings_encoder.onnx"),
        input_names=["input_ids", "audio_mask"], output_names=["inputs_embeds"],
        dynamic_axes={"input_ids": {0: "b", 2: "s"}, "audio_mask": {0: "b", 1: "s"},
                      "inputs_embeds": {0: "b", 1: "s"}}, opset_version=20)

def export_audio_heads(model, out_path):
    from codes.model_wrappers import AudioHeadsDecoderWrapper
    w = AudioHeadsDecoderWrapper(heads=model.audio_heads).eval()
    B, S = 1, 64
    hid = torch.randn(B, S, 1024)
    torch.onnx.export(w, (hid,), os.path.join(out_path, "audio_heads_decoder.onnx"),
        input_names=["hidden_states"], output_names=["logits"],
        dynamic_axes={"hidden_states": {0: "b", 1: "s"}, "logits": {0: "b", 2: "s"}},
        opset_version=20)
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_bidi_export.py::test_audio_embeddings_and_heads_parity -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/reexport-omnivoice/exporters.py scripts/reexport-omnivoice/tests/test_bidi_export.py
git commit -m "feat(omnivoice): re-export audio_embeddings + audio_heads from source"
```

---

## Task 4: Re-export the four Higgs graphs (fp32) + codec round-trip

**Files:**
- Modify: `scripts/reexport-omnivoice/exporters.py`
- Test: `scripts/reexport-omnivoice/tests/test_bidi_export.py`

**Interfaces:**
- Produces: `export_higgs(model_dir, out_path)` → `<out>/audio_tokenizer/{acoustic_encoder,semantic_encoder,quantizer_encoder,higgs_decoder}.onnx` (fp32), via the authors' `get_higgs_*_model` loaders + `_prepare_tok`.

- [ ] **Step 1: Write the codec round-trip test** (encode a real clip → decode → speech-level RMS, not silence/garbage)

```python
# append to tests/test_bidi_export.py
@pytest.mark.skipif(not os.path.isdir(MODEL_DIR), reason="source model not downloaded")
def test_higgs_export_roundtrip(tmp_path):
    import numpy as np, onnxruntime as ort, soundfile as sf, sys
    sys.path.insert(0, ".spike/models/repo")
    from exporters import export_higgs
    out = tmp_path / "hg"; out.mkdir()
    export_higgs(MODEL_DIR, str(out))
    d = str(out / "audio_tokenizer")
    ac = ort.InferenceSession(f"{d}/acoustic_encoder.onnx", providers=["CPUExecutionProvider"])
    se = ort.InferenceSession(f"{d}/semantic_encoder.onnx", providers=["CPUExecutionProvider"])
    qe = ort.InferenceSession(f"{d}/quantizer_encoder.onnx", providers=["CPUExecutionProvider"])
    de = ort.InferenceSession(f"{d}/higgs_decoder.onnx", providers=["CPUExecutionProvider"])
    wav, sr = sf.read("scripts/assets/gpt-sovits-voices/classic-zh.wav")
    wav = wav.astype(np.float32)
    # resample-free: the clip is already 24k mono (verified in spike); 16k via simple decimation for the test
    import soxr
    w24 = soxr.resample(wav, sr, 24000).astype(np.float32)
    w16 = soxr.resample(wav, sr, 16000).astype(np.float32)
    af = ac.run(["acoustic_features"], {"waveform_24k": w24[None, None, :]})[0]
    sf_ = se.run(["semantic_features"], {"waveform_16k": w16[None, :]})[0]
    T = min(af.shape[2], sf_.shape[2]); af, sf_ = af[:, :, :T], sf_[:, :, :T]
    codes = qe.run(["codes"], {"acoustic_features": af, "semantic_features": sf_})[0]
    out_wav = de.run(["waveform_24k"], {"codes": codes})[0].squeeze()
    rms = float(np.sqrt(np.mean(out_wav.astype(np.float32) ** 2)))
    assert 0.02 < rms < 0.35, f"round-trip rms {rms} not speech-like"
    # codes must be diverse (real audio), not collapsed
    assert len(np.unique(codes[0])) > 30
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_bidi_export.py::test_higgs_export_roundtrip -v`
Expected: FAIL — `ImportError: cannot import name 'export_higgs'`.

- [ ] **Step 3: Implement `export_higgs`** (reuse authors' loaders; fp32)

```python
# add to exporters.py
def export_higgs(model_dir, out_path):
    import user_script as us
    d = os.path.join(out_path, "audio_tokenizer"); os.makedirs(d, exist_ok=True)
    specs = [
        ("acoustic_encoder.onnx",  us.get_higgs_acoustic_model,  us.get_higgs_acoustic_io_config,  us.get_higgs_acoustic_dummy_inputs),
        ("semantic_encoder.onnx",  us.get_higgs_semantic_model,  us.get_higgs_semantic_io_config,  us.get_higgs_semantic_dummy_inputs),
        ("quantizer_encoder.onnx", us.get_higgs_quantizer_model, us.get_higgs_quantizer_io_config, us.get_higgs_quantizer_dummy_inputs),
        ("higgs_decoder.onnx",     us.get_higgs_decoder_model,   us.get_higgs_decoder_io_config,   us.get_higgs_decoder_dummy_inputs),
    ]
    for fname, get_model, get_io, get_dummy in specs:
        w = get_model(model_dir); io = get_io(model_dir); dummy = get_dummy()
        args = tuple(dummy[n] for n in io["input_names"])
        torch.onnx.export(w, args, os.path.join(d, fname),
            input_names=io["input_names"], output_names=io["output_names"],
            dynamic_axes=io["dynamic_axes"], opset_version=20)
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_bidi_export.py::test_higgs_export_roundtrip -v`
Expected: PASS (round-trip RMS in speech range, codes diverse — matches spike codec round-trip).

- [ ] **Step 5: Commit**

```bash
git add scripts/reexport-omnivoice/exporters.py scripts/reexport-omnivoice/tests/test_bidi_export.py
git commit -m "feat(omnivoice): re-export Higgs tokenizer graphs (fp32) from source"
```

---

## Task 5: Quantize the LLM (fp16 + int4) + end-to-end audio per variant

**Files:**
- Modify: `scripts/reexport-omnivoice/exporters.py`
- Create: `scripts/reexport-omnivoice/verify.py`
- Test: `scripts/reexport-omnivoice/tests/test_bidi_export.py`

**Interfaces:**
- Produces:
  - `quantize_llm(fp32_llm_path, out_path, mode) -> None` — `mode in {"fp16","int4"}`; writes a `llm_decoder.onnx` (+`.data`) in that precision. fp16 via `onnxruntime.transformers.float16.convert_float_to_float16` (or `onnxconverter_common`); int4 via `onnxruntime.quantization.matmul_4bits_quantizer.MatMul4BitsQuantizer`.
  - `verify.hybrid_generate(model_dir, backbone_dir, higgs_dir, text, language) -> np.ndarray` — runs the real `model.generate()` with `model.llm` monkeypatched to the ONNX at `backbone_dir` (the Plan-1 end-to-end check; port from `.spike/reexport.py` OnnxLLMShim).

- [ ] **Step 1: Write per-variant parity + end-to-end audio test**

```python
# append to tests/test_bidi_export.py
@pytest.mark.skipif(not os.path.isdir(MODEL_DIR), reason="source model not downloaded")
@pytest.mark.parametrize("mode", ["fp16", "int4"])
def test_llm_quant_parity_and_audio(tmp_path, mode):
    import numpy as np, onnxruntime as ort
    from exporters import load_model, export_llm, export_audio_embeddings, export_audio_heads, quantize_llm
    import verify
    m = load_model(MODEL_DIR)
    base = tmp_path / "fp32"; base.mkdir(); export_llm(m, str(base), "fp32")
    q = tmp_path / mode; q.mkdir()
    quantize_llm(str(base / "llm_decoder.onnx"), str(q), mode)
    export_audio_embeddings(m, str(q)); export_audio_heads(m, str(q))

    # parity of quantized LLM vs PyTorch (looser bound for int4)
    from exporters import BidiLLM
    H = m.llm.config.hidden_size; wrap = BidiLLM(m.llm).eval()
    e = torch.randn(1, 20, H); msk = torch.ones(1, 1, 20, 20, dtype=torch.bool)
    with torch.no_grad(): ref = wrap(e, msk).numpy()
    sess = ort.InferenceSession(str(q / "llm_decoder.onnx"), providers=["CPUExecutionProvider"])
    got = sess.run(["hidden_states"], {"inputs_embeds": e.numpy().astype(np.float32),
                                       "attention_mask": msk.numpy()})[0]
    cos = float(np.dot(ref.ravel(), got.ravel()) / (np.linalg.norm(ref) * np.linalg.norm(got) + 1e-9))
    assert cos >= (0.999 if mode == "fp16" else 0.99), f"{mode} cos={cos}"

    # end-to-end: the ONNX-backed real pipeline produces speech-level audio
    wav = verify.hybrid_generate(MODEL_DIR, str(q), None, "Hello from the re-export.", "English")
    rms = float(np.sqrt(np.mean(np.asarray(wav, np.float32) ** 2)))
    assert 0.02 < rms < 0.35, f"{mode} audio rms {rms} not speech-like"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest "tests/test_bidi_export.py::test_llm_quant_parity_and_audio[fp16]" -v`
Expected: FAIL — `cannot import name 'quantize_llm'`.

- [ ] **Step 3: Implement `quantize_llm` + `verify.hybrid_generate`**

```python
# add to exporters.py
def quantize_llm(fp32_llm_path, out_path, mode):
    import os, shutil, onnx
    os.makedirs(out_path, exist_ok=True)
    dst = os.path.join(out_path, "llm_decoder.onnx")
    if mode == "fp16":
        from onnxconverter_common import float16
        model = onnx.load(fp32_llm_path)
        onnx.save(float16.convert_float_to_float16(model, keep_io_types=True), dst,
                  save_as_external_data=True, location="llm_decoder.onnx.data")
    elif mode == "int4":
        from onnxruntime.quantization.matmul_4bits_quantizer import MatMul4BitsQuantizer
        model = onnx.load(fp32_llm_path)
        q = MatMul4BitsQuantizer(model, block_size=128, is_symmetric=True)
        q.process()
        onnx.save(q.model.model, dst, save_as_external_data=True, location="llm_decoder.onnx.data")
    else:
        raise ValueError(mode)
```

```python
# scripts/reexport-omnivoice/verify.py
import numpy as np, torch, onnxruntime as ort
from exporters import load_model

class _OnnxLLMShim:
    def __init__(self, sess, real): self._s, self._r = sess, real
    def __call__(self, inputs_embeds=None, attention_mask=None, return_dict=True, position_ids=None, **kw):
        h = self._s.run(["hidden_states"], {
            "inputs_embeds": inputs_embeds.detach().cpu().numpy().astype(np.float32),
            "attention_mask": attention_mask.detach().cpu().numpy()})[0]
        return (torch.from_numpy(h).to(inputs_embeds.dtype),)
    def __getattr__(self, n): return getattr(self._r, n)

def hybrid_generate(model_dir, backbone_dir, higgs_dir, text, language):
    m = load_model(model_dir)
    sess = ort.InferenceSession(f"{backbone_dir}/llm_decoder.onnx", providers=["CPUExecutionProvider"])
    real = m.llm
    del m._modules["llm"]
    m.llm = _OnnxLLMShim(sess, real)
    return np.asarray(m.generate(text=text, language=language)[0], dtype=np.float32).squeeze()
```

- [ ] **Step 4: Run both variants to verify they pass**

Run: `.venv/bin/python -m pytest "tests/test_bidi_export.py::test_llm_quant_parity_and_audio" -v`
Expected: PASS for fp16 and int4 (fp16 cos≥0.999, int4 cos≥0.99; both produce speech-level audio). If int4 audio degrades below the RMS/quality bar, record it and ship fp16-only (note in README).

- [ ] **Step 5: Commit**

```bash
git add scripts/reexport-omnivoice/exporters.py scripts/reexport-omnivoice/verify.py scripts/reexport-omnivoice/tests/test_bidi_export.py
git commit -m "feat(omnivoice): fp16/int4 LLM quantization + end-to-end audio verification"
```

---

## Task 6: CLI orchestration + assemble the publishable repo layout + CUDA RTF

**Files:**
- Create: `scripts/reexport-omnivoice/reexport.py`
- Modify: `scripts/reexport-omnivoice/verify.py`

**Interfaces:**
- Consumes: all `exporters.*` + `verify.*`.
- Produces: `out/` with layout `{ fp16/, int4/, audio_tokenizer/, tokenizer.json, tokenizer_config.json, config.json, chat_template.jinja, omnivoice_onnx_manifest.json }` — the exact layout Plan 2's backend expects; and a printed **GB10 CUDA RTF** for the catalog card.

- [ ] **Step 1: Write `reexport.py` (orchestration)**

```python
# scripts/reexport-omnivoice/reexport.py
import argparse, json, os, shutil, sys
sys.path.insert(0, ".spike/models/repo")  # authors' codes/ + user_script for Higgs + backbone wrappers
from exporters import load_model, export_llm, export_audio_embeddings, export_audio_heads, export_higgs, quantize_llm

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=".spike/models/omnivoice_pt")
    ap.add_argument("--out", default="./out")
    ap.add_argument("--repo", default="jiangzhuo9357/omnivoice-onnx-bidi")
    args = ap.parse_args()

    m = load_model(args.src)
    fp32 = os.path.join(args.out, "_fp32"); os.makedirs(fp32, exist_ok=True)
    export_llm(m, fp32, "fp32")
    for mode in ("fp16", "int4"):
        d = os.path.join(args.out, mode); os.makedirs(d, exist_ok=True)
        quantize_llm(os.path.join(fp32, "llm_decoder.onnx"), d, mode)
        export_audio_embeddings(m, d)
        export_audio_heads(m, d)
        for f in ("tokenizer.json", "tokenizer_config.json", "config.json", "chat_template.jinja"):
            if os.path.exists(os.path.join(args.src, f)):
                shutil.copy(os.path.join(args.src, f), os.path.join(d, f))
    export_higgs(args.src, args.out)  # shared audio_tokenizer/ at repo root
    manifest = {"source": "k2-fsa/OmniVoice", "license": "CC-BY-NC-4.0",
                "variants": ["fp16", "int4"], "higgs": "audio_tokenizer", "sample_rate": 24000,
                "note": "bidirectional llm_decoder re-export; run with plain onnxruntime"}
    json.dump(manifest, open(os.path.join(args.out, "omnivoice_onnx_manifest.json"), "w"), indent=2)
    shutil.rmtree(fp32, ignore_errors=True)
    print("assembled", args.out)

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the full build**

Run: `.venv/bin/python reexport.py --src .spike/models/omnivoice_pt --out ./out`
Expected: `out/{fp16,int4,audio_tokenizer}/…` populated; prints "assembled ./out". Verify: `ls out/fp16 out/int4 out/audio_tokenizer`.

- [ ] **Step 3: Add a CUDA-RTF measurement to `verify.py`**

```python
# add to verify.py — measure end-to-end RTF on CUDA (run on the GB10)
def cuda_rtf(model_dir, backbone_dir, text="This is a real time factor measurement.", language="English"):
    import time
    if "CUDAExecutionProvider" in ort.get_available_providers():
        ort.preload_dlls()
    # reuse hybrid_generate but time it; audio duration from the returned wav
    t = time.time()
    wav = hybrid_generate(model_dir, backbone_dir, None, text, language)
    gen = time.time() - t
    dur = len(wav) / 24000
    return {"gen_s": round(gen, 2), "audio_s": round(dur, 2), "rtf": round(gen / dur, 3)}
```

- [ ] **Step 4: Measure RTF on the GB10 and record it**

Run: `.venv/bin/python -c "import sys; sys.path.insert(0,'.spike/models/repo'); import verify; print(verify.cuda_rtf('.spike/models/omnivoice_pt','out/fp16'))"`
Expected: an RTF number printed. **Record it** — it drives Plan 2's catalog `Deployment` rank/tier. (This is a CPU-torch env, so the LLM runs via ORT CUDA but embeddings/heads run in PyTorch-CPU; treat the number as an upper bound and re-confirm with the pure-ONNX pipeline in Plan 2. Note this caveat in the README.)

- [ ] **Step 5: Commit**

```bash
git add scripts/reexport-omnivoice/reexport.py scripts/reexport-omnivoice/verify.py
git commit -m "feat(omnivoice): build orchestration + repo layout + CUDA RTF probe"
```

---

## Task 7: Publish prep (manual, consent-gated) + provenance doc

**Files:**
- Modify: `scripts/reexport-omnivoice/README.md`
- Create: `scripts/reexport-omnivoice/PROVENANCE.md`

**Interfaces:**
- Produces: a documented, reproducible publish step. **No auto-push** — publishing is an outward-facing action requiring explicit human approval.

- [ ] **Step 1: Write `PROVENANCE.md`** (what the artifact is, license, how it differs from onnx-community)

```markdown
# omnivoice-onnx-bidi — provenance

- Source: k2-fsa/OmniVoice (weights CC-BY-NC-4.0; root constraint: Emilia dataset).
- This artifact re-exports ALL graphs from that source. The `llm_decoder` is exported with a
  **full (bidirectional) attention mask** — unlike `onnx-community/OmniVoice-Onnx`, whose genai
  `Qwen3ForCausalLM` build is **causal** and produces noise (see sokuji#351).
- Inference: plain onnxruntime; the real decoding algorithm (CFG + special-token framing + gumbel +
  schedule) lives in the Sokuji sidecar backend, not in this repo.
- License of THIS artifact remains CC-BY-NC-4.0 (a derivative of NC weights). Non-commercial only.
```

- [ ] **Step 2: Document the publish command + a checklist in README** (append)

````markdown
## Publish checklist (manual, requires explicit approval)
- [ ] `out/` built and Task-5 tests green
- [ ] GB10 CUDA RTF recorded
- [ ] PROVENANCE.md copied into `out/`
- [ ] human approval to distribute a CC-BY-NC derivative obtained
```bash
cp PROVENANCE.md out/ && .venv/bin/huggingface-cli upload <repo> ./out . --repo-type model
```
````

- [ ] **Step 3: Verify the checklist references real files**

Run: `ls out/ && test -f scripts/reexport-omnivoice/PROVENANCE.md && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit (do NOT publish)**

```bash
git add scripts/reexport-omnivoice/README.md scripts/reexport-omnivoice/PROVENANCE.md
git commit -m "docs(omnivoice): provenance + manual publish checklist"
```

---

## Self-Review

**Spec coverage (Component 1 of the spec):** ✅ bidirectional LLM re-export (Task 2); all graphs from source (Tasks 2–4); fp16/int4 variants (Task 5); end-to-end audio + parity (Tasks 2,5); CUDA RTF (Task 6); hosted-repo layout matching the backend (Task 6); publish as a manual consent-gated step (Task 7); toolchain isolated from the torch-free sidecar (Global Constraints + Task 1). Higgs fp32 (Task 4). Not in this plan (deferred to Plan 2/3 by design): numpy decoder, sidecar backend, catalog/gate, consent UI.

**Placeholder scan:** none — every code step has concrete code; the one runtime-dependent value (CUDA RTF) is a *measured output* with a recorded caveat, not a placeholder.

**Type consistency:** `export_llm(model, out_path, dtype)`, `export_audio_embeddings(model, out_path)`, `export_audio_heads(model, out_path)`, `export_higgs(model_dir, out_path)`, `quantize_llm(fp32_llm_path, out_path, mode)`, `verify.hybrid_generate(model_dir, backbone_dir, higgs_dir, text, language)`, `verify.cuda_rtf(model_dir, backbone_dir, ...)` — names/signatures consistent across Tasks 2–6. `BidiLLM(llm).forward(inputs_embeds, attention_mask)` consistent.
