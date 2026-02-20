# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.14.0] - 2026-02-20

### Added

- **Intel macOS Build**: Add Intel (x64) macOS build support alongside Apple Silicon

### Changed

- **Electron 40**: Upgrade Electron 34 → 40 with toolchain updates
- **Extension Build System**: Migrate browser extension from webpack to vite and upgrade dependencies
- **CI**: Use free macos-15-intel runner instead of paid macos-15-large for x64 builds

### Fixed

- **OpenAI Audio Crackling**: Increase WebRTC PCM buffer threshold to reduce audio crackling
- **CI**: Add fail-fast: false so x64 billing issue doesn't cancel other jobs
- **CI**: Replace retired macos-13 runner with macos-15-large for x64 builds

### Removed

- **Legacy Config**: Remove unused .electronforge.config.js

## [0.13.3] - 2026-02-17

### Fixed

- **Volcengine TTS Matching**: Improved TTS-to-translation matching and added message validation
- **CI**: Pass VITE_ENABLE_PALABRA_AI secret to all build steps

## [0.13.2] - 2026-02-17

### Fixed

- **Volcengine Branding**: Rebrand Volcengine AST to Doubao AST 2.0 across all languages
- **PalabraAI Audio Crackling**: Buffer PalabraAI PCM chunks to eliminate audio crackling
- **Documentation**: Update outdated comments for Volcengine providers and macOS support

## [0.13.1] - 2026-02-16

### Fixed

- **Volcengine i18n**: Add missing Volcengine translation keys for all languages

## [0.13.0] - 2026-02-16

### Added

- **Volcengine Speech Translation**: Integrate ByteDance Volcengine as a new provider with two engines:
  - **Volcengine ST**: SpeechTranslate API with V4 signature auth and WebSocket communication
  - **Doubao AST 2.0**: Speech-to-speech translation using protobuf-over-WebSocket protocol
- **Volcengine i18n**: Add translation keys for all 30 locales

### Fixed

- **Extension Store Title**: Shorten store title to comply with Edge Add-ons policy 1.1.2

## [0.12.12] - 2026-02-15

### Fixed

- **CI**: Pass VITE_POSTHOG_KEY to Electron and macOS build steps

## [0.12.11] - 2026-02-15

### Added

- **Analytics Security**: Move PostHog key from hardcoded value to environment variables

### Fixed

- **CI**: Pass VITE_POSTHOG_KEY to build steps

## [0.12.10] - 2026-01-26

### Fixed

- **Audio Buffer**: Skip audio buffer commit for anchor messages to prevent incorrect audio handling

## [0.12.9] - 2026-01-25

### Added

- **Per-Turn Instructions**: Add ResponseConfig for per-turn instruction customization in OpenAI clients
- **Audio Device Memory**: Remember last selected input and output audio devices across sessions

### Fixed

- **Audio Volume Sync**: Sync audioService volume when restoring monitor state

## [0.12.8] - 2026-01-25

### Fixed

- **PalabraAI Client**: Restore PalabraAI to working state and unify PCM worklet across providers
- **Audio Cleanup**: Disconnect participant client when speaker disconnects

### Added

- **PalabraAI Error Display**: Display PalabraAI errors in Conversation UI for better debugging

### Changed

- **Default Model**: Change default OpenAI model to gpt-realtime-mini
- **System Instructions**: Simplify system instruction template for better translation focus
- **Evals**: Change judge model from gpt-4o to gpt-4o-mini; add regression test cases for direct question translation

## [0.12.7] - 2026-01-22

### Fixed

- **WebRTC VAD**: Disable server VAD in WebRTC mode to prevent translation playback interruption when user speaks

## [0.12.6] - 2026-01-22

### Added

- **PalabraAI Feature Flag**: Hide PalabraAI from UI with environment variable feature flag

### Fixed

- **WebRTC Playback**: Prevent translation playback interruption on user speech
- **PalabraAI Layout**: Add margin between PalabraAI inputs and validation message

### Changed

- **Audio Architecture**: Unify PCM buffering and native audio capture handling across providers

## [0.12.5] - 2026-01-22

### Fixed

- **Extension CSP**: Add wss://streaming.palabra.ai to Content Security Policy connect-src

## [0.12.4] - 2026-01-22

### Fixed

- **WebRTC Audio Stuttering**: Resolve audio stuttering and re-enable WebRTC transport
- **PalabraAI Settings**: Add Client Secret input field for PalabraAI provider

## [0.12.3] - 2026-01-21

### Fixed

- **WebRTC Transport**: Temporarily disable WebRTC transport option due to audio issues
- **Evals**: Handle array format in LLM Judge response parsing

### Changed

- **Evals**: Rename ai-tests to evals and add instruction override feature

## [0.12.2] - 2026-01-21

### Added

- **AI Evaluation Infrastructure**: Add complete testing infrastructure for evaluating AI translation quality, including test runner, LLM-as-Judge evaluation, and JSON schemas for test cases
- **Participant Instructions i18n**: Add participant instructions with translations for 30 locales

### Fixed

- **Evals Security**: Improve error handling and security in test runner; use constructor-resolved apiKey in LLMJudge API calls

## [0.12.1] - 2026-01-19

### Fixed

- **WebRTC Device Switching**: Enable dynamic device switching and monitor control in WebRTC mode
- **Layout**: Resolve scroll issues in side panel and mobile environments
- **Push-to-Talk**: Prevent empty audio requests in push-to-talk mode

## [0.12.0] - 2026-01-19

### Added

- **WebRTC Transport**: Add WebRTC as an alternative transport to WebSocket for OpenAI and OpenAI Compatible providers, providing lower latency audio streaming with automatic fallback to WebSocket
- **Transport Type i18n**: Add transport type translations for 30 languages

### Fixed

- **Security**: Resolve preact JSON VNode injection vulnerability

## [0.11.1] - 2026-01-17

### Added

- **Device Refresh Button**: Restored device refresh button in audio settings section header for better UX

### Changed

- **OS Detection Centralization**: Centralized OS detection utilities in environment.ts for consistent platform detection
- **Participant Audio Device Selection**: Clarified UI text for participant audio device selection purpose in browser extension

### Fixed

- **Platform-Specific UI**: Hide participant audio refresh button on Windows/macOS where it's not applicable

## [0.11.0] - 2026-01-16

### Added

- **Cross-Platform System Audio Capture**: Integrated electron-audio-loopback for Windows and macOS system audio capture
- **Windows System Audio**: Added Windows system audio capture support using native loopback audio
- **macOS Permission Check**: Added macOS screen recording permission check for participant audio capture

### Changed

- **Linux Audio Recorder**: Refactored to use LinuxLoopbackRecorder for Linux system audio capture, maintaining PulseAudio/PipeWire integration
- **Audio Recorder Architecture**: Unified system audio recorder variables using a common interface across all platforms
- **Recorder Class Naming**: Renamed audio recorder classes for better clarity and cross-platform consistency

### Technical Improvements

- **Documentation**: Fixed JSDoc return type for requestLoopbackAudioStream and clarified Linux implementation details

## [0.10.2] - 2026-01-15

### Fixed

- **macOS Microphone Permission**: Request microphone permission on startup for better user experience
- **Security Vulnerabilities**: Upgraded better-auth and override axios to fix security issues
- **Critical Vulnerability**: Override form-data dependency to fix critical vulnerability
- **React Router Security**: Upgraded react-router-dom to 7.12.0 for security fixes
- **CI Compatibility**: Added npmrc with legacy-peer-deps for better-auth compatibility

### Changed

- **Settings Components**: Unified settings components with Simple/Advanced modes for cleaner architecture
- **Extension Feedback URL**: Updated uninstall feedback URL to backend service

## [0.10.1] - 2026-01-09

### Changed

- **Audio Recorder Architecture**: Implemented three-layer inheritance hierarchy for audio recorders, improving code organization and maintainability

## [0.10.0] - 2026-01-07

### Added

- **System Audio Capture**: Added system audio capture for participant translation, enabling translation of other participants' speech in video calls (Electron app only, Linux initially)
- **Enhanced Error Display**: Improved OpenAI error message display with more descriptive and user-friendly error messages

### Changed

- **Backend Migration**: Removed backend directory from repository (moved to separate sokuji-backend repo)

## [0.9.19] - 2025-02-01

### Added

- **Better Auth Cloudflare Backend**: Initialized Cloudflare Workers backend with Better Auth integration (WIP)
- **Authentication Improvements**: Added close button to authentication pages for better UX
- **Extension Popup Layout**: Optimized popup layout with compact 4-column grid design

### Changed

- **Updated README**: Enhanced backend-cf README and index implementation documentation

### Fixed

- **Better Auth Error Handling**: Implemented proper error handling for Better Auth authentication flows

### Removed

- **Backend Directory Cleanup**: Removed obsolete backend-cf directory during refactoring

## [0.9.4] - 2025-01-31

### Added

- **Comprehensive Analytics Tracking**: Implemented PostHog analytics with 40+ event types for better product insights
- **Privacy-First Analytics**: Added automatic data sanitization and user privacy protection
- **Performance Metrics**: Added real-time performance tracking during active translation sessions
- **Audio Device Tracking**: Track device changes, passthrough toggles, and virtual device usage
- **Settings Analytics**: Monitor provider switches, language changes, and API key validations
- **Extension Analytics**: Standardized popup tracking with proper event naming conventions

### Fixed

- **Extension Hostname Tracking**: Fixed hostname tracking in browser extension popup analytics

### Documentation

- **Analytics Events Documentation**: Added comprehensive documentation for all analytics events (ANALYTICS_EVENTS.md)

## [0.9.0] - 2025-07-11

### Added
- **Palabra.ai Support**: Integrated Palabra.ai as a new translation service provider.
- **Audio Feedback Warning**: Added audio feedback warnings and safety checks for passthrough functionality.
- **Supported Websites Documentation**: Added a "Supported Websites" section to the documentation.

### Changed
- **Audio Processing**: Refactored audio processing in `PalabraAIClient` to use `AudioWorkletNode` for better performance and flexibility.
- **Enhanced WavRecorder**: The `WavRecorder` has been enhanced with advanced audio processing options.
- **Custom Audio Tracks**: Added support for custom audio tracks in `PalabraAIClient`.
- **Virtual Microphone**: Improved the virtual microphone with dynamic worklet path resolution and updated logging levels.
- **Translations**: Updated translations for multiple languages to include new audio settings and API key validation messages.
- **Content Security Policy**: Updated the Content Security Policy to accommodate new services.

### Fixed
- **README Images**: Improved image styling for browser extension badges in `README.md`.

## [0.8.0] - 2025-01-22

### Added

- **Real Voice Passthrough**: Added comprehensive real voice passthrough functionality allowing users to hear both original audio and translated speech simultaneously
- **Enhanced Virtual Microphone**: Implemented dual-queue audio mixing system with immediate and regular track processing for better audio quality
- **Comprehensive Localization**: Added Real Voice Passthrough translations to all 30 supported languages with improved terminology
- **Audio Volume Control**: Real Voice Volume setting now properly applies to immediate audio tracks in virtual microphone

### Fixed

- **Audio Volume Application**: Fixed issue where Real Voice Volume setting wasn't affecting immediate audio tracks
- **Translation Terminology**: Improved Chinese translations for Real Voice Passthrough using professional interpretation terminology (原声直通)

### Changed

- **GeminiClient Optimization**: Replaced generateId() method with fixed instance IDs for better performance
- **Audio Processing**: Enhanced audio mixing capabilities with separate queues for different audio types

### Technical Improvements

- **Code Cleanup**: Removed unused addImmediatePCM method from BrowserAudioService
- **Documentation**: Updated README.md with comprehensive feature documentation and technical details
- **Architecture**: Improved virtual microphone implementation with better audio stream management

## [0.7.0] - 2025-06-29

### Added

- **CometAPI Support**: Introduced CometAPI as an OpenAI-compatible provider for enhanced flexibility
- **Provider Enum System**: Implemented comprehensive Provider enum system for better type safety
- **Multi-Provider Architecture**: Enhanced support for multiple AI providers with shared settings and logic

### Changed

- **Provider Handling**: Replaced string literals with Provider enum for improved maintainability
- **Settings Management**: Refactored settings context and service methods to accommodate CometAPI settings
- **Type Safety**: Enhanced type safety by utilizing Provider enum for all provider-related operations

### Technical Improvements

- **Code Refactoring**: Updated MainPanel, SettingsPanel, and service files to use Provider enum
- **API Key Validation**: Improved API key validation and model fetching methods with new Provider structure
- **Provider Configuration**: Added CometAPIProviderConfig for OpenAI-compatible provider support

## [0.6.0] - 2025-06-27

### Added

- **PostHog-js-lite Migration**: Migrated from posthog-js to posthog-js-lite for Chrome Web Store compliance
- **Custom Analytics Context**: Implemented custom React context to replace posthog-js/react dependency
- **Chrome Web Store Documentation**: Added detailed response documentation for Manifest V3 compliance

### Fixed

- **Remote Code Execution**: Eliminated remote code execution violations for Manifest V3 compliance
- **Bundle Size Optimization**: Reduced bundle size from 1.5+ MB to ~693 kB
- **PostHog Provider Import**: Corrected PostHogProvider import in index.tsx

### Changed

- **Analytics API**: Updated API method calls to use posthog-js-lite patterns (getDistinctId(), optIn())
- **Event Tracking**: Replaced posthog.people.set() with posthog.identify() using $set parameter
- **Analytics Configuration**: Enabled autocapture and immediate event flushing for better tracking

### Technical Improvements

- **Manifest V3 Compliance**: Ensured full compliance with Chrome Web Store Manifest V3 requirements
- **Security Enhancement**: Enhanced security with zero external dependencies for analytics
- **Development Logging**: Added detailed logging for analytics events in development mode

## [0.5.0] - 2025-06-16

### Added

- **Google Gemini Support**: Integrated Google's Gemini 2.0 Flash Live API as a new provider for live translation.
- **Multi-Provider Architecture**: Refactored the backend to support multiple AI providers (OpenAI and Gemini).
- **Provider Selection**: Added a provider selection UI in the settings panel to switch between OpenAI and Google Gemini.
- **Gemini Models**: Added support for `gemini-2.0-flash-exp` and `gemini-2.0-flash-thinking-exp` models.
- **Dynamic Settings**: The settings panel now dynamically adapts to the capabilities of the selected provider (e.g., hiding turn detection for Gemini). 