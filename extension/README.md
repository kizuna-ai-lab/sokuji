# Sokuji Browser Extension

This is the browser extension version of the Sokuji real-time translation application, providing simultaneous interpretation functionality using OpenAI's Realtime API.

## Features

- Reuses most of the code from the original Sokuji React application
- Provides the same functionality as the desktop application in the browser
- Supports real-time audio processing and translation
- Can be used on any webpage

## Development Environment Setup

### Install Dependencies

```bash
cd extension
npm install
```

### Development Build

```bash
npm run dev
```

This will start webpack in watch mode, automatically rebuilding the extension when you modify the code.

### Production Build

```bash
npm run build
```

## Loading the Extension in Browsers

### Chrome

1. Open Chrome browser and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked"
4. Select the `extension/dist` directory

### Firefox

1. Open Firefox browser and navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select the `extension/dist/manifest.json` file

## Usage

1. Click the Sokuji icon in the browser toolbar to open the extension popup
2. Enter your OpenAI API key in the settings
3. Configure the model and other settings
4. Click the "Start Session" button to begin

## Using in Webpages

After clicking the extension icon, you can select "Open in current page" which will inject the Sokuji interface into the current webpage. The interface can be dragged and repositioned.

## Technical Details

This browser extension uses the following technologies:

- React for the user interface
- OpenAI Realtime API for real-time translation
- Web Audio API for audio processing
- Chrome Extension API for browser integration

## Differences from Desktop Version

The main differences between the browser extension and desktop versions:

1. Uses Web Audio API instead of Electron's audio capabilities
2. Uses browser storage instead of local file system
3. No virtual audio device functionality (browser limitations)
4. Interface adapted for browser extension popup and webpage injection modes
