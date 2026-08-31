# audio.cpp TTS parity gate (spec §9.2)

`libsokuji_native`'s `sk_tts` links audio.cpp against OUR pristine upstream ggml (via
`native/patches/audio.cpp.json`'s reuse patch, plus `native/src/audiocpp_compat.h`'s shim for
the eight symbols audio.cpp's own ggml fork adds). This gate proves that swap is behavior
preserving, by comparing `sk_tts`'s output against the OFFICIAL `audiocpp_cli` — built from
the exact same vendored audio.cpp source, but completely unpatched, with audio.cpp's OWN fork
ggml — on CPU, within a ±1-LSB (16-bit PCM) tolerance (see §3 for why this isn't `--exact`).

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

**The verdict is ±1 LSB, not `--exact`** (`MAX_ABS_TOLERANCE = 1.5 / 32768` in
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

## 4. Known status (as of Round 2)

| case | round 0/1 | round 2 (SVE-free, ±1 LSB) |
|---|---|---|
| `test_supertonic_streaming_voice_id_m1` | FAILED, shape mismatch 82653 vs 82638 | **XFAIL** — shape mismatch 82653 vs 82639 (SVE removal barely moved the number; confirmed NOT the SVE bug, still a separate unexplained residual) |
| `test_moss_text_only` | FAILED, shape mismatch (172800,2) vs (2304000,)/(1152000,2) | **PASS** — `max_abs=3.052e-05` (exactly 1 LSB), `snr=107.99 dB` |
| `test_moss_clone` | FAILED, shape mismatch, then max_abs=0.959 once shapes matched | **XFAIL (NEW residual)** — shapes match (1152000,2 both sides) but `max_abs=1.290`, `snr=-1.27 dB` — see below |

**`test_moss_text_only` is the SVE story's confirmation.** Round 0/1's 3.6s-vs-24.0s length
asymmetry was an ACCIDENT of the fork's SVE bug: it corrupted the reference's stop logits
enough to fire EOC early (frame 45), while the model never actually reaches EOC for this input
on a correct build. With SVE excluded from both sides, both run the full 300-frame / 24.0s
generation and agree to the tightest possible margin, 1 LSB. **moss_tts_nano's 300-frame
runaway is real** — a genuine, separate defect in audio.cpp's own MOSS session/prompt/stop
path, not a ggml-swap regression and not fixable from `native/src/sk_tts.cpp` — but it is no
longer a parity concern: both sides do it identically now. Deciding the moss card (fix
upstream, cap `max_new_tokens`, or drop the family) is a product decision pending elsewhere.

**`test_moss_clone` is a NEW finding this round**, not predicted by the investigation (which
only end-to-end-verified the text-only case). Its shapes now match — the reference itself also
hits the same 300-frame cap for a cloning request, so excluding SVE didn't change the *length*
question here — but the content differs by far more than 1 LSB. The clone path additionally
exercises the audio tokenizer's ENCODE step on the reference clip
(`MossTTSNanoSession::reference_codes_for_request`/`encode_reference_audio`), which the
text-only case never reaches; a divergence this large (`max_abs` above 1.0, beyond what
clamping to `[-1, 1]` can even bound) is consistent with a separate numeric issue on that code
path, not the already-diagnosed `ggml_vec_dot_f32` SVE bug. Ruled out as a harness bug: the
voice-reference WAV round-trip (`_write_ref_wav`'s 32-bit float subtype) is verified bit-exact
on both sides. Per this round's scope, not chased further — xfailed with the measured numbers,
flagged prominently in the round-2 report for whoever picks this up next.

**`test_supertonic_streaming_voice_id_m1` remains the round-1 residual, confirmed independent
of the SVE bug**: re-run SVE-free, the shape mismatch persists (82653 vs 82639 — barely moved
from 82638) and per-chunk localization still shows the single chunk itself as the mismatch.
The investigation looked at this directly and left it as a separate, unexplained residual,
explicitly out of scope for this round.

The comparator, SVE-free staging, and reference-build machinery are confirmed sound (both
binaries load the identical CPU kernel tier, `libggml-cpu-armv8.2_2.so`, once SVE is excluded
on this box). What remains — moss_clone's and supertonic's residuals — is real, currently
unexplained divergence, for whoever picks up the compat-header/audio.cpp investigation next
(spec §10.1's process, though neither residual has been shown to be a compat-header issue).

## 5. The Vulkan leg (deferred)

Spec §9.2 also asks for a Vulkan leg at `--min-snr 60`. That requires a Vulkan-enabled
`sokuji_native` wheel/lane, which this CPU-only dev-box task does not have — per the ledger
(spec ruling R2(s4)), it runs at the GB10 CI-artifact validation session, not as a gate in
this plan. `compare_pcm.py --min-snr 60` already supports it; only a Vulkan-side runner is
missing, and is intentionally out of scope here.
