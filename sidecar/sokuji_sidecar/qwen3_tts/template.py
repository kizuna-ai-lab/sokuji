"""Qwen3-TTS prompt templates and language mapping."""


def build_assistant_text(text: str) -> str:
    """Build assistant prompt text with opening."""
    return f"<|im_start|>assistant\n{text}<|im_end|>\n<|im_start|>assistant\n"


def build_ref_text(text: str) -> str:
    """Build reference text prompt."""
    return f"<|im_start|>assistant\n{text}<|im_end|>\n"


# Language code to language name mapping
_LANGUAGE_MAP = {
    "zh": "chinese",
    "en": "english",
    "ja": "japanese",
    "ko": "korean",
    "de": "german",
    "fr": "french",
    "ru": "russian",
    "pt": "portuguese",
    "es": "spanish",
    "it": "italian",
}


def language_name(short: str) -> str | None:
    """
    Convert BCP47 language code to language name.

    Args:
        short: Language code (e.g., "en", "ja", "ja-JP")

    Returns:
        Language name (e.g., "english", "japanese") or None if not found/empty
    """
    if not short:
        return None

    # Extract base language code (before any dash)
    base_code = short.split("-")[0].lower()
    return _LANGUAGE_MAP.get(base_code)
