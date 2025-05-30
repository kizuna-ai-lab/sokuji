# Sokuji Browser Extension

This is the browser extension version of the Sokuji live speech translation application, leveraging OpenAI's Realtime API to provide live speech translation capabilities directly in your browser.

<a href="https://www.producthunt.com/posts/sokuji?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-sokuji" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=967440&theme=light&t=1748250774125" alt="Sokuji - Live&#0032;speech&#0032;translation&#0032;with&#0032;real&#0045;time&#0032;AI | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

## Features

- Live speech translation using OpenAI's Realtime API
- Seamless integration with web browsers while maintaining desktop app functionality
- Interactive audio visualization with input/output level indicators
- Push-to-talk functionality with Space key shortcut support
- Google Meet and Microsoft Teams integration with audio replacement capabilities
- Draggable and repositionable interface when injected into webpages
- Settings panel for API key configuration and audio preferences

## Video Conferencing Integration

The extension includes special functionality for Google Meet and Microsoft Teams:

- Replace your microphone input with a looped audio file during calls
- Audio file selection with user-friendly interface
- Audio playback testing before using in a call
- Status indicators showing when audio replacement is active
- Virtual audio device that appears in microphone selection

### Google Meet Integration

- Seamlessly integrates with Google Meet's interface
- Automatically detects meeting context for proper audio routing
- Compatible with Google Meet's audio settings panel

### Microsoft Teams Integration

- Full support for Microsoft Teams web application
- Maintains translation quality during Teams meetings
- Works with Teams' audio selection interface

## Development Environment Setup

### Prerequisites

- Node.js (v20 recommended)
- npm or yarn

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

### Chrome / Chromium-based browsers

1. Navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked"
4. Select the `extension/dist` directory

### Browser Compatibility

**Note: This extension currently only supports Chrome and Chromium-based browsers. Firefox is not supported.**

The extension uses Chrome-specific APIs like Side Panel that are not available in Firefox.

## Usage

1. Click the Sokuji icon in the browser toolbar to open the extension popup
2. Enter your OpenAI API key in the settings panel (this is the first setting for easy access)
3. Configure language models and audio preferences
4. Click the "Start Session" button to begin interpretation
5. Use the push-to-talk feature (Space key) when enabled

## Using with Video Conferencing

To use Sokuji with Google Meet or Microsoft Teams:

1. Join a video call
2. Click the Sokuji extension icon
3. Select "Open in Google Meet" or "Open in Microsoft Teams" based on your platform
4. The extension will automatically detect the meeting and inject the controls
5. Use the audio replacement feature to play pre-recorded audio during the call

### Google Meet Specific Instructions

To use Sokuji with Google Meet:

1. Join a Google Meet call
2. Click the Sokuji extension icon
3. Select "Open in Google Meet"
4. The extension will automatically detect the meeting and inject the controls
5. Use the audio replacement feature to play pre-recorded audio during the call

### Microsoft Teams Specific Instructions

To use Sokuji with Microsoft Teams:

1. Join a Microsoft Teams meeting in your browser
2. Click the Sokuji extension icon
3. Select "Open in Microsoft Teams"
4. Configure your translation settings as needed
5. The extension will integrate with Teams' audio system

## Troubleshooting

### Microphone Access
If the extension can't access your microphone:
- Click the extension icon in the toolbar
- Look for the microphone permission prompt and click "Allow"
- If you previously denied access, click the lock icon in the address bar and update the site settings

### Audio Not Working
- Ensure you've selected the correct input/output devices in the Audio settings
- Check your browser's audio settings to verify the correct devices are selected
- Try refreshing the page where the extension is being used

## Using in Webpages

After clicking the extension icon, you can select "Open in current page" to inject the Sokuji interface into the current webpage. The interface features:

- Draggable positioning for convenient placement
- Compact design that doesn't interfere with webpage content
- Panel system where only one panel (Settings, Logs, or Audio) can be open at a time

## Technical Architecture

This browser extension uses the following technologies:

- React for the user interface components
- OpenAI Realtime API for live speech translation
- Web Audio API and wavtools library for audio processing
- Chrome Extension APIs for browser integration
- Webpack for building and bundling
- Platform-specific integrations for Google Meet and Microsoft Teams

## Differences from Desktop Version

The browser extension differs from the desktop application in several ways:

1. Uses Web Audio API instead of Electron's audio capabilities
2. Leverages browser storage instead of local file system
3. Provides Google Meet and Microsoft Teams audio replacement functionality
4. Features an interface adapted for browser extension popup and webpage injection
5. Maintains the same core functionality while working within browser constraints
