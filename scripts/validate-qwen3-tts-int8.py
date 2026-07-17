#!/usr/bin/env python3
"""int8 quality gate: synthesize fixed zh/en sentences with the int8 tree via
the real Qwen3TtsOnnxBackend (cpu) and transcribe with the sidecar's own ASR
engine (loopback); compare against the fp32 tree run the same way. PASS =
int8 transcripts match the fp32 transcripts (same normalized text), no
empty/near-silent output, and CPU RTF(int8) < RTF(fp32) (WARN only if not).

Adapted from the Task-2 brief's harness sketch to the REAL APIs in this repo,
plus two rounds of empirical correction (see git log for scripts/ and
task-2-report.md for the full trace):

  - AsrEngine (sidecar/sokuji_sidecar/asr_engine.py) has no standalone
    transcribe(wav) method. Live audio goes through feed()/flush(), which
    segment via a silero VAD and call `self._backend.transcribe(samples,
    language)` once per detected segment (see AsrEngine._drain). A
    synthesized clip is already one clean, pre-isolated utterance with no
    unknown speech boundaries to find, so this harness calls the *resolved*
    backend directly -- the exact same transcribe() call the engine makes
    internally, using the same accel.resolve()-driven load path (AsrEngine.
    init()), just without the VAD chunker that exists for live/streaming
    input. That also removes VAD boundary jitter as a source of transcript
    drift unrelated to the fp32-vs-int8 comparison this gate exists for.

  - Qwen3TtsOnnxBackend.generate() *can* run in a no-voice-clone mode
    (voice_clone_prompt=None -- see qwen3_tts/template.py's
    build_talker_inputs docstring) and does not raise, but empirically
    degrades badly (near-silent / filler-word output) rather than raising.
    This harness ALWAYS calls set_builtin_voice() -- unconditionally, not on
    an exception -- with the snapshot's first bundled voice (preferring one
    whose reference transcript .txt exists) after set_language(), so fp32
    and int8 get identical ICL/x-vector conditioning.

  - SOKUJI_QWEN3_TTS_GREEDY=1 (argmax decoding) was tried first for a
    numerically-tight A/B and turned out to degenerate this AR model: with
    no temperature/top-p escape hatch, greedy decoding gets stuck in a
    repetition loop that never selects EOS, running to the frame cap
    (max_new_tokens, default 600 @ ~12.5 codec Hz -> ~48s) regardless of the
    ~4s a short sentence should take. The resulting audio -- reproducibly
    (verified bit-exact across repeat fp32 runs, so this isn't run-to-run
    noise) -- transcribes to a stray filler word, not the input sentence,
    for BOTH variants. A garbled baseline can't judge int8. This harness
    only sets SOKUJI_QWEN3_TTS_SEED=42 (the caller exports it) and leaves
    sampling stochastic (do_sample=True); comparison is over normalized
    ASR TEXT (semantic), not raw samples, so fp32 and int8 need not decode
    an identical token path or produce identical sample counts -- they only
    need to say the same thing.

  - Because a stochastic decode can still degenerate on either variant, this
    harness checks the fp32 BASELINE against the input sentence itself
    before trusting any fp32-vs-int8 comparison: `_content_words` extracts
    the input's meaningful words (or, for zh, individual CJK characters --
    there are no word boundaries to split on), and `_baseline_plausible`
    requires at least MIN_CONTENT_OVERLAP of them to appear in the fp32
    hypothesis. If the baseline itself doesn't resemble the input, this is
    a HARNESS ERROR (report BLOCKED with evidence), never a silent int8
    FAIL -- a broken reference can't validate anything compared against it.

  - The ASR loopback loads on device="auto", NOT "cpu" (the TTS backend
    still loads on "cpu" -- see synth() -- because the int8 comparison this
    gate exists for is specifically about the CPU-EP MatMulNBits graphs).
    Diagnosed directly against transcribe_cpp (bypassing AsrEngine
    entirely): cohere-transcribe-03-2026's CPU backend
    (libggml-cpu-armv8.6_2.so on this aarch64 box) has a genuine
    correctness bug -- session.run() on a *known-correct* reference clip
    (voices/Atlas.wav, whose .txt transcript is on record) returns "Oh,
    yeah." regardless of the actual audio content, while the vulkan and
    auto backends transcribe the identical PCM correctly and verbatim. This
    is a transcribe_cpp/cohere-model/CPU-backend bug on this machine,
    unrelated to Qwen3-TTS or its quantization; forcing the ASR loopback
    onto whatever `accel.resolve()` picks by default (usually vulkan here)
    avoids it corrupting every transcript in this gate.
"""
import json
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sidecar"))

SENTENCES = {"en": "The weather is lovely today, so I will go for a walk in the park.",
             "zh": "今天天气很好，我打算下午去公园散步。"}

# Below this many samples (~0.33s @ 24kHz) output is treated as empty/
# near-silent regardless of what the ASR loopback returns.
MIN_SAMPLES = 8000

# How many of the input sentence's content words/characters must show up in
# the fp32 baseline's hypothesis for the baseline to be considered plausible
# (i.e. the harness is actually exercising real speech, not garbage).
MIN_CONTENT_OVERLAP = 3

_EN_STOPWORDS = {
    "a", "an", "the", "is", "was", "will", "to", "in", "on", "for", "of",
    "and", "i", "so", "it", "am", "be", "at", "my", "me", "you",
}


def fabricate_cache(tree, repo_id):
    """Minimal HF-cache entry: refs/main -> snapshots/<sha> symlinked to tree.
    Qwen3TtsOnnxBackend.load() resolves the repo via
    snapshot_download(repo_id, local_files_only=True), so the variant repos
    built by build-qwen3-tts-variant-repos.py (which never get uploaded) need
    a local-only cache entry pointing straight at the on-disk tree."""
    from huggingface_hub.constants import HF_HUB_CACHE
    root = os.path.join(HF_HUB_CACHE, f"models--{repo_id.replace('/', '--')}")
    sha = "0" * 40
    os.makedirs(os.path.join(root, "refs"), exist_ok=True)
    os.makedirs(os.path.join(root, "snapshots"), exist_ok=True)
    with open(os.path.join(root, "refs", "main"), "w") as f:
        f.write(sha)
    link = os.path.join(root, "snapshots", sha)
    if not os.path.exists(link):
        os.symlink(os.path.abspath(tree), link)


def _first_builtin_voice(tree):
    """The snapshot's first bundled voice, preferring one whose reference
    transcript (.txt) exists alongside the clip (needed for full ICL
    conditioning, not just x-vector-only). Falls back to the manifest's
    default-flagged entry, then its first entry, if voices/ can't be listed
    directly (e.g. a stripped-down fixture tree)."""
    voices_dir = os.path.join(tree, "voices")
    try:
        wavs = sorted(f[:-4] for f in os.listdir(voices_dir) if f.endswith(".wav"))
    except OSError:
        wavs = []
    for name in wavs:
        if os.path.exists(os.path.join(voices_dir, f"{name}.txt")):
            return name
    if wavs:
        return wavs[0]
    with open(os.path.join(voices_dir, "manifest.json")) as f:
        manifest = json.load(f)
    for v in manifest:
        if v.get("default"):
            return v["name"]
    return manifest[0]["name"]


def synth(repo_id, tree, variant, lang, text):
    from sokuji_sidecar.tts_backends import Qwen3TtsOnnxBackend
    be = Qwen3TtsOnnxBackend()
    be.load(repo_id, "cpu", variant, None)
    be.set_language(lang)
    be.set_builtin_voice(_first_builtin_voice(tree))  # unconditional -- see module docstring
    samples, gen_ms = be.generate(text)
    audio_s = len(samples) / float(be.sample_rate)
    rtf = gen_ms / 1000.0 / max(audio_s, 1e-9)
    return samples, be.sample_rate, rtf


def transcribe(samples, sr, lang):
    import soxr
    from sokuji_sidecar.asr_engine import AsrEngine  # sidecar's own ASR loopback
    wav16 = soxr.resample(samples, sr, 16000).astype(np.float32)
    eng = AsrEngine()
    # device="auto", NOT "cpu" -- see module docstring: this model's CPU
    # backend has a correctness bug on this aarch64 machine.
    eng.init(model_id="cohere-transcribe-03-2026", device="auto", language=lang)
    # No feed()/flush() VAD framing here -- see module docstring. eng._backend
    # is the same resolved backend AsrEngine._drain() would call per segment.
    result = eng._backend.transcribe(wav16, lang)
    eng.close()
    raw = result.text or ""
    return raw, re.sub(r"[\s\W]+", "", raw).lower()


def _content_words(lang, text):
    """Meaningful units of the reference sentence to look for in a
    hypothesis: whitespace/stopword-filtered words for English, individual
    CJK characters for Chinese (no word boundaries to split zh on)."""
    if lang == "zh":
        return [ch for ch in text if "一" <= ch <= "鿿"]
    words = re.findall(r"[a-zA-Z]+", text.lower())
    return [w for w in words if len(w) >= 3 and w not in _EN_STOPWORDS]


def _baseline_plausible(lang, reference_text, hyp_norm):
    """True if >= MIN_CONTENT_OVERLAP of the reference's content words/chars
    show up (as substrings -- hyp_norm has no spaces) in the hypothesis."""
    ref_units = set(_content_words(lang, reference_text))
    overlap = sum(1 for u in ref_units if u in hyp_norm)
    return overlap >= min(MIN_CONTENT_OVERLAP, len(ref_units))


def main():
    size = sys.argv[1] if len(sys.argv) > 1 else "0.6b"
    results = {}
    for variant, tree in (("fp32", f"/tmp/q3repos/qwen3-tts-{size}-onnx-fp32"),
                          ("int8", f"/tmp/q3repos/qwen3-tts-{size}-onnx-int8")):
        repo = f"jiangzhuo9357/qwen3-tts-{size}-onnx-{variant}"
        fabricate_cache(tree, repo)
        for lang, text in SENTENCES.items():
            samples, sr, rtf = synth(repo, tree, variant, lang, text)
            raw, hyp = transcribe(samples, sr, lang)
            results[(variant, lang)] = (hyp, rtf, len(samples), raw)
            audio_s = len(samples) / float(sr)
            print(f"{variant}/{lang}: rtf={rtf:.2f} samples={len(samples)} "
                  f"({audio_s:.2f}s) raw_hyp={raw!r} norm_hyp={hyp[:60]!r}",
                  flush=True)

    # Harness-validity gate: the fp32 baseline must actually resemble the
    # input sentence before any fp32-vs-int8 comparison is trusted.
    harness_ok = True
    for lang, text in SENTENCES.items():
        f_hyp, _f_rtf, _f_n, f_raw = results[("fp32", lang)]
        if not _baseline_plausible(lang, text, f_hyp):
            print(f"HARNESS ERROR {lang}: fp32 baseline does not resemble the input "
                  f"sentence (input={text!r} fp32_raw_hyp={f_raw!r} fp32_norm_hyp={f_hyp!r}) "
                  f"-- refusing to judge int8 against a broken baseline")
            harness_ok = False
    if not harness_ok:
        print("VERDICT: HARNESS_ERROR")
        return 2

    ok = True
    for lang in SENTENCES:
        f_hyp, f_rtf, f_n, _f_raw = results[("fp32", lang)]
        i_hyp, i_rtf, i_n, _i_raw = results[("int8", lang)]
        print(f"summary {lang}: fp32 samples={f_n} rtf={f_rtf:.2f} | "
              f"int8 samples={i_n} rtf={i_rtf:.2f}")
        if i_n < MIN_SAMPLES or not i_hyp:
            print(f"FAIL {lang}: int8 produced empty/near-silent audio")
            ok = False
        elif i_hyp != f_hyp:
            print(f"FAIL {lang}: transcript mismatch fp32={f_hyp!r} int8={i_hyp!r}")
            ok = False
        elif i_rtf >= f_rtf:
            print(f"WARN {lang}: int8 not faster (rtf {i_rtf:.2f} vs {f_rtf:.2f})")
    print("VERDICT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
