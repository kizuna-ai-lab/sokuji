"""Qwen3-TTS prompt templates and language mapping."""

from __future__ import annotations

from typing import Any, Optional

import numpy as np


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


def build_talker_inputs(
    cfg: Any,
    emb: Any,
    input_ids: np.ndarray,
    ref_ids: Optional[Any],
    voice_clone_prompt: Optional[dict],
    language_name: Optional[str],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Build the talker's prompt embeddings, attention mask, and trailing-text
    hidden states used to seed autoregressive codec generation.

    Faithful batch=1 port of `build_talker_inputs_np`
    (`.superpowers/qwen3-ref/run_pipeline.py`, lines 679-862) specialized for
    the Base model: `non_streaming_mode=False`, `speakers=None`,
    `instruct_ids=None`. The speaker-preset lookup, the Chinese-dialect
    remap, and the instruct-prefix block are dropped along with those
    parameters; the no-voice branch and the ICL (voice-cloning) branch are
    kept intact.

    Args:
        cfg: Model config namespace from `config.load_model_config` (reads
            `cfg.talker.*` and `cfg.tts_{bos,eos,pad}_token_id`).
        emb: Object exposing `text_project(ids)`, `codec_embed(ids)`, and
            `code_predictor_embed(ids, step)` (see `runtime.Embeddings`).
        input_ids: int64[1, N] talker prompt token ids — role tokens (3),
            text tokens, then trailing/closing tokens, per the reference
            layout.
        ref_ids: Optional single-item container `[int64[1, M]]` (or `None`)
            of reference-text ids, required when `voice_clone_prompt` is in
            ICL mode.
        voice_clone_prompt: Optional dict with single-item lists
            `ref_code`, `ref_spk_embedding`, `x_vector_only_mode`,
            `icl_mode` (index 0 is this batch item), or `None` for no voice
            cloning.
        language_name: Full language name (e.g. "english"), or `None` for
            the language-less ("nothink") codec prefill.

    Returns:
        (padded, attention_mask, trailing_text_hidden, tts_pad_embed):
        `padded` is float32[1, T, H], `attention_mask` is int64[1, T] (all
        ones — batch=1 has nothing to pad against), `trailing_text_hidden`
        is float32[1, Ttrail, H], `tts_pad_embed` is float32[1, 1, H].

    Raises:
        ValueError: `voice_clone_prompt` requests ICL mode but `ref_ids` (or
            its single item) is `None`.
    """

    def text_project(ids: np.ndarray) -> np.ndarray:
        return emb.text_project(ids.astype(np.int64))

    def codec_embed(ids: np.ndarray) -> np.ndarray:
        return emb.codec_embed(ids.astype(np.int64)).astype(np.float32)

    def code_predictor_embed(idx: int, ids: np.ndarray) -> np.ndarray:
        return emb.code_predictor_embed(ids.astype(np.int64), idx).astype(np.float32)

    def generate_icl_prompt(text_id, ref_id, ref_code, tts_pad_embed, tts_eos_embed):
        text_embed = text_project(np.concatenate([ref_id, text_id], axis=-1))
        text_embed = np.concatenate([text_embed, tts_eos_embed], axis=1)

        codec_embed_parts = []
        for i in range(cfg.talker.num_code_groups):
            if i == 0:
                codec_embed_parts.append(codec_embed(ref_code[:, :1]))
            else:
                codec_embed_parts.append(code_predictor_embed(i - 1, ref_code[:, i : i + 1]))
        codec_embed_sum = np.concatenate(codec_embed_parts, axis=1)
        codec_embed_sum = codec_embed_sum.sum(axis=1)
        codec_embed_sum = codec_embed_sum[None, :, :]
        codec_embed_sum = np.concatenate(
            [codec_embed(np.array([[cfg.talker.codec_bos_id]], dtype=np.int64)), codec_embed_sum], axis=1
        )

        text_lens = text_embed.shape[1]
        codec_lens = codec_embed_sum.shape[1]

        if text_lens > codec_lens:
            return text_embed[:, :codec_lens] + codec_embed_sum, text_embed[:, codec_lens:]

        pad_count = codec_lens - text_lens
        if pad_count > 0:
            pad_block = np.repeat(tts_pad_embed, pad_count, axis=1)
        else:
            pad_block = np.empty((1, 0, tts_pad_embed.shape[-1]), dtype=np.float32)
        text_embed = np.concatenate([text_embed, pad_block], axis=1)
        return text_embed + codec_embed_sum, tts_pad_embed

    if voice_clone_prompt is None:
        speaker_embed = None
    else:
        if voice_clone_prompt["x_vector_only_mode"][0] or voice_clone_prompt["icl_mode"][0]:
            spk = voice_clone_prompt["ref_spk_embedding"][0].astype(np.float32)
            speaker_embed = spk.reshape(1, 1, -1)
        else:
            speaker_embed = None

    if language_name is None:
        language_id = None
    else:
        language_id = cfg.talker.codec_language_id[language_name.lower()]

    tts_ids = np.array(
        [[cfg.tts_bos_token_id, cfg.tts_eos_token_id, cfg.tts_pad_token_id]],
        dtype=np.int64,
    )
    tts_bos_embed, tts_eos_embed, tts_pad_embed = np.split(text_project(tts_ids), 3, axis=1)

    if language_id is None:
        codec_prefill = [[
            cfg.talker.codec_nothink_id,
            cfg.talker.codec_think_bos_id,
            cfg.talker.codec_think_eos_id,
        ]]
    else:
        codec_prefill = [[
            cfg.talker.codec_think_id,
            cfg.talker.codec_think_bos_id,
            language_id,
            cfg.talker.codec_think_eos_id,
        ]]

    codec_input_embedding_0 = codec_embed(np.array(codec_prefill, dtype=np.int64))
    codec_input_embedding_1 = codec_embed(
        np.array([[cfg.talker.codec_pad_id, cfg.talker.codec_bos_id]], dtype=np.int64)
    )
    if speaker_embed is None:
        codec_input_embedding = np.concatenate([codec_input_embedding_0, codec_input_embedding_1], axis=1)
    else:
        codec_input_embedding = np.concatenate(
            [codec_input_embedding_0, speaker_embed, codec_input_embedding_1], axis=1
        )

    role_embed = text_project(input_ids[:, :3])
    pad_repeat = codec_input_embedding.shape[1] - 2
    pad_block = np.repeat(tts_pad_embed, pad_repeat, axis=1)
    talker_embed = np.concatenate([pad_block, tts_bos_embed], axis=1) + codec_input_embedding[:, :-1]
    talker_input_embed = np.concatenate([role_embed, talker_embed], axis=1)

    icl_mode = (
        voice_clone_prompt is not None
        and voice_clone_prompt["ref_code"][0] is not None
        and voice_clone_prompt["icl_mode"][0]
    )
    if icl_mode:
        if ref_ids is None or ref_ids[0] is None:
            raise ValueError("ref_text is required for ICL mode when passing voice_clone_prompt.")
        icl_input_embed, trailing_text_hidden = generate_icl_prompt(
            text_id=input_ids[:, 3:-5],
            ref_id=ref_ids[0][:, 3:-2],
            ref_code=voice_clone_prompt["ref_code"][0],
            tts_pad_embed=tts_pad_embed,
            tts_eos_embed=tts_eos_embed,
        )
        talker_input_embed = np.concatenate([talker_input_embed, icl_input_embed], axis=1)
    else:
        tts_text_first = text_project(input_ids[:, 3:4]) + codec_input_embedding[:, -1:]
        talker_input_embed = np.concatenate([talker_input_embed, tts_text_first], axis=1)
        trailing_text_hidden = np.concatenate([text_project(input_ids[:, 4:-5]), tts_eos_embed], axis=1)

    # Batch=1 collapse of the reference's per-batch padding loops: a single
    # sequence has nothing to pad against, so the mask is all ones and the
    # "padded" output is just the sequence with its leading batch dim.
    seq = talker_input_embed.astype(np.float32)
    attention_mask = np.ones((1, seq.shape[1]), dtype=np.int64)
    trailing_text_hidden = trailing_text_hidden.astype(np.float32)
    tts_pad_embed = tts_pad_embed.astype(np.float32)

    return seq, attention_mask, trailing_text_hidden, tts_pad_embed
