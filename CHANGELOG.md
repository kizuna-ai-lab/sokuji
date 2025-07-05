# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [0.5.0] - 2025-06-16

### Added

- **Google Gemini Support**: Integrated Google's Gemini 2.0 Flash Live API as a new provider for live translation.
- **Multi-Provider Architecture**: Refactored the backend to support multiple AI providers (OpenAI and Gemini).
- **Provider Selection**: Added a provider selection UI in the settings panel to switch between OpenAI and Google Gemini.
- **Gemini Models**: Added support for `gemini-2.0-flash-exp` and `gemini-2.0-flash-thinking-exp` models.
- **Dynamic Settings**: The settings panel now dynamically adapts to the capabilities of the selected provider (e.g., hiding turn detection for Gemini). 