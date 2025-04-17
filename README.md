# Sokuji

A simultaneous interpretation application built with Electron 34 and React, using OpenAI's Realtime API.

## Features

- Real-time speech translation using OpenAI's Realtime API
- Support for GPT-4o Realtime and GPT-4o mini Realtime models
- Modern React-based UI inspired by OpenAI Realtime interface
- Automatic turn detection with multiple modes (Normal, Semantic, Disabled)
- Audio visualization with waveform display
- Virtual audio device creation and management on Linux (using PulseAudio/PipeWire)
- Automatic connection between virtual audio devices for seamless audio routing
- Audio input and output device selection
- Comprehensive logs for tracking API interactions
- Customizable model settings (temperature, max tokens)
- User transcript model selection (gpt-4o-mini-transcribe, gpt-4o-transcribe, whisper-1)
- Noise reduction options (None, Near field, Far field)
- API key validation with real-time feedback
- OpenAI token generation and management
- Configuration persistence in user's home directory
- Visual indicators for virtual microphone selection
- Multi-channel audio support (stereo)
- Proper cleanup of audio resources and connections

## UI Layout

- Left-right split layout:
  - Left panel: Main conversation area with floating controls
  - Right panel: Settings/Logs panel with toggle functionality
- Audio panel for input/output device selection and virtual device management
- Settings panel with system instructions, turn detection modes, and model configuration
- Logs panel for tracking API interactions and token usage
- Floating controls for audio device selection and session management
- API key validation interface with real-time feedback

## Audio Routing

Sokuji creates virtual audio devices to facilitate seamless audio routing:

- **sokuji_virtual_output**: A virtual output sink that receives audio from the application
- **sokuji_virtual_mic**: A virtual microphone that can be selected as input in other applications
- Automatic connection between these devices using PipeWire's `pw-link` tool
- Multi-channel support (stereo audio)
- Proper cleanup of virtual devices when the application exits
- Orphaned device cleanup on application startup

## Development Setup

### Prerequisites

- Node.js (latest LTS version recommended)
- npm
- For Linux virtual audio device support:
  - PulseAudio or PipeWire
  - PipeWire tools (`pw-link`)

### Installation

1. Clone the repository
   ```
   git clone https://github.com/kizuna-ai-lab/sokuji.git
   cd sokuji
   ```

2. Install dependencies
   ```
   npm install
   ```

3. Launch the application and input your OpenAI API key in the Settings panel
    - Click the Settings button in the top-right corner
    - Scroll to the "OpenAI API Key" section
    - Enter your API key and click "Validate"
    - Click "Save" to store your API key securely
### Running the Application

#### Development Mode

Start the application in development mode:

```
npm run electron:dev
```

This will start both the React development server and Electron.

#### Production Build

Build the application for production:

```
npm run electron:build
```

This creates:
- An AppImage file in the `dist` directory
- A Debian package (`.deb`) for system-wide installation

## Installation from Packages

### AppImage

1. Make the AppImage executable:
   ```
   chmod +x Sokuji-0.1.0.AppImage
   ```

2. Run the application:
   ```
   ./Sokuji-0.1.0.AppImage
   ```

### Debian Package

Install the Debian package:
```
sudo dpkg -i sokuji_0.1.0_amd64.deb
```

## Technologies Used

- Electron 34
- React 18
- TypeScript
- OpenAI Realtime API
- PulseAudio/PipeWire for virtual audio devices
- SASS for styling
- React-Feather for icons

## License

[MIT](LICENSE)
