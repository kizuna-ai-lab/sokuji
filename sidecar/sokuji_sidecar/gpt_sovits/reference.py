"""Reference-audio processing for GPT-SoVITS zero-shot cloning.

Ported from genie_tts Audio/Audio.py (load_audio) + Audio/ReferenceAudio.py
(__init__) (MIT, see LICENSE). SOKUJI changes: input is an in-memory float32
array (the sidecar receives raw PCM over the wire, not a file path); no LRU
cache (one active reference at a time, held by the caller); sessions are
passed in explicitly instead of a global model_manager; the hubert input
name is read from the session (upstream hardcodes 'input_values').
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import soxr

logger = logging.getLogger(__name__)

# genie_tts Audio/Audio.py:10-14
MIN_DURATION_S = 3.0
MAX_DURATION_S = 10.0
SILENCE_TO_APPEND_S = 0.3


@dataclass
class Reference:
    audio_32k: np.ndarray
    ssl_content: np.ndarray
    prompt_text: str
    prompt_language: str
    # SOKUJI addition: upstream's ReferenceAudio.__init__ precomputes this
    # too (ReferenceAudio.py:43, derived from audio_32k before the batch dim
    # is added) and keeps it on the instance for update_global_emb's sv_model
    # feed (ReferenceAudio.py:72, feed name 'waveform'). Stored here so the
    # v2ProPlus branch of Synthesizer.synthesize doesn't need to recompute it
    # or take an extra session param just to re-derive a 16k track.
    audio_16k: np.ndarray


def build_reference(audio: np.ndarray, sr: int, text: str, language: str,
                    hubert_session) -> Reference:
    # genie_tts Audio/Audio.py:load_audio, inlined + adapted for an
    # in-memory array instead of sf.read(audio_path).
    wav = np.asarray(audio, dtype=np.float32).reshape(-1)
    duration = wav.shape[0] / float(sr)
    if not MIN_DURATION_S <= duration <= MAX_DURATION_S:
        logger.warning(
            "reference clip has a duration of %.2f seconds, which is "
            "outside the recommended range of %s to %s seconds!",
            duration, MIN_DURATION_S, MAX_DURATION_S)

    # ReferenceAudio.py:39-43 - resample to 32k FIRST, append silence, THEN
    # derive the 16k track from the (already-silence-padded) 32k track. Do
    # not resample 16k from the original wav.
    wav32 = soxr.resample(wav, sr, 32000) if sr != 32000 else wav.copy()
    silence = np.zeros(int(SILENCE_TO_APPEND_S * 32000), dtype=np.float32)
    wav32 = np.concatenate([wav32, silence]).astype(np.float32)
    wav16 = soxr.resample(wav32, 32000, 16000).astype(np.float32)

    # ReferenceAudio.py:50-52 hardcodes feed name 'input_values'; SOKUJI
    # reads it from the session instead so this doesn't silently break if
    # the shipped graph names it differently.
    input_name = hubert_session.get_inputs()[0].name
    ssl_content = hubert_session.run(
        None, {input_name: wav16.reshape(1, -1)})[0]

    return Reference(
        audio_32k=wav32.reshape(1, -1),
        ssl_content=ssl_content,
        prompt_text=text,
        prompt_language=language,
        audio_16k=wav16.reshape(1, -1),
    )
