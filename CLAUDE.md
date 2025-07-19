# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sokuji is a real-time AI-powered translation application available as both an Electron desktop app and a browser extension. It provides live speech translation using OpenAI, Google Gemini, and Palabra.ai APIs with modern audio processing capabilities.

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

## Architecture Overview

### Dual Platform Architecture
The codebase supports both Electron desktop app and Chrome/Edge browser extension from a shared React codebase:
- **Shared code**: `src/` directory contains all React components and business logic
- **Electron-specific**: `electron/` directory, virtual audio device management
- **Extension-specific**: `extension/` directory, manifest.json, background scripts

### Key Architectural Components

1. **Service Layer Pattern**
   - `ServiceFactory` creates platform-specific implementations
   - All services implement interfaces (IAudioService, ISettingsService)
   - Platform detection: `window.electronAPI` indicates Electron environment

2. **AI Client Architecture**
   - `ClientFactory` creates provider-specific clients
   - Providers: OpenAI, Gemini, PalabraAI
   - Each client implements `IClient` interface
   - Real-time communication via WebSocket or REST APIs

3. **Audio Processing Pipeline**
   ```
   Input Device → ModernAudioRecorder → AI Provider → ModernAudioPlayer → Output Device
   ```
   - `ModernAudioRecorder`: Captures input with echo cancellation and optional passthrough
   - `ModernAudioPlayer`: Queue-based playback with event-driven processing
   - Unified audio service across all platforms (no virtual devices)

4. **State Management**
   - React Context API for global state
   - Key contexts: AudioContext, SessionContext, SettingsContext, LogContext
   - No external state management libraries

5. **Audio Service Management**
   - `ModernBrowserAudioService` provides unified audio handling
   - Cross-platform compatibility without virtual devices
   - Automatic device switching and reconnection

## Important Patterns and Conventions

### Code Organization
- Components in `src/components/` - functional React components with TypeScript
- Services in `src/services/` - implement interface contracts
- AI clients in `src/lib/ai-clients/` - provider-specific implementations
- Audio modules in `src/lib/modern-audio/` - Web Audio API based

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
- Passthrough audio uses dedicated 'passthrough' track ID for real-time monitoring

## Testing and Quality

### Running Tests
- Tests use Vitest framework
- Test files colocated with components (*.test.tsx)
- Run specific test: `npm run test -- path/to/test`

### Code Style
- TypeScript for type safety
- English-only for all comments and documentation
- Conventional commit format for git commits

## Common Development Tasks

### Adding a New AI Provider
1. Create client class implementing `IClient` in `src/lib/ai-clients/`
2. Add provider config extending `ProviderConfig`
3. Update `ClientFactory` to handle new provider
4. Add UI controls in SettingsPanel

### Modifying Audio Pipeline
1. Audio processing in `src/lib/modern-audio/`
2. Test with both regular and passthrough audio
3. Ensure echo cancellation is working properly
4. Handle browser security restrictions and permissions

### Debugging Audio Issues
- Check DevTools console for audio errors
- Verify device permissions granted
- Test echo cancellation settings in browser
- Monitor LogsPanel for real-time diagnostics
- Check ScriptProcessor audio processing callbacks

## Platform Requirements

### Electron App
- Works on all platforms (Windows, macOS, Linux)
- Node.js LTS version
- Electron 34+

### Browser Extension
- Chrome/Edge/Chromium browsers
- Manifest V3 compatible
- Side panel API support