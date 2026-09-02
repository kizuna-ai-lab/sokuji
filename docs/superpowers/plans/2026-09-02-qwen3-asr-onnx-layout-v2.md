# Qwen3-ASR-0.6B ONNX layout v2 (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the spike's 1.5–1.9 GB Qwen3-ASR-0.6B ONNX package on the Hub with a ~1.0 GB layout that the browser worker (PR 2) consumes, validated token-for-token and re-measured on the fleet.

**Architecture:** The prefill graph takes `input_embeds` instead of `input_ids` (the JS side builds the prompt embedding from the one external embedding table it already uses for decode steps), so no embedding lives inside any graph; both decoders share one external weights file per precision; the embedding table ships as per-row int8 with fp32 scales; a `prompt_config.json` carries every constant the worker needs (prompt ids, prefix-forcing ids per language, audio-token formula, mel params, file roles). Two variants: `q4` (fp32 encoder + int4 decoders) and `q4f16` (fp16 encoder + fp16-activation int4 decoders).

**Tech Stack:** Python 3.12 venv at `/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv` (torch 2.14 cpu, transformers 4.57.6, qwen-asr 0.0.6, onnx 1.22, onnxruntime 1.29, onnxconverter-common), the andrewleech/qwen3-asr-onnx checkout at `/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx` (patched: last-token logits), onnxruntime-web 1.26.0-dev in the spike page, Hugging Face Hub repo `jiangzhuo9357/Qwen3-ASR-0.6B-ONNX`.

**Spec:** `docs/superpowers/specs/2026-09-02-qwen3-asr-webgpu-spike.md` (sections "Sizes", "Quality notes", "Productization plan" step 1).

## Global Constraints

- Every artifact must load in onnxruntime-web 1.26.0-dev.20260416 on the WebGPU EP; verify in the spike page, not only in Python.
- The fp16 encoder and the q4f16 decoders are one variant (`q4f16`) gated on `shader-f16`; the fp32 encoder and int4 decoders are the other (`q4`) with no feature requirement.
- int4 = `MatMulNBitsQuantizer` RTN, 4 bit, **block 32**, accuracy level 4 (block 32 passed the `zh-fleurs1883` clip where block 64 collapsed).
- Prefill graphs emit logits for the last position only.
- KV cache layout stays `[28, batch, 8, seq, 128]` stacked keys / stacked values (the worker keeps them as GPU buffers).
- English-only comments and docs. Conventional Commits. All new scripts live under `benchmark/qwen3-asr-webgpu/export_v2/` in the repo; heavy files never enter git.
- Never push to `main`; PR opening needs jiangzhuo's explicit OK.
- Bash in this session must use literal absolute paths (the worktree hook rejects variables, heredocs and `source`).

Paths used below: `T=/home/jiangzhuo/.claude/jobs/c6177dc7/tmp` (write it out), `PY=$T/qwen3-venv/bin/python` (write it out), `SRC=$T/qwen3-asr-onnx` (the export pipeline checkout), `OUT=$SRC/output/v2`, `REPO=/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu`, `V2=$REPO/benchmark/qwen3-asr-webgpu/export_v2`.

---

### Task 1: Prefill graph on `input_embeds` (FP32 export)

**Files:**
- Create: `benchmark/qwen3-asr-webgpu/export_v2/export_v2.py`
- Create: `benchmark/qwen3-asr-webgpu/export_v2/decode_v2.py` (Python reference loop for the v2 layout, used by every later task)
- Test: `benchmark/qwen3-asr-webgpu/export_v2/check_tokens.py` (token-exact comparison against the v1 FP32 export)

**Interfaces:**
- Consumes: `src.decoder_wrapper._decoder_layer_forward`, `DecoderStepWrapper`, `export_decoder_step` from the pipeline checkout; `src.mel.log_mel_spectrogram`; `src.prompt.build_prompt_ids`, `get_audio_pad_range`, `ASR_TEXT_TOKEN_ID`, `EOS_TOKEN_IDS`.
- Produces: `$OUT/decoder_init.onnx` with inputs `input_embeds` [1,S,1024] fp32, `position_ids` [1,S] int64 and outputs `logits` [1,1,151936], `present_keys`, `present_values`; `$OUT/decoder_step.onnx` unchanged from v1; `$OUT/encoder.onnx` (copied), `$OUT/embed_tokens.bin` (fp32 raw, copied), tokenizer/config files copied. `decode_v2.greedy_decode(sessions, embed_f32, audio_features, prompt_ids, max_tokens) -> list[int]` and `decode_v2.load_embed(path, cfg) -> np.ndarray[float32]` (handles fp32 / fp16 / int8+scales).

- [ ] **Step 1: Write `decode_v2.py`** — the reference loop the browser mirrors (prefill on embeddings):

```python
"""Reference greedy loop for the v2 layout: prefill takes input_embeds built on the host."""
import json, os
import numpy as np

def load_embed(model_dir: str) -> np.ndarray:
    cfg = json.load(open(os.path.join(model_dir, "prompt_config.json"))) if os.path.exists(os.path.join(model_dir, "prompt_config.json")) else {}
    emb = cfg.get("embedding", {"file": "embed_tokens.bin", "dtype": "float32", "shape": [151936, 1024]})
    shape = tuple(emb["shape"])
    p = os.path.join(model_dir, emb["file"])
    if emb["dtype"] == "float32":
        return np.fromfile(p, dtype=np.float32).reshape(shape)
    if emb["dtype"] == "float16":
        return np.fromfile(p, dtype=np.float16).reshape(shape).astype(np.float32)
    if emb["dtype"] == "int8":
        q = np.fromfile(p, dtype=np.int8).reshape(shape).astype(np.float32)
        scales = np.fromfile(os.path.join(model_dir, emb["scales_file"]), dtype=np.float32).reshape(shape[0], 1)
        return q * scales
    raise ValueError(emb["dtype"])

def greedy_decode(sessions, embed_f32, audio_features, prompt_ids, max_tokens=256, eos=(151643, 151645), audio_pad=151676):
    ids = np.asarray(prompt_ids)
    pos = np.where(ids == audio_pad)[0]
    a0, a1 = int(pos[0]), int(pos[-1]) + 1
    assert a1 - a0 == audio_features.shape[1], (a1 - a0, audio_features.shape)
    x = embed_f32[ids].copy()
    x[a0:a1] = audio_features[0]
    init = sessions["decoder_init"]; step = sessions["decoder_step"]
    f16 = init.get_inputs()[0].type == "tensor(float16)"
    dt = np.float16 if f16 else np.float32
    logits, pk, pv = init.run(["logits", "present_keys", "present_values"], {
        "input_embeds": x[None].astype(dt), "position_ids": np.arange(len(ids), dtype=np.int64)[None]})
    nxt = int(np.argmax(logits[0, -1].astype(np.float32))); out = [nxt]; p = len(ids)
    while nxt not in eos and len(out) < max_tokens:
        logits, pk, pv = step.run(["logits", "present_keys", "present_values"], {
            "input_embeds": embed_f32[nxt][None, None].astype(dt), "position_ids": np.array([[p]], dtype=np.int64),
            "past_keys": pk, "past_values": pv})
        nxt = int(np.argmax(logits[0, -1].astype(np.float32))); out.append(nxt); p += 1
    return out
```

- [ ] **Step 2: Write `export_v2.py`** — new prefill wrapper + reuse of the pipeline's step export:

```python
"""v2 export: prefill on input_embeds (no embedding table in any graph), last-token logits."""
import argparse, os, shutil, sys
import torch, torch.nn as nn
sys.path.insert(0, "/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx")
from export import load_model  # noqa: E402
from src.decoder_wrapper import _decoder_layer_forward, export_decoder_step  # noqa: E402

class PrefillEmbedsWrapper(nn.Module):
    def __init__(self, text_model, lm_head, text_config):
        super().__init__()
        self.layers, self.norm, self.rotary_emb, self.lm_head = text_model.layers, text_model.norm, text_model.rotary_emb, lm_head
        self.num_kv_groups = text_config.num_attention_heads // text_config.num_key_value_heads
    def forward(self, input_embeds, position_ids):
        seq_len = input_embeds.shape[1]
        cos, sin = self.rotary_emb(input_embeds, position_ids.unsqueeze(0).expand(3, -1, -1))
        mask = torch.triu(torch.full((seq_len, seq_len), torch.finfo(input_embeds.dtype).min, dtype=input_embeds.dtype), 1)[None, None]
        h, ks, vs = input_embeds, [], []
        for layer in self.layers:
            h, k, v = _decoder_layer_forward(layer, h, cos, sin, mask, past_key=None, past_value=None, num_kv_groups=self.num_kv_groups)
            ks.append(k); vs.append(v)
        logits = self.lm_head(self.norm(h)[:, -1:, :])
        return logits, torch.stack(ks, 0), torch.stack(vs, 0)

ap = argparse.ArgumentParser(); ap.add_argument("--model", default="Qwen/Qwen3-ASR-0.6B"); ap.add_argument("--src", required=True, help="v1 output dir (encoder.onnx, tokenizer, config)"); ap.add_argument("--out", required=True)
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
model = load_model(a.model, dtype=torch.float32)
tc = model.config.thinker_config.text_config
w = PrefillEmbedsWrapper(model.thinker.model, model.thinker.lm_head, tc).eval()
S = 100
x = torch.randn(1, S, tc.hidden_size); pos = torch.arange(S)[None]
with torch.no_grad():
    torch.onnx.export(w, (x, pos), os.path.join(a.out, "decoder_init.onnx"), input_names=["input_embeds", "position_ids"],
        output_names=["logits", "present_keys", "present_values"],
        dynamic_axes={"input_embeds": {0: "batch", 1: "seq_len"}, "position_ids": {0: "batch", 1: "seq_len"},
                      "present_keys": {1: "batch", 3: "seq_len"}, "present_values": {1: "batch", 3: "seq_len"}},
        opset_version=17, do_constant_folding=True, dynamo=False)
export_decoder_step(model, os.path.join(a.out, "decoder_step.onnx"))
for f in ("encoder.onnx", "encoder.fp16.onnx", "embed_tokens.bin", "tokenizer.json", "tokenizer_config.json", "vocab.json", "added_tokens.json", "config.json", "mel_filters.json"):
    shutil.copy(os.path.join(a.src, f), a.out)
print("exported to", a.out, sorted(os.listdir(a.out)))
```

Note: `torch.onnx.export` with a >2 GB graph writes external data automatically (`decoder_init.onnx.data`); if the legacy exporter refuses, pass `external_data=True` (torch ≥ 2.5 keyword) — check the emitted file list before continuing.

- [ ] **Step 3: Run the export**

Run: `cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx && /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu/export_v2/export_v2.py --src output/qwen3-asr-0.6b --out output/v2`
Expected: `decoder_init.onnx` (+ `.data`) and `decoder_step.onnx` (+ `.data`) in `output/v2`; init inputs are exactly `input_embeds`, `position_ids`.

- [ ] **Step 4: Write `check_tokens.py`** — token-exact against the v1 FP32 output on two clips:

```python
"""Token-exact check: v2 layout (prefill on embeddings) vs the v1 FP32 graphs."""
import os, sys
import numpy as np, onnxruntime as ort, soundfile as sf
sys.path.insert(0, "/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src.mel import log_mel_spectrogram; from src.prompt import build_prompt_ids, get_feat_extract_output_lengths
from src.inference import greedy_decode_onnx
from decode_v2 import greedy_decode, load_embed
v1, v2 = sys.argv[1], sys.argv[2]; suffix = sys.argv[3] if len(sys.argv) > 3 else ""
so = ort.SessionOptions(); so.intra_op_num_threads = 8
S = lambda d, n: ort.InferenceSession(os.path.join(d, n), so, providers=["CPUExecutionProvider"])
enc = S(v1, "encoder.onnx")
s1 = {"decoder_init": S(v1, "decoder_init.onnx"), "decoder_step": S(v1, "decoder_step.onnx")}
s2 = {"decoder_init": S(v2, f"decoder_init{suffix}.onnx"), "decoder_step": S(v2, f"decoder_step{suffix}.onnx")}
e1 = np.fromfile(os.path.join(v1, "embed_tokens.bin"), dtype=np.float32).reshape(-1, 1024); e2 = load_embed(v2)
ok = True
for clip in ("jfk.wav", "ja-fleurs1828.wav", "zh-fleurs1883.wav"):
    audio, _ = sf.read(f"/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/clips/{clip}", dtype="float32")
    mel = log_mel_spectrogram(audio).numpy(); af = enc.run(["audio_features"], {"mel": mel})[0]
    prompt = build_prompt_ids(get_feat_extract_output_lengths(mel.shape[-1]))
    t1 = greedy_decode_onnx(s1, e1, af, prompt); t2 = greedy_decode(s2, e2, af, prompt)
    same = t1 == t2; ok &= same
    print(clip, "v1", len(t1), "v2", len(t2), "IDENTICAL" if same else f"DIFF at {next(i for i,(a,b) in enumerate(zip(t1,t2)) if a!=b) if any(a!=b for a,b in zip(t1,t2)) else min(len(t1),len(t2))}")
print("PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
```

- [ ] **Step 5: Run the check**

Run: `cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx && /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu/export_v2/check_tokens.py output/qwen3-asr-0.6b output/v2`
Expected: `IDENTICAL` for all three clips (FP32 vs FP32 differs only by where the embedding lookup happens), then `PASS`.

- [ ] **Step 6: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu && git add benchmark/qwen3-asr-webgpu/export_v2 && git commit -m "feat(spike): Qwen3-ASR v2 export — prefill on input_embeds, reference loop, token-exact check"
```

---

### Task 2: RMSNorm fusion before quantization (best effort)

**Files:**
- Modify: nothing in the repo; uses the pipeline's `optimize_graphs.py` on `$OUT`
- Test: `check_tokens.py` from Task 1

**Interfaces:**
- Consumes: `$OUT/decoder_init.onnx`, `$OUT/decoder_step.onnx` (FP32).
- Produces: the same files with `SimplifiedLayerNormalization` nodes (in place), or an explicit "skipped" note in the results.

- [ ] **Step 1: Run the fusion**

Run: `cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx && /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python optimize_graphs.py --input output/v2 2>&1 | tail -20`
Expected: prints per-file fusion counts; if it dies on the 2 GB protobuf limit (`Failed to serialize proto`), record that in `benchmark/qwen3-asr-webgpu/results/v2-notes.md` and skip to Task 3 — the fusion is an optimisation, not a requirement.

- [ ] **Step 2: Re-run the token-exact check** (Task 1 Step 5 command). Expected: `PASS`. If fused graphs change tokens, restore the unfused files (re-run Task 1 Step 3) and record it.

- [ ] **Step 3: Commit the note**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu && git add benchmark/qwen3-asr-webgpu/results/v2-notes.md && git commit -m "docs(spike): record the RMSNorm fusion outcome for the v2 graphs"
```

---

### Task 3: int4 (block 32) with one shared weights file

**Files:**
- Create: `benchmark/qwen3-asr-webgpu/export_v2/quantize_v2.sh`
- Test: `check_tokens.py` with suffix `.int4` (expects near-identity, see step 3)

**Interfaces:**
- Consumes: `$OUT/decoder_init.onnx`, `$OUT/decoder_step.onnx`.
- Produces: `$OUT/decoder_init.int4.onnx`, `$OUT/decoder_step.int4.onnx`, `$OUT/decoder_weights.int4.data` (shared).

- [ ] **Step 1: Write `quantize_v2.sh`**

```bash
#!/bin/bash
# int4 RTN block 32 for both v2 decoders, then dedupe the identical tensors into one data file.
set -e
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx
PY=/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python
$PY quantize_nbits.py --input output/v2 --output output/v2 --bits 4 --block-size 32 --accuracy-level 4
$PY share_weights.py output/v2 --suffix int4 --verify
ls -l --block-size=M output/v2 | awk '{print $5, $9}' | grep -E 'int4|weights'
```

- [ ] **Step 2: Run it**

Run: `bash /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu/export_v2/quantize_v2.sh`
Expected: `decoder_weights.int4.data` around 330–360 MB, `decoder_init.int4.onnx` and `decoder_step.int4.onnx` a few MB each, no per-decoder `.int4.onnx.data` left, `--verify` reports ORT loads both.

- [ ] **Step 3: Check transcripts** — int4 is not token-exact with FP32 by nature; require the same *text* on the three clips:

Run: `cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx && /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu/export_v2/check_tokens.py output/qwen3-asr-0.6b output/v2 .int4`
Expected: `jfk.wav` and `ja-fleurs1828.wav` IDENTICAL or differing only after the text is complete; `zh-fleurs1883.wav` must NOT be the 4-token "Current." collapse (block 32 passed this on CPU in the spike). A `FAIL` on token identity alone is acceptable here; a collapse is not.

- [ ] **Step 4: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu && git add benchmark/qwen3-asr-webgpu/export_v2/quantize_v2.sh && git commit -m "feat(spike): v2 int4 block-32 quantization with a shared weights file"
```

---

### Task 4: q4f16 decoders sharing one weights file

**Files:**
- Create: `benchmark/qwen3-asr-webgpu/export_v2/q4f16_v2.sh`
- Reuse: `benchmark/qwen3-asr-webgpu/to_q4f16_ort.py`, `dedupe_values.py`
- Test: `check_tokens.py` with suffix `.q4f16`

**Interfaces:**
- Consumes: `$OUT/decoder_*.int4.onnx` + `decoder_weights.int4.data`.
- Produces: `$OUT/decoder_init.q4f16.onnx`, `$OUT/decoder_step.q4f16.onnx`, `$OUT/decoder_weights.q4f16.data`; both graphs have fp16 `input_embeds`, `past_*`, `logits`, `present_*`.

- [ ] **Step 1: Write `q4f16_v2.sh`**

```bash
#!/bin/bash
# fp16 activations on top of the shared-weight int4 graphs; norm/softmax/rotary stay fp32.
set -e
D=/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx/output/v2
PY=/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python
B=/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu
$PY $B/to_q4f16_ort.py $D q4f16
$PY $B/dedupe_values.py $D/decoder_init.q4f16.onnx $D/decoder_step.q4f16.onnx
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx && $PY share_weights.py output/v2 --suffix q4f16 --verify
ls -l --block-size=M $D | awk '{print $5, $9}' | grep -E 'q4f16'
```

`to_q4f16_ort.py` reads `decoder_*.int4.onnx` — after Task 3 those reference the shared `decoder_weights.int4.data`; `onnx.load` resolves it, and `save_model_to_file(..., use_external_data_format=True)` writes per-model `.data` files again, which `share_weights.py --suffix q4f16` then merges.

- [ ] **Step 2: Run it**

Run: `bash /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu/export_v2/q4f16_v2.sh`
Expected: `decoder_weights.q4f16.data` ≈ 300–330 MB; `--verify` passes.

- [ ] **Step 3: Transcript check with fp16 feeds** (`decode_v2.greedy_decode` casts feeds by the session's input type):

Run: `cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx && /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu/export_v2/check_tokens.py output/qwen3-asr-0.6b output/v2 .q4f16`
Expected: sensible transcripts for all three clips (fp16 MatMulNBits may not exist on this CPU build — if ORT raises "not implemented" on CPU, record it and rely on the browser validation in Task 8; the spike already proved this graph shape correct on the M4 and the 4070).

- [ ] **Step 4: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu && git add benchmark/qwen3-asr-webgpu/export_v2/q4f16_v2.sh && git commit -m "feat(spike): v2 q4f16 decoders with a shared weights file"
```

---

### Task 5: int8 embedding table with per-row scales

**Files:**
- Create: `benchmark/qwen3-asr-webgpu/export_v2/embed_int8.py`
- Test: built into the script (max abs dequant error and the three-clip transcript check through `decode_v2.load_embed`)

**Interfaces:**
- Consumes: `$OUT/embed_tokens.bin` (fp32, [151936, 1024]).
- Produces: `$OUT/embed_tokens.int8.bin` (int8 row-major), `$OUT/embed_scales.f32.bin` (151936 float32, one per row: `absmax / 127`), and the `embedding` block that Task 6 writes into `prompt_config.json`: `{"file": "embed_tokens.int8.bin", "dtype": "int8", "shape": [151936, 1024], "scales_file": "embed_scales.f32.bin"}`.

- [ ] **Step 1: Write `embed_int8.py`**

```python
"""Per-row symmetric int8 quantization of the embedding table (dequant = q * scale)."""
import os, sys
import numpy as np
d = sys.argv[1]
w = np.fromfile(os.path.join(d, "embed_tokens.bin"), dtype=np.float32).reshape(-1, 1024)
scales = (np.abs(w).max(axis=1) / 127.0).astype(np.float32)
scales[scales == 0] = 1.0
q = np.clip(np.rint(w / scales[:, None]), -127, 127).astype(np.int8)
q.tofile(os.path.join(d, "embed_tokens.int8.bin")); scales.tofile(os.path.join(d, "embed_scales.f32.bin"))
err = np.abs(q.astype(np.float32) * scales[:, None] - w)
print(f"rows {w.shape[0]} max abs err {err.max():.5f} mean {err.mean():.6f} rel-to-absmax {err.max() / np.abs(w).max():.4f}")
print("sizes MB:", os.path.getsize(os.path.join(d, 'embed_tokens.int8.bin')) / 1e6, os.path.getsize(os.path.join(d, 'embed_scales.f32.bin')) / 1e6)
```

- [ ] **Step 2: Run it**

Run: `/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu/export_v2/embed_int8.py /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx/output/v2`
Expected: `embed_tokens.int8.bin` ≈ 155.6 MB, scales ≈ 0.6 MB, max abs error well below 1e-2 (embedding magnitudes are ~1e-1).

- [ ] **Step 3: Decide fp16 vs int8 by transcript** — run Task 1 Step 5's `check_tokens.py` for `.int4` once with `prompt_config.json` pointing at int8 (after Task 6 writes it) and once at fp32 (`embed_tokens.bin`). Acceptance: identical token sequences on the three clips. If int8 changes any token, ship `embed_tokens.fp16.bin` (convert with `convert_embed_fp16.py --model-dir output/v2`) and set `"dtype": "float16"` instead; write the decision into `results/v2-notes.md`.

- [ ] **Step 4: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu && git add benchmark/qwen3-asr-webgpu/export_v2/embed_int8.py benchmark/qwen3-asr-webgpu/results/v2-notes.md && git commit -m "feat(spike): int8 embedding table with per-row scales for the v2 layout"
```

---

### Task 6: `prompt_config.json` — every constant the worker needs

**Files:**
- Create: `benchmark/qwen3-asr-webgpu/export_v2/make_prompt_config.py`
- Test: assertions inside the script (round-trips through the tokenizer)

**Interfaces:**
- Consumes: `$OUT/tokenizer.json` (+ config), the 16-language list from the sidecar catalog row (`zh en ja ko yue ar de es fr it pt ru th vi hi id`).
- Produces: `$OUT/prompt_config.json` with this exact shape (PR 2's `qwen3-asr-prompt.ts` types mirror it):

```json
{
  "layout_version": 2,
  "model": "Qwen/Qwen3-ASR-0.6B",
  "mel": {"sample_rate": 16000, "n_fft": 400, "hop_length": 160, "n_mels": 128, "fmin": 0, "fmax": 8000, "filters_file": "mel_filters.json", "drop_last_frame": true},
  "audio_tokens": {"conv_window": 100, "tokens_per_window": 13, "conv_out": "(t + 1) // 2 applied three times to (frames % conv_window)"},
  "prompt": {"prefix_ids": [151644, 9125, 198, 151645, 198, 151644, 882, 198, 151669], "suffix_ids": [151670, 151645, 198, 151644, 77091, 198], "audio_pad_id": 151676, "asr_text_id": 151704, "eos_ids": [151643, 151645], "max_new_tokens": 256},
  "language_prefix_ids": {"zh": [11528, 8453, 151704], "en": [], "ja": []},
  "language_names": {"zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean", "yue": "Cantonese", "ar": "Arabic", "de": "German", "es": "Spanish", "fr": "French", "it": "Italian", "pt": "Portuguese", "ru": "Russian", "th": "Thai", "vi": "Vietnamese", "hi": "Hindi", "id": "Indonesian"},
  "embedding": {"file": "embed_tokens.int8.bin", "dtype": "int8", "shape": [151936, 1024], "scales_file": "embed_scales.f32.bin"},
  "decoder": {"num_layers": 28, "num_key_value_heads": 8, "head_dim": 128, "hidden_size": 1024, "vocab_size": 151936},
  "variants": {
    "q4":    {"encoder": "encoder.onnx",      "decoder_init": "decoder_init.int4.onnx",  "decoder_step": "decoder_step.int4.onnx",  "weights": "decoder_weights.int4.data",  "required_features": []},
    "q4f16": {"encoder": "encoder.fp16.onnx", "decoder_init": "decoder_init.q4f16.onnx", "decoder_step": "decoder_step.q4f16.onnx", "weights": "decoder_weights.q4f16.data", "required_features": ["shader-f16"]}
  }
}
```

(`language_prefix_ids` values above are illustrative; the script computes them.) The prompt ids come from `src/prompt.py` (`build_prompt_ids(0)` split at the audio block).

- [ ] **Step 1: Write `make_prompt_config.py`**

```python
"""Emit prompt_config.json for the v2 layout. Language prefixes are the tokenizer's encoding of 'language <Name>' + <asr_text>."""
import json, os, sys
sys.path.insert(0, "/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx")
from transformers import AutoTokenizer  # noqa: E402
from src.prompt import ASR_TEXT_TOKEN_ID, AUDIO_PAD_TOKEN_ID, EOS_TOKEN_IDS, build_prompt_ids  # noqa: E402
d = sys.argv[1]; embed_dtype = sys.argv[2] if len(sys.argv) > 2 else "int8"
tok = AutoTokenizer.from_pretrained(d)
ids0 = build_prompt_ids(0)  # no audio pads: prefix + suffix back to back
cut = ids0.index(151669) + 1  # <|audio_start|> ends the prefix
prefix, suffix = ids0[:cut], ids0[cut:]
assert build_prompt_ids(3) == prefix + [AUDIO_PAD_TOKEN_ID] * 3 + suffix
names = {"zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean", "yue": "Cantonese", "ar": "Arabic", "de": "German", "es": "Spanish",
         "fr": "French", "it": "Italian", "pt": "Portuguese", "ru": "Russian", "th": "Thai", "vi": "Vietnamese", "hi": "Hindi", "id": "Indonesian"}
lang_prefix = {k: tok.encode(f"language {v}", add_special_tokens=False) + [ASR_TEXT_TOKEN_ID] for k, v in names.items()}
for k, v in lang_prefix.items():
    assert tok.decode(v[:-1]) == f"language {names[k]}", (k, tok.decode(v[:-1]))
emb = {"int8": {"file": "embed_tokens.int8.bin", "dtype": "int8", "shape": [151936, 1024], "scales_file": "embed_scales.f32.bin"},
       "float16": {"file": "embed_tokens.fp16.bin", "dtype": "float16", "shape": [151936, 1024]},
       "float32": {"file": "embed_tokens.bin", "dtype": "float32", "shape": [151936, 1024]}}[embed_dtype]
cfg = {
    "layout_version": 2, "model": "Qwen/Qwen3-ASR-0.6B",
    "mel": {"sample_rate": 16000, "n_fft": 400, "hop_length": 160, "n_mels": 128, "fmin": 0, "fmax": 8000, "filters_file": "mel_filters.json", "drop_last_frame": True},
    "audio_tokens": {"conv_window": 100, "tokens_per_window": 13, "conv_out": "(t + 1) // 2 applied three times to (frames % conv_window)"},
    "prompt": {"prefix_ids": prefix, "suffix_ids": suffix, "audio_pad_id": AUDIO_PAD_TOKEN_ID, "asr_text_id": ASR_TEXT_TOKEN_ID, "eos_ids": EOS_TOKEN_IDS, "max_new_tokens": 256},
    "language_prefix_ids": lang_prefix, "language_names": names, "embedding": emb,
    "decoder": {"num_layers": 28, "num_key_value_heads": 8, "head_dim": 128, "hidden_size": 1024, "vocab_size": 151936},
    "variants": {
        "q4": {"encoder": "encoder.onnx", "decoder_init": "decoder_init.int4.onnx", "decoder_step": "decoder_step.int4.onnx", "weights": "decoder_weights.int4.data", "required_features": []},
        "q4f16": {"encoder": "encoder.fp16.onnx", "decoder_init": "decoder_init.q4f16.onnx", "decoder_step": "decoder_step.q4f16.onnx", "weights": "decoder_weights.q4f16.data", "required_features": ["shader-f16"]}},
}
json.dump(cfg, open(os.path.join(d, "prompt_config.json"), "w"), indent=1, ensure_ascii=False)
print("prefix", prefix, "suffix", suffix); print({k: v for k, v in list(lang_prefix.items())[:3]})
```

- [ ] **Step 2: Run it**

Run: `/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu/export_v2/make_prompt_config.py /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx/output/v2 int8`
Expected: prefix `[151644, 9125, 198, 151645, 198, 151644, 882, 198, 151669]`, suffix `[151670, 151645, 198, 151644, 77091, 198]`, 16 language prefixes each ending in 151704; no assertion error.

- [ ] **Step 3: Verify prefix forcing through the reference loop** — extend `check_tokens.py` invocation: add an optional 4th argument `--force zh` that appends `cfg["language_prefix_ids"]["zh"]` to the prompt before decoding in the v2 path and prints the text; run it on `zh-fleurs1883.wav` with `.int4`:

Run: `cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx && /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu/export_v2/check_tokens.py output/qwen3-asr-0.6b output/v2 .int4 --force zh`
Expected: the Chinese transcript ("桥下垂直净空十五米…"), never "Current.".

- [ ] **Step 4: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu && git add benchmark/qwen3-asr-webgpu/export_v2 && git commit -m "feat(spike): prompt_config.json — prompt ids, per-language prefix forcing, layout roles"
```

---

### Task 7: CPU quality sweep for v2

**Files:**
- Modify: `benchmark/qwen3-asr-webgpu/run_onnx_cpu.py` — add `--layout v2` (use `decode_v2.greedy_decode` + `load_embed`) and `--force-from-manifest` (force the prefix from each clip's `lang` via `prompt_config.json`)
- Output: `benchmark/qwen3-asr-webgpu/results/v2-cpu-int4.json`, `v2-cpu-int4-forced.json`, `v2-cpu-q4f16.json` (if CPU fp16 runs)

**Interfaces:**
- Consumes: `decode_v2.greedy_decode(sessions, embed_f32, af, prompt, max_tokens)`, `decode_v2.load_embed(dir)`.
- Produces: JSON in the same schema `summarize.py` already reads (`results: [{clip, rtf, cer, text, ...}]`).

- [ ] **Step 1: Add the two flags** — in `run_onnx_cpu.py`, after argument parsing:

```python
ap.add_argument("--layout", choices=["v1", "v2"], default="v1")
ap.add_argument("--force-from-manifest", action="store_true", help="v2: force the language prefix from the clip's manifest lang")
```

and where the prompt is built and decoded:

```python
if a.layout == "v2":
    from decode_v2 import greedy_decode, load_embed  # export_v2/ on sys.path
    pc = json.load(open(os.path.join(a.dir, "prompt_config.json")))
    prompt = pc["prompt"]["prefix_ids"] + [pc["prompt"]["audio_pad_id"]] * n_audio + pc["prompt"]["suffix_ids"]
    lang = manifest.get(name, {}).get("lang")
    if a.force_from_manifest and lang in pc["language_prefix_ids"]:
        prompt = prompt + pc["language_prefix_ids"][lang]
    gen = greedy_decode(sessions, embed, af, prompt, max_tokens=a.max_tokens)
else:
    prompt = build_prompt_ids(n_audio)
    gen = greedy_decode_onnx(sessions, embed, af, prompt, max_tokens=a.max_tokens)
```

with `embed = load_embed(a.dir)` when `--layout v2` (replacing the `np.fromfile` line) and `sys.path.insert(0, os.path.join(HERE, "export_v2"))` near the other inserts. Keep the existing `--force-lang` for v1.

- [ ] **Step 2: Run the sweeps**

```bash
cd /home/jiangzhuo/.claude/jobs/c6177dc7/tmp && P=/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python; B=/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu
```
(write the paths out literally in the session)
- `run_onnx_cpu.py --dir .../output/v2 --layout v2 --suffix .int4 --threads 8 --out $B/results/v2-cpu-int4.json`
- same with `--force-from-manifest --out $B/results/v2-cpu-int4-forced.json`
- same with `--suffix .q4f16 --out $B/results/v2-cpu-q4f16.json` (may fail on CPU fp16; then record and skip)
Expected: median RTF ≈ 0.07–0.09 on the GB10 CPU, mean CER ≤ the spike's int4 (0.157 unforced) and no 4-token collapse in the forced run.

- [ ] **Step 3: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu && git add benchmark/qwen3-asr-webgpu/run_onnx_cpu.py benchmark/qwen3-asr-webgpu/results/v2-cpu-*.json && git commit -m "test(spike): CPU quality sweep for the v2 layout, with and without prefix forcing"
```

---

### Task 8: Browser page on v2 and fleet re-measurement

**Files:**
- Modify: `benchmark/qwen3-asr-webgpu/www/main.js` — read `prompt_config.json`, build prefill embeddings in JS, int8 embedding dequant, optional `&force=<iso>` prefix forcing, variant selection by `&variant=q4|q4f16`
- Output: `results/v2-page-{win,mac,gb10}-{q4,q4f16}.log`

**Interfaces:**
- Consumes: `prompt_config.json` shape from Task 6; blob/URL file names from `variants`.
- Produces: the decode loop PR 2's worker ports verbatim: `buildPromptIds(nAudio, forceIso)`, `embedRow(id) -> Float32Array` (int8 × scale), `prefill(inputEmbeds[1,S,1024], positionIds)`, `step(embed[1,1,1024], pos, pastK, pastV)`.

- [ ] **Step 1: Change `main.js`** — replace the `?init=&step=&initData=&stepData=&embed=&embedDtype=&enc=` parameters with `?variant=q4|q4f16` resolved from `prompt_config.json` (keep the old ones as overrides), and:

```js
// prompt from config
const PC = await (await fetch(base + 'prompt_config.json')).json();
const V = PC.variants[q.get('variant') || (f16Shader ? 'q4f16' : 'q4')];
const ENC = q.get('enc') || V.encoder, INIT = q.get('init') || V.decoder_init, STEP = q.get('step') || V.decoder_step, DATA = q.get('data') || V.weights;
// embedding table: int8 rows × fp32 scale, or fp16/fp32 as declared
const E = PC.embedding; const hidden = E.shape[1];
const embRaw = await (await fetch(base + E.file)).arrayBuffer();
const embScales = E.dtype === 'int8' ? new Float32Array(await (await fetch(base + E.scales_file)).arrayBuffer()) : null;
const embI8 = E.dtype === 'int8' ? new Int8Array(embRaw) : null, embF16 = E.dtype === 'float16' ? new Uint16Array(embRaw) : null, embF32 = E.dtype === 'float32' ? new Float32Array(embRaw) : null;
function embedRowF32(id) {
  const out = new Float32Array(hidden); const o = id * hidden;
  if (embI8) { const s = embScales[id]; for (let i = 0; i < hidden; i++) out[i] = embI8[o + i] * s; }
  else if (embF16) out.set(f16ToF32(embF16.subarray(o, o + hidden)));
  else out.set(embF32.subarray(o, o + hidden));
  return out;
}
function buildPromptIds(nAudio, forceIso) {
  const p = PC.prompt; const ids = [...p.prefix_ids]; const audioStart = ids.length;
  for (let i = 0; i < nAudio; i++) ids.push(p.audio_pad_id);
  ids.push(...p.suffix_ids);
  const forced = forceIso && PC.language_prefix_ids[forceIso];
  if (forced) ids.push(...forced);
  return { ids, audioStart, forced: !!forced };
}
// prefill: embeddings built on the host, audio features spliced in
const { ids, audioStart, forced } = buildPromptIds(nAudio, q.get('force'));
const x = new Float32Array(ids.length * hidden);
for (let i = 0; i < ids.length; i++) x.set(embedRowF32(ids[i]), i * hidden);
x.set(afF32, audioStart * hidden); // afF32 = encoder output as Float32Array [nAudio*1024]
const feeds = { input_embeds: mk(initEmbType, initEmbType === 'float16' ? f32ToF16(x) : x, [1, ids.length, hidden]),
                position_ids: mk('int64', BigInt64Array.from({ length: ids.length }, (_, i) => BigInt(i)), [1, ids.length]) };
```

The step loop is unchanged. When `forced` is true the generated tokens contain no `<asr_text>`; the whole output is text (`r.prefix = 'forced:' + iso`). Both decoders take the same `externalData: [{ path: DATA, data }]` buffer fetched once.

- [ ] **Step 2: Run on GB10 first** (q4 only — no `shader-f16` there), via the headless shell:

`node run_page.mjs <chromium_headless_shell> "http://127.0.0.1:8765/index.html?model=v2&variant=q4&clips=jfk.wav,ja-cv2.wav,ja-fleurs1828.wav,ja-fleurs1834.wav,ja-fleurs1813.wav,zh-fleurs1906.wav,zh-fleurs2006.wav,zh-fleurs1852.wav&repeat=1" 1200 --use-vulkan=native --disable-vulkan-surface` (the `www/models` symlink points at `output/`, so `model=v2` resolves to `output/v2/`).
Expected: transcripts equal to the CPU int4 run; RTF within ±20 % of the spike's 0.091.

- [ ] **Step 3: Run on the fleet** — `fleet_run_win.sh v2-q4 'model=v2&variant=q4&…'`, `fleet_run_win.sh v2-q4f16 'model=v2&variant=q4f16&…'`, same two on the Mac; plus one forced run each (`&force=ja` on the Japanese clips) to confirm the forced path in the browser. Save logs as `results/v2-page-*.log`, run `summarize.py` on them.
Expected: RTF within noise of the spike (Win ≈ 0.12, Mac ≈ 0.11); q4f16 correct text on both.

**Acceptance (jiangzhuo's requirement — the compact layout must not cost speed):** per box and
variant, median RTF and median ms/token within **15 %** of the spike numbers recorded in
`results/summary.txt` (Win int4+fp16enc 0.115 / 34 ms, Mac 0.116 / 19 ms, GB10 q4 0.091 /
25 ms). Outside that band: stop, find the cause (host-built prefill embeddings, int8 dequant
in JS, the shared-weights file, fusion), fix or revert it, and only then continue to Task 9.
Write the before/after table into `results/v2-notes.md`.

- [ ] **Step 4: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu && git add benchmark/qwen3-asr-webgpu/www/main.js benchmark/qwen3-asr-webgpu/results/v2-page-*.log && git commit -m "feat(spike): page speaks the v2 layout (host-built prefill embeddings, int8 table, prefix forcing); fleet numbers"
```

---

### Task 9: Publish v2 on the Hub

**Files:**
- Modify: `benchmark/qwen3-asr-webgpu/upload_hf.py` — `FILES` becomes the v2 list; add `--delete-others` to remove files not in the list
- Modify: `benchmark/qwen3-asr-webgpu/hf_README.md` — v2 file table, sizes, the prefix-forcing recipe, the `prompt_config.json` contract

**Interfaces:**
- Produces: the Hub repo `jiangzhuo9357/Qwen3-ASR-0.6B-ONNX` containing exactly: `encoder.onnx`, `encoder.fp16.onnx`, `decoder_init.int4.onnx`, `decoder_step.int4.onnx`, `decoder_weights.int4.data`, `decoder_init.q4f16.onnx`, `decoder_step.q4f16.onnx`, `decoder_weights.q4f16.data`, `embed_tokens.int8.bin`, `embed_scales.f32.bin`, `mel_filters.json`, `prompt_config.json`, `tokenizer.json`, `tokenizer_config.json`, `vocab.json`, `added_tokens.json`, `config.json`, `README.md`. PR 2's manifest lists these names with their exact byte sizes from `api.model_info(..., files_metadata=True)`.

- [ ] **Step 1: Edit `upload_hf.py`** — new `FILES` list (above) and:

```python
ap.add_argument("--delete-others", action="store_true")
...
if a.delete_others:
    keep = set(FILES) | {"README.md", ".gitattributes"}
    for s in api.list_repo_files(a.repo, repo_type="model"):
        if s not in keep:
            print("delete", s); api.delete_file(s, repo_id=a.repo, repo_type="model")
```

- [ ] **Step 2: Upload**

Run: `/home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-venv/bin/python /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu/benchmark/qwen3-asr-webgpu/upload_hf.py --repo jiangzhuo9357/Qwen3-ASR-0.6B-ONNX --dir /home/jiangzhuo/.claude/jobs/c6177dc7/tmp/qwen3-asr-onnx/output/v2 --delete-others`
Expected: 18 files; `q4` set ≈ 0.72 + 0.35 + 0.16 GB, `q4f16` set ≈ 0.36 + 0.32 + 0.16 GB.

- [ ] **Step 3: Record exact sizes** into `benchmark/qwen3-asr-webgpu/results/v2-hub-files.json` with a one-liner using `HfApi().model_info(repo, files_metadata=True)` (`{rfilename: size}`); PR 2 copies these numbers into the manifest.

- [ ] **Step 4: Point the page at the Hub once** (sanity that CORS and `resolve/main` paths work from a browser): `?model=` cannot express a remote base, so add `&base=https://huggingface.co/jiangzhuo9357/Qwen3-ASR-0.6B-ONNX/resolve/main/` support in `main.js` (`const base = q.get('base') || './models/${MODEL}/'`) and run jfk on the Mac from the Hub.
Expected: same transcript; this is the path the product uses.

- [ ] **Step 5: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu && git add benchmark/qwen3-asr-webgpu && git commit -m "feat(spike): publish the v2 layout to the Hub; record exact file sizes for the manifest"
```

---

### Task 10: Report addendum, README, push, PR request

**Files:**
- Modify: `docs/superpowers/specs/2026-09-02-qwen3-asr-webgpu-spike.md` — new section "Layout v2 (2026-09-0x)" with the size table, CPU/fleet numbers, fusion outcome, embedding decision
- Modify: `benchmark/qwen3-asr-webgpu/README.md` — `export_v2/` section and the v2 run commands

- [ ] **Step 1: Write the addendum** (tables from `results/v2-*`, `summarize.py` output).
- [ ] **Step 2: Commit and push**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/spike-qwen3-asr-webgpu && git add -A benchmark/qwen3-asr-webgpu docs/superpowers && git commit -m "docs(spike): layout v2 results" && git push origin worktree-spike-qwen3-asr-webgpu
```

- [ ] **Step 3: Ask jiangzhuo** for the OK to open PR 1 on `kizuna-ai-lab/sokuji` from `worktree-spike-qwen3-asr-webgpu` → `main` (title: `docs(spike): Qwen3-ASR-0.6B browser-lane feasibility spike and ONNX layout v2 tooling`). Do not open it before the OK.
