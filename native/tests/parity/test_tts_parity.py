"""audio.cpp TTS parity gate (spec §9.2): the OFFICIAL, unpatched `audiocpp_cli` (built by
build_reference_cli.sh from the same vendored source with its OWN fork ggml) versus
`libsokuji_native`'s `sk_tts` (upstream ggml + the audiocpp_compat.h shim), compared
sample-exact on CPU via compare_pcm.py's `--exact`.

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
`sokuji_native.init()` is idempotent and only the FIRST call's n_threads takes effect
(native/python/sokuji_native/__init__.py) — every test still passes THREADS explicitly so the
value actually in effect is never implicit.

WAV encoding: the CLI's `--out` always writes 16-bit PCM via audio.cpp's own
`engine::audio::write_pcm16_wav` (clamp to [-1, 1], `lrint(sample * 32767.0f)`, report §7). Our
candidate side must quantize identically — see _quantize_pcm16 below — or a 1-LSB rounding
mismatch from a DIFFERENT quantizer would masquerade as a genuine parity failure.
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys

import numpy as np
import pytest

from compare_pcm import compare, verdict

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


def _quantize_pcm16(samples: np.ndarray) -> np.ndarray:
    """Replicates audio.cpp's own WAV writer exactly (wav_writer.cpp, write_pcm16_wav): clamp
    to [-1, 1], multiply by 32767.0 in float32, round-to-nearest-even (`std::lrint`'s default
    FPU rounding mode, which `numpy.rint` also uses) to int16. See the module docstring."""
    clamped = np.clip(samples.astype(np.float32), np.float32(-1.0), np.float32(1.0))
    scaled = clamped * np.float32(32767.0)
    return np.rint(scaled).astype(np.int16)


def _write_pcm16_wav(path: pathlib.Path, sample_rate: int, samples: np.ndarray) -> None:
    import soundfile as sf

    sf.write(str(path), _quantize_pcm16(samples), sample_rate, subtype="PCM_16")


def _run_cli(args: list[str]) -> None:
    proc = subprocess.run(
        [str(OFFICIAL_CLI), *args],
        capture_output=True, text=True, timeout=600,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"audiocpp_cli failed (exit {proc.returncode}): {' '.join(args)}\n"
            f"--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
        )


def _assert_exact(ref_wav: pathlib.Path, got_wav: pathlib.Path) -> None:
    import soundfile as sf

    ref, ref_rate = sf.read(str(ref_wav), dtype="float32", always_2d=False)
    got, got_rate = sf.read(str(got_wav), dtype="float32", always_2d=False)
    assert ref_rate == got_rate, f"sample-rate mismatch: reference={ref_rate} candidate={got_rate}"
    r = compare(ref, got)
    assert verdict(r, exact=True), (
        f"parity FAILED: n={r.n} max_abs={r.max_abs:.3e} snr={r.snr_db:.2f} dB "
        f"(reference {len(ref)} samples @ {ref_rate}, candidate {len(got)} samples @ {got_rate})"
    )


@needs_cli
@needs_tree
@needs_supertonic
def test_supertonic_streaming_voice_id_m1(tmp_path):
    text = "Hello from Supertonic."
    ref_wav = tmp_path / "ref.wav"
    got_wav = tmp_path / "got.wav"
    ref_chunk_dir = tmp_path / "ref_chunks"
    ref_chunk_dir.mkdir()

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

    sokuji_native.init(n_threads=THREADS)
    t = sokuji_native.tts_load(SUPERTONIC_DIR, "supertonic")
    got_chunks: list[np.ndarray] = []
    try:
        t.set_preset("M1")
        samples, rate = t.synth(text, language="en", on_chunk=lambda pcm, sr: got_chunks.append(pcm))
    finally:
        t.unload()
    _write_pcm16_wav(got_wav, rate, samples)

    try:
        _assert_exact(ref_wav, got_wav)
    except (AssertionError, ValueError) as merged_failure:
        # ValueError: compare_pcm.compare() itself refuses to diff differently-shaped
        # arrays (a shape mismatch IS a non-exact verdict, just one that never reaches the
        # assert below) — caught here too so a chunk-count mismatch still gets localized.
        # Per-chunk localization (not chased further than this — see the parity README and
        # task-3-report.md "Fix round 1"): compare each candidate chunk against the CLI's own
        # --out-dir chunk_<i>.wav, so a merged-length mismatch (different chunk COUNT) is
        # distinguished from a same-length, different-content mismatch (same chunk count,
        # some/all chunks differ).
        import soundfile as sf

        ref_chunk_paths = sorted(ref_chunk_dir.glob("chunk_*.wav"), key=lambda p: p.name)
        lines = [f"merged compare failed: {merged_failure}", "", "per-chunk localization:"]
        for i in range(max(len(ref_chunk_paths), len(got_chunks))):
            if i >= len(ref_chunk_paths):
                lines.append(f"  chunk {i}: candidate produced it, reference did not (reference: {len(ref_chunk_paths)} chunk(s))")
                continue
            if i >= len(got_chunks):
                lines.append(f"  chunk {i}: reference produced it, candidate did not (candidate: {len(got_chunks)} chunk(s))")
                continue
            got_chunk_wav = tmp_path / f"got_chunk_{i}.wav"
            _write_pcm16_wav(got_chunk_wav, rate, got_chunks[i])
            ref_c, ref_c_rate = sf.read(str(ref_chunk_paths[i]), dtype="float32", always_2d=False)
            got_c, got_c_rate = sf.read(str(got_chunk_wav), dtype="float32", always_2d=False)
            if ref_c_rate != got_c_rate or ref_c.shape != got_c.shape:
                lines.append(f"  chunk {i}: shape/rate mismatch ref={ref_c.shape}@{ref_c_rate} got={got_c.shape}@{got_c_rate}")
                continue
            r = compare(ref_c, got_c)
            lines.append(f"  chunk {i}: n={r.n} max_abs={r.max_abs:.3e} snr={r.snr_db:.2f} dB")
        raise AssertionError("\n".join(lines)) from merged_failure


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

    sokuji_native.init(n_threads=THREADS)
    t = sokuji_native.tts_load(MOSS_DIR, "moss_tts_nano")
    try:
        samples, rate = t.synth(text)
    finally:
        t.unload()
    _write_pcm16_wav(got_wav, rate, samples)

    _assert_exact(ref_wav, got_wav)


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
    # same prepare()/run() path as a Clon-tagged one given the same reference. If this case
    # fails parity, that expectation — not a text/rate mismatch — is the first thing to revisit.
    _run_cli([
        "--task", "clon", "--family", "moss_tts_nano", "--model", str(MOSS_DIR),
        "--backend", "cpu", "--threads", str(THREADS),
        "--text", text, "--voice-ref", str(ref_clip_wav), "--reference-text", REFERENCE_TEXT,
        "--seed", "0", "--request-option", "do_sample=false",
        "--out", str(ref_wav),
    ])

    sokuji_native.init(n_threads=THREADS)
    t = sokuji_native.tts_load(MOSS_DIR, "moss_tts_nano")
    try:
        t.set_voice(ref_clip, 24000, ref_text=REFERENCE_TEXT)
        samples, rate = t.synth(text)
    finally:
        t.unload()
    _write_pcm16_wav(got_wav, rate, samples)

    _assert_exact(ref_wav, got_wav)


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

    sokuji_native.init(n_threads=THREADS)
    t = sokuji_native.tts_load(QWEN3_DIR, "qwen3_tts")
    try:
        t.set_voice(ref_clip, 24000, ref_text=REFERENCE_TEXT)
        samples, rate = t.synth(text)
    finally:
        t.unload()
    _write_pcm16_wav(got_wav, rate, samples)

    _assert_exact(ref_wav, got_wav)


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

    sokuji_native.init(n_threads=THREADS)
    t = sokuji_native.tts_load(POCKET_DIR, "pocket_tts")
    try:
        t.set_preset("alba")
        samples, rate = t.synth(text)
    finally:
        t.unload()
    _write_pcm16_wav(got_wav, rate, samples)

    _assert_exact(ref_wav, got_wav)


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

    sokuji_native.init(n_threads=THREADS)
    t = sokuji_native.tts_load(OMNIVOICE_DIR, "omnivoice")
    try:
        t.set_voice(ref_clip, 24000, ref_text=REFERENCE_TEXT)
        samples, rate = t.synth(text)
    finally:
        t.unload()
    _write_pcm16_wav(got_wav, rate, samples)

    _assert_exact(ref_wav, got_wav)
