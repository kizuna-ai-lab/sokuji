# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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