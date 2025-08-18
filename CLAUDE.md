# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sokuji is a real-time AI-powered translation application available as both an Electron desktop app and a browser extension. It provides live speech translation using OpenAI, Google Gemini, CometAPI, Palabra.ai, and Kizuna AI APIs with modern audio processing capabilities.

## Development Commands

### Running the Application
```bash
# Run Electron app in development mode
npm run electron:dev

# Run React app only (for browser extension development)
npm run dev

# Build Electron app for production
npm run electron:build

# Run tests
npm run test

# Run tests with UI
npm run test:ui

# Run specific test
npm run test -- path/to/test
```

### Building and Packaging
```bash
# Build React app
npm run build

# Package Electron app
npm run package

# Create distributable packages
npm run make
```

### Version Update Process
1. Update version in root `package.json`
2. Update version in `extension/package.json`  
3. Update version in `extension/manifest.json`
4. Commit version changes with conventional commit format (e.g., `chore(release): v0.1.0`)
5. Create annotated tag with the same version (e.g., `git tag -a v0.1.0 -m "Release v0.1.0"`)
6. Push changes and tags to remote repository

## Architecture Overview

### Dual Platform Architecture
The codebase supports both Electron desktop app and Chrome/Edge browser extension from a shared React codebase:
- **Shared code**: `src/` directory contains all React components and business logic
- **Electron-specific**: `electron/` directory, virtual audio device management (Linux only)
- **Extension-specific**: `extension/` directory, manifest.json, background scripts

### Key Architectural Components

1. **Service Layer Pattern**
   - `ServiceFactory` creates platform-specific implementations
   - All services implement interfaces (IAudioService, ISettingsService)
   - Platform detection: `window.electronAPI` indicates Electron environment

2. **AI Client Architecture**
   - `ClientFactory` creates provider-specific clients
   - Providers: OpenAI, Gemini, CometAPI, PalabraAI, KizunaAI
   - Each client implements `IClient` interface
   - Real-time communication via WebSocket or REST APIs
   - CometAPI uses OpenAIClient with custom host configuration
   - KizunaAI uses OpenAI-compatible API with backend-managed authentication

3. **Audio Processing Pipeline**
   ```
   Input Device → ModernAudioRecorder → AI Provider → ModernAudioPlayer → Output Device
   ```
   - `ModernAudioRecorder`: Captures input with echo cancellation, supports AudioWorklet with ScriptProcessor fallback
   - `ModernAudioPlayer`: Queue-based playback with event-driven processing and volume control
   - Unified audio service across all platforms with virtual device support in Electron (Linux only)

4. **State Management**
   - React Context API for global state
   - Key contexts: AudioContext, SessionContext, SettingsContext, LogContext, OnboardingContext, AuthContext
   - No external state management libraries
   - Backend-managed API key integration for authenticated providers

5. **Audio Service Management**
   - `ModernBrowserAudioService` provides unified audio handling
   - Cross-platform compatibility without virtual devices
   - Automatic device switching and reconnection, including dynamic switching during active sessions

## Important Patterns and Conventions

### Code Organization
- Components in `src/components/` - functional React components with TypeScript
  - `SimpleConfigPanel/` - Streamlined 6-section configuration interface
  - `SimpleMainPanel/` - Focused conversation view with session duration
  - `Tooltip/` - Enhanced tooltip using @floating-ui/react
  - `ConnectionStatus/` - Real-time connection status display
- Services in `src/services/` - implement interface contracts
- AI clients in `src/services/clients/` - provider-specific implementations
- Audio modules in `src/lib/modern-audio/` - Web Audio API based (JavaScript, not TypeScript)
- Provider configurations in `src/services/providers/` - provider-specific settings

### Error Handling
- All API calls wrapped in try-catch blocks
- Errors logged to LogContext for user visibility
- Graceful degradation when features unavailable

### Platform-Specific Code
```typescript
// Check if running in Electron
if (window.electronAPI) {
  // Electron-specific code
} else {
  // Browser extension code
}
```

### Audio Handling
- Always use ModernAudioPlayer/ModernAudioRecorder classes
- Audio playback uses queue-based system with event-driven processing
- Passthrough audio uses dedicated 'passthrough' track ID for real-time monitoring (default volume: 30%)
- AudioWorklet preferred for processing, falls back to ScriptProcessor for compatibility
- Echo cancellation enabled by default with modern browser APIs

## Testing and Quality

### Testing Framework
- Vitest for unit testing
- Test files colocated with components (*.test.tsx)
- Global test setup in `src/setupTests.ts`
- jsdom environment for component testing

### Code Style
- TypeScript for type safety (strict mode enabled)
- English-only for all comments and documentation
- Conventional commit format for git commits
- SASS for styling with deprecation warnings silenced

## Build Configuration

### Vite Configuration
- Development server on port 5173
- Output to `build/` directory
- Base path relative for both Electron and extension
- Source maps enabled for debugging

### TypeScript Configuration
- Target ES2020
- Strict mode enabled
- Module resolution: bundler
- JSX: react-jsx

### Electron Forge Configuration
- Packaged with ASAR
- Icons and branding in `assets/` directory
- Debian package maker for Linux distribution
- Automatic pruning of unnecessary files in production

## Dependencies

### Key Libraries
- **@floating-ui/react**: Advanced tooltip positioning and floating elements
- **i18next & react-i18next**: Internationalization framework
- **openai-realtime-api**: OpenAI real-time API client (strongly-typed fork)
- **@google/genai**: Google Gemini SDK
- **lucide-react**: Icon library
- **ws**: WebSocket client for real-time communication

### Internationalization
- Complete translations for 35+ languages
- English fallback for missing translations
- Language detection via i18next-browser-languagedetector
- **UI Language Quick Access**: 12 most common languages directly available

## Common Development Tasks

### Adding a New AI Provider
1. Create client class implementing `IClient` in `src/services/clients/`
2. Add provider config extending `ProviderConfig` in `src/services/providers/`
3. Update `ClientFactory` to handle new provider
4. Add provider to `Provider` enum in `src/types/Provider.ts`
5. Update UI controls in SettingsPanel

### Modifying Audio Pipeline
1. Audio processing modules in `src/lib/modern-audio/` (JavaScript files)
2. Test with both regular and passthrough audio
3. Ensure echo cancellation is working properly
4. Handle browser security restrictions and permissions
5. Test AudioWorklet and ScriptProcessor fallback paths

### Debugging Audio Issues
- Check DevTools console for audio errors
- Verify device permissions granted
- Test echo cancellation settings in browser
- Monitor LogsPanel for real-time diagnostics
- Check AudioWorklet/ScriptProcessor processing callbacks
- Watch for infinite loops in device switching - use deviceId in React dependencies, not device objects
- Verify audio context state (suspended/running)

### Dynamic Audio Device Switching
1. Recording devices can be switched during active sessions without interrupting the session
2. Implemented via `switchRecordingDevice` method in `ModernBrowserAudioService`
3. MainPanel detects device changes via useEffect hook
4. Important: Use `selectedInputDevice?.deviceId` string in React dependencies, not the full device object
5. The service tracks current device with `currentRecordingDeviceId` and handles reconnection automatically

## UI Components

### Simple Mode Components
- **SimpleConfigPanel**: Unified 6-section configuration interface
  - User Account - Authentication and backend-managed API key access
  - Interface Language - UI language selection
  - Translation Languages - source/target language pair selection
  - API Key - provider authentication with real-time validation
  - Microphone - input device selection with enhanced descriptions
  - Speaker - output device selection with monitoring explanations
  - Single scrollable layout replacing tabbed interface

- **SimpleMainPanel**: Streamlined conversation interface
  - Focus on conversation content display
  - Real-time session duration tracking (MM:SS or HH:MM:SS format)
  - Simplified footer with optimized control sizes
  - Device status icons with clickable navigation to settings
  - Maximum space for conversation history

- **Enhanced Tooltip**: Interactive help system
  - Powered by @floating-ui/react for accurate positioning
  - Support for hover, click, and focus triggers
  - FloatingPortal and FloatingArrow for proper rendering
  - Comprehensive help text with provider links

- **ConnectionStatus**: Visual connection indicator
  - Real-time connection state display
  - Color-coded status indicators

### UI Design System
- **Color Scheme**:
  - Input backgrounds: #333
  - Borders: #444
  - Primary action color: #10a37f
  - Secondary action color: #444
  - Error/Stop state: #e74c3c
- **Typography**:
  - Input fields: 14px
  - Descriptions: 12px
  - Footer controls: 12px (unified)
  - Status text: 13px
- **Icon Sizing**:
  - Status indicators: 14px
  - Action buttons: 16px
- **Consistent Styling**:
  - Unified dropdown styles with custom arrows
  - Standardized padding and margins
  - Consistent border-radius values (4px)
  - Button height: 24px for optimal click targets

## Platform Requirements

### Electron App
- Works on all platforms (Windows, macOS, Linux)
- Node.js LTS version
- Electron 34+
- Virtual audio devices require Linux with PulseAudio or PipeWire

### Browser Extension
- Chrome/Edge/Chromium browsers version 116+
- Manifest V3 compatible
- Side panel API support
- Content scripts for video conferencing platforms (Google Meet, Teams, Zoom, etc.)

## Extension-Specific Information

### Content Scripts
- Injected into supported video conferencing platforms
- Virtual microphone injection for seamless integration
- Separate content scripts for different platforms (zoom-content.js for Zoom)

### Web Accessible Resources
- Worklets for audio processing
- Device emulator for virtual devices
- Site-specific plugins for platform integration

### Security Policy
- Strict CSP configuration for extension pages
- Allowed connections to AI provider APIs (OpenAI, Google, Palabra, CometAPI, Kizuna AI)
- PostHog analytics integration for usage tracking

## Authentication and API Key Management

### Authentication System
- **Clerk Integration**: User authentication using Clerk service
- **Backend-Managed Keys**: Kizuna AI API keys are automatically managed by the backend
- **Mixed Authentication**: Supports both user-managed and backend-managed API keys
- **Cross-Platform**: Authentication works across Electron and browser extension

### API Key Types
1. **User-Managed Keys**: OpenAI, Gemini, CometAPI, Palabra AI - users input their own keys
2. **Backend-Managed Keys**: Kizuna AI - keys fetched from authenticated backend service

### Authentication Flow for Kizuna AI
1. User signs in via Clerk authentication
2. `ApiKeyService` fetches API key from backend endpoint (`/api/user/api-key`)
3. API key is cached for 5 minutes to reduce backend load
4. Provider becomes available in UI only when authenticated and key is available

### Key Services
- **ApiKeyService**: Handles fetching API keys from backend with caching
- **AuthContext**: Manages authentication state and token lifecycle
- **Service Integration**: All AI clients check authentication before operations