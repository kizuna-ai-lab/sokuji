import pytest

from sokuji_sidecar.cosyvoice3 import frontend


class _FakeEncoding:
    def __init__(self, ids):
        self.ids = ids


class _FakeTok:
    """Deterministic fake: one id per character codepoint."""
    def encode(self, text, add_special_tokens=False):
        return _FakeEncoding([ord(c) for c in text])


def test_prompt_ids_splice_endofprompt():
    ids = frontend.build_prompt_text_ids(_FakeTok(), "hi")
    prefix = [ord(c) for c in "You are a helpful assistant."]
    assert ids == prefix + [frontend.ENDOFPROMPT_ID] + [ord("h"), ord("i")]


def test_japanese_text_is_kana_normalized():
    out = frontend.normalize_text("こんにちは、今日はとても良い天気ですね。")
    # pyopenjtalk renders pronunciations in katakana; no kanji must survive
    assert "今日" not in out and "良" not in out and "天気" not in out
    assert "、" in out or "。" in out          # punctuation preserved


def test_pure_chinese_text_untouched_except_period():
    assert frontend.normalize_text("今天天气真好.") == "今天天气真好。"


def test_english_text_untouched():
    s = "Hello, world. It works!"
    assert frontend.normalize_text(s) == s


def test_kana_detection_requires_kana_not_just_cjk():
    # kanji-only strings are ambiguous zh/ja: leave them alone
    s = "人工知能"
    assert frontend.normalize_text(s) == s
