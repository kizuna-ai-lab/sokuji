"""Explicit asset-path configuration for the vendored GPT-SoVITS runtime.

Replaces upstream genie_tts.Core.Resources, which resolved paths from env vars
at import time (and blocked on stdin if they were missing). Here the backend
calls configure() with directories inside the downloaded HF snapshot before
any G2P module is imported.
"""
from __future__ import annotations

_chinese_g2p_dir: str | None = None
_english_g2p_dir: str | None = None


def configure(chinese_g2p_dir: str, english_g2p_dir: str) -> None:
    global _chinese_g2p_dir, _english_g2p_dir
    _chinese_g2p_dir = chinese_g2p_dir
    _english_g2p_dir = english_g2p_dir


def _require(value: str | None, name: str) -> str:
    if value is None:
        raise RuntimeError(
            f"gpt_sovits.assets.{name} used before configure() — the backend "
            "must call configure() with the snapshot's G2P dirs first")
    return value


def chinese_g2p_dir() -> str:
    return _require(_chinese_g2p_dir, "chinese_g2p_dir")


def english_g2p_dir() -> str:
    return _require(_english_g2p_dir, "english_g2p_dir")
