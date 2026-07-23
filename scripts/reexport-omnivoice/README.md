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
.venv/bin/python reexport.py --out ./out
```

## Publish (manual, requires HF auth + explicit approval)
```bash
.venv/bin/huggingface-cli upload jiangzhuo9357/omnivoice-onnx-bidi ./out . --repo-type model
```

## RTF (GB10, indicative)
Measured on NVIDIA GB10 (aarch64/sbsa): the bidirectional `llm_decoder` runs on the
CUDA execution provider. End-to-end `cuda_rtf` gave an **upper-bound** RTF in the
~0.5 (longer utterance) to ~1.4 (short utterance, includes one-off model-load) range.
It's an upper bound because `hybrid_generate` still runs the embeddings/heads/Higgs
decode in PyTorch on CPU, and the timer includes model load. The real per-utterance
RTF will be re-measured on the pure-ONNX pipeline in Plan 2.

Note: measuring CUDA RTF requires an sbsa `onnxruntime-gpu` build — the pinned CPU
`onnxruntime` in `requirements.txt` cannot use the CUDA EP.

## Publish checklist (manual, requires explicit approval)
- [ ] `out/` built and Task-5 tests green
- [ ] GB10 CUDA RTF recorded
- [ ] PROVENANCE.md copied into `out/`
- [ ] human approval to distribute a CC-BY-NC derivative obtained
```bash
cp PROVENANCE.md out/ && .venv/bin/huggingface-cli upload jiangzhuo9357/omnivoice-onnx-bidi ./out . --repo-type model
```
