"""
Echo Playground Server
Real-time TTS (+ optional ASR) via WebSocket and REST API.
Uses VibeVoice's native streaming inference.
"""

import argparse
import asyncio
import io
import json
import logging
import os
import re
import sys
import threading
import warnings
import wave
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, cast

os.environ["TOKENIZERS_PARALLELISM"] = "false"

_old_stderr = sys.stderr
sys.stderr = io.StringIO()

import numpy as np
import uvicorn
from fastapi import FastAPI, Request, WebSocket
from fastapi import File, Form, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.responses import FileResponse
from starlette.websockets import WebSocketDisconnect, WebSocketState
from pydantic import BaseModel

sys.stderr = _old_stderr

logging.getLogger("transformers").setLevel(logging.ERROR)
logging.getLogger("vibevoice").setLevel(logging.ERROR)
logging.getLogger("vibevoice.processor").setLevel(logging.ERROR)
logging.getLogger("vibevoice.modular").setLevel(logging.ERROR)

warnings.filterwarnings("ignore")

from humor_skill_agent import HumorSkillAgent
from tts_engine import TTSEngine

logging.basicConfig(
    level=logging.INFO, format="[%(asctime)s] %(name)s %(levelname)s: %(message)s"
)
logger = logging.getLogger("vibevoice-server")

LANGUAGE_ALIASES = {
    "jp": "ja",
    "kr": "ko",
    "sp": "es",
    "tl": "fil",
    "filipino": "fil",
    "tagalog": "fil",
    "taglish": "fil",
}


def normalize_language(language: str | None) -> str:
    raw_lang = (language or "auto").strip().lower()
    if not raw_lang or raw_lang == "auto":
        return "en"
    return LANGUAGE_ALIASES.get(raw_lang, raw_lang[:2])


def load_native_language_hints() -> dict[str, dict[str, str]]:
    hints_path = Path(__file__).parent / "native_language_hints.json"
    if not hints_path.exists():
        return {}

    try:
        loaded = json.loads(hints_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            return cast(dict[str, dict[str, str]], loaded)
    except Exception as exc:  # pylint: disable=broad-exception-caught
        logger.warning("Failed to load native language hints: %s", exc)
    return {}


@asynccontextmanager
async def lifespan(_app: FastAPI):

    loading_thread = None
    loading_stop = None
    startup_locale = humor_agent.resolve_locale(RUNTIME_CONFIG["loading_locale"], "")

    if RUNTIME_CONFIG["loading_humor"]:
        loading_stop = threading.Event()
        loading_thread = threading.Thread(
            target=_run_loading_companion,
            args=(loading_stop, startup_locale),
            daemon=True,
        )
        loading_thread.start()

    try:
        old_stderr = sys.stderr
        old_stdout = sys.stdout
        sys.stderr = io.StringIO()
        sys.stdout = io.StringIO()

        tts_engine = TTSEngine(device=RUNTIME_CONFIG["device"])
        logger.info("Loading TTS engine...")
        await tts_engine.load()
        ENGINE_STATE["tts"] = tts_engine

        if RUNTIME_CONFIG["enable_asr"]:
            from asr_engine import ASREngine

            asr_engine = ASREngine(device=RUNTIME_CONFIG["device"])
            logger.info("Loading ASR engine...")
            await asr_engine.load()
            ENGINE_STATE["asr"] = asr_engine

        sys.stderr = old_stderr
        sys.stdout = old_stdout
    finally:
        if loading_stop is not None:
            loading_stop.set()
        if loading_thread is not None:
            loading_thread.join(timeout=1.0)

    logger.info("Server ready.")
    yield


app = FastAPI(title="Echo Playground", version="0.2.0", lifespan=lifespan)

# Global engine instances
ENGINE_STATE: dict[str, Any] = {"tts": None, "asr": None}

# Config
RUNTIME_CONFIG = {
    "enable_asr": False,
    "device": "auto",
    "loading_humor": True,
    "loading_personality": "playful",
    "loading_locale": "auto",
}
humor_agent = HumorSkillAgent()
NATIVE_LANGUAGE_HINTS = load_native_language_hints()


class VoiceCloneRequest(BaseModel):
    source_voice: str
    new_voice: str


class TTSSaveRequest(BaseModel):
    text: str
    voice: str | None = None
    cfg: float = 1.5
    save_name: str | None = None
    dialogue_mode: bool = False
    speaker_a_voice: str | None = None
    speaker_b_voice: str | None = None
    speaker_c_voice: str | None = None
    speaker_d_voice: str | None = None
    speaker_pause_ms: int = 120
    nuance_style: str = "neutral"
    language: str = "auto"


def _run_loading_companion(stop_event: threading.Event, locale: str):
    """Emit periodic startup lines from the separate humor skill agent."""
    while not stop_event.wait(2.8):
        message = humor_agent.next_loading_message(
            personality=RUNTIME_CONFIG["loading_personality"],
            locale=locale,
        )
        logger.info(
            "[LoadingAgent/%s/%s] %s",
            RUNTIME_CONFIG["loading_personality"],
            locale,
            message,
        )


def get_tts_engine() -> TTSEngine | None:
    return cast(TTSEngine | None, ENGINE_STATE.get("tts"))


def get_asr_engine() -> Any:
    return ENGINE_STATE.get("asr")


def sanitize_name(name: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "_", name.strip()).strip("_")
    return normalized or fallback


def apply_nuance_style(text: str, style: str, language: str = "auto") -> str:
    cleaned = text.strip()
    if not cleaned:
        return cleaned

    normalized_lang = normalize_language(language)
    if normalized_lang not in {"en", "ja", "ko", "zh", "es", "fr", "de", "pt", "it", "fil"}:
        normalized_lang = "en"

    style_map = {
        "en": {
            "neutral": "",
            "warm": "(smiles softly)",
            "expressive": "(laughs lightly)",
            "podcast": "(friendly host tone)",
            "cinematic": "(gentle dramatic pause)",
        },
        "ja": {
            "neutral": "",
            "warm": "（やさしく微笑んで）",
            "expressive": "（軽く笑って）",
            "podcast": "（親しみやすい司会トーンで）",
            "cinematic": "（少しドラマチックな間を入れて）",
        },
        "ko": {
            "neutral": "",
            "warm": "(부드럽게 미소 지으며)",
            "expressive": "(가볍게 웃으며)",
            "podcast": "(친근한 진행자 톤으로)",
            "cinematic": "(잔잔한 극적 쉼을 넣어)",
        },
        "fil": {
            "neutral": "",
            "warm": "(nakangiti nang mahinahon)",
            "expressive": "(napapatawa nang kaunti)",
            "podcast": "(friendly host tone sa Taglish)",
            "cinematic": "(may banayad na dramatic pause)",
        },
    }
    marker = style_map.get(normalized_lang, style_map["en"]).get(style, "")
    if not marker:
        return cleaned

    if cleaned.lower().startswith("speaker"):
        return cleaned
    return f"{marker} {cleaned}"


def apply_native_language_hint(text: str, language: str | None) -> str:
    cleaned = text.strip()
    if not cleaned:
        return cleaned

    normalized_lang = normalize_language(language)
    if normalized_lang == "en":
        return cleaned

    hint = NATIVE_LANGUAGE_HINTS.get(normalized_lang)
    if not hint:
        return cleaned

    primer = hint.get("primer", "").strip()
    if not primer:
        return cleaned

    # Lightweight prompt-conditioning to improve language naturalness without retraining.
    return f"[{primer}] {cleaned}"


def parse_dialogue_turns(text: str) -> list[tuple[str, str]]:
    turns: list[tuple[str, str]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        line = re.sub(r"^\[(?:speak\s+in|language)\s*[^\]]*\]\s*", "", line, flags=re.IGNORECASE)
        line = re.sub(r"^\((?:speak\s+in|language)\s*[^\)]*\)\s*", "", line, flags=re.IGNORECASE)

        match = re.match(
            r"^(A|B|C|D|Speaker\s*1|Speaker\s*2|Speaker\s*3|Speaker\s*4)\s*[:：-]\s*(.+)$",
            line,
            re.IGNORECASE,
        )
        if match:
            speaker_label = match.group(1).strip().lower()
            if speaker_label == "a" or "1" in speaker_label:
                speaker = "A"
            elif speaker_label == "b" or "2" in speaker_label:
                speaker = "B"
            elif speaker_label == "c" or "3" in speaker_label:
                speaker = "C"
            else:
                speaker = "D"
            turns.append((speaker, match.group(2).strip()))
        else:
            fallback = ["A", "B", "C", "D"]
            speaker = fallback[len(turns) % len(fallback)]
            turns.append((speaker, line))
    return turns


def synthesize_float_audio(
    tts_engine: TTSEngine,
    text: str,
    voice: str | None,
    cfg: float,
) -> np.ndarray:
    chunks: list[np.ndarray] = []
    for chunk in tts_engine.stream(text=text, voice_key=voice, cfg_scale=cfg):
        chunks.append(cast(np.ndarray, chunk))

    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32, copy=False)


def save_wav_file(audio: np.ndarray, output_path: Path, sample_rate: int = 24_000) -> None:
    # pylint: disable=no-member
    pcm16 = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
    with wave.open(str(output_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm16.tobytes())


# ─── Serve UI ─────────────────────────────────────────────


@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    html_path = Path(__file__).parent / "index.html"
    return HTMLResponse(content=html_path.read_text(encoding="utf-8"))


# ─── REST API ─────────────────────────────────────────────


@app.get("/api/status")
async def status():
    tts_engine = get_tts_engine()
    asr_engine = get_asr_engine()
    return {
        "tts_loaded": tts_engine is not None and bool(getattr(tts_engine, "_loaded", False)),
        "asr_loaded": asr_engine is not None and bool(getattr(asr_engine, "_loaded", False)),
        "voices": tts_engine.list_voices() if tts_engine else [],
        "default_voice": tts_engine.default_voice_key if tts_engine else None,
        "loading_humor": RUNTIME_CONFIG["loading_humor"],
        "loading_personality": RUNTIME_CONFIG["loading_personality"],
    }


@app.get("/api/voices")
async def list_voices():
    tts_engine = get_tts_engine()
    if tts_engine is None:
        return JSONResponse({"error": "TTS not loaded"}, status_code=503)
    return {
        "voices": tts_engine.list_voices(),
        "default": tts_engine.default_voice_key,
    }


@app.post("/api/voices/clone")
async def clone_voice(request: VoiceCloneRequest):
    tts_engine = get_tts_engine()
    if tts_engine is None:
        return JSONResponse({"error": "TTS not loaded"}, status_code=503)

    try:
        new_key, clone_path = tts_engine.clone_voice(
            source_key=request.source_voice,
            new_key=request.new_voice,
        )
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:  # pylint: disable=broad-exception-caught
        logger.error("Voice clone failed: %s", exc)
        return JSONResponse({"error": "Failed to clone voice preset"}, status_code=500)

    return {
        "ok": True,
        "voice": new_key,
        "path": str(clone_path),
        "voices": tts_engine.list_voices(),
        "default": tts_engine.default_voice_key,
    }


@app.post("/api/voices/upload")
async def upload_clone_voice(
    file: UploadFile = File(...),
    new_voice: str = Form(...),
    source_voice: str = Form(default=""),
):
    tts_engine = get_tts_engine()
    if tts_engine is None:
        return JSONResponse({"error": "TTS not loaded"}, status_code=503)

    filename = file.filename or "uploaded.bin"
    extension = Path(filename).suffix.lower()

    uploads_dir = Path(__file__).parent / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    upload_path = uploads_dir / f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{sanitize_name(filename, 'upload')}"

    file_bytes = await file.read()
    upload_path.write_bytes(file_bytes)

    audio_extensions = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac"}

    try:
        if extension == ".pt":
            new_key, destination = tts_engine.import_voice_preset(upload_path, new_voice)
            return {
                "ok": True,
                "voice": new_key,
                "path": str(destination),
                "mode": "preset-upload",
                "voices": tts_engine.list_voices(),
            }

        if extension in audio_extensions:
            fallback_source = source_voice.strip() or None
            new_key, destination, warning = tts_engine.clone_voice_from_audio_reference(
                audio_path=upload_path,
                new_key=new_voice,
                source_key=fallback_source,
            )
            return {
                "ok": True,
                "voice": new_key,
                "path": str(destination),
                "mode": "audio-reference-fallback",
                "warning": warning,
                "voices": tts_engine.list_voices(),
            }
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:  # pylint: disable=broad-exception-caught
        logger.error("Voice upload/clone failed: %s", exc)
        return JSONResponse({"error": "Failed to process uploaded voice file"}, status_code=500)

    return JSONResponse(
        {
            "error": "Unsupported file type. Upload .pt voice preset or an audio file (.wav/.mp3/.m4a/.flac/.ogg/.aac)."
        },
        status_code=400,
    )


@app.post("/api/tts/save")
async def save_tts_audio(request: TTSSaveRequest):
    tts_engine = get_tts_engine()
    if tts_engine is None:
        return JSONResponse({"error": "TTS not loaded"}, status_code=503)

    if not request.text.strip():
        return JSONResponse({"error": "Text is empty"}, status_code=400)

    cfg_scale = max(0.1, float(request.cfg or 1.5))
    style = request.nuance_style or "neutral"
    language = request.language or "auto"
    audio_parts: list[np.ndarray] = []

    if request.dialogue_mode:
        turns = parse_dialogue_turns(request.text)
        if not turns:
            return JSONResponse({"error": "No dialogue turns parsed from text"}, status_code=400)

        speaker_a_voice = request.speaker_a_voice or request.voice or tts_engine.default_voice_key
        speaker_b_voice = request.speaker_b_voice or speaker_a_voice
        speaker_c_voice = request.speaker_c_voice or speaker_a_voice
        speaker_d_voice = request.speaker_d_voice or speaker_b_voice
        speaker_map = {
            "A": speaker_a_voice,
            "B": speaker_b_voice,
            "C": speaker_c_voice,
            "D": speaker_d_voice,
        }
        pause_ms = max(0, min(2000, int(request.speaker_pause_ms or 120)))
        pause_samples = int((pause_ms / 1000.0) * 24_000)
        pause_chunk = np.zeros(pause_samples, dtype=np.float32) if pause_samples > 0 else None

        for speaker, utterance in turns:
            active_voice = speaker_map.get(speaker, speaker_a_voice)
            nuanced = apply_nuance_style(utterance, style, language)
            nuanced = apply_native_language_hint(nuanced, language)
            chunk = synthesize_float_audio(tts_engine, nuanced, active_voice, cfg_scale)
            if chunk.size:
                audio_parts.append(chunk)
                if pause_chunk is not None:
                    audio_parts.append(pause_chunk)
    else:
        nuanced = apply_nuance_style(request.text, style, language)
        nuanced = apply_native_language_hint(nuanced, language)
        chunk = synthesize_float_audio(tts_engine, nuanced, request.voice, cfg_scale)
        if chunk.size:
            audio_parts.append(chunk)

    if not audio_parts:
        return JSONResponse({"error": "No audio generated"}, status_code=500)

    output_audio = np.concatenate(audio_parts).astype(np.float32, copy=False)

    output_dir = Path(__file__).parent / "generated_audio"
    output_dir.mkdir(parents=True, exist_ok=True)

    base_name = sanitize_name(request.save_name or "tts_output", "tts_output")
    file_name = f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{base_name}.wav"
    output_path = output_dir / file_name

    save_wav_file(output_audio, output_path)

    return {
        "ok": True,
        "file": file_name,
        "path": str(output_path),
        "download_url": f"/api/tts/download/{file_name}",
        "duration_sec": round(float(output_audio.size / 24_000), 3),
    }


@app.get("/api/tts/download/{file_name}")
async def download_tts_audio(file_name: str):
    safe_name = sanitize_name(file_name, "")
    if not safe_name.endswith(".wav"):
        return JSONResponse({"error": "Only .wav files are supported"}, status_code=400)

    output_path = Path(__file__).parent / "generated_audio" / safe_name
    if not output_path.exists():
        return JSONResponse({"error": "File not found"}, status_code=404)

    return FileResponse(path=output_path, filename=safe_name, media_type="audio/wav")


@app.get("/api/loading-message")
async def loading_message(
    request: Request,
    personality: str = "playful",
    locale: str = "auto",
    text_hint: str = "",
):
    resolved_locale = humor_agent.resolve_locale(
        preferred_locale=locale,
        accept_language=request.headers.get("accept-language", ""),
    )
    if text_hint.strip():
        resolved_locale = humor_agent.detect_locale_from_text(
            text_hint, fallback_locale=resolved_locale
        )

    normalized_personality = humor_agent.normalize_personality(personality)
    return {
        "message": humor_agent.next_loading_message(
            personality=normalized_personality,
            locale=resolved_locale,
        ),
        "personality": normalized_personality,
        "locale": resolved_locale,
        "available_personalities": humor_agent.available_personalities(),
        "available_locales": humor_agent.available_locales(),
    }


# ─── WebSocket: TTS (streaming) ──────────────────────────


@app.websocket("/ws/tts")
async def ws_tts(websocket: WebSocket):
    """
    Connect with query params: ?text=Hello+world&voice=en-Carter_man&cfg=1.5
    Receives binary PCM16 audio chunks at 24kHz as they are generated.
    """
    tts_engine = get_tts_engine()
    if tts_engine is None or not bool(getattr(tts_engine, "_loaded", False)):
        await websocket.close(code=1013, reason="TTS not loaded")
        return

    await websocket.accept()

    text = websocket.query_params.get("text", "")
    voice = websocket.query_params.get("voice")
    cfg_str = websocket.query_params.get("cfg", "1.5")
    language = websocket.query_params.get("language", "auto")

    try:
        cfg_scale = max(0.1, float(cfg_str))
    except ValueError:
        cfg_scale = 1.5

    if not text.strip():
        await websocket.send_json({"type": "error", "message": "No text provided"})
        await websocket.close()
        return

    text = apply_native_language_hint(text, language)

    logger.info("TTS request: text=%r, voice=%s, cfg=%s", text, voice, cfg_scale)
    stop_event = threading.Event()

    try:
        iterator = tts_engine.stream(
            text, voice_key=voice, cfg_scale=cfg_scale, stop_event=stop_event
        )
        sentinel = object()

        while websocket.client_state == WebSocketState.CONNECTED:
            chunk = await asyncio.to_thread(next, iterator, sentinel)
            if chunk is sentinel:
                break
            chunk = cast(np.ndarray, chunk)
            await websocket.send_bytes(tts_engine.chunk_to_pcm16(chunk))

    except WebSocketDisconnect:
        logger.info("TTS client disconnected")
        stop_event.set()
    except Exception as e:  # pylint: disable=broad-exception-caught
        logger.error("TTS WebSocket error: %s", e)
        stop_event.set()
    finally:
        stop_event.set()
        try:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.close()
        except Exception:  # pylint: disable=broad-exception-caught
            pass


# ─── WebSocket: ASR ───────────────────────────────────────


@app.websocket("/ws/asr")
async def ws_asr(websocket: WebSocket):
    """
    Stream audio chunks (PCM16, 16kHz, mono) for real-time transcription.
    """
    asr_engine = get_asr_engine()
    if asr_engine is None:
        await websocket.close(code=1013, reason="ASR not enabled (use --enable-asr)")
        return

    await websocket.accept()
    logger.info("ASR WebSocket connected")

    audio_buffer = bytearray()
    chunk_threshold = 64000  # ~2 seconds at 16kHz PCM16

    try:
        while True:
            data = await websocket.receive_bytes()
            audio_buffer.extend(data)

            if len(audio_buffer) >= chunk_threshold:
                chunk = bytes(audio_buffer)
                audio_buffer.clear()
                result = await asr_engine.transcribe(chunk, sample_rate=16000)
                await websocket.send_json(
                    {
                        "type": "transcript",
                        "text": result["full_text"],
                        "segments": result["segments"],
                    }
                )
    except WebSocketDisconnect:
        logger.info("ASR WebSocket disconnected")
    except Exception as e:  # pylint: disable=broad-exception-caught
        logger.error("ASR WebSocket error: %s", e)
        await websocket.close(code=1011, reason=str(e))


# ─── Main ─────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Echo Playground Server")
    parser.add_argument("--port", type=int, default=8765, help="Server port")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Server host")
    parser.add_argument(
        "--device", type=str, default="auto", help="Device: cuda, mps, cpu, auto"
    )
    parser.add_argument(
        "--enable-asr",
        action="store_true",
        help="Also load ASR engine (requires ~16GB)",
    )
    parser.add_argument(
        "--loading-personality",
        type=str,
        default="playful",
        choices=humor_agent.available_personalities(),
        help="Loading companion tone: friendly, playful, annoying, dry",
    )
    parser.add_argument(
        "--loading-locale",
        type=str,
        default="auto",
        help="Loading companion locale (auto, en, es, fr, de, it, pt, fil, tl, tagalog, taglish)",
    )
    parser.add_argument(
        "--disable-loading-humor",
        action="store_true",
        help="Disable startup loading messages from the humor skill agent",
    )
    args = parser.parse_args()

    RUNTIME_CONFIG["enable_asr"] = args.enable_asr
    RUNTIME_CONFIG["device"] = args.device
    RUNTIME_CONFIG["loading_humor"] = not args.disable_loading_humor
    RUNTIME_CONFIG["loading_personality"] = args.loading_personality
    RUNTIME_CONFIG["loading_locale"] = args.loading_locale

    logger.info("Starting Echo Playground on %s:%s", args.host, args.port)
    logger.info("Mode: %s", "ASR + TTS" if RUNTIME_CONFIG["enable_asr"] else "TTS only")
    if RUNTIME_CONFIG["loading_humor"]:
        logger.info(
            "Loading companion enabled (personality=%s, locale=%s)",
            RUNTIME_CONFIG["loading_personality"],
            RUNTIME_CONFIG["loading_locale"],
        )
    else:
        logger.info("Loading companion disabled")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
