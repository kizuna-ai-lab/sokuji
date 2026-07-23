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
