"""Record one session of the Python sidecar as the TS engine's replay golden (electron/engine/test/golden/session.json).

    HF_HOME=<a cache holding canary-180m-flash, qwen2.5-0.5b and supertonic-3> \\
    python sidecar/tools/record_session.py --wav <jfk.wav> --out electron/engine/test/golden/session.json

Starts `python -m sokuji_sidecar` (offline, with a fresh bench cache so rtf and tokens/s are measured), connects four
sockets the way the renderer's clients do — model management, ASR, translation, TTS — and records every frame in both
directions: JSON verbatim; a binary frame from the engine as its length, sha256 and first 64 bytes (base64); a binary
frame from the client in full (base64), so the replay sends exactly the same audio. The flows: hardware_info,
models_catalog for each kind and model_status for the three cards; asr_init (canary-180m-flash, en, 24 kHz, cpu), the
clip resampled to 24 kHz in 100 ms frames between vad_mark start and end; translate_init (qwen2.5-0.5b, en→ja, cpu)
and the transcript translated; tts_init (supertonic-3, cpu) and "Good morning, everyone." synthesized; then every
socket closed. The wheel's lane is recorded too: a replay on another lane sees other GPUs, so only the GPU-dependent
parts of the model catalog may differ there.
"""
import argparse
import asyncio
import base64
import hashlib
import json
import os
import platform
import subprocess
import sys
import tempfile
import wave

import numpy as np
import soxr
import websockets

SIDECAR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
ASR_MODEL, TRANSLATE_MODEL, TTS_MODEL = "canary-180m-flash", "qwen2.5-0.5b", "supertonic-3"
TTS_TEXT = "Good morning, everyone."
RATE = 24000
FRAME = RATE // 10          # 100 ms


def clip_frames(path):
    """The WAV (16-bit mono) at 24 kHz as int16 little-endian 100 ms frames."""
    with wave.open(path, "rb") as w:
        assert w.getnchannels() == 1 and w.getsampwidth() == 2, "expects a 16-bit mono WAV"
        rate = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if rate != RATE:
        x = soxr.resample(x, rate, RATE)
    pcm = (np.clip(x, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
    return [pcm[i:i + FRAME * 2] for i in range(0, len(pcm), FRAME * 2)]


class Recorder:
    """One socket: every frame sent and received, in order."""

    def __init__(self, name, ws):
        self.name, self.ws, self.frames = name, ws, []

    async def send(self, obj):
        self.frames.append({"dir": "out", "json": obj})
        await self.ws.send(json.dumps(obj))

    async def send_binary(self, data):
        self.frames.append({"dir": "out", "binary": base64.b64encode(data).decode()})
        await self.ws.send(data)

    async def until(self, done, timeout=300):
        """Receive until `done(msg)` holds for a JSON message; return it."""
        async with asyncio.timeout(timeout):
            while True:
                raw = await self.ws.recv()
                if isinstance(raw, bytes):
                    self.frames.append({"dir": "in", "binary": {"len": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                                                                "head": base64.b64encode(raw[:64]).decode()}})
                    continue
                msg = json.loads(raw)
                self.frames.append({"dir": "in", "json": msg})
                if done(msg):
                    return msg

    def reply(self, mid, timeout=300):
        return self.until(lambda m: m.get("id") == mid and m.get("type") != "translate_partial", timeout)


async def record(port, wav):
    url = f"ws://127.0.0.1:{port}"
    sockets = {name: Recorder(name, await websockets.connect(url, max_size=None)) for name in ("models", "asr", "translate", "tts")}

    m = sockets["models"]
    await m.send({"type": "hardware_info", "id": 1})
    await m.reply(1)
    for i, kind in enumerate(("asr", "translate", "tts"), start=2):
        await m.send({"type": "models_catalog", "id": i, "kind": kind})
        await m.reply(i)
    await m.send({"type": "model_status", "id": 5, "models": [ASR_MODEL, TRANSLATE_MODEL, TTS_MODEL]})
    await m.reply(5)

    a = sockets["asr"]
    await a.send({"type": "asr_init", "id": 1, "model": ASR_MODEL, "language": "en", "sampleRate": RATE, "device": "cpu"})
    ready = await a.reply(1)
    assert ready["type"] == "ready", ready
    await a.send({"type": "vad_mark", "event": "start"})
    for frame in clip_frames(wav):
        await a.send_binary(frame)
    await a.send({"type": "vad_mark", "event": "end"})
    result = await a.until(lambda msg: msg.get("type") in ("result", "error"))
    assert result["type"] == "result", result
    transcript = result["text"]

    t = sockets["translate"]
    await t.send({"type": "translate_init", "id": 1, "model": TRANSLATE_MODEL, "sourceLang": "en", "targetLang": "ja", "device": "cpu"})
    await t.reply(1)
    await t.send({"type": "translate", "id": 2, "text": transcript, "systemPrompt": "", "wrapTranscript": False})
    translated = await t.reply(2)
    assert translated["type"] == "translate_result", translated

    s = sockets["tts"]
    await s.send({"type": "tts_init", "id": 1, "model": TTS_MODEL, "device": "cpu"})
    await s.reply(1)
    await s.send({"type": "tts_generate", "id": 2, "text": TTS_TEXT})
    await s.until(lambda msg: msg.get("id") == 2 and msg.get("type") in ("tts_done", "tts_generate_result", "error"))

    for rec in sockets.values():
        await rec.ws.close()
    return [{"name": rec.name, "frames": rec.frames} for rec in sockets.values()]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--wav", required=True, help="a 16-bit mono WAV to transcribe (the JFK clip)")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    bench = tempfile.mkdtemp(prefix="sokuji-session-bench-")
    env = dict(os.environ, HF_HUB_OFFLINE="1", SOKUJI_BENCH_DIR=bench, PYTHONPATH=SIDECAR)
    proc = subprocess.Popen([sys.executable, "-m", "sokuji_sidecar"], cwd=SIDECAR, env=env, stdout=subprocess.PIPE, text=True)
    try:
        port = json.loads(proc.stdout.readline())["port"]
        sockets = asyncio.run(record(port, args.wav))
    finally:
        proc.terminate()
        proc.wait(timeout=30)
    import sokuji_native
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=SIDECAR, capture_output=True, text=True).stdout.strip()
    out = {"generator": "record_session.py", "sidecar_commit": commit, "native_version": sokuji_native.version(),
           "lane": sokuji_native.engine_versions().get("lane", ""),
           "machine": f"{platform.system()}-{platform.machine()}", "sockets": sockets}
    with open(args.out, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
