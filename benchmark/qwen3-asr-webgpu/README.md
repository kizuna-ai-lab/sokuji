# Qwen3-ASR-0.6B WebGPU spike harness

Feasibility spike for issue #465: run Qwen3-ASR-0.6B in the browser lane (`LOCAL_INFERENCE`)
with onnxruntime-web and no transformers.js model class. Findings are in
`docs/superpowers/specs/2026-09-02-qwen3-asr-webgpu-spike.md`; raw results are under `results/`.

Nothing here is wired into the app. It is a static page plus scripts, kept so the numbers can
be reproduced and so the worker implementation can start from working code.

## Layout

| path | what |
|---|---|
| `www/index.html`, `www/main.js` | the page: loads ORT-web, encoder + prefill + step sessions, KV cache kept as GPU buffers, greedy loop, timings as `RESULT {...}` console lines and `window.__result` |
| `www/mel.js` | Whisper-style log-mel (n_fft 400, hop 160, 128 Slaney mels) matching the export pipeline's `src/mel.py` to 2e-5, plus a PCM16 WAV parser |
| `www/tokenizer.js` | byte-level BPE *decoder* from `tokenizer.json` (encoding is not needed: the prompt is fixed token ids) |
| `www/mel_filters.json` | the filterbank, emitted by `mkfilters.py` |
| `www/probe.html` | prints the WebGPU adapter (vendor, shader-f16) — run this first on a new box |
| `serve.py` | static server; `--isolate` adds COOP/COEP for multi-threaded wasm |
| `run_page.mjs` / `run_page.py` | drive headless Chrome over CDP and print the RESULT lines (node ≥ 22 or python + `websocket-client`) |
| `run_probe.cmd` | Windows wrapper (cmd.exe eats `=` in arguments, so the flags live here) |
| `run_onnx_cpu.py` | the same pipeline on onnxruntime CPU in Python, with CER against `clips/manifest.json` |
| `to_q4f16_ort.py` | fp16-activation variant of the int4 graphs via ORT's converter |
| `fetch_clips2.py`, `dump_ref.py`, `check_js.mjs` | test clips (FLEURS ja/zh through datasets-server / parquet range reads), JS-vs-Python cross-checks |
| `summarize.py` | tables + medians from the RESULT logs and CPU JSON |
| `upload_hf.py`, `hf_README.md`, `rename_ext.py` | pushes the chosen files + model card to the Hub (`jiangzhuo9357/Qwen3-ASR-0.6B-ONNX`); `rename_ext.py` renames a model together with its external-data file |
| `qwen3-asr-onnx-last-token-logits.patch` | the one change applied to andrewleech/qwen3-asr-onnx before exporting |

## Layout v2 (`export_v2/`) — what the product consumes

The spike layout carried the embedding table three times. v2 (plan:
`docs/superpowers/plans/2026-09-02-qwen3-asr-onnx-layout-v2.md`) fixes that:

| script | does |
|---|---|
| `export_v2.py --src <v1 dir> --out <v2 dir>` | prefill graph on `input_embeds` (no embedding inside any graph), last-token logits; step graph unchanged; copies encoder/tokenizer/config |
| `decode_v2.py` | the reference greedy loop the worker mirrors: prompt ids → rows of the external table, encoder output spliced over the pads, init once, step per token |
| `check_tokens.py <v1> <v2> [.int4] [--force zh]` | token-exact comparison against the v1 FP32 graphs on en/ja/zh clips |
| `quantize_v2.sh` | int4 RTN block 32 + `share_weights.py` → `decoder_weights.int4.data` |
| `q4f16_v2.sh` | fp16 activations on the int4 graphs (norm/softmax/rotary in fp32), duplicate Casts removed, shared `decoder_weights.q4f16.data` |
| `embed_int8.py` | `embed_tokens.int8.bin` + `embed_scales.f32.bin` (per-row symmetric) |
| `make_prompt_config.py` | `prompt_config.json`: prompt ids, per-language `language <Name><asr_text>` prefix ids, audio-token formula, embedding dtype, decoder dims, per-variant file roles |

The page (`www/main.js`) speaks both layouts: when `prompt_config.json` exists next to the
model it uses v2 (`?variant=q4|q4f16`, `&force=<iso>`), otherwise the v1 parameters.

`export_v2.py` finds the `andrewleech/qwen3-asr-onnx` checkout via `--pipeline <dir>`,
`$QWEN3_ASR_ONNX_DIR`, or the current directory — run it from inside your clone (as the
Reproduce steps do), no path is hard-coded.

## Reproduce

```bash
# 1. export (CPU is fine; ~2 min after the 1.9 GB download)
git clone https://github.com/andrewleech/qwen3-asr-onnx && cd qwen3-asr-onnx
git apply ../qwen3-asr-onnx-last-token-logits.patch
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python --index-url https://download.pytorch.org/whl/cpu torch
uv pip install --python .venv/bin/python qwen-asr onnx onnxruntime onnxscript soundfile librosa huggingface_hub datasets onnxconverter-common
.venv/bin/python export.py --model Qwen/Qwen3-ASR-0.6B
.venv/bin/python quantize_nbits.py --input output/qwen3-asr-0.6b --output output/qwen3-asr-0.6b --bits 4 --block-size 64 --accuracy-level 4
.venv/bin/python export_encoder_native_fp16.py --model Qwen/Qwen3-ASR-0.6B --output output/qwen3-asr-0.6b/encoder.fp16.onnx --verify
.venv/bin/python convert_embed_fp16.py --model-dir output/qwen3-asr-0.6b
# validate.py needs embed_tokens_shape in config.json (add [151936, 1024]) — then:
.venv/bin/python validate.py --onnx-dir output/qwen3-asr-0.6b --audio ../clips/jfk.wav

# 2. serve: www/models -> output/, www/clips -> clips/, www/ort -> node_modules/onnxruntime-web/dist
python3 serve.py --port 8765

# 3. run (Linux example; on Windows use run_probe.cmd, on macOS run_page.py)
node run_page.mjs "$CHROME" 'http://127.0.0.1:8765/index.html?ep=webgpu&enc=encoder.fp16.onnx&init=decoder_init.int4.onnx&step=decoder_step.int4.onnx&initData=decoder_init.int4.onnx.data&stepData=decoder_step.int4.onnx.data&embed=embed_tokens.fp16.bin&embedDtype=fp16&clips=jfk.wav&repeat=1' 900
python3 summarize.py page-*.log
```

Remote boxes need `--unsafely-treat-insecure-origin-as-secure=http://<server>:8765` because
WebGPU only exists in secure contexts (`navigator.gpu` is undefined over plain LAN http).

## Things that bit us

- ORT-web resolves `env.wasm.wasmPaths` relative to its own module URL; pass an absolute URL.
- The upstream prefill graph emits full-sequence logits; slice to the last position before
  exporting or every utterance reads back ~120 MB from the GPU.
- `onnxconverter_common` cannot serialize the >2 GB FP32 decoders; convert the int4 graphs
  instead, and keep RMSNorm/softmax ops in fp32 or the fp16 variance overflows to NaN.
- On the GB10 (aarch64 + NVIDIA, Vulkan) `chrome --headless=new` never holds a WebGPU
  adapter (`CreateCommandBuffer kTransientFailure`), whatever the flags. The old
  `chromium_headless_shell` binary from the same Playwright cache does, reliably, with
  `--use-vulkan=native --disable-vulkan-surface`. That adapter has **no `shader-f16`**, so the
  fp16 encoder and the q4f16 decoders refuse to load there ("Program Transpose requires f16")
  — gate every fp16 artifact on the feature, not on the vendor.
- `validate.py` wants `embed_tokens_shape` in `config.json`, which this `export.py` version
  does not write.
