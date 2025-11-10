# Sokuji Browser Extension

AI-powered instant speech translation for all video meetings. Break language barriers with real-time voice translation.

## Features

- **Real-time speech translation** using OpenAI & Google Gemini APIs
- **Smart site detection** - Shows supported sites when clicking the extension icon
- **Seamless integration** with Google Meet, Microsoft Teams, Zoom, and Gather Town
- **Virtual microphone** functionality for meeting integration
- **Customizable settings** for voice, model, and translation preferences

## Supported Platforms

- **Google Meet** (meet.google.com)
- **Microsoft Teams** (teams.microsoft.com)
- **Microsoft Teams Live** (teams.live.com)
- **Zoom** (app.zoom.us)
- **Gather Town** (app.gather.town, app.v2.gather.town)

## How to Use

### 1. Extension Icon Behavior

When you click the Sokuji extension icon:

- **On supported sites**: Shows a popup with quick start instructions and an "Open Sokuji" button
- **On unsupported sites**: Shows a popup listing all supported sites with helpful navigation

### 2. Getting Started on Supported Sites

1. Navigate to a supported video meeting platform
2. Click the Sokuji extension icon
3. Click "Open Sokuji" in the popup
4. Configure your API key (OpenAI or Gemini) in the settings.
5. Select "Sokuji_Virtual_Mic" as your microphone in the meeting
6. Start speaking to see real-time translation!

### 3. Platform-Specific Notes

#### Gather Town
- Works seamlessly with Gather Town's spatial audio features (both classic and v2 versions)
- Select "Sokuji Virtual Microphone" in Gather Town's audio settings
- The extension automatically detects when you're in a Gather Town space
- Supports both proximity-based conversations and larger group meetings

#### Zoom
- Requires selecting "Sokuji Virtual Microphone" in Zoom's audio settings
- For optimal performance, set background noise suppression to "Browser built-in noise suppression"
- Works in both main Zoom meetings and breakout rooms

### 4. Configuration

The extension provides comprehensive settings for:

- **API Configuration**: Select your provider (OpenAI/Gemini), enter the API key, and choose a model.
- **Voice Settings**: Voice selection and audio parameters
- **Translation Settings**: System instructions and language preferences
- **Audio Settings**: Input/output device selection and noise reduction (for supported providers)

## Installation

### From Chrome Web Store

Install directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/ppmihnhelgfpjomhjhpecobloelicnak).

### Developer Mode Installation

1. Download the latest `sokuji-extension.zip` from the [releases page](https://github.com/kizuna-ai-lab/sokuji/releases)
2. Extract the zip file to a folder
3. Open Chrome and go to `chrome://extensions/`
4. Enable "Developer mode" in the top right corner
5. Click "Load unpacked" and select the extracted folder
6. The Sokuji extension will be installed and ready to use

## Development

### Building the Extension

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Build for development with watch mode
npm run dev
```

### Project Structure

```
extension/
├── background/          # Background script for extension logic
├── content/            # Content scripts for site integration
├── fullpage/           # Main application UI (React)
├── icons/              # Extension icons
├── dist/               # Built extension files
├── popup.html          # Popup HTML template
├── popup.js            # Popup JavaScript logic
├── popup.css           # Popup styles
├── manifest.json       # Extension manifest
└── webpack.config.js   # Build configuration
```

## Recent Updates

### v0.3.9 - Smart Site Detection

- **New popup interface** when clicking the extension icon
- **Automatic site detection** - shows different content for supported vs unsupported sites
- **Improved user experience** with clear instructions and navigation
- **Quick access** to supported platforms from any website

### Previous Features

- Zoom support for web client meetings
- Virtual microphone functionality
- Real-time audio processing and translation
- Comprehensive settings panel
- Audio device management

## Troubleshooting

### Extension Icon Not Working

1. Refresh the current page
2. Check if you're on a supported site
3. Try clicking the extension icon again

### Virtual Microphone Issues

1. Ensure you've selected "Sokuji_Virtual_Mic" in your meeting platform
2. Check microphone permissions in Chrome
3. Verify your API key for the selected provider (OpenAI/Gemini) is configured correctly

### Audio Quality Issues

1. Check your input device selection in Sokuji settings
2. Adjust noise reduction settings
3. Ensure stable internet connection for API calls

## Support

For issues, feature requests, or questions:

- [GitHub Issues](https://github.com/kizuna-ai-lab/sokuji/issues)
- [Chrome Web Store Reviews](https://chromewebstore.google.com/detail/ppmihnhelgfpjomhjhpecobloelicnak)

## License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](../LICENSE) file for details.
