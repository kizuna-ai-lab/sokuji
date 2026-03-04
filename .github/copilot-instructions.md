# Copilot Instructions — Eburon

## Project Overview

Eburon is a real-time AI-powered speech translation app shipped as both an **Electron desktop app** and a **Chrome/Edge browser extension** from a single React + TypeScript codebase. It integrates 7 AI providers (OpenAI, Gemini, Palabra.ai, Kizuna AI, Volcengine, Doubao, OpenAI-compatible) via WebSocket/WebRTC/REST.

## Architecture

### Dual-platform from shared code
- `src/` — All React components, stores, services, and business logic (shared)
- `electron/` — Electron main process (JS, not TS). Virtual audio device management
- `extension/` — Manifest V3 Chrome extension: service worker, content scripts for Meet/Teams/Zoom/Discord/Slack/Gather/Whereby

### Core data flow
```
Input Device → ModernAudioRecorder → AI Provider Client → ModernAudioPlayer → Output Device
```

### Key architectural layers
| Layer | Location | Pattern |
|-------|----------|---------|
| State | `src/stores/` | Zustand with `subscribeWithSelector` middleware |
| Services | `src/services/` | `ServiceFactory` — singleton cache, platform-aware |
| AI Clients | `src/services/clients/` | `ClientFactory` switch on `Provider` enum; each implements `IClient` |
| Provider Config | `src/services/providers/` | `ProviderConfigFactory` — static registry with feature flags |
| Audio | `src/lib/modern-audio/` | `BaseAudioRecorder` hierarchy; `ModernAudioPlayer` queue-based playback |
| Platform detection | `src/utils/environment.ts` | `isElectron()`, `isExtension()`, `isWeb()` — use these, never roll your own |

## Development Commands

```bash
npm run electron:dev     # Electron dev (Vite + Electron)
npm run dev              # React only (extension development)
npm run test             # Vitest
npm run eval             # Run LLM-as-Judge eval suite (evals/)
npm run extension:dev    # Extension build in watch mode
npm run make             # Build + package Electron distributable
```

## Conventions & Patterns

### Adding a new AI provider
1. Add to `Provider` enum in `src/types/Provider.ts`
2. Create `XxxClient implements IClient` in `src/services/clients/`
3. Create `XxxProviderConfig implements ProviderConfig` in `src/services/providers/`
4. Register in `ProviderConfigFactory` (use feature flag from `environment.ts` if gated)
5. Add case in `ClientFactory.create()` switch
6. Add settings interface + defaults in `src/stores/settingsStore.ts`

### Zustand stores — use optimized selectors
```typescript
// ✅ Preferred: individual selectors prevent unnecessary re-renders
const provider = useProvider();
const setProvider = useSetProvider();
// ✅ OK for multiple values from one render
const { provider, uiLanguage } = useSettingsStore();
// ❌ Avoid: full store subscription
```

### Platform-specific code
```typescript
import { isElectron, isExtension } from '../utils/environment';
// Never check window.electron or chrome.runtime directly
```

### Audio gotchas
- Always use `ModernAudioPlayer`/`ModernAudioRecorder` — never raw Web Audio API
- Passthrough audio uses dedicated `'passthrough'` track ID (default volume 30%)
- In React deps, use `selectedInputDevice?.deviceId` (string), **not** the device object — prevents infinite re-render loops
- AudioWorklet is preferred; ScriptProcessor is the automatic fallback

### i18n — lazy-loaded, 30 languages
- English bundled directly; all others use dynamic `import()` via `src/locales/index.ts`
- Extension has separate Chrome i18n in `extension/_locales/`

### Styling
- Colocated SCSS files per component (e.g., `SimpleConfigPanel.scss`)
- Dark theme. Primary: `#10a37f`, Error: `#e74c3c`
- Icons: `lucide-react` at 14–16px

### Code style
- TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`)
- `src/lib/modern-audio/` is intentionally **JavaScript**, not TypeScript
- All comments and docs in English
- Conventional commits (e.g., `feat(audio):`, `fix(extension):`)

## Testing

- **Vitest** with jsdom. Tests colocated as `*.test.tsx` / `*.test.ts`
- Mock with `vi.mock()` before dynamic `await import()` to ensure mocks apply
- Use `vi.useFakeTimers()` for debounced/timer logic; call `vi.advanceTimersByTime()`
- Store tests: set state with `setState()`, assert with `getState()`

## Eval System (`evals/`)

LLM-as-Judge framework for translation quality. Run `npm run eval`. Test cases in `evals/test-cases/` (JSON), system instructions in `evals/instructions/` (Markdown). Scoring rubric: accuracy 40%, naturalness 30%, formality 20%, completeness 10%.

## Environment Variables

- `VITE_BACKEND_URL` — Backend API (default: `https://Eburon.kizuna.ai`)
- `VITE_ENABLE_KIZUNA_AI` — Feature flag for Kizuna AI provider in production
- Feature flags (`isKizunaAIEnabled()`, etc.) return `true` in dev mode automatically

## Version Bumps

Update version in **three** places: root `package.json`, `extension/package.json`, `extension/manifest.json`. Tag with `git tag -a vX.Y.Z`.
