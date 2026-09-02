# audio.cpp TTS parity gate (spec §9.2)

`libsokuji_native`'s `sk_tts` links audio.cpp against OUR pristine upstream ggml (via
`native/patches/audio.cpp.json`'s reuse patch, plus `native/src/audiocpp_compat.h`'s shim for
the eight symbols audio.cpp's own ggml fork adds). This gate proves that swap is behavior
preserving, by comparing `sk_tts`'s output against the OFFICIAL `audiocpp_cli` — built from
the exact same vendored audio.cpp source, but completely unpatched, with audio.cpp's OWN fork
ggml — on CPU, sample-exact where that is achievable and within a ±1-LSB (16-bit PCM)
tolerance otherwise (see §3 for which case gets which, and why).

**Round 2 / ledger ruling R10(s4)**: a full numeric investigation
(`.superpowers/sdd/2026-08-31-sidecar-ggml-only-slice4-tts/moss-divergence-investigation.md`)
found that audio.cpp's forked ggml 0.12.0 has a genuine bug — `ggml_vec_dot_f32`'s SVE
tail-lane handling (`svmad_f32_m` instead of `svmla_f32_m`) silently corrupts F32 matmul
accumulators whenever the reduction length isn't a multiple of 4 AND an SVE-capable CPU
module gets selected. Our upstream ggml 0.22.0 already has the fix and is correct. On any
SVE-capable aarch64 box (this dev box included), that makes the OFFICIAL reference binary
itself numerically wrong for some shapes — so both sides now run with the SVE-capable CPU
modules excluded (§2), and the comparator only requires agreement to the nearest 16-bit PCM
code, not the last float32 bit (§3). **A mismatch against this reference can mean the
reference is wrong, not `sk_tts`** — read the investigation report before assuming otherwise.

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
lossless, `audio_format==3` in `wav_reader.cpp` — the binding gets it back via the same
lossless round-trip through its own subprocess, verified bit-exact), so the reference clip
itself can never be a source of divergence.

**SVE-free comparison (round 2, ruling R10(s4)).** Both `_run_cli` and the candidate's own
subprocess (see below) run against a filtered copy of their module directory with the three
SVE-capable ggml CPU backend modules excluded —
`libggml-cpu-armv8.2_3.so`/`armv8.6_1.so`/`armv8.6_2.so` (`ggml/src/CMakeLists.txt`'s own
variant table). `test_tts_parity.py`'s `_sve_free_copy` makes this copy once per side, cached
under `SOKUJI_NATIVE_TEST_CACHE`, and picks it back up automatically if the source gets
rebuilt (mtime-compared). ggml's CPU backend loader scores every `libggml-cpu-*.so` it can see
in its search directory and picks the best-scoring one — excluding the SVE-capable ones just
makes it fall back to the best REMAINING tier (`armv8.2_2` on this box), which is correct on
*both* ggml versions, instead of comparing a correct build against a broken one. This is a real
file copy, not symlinks: ggml's default CPU-module search path on Linux is the *running
executable's own directory*, resolved via `/proc/self/exe` — which the kernel resolves THROUGH
a symlink to the target's original location, so a symlinked `audiocpp_cli` would silently keep
searching the original (SVE-including) directory. Comparing SVE-vs-non-SVE across sides would
just reintroduce the drift this exists to eliminate, so both sides get the identical treatment.

The candidate side runs in its own subprocess for this reason (among others — see
`test_tts_parity.py`'s module docstring, "Candidate isolation"): `sokuji_native.native_dir()`
is read once and cached for the life of a process, so pointing it at the SVE-free copy would
otherwise leak into any other test module sharing the same pytest session (in particular
`native/python/tests/test_sokuji_native.py`, which must keep exercising the real staged build,
SVE and all) if this file's own `os.environ` were mutated instead.

## 3. What the gate actually compares

Both sides quantize their output to 16-bit PCM before comparison, because that is the ONLY
format the CLI's `--out` ever writes (`engine::audio::write_pcm16_wav`, hardcoded, no `--out`
float option). The candidate subprocess's own quantization (inlined in `_CANDIDATE_RUNNER`)
replicates that exact function — clamp to `[-1, 1]`, multiply by `32767.0` in float32,
round-to-nearest-even — so a difference in *quantizer*, not model, can never surface as a
spurious parity failure.

**Two verdicts, chosen per case** (round 3, rulings R11/R12): `_compare_exact` where
sample-exactness is provably achievable — currently only supertonic, a fixed-step decoder with
no autoregressive loop — and `_compare_lsb_tolerant` everywhere else. The split is deliberate:
a tolerance band is the natural hiding place for a precision-losing bug, and R11 was exactly
that (an F16 im2col buffer costing ~1.2e-4 relative, which only became visible because
supertonic's duration predictor turns precision into output *length*). Where a family can be
held to zero, it is.

**The default verdict is ±1 LSB, not `--exact`** (`MAX_ABS_TOLERANCE = 1.5 / 32768` in
`test_tts_parity.py`, using `compare_pcm.compare()`'s existing `max_abs` output directly —
`compare_pcm.py` itself is unmodified, it already prints this number). Cross-ggml-version
sample-exactness was never a meaningful bar: two internally-correct builds of the *same*
algorithm, on two different minor versions of ggml, are allowed to round the last float32 bit
differently — the achievable, meaningful invariant is that they land on the same (or an
adjacent) 16-bit PCM code. The SVE story above is the case study that motivated this: even
after excluding the actual bug, `moss_tts_nano`'s two builds still don't reach bit-identical
float32 logits (the investigation measured ordinary ggml-version fp noise, not a behavioral
difference) — sample-exactness would have failed the gate anyway, on a family that has no
outstanding correctness question. A shape or sample-rate mismatch is still a hard, non-waivable
mismatch — the tolerance is about amplitude, never about extra or missing samples.

Both sides are pinned to `seed=0`, `do_sample=false` (the CLI via
`--seed 0 --request-option do_sample=false`; `sk_tts` always internally, per R7) and to the
SAME thread count (`THREADS = 4` in `test_tts_parity.py`, via `--threads` on the CLI and
`sokuji_native.init(n_threads=...)` on the binding) — ggml's CPU matmul reduction order is
thread-count dependent, so a mismatch there would be indistinguishable from a genuine backend
divergence (the investigation confirmed this specific model is thread-count invariant on both
sides anyway, 1 vs. 4 threads, but the pin costs nothing and removes the question).

## 4. Known status (as of Round 3, rulings R11/R12)

| case | round 2 | round 3 (conv shims landed) |
|---|---|---|
| `test_supertonic_streaming_voice_id_m1` | XFAIL — shape mismatch 82653 vs 82639 | **PASS, SAMPLE-EXACT** — `max_abs = 0`, every 16-bit code identical (gated with `_compare_exact`) |
| `test_moss_text_only` | PASS — `max_abs=3.052e-05` (1 LSB), `snr=107.99 dB` | **PASS**, unchanged — the conv shims do not touch this path |
| `test_moss_clone` | XFAIL (new residual), `max_abs=1.290`, `snr=-1.27 dB` | **XFAIL, permanently and by design (R12)** — same numbers, now fully explained |

Run: `8 passed, 3 skipped, 1 xfailed` (the three skips are qwen3/pocket/omnivoice, no models).

### R11 — supertonic: a real divergence on our side, now fixed

Two rounds of "unexplained 14-sample shape mismatch" had a mundane cause. Upstream ggml's
conv constructors materialise their im2col buffer in F16 (`a->type == BF16 ? F32 : F16`)
where audio.cpp's fork uses the kernel's dtype, so our build was running every F32 conv with
half-precision activations — ~1.2e-4 RMS relative error against an F32 path's ~1e-7. Nothing
linked wrong and nothing warned, because the two ggml versions agree on the function's name
and signature and differ only inside the body.

It surfaced here and not elsewhere because supertonic's duration predictor is a regression
whose output *is* the sample count (`runtime.cpp`: `trim = duration_seconds * sample_rate`),
so a 1.77e-4 relative error in one scalar became 14 missing samples. `native/src/audiocpp_compat.h`
now shims `ggml_conv_1d`, `ggml_conv_1d_dw`, `ggml_conv_2d` and `ggml_conv_3d` back to the
fork's dtype semantics; the whole waveform then matches bit-for-bit. `ggml_conv_1d_dw` is on
qwen3_tts's decoder path, so that family is covered before its model even lands.

### R12 — moss_clone: not a divergence anyone can fix

The round-2 suspicion (the clone-only reference-audio ENCODE step) was wrong: the encoder
input, its latent, and all 16 RVQ codebooks are **bit-identical** on both sides, so both
builds condition the LM on the same reference codes. The actual difference is one entry of
ggml's 65536-entry fp16 GELU lookup table — at `x = -1.9990234`, one fp16 ULP apart, with the
true value sitting within 2e-8 of the midpoint between the two codes (|err| vs a float64
reference: 1.525e-05 fork, 1.527e-05 upstream, against the table's own 9.7e-04 quantization
error). Neither ggml is more correct, and both versions' source for the GELU formula and the
table build is identical.

MOSS amplifies it: that 3.05e-05 appears in layer 4 of the global transformer at decode step 1,
reaches ~1.2e-2 in the hidden by layer 11, and flips 4 of the 16 codebook argmax decisions in
frame 1 (margins 0.0025-0.064; the run makes 4800 such decisions, 7 with a margin under 1e-2).
From frame 1 the trajectories are independent, so `max_abs > 1.0` is the expected outcome.

`moss_text_only` passes at 1 LSB only because it flips later (step ~39), by which point the
model has collapsed into a repeating frame and the two streams differ only in that
repetition's phase. Same model, same graph, same class of drift — different luck.

**This is not waivable by widening `MAX_ABS_TOLERANCE`.** No amplitude band separates "same
model, different chaotic trajectory" from "broken". Waveform parity is simply the wrong
invariant for a 300-step argmax decoder: `moss_text_only` carries the family's numeric signal,
and functional quality for the clone path is gated by the TTS→ASR loopback, which asks the
only question that matters — does it say the right words. The invariant that *is* meaningful
and *does* hold bit-exactly (identical reference codes) has no test hook today; exposing one
would need a C-ABI or test-only accessor.

**`test_moss_text_only` is the SVE story's confirmation.** Round 0/1's 3.6s-vs-24.0s length
asymmetry was an ACCIDENT of the fork's SVE bug: it corrupted the reference's stop logits
enough to fire EOC early (frame 45), while the model never actually reaches EOC for this input
on a correct build. With SVE excluded from both sides, both run the full 300-frame / 24.0s
generation and agree to the tightest possible margin, 1 LSB. **moss_tts_nano's 300-frame
runaway is real** — a genuine, separate defect in audio.cpp's own MOSS session/prompt/stop
path, not a ggml-swap regression and not fixable from `native/src/sk_tts.cpp` — but it is no
longer a parity concern: both sides do it identically now. Deciding the moss card (fix
upstream, cap `max_new_tokens`, or drop the family) is a product decision pending elsewhere.

The comparator, SVE-free staging, and reference-build machinery are confirmed sound (both
binaries load the identical CPU kernel tier, `libggml-cpu-armv8.2_2.so`, once SVE is excluded
on this box). As of round 3 no unexplained divergence remains among the runnable cases:
supertonic was ours and is fixed (R11), moss_clone is neither side's and is documented (R12).
qwen3/pocket/omnivoice are still untested for want of models — and per R11, qwen3_tts's
speech decoder calls `ggml_conv_1d_dw`, so it is the next family that would have hit this.

## 5. The Vulkan leg (deferred)

Spec §9.2 also asks for a Vulkan leg at `--min-snr 60`. That requires a Vulkan-enabled
`sokuji_native` wheel/lane, which this CPU-only dev-box task does not have — per the ledger
(spec ruling R2(s4)), it runs at the GB10 CI-artifact validation session, not as a gate in
this plan. `compare_pcm.py --min-snr 60` already supports it; only a Vulkan-side runner is
missing, and is intentionally out of scope here.
