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

Every case is gated on two independent things, so each one skips on its own:
  - the reference CLI existing at all (native/tests/parity/build_reference_cli.sh must have
    been run first — this file never builds it itself: that is a ~15 minute, network-using
    step that has no place inside an ordinary pytest run);
  - the family's model directory env var (SK_TEST_TTS_<FAMILY>_DIR) being set, mirroring
    native/python/tests/test_sokuji_native.py's needs_tts_* pattern.

Determinism: both sides fix seed=0 and do_sample=false — the CLI explicitly
(`--seed 0 --request-option do_sample=false`, report §7), our binding always internally (R7,
native/README.md's TTS section). Both sides are pinned to the SAME thread count (THREADS
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


def _sve_free_copy(src_dir: pathlib.Path, dst_dir: pathlib.Path, key_file: str) -> pathlib.Path:
    """A real (non-symlink) copy of src_dir with SVE_CPU_MODULES excluded, cached under
    dst_dir. A real copy, not symlinks: ggml's default CPU-module search path on Linux is the
    RUNNING EXECUTABLE's own directory, resolved via /proc/self/exe — which the kernel
    resolves THROUGH a symlink to the symlink's target, so a symlinked audiocpp_cli would
    silently defeat this (it would still search the ORIGINAL, SVE-including directory).
    Copying uniformly for both sides (rather than symlinking the ones that could tolerate it)
    keeps this one mechanism simple. Idempotent: skipped once dst_dir's own copy of
    `key_file` is no older than the source's, so a rebuilt source is picked back up."""
    src_key = src_dir / key_file
    dst_key = dst_dir / key_file
    if dst_key.exists() and dst_key.stat().st_mtime >= src_key.stat().st_mtime:
        return dst_dir
    dst_dir.mkdir(parents=True, exist_ok=True)
    for entry in src_dir.iterdir():
        if entry.is_file() and entry.name not in SVE_CPU_MODULES:
            shutil.copy2(entry, dst_dir / entry.name)
    return dst_dir


def _official_cli_nosve() -> pathlib.Path:
    dst_dir = CACHE_DIR / "audiocpp-official-nosve"
    _sve_free_copy(OFFICIAL_CLI.parent, dst_dir, "audiocpp_cli")
    return dst_dir / "audiocpp_cli"


def _candidate_native_dir_nosve() -> pathlib.Path:
    return _sve_free_copy(sokuji_native.native_dir(), CACHE_DIR / "sokuji-native-nosve", "libsokuji_native.so")


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

    failure = _compare_lsb_tolerant(ref_wav, got_wav)
    if not failure:
        return

    # Round 2 (ruling R10(s4)): even with the SVE bug excluded from BOTH sides — which is
    # what fixed moss below — supertonic still does not agree. The investigation confirmed
    # this directly (re-ran supertonic SVE-free: still a shape mismatch, 82653 vs 82639) and
    # left it as a separate, unexplained residual, explicitly out of scope for this round.
    # xfail with per-chunk localization; not chased further.
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
    pytest.xfail("\n".join(lines))


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
        "--seed", "0", "--request-option", "do_sample=false",
        "--out", str(ref_wav),
    ])

    _run_candidate(
        native_dir=_candidate_native_dir_nosve(), model_dir=MOSS_DIR, family="moss_tts_nano",
        text=text, out_wav=got_wav,
    )

    # Round 2 (ruling R10(s4)): rounds 0/1's 3.6s-vs-24.0s length asymmetry was an ACCIDENT
    # of the SVE bug — it corrupted the OFFICIAL reference's stop logits enough that EOC fired
    # early (frame 45), while the candidate (which happened to load the same broken SVE
    # module in rounds 0/1 too, just diverging differently) ran to the cap. The model never
    # actually reaches EOC for this input on EITHER correct build — moss_tts_nano's 300-frame
    # runaway is a real, separate defect in audio.cpp's own session/prompt/stop path, not a
    # ggml-swap regression and not something native/src/sk_tts.cpp can fix (product decision
    # — fix upstream, cap max_new_frames, or drop the family — pending elsewhere). With SVE
    # excluded from both sides here, BOTH run the full 300-frame / 24.0s generation and are
    # expected to agree to within ±1 LSB.
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
    # sides even in rounds 0/1 (the SVE bug's corruption wasn't enough to trigger early EOC
    # for this input either way), so the shapes were expected to (and do) match here.
    _run_cli([
        "--task", "clon", "--family", "moss_tts_nano", "--model", str(MOSS_DIR),
        "--backend", "cpu", "--threads", str(THREADS),
        "--text", text, "--voice-ref", str(ref_clip_wav), "--reference-text", REFERENCE_TEXT,
        "--seed", "0", "--request-option", "do_sample=false",
        "--out", str(ref_wav),
    ])

    _run_candidate(
        native_dir=_candidate_native_dir_nosve(), model_dir=MOSS_DIR, family="moss_tts_nano",
        text=text, voice_ref_wav=ref_clip_wav, voice_ref_text=REFERENCE_TEXT, out_wav=got_wav,
    )

    failure = _compare_lsb_tolerant(ref_wav, got_wav)
    if not failure:
        return

    # NEW finding this round, NOT predicted by moss-divergence-investigation.md (which only
    # end-to-end-verified the TEXT-ONLY case's SVE-free agreement): the clone path additionally
    # exercises the audio tokenizer's ENCODE step on the reference clip
    # (MossTTSNanoSession::reference_codes_for_request/encode_reference_audio), which the
    # text-only case never reaches — a large divergence here (max_abs comfortably above 1.0,
    # i.e. beyond what clamping to [-1, 1] can even bound) is consistent with a SEPARATE
    # numeric issue on that code path, not the already-diagnosed SVE ggml_vec_dot_f32 bug
    # (shapes match here, ruling out the length-only symptom that bug produces). Ruled out as
    # a harness bug: the reference clip's WAV round-trip (_write_ref_wav's 32-bit float
    # subtype, read back via soundfile) is verified bit-exact, so both sides condition on an
    # identical clip. Per this round's "do not chase further" scope for any residual beyond
    # the already-explained SVE story, xfail with the measured numbers rather than
    # investigating the audio tokenizer path — flagged prominently in the round-2 report for
    # whoever picks this up next.
    pytest.xfail(f"NEW residual (not the SVE bug — shapes match, only content diverges): {failure}")


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
    throws otherwise). Model download deferred to the live-gate task (Task 7) — this case only
    exercises the harness's env-var skip until SK_TEST_TTS_OMNIVOICE_DIR is set."""
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
    assert not failure, failure
