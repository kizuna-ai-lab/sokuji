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
     `sokuji_native`: transcribe.cpp (ASR), llama.cpp (translation), audio.cpp (TTS — nine
     families: moss_tts_nano, qwen3_tts, omnivoice, pocket_tts, supertonic, voxcpm1,
     voxcpm2, irodori_tts, index_tts2). Design:
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
     ~9-12x depending on the box), Metal-only `ggml-metal-{diag-mask-inf,pad-leading}.json`
     (DIAG_MASK_INF, which ggml's Metal backend dropped, and leading-edge PAD, which it never
     had — both needed by audio.cpp), and arm64-conditional `ggml-drop-sme.json` (Linux, when
     the compiler rejects `+sme`) / `ggml-drop-sme-apple.json` (macOS), both dropping ggml's
     hard-coded SME CPU variants (`cmake/ggml_options.cmake`). The two non-ggml upstreams get
     their own specs applied the same way, unconditionally: `audio.cpp.json` and
     `transcribe.cpp.json` (`cmake/upstreams.cmake`).
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
     `sys_platform`/`platform_machine` (mirrored by `NATIVE_RELEASE_BASE`/`NATIVE_WHEELS` in
     `sidecar/tests/test_runtime_gate.py`, which must move with it), in the SAME commit as root
     `package.json`'s `sidecarVersion` → sidecar tag on that
     commit — `sidecar-bundles.yml`'s first step refuses a tag whose `sidecarVersion` is not on
     the tagged commit (the 2026-09-05 `sidecar-v0.3.0` run failed all five lanes for exactly
     that, and had to be re-cut), and a bundle built before `requirements.txt` carries the URLs
     ships hollow, no `sokuji_native` inside. The app release that carries that `sidecarVersion`
     to users is a later, ordinary app version. The first *shipped* ggml-only pair is
     `native-v1.0.1` / `sidecar-v0.2.0` — a clean break from the ONNX-era `sidecar-v0.1.x`
     line; `native-v1.0.0` was published the same day but never pinned by any bundle, superseded
     by 1.0.1 (R41: the Python binding's `Translator._make_cb` used to decode each streamed
     token piece independently, corrupting a BPE boundary landing inside a multibyte CJK
     character to U+FFFD; fixed with a per-call incremental UTF-8 decoder) before any bundle
     pinned it. `native-v1.0.2` / `sidecar-v0.2.1` (2026-09-03) follow: engine pins to
     transcribe.cpp 0.2.3 and audio.cpp 0.7.1, and four more TTS families compiled in
     (voxcpm1, voxcpm2, irodori_tts, index_tts2 — nine in total). Current native version
     is 1.1.0 (ABI 2: device profile and op coverage — spec
     docs/superpowers/specs/2026-09-04-native-device-profile-design.md).
   - **Dev loop**: `native/ci/build.sh <none|vulkan|metal> <plat tag>` (`.ps1` on Windows)
     builds and runs CTest + the Python suite against a fresh stage;
     `SOKUJI_NATIVE_DIR=.../stage` points a wheel-less `import sokuji_native` at it. Models
     cache under `~/.cache/sokuji-native-tests/` (`native/README.md` has the `curl` lines).
     Gates: `ctest` (skip rc 77 without models); `native/python/tests`, incl.
     `test_tts_synthesises_on_a_gpu_device` (`SK_TEST_TTS_GPU=1`, one subprocess per
     family/quant — a GGML abort is an uncatchable SIGABRT); `native/tests/parity`
     (sample-exact vs. `audiocpp_cli`, its own per-source-keyed "nosve" cache); the sidecar's
     live TTS→ASR loopback (`SOKUJI_RUN_TTS_LOOPBACK=1`, `sidecar/tests/test_tts_engine.py`).
     `sidecar-tests` in CI needs `PYTHONPATH=sidecar` — it isn't installed as a package. It
     installs `sidecar/requirements.txt`, which DOES resolve the pinned linux-x64
     `sokuji_native` wheel on the ubuntu runner (so `importorskip`-gated tests run there), but
     it has no model cache, no GPU, and sets neither `SK_TEST_TTS_GPU` nor
     `SOKUJI_RUN_TTS_LOOPBACK`, so every model- or device-gated test skips silently. It only
     runs when the diff touches `sidecar/**`, `scripts/build-sidecar-bundle.py` or
     `sidecar-bundles.yml`; `native-build.yml` has no push/PR trigger at all — native changes
     get CI only from a `workflow_dispatch` dry run or the `native-v*` tag.
   - **Thread policy**: `n_threads=0` (default) resolves to `min(hardware_concurrency, 12)` —
     `ggml_barrier()` spin-waits with no yield, so at `n_threads == nproc` timing turns unstable
     (1.2-4.3x run-to-run spread measured at nproc=20 on GB10 vs. ~1.03x at the 12-thread knee;
     a 10-core M4 never crosses it); `SOKUJI_NATIVE_THREADS` overrides. A GPU TTS load runs one discarded warm-up `synth()`
     (skipped for CPU and the three voice-required families) to pay the driver's
     one-time pipeline-compile cost at load, not on the user's first utterance.
   - **Voice rules** (`catalog.VOICE_REQUIRED_FAMILIES`, consumed by `tts_backend.py`):
     `qwen3_tts`/`omnivoice` are clone-only (reference clip + its transcript) and `index_tts2`
     needs the clip only — for all three a bare `synth()` with no `set_voice()` raises a clean
     error before reaching the native layer. `pocket_tts` gets its first listed preset (`alba`)
     applied automatically at load, since it also has no working default. `moss_tts_nano`,
     `supertonic`, `voxcpm1`, `voxcpm2` and `irodori_tts` synth with nothing set.
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
- `VITE_ENABLE_LOCAL_NATIVE`: Register the Local Native (Electron sidecar) provider in
  production builds; unset in releases. Temporary run-time alternative for testers on a
  packaged Electron build: DevTools → `localStorage.setItem('debug:local-native', '1')` →
  restart; `localStorage.removeItem('debug:local-native')` + restart hides it again. Remove the
  switch with the gate when Local Native ships.
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

### Adding a native model or TTS family

The native stack has three rosters, all in `sidecar/sokuji_sidecar/catalog.py`: ASR cards
(`ASR_MODELS`, one `_tc_row(...)` each), translation cards (`TRANSLATE_MODELS`,
`_llm_translate_row(...)` plus `_GGUF_SOURCES`) and TTS cards (`TTS_MODELS`, `_tts_gguf_row(...)`).
Every card carries a `graph_family`, the key the op-coverage gate looks up in the recordings
baked from `native/src/ops/<stage>-<family>.ops`. For TTS it is the audio.cpp family name. For
ASR it is what `sk_asr_caps.arch` reports, i.e. the GGUF's `general.architecture` — read it with
`gguf_header.read_header(path).architecture`, never from the transcribe.cpp `src/arch/` directory
name (three differ: `cohere_asr`, `granite_speech`, `granite_speech_nar`). For translation it is
llama.cpp's `general.architecture` (`qwen2`, `qwen3`, `qwen35`, `gemma3`, `llama`,
`hunyuan-dense`). A recording is per (stage, family), not per card; a missing ASR or translation
recording is a pass-through, and only the `tts` stage ever refuses a rung
(`planner._ABORTS_ON_UNSUPPORTED`). Model names and rung ids cross the wire as plain strings:
none of the cases below touches a locale, a renderer enum or `wire_schema.json`. Byte counts in
every row are the exact Hub file sizes: `python benchmark/qwen3-asr-webgpu/hub_sizes.py <org/repo>
<out.json>` writes every file's exact byte count to `<out.json>` (its console line is rounded MB —
never copy that); nothing re-checks them at runtime, so a wrong number is what the user sees.

**An ASR model of an architecture already compiled in** — catalog only, ships with a sidecar tag:
1. One `_tc_row(...)` in `ASR_MODELS`: `repo` must be `handy-computer/<x>-gguf`; `quants` keys
   are limited to `F16`/`Q8_0`/`Q6_K`/`Q5_K_M`/`Q4_K_M` and `default` must be one of them — any
   other key, or a default not in `quants`, makes `_tc_row` raise `ValueError` at import
   (which aborts collection of the whole sidecar suite; pinned by
   `test_tc_row_rejects_a_quant_key_outside_the_ladder`); `backend="native_asr_stream"`
   only for a streaming arch; `tiers=_TC_GPU_TIERS` when the model cannot run on CPU; `arch=`
   per the rule above. `asr_models()` re-sorts by `sort_order`, so place the row anywhere.
2. `sidecar/tests/test_catalog.py::test_roster_is_wer_ranked` pins the card count and the
   recommended count — bump them; add a `test_<card>_row` in the shape of `test_qwen3_asr_row`.
3. The only check of the `arch=` string: cache the GGUF under `~/.cache/sokuji-native-tests/`
   and add a `(file, card_id)` pair to `test_asr_graph_family_matches_native_arch` (it skips
   without the file, so CI never sees it).
4. A language code the picker does not emit needs an alias in
   `src/lib/local-inference/native/nativeCatalog.ts` `LANG_ALIASES`, or the card is silently
   marked incompatible. Nothing else in the renderer enumerates ASR cards.

**An ASR architecture new to Sokuji**: first check that the pinned transcribe.cpp registers it
(`ls native/build/cpu/_deps/transcribe-src/src/arch/`; at 0.2.3 `medasr` (HF-gated) and
`sortformer` (a diarization arch, not ASR) are compiled in but have no card). Otherwise it is a
pin bump first: `GIT_TAG` and `SOKUJI_TRANSCRIBE_VERSION` in `native/cmake/upstreams.cmake`, the
anchors in `native/patches/transcribe.cpp.json`, the `transcribe=0.2.3` literal in
`native/tests/test_common.cpp` and `ev["transcribe"] == "0.2.3"` in
`native/python/tests/test_sokuji_native.py`, then `native/README.md` "Bumping a pin" end to end
and a `native-v` release. Then the card as above. An op recording is optional for ASR
(diagnostics only): `record_ops … asr <arch> …` on the CPU record tree (`-DSOKUJI_RECORD_OPS=ON`,
see the TTS steps for the driver) writes `native/src/ops/asr-<arch>.ops`; its header says
`recorded-on: gpu` because the recorder device advertises itself as one — leave it. Land it in
ONE commit with its `CASES[]` row in `native/tests/test_ops_coverage.cpp`, the export in
`native/ci/ops-env.sh` and, if CI should gate it, the env var, curl line and cache key in
`.github/workflows/native-build.yml` (a `CASES[]` row whose env var is set but has no `.ops` fails
the gate; with the env var unset the row is silently SKIPPED, so the CI env var is what gives it
teeth).

**A translation model** — catalog only: add the two `(card_id, quant) -> (repo, exact filename)`
pairs to `_GGUF_SOURCES` FIRST (`_gguf_artifact` indexes them at import), then the
`_llm_translate_row(...)` with `family` (the card's `prompt_family`) from
`translate_backend.STRATEGIES` (`qwen` for any ChatML template, `hunyuan`, `gemma`), the
thinking flags (`disable_thinking` for `<think>` models, `append_no_think` only for plain
Qwen3), `arch=`, and renumber `sort_order`; bump
`test_translate_row_count_and_no_opus`. Context is fixed at 4096 (`translate_load` is called
with `n_ctx=0`); a model that needs more is a new card field, not a catalog edit. A recording
(`translate-<arch>.ops`, flash_attn on and off merged) is optional; only `qwen3` has one.

**A TTS family** — native + sidecar, needs a `native-v` release and a real GPU box. Fix the card
id first: the test model lives at `~/.cache/sokuji-native-tests/tts/<card-id>/` (one GGUF) and
every gate keys on that path.
1. Native: the family must be in the pinned audio.cpp (else a pin bump first: `GIT_TAG` and
   `SOKUJI_AUDIOCPP_VERSION` in `native/cmake/upstreams.cmake`, the anchors in
   `native/patches/audio.cpp.json`, the `audiocpp=0.7.1` literal in `native/tests/test_common.cpp`
   and `ev["audiocpp"] == "0.7.1"` in `native/python/tests/test_sokuji_native.py`, then every
   existing TTS recording re-recorded and the parity reference rebuilt). Add it to
   `AUDIOCPP_MODELS` in `native/cmake/upstreams.cmake` and a `kFamilies[]` row in
   `native/src/sk_tts.cpp` (streaming, clones, transcript_required, default rate, sample_decode,
   strict_options — read off audio.cpp's `src/models/<family>/` sources (moss_tts_nano's sit one
   level down, `src/models/moss/moss_tts_nano/`), or `src/community_models/<family>/` for a
   community model such as voxcpm1, not the model card;
   check `build_request` for a family that takes its language as a request option or validates
   options against its spec). Add the env var, a `NEW_CPU_TTS_FAMILIES` row and a
   `GPU_TTS_FAMILIES` row (+ `GPU_TTS_BF16_ENV` if a bf16 rung ships) in
   `native/python/tests/test_sokuji_native.py`, and the export in
   `native/ci/ops-env.sh`. Build the CPU lane and run the CPU synth cases: this is where you learn
   whether a bare `synth()` works (→ `VOICE_REQUIRED_FAMILIES`), whether a preset must be applied
   at load (→ `tts_backend._DEFAULT_PRESET_FAMILIES`, `tts_voices._LOAD_FREE_PRESETS`) and
   whether the family rejects request options.
2. Record on a real GPU (GB10 Vulkan or M4 Metal), never on the CPU tree — audio.cpp builds a
   different graph on a host backend, so a CPU recording refuses ops the GPU is never asked for:
   `cmake -S native -B native/build/record-vk -DSOKUJI_GPU=vulkan -DSOKUJI_RECORD_OPS=ON &&
   cmake --build native/build/record-vk -j`; a clone-only family first joins `needs_voice` in
   `native/tests/record_common.h`; then `native/build/record-vk/lib/record_ops
   native/build/record-vk/lib tts <family> <model-dir> native/src/ops/tts-<family>.ops
   <supertonic-dir>` — the header must read
   `# recorded-on: vulkan` (or `metal`). In the SAME commit: the `CASES[]` row in
   `native/tests/test_ops_coverage.cpp`, and in `native/tests/test_common.cpp` the `n_tts` and
   `n_swept` counts and the `want[]` roster — the counts iterate the baked blobs, so a tenth
   `.ops` without them fails CTest on every lane. Rebuild the same tree after the `.ops` lands (the
   glob is `CONFIGURE_DEPENDS`, a rebuild suffices), then gate: `bash native/ci/ops-env.sh ctest
   --test-dir native/build/record-vk -R test_ops_coverage`. CI runs that gate CPU-only and with
   supertonic and moss only; a new family's recording is proven on the fleet, not in CI.
3. Sidecar: one `_tts_gguf_row(...)` (quants with the exact `lfs.size` bytes from the
   `audio-cpp/audio.cpp-gguf` tree, languages from audio.cpp's `model_specs/<family>.json`);
   `VOICE_REQUIRED_FAMILIES` only if a bare synth raises — families that clone but speak with
   nothing set stay out. The card starts cpu-only (`_TTS_TIERS`): carve it out of
   `test_tts_quant_ladder_shape` the way `NEW_2026_09_03_TTS_CARD_IDS` once did, and add it to
   `_TTS_TIER_OVERRIDES` with its measured RTF table only after step 4. Tests: `test_catalog.py`
   (`TTS_CARD_IDS`, the card count, the voice-required tuples, a per-card shape test),
   `test_tts_backend.py` (an R16 gated or not-gated case), `test_accel.py` (`voice.required` on
   the wire if required). `test_every_tts_family_has_an_op_recording` is why step 2 comes first.
4. Fleet: `SK_TEST_TTS_GPU=1 SK_TEST_TTS_<FAMILY>_DIR=… pytest native/python/tests -k
   tts_synthesises_on_a_gpu_device` on GB10/Vulkan, the RTX 4070 SUPER and the M4, with the wheels
   from a `native-build.yml` dry run; optionally a loopback leg in
   `sidecar/tests/test_tts_engine.py` and a parity case. Only then the GPU tiers.
5. Prose nothing guards: the family lists and counts in `native/README.md`, the native bullets in
   this file (nine families, voice rules), the device-profile spec's §3.2.1, and the comments in
   `native/include/sokuji_native.h` and `src/lib/local-inference/native/nativeProtocol.ts`. Two
   renderer values to check: the per-card `MODEL_CLIP_LIMITS` in
   `src/lib/local-inference/native/nativeVoiceStores.ts` (reference-clip ceiling) and the single
   global `TTS_ASSUMED_RTF` in `NativeTtsClient.ts` (raise it if the family is slower than
   index_tts2 on CPU).
6. Release, in the order the Versions bullet fixes: native version + tag → wheels → pins,
   `test_runtime_gate.py` and `sidecarVersion` in one commit on main → sidecar tag → smoke the
   published bundles with `PYTHONNOUSERSITE=1` (the bundled interpreter honours user
   site-packages, which precede its own).

**A quant rung or weight dtype**: add it to the card (ASR: the `quants` dict AND the order tuple
inside `_tc_row`; translation: `_GGUF_SOURCES`, and widen `_llm_translate_row` for a third rung;
TTS: the `quants` dict) and give it a `RUNG_FALLBACK_DTYPES` entry — weight-capable ggml
spellings only (`q4_K`, not `q4_k_m`); a rung without one silently queries coverage over `{f32}`.
If the `q4_k_m` set changes length, `WIDEST_FALLBACK` in `native/cmake/gen_ops_data.py` moves with
it (`test_widest_fallback_matches_gen_ops_data`); the generated `static_assert` against
`SK_OP_COVERAGE_MAX` is the hard cap, and raising that is an ABI change. A dtype ggml 0.22 lacks
is a ggml pin bump; one it has but `gguf_header.GGML_TYPE_NAMES` lacks is one dict entry. No new
recording is needed — WEIGHT expands over the caller's dtype set at query time — unless the test
cache is repointed at the new rung's file, which drifts `dtypes-in-file` and forces a
re-recording. Update the per-card pins in `test_catalog.py`, the rung tuple in
`test_rung_fallback_sets_cover_cached_ggufs`, and regenerate the affected
`test_characterization.py` rows. A GPU-tiered TTS rung earns its tiers the way bf16 did: fleet
run first.

If prose and code disagree, the code wins: `gguf_header.read_header` for `arch=`,
`_TTS_TIER_OVERRIDES` for which families have GPU tiers (all nine, since 2f2b28bc), the
`# recorded-on:` header of a `.ops` file for where it was recorded, and `sidecar/requirements.txt`
for which wheel `sidecar-tests` installs. The comments that used to contradict these were
corrected on 2026-09-05.

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