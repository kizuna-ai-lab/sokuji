# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Google Gemini Support**: Integrated Google's Gemini 2.0 Flash Live API as a new provider for live translation.
- **Multi-Provider Architecture**: Refactored the backend to support multiple AI providers (OpenAI and Gemini).
- **Provider Selection**: Added a provider selection UI in the settings panel to switch between OpenAI and Google Gemini.
- **Gemini Models**: Added support for `gemini-2.0-flash-exp` and `gemini-2.0-flash-thinking-exp` models.
- **Dynamic Settings**: The settings panel now dynamically adapts to the capabilities of the selected provider (e.g., hiding turn detection for Gemini). 