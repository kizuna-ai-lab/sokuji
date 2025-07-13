# Sokuji Extension - Gather Town Integration

## Overview

This document describes the Gather Town integration for the Sokuji browser extension, which enables live speech translation functionality within Gather Town virtual spaces. The integration uses a **plugin-based architecture** that allows for easy addition of new platform support.

## Architecture

### Plugin System

The Sokuji extension now uses a modular plugin system with proper context separation:

- **`content/content.js`**: Universal content script (runs in content script context)
  - Injects scripts into page context
  - Handles message passing between extension and page
  - Manages permission iframe injection
- **`content/site-plugins.js`**: Contains site-specific plugins (runs in page context)
  - Defines platform-specific functionality
  - Has access to page's `window` object and APIs
- **Plugin Initialization**: Inline script injected into page context
  - Detects current site and initializes appropriate plugin
  - Manages plugin lifecycle and debugging APIs

### Files Modified/Created

1. **`extension/manifest.json`**
   - Added `https://app.gather.town/*` to content script matches
   - Added `content/site-plugins.js` to web accessible resources
   - Updated version to 0.5.2

2. **`extension/content/content.js`** (Refactored)
   - Now serves as universal content script
   - Implements plugin loading system
   - Handles dynamic site detection and plugin initialization

3. **`extension/content/site-plugins.js`** (New)
   - Contains Gather Town plugin implementation
   - Provides framework for adding new platform plugins
   - Includes audio monitoring and guidance notification features

4. **`extension/background/background.js`**
   - Added `app.gather.town` to ENABLED_SITES array

5. **`extension/popup.js`**
   - Added Gather Town to ENABLED_SITES and SITE_INFO

## Gather Town Plugin Features

### Core Functionality

1. **Virtual Microphone Integration**
   - Injects Sokuji Virtual Microphone into Gather Town's WebRTC audio system
   - Compatible with Gather Town's spatial audio features
   - Seamless audio routing for translation

2. **Audio System Monitoring**
   - Detects Gather Town's audio controls interface
   - Monitors microphone selection dropdown
   - Verifies virtual microphone availability

3. **User Guidance System**
   - Platform-specific notification with Gather Town branding
   - Interactive guidance with "Got it" and "Remind me later" options
   - Session-based dismissal tracking
   - Auto-dismiss after 30 seconds

4. **Spatial Audio Support**
   - Works with Gather Town's proximity-based conversations
   - Maintains audio quality for group discussions
   - Supports both individual and group interactions

### Technical Implementation

#### Plugin Structure

```javascript
const gatherTownPlugin = {
  name: 'Gather Town',
  hostname: 'app.gather.town',
  
  init() {
    // Plugin initialization
  },

  monitorAudio() {
    // Audio system monitoring
  },

  showGuidance() {
    // User guidance notification
  },

  getDebugInfo() {
    // Debug information
  },

  resetGuidanceDismissal() {
    // Reset guidance state
  }
};
```

#### Audio Controls Detection

The plugin monitors for Gather Town's audio interface elements:

- `[data-testid="audio-controls"]`
- `.audio-controls`
- Elements with audio/microphone class patterns

#### Virtual Microphone Detection

Checks for "Sokuji Virtual Microphone" in:
- Select dropdown options
- Combobox role elements
- Audio settings interfaces

## Usage Instructions

### For Users

1. **Navigate to Gather Town**
   - Open any Gather Town space (`https://app.gather.town/*`)
   - The extension will automatically detect the platform

2. **Setup Audio**
   - Open Gather Town's audio settings
   - Select "Sokuji Virtual Microphone" from the microphone dropdown
   - The guidance notification will provide platform-specific instructions

3. **Use Translation Features**
   - Open Sokuji side panel
   - Configure translation settings
   - Start speaking - translation will work through spatial audio

### For Developers

#### Adding New Platform Plugins

1. **Create Plugin Object** in `site-plugins.js`:
```javascript
const newPlatformPlugin = {
  name: 'Platform Name',
  hostname: 'platform.domain.com',
  
  init() {
    // Platform-specific initialization
  },

  monitorAudio() {
    // Platform audio system monitoring
  },

  showGuidance() {
    // Platform-specific user guidance
  }
};
```

2. **Register Plugin**:
```javascript
window.sokujiSitePlugins = {
  'platform.domain.com': newPlatformPlugin,
  // ... other plugins
};
```

3. **Update Manifest** (if needed):
```json
{
  "content_scripts": [
    {
      "matches": ["https://platform.domain.com/*"],
      "js": ["content.js"],
      "run_at": "document_start"
    }
  ]
}
```

## Debugging

### Browser Console Commands

```javascript
// Check content script status
window.sokujiContentScript.getStatus()

// Check page context status (plugins run in page context)
window.sokujiPageContext.getStatus()

// Get current plugin (page context)
window.sokujiPageContext.getCurrentPlugin()

// Get available plugins (page context)
window.sokujiPageContext.getAvailablePlugins()

// Gather Town specific debugging (page context)
window.sokujiSitePlugins['app.gather.town'].getDebugInfo()

// Reset guidance dismissal (page context)
window.sokujiSitePlugins['app.gather.town'].resetGuidanceDismissal()
```

### Common Issues

1. **Plugin Not Loading**
   - Check if `content/site-plugins.js` is accessible
   - Verify web accessible resources in manifest
   - Check browser console for loading errors

2. **Audio Controls Not Detected**
   - Gather Town interface may have changed
   - Check audio controls selectors in plugin
   - Use debug commands to verify detection

3. **Virtual Microphone Not Available**
   - Ensure microphone permissions are granted
   - Check if virtual microphone script loaded
   - Verify WebRTC API availability

## Platform-Specific Notes

### Gather Town Compatibility

- **Spatial Audio**: Fully compatible with proximity-based conversations
- **Group Calls**: Supports multi-participant discussions
- **Audio Quality**: Maintains high-quality audio for translation
- **Interface**: Integrates seamlessly with Gather Town's audio controls

### Browser Support

- **Chrome**: Full support (v116+)
- **Edge**: Full support (Chromium-based)
- **Firefox**: Limited support (WebRTC differences)

## Version History

- **v0.5.2**: Added Gather Town support with plugin architecture
- **v0.5.1**: Base extension functionality
- **v0.5.0**: Initial release

## Future Enhancements

1. **Additional Platform Plugins**
   - Discord web client
   - Slack huddles
   - Other virtual meeting platforms

2. **Enhanced Audio Features**
   - Audio quality optimization
   - Noise reduction integration
   - Advanced spatial audio handling

3. **User Experience Improvements**
   - Customizable guidance notifications
   - Platform-specific settings
   - Advanced debugging tools

## Support

For issues specific to Gather Town integration:

1. Check browser console for error messages
2. Use debugging commands to verify plugin status
3. Ensure latest extension version is installed
4. Report issues with platform and browser version details 