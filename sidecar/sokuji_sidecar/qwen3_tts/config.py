import json
from pathlib import Path
from types import SimpleNamespace
from typing import Optional


def _lower_key_dict(src: Optional[dict]) -> dict:
    """Convert all keys in dictionary to lowercase strings."""
    if not src:
        return {}
    return {str(k).lower(): v for k, v in src.items()}


def load_model_config(model_path):
    """
    Load Qwen3-TTS model configuration.

    Args:
        model_path: Either a file path to config.json or a directory containing config.json

    Returns:
        SimpleNamespace with configuration fields
    """
    path = Path(model_path)

    # Handle file-or-dir logic: if it's a file, use it; otherwise append config.json
    if path.is_file():
        config_path = path
    else:
        config_path = path / "config.json"

    if not config_path.exists():
        raise FileNotFoundError(f"config.json not found: {config_path}")

    raw = json.loads(config_path.read_text(encoding="utf-8"))

    # Process talker_config with lowercase keys for nested dictionaries
    talker_raw = dict(raw.get("talker_config", {}))
    talker_raw["codec_language_id"] = _lower_key_dict(talker_raw.get("codec_language_id"))
    talker_raw["spk_id"] = _lower_key_dict(talker_raw.get("spk_id"))
    talker_raw["spk_is_dialect"] = _lower_key_dict(talker_raw.get("spk_is_dialect"))

    # Process speaker_encoder_config with defaults
    spk_raw = raw.get("speaker_encoder_config", {})
    speaker_cfg = SimpleNamespace(
        sample_rate=int(spk_raw.get("sample_rate", 24000)),
        n_fft=int(spk_raw.get("n_fft", 1024)) if spk_raw.get("n_fft") is not None else 1024,
        hop_size=int(spk_raw.get("hop_size", 256)) if spk_raw.get("hop_size") is not None else 256,
        win_size=int(spk_raw.get("win_size", 1024)) if spk_raw.get("win_size") is not None else 1024,
        num_mels=int(spk_raw.get("num_mels", 128)) if spk_raw.get("num_mels") is not None else 128,
        fmin=float(spk_raw.get("fmin", 0)) if spk_raw.get("fmin") is not None else 0.0,
        fmax=float(spk_raw.get("fmax", 12000)) if spk_raw.get("fmax") is not None else 12000.0,
    )

    return SimpleNamespace(
        tts_model_type=str(raw.get("tts_model_type", "")),
        tts_model_size=str(raw.get("tts_model_size", "")),
        tokenizer_type=str(raw.get("tokenizer_type", "")),
        tts_bos_token_id=int(raw.get("tts_bos_token_id", 0)),
        tts_eos_token_id=int(raw.get("tts_eos_token_id", 0)),
        tts_pad_token_id=int(raw.get("tts_pad_token_id", 0)),
        assistant_token_id=raw.get("assistant_token_id"),
        im_start_token_id=raw.get("im_start_token_id"),
        im_end_token_id=raw.get("im_end_token_id"),
        talker=SimpleNamespace(**talker_raw),
        speaker_encoder=speaker_cfg,
    )
