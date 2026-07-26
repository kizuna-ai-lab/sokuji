# Apache License 2.0
"""Text front-end for OmniVoice: tokenizer loading, special-token input
framing, and the text-duration -> target-audio-token estimator. Torch-free --
uses the `tokenizers` package directly against the shipped `tokenizer.json`
(no `transformers`).

Replicates three pieces of the PyTorch reference
(`.spike/models/omnivoice_src/modeling_omnivoice.py`, verified byte-for-byte
identical to the `omnivoice` pip package's copy):

- ``_prepare_inference_inputs`` (L1064): builds the conditioning
  ``input_ids``/``audio_mask`` fed to the backbone. Layout, left to right:
  style tokens (``<|denoise|>`` only when cloning, i.e. ``ref_codes`` is
  given, then ``<|lang_start|>{lang}<|lang_end|><|instruct_start|>
  {instruct}<|instruct_end|>``, defaulting the literal string ``"None"``
  when lang/instruct are absent), then the wrapped text
  (``<|text_start|>{text}<|text_end|>``, tokenized via
  ``_tokenize_with_nonverbal_tags``), then optional reference-audio codes
  (voice cloning), then ``num_target_tokens`` copies of the MASK id (1024).
  Every row is identical across the 8 codebooks except the ref-codes region
  (genuine per-codebook audio tokens, passed through as-is). ``audio_mask``
  is True over the ref+target audio region; ``cond_audio_start`` is where
  that region begins.
- ``_tokenize_with_nonverbal_tags`` (L1528): splits text on the non-verbal
  tag regex and tokenizes each segment/tag standalone
  (``add_special_tokens=False``) so a tag's ids never depend on the
  surrounding language context, then concatenates.
- ``_estimate_target_tokens`` (calls into ``RuleDurationEstimator.
  estimate_duration``, `omnivoice.utils.duration`): a from-scratch,
  torch-free port of the character-weight-based duration heuristic, used
  only via its no-reference-audio fallback path (``ref_text="Nice to meet
  you."``, ``num_ref_audio_tokens=frame_rate`` -- this backend never has a
  reference transcript, see ``docs/superpowers/plans/
  2026-07-23-omnivoice-sidecar-backend.md`` Task 3: ``set_voice`` takes no
  ``ref_text``).

The special tokens above are genuine entries in the Qwen2-family
``tokenizer.json`` (verified against the real vocab) -- the `tokenizers`
package's added-vocabulary matching resolves them to their reserved ids
regardless of ``add_special_tokens``, exactly like `transformers`' fast
tokenizer wrapper. This was empirically checked against the real PyTorch
model's output during development; see
``.superpowers/sdd/task-2-report.md``.
"""
import bisect
import os
import re
import unicodedata
from functools import lru_cache
from typing import Optional

import numpy as np
from tokenizers import Tokenizer

NUM_AUDIO_CODEBOOK = 8
AUDIO_MASK_ID = 1024

# Verbatim from modeling_omnivoice.py's _NONVERBAL_PATTERN.
_NONVERBAL_PATTERN = re.compile(
    r"\[(laughter|sigh|confirmation-en|question-en|question-ah|question-oh|"
    r"question-ei|question-yi|surprise-ah|surprise-oh|surprise-wa|"
    r"surprise-yo|dissatisfaction-hnn)\]"
)

_NEWLINE_RE = re.compile(r"[\r\n]+")
_SPACE_COLLAPSE_RE = re.compile(r"[ \t]+")
_CHINESE_SPACE_RE = re.compile(r"(?<=[\u4e00-\u9fff])\s+|\s+(?=[\u4e00-\u9fff])")


def load_tokenizer(model_dir: str) -> Tokenizer:
    """Load the Qwen2-family tokenizer bundled with an OmniVoice backbone
    variant (``tokenizer.json`` in ``model_dir``)."""
    return Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))


def _combine_text(text: str) -> str:
    """Port of `_combine_text` with `ref_text` fixed to None (this backend
    never has a reference transcript -- see module docstring)."""
    full_text = text.strip()
    full_text = _NEWLINE_RE.sub("", full_text)
    full_text = full_text.replace("（", "(").replace("）", ")")
    full_text = _SPACE_COLLAPSE_RE.sub(" ", full_text)
    full_text = _CHINESE_SPACE_RE.sub("", full_text)
    return full_text


def _tokenize_with_nonverbal_tags(tok: Tokenizer, text: str) -> list:
    """Port of `_tokenize_with_nonverbal_tags`: split on the non-verbal tag
    regex, tokenize each segment/tag standalone, then concatenate the ids."""
    parts = []
    last_end = 0
    for m in _NONVERBAL_PATTERN.finditer(text):
        if m.start() > last_end:
            segment = text[last_end:m.start()]
            ids = tok.encode(segment, add_special_tokens=False).ids
            if ids:
                parts.append(ids)
        tag_ids = tok.encode(m.group(), add_special_tokens=False).ids
        if tag_ids:
            parts.append(tag_ids)
        last_end = m.end()
    if last_end < len(text):
        segment = text[last_end:]
        ids = tok.encode(segment, add_special_tokens=False).ids
        if ids:
            parts.append(ids)

    if not parts:
        return list(tok.encode(text, add_special_tokens=False).ids)
    combined = []
    for p in parts:
        combined.extend(p)
    return combined


def build_input_ids(tok: Tokenizer, text: str, *, lang: Optional[str] = None,
                     instruct: Optional[str] = None,
                     ref_codes: Optional[np.ndarray] = None,
                     num_target_tokens: int, denoise: bool = True):
    """Replicates `_prepare_inference_inputs`. Returns
    ``(input_ids: np.int64 (1,8,S), audio_mask: np.bool_ (1,S),
    cond_audio_start: int)``."""
    style_text = ""
    if denoise and ref_codes is not None:
        style_text += "<|denoise|>"
    lang_str = lang if lang else "None"
    instruct_str = instruct if instruct else "None"
    style_text += f"<|lang_start|>{lang_str}<|lang_end|>"
    style_text += f"<|instruct_start|>{instruct_str}<|instruct_end|>"
    style_ids = tok.encode(style_text, add_special_tokens=False).ids

    full_text = _combine_text(text)
    wrapped_text = f"<|text_start|>{full_text}<|text_end|>"
    text_ids = _tokenize_with_nonverbal_tags(tok, wrapped_text)

    cond_row = np.array(list(style_ids) + list(text_ids), dtype=np.int64)
    seq_rows = [np.tile(cond_row, (NUM_AUDIO_CODEBOOK, 1))]

    ref_len = 0
    if ref_codes is not None:
        ref_arr = np.asarray(ref_codes, dtype=np.int64)
        if ref_arr.ndim != 2 or ref_arr.shape[0] != NUM_AUDIO_CODEBOOK:
            raise ValueError(
                f"ref_codes must have shape ({NUM_AUDIO_CODEBOOK}, T), got "
                f"{ref_arr.shape}")
        seq_rows.append(ref_arr)
        ref_len = ref_arr.shape[-1]

    target_row = np.full((num_target_tokens,), AUDIO_MASK_ID, dtype=np.int64)
    seq_rows.append(np.tile(target_row, (NUM_AUDIO_CODEBOOK, 1)))

    input_ids = np.concatenate(seq_rows, axis=1)[np.newaxis, :, :]

    cond_total_length = input_ids.shape[2]
    cond_audio_start = cond_total_length - num_target_tokens - ref_len

    audio_mask = np.zeros((1, cond_total_length), dtype=np.bool_)
    audio_mask[0, cond_audio_start:] = True

    return input_ids, audio_mask, cond_audio_start


# ---------------------------------------------------------------------------
# Duration estimator: torch-free port of `omnivoice.utils.duration.
# RuleDurationEstimator`, used only through the no-reference fallback that
# `_estimate_target_tokens` falls back to when there is no reference
# transcript (always true for this backend).
# ---------------------------------------------------------------------------

_WEIGHTS = {
    "cjk": 3.0, "hangul": 2.5, "kana": 2.2, "ethiopic": 3.0, "yi": 3.0,
    "indic": 1.8, "thai_lao": 1.5, "khmer_myanmar": 1.8,
    "arabic": 1.5, "hebrew": 1.5,
    "latin": 1.0, "cyrillic": 1.0, "greek": 1.0, "armenian": 1.0,
    "georgian": 1.0,
    "punctuation": 0.5, "space": 0.2, "digit": 3.5, "mark": 0.0,
    "default": 1.0,
}

# (end_codepoint, type_key) pairs for a bisect lookup -- verbatim from
# RuleDurationEstimator.ranges.
_RANGES = [
    (0x02AF, "latin"), (0x03FF, "greek"), (0x052F, "cyrillic"),
    (0x058F, "armenian"), (0x05FF, "hebrew"), (0x077F, "arabic"),
    (0x089F, "arabic"), (0x08FF, "arabic"), (0x097F, "indic"),
    (0x09FF, "indic"), (0x0A7F, "indic"), (0x0AFF, "indic"),
    (0x0B7F, "indic"), (0x0BFF, "indic"), (0x0C7F, "indic"),
    (0x0CFF, "indic"), (0x0D7F, "indic"), (0x0DFF, "indic"),
    (0x0EFF, "thai_lao"), (0x0FFF, "indic"), (0x109F, "khmer_myanmar"),
    (0x10FF, "georgian"), (0x11FF, "hangul"), (0x137F, "ethiopic"),
    (0x139F, "ethiopic"), (0x13FF, "default"), (0x167F, "default"),
    (0x169F, "default"), (0x16FF, "default"), (0x171F, "default"),
    (0x173F, "default"), (0x175F, "default"), (0x177F, "default"),
    (0x17FF, "khmer_myanmar"), (0x18AF, "default"), (0x18FF, "default"),
    (0x194F, "indic"), (0x19DF, "indic"), (0x19FF, "khmer_myanmar"),
    (0x1A1F, "indic"), (0x1AAF, "indic"), (0x1B7F, "indic"),
    (0x1BBF, "indic"), (0x1BFF, "indic"), (0x1C4F, "indic"),
    (0x1C7F, "indic"), (0x1C8F, "cyrillic"), (0x1CBF, "georgian"),
    (0x1CCF, "indic"), (0x1CFF, "indic"), (0x1D7F, "latin"),
    (0x1DBF, "latin"), (0x1DFF, "default"), (0x1EFF, "latin"),
    (0x309F, "kana"), (0x30FF, "kana"), (0x312F, "cjk"),
    (0x318F, "hangul"), (0x9FFF, "cjk"), (0xA4CF, "yi"),
    (0xA4FF, "default"), (0xA63F, "default"), (0xA69F, "cyrillic"),
    (0xA6FF, "default"), (0xA7FF, "latin"), (0xA82F, "indic"),
    (0xA87F, "default"), (0xA8DF, "indic"), (0xA8FF, "indic"),
    (0xA92F, "indic"), (0xA95F, "indic"), (0xA97F, "hangul"),
    (0xA9DF, "indic"), (0xA9FF, "khmer_myanmar"), (0xAA5F, "indic"),
    (0xAA7F, "khmer_myanmar"), (0xAADF, "indic"), (0xAAFF, "indic"),
    (0xAB2F, "ethiopic"), (0xAB6F, "latin"), (0xABBF, "default"),
    (0xABFF, "indic"), (0xD7AF, "hangul"), (0xFAFF, "cjk"),
    (0xFDFF, "arabic"), (0xFE6F, "default"), (0xFEFF, "arabic"),
    (0xFFEF, "latin"),
]
_BREAKPOINTS = [r[0] for r in _RANGES]


@lru_cache(maxsize=4096)
def _char_weight(char: str) -> float:
    code = ord(char)
    if (65 <= code <= 90) or (97 <= code <= 122):
        return _WEIGHTS["latin"]
    if code == 32:
        return _WEIGHTS["space"]
    if code == 0x0640:  # Arabic Tatweel
        return _WEIGHTS["mark"]

    category = unicodedata.category(char)
    if category.startswith("M"):
        return _WEIGHTS["mark"]
    if category.startswith("P") or category.startswith("S"):
        return _WEIGHTS["punctuation"]
    if category.startswith("Z"):
        return _WEIGHTS["space"]
    if category.startswith("N"):
        return _WEIGHTS["digit"]

    idx = bisect.bisect_left(_BREAKPOINTS, code)
    if idx < len(_RANGES):
        return _WEIGHTS.get(_RANGES[idx][1], _WEIGHTS["default"])
    if code > 0x20000:  # CJK Ext B/C/D, historic scripts
        return _WEIGHTS["cjk"]
    return _WEIGHTS["default"]


def _total_weight(text: str) -> float:
    return sum(_char_weight(c) for c in text)


def _estimate_duration(target_text: str, ref_text: str, ref_duration: float,
                        low_threshold: Optional[float] = 50,
                        boost_strength: float = 3) -> float:
    if ref_duration <= 0 or not ref_text:
        return 0.0
    ref_weight = _total_weight(ref_text)
    if ref_weight == 0:
        return 0.0
    speed_factor = ref_weight / ref_duration
    target_weight = _total_weight(target_text)
    estimated_duration = target_weight / speed_factor
    if low_threshold is not None and estimated_duration < low_threshold:
        alpha = 1.0 / boost_strength
        return low_threshold * (estimated_duration / low_threshold) ** alpha
    return estimated_duration


def estimate_target_tokens(text: str, *, speed: float = 1.0,
                            frame_rate: int = 25) -> int:
    """Port of `_estimate_target_tokens`'s no-reference-audio fallback path
    (``ref_text="Nice to meet you."``, ``num_ref_audio_tokens=frame_rate`` --
    the literal ``25`` in the source coincides with the real
    ``frame_rate``, i.e. "1 second of reference audio")."""
    ref_text = "Nice to meet you."
    num_ref_audio_tokens = frame_rate
    est = _estimate_duration(text, ref_text, num_ref_audio_tokens)
    if speed > 0 and speed != 1.0:
        est = est / speed
    return max(1, int(est))


# Soft cap on words per synthesized chunk. OmniVoice's single-shot
# non-autoregressive decode garbles long inputs (verified with ASR: a 15-word
# sentence returns near-noise while 6-7-word phrases are clean), so the backend
# splits long text into short phrases and synthesizes chunk-by-chunk,
# concatenating the audio. SOFT: split_for_tts may exceed this by up to 2 words
# when absorbing a 1-2 word list fragment ("talent," / "research,") into the
# previous phrase — a bare 1-2 word chunk synthesizes far worse than an
# 8-9 word one, so the merge deliberately trades a slightly longer chunk for
# never emitting fragment-only chunks.
TTS_MAX_CHUNK_WORDS = 7

# Duration-budget slack multiplier applied to estimate_target_tokens by the
# backend. The estimate is a tight average-pace budget, but the decode's
# prosody is stochastic: a slower-than-average draw runs out of frames and the
# SENTENCE TAIL gets truncated or garbled ("The cost is absolutely" — end
# missing). ASR-verified on a tail-failing sentence: x1.0 completed 3/6 runs,
# x1.25 and x1.4 completed 6/6. Keep the slack modest — ~1.8x+ over-length
# makes the model stretch/garble words instead.
TTS_TARGET_SLACK = 1.25


def split_for_tts(text: str, max_words: int = TTS_MAX_CHUNK_WORDS) -> list:
    """Split text into short phrases for chunked synthesis. Breaks at clause /
    sentence punctuation (``. ! ? ; : ,`` and em/en dashes, delimiter kept),
    hard-wraps any piece still over ``max_words`` by word count, then merges
    1-2 word fragments (e.g. list items like "talent," "research,") into the
    previous phrase. Text already within ``max_words`` returns a single chunk,
    so short utterances are unchanged."""
    text = (text or "").strip()
    if not text:
        return []
    parts = [p.strip() for p in re.split(r"(?<=[.!?;:,—–])\s+", text) if p.strip()]
    out = []
    for p in parts:
        words = p.split()
        if len(words) <= max_words:
            out.append(p)
        else:
            for i in range(0, len(words), max_words):
                out.append(" ".join(words[i:i + max_words]))
    merged = []
    for c in out:
        if merged and len(c.split()) <= 2 and len((merged[-1] + " " + c).split()) <= max_words + 2:
            merged[-1] = merged[-1] + " " + c
        else:
            merged.append(c)
    return merged
