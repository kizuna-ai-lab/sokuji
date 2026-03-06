"""
VibeVoice-Realtime TTS Engine — Real-time streaming text-to-speech.
Uses VibeVoice's native API (VibeVoiceStreamingProcessor + Inference model).
Requires: pip install -e ".[streamingtts]" from cloned VibeVoice repo.
"""

import asyncio
import copy
import json
import logging
import re
import shutil
import threading
from pathlib import Path
from typing import Any, Iterator, Optional, cast

import numpy as np
import torch

logger = logging.getLogger("tts_engine")

SAMPLE_RATE = 24_000


class TTSEngine:
    def __init__(
        self,
        model_name: str = "microsoft/VibeVoice-Realtime-0.5B",
        device: str = "auto",
        inference_steps: int = 5,
        voices_dir: Optional[str] = None,
    ):
        self.model_name = model_name
        self.device = self._resolve_device(device)
        self.inference_steps = inference_steps
        self.sample_rate = SAMPLE_RATE
        self._loaded = False

        self.processor: Any = None
        self.model: Any = None
        self.voice_presets: dict[str, Path] = {}
        self.default_voice_key: Optional[str] = None
        self._voice_cache: dict[str, dict[str, Any]] = {}

        # Where to look for voice .pt files
        self._voices_dir = voices_dir

    def _resolve_device(self, device: str) -> str:
        if device not in ("auto", "mpx"):
            return device
        if device == "mpx":
            device = "mps"
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    async def load(self):
        if self._loaded:
            return
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._load_sync)

    def _load_sync(self):
        from vibevoice.modular.modeling_vibevoice_streaming_inference import (
            VibeVoiceStreamingForConditionalGenerationInference,
        )
        from vibevoice.processor.vibevoice_streaming_processor import (
            VibeVoiceStreamingProcessor,
        )

        logger.info(
            "Loading VibeVoice-Realtime from %s on %s...",
            self.model_name,
            self.device,
        )

        self.processor = VibeVoiceStreamingProcessor.from_pretrained(self.model_name)

        if self.device == "mps":
            load_dtype = torch.float32
            device_map = None
            attn_impl = "sdpa"
        elif self.device == "cuda":
            load_dtype = torch.bfloat16
            device_map = "cuda"
            attn_impl = "flash_attention_2"
        else:
            load_dtype = torch.float32
            device_map = "cpu"
            attn_impl = "sdpa"

        logger.info("dtype=%s, attn=%s, device_map=%s", load_dtype, attn_impl, device_map)

        try:
            self.model = (
                VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                    self.model_name,
                    torch_dtype=load_dtype,
                    device_map=device_map,
                    attn_implementation=attn_impl,
                )
            )
            if self.device == "mps":
                cast(Any, self.model).to("mps")
        except Exception as e:  # pylint: disable=broad-exception-caught
            if attn_impl == "flash_attention_2":
                logger.warning("flash_attention_2 failed (%s), falling back to sdpa", e)
                self.model = (
                    VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                        self.model_name,
                        torch_dtype=load_dtype,
                        device_map=device_map or self.device,
                        attn_implementation="sdpa",
                    )
                )
                if self.device == "mps":
                    cast(Any, self.model).to("mps")
            else:
                raise

        self.model.eval()
        scheduler = self.model.model.noise_scheduler.from_config(
            self.model.model.noise_scheduler.config,
            algorithm_type="sde-dpmsolver++",
            beta_schedule="squaredcos_cap_v2",
        )
        if isinstance(scheduler, tuple):
            scheduler = scheduler[0]
        self.model.model.noise_scheduler = cast(Any, scheduler)
        self.model.set_ddpm_inference_steps(num_steps=self.inference_steps)

        # Force the scheduler to use configured steps
        if hasattr(self.model.model.noise_scheduler, "set_timesteps"):
            self.model.model.noise_scheduler.set_timesteps(self.inference_steps)

        self._load_voice_presets()
        self._loaded = True
        logger.info(
            "VibeVoice-Realtime loaded. %s voice presets available.",
            len(self.voice_presets),
        )

    def _load_voice_presets(self):
        """Scan for .pt voice preset files."""
        search_dirs = []
        if self._voices_dir:
            search_dirs.append(Path(self._voices_dir))
        # Look in the cloned VibeVoice repo's demo voices
        repo_voices = (
            Path(__file__).parent
            / "vibevoice-repo"
            / "demo"
            / "voices"
            / "streaming_model"
        )
        search_dirs.append(repo_voices)
        # Also look in a local voices/ dir
        search_dirs.append(Path(__file__).parent / "voices")

        for voices_dir in search_dirs:
            if voices_dir.exists():
                for pt_path in voices_dir.rglob("*.pt"):
                    self.voice_presets[pt_path.stem] = pt_path

        if self.voice_presets:
            self.voice_presets = dict(sorted(self.voice_presets.items()))
            self.default_voice_key = (
                "en-Carter_man"
                if "en-Carter_man" in self.voice_presets
                else next(iter(self.voice_presets))
            )
            self._ensure_voice_cached(self.default_voice_key)
            logger.info("Voice presets: %s", ", ".join(self.voice_presets.keys()))
        else:
            logger.warning(
                "No voice presets (.pt) found. TTS will not work without voice presets."
            )

    def _ensure_voice_cached(self, key: str) -> dict[str, Any]:
        if key not in self._voice_cache:
            pt_path = self.voice_presets[key]
            device = torch.device(self.device)
            self._voice_cache[key] = cast(
                dict[str, Any],
                torch.load(
                pt_path, map_location=device, weights_only=False
                ),
            )
        return self._voice_cache[key]

    def list_voices(self) -> list[str]:
        return sorted(self.voice_presets.keys())

    def refresh_voices(self):
        """Refresh internal voice registry from disk."""
        self._load_voice_presets()

    def import_voice_preset(self, source_file: Path, new_key: str) -> tuple[str, Path]:
        """Import a .pt voice preset file into the local custom clone directory."""
        normalized_key = re.sub(r"[^a-zA-Z0-9._-]+", "_", new_key.strip()).strip("_")
        if not normalized_key:
            raise ValueError("New voice name is empty after normalization")

        if normalized_key in self.voice_presets:
            raise ValueError(f"Voice preset already exists: {normalized_key}")

        source_path = Path(source_file)
        if not source_path.exists() or source_path.suffix.lower() != ".pt":
            raise ValueError("Voice preset file must be an existing .pt file")

        clones_dir = Path(__file__).parent / "voices" / "custom_clones"
        clones_dir.mkdir(parents=True, exist_ok=True)
        destination = clones_dir / f"{normalized_key}.pt"
        if destination.exists():
            raise ValueError(f"Voice preset file already exists: {destination.name}")

        shutil.copy2(source_path, destination)
        self.refresh_voices()
        return normalized_key, destination

    def clone_voice_from_audio_reference(
        self,
        audio_path: Path,
        new_key: str,
        source_key: Optional[str] = None,
    ) -> tuple[str, Path, str]:
        """
        Clone using an uploaded audio reference.

        VibeVoice-Realtime currently requires embedded cached voice prompts for low-latency safety.
        This fallback clones an existing preset and stores reference metadata for future conversion.
        """
        source = source_key or self.default_voice_key
        if not source:
            raise ValueError("No source voice available for fallback cloning")

        cloned_key, destination = self.clone_voice(source_key=source, new_key=new_key)
        metadata_path = destination.with_suffix(".reference.json")
        metadata = {
            "mode": "audio-reference-fallback",
            "source_voice": source,
            "reference_audio": str(audio_path),
        }
        metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        warning = (
            "Realtime audio-to-voice embedding is not available in this model. "
            f"Created '{cloned_key}' from fallback source '{source}' and attached reference metadata."
        )
        return cloned_key, destination, warning

    def clone_voice(self, source_key: str, new_key: str) -> tuple[str, Path]:
        """
        Clone an existing voice preset to a new key by copying its .pt preset file.
        Returns (new_voice_key, destination_path).
        """
        if source_key not in self.voice_presets:
            raise ValueError(f"Unknown source voice preset: {source_key}")

        normalized_key = re.sub(r"[^a-zA-Z0-9._-]+", "_", new_key.strip()).strip("_")
        if not normalized_key:
            raise ValueError("New voice name is empty after normalization")

        if normalized_key in self.voice_presets:
            raise ValueError(f"Voice preset already exists: {normalized_key}")

        clones_dir = Path(__file__).parent / "voices" / "custom_clones"
        clones_dir.mkdir(parents=True, exist_ok=True)

        source_path = self.voice_presets[source_key]
        destination = clones_dir / f"{normalized_key}.pt"

        if destination.exists():
            raise ValueError(f"Voice preset file already exists: {destination.name}")

        shutil.copy2(source_path, destination)

        # Refresh voice registry so cloned voices become immediately selectable.
        self._load_voice_presets()
        return normalized_key, destination

    def stream(
        self,
        text: str,
        voice_key: Optional[str] = None,
        cfg_scale: float = 1.5,
        do_sample: bool = False,
        temperature: float = 0.9,
        top_p: float = 0.9,
        stop_event: Optional[threading.Event] = None,
    ) -> Iterator[np.ndarray]:
        """Yield float32 audio chunks (24kHz) as they are generated."""
        from vibevoice.modular.streamer import AudioStreamer

        if not text.strip() or not self.voice_presets:
            return

        if self.processor is None or self.model is None:
            raise RuntimeError("TTS engine is not loaded")

        text = text.replace("\u2019", "'")
        key = (
            voice_key
            if voice_key and voice_key in self.voice_presets
            else self.default_voice_key
        )
        if key is None:
            raise RuntimeError("No default voice is available")

        processor = cast(Any, self.processor)
        model = cast(Any, self.model)
        prefilled = self._ensure_voice_cached(key)

        inputs = processor.process_input_with_cached_prompt(
            text=text.strip(),
            cached_prompt=prefilled,
            padding=True,
            return_tensors="pt",
            return_attention_mask=True,
        )
        device = torch.device(self.device)
        inputs = {k: v.to(device) if hasattr(v, "to") else v for k, v in inputs.items()}

        audio_streamer = AudioStreamer(batch_size=1, stop_signal=None, timeout=None)
        errors: list = []
        stop_signal = stop_event or threading.Event()

        def _generate():
            try:
                model.generate(
                    **inputs,
                    max_new_tokens=None,
                    cfg_scale=cfg_scale,
                    tokenizer=processor.tokenizer,
                    generation_config=cast(Any, {
                        "do_sample": do_sample,
                        "temperature": temperature if do_sample else 1.0,
                        "top_p": top_p if do_sample else 1.0,
                    }),
                    audio_streamer=audio_streamer,
                    stop_check_fn=stop_signal.is_set,
                    verbose=False,
                    refresh_negative=True,
                    all_prefilled_outputs=copy.deepcopy(prefilled),
                )
            except Exception as exc:  # pylint: disable=broad-exception-caught
                errors.append(exc)
                audio_streamer.end()

        thread = threading.Thread(target=_generate, daemon=True)
        thread.start()

        try:
            for chunk in audio_streamer.get_stream(0):
                if torch.is_tensor(chunk):
                    chunk = chunk.detach().cpu().to(torch.float32).numpy()
                else:
                    chunk = np.asarray(chunk, dtype=np.float32)
                if chunk.ndim > 1:
                    chunk = chunk.reshape(-1)
                peak = np.max(np.abs(chunk)) if chunk.size else 0.0
                if peak > 1.0:
                    chunk = chunk / peak
                yield chunk.astype(np.float32, copy=False)
        finally:
            stop_signal.set()
            audio_streamer.end()
            thread.join()
            if errors:
                raise errors[0]

    @staticmethod
    def chunk_to_pcm16(chunk: np.ndarray) -> bytes:
        chunk = np.clip(chunk, -1.0, 1.0)
        return (chunk * 32767.0).astype(np.int16).tobytes()
