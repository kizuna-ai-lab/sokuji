"""GPT-SoVITS synthesis loop (t2s encoder/decoders + VITS vocoder).

Ported from genie_tts Core/Inference.py (GENIE.tts + GENIE.t2s_cpu) (MIT, see
LICENSE). SOKUJI changes: sessions, sv_session and roberta are explicit
constructor parameters (no globals, no per-character LRU model cache);
prompt phonemes/bert are recomputed per call instead of cached on the
reference object (see synthesize() below); two degenerate-generation guards
return None instead of letting the vocoder replay the reference audio
(spike-documented upstream hazards); self.stop_event is dropped (the sidecar
engine is synchronous, no cross-thread cancellation).
"""
from __future__ import annotations

import numpy as np

from .text import get_phones_and_bert

MAX_AR_STEPS = 500
EOS_TOKEN = 1024


class Synthesizer:
    def __init__(self, sessions: dict, sv_session=None, roberta=None):
        self._encoder = sessions["t2s_encoder_fp32.onnx"]
        self._first_stage = sessions["t2s_first_stage_decoder_fp32.onnx"]
        self._stage = sessions["t2s_stage_decoder_fp32.onnx"]
        self._vocoder = sessions["vits_fp32.onnx"]
        self._prompt_encoder = sessions.get("prompt_encoder_fp32.onnx")
        self._sv = sv_session
        self._roberta = roberta

    # -- guards (unit-tested separately) --------------------------------
    @staticmethod
    def _slice_generated(y: np.ndarray, idx: int):
        if idx <= 0:
            # AR stopped on the very first step; y[:, -0:] would return the
            # WHOLE sequence including prompt tokens (reference replay bug).
            return None
        return np.expand_dims(y[:, -idx:], axis=0)

    @staticmethod
    def _trim_at_eos(semantic_tokens: np.ndarray):
        eos = np.where(semantic_tokens >= EOS_TOKEN)
        if len(eos[0]) > 0:
            first = eos[-1][0]
            semantic_tokens = semantic_tokens[..., :first]
        if semantic_tokens.size == 0:
            return None
        return semantic_tokens

    # -- AR loop (Inference.py:t2s_cpu) ----------------------------------
    def _t2s(self, ref_seq, ref_bert, text_seq, text_bert, ssl_content):
        # Inference.py:76-85 - encoder feed names are literal (fixed graph
        # signature).
        x, prompts = self._encoder.run(None, {
            "ref_seq": ref_seq,
            "text_seq": text_seq,
            "ref_bert": ref_bert,
            "text_bert": text_bert,
            "ssl_content": ssl_content,
        })

        # Inference.py:88-90
        y, y_emb, *present_key_values = self._first_stage.run(
            None, {"x": x, "prompts": prompts})

        # Inference.py:93-106 - stage decoder's KV-cache tuple grows/shifts
        # across steps, so (like upstream) input names are read from the
        # session rather than hardcoded.
        input_names = [inp.name for inp in self._stage.get_inputs()]
        idx = 0
        for idx in range(0, MAX_AR_STEPS):
            input_feed = {
                name: data
                for name, data in zip(input_names, [y, y_emb, *present_key_values])
            }
            outputs = self._stage.run(None, input_feed)
            y, y_emb, stop_condition_tensor, *present_key_values = outputs

            if stop_condition_tensor:
                break

        y[0, -1] = 0
        return self._slice_generated(y, idx)

    def synthesize(self, text: str, ref, language: str):
        # Inference.py:27 - prepend '。' to stop the model from dropping the
        # first sentence.
        text = '。' + text
        text_seq, text_bert = get_phones_and_bert(
            text, language, roberta=self._roberta)

        # Upstream computes the prompt's phonemes/bert once, when the
        # ReferenceAudio is constructed (ReferenceAudio.py:36, set_text),
        # and reuses it across every .tts() call sharing that cached
        # instance. SOKUJI's build_reference() doesn't take a roberta
        # session (it only needs the hubert one - see reference.py), so the
        # equivalent G2P call is made here instead, once per synthesize()
        # call, using the Synthesizer's own roberta session.
        ref_seq, ref_bert = get_phones_and_bert(
            ref.prompt_text, ref.prompt_language, roberta=self._roberta)

        semantic_tokens = self._t2s(
            ref_seq=ref_seq,
            ref_bert=ref_bert,
            text_seq=text_seq,
            text_bert=text_bert,
            ssl_content=ref.ssl_content,
        )
        if semantic_tokens is None:
            return None

        # Inference.py:41-44
        semantic_tokens = self._trim_at_eos(semantic_tokens)
        if semantic_tokens is None:
            return None

        if self._prompt_encoder is None:
            # Inference.py:46-51 - plain v2 vocoder feed.
            audio = self._vocoder.run(None, {
                "text_seq": text_seq,
                "pred_semantic": semantic_tokens,
                "ref_audio": ref.audio_32k,
            })[0]
        else:
            # Inference.py:52-61 + ReferenceAudio.py:68-76 (update_global_emb)
            # - v2ProPlus branch: speaker-verification embedding feeds the
            # prompt encoder, whose outputs feed the vocoder instead of the
            # raw reference audio. SOKUJI recomputes this every call rather
            # than caching it on the Reference (the LRU cache that made that
            # caching worthwhile upstream is dropped - see module docstring).
            sv_emb = self._sv.run(None, {"waveform": ref.audio_16k})[0]
            global_emb, global_emb_advanced = self._prompt_encoder.run(None, {
                "ref_audio": ref.audio_32k,
                "sv_emb": sv_emb,
            })
            audio = self._vocoder.run(None, {
                "text_seq": text_seq,
                "pred_semantic": semantic_tokens,
                "ge": global_emb,
                "ge_advanced": global_emb_advanced,
            })[0]

        return np.asarray(audio, dtype=np.float32).reshape(-1)
