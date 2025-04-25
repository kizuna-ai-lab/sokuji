<p align="center">
  <img width="200" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/src/assets/logo.png" alt="Sokuji Logo">
</p>

<p align="center">
  <em>Real-time simultaneous interpretation powered by OpenAI's Realtime API</em>
</p>

<p align="center">
  <a href="LICENSE" target="_blank">
    <img alt="AGPL-3.0 License" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg?style=flat-square" />
  </a>
  
  <!-- TypeScript Badge -->
  <img alt="TypeScript" src="https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  
  <!-- React Badge -->
  <img alt="React" src="https://img.shields.io/badge/-React-61DAFB?style=flat-square&logo=react&logoColor=black" />
  
  <!-- Electron Badge -->
  <img alt="Electron" src="https://img.shields.io/badge/-Electron-47848F?style=flat-square&logo=electron&logoColor=white" />
  
  <!-- Linux Badge -->
  <img alt="Linux" src="https://img.shields.io/badge/-Linux-FCC624?style=flat-square&logo=linux&logoColor=black" />
</p>

# Why Sokuji?

Sokuji is a desktop application designed to provide real-time simultaneous interpretation using OpenAI's Realtime API. It bridges language barriers in live conversations by capturing audio input, processing it through OpenAI's advanced models, and delivering translated output in real-time.

<p align="center">
  <img width="800" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/main-interface.png" alt="Sokuji Interface" />
</p>

# More than just translation

Sokuji goes beyond basic translation by offering a complete audio routing solution with virtual device management, allowing for seamless integration with other applications. It provides a modern, intuitive interface with real-time audio visualization and comprehensive logging.

# Features

1. **Real-time speech translation** using OpenAI's Realtime API
2. Support for **GPT-4o Realtime** and **GPT-4o mini Realtime** models
3. **Automatic turn detection** with multiple modes (Normal, Semantic, Disabled)
4. **Audio visualization** with waveform display
5. **Virtual audio device** creation and management on Linux (using PulseAudio/PipeWire)
6. **Automatic audio routing** between virtual devices
7. **Audio input and output device selection**
8. **Comprehensive logs** for tracking API interactions
9. **Customizable model settings** (temperature, max tokens)
10. **User transcript model selection** (gpt-4o-mini-transcribe, gpt-4o-transcribe, whisper-1)
11. **Noise reduction options** (None, Near field, Far field)
12. **API key validation** with real-time feedback
13. **Configuration persistence** in user's home directory
14. **Multi-channel audio support** (stereo)
15. **Push-to-talk functionality** with Space key shortcut

# Audio Routing

<p align="center">
  <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/audio-routing.png" alt="Audio Routing Diagram" />
</p>

Sokuji creates virtual audio devices to facilitate seamless audio routing:

- **sokuji_virtual_output**: A virtual output sink that receives audio from the application
- **sokuji_virtual_mic**: A virtual microphone that can be selected as input in other applications
- Automatic connection between these devices using PipeWire's `pw-link` tool
- Multi-channel support (stereo audio)
- Proper cleanup of virtual devices when the application exits

# Preparation

- (required) An OpenAI API key with access to the Realtime API
- (required) Linux with PulseAudio or PipeWire for virtual audio device support

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

### AppImage

1. Make the AppImage executable:
   ```bash
   chmod +x Sokuji-0.1.0.AppImage
   ```

2. Run the application:
   ```bash
   ./Sokuji-0.1.0.AppImage
   ```

### Debian Package

Install the Debian package:
```bash
sudo dpkg -i sokuji_0.1.0_amd64.deb
```

# How to Use

<p align="center">
  <img width="800" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/usage-guide.gif" alt="Usage Guide" />
</p>

1. **Setup your API key**:
   - Click the Settings button in the top-right corner
   - Enter your OpenAI API key and click "Validate"
   - Click "Save" to store your API key securely

2. **Configure audio devices**:
   - Click the Audio button to open the Audio panel
   - Select your input device (microphone)
   - Select your output device (speakers/headphones)

3. **Start a session**:
   - Click "Start Session" to begin
   - Speak into your microphone
   - View real-time transcription and translation

4. **Use with other applications**:
   - Select "sokuji_virtual_mic" as the microphone input in your target application
   - The translated audio will be sent to that application

# Technologies Used

- Electron 34
- React 18
- TypeScript
- OpenAI Realtime API
- PulseAudio/PipeWire for virtual audio devices
- SASS for styling
- React-Feather for icons

# License

[AGPL-3.0-1-ov-file](LICENSE)
