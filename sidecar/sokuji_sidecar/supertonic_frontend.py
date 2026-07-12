"""Supertonic 3 text frontend — torch-free port of the WASM worker's
preprocessText + applyIndexer (supertonic-tts.worker.ts)."""
import re
import unicodedata

_EMOJI = re.compile(
    "[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F77F\U0001F780-\U0001F7FF\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF\U0001FA00-\U0001FA6F\U0001FA70-\U0001FAFF"
    "☀-⛿✀-➿\U0001F1E6-\U0001F1FF]+")
_REPLACE = {
    "\u2013": "-", "\u2011": "-", "\u2014": "-", "_": " ",
    "\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'",
    "\u00b4": "'", "`": "'",
    "[": " ", "]": " ", "|": " ", "/": " ", "#": " ",
    "\u2192": " ", "\u2190": " ",
}
_EXPR = {"@": " at ", "e.g.,": "for example,", "i.e.,": "that is,"}
_TERMINAL = set(".!?;:,'\")]}" + "\u2026\u3002\u300d\u300f\u3011\u3009\u300b\u203a\u00bb")


def preprocess_text(text, lang, available_langs):
    text = unicodedata.normalize("NFKD", text)
    text = _EMOJI.sub("", text)
    for k, v in _REPLACE.items():
        text = text.replace(k, v)
    text = re.sub(r"[\u2665\u2606\u2661\u00a9\\]", "", text)
    for k, v in _EXPR.items():
        text = text.replace(k, v)
    for a, b in ((" ,", ","), (" .", "."), (" !", "!"), (" ?", "?"),
                 (" ;", ";"), (" :", ":"), (" '", "'")):
        text = text.replace(a, b)
    for dup in ('""', "''", "``"):
        while dup in text:
            text = text.replace(dup, dup[0])
    text = re.sub(r"\s+", " ", text).strip()
    if not text or text[-1] not in _TERMINAL:
        text += "."
    eff = lang if lang in available_langs else None
    return f"<{eff}>{text}</{eff}>" if eff else f"<na>{text}</na>"


def apply_indexer(text, indexer):
    out = []
    for ch in text:
        c = ord(ch)
        v = indexer[c] if 0 <= c < len(indexer) else -1
        out.append(v if v is not None and v >= 0 else 0)
    return out
