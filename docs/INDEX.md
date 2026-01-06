# Sokuji Project Documentation Index

> **Live Speech Translation Application** - Real-time AI-powered translation using OpenAI, Google Gemini, and other AI providers
>
> Version: 0.9.18 | Last Updated: 2025-01-03

---

## 📚 Table of Contents

- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Documentation by Category](#documentation-by-category)
- [Development Guides](#development-guides)
- [API Documentation](#api-documentation)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## 🚀 Quick Start

### Essential Reading
1. **[README.md](../README.md)** - Project overview, features, and setup
2. **[CLAUDE.md](../CLAUDE.md)** - Development guide for Claude Code
3. **[Backend README](../backend/README.md)** - Better Auth backend setup
4. **[Backend-CF README](../backend-cf/README.md)** - Cloudflare Workers backend

### Quick Setup
```bash
# Install dependencies
npm ci

# Development mode
npm run electron:dev

# Build for production
npm run electron:build
```

---

## 🏗️ Architecture Overview

### System Architecture
```
┌─────────────────────────────────────────────┐
│           Sokuji Application               │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────┐      ┌─────────────────┐  │
│  │  Electron   │      │  Chrome         │  │
│  │  Desktop    │      │  Extension      │  │
│  │  App        │      │                 │  │
│  └─────────────┘      └─────────────────┘  │
│         │                      │           │
│         └──────────┬───────────┘           │
│                    │                       │
│         ┌──────────▼───────────┐           │
│         │   React Frontend     │           │
│         │   (TypeScript)       │           │
│         └──────────┬───────────┘           │
│                    │                       │
│         ┌──────────▼───────────┐           │
│         │  Better Auth Backend │           │
│         │  (Cloudflare Workers)│           │
│         └──────────┬───────────┘           │
│                    │                       │
│         ┌──────────▼───────────┐           │
│         │   AI Providers       │           │
│         │  OpenAI | Gemini     │           │
│         │  Palabra | Kizuna AI │           │
│         │  OpenAI Compatible   │           │
│         └──────────────────────┘           │
└─────────────────────────────────────────────┘
```

### Key Technologies
- **Frontend**: React 18 + TypeScript
- **Backend**: Cloudflare Workers + Hono + D1 Database
- **Authentication**: Better Auth (migrated from Clerk)
- **Desktop**: Electron 34+
- **Extension**: Chrome Manifest V3
- **AI Providers**: OpenAI, Google Gemini, Palabra.ai, Kizuna AI, and OpenAI-compatible endpoints

### Core Components
- **Service Factory Pattern**: Platform-specific implementations (Electron/Browser)
- **Modern Audio Processing**: AudioWorklet with ScriptProcessor fallback
- **Context-Based State**: React Context API
- **Wallet System**: Unified quota and usage management

---

## 📂 Documentation by Category

### 1. **Getting Started**
- [README.md](../README.md) - Main project documentation
- [CLAUDE.md](../CLAUDE.md) - Claude Code development guide
- [GitHub Secrets Setup](./GITHUB_SECRETS_SETUP.md) - CI/CD configuration

### 2. **Architecture & Design**
- **Application Architecture**
  - [App Analytics Integration](./app/app-analytics-integration.md)
  - [App Audio Device Switching](./app/app-audio-device-switching.md)
  - [App Events Documentation](./app/app-analytics-events.md)

- **Audio System**
  - [Audio Flow Analysis](./audio-analysis/audio-flow-analysis.md)
  - [Audio System README](./audio-analysis/README.md)
  - [Audio Recording Process](./AUDIO_RECORDING_PROCESS.md)
  - [System Audio Capture (Participant Translation)](./SYSTEM_AUDIO_CAPTURE.md)

- **Backend Architecture**
  - [Better Auth Backend](../backend/README.md)
  - [Cloudflare Workers Backend](../backend-cf/README.md)
  - [Wallet System Model](../backend-cf/WALLET_MODEL.md)

### 3. **Feature Documentation**
- **Authentication & Authorization**
  - [Authentication Integration](./TODO-AUTH-INTEGRATION.md)
  - [Kizuna AI Integration](./KIZUNA_AI_INTEGRATION.md)
  - [Profile Optimization](./PROFILE-OPTIMIZATION.md)

- **AI Provider Integration**
  - [Kizuna AI Provider](./KIZUNA_AI_INTEGRATION.md)
  - [Provider System Overview](../CLAUDE.md#ai-provider-architecture)

- **Analytics & Tracking**
  - [Analytics Events](./ANALYTICS_EVENTS.md)
  - [App Analytics](./app/app-analytics-events.md)
  - [Extension Analytics](./extension/extension-analytics-integration.md)

### 4. **Platform-Specific Guides**

#### **Electron Desktop App**
- [Electron Build Guide](./build/macos-installer-guide.md)
- [Electron Setup](../README.md#electron-app)
- [Virtual Audio Devices](./virtual-audio/virtual-audio-device-guide.md)

#### **Chrome Extension**
- [Extension Packaging](./extension/extension-packaging.md)
- [Extension Updates](./extension/extension-update-guide.md)
- [Chrome Web Store Response](./extension/chrome_web_store_response.md)
- [Platform Integration](./extension/extension-gather-town-integration.md)

#### **Virtual Audio System**
- [Virtual Audio Guide](./virtual-audio/virtual-audio-device-guide.md)
- [Virtual Audio README](./virtual-audio/README.md)
- [VB-Cable Integration](./virtual-audio/vb-cable-integration.md)

### 5. **API Documentation**
- **Backend APIs**
  - [API Documentation](../backend-cf/docs/API.md)
  - [Webhook Documentation](../backend-cf/docs/WEBHOOK_AND_USAGE_DOCUMENTATION.md)
  - [Pricing System](../backend-cf/docs/PRICING_SYSTEM.md)

- **Multi-Environment Setup**
  - [Environment Configuration](../backend-cf/docs/MULTI_ENV_SETUP.md)
  - [Webhook Testing](../backend-cf/docs/test-webhook-logging.md)

### 6. **Development Guides**
- **Setup & Configuration**
  - [GitHub Secrets](./GITHUB_SECRETS_SETUP.md)
  - [Environment Variables](../backend-cf/.env.example)
  - [Development Variables](../backend-cf/.dev.vars.example)

- **Testing & Debugging**
  - [Testing Guide](../README.md#testing-and-quality)
  - [Webhook Testing](../backend-cf/docs/test-webhook-logging.md)

- **Build & Deploy**
  - [Build Configuration](../README.md#build-configuration)
  - [macOS Installer Guide](./build/macos-installer-guide.md)
  - [Extension Packaging](./extension/extension-packaging.md)

### 7. **Migration Guides**
- [Clerk to Better Auth Migration](./TODO-AUTH-INTEGRATION.md) (Historical)
- [Profile Data Optimization](./PROFILE-OPTIMIZATION.md)

---

## 🛠️ Development Guides

### Core Development
1. **Setting Up Development Environment**
   - Install Node.js LTS
   - Clone repository
   - Run `npm ci`
   - Configure environment variables

2. **Running in Development**
   ```bash
   # Electron app
   npm run electron:dev

   # React app only
   npm run dev

   # Extension development
   cd extension && npm run dev
   ```

3. **Code Structure**
   - `src/` - React components and business logic
   - `electron/` - Electron main process
   - `extension/` - Chrome extension code
   - `backend/` - Better Auth backend
   - `backend-cf/` - Cloudflare Workers backend

### Common Tasks
- **Adding AI Provider**: See [CLAUDE.md](../CLAUDE.md#adding-a-new-ai-provider)
- **Modifying Audio Pipeline**: See [CLAUDE.md](../CLAUDE.md#modifying-audio-pipeline)
- **Debugging Audio Issues**: See [CLAUDE.md](../CLAUDE.md#debugging-audio-issues)

---

## 📡 API Documentation

### Backend Endpoints
- **Authentication**: `/auth/*` (Better Auth)
- **User Management**: `/api/user/*`
- **Wallet System**: `/api/wallet/*`
- **Usage Tracking**: `/api/usage/*`

### Full API Reference
See [Backend API Documentation](../backend-cf/docs/API.md)

---

## 🚀 Deployment

### Platforms
- **Electron**: Windows, macOS, Linux
- **Chrome Extension**: Chrome, Edge, Chromium browsers

### Build Commands
```bash
# Electron production build
npm run make

# Extension build
cd extension && npm run build

# Backend deployment
cd backend-cf && npm run deploy
```

### CI/CD
- GitHub Actions for automated builds
- See [Build Workflow](../.github/workflows/build.yml)
- [GitHub Secrets Setup](./GITHUB_SECRETS_SETUP.md)

---

## 🤝 Contributing

### Guidelines
1. Follow existing code patterns
2. Use TypeScript strict mode
3. Write tests for new features
4. Update documentation
5. Use conventional commits

### Code Style
- TypeScript for all new code
- SASS for styling
- English for comments and documentation

---

## 📞 Support & Resources

### Documentation
- [Better Auth Docs](https://www.better-auth.com/docs)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Electron Docs](https://www.electronjs.org/docs)
- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)

### Project Resources
- **Repository**: [GitHub](https://github.com/kizunaai/sokuji-react)
- **Issues**: [GitHub Issues](https://github.com/kizunaai/sokuji-react/issues)
- **Discussions**: [GitHub Discussions](https://github.com/kizunaai/sokuji-react/discussions)

---

## 📝 Document Status

### Recently Updated
- ✅ Migrated from Clerk to Better Auth (2025-01-03)
- ✅ Cleaned up all Clerk references (2025-01-03)
- ✅ Updated all documentation to reflect Better Auth (2025-01-03)

### Documentation Coverage
- ✅ Architecture (Complete)
- ✅ Setup Guides (Complete)
- ✅ API Documentation (Complete)
- ✅ Platform Guides (Complete)
- 🔄 Testing Documentation (In Progress)
- 🔄 Advanced Features (In Progress)

---

*Last Updated: 2025-01-03*
*Maintained by: Kizuna AI Lab*
