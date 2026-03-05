<p align="center">
  <img width="200" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/src/assets/logo.png" alt="Sokuji Logo">
</p>

<p align="center">
  <em>Live speech translation powered by on-device AI and cloud providers — OpenAI, Google Gemini, Palabra.ai, Kizuna AI, Volcengine, and more</em>
</p>

<p align="center">   
  <a href="LICENSE" target="_blank">
    <img alt="AGPL-3.0 License" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg?style=flat-square" />
  </a>
  
  <!-- Build and Release Badge -->
  <a href="https://github.com/kizuna-ai-lab/sokuji/actions/workflows/build.yml" target="_blank">
    <img alt="Build and Release" src="https://github.com/kizuna-ai-lab/sokuji/actions/workflows/build.yml/badge.svg" />
  </a>
  
  <!-- OpenAI Badge -->
  <img alt="OpenAI" src="https://img.shields.io/badge/-OpenAI-eee?style=flat-square&logo=openai&logoColor=412991" />
  
  <!-- Google Gemini Badge -->
  <img alt="Google Gemini" src="https://img.shields.io/badge/Google%20Gemini-4285F4?style=flat-square&logo=google-gemini&logoColor=white" />
  
  <!-- Palabra.ai Badge -->
  <img alt="Palabra.ai" src="https://img.shields.io/badge/Palabra.ai-black?style=flat-square&logo=websockets&logoColor=white" />

  <!-- Vibe Coding Badge -->
  <img alt="Vibe Coding" src="https://img.shields.io/badge/built%20with-vibe%20coding-ff69b4?style=flat-square" />
  
  <!-- DeepWiki Badge -->
  <a href="https://deepwiki.com/kizuna-ai-lab/sokuji" target="_blank">
    <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" />
  </a>
</p>

<p align="center">
  English | <a href="README.ja.md">日本語</a>
</p>

# Why Sokuji?

Sokuji is a cross-platform desktop application and browser extension designed to provide live speech translation using OpenAI, Google Gemini, Palabra.ai, Kizuna AI, Volcengine ST, Doubao AST 2.0, and OpenAI-compatible APIs. Available for Windows, macOS, and Linux, it bridges language barriers in live conversations by capturing audio input, processing it through advanced AI models, and delivering translated output in real-time. With v0.15.0, Sokuji introduces **Local Inference** — a fully offline, privacy-first pipeline where ASR, translation, and TTS all run entirely on your device via CPU (WASM) and WebGPU, with no data ever leaving your machine.

https://github.com/user-attachments/assets/1eaaa333-a7ce-4412-a295-16b7eb2310de

# Browser Extension Available!

Prefer not to install a desktop application? Try our browser extension for Chrome, Edge, and other Chromium-based browsers. It offers the same powerful live speech translation features directly in your browser, with integration for popular video conferencing platforms including Google Meet, Microsoft Teams, Zoom, Discord, Slack, Gather.town, and Whereby.

<p>
  <a href="https://chromewebstore.google.com/detail/ppmihnhelgfpjomhjhpecobloelicnak?utm_source=item-share-cb" target="_blank">
    <img alt="Available on Chrome Web Store" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/assets/chrome-web-store-badge.png" style="height: 60px;" />
  </a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/sokuji-aipowered-live-/dcmmcdkeibkalgdjlahlembodjhijhkm" target="_blank">
    <img alt="Available on Microsoft Edge Add-ons" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/assets/edge-addons-badge.png" style="height: 60px;" />
  </a>
  <a href="https://www.producthunt.com/posts/sokuji?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-sokuji" target="_blank">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=967440&theme=light&t=1748250774125" alt="Sokuji - Live&#0032;speech&#0032;translation&#0032;with&#0032;real&#0045;time&#0032;AI | Product Hunt" style="height: 60px;" />
  </a>
</p>

## Installing Browser Extension in Developer Mode

If you want to install the latest version of the browser extension:

1. Download the latest `sokuji-extension.zip` from the [releases page](https://github.com/kizuna-ai-lab/sokuji/releases)
2. Extract the zip file to a folder
3. Open Chrome/Chromium and go to `chrome://extensions/`
4. Enable "Developer mode" in the top right corner
5. Click "Load unpacked" and select the extracted folder
6. The Sokuji extension will be installed and ready to use

# Features

### AI Translation
- **8 AI Providers**: OpenAI, Google Gemini, Palabra.ai, Kizuna AI, Volcengine ST, Doubao AST 2.0, OpenAI Compatible, and Local Inference
- **Supported Models**:
  - **OpenAI**: `gpt-4o-realtime-preview`, `gpt-4o-mini-realtime-preview`, `gpt-realtime`, `gpt-realtime-2025-08-28`
  - **Google Gemini**: `gemini-2.0-flash-live-001`, `gemini-2.5-flash-preview-native-audio-dialog`
  - **Palabra.ai**: Real-time speech-to-speech translation via WebRTC
  - **Kizuna AI**: OpenAI-compatible models with backend-managed authentication
  - **OpenAI Compatible**: Support for custom OpenAI-compatible API endpoints (Electron only)
  - **Volcengine ST**: Real-time speech translation with V4 signature authentication
  - **Doubao AST 2.0**: Speech-to-speech translation via protobuf-over-WebSocket
  - **Local Inference**: On-device ASR, translation, and TTS — no API key or internet required
- **Automatic turn detection** with multiple modes (Normal, Semantic, Disabled) for OpenAI
- **Push-to-Talk Mode**: Manual speech control for precise translation timing
- **WebRTC Transport**: Alternative low-latency transport for OpenAI providers

### Local Inference (Edge AI)
- **Privacy-First**: All processing happens on-device — audio, transcription, and translation never leave your machine
- **No API Key Required**: Download open-source models and run completely offline
- **ASR**: 48 models (32 offline + 10 streaming + 6 Whisper WebGPU) covering 99+ languages via sherpa-onnx (WASM) and Whisper WebGPU
- **Translation**: 55+ Opus-MT language pairs plus 4 multilingual LLMs (Qwen 2.5 / 3 / 3.5) via WebGPU
- **TTS**: 136 models across 53 languages (Piper, Coqui, Mimic3, Matcha engines) via sherpa-onnx (WASM)
- **Hardware Flexibility**: CPU (WASM) for universal compatibility, WebGPU for GPU-accelerated inference
- **Model Management**: One-click download, IndexedDB caching, and resume-on-failure

### Audio
- **Advanced Virtual Microphone** with dual-queue audio mixing system:
  - **Regular audio tracks**: Queued and played sequentially
  - **Immediate audio tracks**: Separate queue for real-time audio mixing
  - **Simultaneous playback**: Mix both track types for enhanced audio experience
  - **Chunked audio support**: Efficient handling of large audio streams
  - **Cross-platform support**: Windows (VB-Cable), macOS (virtual audio driver), Linux (PulseAudio/PipeWire)
- **System Audio Capture**: Capture participant audio in video calls for translation (all platforms)
- **Real-time Voice Passthrough**: Live audio monitoring during recording sessions
- **Virtual audio device management** with automatic routing and device switching (Windows, macOS, Linux)
- **Audio visualization** with waveform display

### User Interface
- **Simple Mode Interface**: Streamlined 6-section configuration for non-technical users:
  - Interface language selection
  - Translation language pairs (source/target)
  - API key management with validation
  - Microphone selection with "Off" option
  - Speaker selection with "Off" option
  - Real-time session duration display
- **Multi-language Support**: Complete internationalization with 30 languages and English fallback
- **Enhanced Tooltips**: Interactive help tooltips powered by @floating-ui for better user guidance
- **Comprehensive logs** for tracking API interactions

### Configuration
- **API key validation** with real-time feedback
- **Customizable model settings** (temperature, max tokens)
- **User transcript model selection** (for OpenAI: `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`)
- **Noise reduction options** (for OpenAI: None, Near field, Far field)
- **Configuration persistence** in user's home directory
- **Analytics**: PostHog integration for anonymous usage tracking

# Getting Started

## Prerequisites

- An API key for at least one **cloud** provider (or use **Local Inference** for fully offline operation with no API key):
  - **OpenAI**: API key from OpenAI
  - **Google Gemini**: API key from Google AI Studio
  - **Palabra.ai**: Client ID and Client Secret
  - **Kizuna AI**: Sign in to your account for backend-managed API keys
  - **Volcengine ST**: Access Key ID and Secret Access Key
  - **Doubao AST 2.0**: APP ID and Access Token
  - **OpenAI Compatible**: API key and custom endpoint URL (Electron only)
- (optional) Virtual audio device software for app-to-app audio routing:
  - Windows: VB-Cable or similar virtual audio cable
  - macOS: Virtual audio driver
  - Linux: PulseAudio or PipeWire (desktop app only)
- For building from source: Node.js (latest LTS version recommended) and npm

## From Source

1. Clone the repository
   ```bash
   git clone https://github.com/kizuna-ai-lab/sokuji.git
   cd sokuji
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Launch the application in development mode
   ```bash
   npm run electron:dev
   ```

4. Build the application for production
   ```bash
   npm run electron:build
   ```

## From Packages

Download the appropriate package for your platform from the [releases page](https://github.com/kizuna-ai-lab/sokuji/releases):

### Windows
Download and run the `.exe` installer:
```
Sokuji Setup x.y.z.exe
```

### macOS
Download and install the `.dmg` package:
```
Sokuji-x.y.z.dmg
```

### Linux (Debian/Ubuntu)
Download and install the `.deb` package:
```bash
sudo dpkg -i sokuji_x.y.z_amd64.deb
```

For other Linux distributions, you can also download the portable `.zip` package and extract it to your preferred location.

# How to Use

1. **Setup your API key**:
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/api-settings.png" alt="API Settings" />
   </p>
   
   - Click the Settings button in the top-right corner
   - Select your desired provider (OpenAI, Gemini, Palabra, Kizuna AI, Volcengine ST, Doubao AST 2.0, or OpenAI Compatible).
   - For user-managed providers: Enter your API key and click "Validate". For Palabra, enter a Client ID and Client Secret. For Volcengine ST, enter your Access Key ID and Secret. For Doubao AST 2.0, enter your APP ID and Access Token. For OpenAI Compatible endpoints (Electron only), configure both the API key and custom endpoint URL.
   - For Kizuna AI: Sign in to your account to automatically access backend-managed API keys.
   - **For Local Inference**: Select "Local Inference" as provider, download the required models (ASR + Translation, optionally TTS), and start translating — no API key or internet connection needed.
   - Click "Save" to store your configuration securely.

2. **Configure audio devices**:
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/audio-settings.png" alt="Audio Settings" />
   </p>
   
   - Click the Audio button to open the Audio panel
   - Select your input device (microphone)
   - Select your output device (speakers/headphones)

3. **Start a session**:
   - Click "Start Session" to begin
   - Speak into your microphone
   - View real-time transcription and translation

4. **Monitor and control audio**:
   - Toggle monitor device to hear translated output
   - Enable real voice passthrough for live monitoring
   - Adjust passthrough volume as needed

5. **Use with other applications** (all platforms):
   - Select the Sokuji virtual microphone as the input in your target application
   - Translated audio will be sent to that application with advanced mixing support
   - Requires virtual audio device software (see Prerequisites section)

# Audio Architecture

Sokuji uses a modern audio processing pipeline built on Web Audio API, with cross-platform virtual device capabilities:

- **ModernAudioRecorder**: Captures input with advanced echo cancellation
- **ModernAudioPlayer**: Handles playback with queue-based audio management
- **Real-time Processing**: Low-latency audio streaming with chunked playback
- **Virtual Device Support**: Creates virtual audio devices on Windows (VB-Cable), macOS (virtual audio driver), and Linux (PulseAudio/PipeWire)
- **System Audio Capture**: Captures participant audio from video calls via `electron-audio-loopback` (Electron) or tab capture (extension)
- **WebRTC Audio Bridge**: Alternative low-latency transport for supported providers

## Audio Flow

The audio flow in Sokuji:

1. **Input Capture**: Microphone audio is captured with echo cancellation enabled
2. **System Audio Capture** (optional): Participant audio from video calls is captured separately
3. **AI Processing**: Audio is sent to the selected AI provider for translation (for Local Inference, this step runs entirely on-device with no network requests)
4. **Playback**: Translated audio is played through the selected monitor device
5. **Virtual Device Output**: Audio is also routed to virtual microphone for other applications (all platforms)
6. **Optional Passthrough**: Original voice can be monitored in real-time

This architecture provides:
- Better echo cancellation using modern browser APIs
- Lower latency through optimized audio pipelines
- Cross-platform virtual device integration for seamless app-to-app audio routing
- System audio capture for video conferencing translation

# Architecture

Sokuji features a simplified architecture focused on core functionality:

## Backend (Cloudflare Workers)
- **Simplified User System**: Only users and usage_logs tables
- **Real-time Usage Tracking**: Relay server directly writes usage data to database
- **Better Auth**: Handles all user authentication and session management
- **Streamlined API**: Only essential endpoints maintained (/quota, /check, /reset)

## Frontend (React + TypeScript)  
- **Service Factory Pattern**: Platform-specific implementations (Electron/Browser Extension)
- **Modern Audio Processing**: AudioWorklet with ScriptProcessor fallback
- **Unified Components**: SimpleConfigPanel and SimpleMainPanel for streamlined UX
- **Context-Based State**: React Context API without external state management

## Database Schema
```sql
-- Core user table
users (id, email, name, subscription, token_quota)

-- Simplified usage tracking (written by relay)
usage_logs (id, user_id, session_id, model, total_tokens, input_tokens, output_tokens, created_at)
```

# Technologies Used

- **Runtime**: Electron 40+ (Windows, macOS, Linux) / Chrome Extension Manifest V3
- **Frontend**: React 18 + TypeScript
- **Backend**: Cloudflare Workers + Hono + D1 Database
- **Authentication**: Better Auth
- **AI Providers**: OpenAI, Google Gemini, Palabra.ai, Kizuna AI, Volcengine ST, Doubao AST 2.0, and OpenAI-compatible endpoints
- **Advanced Audio Processing**:
  - Web Audio API for real-time audio processing
  - MediaRecorder API for reliable audio capture
  - ScriptProcessor/AudioWorklet for real-time audio analysis
  - Queue-based playback system for smooth streaming
  - WebRTC audio bridge for low-latency transport
  - electron-audio-loopback for system audio capture
- **Local AI Inference**:
  - sherpa-onnx (WASM) for on-device ASR and TTS
  - @huggingface/transformers for browser-based translation inference
  - WebGPU acceleration for Whisper and Qwen LLM models
- **Model Storage**: IndexedDB with idb library
- **Serialization**: protobufjs for Volcengine AST2 protocol
- **Analytics**: posthog-js-lite for anonymous usage tracking
- **Routing**: react-router-dom for application navigation
- **UI Libraries**:
  - @floating-ui/react for advanced tooltip positioning
  - SASS for styling
  - Lucide React for icons
- **Internationalization**:
  - i18next for multi-language support
  - 30 language translations

# Contributing

Contributions are welcome! Here's how you can contribute:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Development Guidelines

- Follow TypeScript and ESLint rules
- Add tests for new features
- Keep commit messages clear and descriptive
- Update documentation

# License

[AGPL-3.0](LICENSE)

# Support

If you encounter issues or have questions:

1. Check existing issues on [Issues](https://github.com/kizuna-ai-lab/sokuji/issues)
2. Report a new issue
3. Ask questions in [Discussions](https://github.com/kizuna-ai-lab/sokuji/discussions)

# Acknowledgments

- OpenAI - Realtime API
- Google - Gemini API
- Volcengine - Speech Translation API
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) - On-device speech recognition and synthesis
- [Hugging Face Transformers.js](https://github.com/huggingface/transformers.js) - Browser-based ML inference
- [Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) - Open-source machine translation models
- [Qwen](https://github.com/QwenLM/Qwen) - Multilingual language models
- Electron - Cross-platform desktop application framework
- React - User interface library
- PulseAudio/PipeWire - Linux audio systems
