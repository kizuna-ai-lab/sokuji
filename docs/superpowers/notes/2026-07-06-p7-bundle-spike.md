# P7 sidecar-bundle packaging spike (2026-07-06)

Goal: lock the packaging **method** that Tasks 3–4 productionize for the
self-contained per-SKU sidecar bundles (spec D10, CPython 3.12 per D12).

## Method comparison

| Method | Boots + pings | Bundle size (du -sh) |
|--------|---------------|----------------------|
| (a) python-build-standalone CPython 3.12 + pip | deferred (see below) | deferred |
| (b) PyInstaller onedir | not run — see rationale | not run |

The measured local build (both methods) is **deferred**: the dev box is at
99% disk (≈12 GB free), and a full `onnxruntime-gpu[cuda,cudnn]==1.23.2`
install alone pulls several GB of CUDA/cuDNN wheels — running it risks a
mid-install disk-full failure (which has previously truncated wheels on this
machine). The real linux-nvidia build + boot is exercised by the
`build-linux` GitHub Actions job (Task 5) on a clean runner, and is listed in
the deferred-verification section of the P7 plan.

## Decision

**Pick (a) python-build-standalone** (the plan's default, adopted unless it
fails its acceptance gate on CI).

Rationale:
- The native-heavy wheels (onnxruntime, ctranslate2, transcribe_cpp's `.so`
  farm, sherpa-onnx) are historically fragile under PyInstaller hooks
  (hidden-import / collect gaps → runtime ImportError), whereas method (a)
  runs a real, unmodified CPython that `pip install` populates **exactly** as
  the dev venv is — the same import behavior the whole test suite validates.
- Method (a) also cleanly satisfies spec D1 (one ORT flavor per bundle, via
  the per-SKU requirements file) and D12 (embedded CPython 3.12). cp312 wheels
  are verified available for the full runtime set: onnxruntime-gpu 1.23.2,
  onnxruntime-directml 1.24.4, sherpa-onnx 1.13.3, ctranslate2, sentencepiece
  0.2.0 (transcribe-cpp is py3-none-any; mlx on arm64 macOS).
- `scripts/build-sidecar-bundle.py` (Task 3) implements method (a): fetch the
  python-build-standalone `install_only` CPython 3.12 for the SKU triple, pip
  install the SKU requirements into it, copy `sokuji_sidecar` in.

## Acceptance (deferred to CI / a machine with disk headroom)

Run once on the `build-linux` runner (or locally after freeing disk):
`python scripts/build-sidecar-bundle.py --sku linux-nvidia --version <v> --archive`
then boot `python/bin/python3 -m sokuji_sidecar` (cwd = `app`) and confirm the
`{"port": n}` handshake + a `ping`→`pong`. If method (a) fails that gate on
CI, revisit PyInstaller (method b) before shipping.
