# Sokuji React

A simultaneous interpretation application built with Electron 34 and React, using OpenAI's Realtime API.

## Features

- Real-time speech translation using OpenAI's Realtime API
- Support for GPT-4o Realtime and GPT-4o mini Realtime models
- Modern React-based UI inspired by OpenAI Realtime interface
- Automatic turn detection with multiple modes (Normal, Semantic, Disabled)
- Audio visualization with waveform display
- Comprehensive logs for tracking API interactions
- Customizable model settings (temperature, max tokens)
- User transcript model selection (gpt-4o-mini-transcribe, gpt-4o-transcribe, whisper-1)
- Noise reduction options (None, Near field, Far field)

## UI Layout

- Left-right split layout:
  - Left panel: Main conversation area with floating controls
  - Right panel: Settings/Logs panel with toggle functionality
- Settings panel with system instructions, turn detection modes, and model configuration
- Logs panel for tracking API interactions
- Floating controls for audio device selection and session management

## Development Setup

### Prerequisites

- Node.js (latest LTS version recommended)
- npm

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

3. Create a `.env` file in the root directory and add your OpenAI API key:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```

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

## Technologies Used

- Electron 34
- React 18
- TypeScript
- OpenAI Realtime API
- SASS for styling
- React-Feather for icons

## License

[MIT](LICENSE)
