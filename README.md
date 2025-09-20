<p align="center">
  <img width="200" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/src/assets/logo.png" alt="Sokuji Logo">
</p>

<p align="center">
  <em>Live speech translation powered by OpenAI, Google Gemini, CometAPI, Palabra.ai, YunAI, and Kizuna AI</em>
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

Sokuji is a cross-platform desktop application designed to provide live speech translation using OpenAI, Google Gemini, CometAPI, Palabra.ai, YunAI, and Kizuna AI APIs. Available for Windows, macOS, and Linux, it bridges language barriers in live conversations by capturing audio input, processing it through advanced AI models, and delivering translated output in real-time.

https://github.com/user-attachments/assets/1eaaa333-a7ce-4412-a295-16b7eb2310de

# Browser Extension Available!

Prefer not to install a desktop application? Try our browser extension for Chrome, Edge, and other Chromium-based browsers. It offers the same powerful live speech translation features directly in your browser, with special integration for Google Meet and Microsoft Teams.

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

# More than just translation

Sokuji goes beyond basic translation by offering a complete audio routing solution with virtual device management (Linux only), allowing for seamless integration with other applications. It provides a modern, intuitive interface with real-time audio visualization and comprehensive logging.

# Features

1. **Real-time speech translation** using OpenAI, Google Gemini, CometAPI, Palabra.ai, YunAI, and Kizuna AI APIs
2. **Simple Mode Interface**: Streamlined 6-section configuration for non-technical users:
   - Interface language selection
   - Translation language pairs (source/target)
   - API key management with validation
   - Microphone selection with "Off" option
   - Speaker selection with "Off" option
   - Real-time session duration display
3. **Multi-Provider Support**: Seamlessly switch between OpenAI, Google Gemini, CometAPI, Palabra.ai, YunAI, and Kizuna AI.
4. **Supported Models**:
   - **OpenAI**: `gpt-4o-realtime-preview`, `gpt-4o-mini-realtime-preview`
   - **Google Gemini**: `gemini-2.0-flash-live-001`, `gemini-2.5-flash-preview-native-audio-dialog`
   - **CometAPI**: OpenAI-compatible models with custom endpoints
   - **Palabra.ai**: Real-time speech-to-speech translation via WebRTC
   - **YunAI**: Real-time conversational AI with WebSocket support
   - **Kizuna AI**: OpenAI-compatible models with backend-managed authentication
5. **Automatic turn detection** with multiple modes (Normal, Semantic, Disabled) for OpenAI
6. **Audio visualization** with waveform display
7. **Advanced Virtual Microphone** (Linux only) with dual-queue audio mixing system:
   - **Regular audio tracks**: Queued and played sequentially
   - **Immediate audio tracks**: Separate queue for real-time audio mixing
   - **Simultaneous playback**: Mix both track types for enhanced audio experience
   - **Chunked audio support**: Efficient handling of large audio streams
8. **Real-time Voice Passthrough**: Live audio monitoring during recording sessions
9. **Virtual audio device creation and management** on Linux (using PulseAudio/PipeWire)
10. **Automatic audio routing between virtual devices** (Linux only)
11. **Automatic device switching** and configuration persistence
12. **Audio input and output device selection**
13. **Comprehensive logs** for tracking API interactions
14. **Customizable model settings** (temperature, max tokens)
15. **User transcript model selection** (for OpenAI: `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`)
16. **Noise reduction options** (for OpenAI: None, Near field, Far field)
17. **API key validation** with real-time feedback
18. **Configuration persistence** in user's home directory
19. **Optimized AI Client Performance**: Enhanced conversation management with consistent ID generation
20. **Enhanced Tooltips**: Interactive help tooltips powered by @floating-ui for better user guidance
21. **Multi-language Support**: Complete internationalization with 35+ languages and English fallback

# Audio Architecture

Sokuji uses a modern audio processing pipeline built on Web Audio API, with additional virtual device capabilities on Linux:

- **ModernAudioRecorder**: Captures input with advanced echo cancellation
- **ModernAudioPlayer**: Handles playback with queue-based audio management
- **Real-time Processing**: Low-latency audio streaming with chunked playback
- **Virtual Device Support**: On Linux, creates virtual audio devices for application integration

### Audio Flow

The audio flow in Sokuji:

1. **Input Capture**: Microphone audio is captured with echo cancellation enabled
2. **AI Processing**: Audio is sent to the selected AI provider for translation
3. **Playback**: Translated audio is played through the selected monitor device
4. **Virtual Device Output** (Linux only): Audio is also routed to virtual microphone for other applications
5. **Optional Passthrough**: Original voice can be monitored in real-time

This architecture provides:
- Better echo cancellation using modern browser APIs
- Lower latency through optimized audio pipelines
- Virtual device integration on Linux for seamless app-to-app audio routing
- Cross-platform compatibility with graceful degradation

## Developer Notes

### Architecture Improvements

**Modern Audio Service Architecture**:
- `ModernAudioRecorder`: Web Audio API-based recording with echo cancellation
- `ModernAudioPlayer`: Queue-based playback with event-driven processing
- Unified audio service for both Electron and browser extension platforms

**Optimized Client Management**:
- `GeminiClient`: Improved conversation item management with consistent instance IDs
- Reduced method calls and improved performance
- Better memory management for long-running sessions

**Audio Processing Implementation**:
- Queue-based audio chunk management for smooth playback
- Real-time passthrough with configurable volume control
- Event-driven playback to reduce CPU usage
- Automatic device switching and reconnection

# Preparation

- (required) An OpenAI, Google Gemini, CometAPI, Palabra.ai, or YunAI API key, OR a Kizuna AI account. For Palabra.ai, you will need a Client ID and Client Secret. For CometAPI, you'll need to configure the custom endpoint URL. For YunAI, you'll need an API key and endpoint configuration. For Kizuna AI, sign in to your account to automatically access backend-managed API keys.
- (optional) Linux with PulseAudio or PipeWire for virtual audio device features (desktop app only)

# Installation

## From Source

### Prerequisites

- Node.js (latest LTS version recommended)
- npm
- Audio support works on all platforms (Windows, macOS, Linux)
- Virtual audio devices require Linux with PulseAudio or PipeWire (desktop app only)

### Steps

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
Sokuji Setup 0.9.18.exe
```

### macOS
Download and install the `.dmg` package:
```
Sokuji-0.9.18.dmg
```

### Linux (Debian/Ubuntu)
Download and install the `.deb` package:
```bash
sudo dpkg -i sokuji_0.9.18_amd64.deb
```

For other Linux distributions, you can also download the portable `.zip` package and extract it to your preferred location.

# How to Use

1. **Setup your API key**:
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/api-settings.png" alt="API Settings" />
   </p>
   
   - Click the Settings button in the top-right corner
   - Select your desired provider (OpenAI, Gemini, CometAPI, Palabra, YunAI, or Kizuna AI).
   - For user-managed providers: Enter your API key and click "Validate". For Palabra, you will need to enter a Client ID and Client Secret. For CometAPI, configure both the API key and custom endpoint URL. For YunAI, configure the API key and endpoint URL.
   - For Kizuna AI: Sign in to your account to automatically access backend-managed API keys.
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

5. **Use with other applications** (Linux only):
   - Select "Sokuji_Virtual_Mic" as the microphone input in your target application
   - Translated audio will be sent to that application with advanced mixing support

## Recent Improvements

### Simple Mode Interface (v0.10.x)

Redesigned user interface for improved accessibility:

- **Streamlined Configuration**: 6-section unified layout replacing complex tabbed interface
- **Enhanced Tooltips**: Interactive help using @floating-ui library for better user guidance
- **Session Duration Display**: Real-time tracking of conversation length
- **Unified Styling**: Consistent UI design with improved visual hierarchy
- **Multi-language Support**: Complete i18n with 35+ languages and English fallback

### Modern Audio Processing (v0.9.x)

The audio system now features improved echo cancellation and processing:

- **Echo Cancellation**: Advanced echo suppression using modern Web Audio APIs
- **Queue-Based Playback**: Smooth audio streaming with intelligent buffering
- **Real-time Passthrough**: Monitor your voice with adjustable volume control
- **Event-Driven Architecture**: Reduced CPU usage through efficient event handling
- **Cross-Platform Support**: Unified audio handling across all platforms

### AI Client Optimization (v0.8.x)

Enhanced Google Gemini client performance:

- **Consistent ID Generation**: Optimized conversation item management with fixed instance IDs
- **Improved Memory Usage**: Reduced redundant ID generation calls
- **Better Performance**: Streamlined conversation handling for faster response times

### Real-time Voice Passthrough

Live audio monitoring capabilities:

- **Real-time Feedback**: Hear your voice while recording for better user experience
- **Volume Control**: Adjustable passthrough volume for optimal monitoring
- **Low Latency**: Immediate audio feedback using optimized audio processing

# Architecture

Sokuji features a simplified architecture focused on core functionality:

## Backend (Cloudflare Workers)
- **Simplified User System**: Only users and usage_logs tables
- **Real-time Usage Tracking**: Relay server directly writes usage data to database  
- **Clerk Authentication**: Handles all user authentication and session management
- **Streamlined API**: Only essential endpoints maintained (/quota, /check, /reset)

## Frontend (React + TypeScript)  
- **Service Factory Pattern**: Platform-specific implementations (Electron/Browser Extension)
- **Modern Audio Processing**: AudioWorklet with ScriptProcessor fallback
- **Unified Components**: SimpleConfigPanel and SimpleMainPanel for streamlined UX
- **Context-Based State**: React Context API without external state management

## Database Schema
```sql
-- Core user table
users (id, clerk_id, email, subscription, token_quota)

-- Simplified usage tracking (written by relay)
usage_logs (id, user_id, session_id, model, total_tokens, input_tokens, output_tokens, created_at)
```

# Technologies Used

- **Runtime**: Electron 34+ (Windows, macOS, Linux) / Chrome Extension Manifest V3
- **Frontend**: React 18 + TypeScript  
- **Backend**: Cloudflare Workers + Hono + D1 Database
- **Authentication**: Clerk
- **AI Providers**: OpenAI, Google Gemini, CometAPI, Palabra.ai, YunAI, Kizuna AI
- **Advanced Audio Processing**:
  - Web Audio API for real-time audio processing
  - MediaRecorder API for reliable audio capture
  - ScriptProcessor for real-time audio analysis
  - Queue-based playback system for smooth streaming
- **UI Libraries**:
  - @floating-ui/react for advanced tooltip positioning
  - SASS for styling
  - Lucide React for icons
- **Internationalization**:
  - i18next for multi-language support
  - 35+ language translations

# License

[AGPL-3.0](LICENSE)
