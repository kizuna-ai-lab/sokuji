# Echo Playground — Real-time ASR + TTS with Voice Cloning

Real-time speech-to-text (ASR) and text-to-speech (TTS) using Microsoft VibeVoice,
integrated via a WebSocket server with a browser-based UI.

## Architecture

```
Browser Mic → WebSocket → FastAPI Server → VibeVoice-ASR (STT)
                                         → VibeVoice-Realtime (TTS)
                                         → WebSocket → Browser Speaker
```

## Requirements

- Python 3.10+
- CUDA GPU (recommended) or Apple Silicon Mac (MPS)
- ~4 GB for VibeVoice-Realtime-0.5B TTS
- ~16 GB additional for VibeVoice-ASR-7B (optional)

## Quick Start

### 1. Clone VibeVoice and install

```bash
cd playground/vibevoice

# Clone the official VibeVoice repo
git clone https://github.com/microsoft/VibeVoice.git vibevoice-repo

# Create venv and install VibeVoice with streaming TTS support
python3 -m venv .venv
source .venv/bin/activate
cd vibevoice-repo
pip install -e ".[streamingtts]"
cd ..

# Install server dependencies
pip install -r requirements.txt
```

### 2. Download voice presets (included in repo)

Voice presets are in `vibevoice-repo/demo/voices/streaming_model/`.

### 3. Start the server

```bash
# TTS mode (default, lighter)
python server.py

# Full ASR + TTS mode
python server.py --enable-asr

# Custom port / device
python server.py --port 8765 --device mps
```

### 4. Open the UI

Open `http://localhost:8765` in your browser.

## Features

- **Real-time TTS**: Type text → get streaming speech output (~300ms latency)
- **Voice Selection**: Choose from built-in voice presets
- **Real-time ASR** (optional): Stream microphone audio → get live transcriptions
- **50+ Languages** (ASR): Multilingual with auto language detection
- **WebSocket API**: Connect from any client

## WebSocket API

### TTS (Text-to-Speech)

```javascript
// Connect with text as query param
ws = new WebSocket('ws://localhost:8765/ws/tts?text=Hello+world&voice=en-Carter_man');
ws.onmessage = (e) => {
  if (e.data instanceof Blob) {
    // Binary PCM16 audio chunks at 24kHz
    playAudio(e.data);
  }
};
```

### ASR (Speech-to-Text) — requires `--enable-asr`

```javascript
ws = new WebSocket('ws://localhost:8765/ws/asr');
ws.send(audioChunkArrayBuffer);  // PCM16, 16kHz, mono
ws.onmessage = (e) => {
  const result = JSON.parse(e.data);
  // { type: "transcript", text: "Hello world", segments: [...] }
};
```

## File Structure

```
playground/vibevoice/
├── server.py             # FastAPI + WebSocket server
├── tts_engine.py         # VibeVoice-Realtime TTS wrapper
├── asr_engine.py         # VibeVoice-ASR wrapper
├── index.html            # Browser UI
├── requirements.txt      # Server dependencies
├── README.md             # This file
└── vibevoice-repo/       # Cloned microsoft/VibeVoice (gitignored)
```
