"""
VibeVoice-ASR Engine — Real-time speech-to-text wrapper.
Handles streaming audio input and produces structured transcriptions.
"""

import asyncio
import logging
import io
import numpy as np
import torch

logger = logging.getLogger(__name__)


class ASREngine:
    def __init__(
        self, model_name: str = "microsoft/VibeVoice-ASR", device: str = "auto"
    ):
        self.model_name = model_name
        self.device = self._resolve_device(device)
        self.model = None
        self.processor = None
        self._loaded = False

    def _resolve_device(self, device: str) -> str:
        if device != "auto":
            return device
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    async def load(self):
        """Load model asynchronously (runs blocking load in executor)."""
        if self._loaded:
            return
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._load_sync)

    def _load_sync(self):
        from vibevoice.modular.modeling_vibevoice_asr import (
            VibeVoiceASRForConditionalGeneration,
        )
        from vibevoice.processor.vibevoice_asr_processor import VibeVoiceASRProcessor

        logger.info(f"Loading VibeVoice-ASR from {self.model_name} on {self.device}...")

        dtype = torch.float16 if self.device in ("cuda", "mps") else torch.float32

        self.processor = VibeVoiceASRProcessor.from_pretrained(self.model_name)
        self.model = VibeVoiceASRForConditionalGeneration.from_pretrained(
            self.model_name,
            torch_dtype=dtype,
            trust_remote_code=True,
        )
        if self.device == "mps":
            self.model = self.model.to("mps")

        self._loaded = True
        logger.info("VibeVoice-ASR loaded successfully.")

    async def transcribe(
        self,
        audio_data: bytes,
        sample_rate: int = 16000,
        hotwords: list[str] | None = None,
    ) -> dict:
        """
        Transcribe audio bytes (PCM16 mono) to structured text.
        Returns: { segments: [{ speaker, start, end, text }], full_text: str }
        """
        if not self._loaded:
            await self.load()

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self._transcribe_sync, audio_data, sample_rate, hotwords
        )

    def _transcribe_sync(
        self, audio_data: bytes, sample_rate: int, hotwords: list[str] | None
    ) -> dict:
        audio_array = (
            np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0
        )

        # Resample to 16kHz if needed
        if sample_rate != 16000:
            import librosa

            audio_array = librosa.resample(
                audio_array, orig_sr=sample_rate, target_sr=16000
            )

        inputs = self.processor(
            audio_array,
            sampling_rate=16000,
            return_tensors="pt",
        )

        # Move inputs to device
        input_features = inputs.input_features.to(self.model.device)

        # Build generation kwargs
        gen_kwargs = {"max_new_tokens": 4096}
        if hotwords:
            gen_kwargs["hotwords"] = " ".join(hotwords)

        with torch.no_grad():
            output_ids = self.model.generate(input_features, **gen_kwargs)

        transcription = self.processor.batch_decode(
            output_ids, skip_special_tokens=True
        )[0]

        # Parse structured output if available (speaker, timestamps)
        segments = self._parse_segments(transcription)

        return {
            "segments": segments,
            "full_text": transcription,
        }

    def _parse_segments(self, text: str) -> list[dict]:
        """Parse VibeVoice-ASR structured output into segments."""
        segments = []
        # VibeVoice-ASR outputs structured format: <speaker_id> <start> <end> text
        import re

        pattern = r"<\|(\w+)\|>\s*<\|([\d.]+)\|>\s*<\|([\d.]+)\|>\s*(.+?)(?=<\||$)"
        matches = re.findall(pattern, text)

        if matches:
            for speaker, start, end, content in matches:
                segments.append(
                    {
                        "speaker": speaker,
                        "start": float(start),
                        "end": float(end),
                        "text": content.strip(),
                    }
                )
        else:
            # Fallback: treat entire text as single segment
            segments.append(
                {
                    "speaker": "Speaker_0",
                    "start": 0.0,
                    "end": 0.0,
                    "text": text.strip(),
                }
            )

        return segments
