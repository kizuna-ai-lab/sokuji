# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git Worktrees

Worktree directory: `.claude/worktrees/` (gitignored)

## Project Overview

Sokuji is a real-time AI-powered translation application available as both an Electron desktop app and a browser extension. It provides live speech translation using OpenAI, Google Gemini, Palabra.ai, and Kizuna AI APIs with modern audio processing capabilities. It also supports OpenAI-compatible API endpoints for flexibility.

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

**All five version sites must land in a single `chore(release): vX.Y.Z` commit BEFORE the tag is created.** Earlier releases split root and extension version bumps into two separate commits with the tag on the root-only commit; the tag checkout then built the extension with the previous version. The release workflow checks out the tag verbatim, so every version-affecting file must be at the new version at the tagged commit.

1. Update all five files in one go:
   - `package.json`
   - `extension/package.json`
   - `extension/manifest.json`
   - `package-lock.json` (run `npm install` at the root to regenerate)
   - `extension/package-lock.json` (run `npm install` inside `extension/` to regenerate)
2. Commit all five together: `git commit -m "chore(release): vX.Y.Z"`
3. Create annotated tag on that commit: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
4. Push: `git push origin main --follow-tags`

**Sanity check before pushing the tag:**

```bash
git show vX.Y.Z:package.json          | grep '"version"'
git show vX.Y.Z:extension/package.json | grep '"version"'
git show vX.Y.Z:extension/manifest.json | grep '"version"'
```

All three must print the same new version. If they don't, `git tag -d vX.Y.Z` and re-tag on the correct commit before pushing.

## Architecture Overview

### Dual Platform Architecture
The codebase supports both Electron desktop app and Chrome/Edge browser extension from a shared React codebase:
- **Shared code**: `src/` directory contains all React components and business logic
- **Electron-specific**: `electron/` directory, virtual audio device management (Linux only)
- **Extension-specific**: `extension/` directory, manifest.json, background scripts

### Key Architectural Components

1. **Service Layer Pattern**
   - `ServiceFactory` creates platform-specific implementations with singleton caching
   - All services implement interfaces (IAudioService, ISettingsService)
   - Platform detection via `src/utils/environment.ts` utilities

2. **AI Client Architecture**
   - `ClientFactory` creates provider-specific clients
   - Providers: OpenAI, Gemini, PalabraAI, KizunaAI, OpenAI Compatible
   - Each client implements `IClient` interface
   - Real-time communication via WebSocket or REST APIs
   - OpenAI Compatible provider allows custom API endpoints (Electron only)
   - KizunaAI uses OpenAI-compatible API with backend-managed authentication

3. **Audio Processing Pipeline**
   ```
   Input Device → ModernAudioRecorder → AI Provider → ModernAudioPlayer → Output Device
   ```
   - `ModernAudioRecorder`: Captures input with echo cancellation, supports AudioWorklet with ScriptProcessor fallback
   - `ModernAudioPlayer`: Queue-based playback with event-driven processing and volume control
   - Unified audio service across all platforms with virtual device support in Electron (Linux only)

4. **State Management**
   - **Zustand stores** in `src/stores/` for primary application state:
     - `settingsStore.ts`: Provider settings, API keys, validation state, UI mode
     - `sessionStore.ts`: Active session state and conversation items
     - `audioStore.ts`: Audio device selection and playback state
     - `logStore.ts`: Application logs and diagnostics
   - React Context for specific features: OnboardingContext, UserProfileContext
   - Zustand's `subscribeWithSelector` middleware for efficient re-renders
   - Backend-managed API key integration for authenticated providers

5. **Audio Service Management**
   - `ModernBrowserAudioService` provides unified audio handling
   - Cross-platform compatibility without virtual devices
   - Automatic device switching and reconnection, including dynamic switching during active sessions

6. **Native runtime (`native/`)**
   - One CMake super-project builds three engines on ONE pristine upstream ggml 0.22 behind
     the `sk_*` C ABI (`native/include/sokuji_native.h`) in `libsokuji_native` / Python package
     `sokuji_native`: transcribe.cpp (ASR), llama.cpp (translation), audio.cpp (TTS — five
     families: moss_tts_nano, qwen3_tts, omnivoice, pocket_tts, supertonic). Design:
     `docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md` (Amendment A1: VAD runs in
     the renderer via `native-vad.worker.ts`, not here); build/layout/per-stage detail:
     `native/README.md`. `sokuji_sidecar/native.py` is the sidecar's one door in — nothing else
     imports `sokuji_native` directly; `asr_backend.py`/`translate_backend.py`/`tts_backend.py`
     are what the catalog and engines talk to.
   - **Two patch mechanisms** keep three upstreams building on one ggml: `src/audiocpp_compat.h`
     shims the symbols audio.cpp's ggml fork adds, plus four symbols whose behaviour changed
     upstream (`ggml_conv_1d`/`_dw`/`ggml_conv_2d`/`_3d` — im2col runs F16 upstream vs. the
     fork's kernel dtype — and Metal's `ggml_sub`, needing `src1` `ggml_cont`ed too); re-scan it
     on every ggml pin bump. `native/patches/*.json` are exact-text patches
     (`cmake/patch_upstream.py`, anchored `old`→`new`, must match exactly once or the build fails
     loudly — "the pin moved, fix the spec"): always-on `ggml-gguf-bulk-array-read.json`
     (bulk-reads GGUF array KVs instead of one `fread`/element — cuts `supertonic`'s TTS load
     ~9-12x depending on the box) and Metal-only `ggml-metal-{diag-mask-inf,pad-leading}.json`
     (DIAG_MASK_INF, which ggml's Metal backend dropped, and leading-edge PAD, which it never
     had — both needed by audio.cpp).
   - **Five SKUs** (`electron/sidecar-sku.js`): linux-x64/linux-arm64 (Vulkan,
     `manylinux_2_35_*` floor, ubuntu-22.04 CI + a from-source Khronos toolchain for `glslc` —
     R37/R38, LunarG's apt has no arm64), win-x64 (Vulkan, LunarG SDK), mac-arm64 (Metal),
     mac-x64 (CPU only, GPU lane `none`). Tiers `gpu-metal`/`gpu-vulkan`/`cpu`, ranked in that
     order (highest first) by `TIER_RANK` (`planner.py`: 3.0/2.5/1.0); a Metal device reporting
     `/paravirtual/i` (every CI macOS runner) is excluded from `gpu-metal` so a VM shim is never
     handed a plan that hard-aborts. Real-GPU smoke (default q8_0/f16 rungs): five TTS families
     pass on GB10 (linux-arm64), an RTX 4070 SUPER over win-x64 and linux-x64, and an Apple M4
     (mac-arm64). bf16 rungs validated 4/4 families on GB10/Vulkan and M4/Metal only (supertonic
     ships no bf16; not yet run on win-x64/linux-x64). CI's own Metal runner is a paravirtual VM
     and can never supply real-hardware evidence.
   - **Versions**: native's lives in `CMakeLists.txt`'s `project(sokuji_native VERSION …)` (+
     the `sk_version()` literal in `tests/test_common.cpp`) → tag `native-vX.Y.Z` →
     `native-build.yml` publishes five wheels as a **prerelease** (never "latest", so
     electron-updater's own lookup can't land on it). Sidecar's lives in root `package.json`'s
     `sidecarVersion` (the only file carrying it) → tag `sidecar-vX.Y.Z` →
     `sidecar-bundles.yml` publishes five bundles + a merged `manifest.json`, also prerelease.
     App version is the five-site rule above, independent of both. Order is fixed: native tag
     first (wheels must exist) → `sidecar/requirements.txt` pins the five wheel URLs by
     `sys_platform`/`platform_machine` → sidecar tag (a bundle built before `requirements.txt`
     carries those URLs ships hollow, no `sokuji_native` inside) → the app's `sidecarVersion`
     bump rides an ordinary future app release. First ggml-only pair: `native-v1.0.0` /
     `sidecar-v0.2.0` — a clean break from the ONNX-era `sidecar-v0.1.x` line.
   - **Dev loop**: `native/ci/build.sh <none|vulkan|metal> <plat tag>` (`.ps1` on Windows)
     builds and runs CTest + the Python suite against a fresh stage;
     `SOKUJI_NATIVE_DIR=.../stage` points a wheel-less `import sokuji_native` at it. Models
     cache under `~/.cache/sokuji-native-tests/` (`native/README.md` has the `curl` lines).
     Gates: `ctest` (skip rc 77 without models); `native/python/tests`, incl.
     `test_tts_synthesises_on_a_gpu_device` (`SK_TEST_TTS_GPU=1`, one subprocess per
     family/quant — a GGML abort is an uncatchable SIGABRT); `native/tests/parity`
     (sample-exact vs. `audiocpp_cli`, its own per-source-keyed "nosve" cache); the sidecar's
     live TTS→ASR loopback (`SOKUJI_RUN_TTS_LOOPBACK=1`, `sidecar/tests/test_tts_engine.py`).
     `sidecar-tests` in CI needs `PYTHONPATH=sidecar` — it isn't installed as a package; it
     installs `sidecar/requirements.txt` but sets neither `SK_TEST_TTS_GPU` nor
     `SOKUJI_RUN_TTS_LOOPBACK`, and every native-gated test `importorskip`s silently when no
     `sokuji_native` wheel resolves.
   - **Thread policy**: `n_threads=0` (default) resolves to `min(hardware_concurrency, 12)` —
     `ggml_barrier()` spin-waits with no yield, so at `n_threads == nproc` timing turns unstable
     (1.2-4.3x run-to-run spread measured at nproc=20 on GB10 vs. ~1.03x at the 12-thread knee;
     a 10-core M4 never crosses it); `SOKUJI_NATIVE_THREADS` overrides. A GPU TTS load runs one discarded warm-up `synth()`
     (skipped for CPU and the two clone-only voice-required families) to pay the driver's
     one-time pipeline-compile cost at load, not on the user's first utterance.
   - **Voice rules** (`tts_backend.py`): `qwen3_tts`/`omnivoice` are clone-only — a bare
     `synth()` with no `set_voice()` raises a clean error before reaching the native layer.
     `pocket_tts` gets its first listed preset (`alba`) applied automatically at load, since it
     also has no working default. `moss_tts_nano` and `supertonic` synth with nothing set.
     `moss_tts_nano` alone samples its stop decision rather than greedy-argmax (R23) — same
     seed, so still build-reproducible.
   - **Known gaps**: no real M1/M2/M3 Metal hardware has run this suite (only an M4 — the
     architectural Apple7/Apple6 capability gates are what R36 relies on instead);
     `moss_tts_nano`'s bf16-on-Vulkan peak (1.228) clips, likely R23 sampling variance,
     unconfirmed; `qwen3-tts-1.7b`'s bf16 rung was never loaded (only 0.6b was); an
     install-order race in the sidecar's native-backend singleton (last `load()` wins); every
     sidecar bundle built before `sidecar-v0.2.0` shipped hollow — no `sokuji_native` wheel
     installed inside at all.

## Important Patterns and Conventions

### Code Organization
- `src/components/` - Functional React components with TypeScript
- `src/stores/` - Zustand state management stores
- `src/services/` - Service layer with interface contracts
- `src/services/clients/` - AI provider client implementations
- `src/services/providers/` - Provider-specific configurations
- `src/lib/modern-audio/` - Web Audio API modules (JavaScript, not TypeScript)
- `src/utils/` - Shared utilities including environment detection
- `src/contexts/` - React Context providers (OnboardingContext, UserProfileContext)

### Error Handling

All API calls are wrapped in try-catch, and features degrade gracefully when
unavailable. Where a caught failure is *recorded* is decided here, once, rather
than at each call site:

**Record it with `reportError` / `reportWarning` from `src/lib/diagnostics/report.ts`,
never with `console.error` / `console.warn`.** One call writes both surfaces: the
console line fires synchronously with the raw `cause` (developer surface, keeps
the stack), and a redacted one-sentence message reaches LogsPanel one microtask
later (user-diagnostic surface — advanced mode only, English, pasted into bug
reports). The deferral makes it safe to call from any stack, including a Zustand
getter React reaches during render.

```typescript
import { reportError, reportWarning, describeCause } from '../lib/diagnostics/report';

reportError('SettingsStore', `Failed to load settings: ${describeCause(error)}`, { cause: error });
reportWarning('AudioStore', 'No real microphone available', { dedupeKey: 'mic.missing' });
```

- **Severity.** `error` = what the user asked for did not happen. `warning` = it
  happened or will (a fallback ran, a retry is pending, state is in memory but
  unpersisted). `info` is not a failure — leave it on `console.info`.
- **The message is a string, always.** `Message<T>` rejects `any`, `unknown`,
  `string | undefined` and objects, so a parsed response body cannot become a log
  line. The caught value goes in `cause`, which never leaves the console. Use
  `describeCause(err)` for one readable sentence from any thrown shape.
- **`report()` never shows UI.** A failure the user must act on becomes state on
  the owning store and a component renders it — LogsPanel is closed outside
  advanced mode, so it is never the basic-mode surface.
- **Don't record the same failure twice.** If it already reaches the panel by
  another route (`handlers.onError`, `onRealtimeEvent`, a rethrow into MainPanel's
  session-start catch, `validationMessage`, descriptor `notices`), add nothing.
- **Inside an `IClient` session**, clients never call `report()` and never
  `console.*` — only MainPanel knows which channel (speaker/participant) a client
  is on. Pick by what the failure did to the session:
  - `handlers.onError` — the session is broken. Raises a conversation bubble and
    an `api_error`.
  - `handlers.onDiagnostic({ code, message, cause })` — the session continues,
    degraded: a frame that would not parse, a cleanup step that threw, TTS falling
    back. `code` comes from `CLIENT_DIAGNOSTICS`
    (`src/lib/diagnostics/clientDiagnostics.ts`), which also decides the severity,
    so a client never picks one. No bubble, no `api_error`.
  - `handlers.onRealtimeEvent` — wire traffic, not a failure.
  - throw out of `connect()` — the session never started; MainPanel's
    `onConnectFailed` reports it once, for whichever leg it was.
- **Hot paths** (per-audio-chunk, per-frame, per-poll-tick) never log per
  occurrence: return silently, or report the ok → failing transition. Bursts pass
  `dedupeKey`; the panel throttles per key on a 5s window while the console still
  sees every call.
- **Secrets are redacted at the sinks** (`logStore.addLog`, `sanitizeEvent`) from
  one list in `src/lib/diagnostics/redact.ts`, shared with PostHog error tracking.
  Panel text is clipboard-exportable, so this is not optional.
- **Contexts that cannot import the store** — web workers, AudioWorklets,
  `extension/`, `electron/`, `sidecar/` — keep their existing message/IPC channel,
  and the renderer-side caller reports. They are outside this policy.
- **`src/stores`, `src/services` and `src/contexts` are finished**: they contain no
  `console.error` / `console.warn`, and `consoleLedger.consistency.test.ts` fails if
  one comes back. Elsewhere (`src/components`, `src/lib`, `shared/`) the remaining
  calls are tracked file-by-file in that same test and lowered in dedicated PRs,
  not in passing. Those counts are exact: removing a call means lowering its row in
  the same diff. See `docs/superpowers/specs/2026-08-25-diagnostics-reporting-design.md`
  for the full design (#441).

### Platform-Specific Code
Use centralized utilities from `src/utils/environment.ts`:
```typescript
import { isElectron, isExtension, isWeb, getEnvironment } from '../utils/environment';

// Preferred: use centralized detection
if (isElectron()) {
  // Electron-specific code
} else if (isExtension()) {
  // Browser extension code
}

// Get backend URL (respects VITE_BACKEND_URL env var)
import { getBackendUrl, getApiUrl } from '../utils/environment';
const apiUrl = getApiUrl(); // https://sokuji.kizuna.ai/api
```

### Zustand Store Patterns
```typescript
// Using optimized selectors (preferred - prevents unnecessary re-renders)
const provider = useProvider();
const setProvider = useSetProvider();

// Direct store access for multiple values
const { provider, uiLanguage, uiMode } = useSettingsStore();

// Subscribing to changes outside React
useSettingsStore.subscribe(
  (state) => state.provider,
  (provider) => console.log('Provider changed:', provider)
);
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

### Environment Variables
- `VITE_BACKEND_URL`: Backend API URL (default: `https://sokuji.kizuna.ai`)
- `VITE_ENABLE_KIZUNA_AI`: Enable Kizuna AI provider in production (`true`/`false`)
- Environment detection via `src/utils/environment.ts`

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
- **zustand**: State management with `subscribeWithSelector` middleware
- **@floating-ui/react**: Advanced tooltip positioning and floating elements
- **i18next & react-i18next**: Internationalization framework
- **openai-realtime-api**: OpenAI real-time API client (strongly-typed fork)
- **@google/genai**: Google Gemini SDK
- **livekit-client**: LiveKit SDK for Palabra AI WebRTC integration — **pinned to an exact version, do not upgrade** (see below)
- **better-auth**: Authentication library for user sessions
- **lucide-react**: Icon library
- **ws**: WebSocket client for real-time communication

### livekit-client is version-capped by Palabra's server

`livekit-client` is pinned to an **exact** version (currently `2.18.7`) — never widen it to a
caret range and never bump it without a live Palabra session test. Palabra runs LiveKit server
**1.8.4 / protocol 15**, whose answers carry `SessionDescription.id = 0` because the server
doesn't echo the offer's id. livekit-client **2.18.8+** gates negotiation completion on
`offerId > checkpoint`, so `negotiate()` never resolves, times out after 15s, and the engine
escalates to a full reconnect — forever. Palabra's own SDK (`@palabra-ai/translator`) pins
`livekit-client` `2.13.0` for the same reason.

This regression is **silent**: `connect()` still resolves, the UI still says "connected", and
the entire vitest suite still passes — nothing covers real WebRTC negotiation. The only signal
is a live session producing zero transcriptions plus a `NegotiationError: negotiation timed out`
every ~17s.

One related symptom is expected and harmless: Palabra only serves `/rtc`, so every connect logs
a failed WebSocket and a 404 on `/rtc/v1` (a path added in client 2.17.0) before LiveKit's
automatic v0 fallback, costing ~1s on first connect.

Before lifting the pin, confirm the server echoes the id — join a room and check that the
inbound `answer` has a non-zero `SessionDescription.id`.

### Internationalization
- Complete translations for 35+ languages
- English fallback for missing translations
- Language detection via i18next-browser-languagedetector
- **UI Language Quick Access**: 12 most common languages directly available

## Common Development Tasks

### Adding a New AI Provider
1. Create the client class implementing `IClient` in `src/services/clients/`
2. Create `XProviderConfig` in `src/services/providers/` extending `BaseProviderDescriptor`:
   settings interface + defaults, `settingsSliceKey`, `createClient`, `validateAndFetchModels`,
   `extractCredentials`, `buildSessionConfig`, language overrides if restricted;
   set `supportsWebRTC = true` if the provider runs over WebRTC transport (it defaults
   to `false`), and `i18nKey` if the locale key differs from the provider id
3. Register it in `ProviderConfigFactory`'s static block (behind its feature flag)
4. Add the enum value in `src/types/Provider.ts` and the settings slice + update action in `settingsStore.ts`
5. Add `providers.<id>.name/.description` to locales
The registry invariant test (`descriptorRegistry.test.ts`) fails loudly on anything missed.

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
- **SimpleConfigPanel**: 6-section configuration (account, language, translation, API key, mic, speaker)
- **MainPanel**: Unified conversation panel with `uiMode`-driven layout (basic: bubble messages + status footer, advanced: bubble messages + waveform footer with controls)
- **Tooltip**: @floating-ui/react powered tooltips with hover/click/focus triggers
- **ConnectionStatus**: Real-time connection state indicator

### UI Design System
- Dark theme with consistent styling across components
- Primary action color: `#10a37f` (green), Error state: `#e74c3c` (red)
- Component styles defined in colocated SCSS files (e.g., `SimpleConfigPanel.scss`)
- Lucide React icons with consistent sizing (14-16px)

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

### Adding a Supported Meeting Platform
1. Add one row to `extension/platforms.ts` (`PLATFORMS`): hostname, matchPattern
   `https://<host>/*`, contentProfile (`standard` | `jitsi` | `zoom`), displayName,
   shortName, icon (base64), and — if applicable — group/groupLabel, guidanceKey, pluginKey.
2. If the platform needs a site plugin, add its plugin object to `site-plugins.js`
   and register the key in that file's `PLUGIN_BY_KEY` **and** `HOST_TO_PLUGIN_KEY`
   (this one map can't be generated — `site-plugins.js` runs in the page's MAIN
   world and can't see the isolated-world registry global; a consistency test
   parses the file and fails loudly if it drifts from the registry).
3. Add `<guidanceKey>Title` / `<guidanceKey>Guidance` to `_locales/*/messages.json`.
4. `manifest.json` stays hand-authored but is pinned by `extension/manifest.consistency.test.ts`
   against `deriveContentScripts()` / `deriveSubtitleWebAccessibleMatches()` — update its
   content_scripts and subtitle web_accessible_resources matches to match, or the test fails.

popup, the subtitle overlay surface, background.js, and content.js's guidance lookup all
derive from the registry automatically (via direct import for bundled surfaces, via the
build-emitted `platforms.generated.js` for vanilla copied scripts). Only steps 2-4 above
are still manual.

### Web Accessible Resources
- Worklets for audio processing
- Device emulator for virtual devices
- Site-specific plugins for platform integration

### Security Policy
- Strict CSP configuration for extension pages
- Allowed connections to AI provider APIs (OpenAI, Google, Palabra, Kizuna AI, and OpenAI-compatible endpoints)
- PostHog analytics integration for usage tracking

## Authentication and API Key Management

### Authentication System
- **Better Auth Integration**: User authentication using Better Auth service
- **Backend-Managed Keys**: Kizuna AI API keys are automatically managed by the backend
- **Mixed Authentication**: Supports both user-managed and backend-managed API keys
- **Cross-Platform**: Authentication works across Electron and browser extension

### API Key Types
1. **User-Managed Keys**: OpenAI, Gemini, Palabra AI, OpenAI Compatible - users input their own keys
2. **Backend-Managed Keys**: Kizuna AI - keys fetched from authenticated backend service

### Authentication Flow for Kizuna AI
1. User signs in via Better Auth authentication
2. `ApiKeyService` fetches API key from backend endpoint (`/api/user/api-key`)
3. API key is cached for 5 minutes to reduce backend load
4. Provider becomes available in UI only when authenticated and key is available

### Key Services
- **ApiKeyService**: Handles fetching API keys from backend with caching
- **AuthContext**: Manages authentication state and token lifecycle (Better Auth)
- **Service Integration**: All AI clients check authentication before operations