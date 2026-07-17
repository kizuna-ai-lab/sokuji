# Apache License 2.0
"""Text front-end for CosyVoice3.

Zero-shot template (official CosyVoice3 usage, asserted by the upstream
LLM): prompt_text = "You are a helpful assistant." + <|endofprompt|>
(id 151646) + reference transcript. The exported tokenizer cannot encode
<|endofprompt|>, so the id is spliced in raw — verified token-identical
to the official tokenizer in the phase-1 spike review.

Japanese input is kana-normalized with pyopenjtalk (g2p kana=True):
the 0.5B LLM reads kanji with Chinese phonology otherwise (spike finding);
kana input is essentially correct. Detection: any hiragana/katakana in the
text marks it Japanese. Normalization runs on punctuation-delimited chunks
so punctuation marks pass through byte-for-byte instead of being rewritten
by pyopenjtalk (empirically, feeding it a whole string with ASCII
punctuation mixed in rewrites "," / "!" to full-width "，" / "！", which
would silently change output the caller didn't ask for). Both a pyopenjtalk
import failure and a runtime g2p() failure on a given chunk degrade softly
(the affected text passes through unmodified) so the backend never dies
over the JA path.
"""
import re

from ..qwen_tokenizer import load_qwen2_tokenizer

ENDOFPROMPT_ID = 151646
ZERO_SHOT_PREFIX = "You are a helpful assistant."

# Hiragana + katakana block (U+3040-U+30FF). Deliberately excludes the CJK
# punctuation block (U+3000-U+303F, e.g. 、 。) so punctuation-only
# chunks never trigger a g2p call on their own.
_KANA_RE = re.compile(r"[\u3040-\u30ff]")
# CJK Unified Ideographs (U+4E00-U+9FFF) — kanji/hanzi, ambiguous between
# Japanese and Chinese on their own (see test_kana_detection_requires_kana_not_just_cjk).
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
# Splits on runs of sentence-level punctuation while keeping the separators
# (capturing group), so pause structure survives the round trip verbatim.
_PUNCT_SPLIT_RE = re.compile(r"([、。，．！？!?,.]+)")


def load_tokenizer(model_dir: str):
    """Load the shared Qwen2 BPE tokenizer used by the CosyVoice3 LLM."""
    return load_qwen2_tokenizer(model_dir)


def _kana_normalize(text: str) -> str:
    try:
        import pyopenjtalk  # provided by the pyopenjtalk-plus wheel
    except Exception:
        return text
    parts = _PUNCT_SPLIT_RE.split(text)
    out = []
    for part in parts:
        if part and (_KANA_RE.search(part) or _CJK_RE.search(part)):
            try:
                out.append(pyopenjtalk.g2p(part, kana=True))
            except Exception:
                # A g2p failure on this chunk (pathological input, dictionary
                # gap, ...) must not take down the whole request — fall back
                # to the untouched chunk, same as an import failure.
                out.append(part)
        else:
            out.append(part)
    return "".join(out)


def normalize_text(text: str) -> str:
    """Normalize TTS input text ahead of tokenization.

    Japanese (any hiragana/katakana present) is rewritten to kana via
    pyopenjtalk. Chinese (kanji present, no kana) gets a minimal ASCII ->
    full-width punctuation pass mirroring the official CosyVoice3 frontend.
    Anything else (e.g. plain English, or kanji-only text — ambiguous
    between zh/ja, see test_kana_detection_requires_kana_not_just_cjk) is
    left untouched.
    """
    text = text.strip()
    if _KANA_RE.search(text):
        return _kana_normalize(text)
    if _CJK_RE.search(text):
        return text.replace(".", "。").replace("?", "？").replace("!", "！")
    return text


def build_prompt_text_ids(tok, transcript: str) -> list:
    """Build the zero-shot prompt_text token ids: fixed prefix, raw
    <|endofprompt|> id, then the normalized reference transcript."""
    prefix = tok.encode(ZERO_SHOT_PREFIX, add_special_tokens=False).ids
    ref = tok.encode(normalize_text(transcript), add_special_tokens=False).ids
    return list(prefix) + [ENDOFPROMPT_ID] + list(ref)


def encode_tts_text(tok, text: str) -> list:
    """Normalize and tokenize the text to be synthesized."""
    return list(tok.encode(normalize_text(text), add_special_tokens=False).ids)
