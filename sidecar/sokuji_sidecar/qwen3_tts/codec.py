"""Qwen3-TTS 12 Hz neural codec encode/decode.

Faithful batch=1 port of `Tokenizer12HzOnnx` (reference
`.superpowers/qwen3-ref/run_pipeline.py`, lines 535-633). Resampling the
input waveform to the codec's expected sample rate is the caller's
responsibility (librosa); this module only runs the ONNX encode/decode
graphs and applies the reference's frame/length-trimming math.
"""

from __future__ import annotations

from typing import Any

import numpy as np


class Codec12Hz:
    """Wraps the `tokenizer12hz_encode` / `tokenizer12hz_decode` ONNX graphs.

    Batch=1 only. `sessions` is a dict with keys `tokenizer12hz_encode` and
    `tokenizer12hz_decode`, each an ONNX-Runtime-shaped session object
    exposing `get_outputs()` and `run(output_names, input_feed)`.
    """

    def __init__(
        self,
        sessions: dict[str, Any],
        *,
        num_quantizers: int = 16,
        sample_rate: int = 24000,
        encode_downsample_rate: int = 1920,
        decode_upsample_rate: int = 1920,
    ) -> None:
        self._encode_session = sessions["tokenizer12hz_encode"]
        self._decode_session = sessions["tokenizer12hz_decode"]
        self._encode_output_names = [o.name for o in self._encode_session.get_outputs()]
        self._decode_output_names = [o.name for o in self._decode_session.get_outputs()]
        self.num_quantizers = int(num_quantizers)
        self.sample_rate = int(sample_rate)
        self.encode_downsample_rate = int(encode_downsample_rate)
        self.decode_upsample_rate = int(decode_upsample_rate)

    def encode(self, wav_24k: np.ndarray) -> np.ndarray:
        """Encode a single, already-resampled waveform into codec frames.

        Reference: `Tokenizer12HzOnnx.encode` (lines 588-602), specialized to
        batch=1 (a single, unpadded waveform — the padding-mask machinery in
        the reference exists only to align variable-length batch items, so
        for one waveform the mask is simply all-ones).

        Args:
            wav_24k: float32[n] waveform at `sample_rate`.

        Returns:
            int64[frames, num_quantizers] codec codes, trimmed to
            `ceil(n / encode_downsample_rate)` frames.
        """
        wav = np.asarray(wav_24k, dtype=np.float32)
        if wav.ndim > 1:
            wav = np.mean(wav, axis=-1)

        n = int(wav.shape[0])
        input_values = wav[None, :].astype(np.float32)
        padding_mask = np.ones((1, n), dtype=np.int64)

        audio_codes, _lengths = self._encode_session.run(
            self._encode_output_names,
            {"input_values": input_values, "padding_mask": padding_mask},
        )

        length = int(np.ceil(n / float(self.encode_downsample_rate)))
        return audio_codes[0, :length, :].astype(np.int64)

    def decode(self, codes: np.ndarray) -> np.ndarray:
        """Decode codec frames back into a waveform.

        Reference: `Tokenizer12HzOnnx.decode` (lines 604-633), specialized to
        batch=1. Target length is `(codes[..., 0] > 0).sum() * decode_upsample_rate`,
        clamped to the decode graph's raw output length and further clamped
        to its reported `lengths` output when that is positive.

        Args:
            codes: int64[frames, num_quantizers] codec codes.

        Returns:
            float32[samples] waveform.
        """
        codes = np.asarray(codes, dtype=np.int64)
        if codes.ndim == 3:
            codes = codes[0]

        audio_codes = codes[None, :, :].astype(np.int64)

        audio_values, out_lengths = self._decode_session.run(
            self._decode_output_names,
            {"audio_codes": audio_codes},
        )
        out_lengths = np.asarray(out_lengths, dtype=np.int64).reshape(-1)

        target_length = int((audio_codes[..., 0] > 0).sum()) * self.decode_upsample_rate
        length = min(target_length, audio_values.shape[1])
        if out_lengths.shape[0] > 0 and out_lengths[0] > 0:
            length = min(length, int(out_lengths[0]))

        return audio_values[0, :length].astype(np.float32)


__all__ = ["Codec12Hz"]
