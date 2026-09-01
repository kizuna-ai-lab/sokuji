"""audio.cpp TTS parity gate (spec §9.2): the OFFICIAL, unpatched `audiocpp_cli` (built by
build_reference_cli.sh from the same vendored source with its OWN fork ggml) versus
`libsokuji_native`'s `sk_tts` (upstream ggml + the audiocpp_compat.h shim), compared on CPU
within a ±1-LSB (16-bit PCM) tolerance.

Round 2 / ledger ruling R10(s4): a full numeric investigation
(.superpowers/sdd/2026-08-31-sidecar-ggml-only-slice4-tts/moss-divergence-investigation.md)
found that audio.cpp's forked ggml 0.12.0 has a real bug — `ggml_vec_dot_f32`'s SVE
tail-lane handling (`svmad_f32_m` instead of `svmla_f32_m`) silently corrupts F32 matmul
accumulators whenever the reduction length isn't a multiple of 4 AND an SVE-capable CPU
module is selected. Our upstream ggml 0.22.0 has the fix and is correct. On any SVE-capable
aarch64 box (this one included), the OFFICIAL reference binary is therefore itself numerically
broken for some shapes — comparing sample-exact against it conflates "the ggml swap changed
behavior" with "the official binary's own arithmetic is wrong for this input." Two
consequences, both implemented below:

1. Both sides run with the three SVE-capable CPU modules excluded (see SVE_CPU_MODULES) —
   this makes moss_tts_nano agree to ≤1 LSB end-to-end (investigation's own confirmation).
   Comparing SVE-vs-non-SVE would reintroduce exactly the drift this is trying to eliminate,
   so BOTH sides get the same treatment, not just the reference.
2. The gate itself moved from `--exact` to a ±1-LSB tolerance (MAX_ABS_TOLERANCE below).
   Cross-ggml-version sample-exactness was never a meaningful bar — different minor versions
   of the SAME correct algorithm are allowed to round differently in the last bit; ≤1 LSB of
   16-bit PCM is the achievable, meaningful invariant. The SVE story above is the case study
   that proves the distinction matters: two builds can each be internally correct and still
   not agree to the last float32 ULP.

Round 3 / rulings R11 and R12
(.superpowers/sdd/2026-08-31-sidecar-ggml-only-slice4-tts/residuals-investigation.md) closed
the two residuals round 2 left, in opposite directions — which is why the gate is no longer
one uniform tolerance:

3. R11, supertonic: a REAL divergence on our side. Upstream ggml's conv constructors
   materialise their im2col buffer in F16 where audio.cpp's fork uses the kernel's dtype,
   so our build ran supertonic's duration predictor at half precision and mispredicted its
   own output length by 14 samples. native/src/audiocpp_compat.h now shims the four conv
   entry points; the case is sample-exact and gated with _compare_exact, NOT the tolerance.
   Precision-losing bugs of this shape hide inside a tolerance band — so where exactness is
   provably achievable, this file demands it.
4. R12, moss_clone: NOT a divergence anyone can fix. A single fp16 GELU lookup-table entry
   rounds differently between the two ggml versions, and MOSS's 4800 argmax decisions turn
   that one ULP into a different (equally valid) trajectory from frame 1. Permanently
   xfailed; see the case for the full chain. Waveform parity is the wrong invariant for a
   chaotic decoder, and no tolerance can distinguish it from a real break.

Round 4 / ruling R23 (jiangzhuo 2026-09-01, .superpowers/moss-eoc-verdict.md): moss_tts_nano
switched from greedy to SAMPLED decode in production (native/src/sk_tts.cpp's `sample_decode`
family flag) because greedy argmax never reaches this checkpoint's own end-of-content token
for ordinary input — it runs to audio.cpp's 300-frame/24.000s `max_new_frames` cap instead
(measured once, E1; corroborated by the pre-existing parity baseline's own greedy-decode
runaway), while sampling reaches real EOC in 2.6-3.7s (measured 3/3, E2a/b/c). Seed stays fixed
at "0" either way, so both `test_moss_text_only` and `test_moss_clone` below now pass
`--request-option do_sample=true` to the reference CLI to match what the candidate binding
does internally. Measured directly for this file's two fixed test inputs: both cases
reproduce BIT-EXACT (max_abs=0.0) and repeatably across reruns — R12's argmax-tie fragility
does not reproduce for these specific inputs under sampling. It is NOT eliminated as a class,
though: the same investigation found a different sentence against the same voice-clone
reference diverges into a different frame count entirely under sampling too (chaotic
autoregressive amplification doesn't care whether the fragile decision was an argmax tie or
a sampled draw). `test_moss_clone` therefore keeps its existing soft xfail-on-failure shape
(assert only if the comparison actually fails) with its reason string updated to describe
sampling-draw amplification rather than argmax-tie amplification — not flipped to a hard
assert, since a clean pass on today's fixed input is not evidence the class of risk is gone.

Every case is gated on two independent things, so each one skips on its own:
  - the reference CLI existing at all (native/tests/parity/build_reference_cli.sh must have
    been run first — this file never builds it itself: that is a ~15 minute, network-using
    step that has no place inside an ordinary pytest run);
  - the family's model directory env var (SK_TEST_TTS_<FAMILY>_DIR) being set, mirroring
    native/python/tests/test_sokuji_native.py's needs_tts_* pattern.

Determinism: both sides fix seed=0 — the CLI explicitly (`--seed 0`), our binding always
internally (R7, native/README.md's TTS section). do_sample is do_sample=false on both sides
for every family EXCEPT moss_tts_nano, which is do_sample=true on both sides (Ruling R23,
Round 4 above) — the CLI's `--request-option do_sample=...` is set per-case below to match
whichever mode the candidate binding will use for that family, never mixed across sides.
Both sides are pinned to the SAME thread count (THREADS
below) via `--threads` on the CLI and `sokuji_native.init(n_threads=...)` on the binding —
ggml's CPU matmul reduction order (and therefore floating-point rounding) is thread-count
dependent, so a mismatch here would be indistinguishable from a genuine backend divergence.

Candidate isolation: the candidate side now runs in its OWN subprocess (see
_CANDIDATE_RUNNER/_run_candidate), one per test, with SOKUJI_NATIVE_DIR pointed at the SVE-free
module directory ONLY for that subprocess's environment. This is not just tidiness:
sokuji_native.native_dir() is read once and cached for the life of a process
(native/python/sokuji_native/__init__.py's `_load()`), so mutating this test's own os.environ
would leak the SVE-free override into any other test module sharing the same pytest session
(e.g. native/python/tests/test_sokuji_native.py, which must keep exercising the real staged
build, SVE and all) — a subprocess is the only way to give the candidate its own environment
without that risk. It also sidesteps the old "only the FIRST sokuji_native.init() call's
n_threads takes effect" caveat: each test's candidate now gets a fresh process.

WAV encoding: the CLI's `--out` always writes 16-bit PCM via audio.cpp's own
`engine::audio::write_pcm16_wav` (clamp to [-1, 1], `lrint(sample * 32767.0f)`, report §7). The
candidate subprocess's own quantization (inlined in _CANDIDATE_RUNNER) replicates that exact
formula — clamp, ×32767.0 in float32, round-to-nearest-even — so a quantizer mismatch can never
masquerade as a parity failure on top of the ±1-LSB tolerance this round already added.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys

import numpy as np
import pytest

from compare_pcm import compare

# native/python is not necessarily on sys.path (depends on how pytest was invoked — see
# native/tests/parity/README.md); make this file importable standalone either way.
_NATIVE_PYTHON = pathlib.Path(__file__).resolve().parents[2] / "python"
if str(_NATIVE_PYTHON) not in sys.path:
    sys.path.insert(0, str(_NATIVE_PYTHON))
import sokuji_native  # noqa: E402  (must follow the sys.path fixup above)

HAVE_TREE = bool(os.environ.get("SOKUJI_NATIVE_DIR")) or (
    pathlib.Path(sokuji_native.__file__).parent / "_native" / "contract.json"
).exists()

CACHE_DIR = pathlib.Path(os.environ.get("SOKUJI_NATIVE_TEST_CACHE", pathlib.Path.home() / ".cache" / "sokuji-native-tests"))
OFFICIAL_CLI = CACHE_DIR / "audiocpp-official" / "audiocpp_cli"

# Pinned on both sides (see module docstring). 4 is arbitrary but fixed: it is comfortably
# below this box's core count without being 1 (a single-threaded run would sidestep the very
# reduction-order question a "same thread count on both sides" gate exists to pin down).
THREADS = 4

# ±1 LSB of 16-bit PCM (1/32768, the divisor audio.cpp's own wav_reader.cpp and libsndfile's
# int16->float32 read-back both use), with 1.5x slack for a rounding-tie boundary case — the
# achievable invariant across two internally-correct ggml versions (see module docstring).
MAX_ABS_TOLERANCE = 1.5 / 32768

# ggml/src/CMakeLists.txt marks these three CPU backend module variants SVE-capable
# (armv8.2_3: SVE; armv8.6_1: SVE; armv8.6_2: SVE+SVE2 — this box selects armv8.6_2 by
# default). audio.cpp's forked ggml 0.12.0's ggml_vec_dot_f32 has a real bug in its SVE
# tail-lane handling (`svmad_f32_m` merges inactive lanes from the wrong operand, silently
# zeroing part of the accumulator whenever a matmul's reduction length isn't a multiple of
# 4) — confirmed by direct investigation, ledger ruling R10(s4):
# .superpowers/sdd/2026-08-31-sidecar-ggml-only-slice4-tts/moss-divergence-investigation.md.
# Our upstream ggml 0.22.0 already has the fix (`svmla_f32_m`) and is correct. Excluding
# these three module files from BOTH sides' module-search directories forces the best
# REMAINING tier (armv8.2_2 on this box) — correct on both ggml versions — out of the
# comparison entirely, instead of comparing a correct build against a broken one. A no-op on
# non-SVE boxes: there is nothing there to exclude.
SVE_CPU_MODULES = frozenset({
    "libggml-cpu-armv8.2_3.so",
    "libggml-cpu-armv8.6_1.so",
    "libggml-cpu-armv8.6_2.so",
})

SUPERTONIC_DIR = os.environ.get("SK_TEST_TTS_SUPERTONIC_DIR")
MOSS_DIR = os.environ.get("SK_TEST_TTS_MOSS_DIR")
QWEN3_DIR = os.environ.get("SK_TEST_TTS_QWEN3_DIR")
POCKET_DIR = os.environ.get("SK_TEST_TTS_POCKET_DIR")
OMNIVOICE_DIR = os.environ.get("SK_TEST_TTS_OMNIVOICE_DIR")

needs_cli = pytest.mark.skipif(
    not OFFICIAL_CLI.exists(),
    reason=f"official audiocpp_cli not built — run native/tests/parity/build_reference_cli.sh first (expected at {OFFICIAL_CLI})",
)
needs_tree = pytest.mark.skipif(not HAVE_TREE, reason="no built native tree (set SOKUJI_NATIVE_DIR)")
needs_supertonic = pytest.mark.skipif(not SUPERTONIC_DIR, reason="needs SK_TEST_TTS_SUPERTONIC_DIR")
needs_moss = pytest.mark.skipif(not MOSS_DIR, reason="needs SK_TEST_TTS_MOSS_DIR")
needs_qwen3 = pytest.mark.skipif(not QWEN3_DIR, reason="needs SK_TEST_TTS_QWEN3_DIR (downloaded by the live-gate task, not this one)")
needs_pocket = pytest.mark.skipif(not POCKET_DIR, reason="needs SK_TEST_TTS_POCKET_DIR (downloaded by the live-gate task, not this one)")
needs_omnivoice = pytest.mark.skipif(not OMNIVOICE_DIR, reason="needs SK_TEST_TTS_OMNIVOICE_DIR (downloaded by the live-gate task, not this one)")

# Same reference-transcript string reused across every cloning case below (moss/qwen3/omnivoice):
# the reference clip is a synthetic sine, not real speech, so any "transcript" for it is
# necessarily synthetic too — reusing one string keeps that fact visible instead of dressing
# it up as several different quotes.
REFERENCE_TEXT = "Reference transcript when available."


def _sine_wav_f32(sample_rate: int = 24000, seconds: float = 1.0, hz: float = 440.0) -> np.ndarray:
    """1s 440Hz sine, mono float32 — the parity suite's own synthetic voice-clone reference.
    Generated fresh per test (never committed; native/tests/parity/README.md explains why)."""
    t = np.arange(int(sample_rate * seconds), dtype=np.float64) / sample_rate
    return (0.5 * np.sin(2.0 * np.pi * hz * t)).astype(np.float32)


def _write_ref_wav(path: pathlib.Path, sample_rate: int, samples: np.ndarray) -> None:
    """32-bit float WAV. audio.cpp's read_wav_f32 (wav_reader.cpp) decodes float32 PCM
    (audio_format==3) via a straight memcpy, no requantization — so the CLI's `--voice-ref`
    sees these samples bit-for-bit, and passing the SAME `samples` array directly to the
    binding's set_voice() (no read-back) means both sides condition on an identical clip with
    no WAV round-trip anywhere in the loop, on either side."""
    import soundfile as sf

    sf.write(str(path), samples, sample_rate, subtype="FLOAT")


def _sve_free_copy(src_dir: pathlib.Path, key_file: str) -> pathlib.Path:
    """A real (non-symlink) copy of src_dir with SVE_CPU_MODULES excluded, cached under
    CACHE_DIR in a subdir keyed by a hash of src_dir's OWN resolved absolute path. A real
    copy, not symlinks: ggml's default CPU-module search path on Linux is the RUNNING
    EXECUTABLE's own directory, resolved via /proc/self/exe — which the kernel resolves
    THROUGH a symlink to the symlink's target, so a symlinked audiocpp_cli would silently
    defeat this (it would still search the ORIGINAL, SVE-including directory). Copying
    uniformly for both sides (rather than symlinking the ones that could tolerate it) keeps
    this one mechanism simple.

    2026-09-02 incident: this cache used to live at one FIXED path per caller (e.g.
    CACHE_DIR / "sokuji-native-nosve"), refreshed only when the source key file's mtime was
    `>=` the cached copy's mtime. A scratch build under a different source directory, with a
    newer libsokuji_native.so, silently repopulated that shared fixed path (leaving a foreign
    libggml-vulkan.so behind too) — every later parity run against the real staged build then
    used that foreign build without any signal, producing two spurious failures. Keying the
    cache subdir by the source directory's own path makes two different sources physically
    unable to land in the same slot, and refreshing on exact mtime-AND-size equality (not
    `>=`) — wiping the slot's previous contents before recopying — means a refresh can never
    leave a stale foreign file behind either."""
    resolved = src_dir.resolve()
    digest = hashlib.sha1(str(resolved).encode()).hexdigest()[:12]
    dst_dir = CACHE_DIR / f"nosve-{digest}-{resolved.name}"
    src_key = resolved / key_file
    dst_key = dst_dir / key_file
    src_stat = src_key.stat()
    fresh = (
        dst_key.exists()
        and dst_key.stat().st_mtime == src_stat.st_mtime
        and dst_key.stat().st_size == src_stat.st_size
    )
    if not fresh:
        if dst_dir.exists():
            shutil.rmtree(dst_dir)
        dst_dir.mkdir(parents=True, exist_ok=True)
        for entry in resolved.iterdir():
            if entry.is_file() and entry.name not in SVE_CPU_MODULES:
                shutil.copy2(entry, dst_dir / entry.name)
    return dst_dir


def _official_cli_nosve() -> pathlib.Path:
    dst_dir = _sve_free_copy(OFFICIAL_CLI.parent, "audiocpp_cli")
    return dst_dir / "audiocpp_cli"


def _candidate_native_dir_nosve() -> pathlib.Path:
    return _sve_free_copy(sokuji_native.native_dir(), "libsokuji_native.so")


def _run_cli(args: list[str]) -> None:
    proc = subprocess.run(
        [str(_official_cli_nosve()), *args],
        capture_output=True, text=True, timeout=600,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"audiocpp_cli failed (exit {proc.returncode}): {' '.join(args)}\n"
            f"--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
        )


# Runs in its OWN process (see _run_candidate / the module docstring's "Candidate isolation").
# Inlines the same clamp/scale/round quantization test_tts_parity.py itself no longer needs on
# the parent side (kept as a short, well-commented duplicate rather than importing this test
# module as a library into the subprocess, which would re-trigger this file's own sys.path/
# HAVE_TREE setup for no benefit).
_CANDIDATE_RUNNER = r'''
import json, os, sys

cfg = json.loads(os.environ["SOKUJI_PARITY_CONFIG"])
sys.path.insert(0, cfg["native_python_dir"])
import numpy as np
import soundfile as sf
import sokuji_native as s


def _quantize(samples):
    # Mirrors audio.cpp's own wav_writer.cpp write_pcm16_wav exactly: clamp to [-1, 1],
    # multiply by 32767.0 in float32, round-to-nearest-even.
    clamped = np.clip(samples.astype(np.float32), np.float32(-1.0), np.float32(1.0))
    return np.rint(clamped * np.float32(32767.0)).astype(np.int16)


s.init(n_threads=cfg["threads"])
t = s.tts_load(cfg["model_dir"], cfg["family"])
chunks = []
try:
    if cfg.get("preset"):
        t.set_preset(cfg["preset"])
    if cfg.get("voice_ref_wav"):
        pcm, sr = sf.read(cfg["voice_ref_wav"], dtype="float32", always_2d=False)
        t.set_voice(pcm, sr, ref_text=cfg.get("voice_ref_text"))
    on_chunk = (lambda pcm, sr: chunks.append(pcm)) if cfg.get("chunk_dir") else None
    samples, rate = t.synth(cfg["text"], language=cfg.get("language"), on_chunk=on_chunk)
finally:
    t.unload()

sf.write(cfg["out_wav"], _quantize(samples), rate, subtype="PCM_16")
if cfg.get("chunk_dir"):
    os.makedirs(cfg["chunk_dir"], exist_ok=True)
    for i, pcm in enumerate(chunks):
        sf.write(os.path.join(cfg["chunk_dir"], f"got_chunk_{i}.wav"), _quantize(pcm), rate, subtype="PCM_16")
'''


def _run_candidate(*, native_dir: pathlib.Path, model_dir, family: str, text: str, out_wav: pathlib.Path,
                    language: str | None = None, preset: str | None = None,
                    voice_ref_wav: pathlib.Path | None = None, voice_ref_text: str | None = None,
                    chunk_dir: pathlib.Path | None = None) -> None:
    """Runs sokuji_native.tts_load(...).synth(...) in its own subprocess, SOKUJI_NATIVE_DIR
    pointed at `native_dir` for that subprocess's environment only — see the module
    docstring's "Candidate isolation" for why this can't just be an os.environ mutation in
    this test process."""
    cfg = {
        "native_python_dir": str(_NATIVE_PYTHON),
        "threads": THREADS,
        "model_dir": str(model_dir),
        "family": family,
        "text": text,
        "language": language,
        "preset": preset,
        "voice_ref_wav": str(voice_ref_wav) if voice_ref_wav else None,
        "voice_ref_text": voice_ref_text,
        "out_wav": str(out_wav),
        "chunk_dir": str(chunk_dir) if chunk_dir else None,
    }
    env = dict(os.environ)
    env["SOKUJI_NATIVE_DIR"] = str(native_dir)
    env["SOKUJI_PARITY_CONFIG"] = json.dumps(cfg)
    proc = subprocess.run(
        [sys.executable, "-c", _CANDIDATE_RUNNER],
        capture_output=True, text=True, timeout=600, env=env,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"candidate subprocess failed (exit {proc.returncode})\n"
            f"--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
        )


def _compare_lsb_tolerant(ref_wav: pathlib.Path, got_wav: pathlib.Path) -> str:
    """Returns '' when ref_wav/got_wav agree within MAX_ABS_TOLERANCE, else a diagnostic
    message. Never raises for an ordinary in-scope mismatch (shape/rate included) — callers
    decide whether that's a hard failure or an xfail."""
    import soundfile as sf

    ref, ref_rate = sf.read(str(ref_wav), dtype="float32", always_2d=False)
    got, got_rate = sf.read(str(got_wav), dtype="float32", always_2d=False)
    if ref_rate != got_rate:
        return f"sample-rate mismatch: reference={ref_rate} candidate={got_rate}"
    try:
        r = compare(ref, got)
    except ValueError as e:
        return str(e)
    if r.max_abs > MAX_ABS_TOLERANCE:
        return (
            f"parity FAILED: n={r.n} max_abs={r.max_abs:.3e} (tolerance {MAX_ABS_TOLERANCE:.3e}) "
            f"snr={r.snr_db:.2f} dB (reference {len(ref)} samples @ {ref_rate}, candidate {len(got)} samples @ {got_rate})"
        )
    return ""


def _compare_exact(ref_wav: pathlib.Path, got_wav: pathlib.Path) -> str:
    """Same contract as _compare_lsb_tolerant, but requires max_abs == 0 — every 16-bit PCM
    code identical.

    Only supertonic uses this. The ±1-LSB tolerance exists for families whose output goes
    through a long autoregressive loop, where two ggml versions legitimately disagree in the
    last float bits (see §3 of the README). Supertonic has no such loop: it is a fixed-step
    flow-matching decode, and since ruling R11 landed the conv-family im2col shims it agrees
    with the reference on every sample. Holding it to `== 0` is what turns a future
    reintroduction of that class of bug into an immediate, unambiguous failure instead of a
    quiet drift inside a tolerance band."""
    import soundfile as sf

    ref, ref_rate = sf.read(str(ref_wav), dtype="float32", always_2d=False)
    got, got_rate = sf.read(str(got_wav), dtype="float32", always_2d=False)
    if ref_rate != got_rate:
        return f"sample-rate mismatch: reference={ref_rate} candidate={got_rate}"
    try:
        r = compare(ref, got)
    except ValueError as e:
        return str(e)
    if r.max_abs != 0.0:
        return (
            f"parity FAILED (exact gate): n={r.n} max_abs={r.max_abs:.3e} snr={r.snr_db:.2f} dB "
            f"(reference {len(ref)} samples @ {ref_rate}, candidate {len(got)} samples @ {got_rate})"
        )
    return ""


@needs_cli
@needs_tree
@needs_supertonic
def test_supertonic_streaming_voice_id_m1(tmp_path):
    text = "Hello from Supertonic."
    ref_wav = tmp_path / "ref.wav"
    got_wav = tmp_path / "got.wav"
    ref_chunk_dir = tmp_path / "ref_chunks"
    ref_chunk_dir.mkdir()
    got_chunk_dir = tmp_path / "got_chunks"

    # Fix round 1: mode-aligned with the candidate. sk_tts.cpp's session for supertonic is
    # ALWAYS created streaming (report/task-1: only omnivoice+supertonic stream) — round 0
    # compared that against the CLI's OFFLINE default, a genuine mode mismatch. --mode
    # streaming here makes both sides run the identical session type. --out-dir captures the
    # per-chunk WAVs the streaming pull loop produces (report §7); --out captures the SAME
    # run's merged result (main.cpp's run_streaming(): the final emit_task_result() call uses
    # finish_stream()'s own merged buffer, independent of --out-dir) — for supertonic the
    # merge is plain accumulation, so this must equal a concatenation of the per-chunk files
    # (verified directly: for this single-chunk text, merged.wav == chunk_0.wav bit-for-bit).
    _run_cli([
        "--task", "tts", "--family", "supertonic", "--model", str(SUPERTONIC_DIR),
        "--backend", "cpu", "--threads", str(THREADS), "--mode", "streaming",
        "--language", "en", "--text", text, "--voice-id", "M1",
        "--seed", "0", "--request-option", "do_sample=false",
        "--out", str(ref_wav), "--out-dir", str(ref_chunk_dir),
    ])

    _run_candidate(
        native_dir=_candidate_native_dir_nosve(), model_dir=SUPERTONIC_DIR, family="supertonic",
        text=text, language="en", preset="M1", out_wav=got_wav, chunk_dir=got_chunk_dir,
    )

    failure = _compare_exact(ref_wav, got_wav)
    if not failure:
        return

    # Ruling R11: this case is SAMPLE-EXACT and is gated as such, not at ±1 LSB.
    #
    # It was an xfail for two rounds (shape mismatch, 82653 vs 82639 samples, and unmoved by
    # excluding the SVE modules that explained moss). residuals-investigation.md found why:
    # upstream ggml's ggml_conv_1d materialises its im2col buffer in F16 where audio.cpp's
    # fork uses the kernel's dtype, so our build ran supertonic's duration predictor with
    # half-precision activations. That predictor's output IS the output length
    # (runtime.cpp: trim = duration_seconds * sample_rate), so ~1.2e-4 of fp16 rounding
    # became 14 missing samples. native/src/audiocpp_compat.h now shims the four conv
    # entry points back to the fork's dtype semantics, and the whole waveform matches
    # bit-for-bit — hence _compare_exact above, and a hard failure rather than an xfail.
    import soundfile as sf

    ref_chunk_paths = sorted(ref_chunk_dir.glob("chunk_*.wav"), key=lambda p: p.name)
    got_chunk_paths = sorted(got_chunk_dir.glob("got_chunk_*.wav"), key=lambda p: p.name) if got_chunk_dir.exists() else []
    lines = [f"merged compare failed: {failure}", "", "per-chunk localization:"]
    for i in range(max(len(ref_chunk_paths), len(got_chunk_paths))):
        if i >= len(ref_chunk_paths):
            lines.append(f"  chunk {i}: candidate produced it, reference did not (reference: {len(ref_chunk_paths)} chunk(s))")
            continue
        if i >= len(got_chunk_paths):
            lines.append(f"  chunk {i}: reference produced it, candidate did not (candidate: {len(got_chunk_paths)} chunk(s))")
            continue
        ref_c, ref_c_rate = sf.read(str(ref_chunk_paths[i]), dtype="float32", always_2d=False)
        got_c, got_c_rate = sf.read(str(got_chunk_paths[i]), dtype="float32", always_2d=False)
        if ref_c_rate != got_c_rate or ref_c.shape != got_c.shape:
            lines.append(f"  chunk {i}: shape/rate mismatch ref={ref_c.shape}@{ref_c_rate} got={got_c.shape}@{got_c_rate}")
            continue
        r = compare(ref_c, got_c)
        lines.append(f"  chunk {i}: n={r.n} max_abs={r.max_abs:.3e} snr={r.snr_db:.2f} dB")
    lines += [
        "",
        "This case passed sample-exact when ruling R11 landed. A regression here is most",
        "likely a ggml bump that reintroduced a constructor-level behaviour change like the",
        "im2col dtype default — re-run the fork-vs-upstream scan documented in",
        "native/src/audiocpp_compat.h before assuming sk_tts is at fault.",
    ]
    pytest.fail("\n".join(lines))


@needs_cli
@needs_tree
@needs_moss
def test_moss_text_only(tmp_path):
    text = "Hello from MOSS-TTS-Nano."
    ref_wav = tmp_path / "ref.wav"
    got_wav = tmp_path / "got.wav"

    _run_cli([
        "--task", "tts", "--family", "moss_tts_nano", "--model", str(MOSS_DIR),
        "--backend", "cpu", "--threads", str(THREADS),
        "--text", text,
        "--seed", "0", "--request-option", "do_sample=true",
        "--out", str(ref_wav),
    ])

    _run_candidate(
        native_dir=_candidate_native_dir_nosve(), model_dir=MOSS_DIR, family="moss_tts_nano",
        text=text, out_wav=got_wav,
    )

    # Round 2 (ruling R10(s4)) established that under the OLD greedy configuration, rounds
    # 0/1's 3.6s-vs-24.0s length asymmetry was an SVE-bug accident, and with SVE excluded both
    # correct builds instead ran the full 300-frame/24.0s cap and agreed to within ±1 LSB.
    #
    # Round 4 / Ruling R23 (jiangzhuo 2026-09-01, .superpowers/moss-eoc-verdict.md): moss's own
    # greedy-decode stop logic never reaches real end-of-content for ordinary input — it is a
    # genuine defect in audio.cpp's own session/prompt/stop path (E1 there: 300-frame/24.000s
    # cap, measured once, transcript "The quick."), not a ggml-swap regression and not something
    # native/src/sk_tts.cpp could fix by staying greedy. Sampling reaches real EOC instead (E2:
    # 3/3, 2.6-3.7s, full correct transcript), so moss_tts_nano now runs do_sample=true in
    # production (native/src/sk_tts.cpp's `sample_decode` family flag) and this case's CLI
    # invocation was updated to match (do_sample=true, seed still "0"). Measured directly for
    # this text ("Hello from MOSS-TTS-Nano."): both sides reproduce BIT-EXACT (max_abs=0.0),
    # repeatably across reruns — the same-seed sampled RNG draw and the underlying non-SVE
    # arithmetic are apparently identical between the two ggml versions for this input. This is
    # NOT a general guarantee (see test_moss_clone's updated R12 comment for a case where a
    # different sentence diverges under sampling too); it is what this file's own fixed input
    # measures today.
    failure = _compare_lsb_tolerant(ref_wav, got_wav)
    assert not failure, failure


@needs_cli
@needs_tree
@needs_moss
def test_moss_clone(tmp_path):
    text = "Hello from MOSS-TTS-Nano."
    ref_clip = _sine_wav_f32()
    ref_clip_wav = tmp_path / "voice-ref.wav"
    _write_ref_wav(ref_clip_wav, 24000, ref_clip)
    ref_wav = tmp_path / "ref.wav"
    got_wav = tmp_path / "got.wav"

    # --task clon (not tts): moss_tts_nano is the one family in report §7 whose clone variant
    # uses a distinct task code. sk_tts.cpp hardcodes task_spec.task = Tts for every family at
    # load time (task-1-report.md's concern), never Clon — but MossTTSNanoSession::prepare()
    # (audiocpp-src/src/models/moss/moss_tts_nano/session.cpp:215-267) accepts either Tts or
    # VoiceCloning at construction and then branches purely on whether
    # request.voice->speaker->audio is present, not on which task kind was requested — so a
    # Tts-tagged session fed a voice reference through set_voice() is expected to run the exact
    # same prepare()/run() path as a Clon-tagged one given the same reference.
    #
    # Round 2 (ruling R10(s4)): this case already hit the SAME 300-frame/24.0s cap on BOTH
    # sides even in rounds 0/1 under the OLD greedy configuration (the SVE bug's corruption
    # wasn't enough to trigger early EOC for this input either way), so the shapes were
    # expected to (and did) match here.
    #
    # Round 4 / Ruling R23: do_sample=true now, matching moss_tts_nano's production
    # configuration (native/src/sk_tts.cpp's `sample_decode` family flag) — see
    # test_moss_text_only's comment and .superpowers/moss-eoc-verdict.md for why.
    _run_cli([
        "--task", "clon", "--family", "moss_tts_nano", "--model", str(MOSS_DIR),
        "--backend", "cpu", "--threads", str(THREADS),
        "--text", text, "--voice-ref", str(ref_clip_wav), "--reference-text", REFERENCE_TEXT,
        "--seed", "0", "--request-option", "do_sample=true",
        "--out", str(ref_wav),
    ])

    _run_candidate(
        native_dir=_candidate_native_dir_nosve(), model_dir=MOSS_DIR, family="moss_tts_nano",
        text=text, voice_ref_wav=ref_clip_wav, voice_ref_text=REFERENCE_TEXT, out_wav=got_wav,
    )

    failure = _compare_lsb_tolerant(ref_wav, got_wav)
    if not failure:
        return

    # Ruling R12 — PERMANENT xfail, and not a defect in anything this repo owns. Re-examined
    # under Ruling R23 (Round 4, jiangzhuo 2026-09-01, .superpowers/moss-eoc-verdict.md) when
    # moss_tts_nano switched from greedy to sampled decode: the ORIGINAL mechanics no longer
    # apply verbatim (there is no argmax tie to flip once the stop decision is a softmax draw
    # instead), but the underlying chaos was NOT eliminated, and this xfail therefore stays as
    # a soft safety net (assert only if the comparison actually fails — same shape as before),
    # not a hard assert.
    #
    # residuals-investigation.md traced the ORIGINAL (greedy) mechanics end to end: the
    # reference-audio ENCODE path the round-2 comment suspected was innocent — the encoder
    # input, its latent, and all 16 RVQ codebooks are BIT-IDENTICAL on both sides. The real
    # divergence was one entry of ggml's 65536-entry fp16 GELU lookup table, at x = -1.9990234,
    # differing by a single fp16 ULP — a rounding coin flip at the midpoint (|err| vs a
    # float64 reference: 1.525e-05 fork, 1.527e-05 upstream, against the table's own 9.7e-04
    # quantization error). Neither ggml is more correct, and the two versions' source for both
    # the GELU formula and the table build is identical. Under GREEDY decode that 3.05e-05
    # landed in layer 4 of the global transformer at decode step 1, reached ~1.2e-2 in the
    # hidden by layer 11, and flipped 4 of the 16 codebook argmax decisions in frame 1
    # (margins 0.0025-0.064; the run made 4800 such decisions, 7 with a margin under 1e-2).
    #
    # Directly re-measured under SAMPLED decode (this case's do_sample=true, R23): for THIS
    # test's exact input (text "Hello from MOSS-TTS-Nano.", the 1s 440Hz sine reference), both
    # builds reproduce BIT-EXACT and repeatably — the class of ULP that used to flip an argmax
    # tie apparently does not flip this input's sampled draws. That is NOT evidence the
    # divergence risk is gone: the same re-examination found that swapping in a different
    # sentence ("The quick brown fox jumps over the lazy dog.") against the SAME voice-clone
    # reference, still do_sample=true seed=0, diverges into a DIFFERENT FRAME COUNT entirely
    # (157440 vs 168960 samples) — a bigger break than the original max_abs>1.0, and further
    # proof that chaotic autoregressive amplification doesn't care whether the fragile
    # decision was an argmax tie or a sampled draw. This is therefore still NOT waivable by
    # widening MAX_ABS_TOLERANCE — no amplitude band (and no shape check) separates "same
    # model, different chaotic trajectory" from "broken". Waveform parity is simply the wrong
    # invariant for a 300-step autoregressive decoder, greedy or sampled. moss_text_only
    # carries the family's numeric signal (same model, same graph, passes at 1 LSB for its own
    # input); functional quality for the clone path is gated by the TTS->ASR loopback, which
    # asks the only question that actually matters here — does it say the right words.
    pytest.xfail(
        "R12/R23: chaotic autoregressive amplification of a per-build floating-point "
        "difference (originally an argmax-tie flip under greedy decode; moss_tts_nano is now "
        "sampled per R23, and a DIFFERENT input was directly measured to diverge into a "
        "different frame count under sampling too) — expected, not a defect; quality gated by "
        f"the TTS->ASR loopback. {failure}"
    )


@needs_cli
@needs_tree
@needs_qwen3
def test_qwen3_base_clone(tmp_path):
    """qwen3-tts-0.6b Base: cloning is REQUIRED (report §3), so this is the family's only
    offline mode. Model download deferred to the live-gate task (Task 7) — this case only
    exercises the harness's env-var skip until SK_TEST_TTS_QWEN3_DIR is set."""
    text = "Hello from Qwen3 TTS."
    ref_clip = _sine_wav_f32()
    ref_clip_wav = tmp_path / "voice-ref.wav"
    _write_ref_wav(ref_clip_wav, 24000, ref_clip)
    ref_wav = tmp_path / "ref.wav"
    got_wav = tmp_path / "got.wav"

    _run_cli([
        "--task", "tts", "--family", "qwen3_tts", "--model", str(QWEN3_DIR),
        "--backend", "cpu", "--threads", str(THREADS),
        "--text", text, "--voice-ref", str(ref_clip_wav), "--reference-text", REFERENCE_TEXT,
        "--seed", "0", "--request-option", "do_sample=false",
        "--out", str(ref_wav),
    ])

    _run_candidate(
        native_dir=_candidate_native_dir_nosve(), model_dir=QWEN3_DIR, family="qwen3_tts",
        text=text, voice_ref_wav=ref_clip_wav, voice_ref_text=REFERENCE_TEXT, out_wav=got_wav,
    )

    failure = _compare_lsb_tolerant(ref_wav, got_wav)
    assert not failure, failure


@needs_cli
@needs_tree
@needs_pocket
def test_pocket_preset_alba(tmp_path):
    """pocket-tts-en preset "alba" (report §7). Model download deferred to the live-gate task
    (Task 7) — this case only exercises the harness's env-var skip until
    SK_TEST_TTS_POCKET_DIR is set."""
    text = "Hello from PocketTTS."
    ref_wav = tmp_path / "ref.wav"
    got_wav = tmp_path / "got.wav"

    _run_cli([
        "--task", "tts", "--family", "pocket_tts", "--model", str(POCKET_DIR),
        "--backend", "cpu", "--threads", str(THREADS),
        "--text", text, "--voice-id", "alba",
        "--seed", "0", "--request-option", "do_sample=false",
        "--out", str(ref_wav),
    ])

    _run_candidate(
        native_dir=_candidate_native_dir_nosve(), model_dir=POCKET_DIR, family="pocket_tts",
        text=text, preset="alba", out_wav=got_wav,
    )

    failure = _compare_lsb_tolerant(ref_wav, got_wav)
    assert not failure, failure


@needs_cli
@needs_tree
@needs_omnivoice
def test_omnivoice_clone(tmp_path):
    """omnivoice clone — reference_text is MANDATORY here (report §3: prompt_builder.cpp
    throws otherwise). SK_TEST_TTS_OMNIVOICE_DIR-gated (see needs_omnivoice) since CI does
    not download this model today; when it does run, expect ruling R13's xfail below, not
    a pass — see that block for why."""
    text = "Hello from OmniVoice."
    ref_clip = _sine_wav_f32()
    ref_clip_wav = tmp_path / "voice-ref.wav"
    _write_ref_wav(ref_clip_wav, 24000, ref_clip)
    ref_wav = tmp_path / "ref.wav"
    got_wav = tmp_path / "got.wav"

    _run_cli([
        "--task", "tts", "--family", "omnivoice", "--model", str(OMNIVOICE_DIR),
        "--backend", "cpu", "--threads", str(THREADS),
        "--text", text, "--voice-ref", str(ref_clip_wav), "--reference-text", REFERENCE_TEXT,
        "--seed", "0", "--request-option", "do_sample=false",
        "--out", str(ref_wav),
    ])

    _run_candidate(
        native_dir=_candidate_native_dir_nosve(), model_dir=OMNIVOICE_DIR, family="omnivoice",
        text=text, voice_ref_wav=ref_clip_wav, voice_ref_text=REFERENCE_TEXT, out_wav=got_wav,
    )

    failure = _compare_lsb_tolerant(ref_wav, got_wav)
    if not failure:
        return

    # Ruling R13 — PERMANENT xfail, and not a defect in anything this repo owns (the
    # opposite of moss_clone's R12: there the two ggml trees are both "right", just on
    # different chaotic trajectories; here the fork reference is demonstrably WRONG).
    #
    # native/src/audiocpp_compat.h's ggml_sub compat shim (block (C)) ggml_conts src0
    # before the omnivoice audio-tokenizer RVQ loop's ggml_sub whenever src0 is a
    # non-row-contiguous view — exactly what happens at audio_tokenizer.cpp:1924-1928,
    # where residual_bct is a bare PERMUTE view (ne=[T,1024], nb=[4096,4]). Upstream ggml's
    # binary-ops.cpp asserts nb00 == sizeof(src0_t) and would otherwise SIGABRT the whole
    # process; the fork this reference CLI links against only asserts nb00 %
    # sizeof(src0_t) == 0, so it accepts the same tensor but its vec_binary_op_non_contiguous
    # indexes src0 as a contiguous x[i] walk — wrong for a 4096-byte first-dim stride.
    # Measured directly (omnivoice-crash-investigation.md, standalone op-level test against
    # both ggml trees on the identical node): 60416 of 61440 output elements come out wrong
    # on the fork (max abs err 5.9e4), while upstream's stricter assert would have aborted
    # instead of silently corrupting. So the fork-built official CLI reference this test
    # compares against is the INCORRECT waveform, not ours — waveform parity is the wrong
    # invariant here, same reasoning as R12, but with the roles of "reference" and
    # "candidate" reversed: our candidate is right, the reference is wrong. Functional
    # quality for the clone path is gated by the TTS->ASR loopback instead, which asks the
    # only question that actually matters here — does it say the right words (it does,
    # exactly, and more accurately than the fork-built CLI: see the investigation's §5).
    pytest.xfail(
        "R13: ggml_sub compat shim (audiocpp_compat.h) makes omnivoice clone output "
        "intentionally diverge from the fork-built official CLI reference, because fork "
        "ggml computes the non-contiguous sub wrong (60416/61440 elements, max abs err "
        "5.9e4) — the official reference waveform is the incorrect one, not our candidate; "
        f"see omnivoice-crash-investigation.md. {failure}"
    )
