# Extension Audio Profile Notification Feature

## Overview

The Audio Profile Notification feature provides users with Zoom-specific guidance on optimizing their audio settings for the best experience with Sokuji. This feature automatically displays helpful notifications when users visit Zoom web client.

## Supported Platforms

### Zoom (`app.zoom.us`)
- **Message**: "For optimal audio quality, please set Background noise suppression to 'Browser built-in noise suppression' in your Audio Profile settings. This prevents audio stuttering and ensures smooth transmission."
- **Content Script**: `zoom-content.js`

## Features

### Smart Display Logic
- Notifications appear 3 seconds after page load to allow Zoom to initialize
- Only shows once per session unless user chooses "Remind me later"
- Automatically dismisses after 30 seconds if no interaction
- Prevents duplicate notifications on the same page
- Works in both main Zoom page and webclient iframe

### User Controls
- **"Got it" button**: Dismisses the notification and stores dismissal state in localStorage
- **"Remind me later" button**: Dismisses the notification and shows it again after 10 minutes

### Visual Design
- Modern gradient background with professional styling
- Warning icon to indicate importance
- Responsive design that works on different screen sizes
- Hover effects for better user interaction

## Technical Implementation

### Content Script
The feature is implemented in the Zoom-specific content script:

- **`zoom-content.js`** - Handles Zoom's complex iframe structure and provides Zoom-specific functionality

### Key Functions

#### `showAudioProfileNotification()`
- Main function that creates and displays the notification
- Handles iframe detection for Zoom's webclient
- Sets up event listeners for user interactions
- Creates notification with inline CSS for maximum compatibility
- Manages auto-dismiss timer and user interaction handling

### Storage
- Uses `localStorage` to track dismissal state
- Key: `sokuji-zoom-audio-profile-dismissed`
- Value: `'true'` when dismissed, removed when reset

## Debugging API

The Zoom content script exposes debugging APIs for testing and troubleshooting:

### Zoom Content Script (`window.sokujiZoomContent`)
```javascript
// Check current status (includes Zoom-specific info)
window.sokujiZoomContent.getStatus()

// Manually show notification
window.sokujiZoomContent.showAudioProfileNotification()

// Reset dismissal state
window.sokujiZoomContent.resetAudioProfileNotificationDismissal()

// Check microphone selection status
window.sokujiZoomContent.checkMicrophoneSelection()
```

### Available Status Information
The `getStatus()` method returns:
- `initialized`: Whether the content script is initialized
- `isWebclientIframe`: Whether running in Zoom's webclient iframe
- `hasVirtualMic`: Whether virtual microphone is available
- `canInjectAudio`: Whether audio injection is possible
- `microphoneMonitorActive`: Whether microphone monitoring is active
- `audioProfileNotificationDismissed`: Whether notification was dismissed

## Testing

### Manual Testing via Browser Console
Since no dedicated test page exists, testing can be performed directly on Zoom using the browser console:

1. Navigate to `app.zoom.us` in Chrome with the extension loaded
2. Open browser Developer Tools (F12)
3. Use the debugging API commands in the console:

```javascript
// Check current status
window.sokujiZoomContent.getStatus()

// Manually trigger notification
window.sokujiZoomContent.showAudioProfileNotification()

// Reset dismissal state to test again
window.sokujiZoomContent.resetAudioProfileNotificationDismissal()

// Check microphone selection (if audio menu is open)
window.sokujiZoomContent.checkMicrophoneSelection()
```

### Testing Scenarios
- **First visit**: Notification should appear after 3 seconds
- **After dismissal**: Notification should not appear again in the same session
- **Remind later**: Notification should reappear after 10 minutes
- **Auto-dismiss**: Notification should disappear after 30 seconds if no interaction

## Configuration

### Timing Settings
- **Initial delay**: 3 seconds after page load
- **Auto-dismiss**: 30 seconds if no interaction
- **Remind later**: 10 minutes (600,000ms)

### Styling
The notification uses inline CSS for maximum compatibility and to avoid conflicts with Zoom's styles. Key styling features:
- Fixed positioning in top-right corner
- High z-index (10000) to appear above other content
- Gradient background for visual appeal
- Responsive max-width for mobile compatibility

## Zoom-Specific Implementation Details

### Iframe Handling
Zoom's web client uses a complex iframe structure. The notification system handles this by:
- Detecting whether the script is running in the main page or webclient iframe
- Using `MutationObserver` to wait for iframe availability
- Injecting notifications into the appropriate document context

### Integration with Zoom Features
The notification system works alongside other Zoom-specific features:
- Virtual microphone injection
- Microphone selection monitoring
- Permission iframe handling

## Browser Compatibility

- **Chrome**: Full support (primary target)
- **Firefox**: Compatible with browser.runtime API fallback
- **Edge**: Compatible via Chrome extension compatibility

## Security Considerations

- Uses Content Security Policy compliant inline styles
- No external resources loaded
- localStorage access is wrapped in try-catch blocks
- All user inputs are properly sanitized
- Respects Zoom's iframe security boundaries

## Future Enhancements

Potential improvements for future versions:
- Localization support for multiple languages
- Integration with extension settings panel
- Analytics on notification effectiveness
- A/B testing for different message formats
- Detection of current Zoom audio settings to show more targeted advice
- Creation of dedicated test page for functionality testing 