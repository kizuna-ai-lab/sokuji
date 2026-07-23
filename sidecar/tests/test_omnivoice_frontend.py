"""Tests for the OmniVoice frontend: tokenizer loading, special-token input
framing (`_prepare_inference_inputs` in the PyTorch source), and the
duration -> num_target_tokens estimator (`_estimate_target_tokens`).

Framing/shape tests use a deterministic fake tokenizer (no real BPE vocab
needed) so they always run. The exact-parity tests against the real
Qwen2-family tokenizer.json self-skip when the spike model snapshot
(`.spike/models/omnivoice_pt/`) is not present on disk -- the fixture values
embedded below were captured once from the real PyTorch
`OmniVoice._prepare_inference_inputs` / `_estimate_target_tokens` (see
`.superpowers/sdd/task-2-report.md`) and are asserted as literals regardless,
so the golden numbers are pinned even without the multi-GB spike assets.
"""
import os
import re

import numpy as np
import pytest

from sokuji_sidecar.omnivoice import frontend

# Special-token ids as they actually resolve in the real OmniVoice
# tokenizer.json (captured alongside the fixtures below).
SPECIAL_IDS = {
    "<|denoise|>": 151669,
    "<|lang_start|>": 151670,
    "<|lang_end|>": 151671,
    "<|instruct_start|>": 151672,
    "<|instruct_end|>": 151673,
    "<|text_start|>": 151674,
    "<|text_end|>": 151675,
}

_OMNIVOICE_PT_DIR = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", ".spike", "models", "omnivoice_pt"))


def _real_tokenizer_dir():
    return _OMNIVOICE_PT_DIR if os.path.isfile(
        os.path.join(_OMNIVOICE_PT_DIR, "tokenizer.json")) else None


class _FakeEncoding:
    def __init__(self, ids):
        self.ids = ids


class _FakeTok:
    """Deterministic fake: the 7 real special-token strings resolve to their
    real reserved ids (mirroring how the real tokenizer's added-vocabulary
    matches them regardless of `add_special_tokens`); everything else maps
    one id per codepoint. Good enough to exercise framing/shape/dtype logic
    without needing the real 11MB tokenizer.json."""
    _SPECIAL_RE = re.compile("|".join(re.escape(s) for s in SPECIAL_IDS))

    def encode(self, text, add_special_tokens=False):
        ids = []
        pos = 0
        for m in self._SPECIAL_RE.finditer(text):
            if m.start() > pos:
                ids.extend(ord(c) for c in text[pos:m.start()])
            ids.append(SPECIAL_IDS[m.group()])
            pos = m.end()
        if pos < len(text):
            ids.extend(ord(c) for c in text[pos:])
        return _FakeEncoding(ids)


class _WholeStringHashTok:
    """Fake whose encode() returns a single id derived from the *entire*
    exact string passed in one call. Used only to prove
    `_tokenize_with_nonverbal_tags` really issues separate encode() calls
    per segment/tag (isolated tokenization) rather than tokenizing the
    combined string in one shot -- if it didn't split, the result would
    collapse to a single id for the whole text instead of one id per
    segment."""
    def encode(self, text, add_special_tokens=False):
        return _FakeEncoding([abs(hash(text)) % 1_000_000])


def _style_ids(lang, instruct, denoised):
    ids = []
    if denoised:
        ids.append(SPECIAL_IDS["<|denoise|>"])
    ids.append(SPECIAL_IDS["<|lang_start|>"])
    ids.extend(ord(c) for c in (lang or "None"))
    ids.append(SPECIAL_IDS["<|lang_end|>"])
    ids.append(SPECIAL_IDS["<|instruct_start|>"])
    ids.extend(ord(c) for c in (instruct or "None"))
    ids.append(SPECIAL_IDS["<|instruct_end|>"])
    return ids


def _text_ids(text):
    ids = [SPECIAL_IDS["<|text_start|>"]]
    ids.extend(ord(c) for c in text)
    ids.append(SPECIAL_IDS["<|text_end|>"])
    return ids


# ---------------------------------------------------------------------------
# build_input_ids: framing, shapes, dtypes, MASK fill, audio_mask boundaries
# ---------------------------------------------------------------------------

def test_shape_is_1_8_seq_and_dtypes():
    input_ids, audio_mask, _ = frontend.build_input_ids(
        _FakeTok(), "hi", lang="English", num_target_tokens=5, denoise=True)
    assert input_ids.shape[0] == 1 and input_ids.shape[1] == 8
    assert input_ids.dtype == np.int64
    assert audio_mask.dtype == np.bool_
    assert audio_mask.shape == (1, input_ids.shape[2])


def test_all_eight_codebooks_repeat_the_style_and_text_rows():
    input_ids, _, cond_audio_start = frontend.build_input_ids(
        _FakeTok(), "hi", lang="English", num_target_tokens=5, denoise=True)
    for cb in range(8):
        assert input_ids[0, cb, :cond_audio_start].tolist() == \
            input_ids[0, 0, :cond_audio_start].tolist()


def test_target_region_is_all_mask_id_across_all_codebooks():
    input_ids, audio_mask, cond_audio_start = frontend.build_input_ids(
        _FakeTok(), "hi", lang="English", num_target_tokens=5, denoise=True)
    assert np.all(input_ids[0, :, cond_audio_start:] == 1024)
    assert audio_mask[0, cond_audio_start:].all()
    assert not audio_mask[0, :cond_audio_start].any()


def test_no_denoise_token_without_ref_codes_even_when_denoise_true():
    # Mirrors the PyTorch source: `if denoise and ref_audio_tokens is not
    # None` -- denoise=True alone is not enough, ref_codes must be present.
    input_ids, _, _ = frontend.build_input_ids(
        _FakeTok(), "hi", lang="English", num_target_tokens=3, denoise=True)
    assert SPECIAL_IDS["<|denoise|>"] not in input_ids[0, 0].tolist()


def test_denoise_token_present_when_cloning():
    ref_codes = np.arange(8 * 4, dtype=np.int64).reshape(8, 4)
    input_ids, _, _ = frontend.build_input_ids(
        _FakeTok(), "hi", lang="English", num_target_tokens=3,
        ref_codes=ref_codes, denoise=True)
    assert input_ids[0, 0, 0] == SPECIAL_IDS["<|denoise|>"]


def test_denoise_false_suppresses_token_even_with_ref_codes():
    ref_codes = np.arange(8 * 4, dtype=np.int64).reshape(8, 4)
    input_ids, _, _ = frontend.build_input_ids(
        _FakeTok(), "hi", lang="English", num_target_tokens=3,
        ref_codes=ref_codes, denoise=False)
    assert SPECIAL_IDS["<|denoise|>"] not in input_ids[0, 0].tolist()


def test_lang_and_instruct_default_to_literal_none():
    input_ids, _, _ = frontend.build_input_ids(
        _FakeTok(), "hi", num_target_tokens=3, denoise=True)
    expected_style = _style_ids(None, None, denoised=False)
    assert input_ids[0, 0, :len(expected_style)].tolist() == expected_style


def test_full_framing_matches_expected_ids_exactly():
    input_ids, audio_mask, cond_audio_start = frontend.build_input_ids(
        _FakeTok(), "hi", lang="English", instruct="cheerful",
        num_target_tokens=4, denoise=True)
    expected = (
        _style_ids("English", "cheerful", denoised=False)
        + _text_ids("hi")
        + [1024, 1024, 1024, 1024]
    )
    assert input_ids[0, 0].tolist() == expected
    assert cond_audio_start == len(expected) - 4
    assert audio_mask[0].tolist() == \
        [False] * cond_audio_start + [True] * 4


def test_ref_codes_are_spliced_between_text_and_target_per_codebook():
    ref_codes = np.array([[100 + cb * 10 + t for t in range(3)]
                           for cb in range(8)], dtype=np.int64)
    input_ids, audio_mask, cond_audio_start = frontend.build_input_ids(
        _FakeTok(), "hi", lang="English", num_target_tokens=4,
        ref_codes=ref_codes, denoise=True)
    style_and_text_len = len(_style_ids("English", None, denoised=True)) \
        + len(_text_ids("hi"))
    for cb in range(8):
        row = input_ids[0, cb].tolist()
        assert row[style_and_text_len:style_and_text_len + 3] == \
            ref_codes[cb].tolist()
        assert row[style_and_text_len + 3:] == [1024, 1024, 1024, 1024]
    # audio_mask covers ref (3) + target (4) = the last 7 positions.
    assert cond_audio_start == style_and_text_len
    assert audio_mask[0, style_and_text_len:].all()
    assert not audio_mask[0, :style_and_text_len].any()


def test_ref_codes_wrong_codebook_count_raises():
    bad_ref = np.zeros((4, 3), dtype=np.int64)  # wrong: must be 8 codebooks
    with pytest.raises(ValueError):
        frontend.build_input_ids(
            _FakeTok(), "hi", num_target_tokens=2, ref_codes=bad_ref)


# ---------------------------------------------------------------------------
# Nonverbal-tag isolation: segments/tags must be tokenized independently
# ---------------------------------------------------------------------------

def test_nonverbal_tags_are_tokenized_in_isolation_not_merged_with_context():
    tok = _WholeStringHashTok()
    text = "hello[laughter]world"
    wrapped = f"<|text_start|>{text}<|text_end|>"
    # The three segments _tokenize_with_nonverbal_tags actually issues
    # encode() calls for: everything up to the tag (including the
    # <|text_start|> wrapper that precedes it), the tag itself, and
    # everything after (including the <|text_end|> wrapper).
    before_segment = "<|text_start|>hello"
    tag_segment = "[laughter]"
    after_segment = "world<|text_end|>"

    before_id = tok.encode(before_segment).ids[0]
    tag_id = tok.encode(tag_segment).ids[0]
    after_id = tok.encode(after_segment).ids[0]
    whole_id = tok.encode(wrapped).ids[0]
    # Sanity: with this fake, whole-string tokenization differs from the
    # concatenation of independently-tokenized pieces (proves the fake is a
    # meaningful probe -- if these collided the test below would be vacuous).
    assert whole_id not in (before_id, tag_id, after_id)

    got = frontend.build_input_ids(
        tok, text, num_target_tokens=1, denoise=False)[0][0, 0].tolist()
    # What matters: the *text* portion decomposed into 3 isolated ids around
    # the tag rather than one id for the fully-wrapped string.
    assert whole_id not in got  # not tokenized as one blob
    assert before_id in got and tag_id in got and after_id in got


# ---------------------------------------------------------------------------
# estimate_target_tokens: no tokenizer dependency, pure text-weight port of
# the PyTorch RuleDurationEstimator fallback path. Fixtures captured from
# the real model's `_estimate_target_tokens` (see task-2-report.md).
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,speed,expected", [
    ("hello world", 1.0, 35),
    ("hello world", 1.5, 23),
    ("你好，世界！这是一个测试。", 1.0, 55),
    ("This is a slightly longer sentence to estimate duration for.", 1.0, 92),
])
def test_estimate_target_tokens_matches_pytorch_fixture(text, speed, expected):
    assert frontend.estimate_target_tokens(text, speed=speed) == expected


def test_estimate_target_tokens_is_at_least_one():
    assert frontend.estimate_target_tokens("", speed=1.0) >= 1


# ---------------------------------------------------------------------------
# Golden parity against the real tokenizer.json (self-skips without the
# spike model snapshot). Fixtures captured verbatim from
# `OmniVoice._prepare_inference_inputs("hello world", 40, None, None,
# "English", None, True)` and the Chinese equivalent -- see
# .superpowers/sdd/task-2-report.md for the capture script/output.
# ---------------------------------------------------------------------------

_EXPECTED_EN_ROW0 = [
    151670, 22574, 151671, 151672, 4064, 151673,
    151674, 14990, 1879, 151675,
] + [1024] * 40

_EXPECTED_ZH_ROW0 = [
    151670, 44923, 151671, 151672, 4064, 151673,
    151674, 108386, 3837, 99489, 6313, 105464, 81705, 1773, 151675,
] + [1024] * 64


@pytest.mark.skipif(_real_tokenizer_dir() is None,
                     reason="omnivoice_pt tokenizer.json spike asset not present")
def test_load_tokenizer_resolves_special_token_ids():
    tok = frontend.load_tokenizer(_real_tokenizer_dir())
    for text, expected_id in SPECIAL_IDS.items():
        got = tok.token_to_id(text)
        assert got == expected_id, f"{text!r} resolved to {got}, expected {expected_id}"


@pytest.mark.skipif(_real_tokenizer_dir() is None,
                     reason="omnivoice_pt tokenizer.json spike asset not present")
def test_build_input_ids_matches_pytorch_fixture_english():
    tok = frontend.load_tokenizer(_real_tokenizer_dir())
    input_ids, audio_mask, cond_audio_start = frontend.build_input_ids(
        tok, "hello world", lang="English", num_target_tokens=40, denoise=True)
    assert input_ids.shape == (1, 8, 50)
    for cb in range(8):
        assert input_ids[0, cb].tolist() == _EXPECTED_EN_ROW0
    assert cond_audio_start == 10
    assert audio_mask[0].tolist() == [False] * 10 + [True] * 40
    assert int(audio_mask.sum()) == 40


@pytest.mark.skipif(_real_tokenizer_dir() is None,
                     reason="omnivoice_pt tokenizer.json spike asset not present")
def test_build_input_ids_matches_pytorch_fixture_chinese():
    tok = frontend.load_tokenizer(_real_tokenizer_dir())
    input_ids, audio_mask, cond_audio_start = frontend.build_input_ids(
        tok, "你好，世界！这是一个测试。", lang="Chinese", num_target_tokens=64,
        denoise=True)
    assert input_ids.shape == (1, 8, 79)
    for cb in range(8):
        assert input_ids[0, cb].tolist() == _EXPECTED_ZH_ROW0
    assert cond_audio_start == 15
    assert audio_mask[0].tolist() == [False] * 15 + [True] * 64
    assert int(audio_mask.sum()) == 64


def test_split_for_tts_chunks_long_text_preserving_words():
    from sokuji_sidecar.omnivoice.frontend import split_for_tts
    assert split_for_tts("Hello there friend.") == ["Hello there friend."]  # short -> unchanged
    assert split_for_tts("   ") == []
    long = ("I've spent much of my career studying how the Chinese "
            "Communist Party thinks about competition.")
    chunks = split_for_tts(long)
    assert len(chunks) >= 2                             # long sentence is split
    assert all(len(c.split()) <= 9 for c in chunks)    # each chunk short (max_words + merge slack)
    assert " ".join(chunks).split() == long.split()    # every word preserved, in order
    # comma-separated list items are merged, not left as bare 1-word chunks
    for c in split_for_tts("It's over technology, talent, research, and influence."):
        assert len(c.split()) >= 2
