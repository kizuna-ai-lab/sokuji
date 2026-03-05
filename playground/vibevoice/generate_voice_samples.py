import asyncio
import gc
import json
import wave
from pathlib import Path

import numpy as np
import torch

from tts_engine import TTSEngine

OUT_DIR = Path(__file__).parent / "generated_audio" / "complete_voice_samples"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def write_wav(path: Path, audio: np.ndarray, sr: int = 24000) -> None:
    # Pylint can mis-infer wave.open(..., "wb") as Wave_read; methods below are valid for Wave_write.
    # pylint: disable=no-member
    pcm16 = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm16.tobytes())


async def main() -> None:
    engine = TTSEngine(device="auto", inference_steps=5)
    await engine.load()
    voices = engine.list_voices()
    results: list[dict] = []

    for i, voice in enumerate(voices, 1):
        text = f"Voice sample for {voice}."
        try:
            filename = f"{i:02d}_{voice}.wav"
            out_path = OUT_DIR / filename

            if out_path.exists():
                print(f"[{i}/{len(voices)}] SKIP {voice} -> {filename} (already exists)")
                results.append(
                    {
                        "voice": voice,
                        "ok": True,
                        "file": filename,
                        "duration_sec": None,
                        "skipped_existing": True,
                    }
                )
                continue

            chunks = [c for c in engine.stream(text=text, voice_key=voice, cfg_scale=1.5)]
            if not chunks:
                raise RuntimeError("No audio generated")
            audio = np.concatenate(chunks).astype(np.float32, copy=False)
            write_wav(out_path, audio, sr=engine.sample_rate)
            print(f"[{i}/{len(voices)}] OK  {voice} -> {filename}")
            results.append(
                {
                    "voice": voice,
                    "ok": True,
                    "file": filename,
                    "duration_sec": round(float(audio.size / engine.sample_rate), 3),
                }
            )
            del chunks
            del audio
        except Exception as exc:  # pylint: disable=broad-exception-caught
            print(f"[{i}/{len(voices)}] ERR {voice} -> {exc}")
            results.append({"voice": voice, "ok": False, "error": str(exc)})
        finally:
            gc.collect()
            if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
                torch.mps.empty_cache()

    manifest = OUT_DIR / "manifest.json"
    manifest.write_text(json.dumps(results, indent=2), encoding="utf-8")
    ok_count = sum(1 for r in results if r.get("ok"))
    print(f"DONE: {ok_count}/{len(results)} succeeded")
    print(f"OUTPUT_DIR: {OUT_DIR}")
    print(f"MANIFEST: {manifest}")


if __name__ == "__main__":
    asyncio.run(main())
