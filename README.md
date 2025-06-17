<p align="center">
  <img width="200" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/src/assets/logo.png" alt="Sokuji Logo">
</p>

<p align="center">
  <em>Live speech translation powered by OpenAI & Google Gemini</em>
</p>

<p align="center">
  <a href="LICENSE" target="_blank">
    <img alt="AGPL-3.0 License" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg?style=flat-square" />
  </a>
  
  <!-- Build and Release Badge -->
  <a href="https://github.com/kizuna-ai-lab/sokuji/actions/workflows/build-and-release.yml" target="_blank">
    <img alt="Build and Release" src="https://github.com/kizuna-ai-lab/sokuji/actions/workflows/build-and-release.yml/badge.svg" />
  </a>
  
  <!-- OpenAI Badge -->
  <img alt="OpenAI" src="https://img.shields.io/badge/-OpenAI-eee?style=flat-square&logo=openai&logoColor=412991" />
  
  <!-- Google Gemini Badge -->
  <img alt="Google Gemini" src="https://img.shields.io/badge/Google%20Gemini-4285F4?style=flat-square&logo=google-gemini&logoColor=white" />
  
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

Sokuji is a desktop application designed to provide live speech translation using OpenAI and Google Gemini APIs. It bridges language barriers in live conversations by capturing audio input, processing it through advanced AI models, and delivering translated output in real-time.

https://github.com/user-attachments/assets/1eaaa333-a7ce-4412-a295-16b7eb2310de

# Browser Extension Available!

Prefer not to install a desktop application? Try our browser extension for Chrome, Edge, and other Chromium-based browsers. It offers the same powerful live speech translation features directly in your browser, with special integration for Google Meet and Microsoft Teams.

<p>
  <a href="https://chromewebstore.google.com/detail/ppmihnhelgfpjomhjhpecobloelicnak?utm_source=item-share-cb" target="_blank">
    <img alt="Available on Chrome Web Store" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/assets/chrome-web-store-badge.png" height="60" />
  </a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/sokuji-aipowered-live-/dcmmcdkeibkalgdjlahlembodjhijhkm" target="_blank">
    <img alt="Available on Microsoft Edge Add-ons" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/assets/edge-addons-badge.png" height="60" />
  </a>
  <a href="https://www.producthunt.com/posts/sokuji?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-sokuji" target="_blank">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=967440&theme=light&t=1748250774125" alt="Sokuji - Live&#0032;speech&#0032;translation&#0032;with&#0032;real&#0045;time&#0032;AI | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" />
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

Sokuji goes beyond basic translation by offering a complete audio routing solution with virtual device management, allowing for seamless integration with other applications. It provides a modern, intuitive interface with real-time audio visualization and comprehensive logging.

# Features

1. **Real-time speech translation** using OpenAI and Google Gemini APIs
2. **Multi-Provider Support**: Seamlessly switch between OpenAI and Google Gemini.
3. **Supported Models**:
   - **OpenAI**: `gpt-4o-realtime-preview`, `gpt-4o-mini-realtime-preview`
   - **Google Gemini**: `gemini-2.0-flash-live-001`, `gemini-2.5-flash-preview-native-audio-dialog`
4. **Automatic turn detection** with multiple modes (Normal, Semantic, Disabled) for OpenAI
5. **Audio visualization** with waveform display
6. **Virtual audio device** creation and management on Linux (using PulseAudio/PipeWire)
7. **Automatic audio routing** between virtual devices
8. **Audio input and output device selection**
9. **Comprehensive logs** for tracking API interactions
10. **Customizable model settings** (temperature, max tokens)
11. **User transcript model selection** (for OpenAI: `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`)
12. **Noise reduction options** (for OpenAI: None, Near field, Far field)
13. **API key validation** with real-time feedback
14. **Configuration persistence** in user's home directory

# Audio Routing

<p align="center">
  <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/audio-routing.png" alt="Audio Routing Diagram" />
</p>

Sokuji creates virtual audio devices to facilitate seamless audio routing:

- **Sokuji_Virtual_Speaker**: A virtual output sink that receives audio from the application
- **Sokuji_Virtual_Mic**: A virtual microphone that can be selected as input in other applications
- Automatic connection between these devices using PipeWire's `pw-link` tool
- Multi-channel support (stereo audio)
- Proper cleanup of virtual devices when the application exits

### Understanding the Audio Routing Diagram

The diagram above illustrates the audio flow between Sokuji and other applications:

- **Chromium**: Represents the Sokuji application itself
- **Google Chrome**: Represents meeting applications like Google Meet, Microsoft Teams, or Zoom running in Chrome
- **Sokuji_Virtual_Speaker**: A virtual speaker created by Sokuji
- **Sokuji_Virtual_Mic**: A virtual microphone created by Sokuji
- **HyperX 7.1 Audio**: Represents a physical audio device

The numbered connections in the diagram represent:

**Connection ①**: Sokuji's audio output is always sent to the virtual speaker (this cannot be changed)  
**Connection ②**: Sokuji's audio is also always routed to the virtual microphone (this cannot be changed)  
**Connection ③**: The monitoring device selected in Sokuji's audio settings, used to play back the translated audio  
**Connection ④**: The audio output device selected in Google Meet/Microsoft Teams (configured in their settings)  
**Connection ⑤**: The virtual microphone selected as input in Google Meet/Microsoft Teams (configured in their settings)  
**Connection ⑥**: The input device selected in Sokuji's audio settings  

This routing system allows Sokuji to capture audio from your selected input device, process it through the selected AI provider, and then output the translated audio both to your local speakers and to other applications via the virtual microphone.

# Preparation

- (required) An OpenAI or Google Gemini API key.
- (required) Linux with PulseAudio or PipeWire for virtual audio device support (desktop app only)

# Installation

## From Source

### Prerequisites

- Node.js (latest LTS version recommended)
- npm
- For Linux virtual audio device support:
  - PulseAudio or PipeWire
  - PipeWire tools (`pw-link`)

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

### Debian Package

Download the latest Debian package from the [releases page](https://github.com/kizuna-ai-lab/sokuji/releases) and install it:

```bash
sudo dpkg -i sokuji_*.deb
```

# How to Use

1. **Setup your API key**:
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/api-settings.png" alt="API Settings" />
   </p>
   
   - Click the Settings button in the top-right corner
   - Select your desired provider (OpenAI or Gemini).
   - Enter your API key for the selected provider and click "Validate".
   - Click "Save" to store your API key securely.

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

4. **Use with other applications**:
   - Select "Sokuji_Virtual_Mic" as the microphone input in your target application
   - The translated audio will be sent to that application

# Technologies Used

- Electron 34
- React 18
- TypeScript
- OpenAI & Google Gemini APIs
- PulseAudio/PipeWire for virtual audio devices
- SASS for styling
- Lucide React for icons

# License

[AGPL-3.0](LICENSE)
