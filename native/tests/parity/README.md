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

## 4. Known status (as of Fix round 1)

Round 0 found three shape-mismatch failures. Fix round 1 root-caused and fixed two concrete
wrapper defects (stereo channels dropped by the Python binding; supertonic compared against
the wrong CLI mode) and did a full, instrumented diff of MOSS's request construction — all
detailed in `.superpowers/sdd/2026-08-31-sidecar-ggml-only-slice4-tts/task-3-report.md`'s
"Fix round 1" section. **All three cases still FAIL** after the fixes:

- **`test_supertonic_streaming_voice_id_m1`**: now compared streaming-vs-streaming (round 0
  compared the candidate's forced-streaming session against the CLI's offline default) — the
  result is IDENTICAL: still 82653 vs 82638 samples, still fails the same way. Confirmed
  directly that the CLI's own `--mode streaming --out` merge equals its `--out-dir` chunk_0.wav
  bit-for-bit for this single-chunk text, so mode alignment could not have changed anything
  here — offline-vs-streaming was never the actual cause. Per-chunk localization (now built into
  the test) shows the single chunk pair itself is the mismatch, nothing hidden by merging.
- **`test_moss_text_only`**: still a shape mismatch, but now `(172800, 2)` vs `(1152000, 2)` —
  correctly 2 channels on both sides (the binding fix worked), duration still wrong. A direct
  runtime probe (temporarily instrumented into BOTH binaries' `generation_options_from_request`,
  removed before commit) confirmed `seed`, `do_sample`, and every sampling parameter are
  BYTE-IDENTICAL between the candidate and the CLI for this exact request — the divergence is
  not a missing/misspelled option. Under `do_sample=false` the stop decision
  (`moss_tts_nano/local_frame_decoder.cpp`'s `generate_frame`) is `argmax_index` over 2 logits,
  with NO RNG involved at all — a pure function of the computed hidden state. The candidate and
  reference are also confirmed thread-count-invariant individually (1 vs 4 threads changes
  neither side's frame count), ruling out FP-reduction-order-from-threading too. MOSS's
  attention (`ggml_soft_max`-based, confirmed by direct source read) does not call either of
  `native/src/audiocpp_compat.h`'s two node-for-node-reimplemented ops. See the report for the
  full elimination chain — the remaining explanation is a genuine numeric difference somewhere
  in the transformer forward pass between upstream ggml and audio.cpp's own fork, not a request-
  construction or option-spelling defect in this wrapper.
- **`test_moss_clone`**: shape now MATCHES — `(1152000, 2)` on both sides (the reference itself
  also runs to the full 300-frame generation cap for this input, so the channel fix alone closes
  the length gap) — but content does not: `max_abs=0.959 snr=-15.81 dB`. This is the cleanest
  evidence in the whole suite: same generation length on both sides (no early-stop asymmetry to
  confound the comparison), same request, and still a large, real audio-content divergence.

The comparator, harness, and reference-build machinery are confirmed sound (both binaries load
the identical CPU kernel tier, `libggml-cpu-armv8.6_2.so`, on this box; the two concrete wrapper
defects this round found — stereo channels, streaming-mode alignment — are fixed and covered by
`native/python/tests/test_sokuji_native.py`'s updated assertions). What remains is a real,
currently-unexplained-at-the-request-level divergence on two of the five families, for the
compat-header porting decision (spec §10.1) — now backed by a much narrower elimination chain
than round 0 had.

## 5. The Vulkan leg (deferred)

Spec §9.2 also asks for a Vulkan leg at `--min-snr 60`. That requires a Vulkan-enabled
`sokuji_native` wheel/lane, which this CPU-only dev-box task does not have — per the ledger
(spec ruling R2(s4)), it runs at the GB10 CI-artifact validation session, not as a gate in
this plan. `compare_pcm.py --min-snr 60` already supports it; only a Vulkan-side runner is
missing, and is intentionally out of scope here.
