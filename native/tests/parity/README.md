# audio.cpp TTS parity gate (spec §9.2)

`libsokuji_native`'s `sk_tts` links audio.cpp against OUR pristine upstream ggml (via
`native/patches/audio.cpp.json`'s reuse patch, plus `native/src/audiocpp_compat.h`'s shim for
the eight symbols audio.cpp's own ggml fork adds). This gate proves that swap is behavior
preserving, by comparing `sk_tts`'s output against the OFFICIAL `audiocpp_cli` — built from
the exact same vendored audio.cpp source, but completely unpatched, with audio.cpp's OWN fork
ggml — sample-exact on CPU.

## Files

- `build_reference_cli.sh` — builds the reference `audiocpp_cli` once and caches it. Idempotent:
  a second run is a no-op if the binary already exists.
- `test_tts_parity.py` — the pytest cases, one per family, each independently env-gated.
- `compare_pcm.py` — the comparator (`--exact` for CPU, `--min-snr <dB>` for the Vulkan leg);
  pre-existing, not part of this gate's own deliverable.

## 1. Build the reference CLI

```bash
native/tests/parity/build_reference_cli.sh
```

Clones a pristine copy of the exact commit `native/cmake/upstreams.cmake` pins for audio.cpp
into `~/.cache/sokuji-native-tests/audiocpp-official-src/` (read out of that file, not
hardcoded — a future pin bump is picked up automatically), configures it standalone
(`AUDIOCPP_MODEL_SET=custom` with our five families, CPU-only, no server/webui/model-manager
targets), builds just the `audiocpp_cli` target, and copies the binary plus its dynamically
loaded CPU backend module(s) to `~/.cache/sokuji-native-tests/audiocpp-official/`. About 15
minutes the first time on a 20-core box (mostly ggml's multi-ISA-variant CPU backend and
audio.cpp's engine core); instant on every later run, since it exits immediately once the
cached binary exists.

Two things worth knowing if you ever need to touch this script:

- **The CPU-kernel tier matters for exactness, not just correctness.** The script passes
  `-DENGINE_ENABLE_CPU_ALL_VARIANTS=ON`, which is audio.cpp's own multi-ISA-tier dynamic
  dispatch (`GGML_NATIVE=OFF`, one shared module per tier, picked at runtime) — the same
  scheme `native/cmake/ggml_options.cmake` uses for our own ggml copy. Without it, a
  standalone configure defaults to `GGML_NATIVE=ON` (`-march=native`, a single build
  hard-compiled for whatever ISA extensions the build box happens to expose), which is a real,
  independent source of non-bit-exact floating-point results — a different reduction order or
  FMA contraction from a different codegen choice, nothing to do with the ggml swap this gate
  exists to check. On the current dev box both `audiocpp_cli` and our own `libsokuji_native`
  load `libggml-cpu-armv8.6_2.so` at runtime — confirmed by `--list-devices`' log line on the
  reference side and `sokuji_native.init(log=...)`'s log line on ours — i.e. the SAME compiled
  kernel tier, not merely "close enough."
- **The armv9.2+sme CPU variants are dropped from audio.cpp's OWN ggml copy**, the same fix
  `native/patches/ggml-drop-sme.json` applies to our separately-fetched ggml, applied here via
  the same `native/cmake/patch_upstream.py` tool against `external/ggml/src/CMakeLists.txt`
  inside the pristine clone. This is a compiler-support gap (GCC rejects `+sme`), unrelated to
  the ggml-reuse patch this script is deliberately not applying — and it changes nothing this
  comparison exercises, since the tier actually selected at runtime here is `armv8.6_2` either
  way (`ggml_options.cmake`'s own comment says as much for our build).

Force a rebuild by deleting the cached binary (or the whole `~/.cache/sokuji-native-tests/audiocpp-official*` tree for a clean re-clone), or point `SOKUJI_NATIVE_TEST_CACHE` at a
different root.

## 2. Run the suite

Same invocation as the rest of the native test tree (`native/README.md`'s developer loop),
with the built stage on `SOKUJI_NATIVE_DIR` and each family's model directory on its own env
var:

```bash
SOKUJI_NATIVE_DIR=$PWD/native/build/cpu/stage \
SK_TEST_TTS_SUPERTONIC_DIR=~/.cache/sokuji-native-tests/tts/supertonic-3 \
SK_TEST_TTS_MOSS_DIR=~/.cache/sokuji-native-tests/tts/moss-tts-nano \
python -m pytest native/python/tests native/tests/parity -q
```

`test_tts_parity.py` also runs standalone (`pytest native/tests/parity -q`) — it puts
`native/python` on `sys.path` itself if the invocation didn't already (see the file's
docstring), so it does not depend on `native/python/tests` being collected in the same run the
way the rest of the parity directory's tests historically have.

Each case skips independently, on two separate gates:

| gate | condition |
|---|---|
| reference CLI | `~/.cache/sokuji-native-tests/audiocpp-official/audiocpp_cli` exists (step 1 above) |
| model directory | the family's own env var below is set |

| family | case | env var | note |
|---|---|---|---|
| supertonic | offline, preset `M1` | `SK_TEST_TTS_SUPERTONIC_DIR` | ran in this task |
| moss_tts_nano | text-only | `SK_TEST_TTS_MOSS_DIR` | ran in this task |
| moss_tts_nano | voice clone | `SK_TEST_TTS_MOSS_DIR` | ran in this task; ref clip generated at test time (below), never committed |
| qwen3_tts | Base clone | `SK_TEST_TTS_QWEN3_DIR` | skipped — model download deferred to the live-gate task (plan Task 7) |
| pocket_tts | preset `alba` | `SK_TEST_TTS_POCKET_DIR` | skipped — model download deferred to the live-gate task |
| omnivoice | clone | `SK_TEST_TTS_OMNIVOICE_DIR` | skipped — model download deferred to the live-gate task |

The moss/qwen3/omnivoice clone cases need a reference clip; nothing is checked in for it
(`native/tests/parity/assets/` does not exist — a WAV binary has no business in git history).
Each such test generates its own 1-second 440 Hz mono sine at 24 kHz, in `tmp_path`, and feeds
the identical in-memory array to both sides (the CLI reads it back from a 32-bit float WAV —
lossless, `audio_format==3` in `wav_reader.cpp` — the binding gets the numpy array directly, no
WAV round-trip on that side at all), so the reference clip itself can never be a source of
divergence.

## 3. What "sample-exact" actually compares

Both sides quantize their output to 16-bit PCM before comparison, because that is the ONLY
format the CLI's `--out` ever writes (`engine::audio::write_pcm16_wav`, hardcoded, no `--out`
float option). `test_tts_parity.py`'s `_quantize_pcm16` replicates that exact function —
clamp to `[-1, 1]`, multiply by `32767.0` in float32, round-to-nearest-even — so a difference
in *quantizer*, not model, can never surface as a spurious `--exact` failure. `compare_pcm.py`
then reads both WAVs back through the same `soundfile` call and requires `max_abs == 0.0`.

Both sides are pinned to `seed=0`, `do_sample=false` (the CLI via
`--seed 0 --request-option do_sample=false`; `sk_tts` always internally, per R7) and to the
SAME thread count (`THREADS = 4` in `test_tts_parity.py`, via `--threads` on the CLI and
`sokuji_native.init(n_threads=...)` on the binding) — ggml's CPU matmul reduction order is
thread-count dependent, so a mismatch there is indistinguishable from a genuine backend
divergence.

## 4. Known status (as of Task 3, first CPU run on the GB10 dev box)

Both currently-runnable cases FAILED — not close-but-inexact, but shape mismatches
(`compare_pcm.compare()` refuses to diff differently-shaped arrays, so `--exact` can't even be
evaluated for two of the three):

- **`test_supertonic_offline_voice_id_m1`**: shapes differ by 15 samples (82653 vs 82638 @
  44100 Hz, both ~1.874s) — close on duration, but a head- and tail-aligned diagnostic compare
  (trimming to the shorter length from either end) shows large `max_abs` (~0.48-0.50) and
  negative SNR both ways, so this is not merely a boundary-padding offset; the candidate's
  audio content genuinely differs from the reference's. The leading hypothesis (not chased
  further, per task-3-report.md) is `sk_tts.cpp` always constructing supertonic's session as
  STREAMING (report §2/`native/README.md`: supertonic is one of only two streaming-capable
  families) where the reference CLI ran OFFLINE (no `--mode` flag): the two session types take
  structurally different code paths (offline: one `run()` call, no text-chunking machinery at
  all; streaming: pull-loop over `runtime::chunk_text_request`-produced chunks), and there is
  no way to request an offline session for a streaming-capable family through the current
  `sk_tts_*` C surface.
- **`test_moss_text_only`** and **`test_moss_clone`**: large divergence, not a rounding issue.
  The candidate produced exactly **2304000** total float samples in BOTH cases regardless of
  input (text-only vs. clone, different text/reference) — matching `native/tests/test_tts.cpp`'s
  own CTest output from Task 1 ("moss synth: 1 call(s), 2304000 samples, 48000 Hz") for the
  first time compared against real reference output. The reference CLI instead produced
  variable, content-appropriate durations (3.6s / 172800 frames for text-only, 24.0s / 1152000
  frames for the clone) — AND reported 2 channels, where the candidate's `TtsModel.synth()`
  (`native/python/sokuji_native/__init__.py`) discards the `channels` value the C ABI's
  `sk_audio_cb` already provides correctly and always returns a flat array. Two independent
  gaps, but the fixed 2304000-float count regardless of input is the dominant one: even
  reinterpreted as stereo, it does not track the reference's actual (also variable) durations.

Per the plan's Task 3 design, this task did not chase either divergence further — see
`.superpowers/sdd/2026-08-31-sidecar-ggml-only-slice4-tts/task-3-report.md` for the full
evidence and exact `compare_pcm` numbers. The comparator, harness, and reference-build
machinery themselves are confirmed working (both binaries load the identical CPU kernel tier,
`libggml-cpu-armv8.6_2.so`, on this box) — what they found is a real, currently-unresolved
parity gap between `sk_tts` and the official CLI on two of the five families, left for the
compat-header porting decision (spec §10.1).

## 5. The Vulkan leg (deferred)

Spec §9.2 also asks for a Vulkan leg at `--min-snr 60`. That requires a Vulkan-enabled
`sokuji_native` wheel/lane, which this CPU-only dev-box task does not have — per the ledger
(spec ruling R2(s4)), it runs at the GB10 CI-artifact validation session, not as a gate in
this plan. `compare_pcm.py --min-snr 60` already supports it; only a Vulkan-side runner is
missing, and is intentionally out of scope here.
