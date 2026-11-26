# Local Native without Python: Node calls libsokuji_native directly

**Date:** 2026-11-23
**Branch:** `docs/sidecar-without-python`
**Status:** approved 2026-11-23 (decisions in §12). Implementation plans follow.

## 1. Summary

Today the Local Native engine is a Python program (the "sidecar"): python-build-standalone,
about 7,200 lines of Python, and the `sokuji_native` wheel, shipped as a separate 47–134 MB
download that the app fetches the first time someone turns the engine on. This design
removes Python. The engine becomes a TypeScript program running in an Electron
**utilityProcess**, calling `libsokuji_native` through a small **Node-API addon** we write.
The native libraries ship **inside the app installer**, are signed with the app, and are
upgraded with the app. The renderer's WebSocket protocol does not change.

Decided (detail in §12):

1. Bind with a Node-API addon, not koffi (§4, §5).
2. Ship the Vulkan backend inside the installer rather than downloading it on demand (§8.6).
3. No transition: Local Native has never been released, so the new engine simply replaces
   the Python one. Switching to it and deleting Python are one change (§9).
4. Still open: SignPath for the Windows native files (§8.4), and GPU machines for the
   Windows and linux-x64 checks (§7).

## 2. Where we are today

| Piece | Today |
|---|---|
| Engine process | `python -m sokuji_sidecar`, spawned by `electron/native-host-manager.js`; prints `{"port":N}` on stdout; WebSocket on `127.0.0.1:0` |
| Engine code | `sidecar/sokuji_sidecar/`, 17 modules, ~7,200 lines; deps: numpy, huggingface_hub, websockets, soxr, psutil |
| Native layer | `libsokuji_native` (transcribe.cpp + llama.cpp + audio.cpp on one ggml) behind the C ABI in `native/include/sokuji_native.h` (ABI 2), bound with ctypes in `native/python/sokuji_native/` |
| Distribution | `sidecar-vX` prerelease, one `tar.zst` per platform, downloaded and sha256-checked by `electron/sidecar-bundle.js` into `userData/sidecar/<sku>/`; version pinned by `package.json` `sidecarVersion` (0.4.0) |
| Signing | None. The bundles are unsigned on every platform |
| Models | Hugging Face cache layout under `userData/hf-cache` (`HF_HOME`) |
| Exposure | Gated off in every release (`VITE_ENABLE_LOCAL_NATIVE`); testers enable it with a localStorage switch |
| Renderer clients | `SidecarConnection.ts` plus `NativeAsrClient`, `NativeTranslateClient`, `NativeTtsClient`, `NativeModelClient`; one socket per stage; closing a socket frees that stage's model |

Two facts shape the rest of this document. Local Native has not shipped, so nothing has to
be migrated except testers' downloaded models, which we keep by keeping the cache layout.
And the Windows build signs only the outer installers and `sokuji-audio-host.exe` (through
SignPath, before packaging); `sokuji.exe` and the other `.dll` files inside the Squirrel
package are not Authenticode-signed.

## 3. Goals, non-goals, anti-goals

**Goals**

- No Python in the shipped app or in the app's build. The native library's own build
  tooling keeps its Python helpers (`patch_upstream.py`, `gen_ops_data.py`, the
  `check_*.py` gates) and its ctypes-based parity tests; they run in native CI and ship
  nothing. Wheels stop being published.
- The native libraries ship in the installer, are signed and notarized with the app, and
  update with the app. No separate engine download, no `sidecarVersion`, no "engine
  update required" state.
- An engine crash, a native abort or a GPU driver fault cannot take down the app window or
  the main process.
- The renderer and its WebSocket protocol stay unchanged, message for message
  (`wire_schema.json`). The four `Native*Client` classes and the Local Native re-port
  (#578, which re-lands the closed PR #587 file by file) keep working as they are.
- Same model catalog, same placement decisions, same model files on disk.

**Non-goals**

- Changing the C ABI. The addon wraps ABI 2 as it is. (One optional addition is
  discussed in §6.6.)
- Changing the renderer, the protocol, the catalog contents or the model formats.
- Windows on ARM, CUDA, ROCm: the platform matrix stays the five SKUs we build today.
- The mobile apps and the browser extension's WebGPU path.

**Anti-goals** (failures even if everything technically runs)

- Loading the native library into the Electron main process.
- Blocking the engine's JavaScript thread on a native call, so that a long transcription
  or synthesis stops the engine from answering other sockets.
- A second, separately downloaded and separately signed binary (the problem we are
  removing) coming back through a side door, for example an on-demand backend download.
- Users re-downloading models they already have.

## 4. Spike results (2026-11-23, linux-arm64, NVIDIA GB10)

Setup: the `native-v1.2.0` aarch64 wheel unpacked; `canary-180m-flash` Q8_0 and
`parakeet-tdt-0.6b-v3` Q8_0; the 11 s JFK sample (`transcribe.cpp/samples/jfk.wav`).
Both bindings were driven from plain Node 24.22 and from an Electron 44.5.1 utilityProcess
(Node 24.21, Node-API 10). The spike scripts are not part of this branch.

| Check | koffi 3.3.8 | Node-API addon (190 lines of C) |
|---|---|---|
| `sk_init`, `sk_devices`, `sk_asr_load`, `sk_asr_capabilities` | works | works |
| `sk_asr_run` canary, CPU | 310 ms (RTF 0.028), text matches the Python binding | 318 ms |
| `sk_asr_run` canary, Vulkan (warm) | 96–113 ms | 91–120 ms |
| `sk_asr_run` parakeet, Vulkan (warm) | 84 ms | – |
| Progress callback (`text == NULL` between decode steps) | 45 calls per run (canary), 1 (parakeet) | same |
| Cancel by returning `false` | `SK_ERR_CANCELLED`, message "cancelled by the callback" | same, via an atomic flag |
| JS thread responsive during a run | yes, with `.async`: a 5 ms timer kept firing | yes: work runs on a pool thread |
| Inside an Electron utilityProcess | works | works (built against Node 24.22 headers, loaded by Electron's Node 24.21) |
| Error text after an async failure | **wrong**: `sk_last_error()` is thread-local; read back on the JS thread it returned the previous, unrelated error | correct: read on the failing thread |

Process isolation, in the same Electron run: a utilityProcess that raised `SIGSEGV` exited
with code 139 and one that raised `SIGABRT` with 134; the main process noticed each exit
about 130 ms later and kept running.

Other observations that the design has to absorb:

- **Cancellation is coarse and family-dependent.** canary calls back only between decode
  steps, so its ~240 ms encoder cannot be interrupted; parakeet calls back once per run.
  This is the library's behaviour, the same under Python.
- **The first Vulkan run per executable compiles shaders.** In a cold driver cache the
  first canary run took 7.8 s under Node and 8.2 s under Electron, and ~0.1 s on every run
  after. The NVIDIA driver caches per executable, so switching from the Python interpreter
  to the Electron helper means each user pays this once more. It is not a binding cost.
- **A successful call does not clear `sk_last_error()`.** Callers must read it only after a
  failing status (the Python binding already does).
- **A utilityProcess does not exit when its event loop drains.** The spike's child stayed
  alive until killed; it exited promptly once the script called `process.exit()`. The
  engine is long-lived anyway, and main stops it explicitly (§6.5).

## 5. Approaches considered

**A. Node-API addon + TypeScript engine in a utilityProcess (recommended).** A small C/C++
addon wraps the C ABI; every blocking call runs on a native worker thread; callbacks reach
JS through thread-safe functions that never make the native thread wait; cancellation is
an atomic flag the native callback reads directly. The engine logic is ported to TypeScript.

**B. koffi + TypeScript engine in a utilityProcess.** No compiler needed and the spike
worked. Three costs decide against it:
- Every callback from a worker thread is relayed to the JS thread, and the native thread
  waits for the answer. Progress, token and audio callbacks therefore all stall the engine
  on the JS event loop, and a callback that re-enters `sk_tts_*` on the same handle would
  deadlock (the header forbids it, and koffi makes it easy to do by accident).
- Thread-local error text is lost on async calls (§4), so every async call would need a
  C shim anyway, which is most of an addon.
- koffi gives JavaScript raw memory access and is itself a third-party native module to
  ship and sign in the same security-sensitive spot.

**C. A native engine executable in C++** that serves the WebSocket itself. No Node in the
engine at all, but it means rewriting catalog, planner, downloads and the three engines in
C++, including HTTP with resume and TLS. Slowest to build and hardest to change later.

**D. Load the addon in the main process.** Rejected: a native crash would take down the app.

**E. Keep Python but ship it in the installer.** Out of scope: the decision was to drop Python.

The cost of A over B is the addon build on five platforms. That build slots into the
native CI we already run (§8.7), and Node-API's stable ABI means one build per platform
keeps working across Electron upgrades, which the spike confirmed across two Node versions.

## 6. Architecture

### 6.1 Processes

```
Electron main ──utilityProcess.fork('engine.js')──▶ engine process (Node, no window)
     │  IPC: native-host:start → {port}                 │  require('sokuji_native_node.node')
     │                                                  │  ws server on 127.0.0.1:0
renderer ──────────── ws://127.0.0.1:<port> ───────────▶│  catalog · planner · downloads
  (unchanged clients, one socket per stage)             │  ASR / translate / TTS engines
                                                        └─ native worker threads (one per model handle)
```

- Main forks the engine on the first `native-host:start`, exactly where it spawns Python
  today, and returns the port the engine reports over `parentPort` (instead of a stdout
  line). The renderer still learns the port only through that IPC reply.
- The engine hosts the same WebSocket server as `server.py`, using the `ws` package (a
  devDependency today; the engine entry bundles it, as Vite already does for every
  devDependency, so it must not be marked external, or Forge's pruning would drop it). The
  renderer, `SidecarConnection.ts` and the re-port's `engines.ts` need no change.
- One engine process for all three stages, as today. Splitting stages into separate
  processes is possible later but would multiply model memory and device initialisation.

### 6.2 The addon (`native/node/`)

A C++ addon over Node-API (C API, `NAPI_VERSION` 8), linked against `libsokuji_native`
and shipped next to it as `sokuji_native_node.node` (a base name no Windows DLL shares). It mirrors the Python package's object
model so the port of the backends is mechanical:

```ts
init({ threads?: number, onLog?: (level, message) => void }): { threads: number }
version(): { abi: number; version: string; engines: string }
devices(): Device[];  deviceProfiles(): DeviceProfile[];  deviceFreeMem(index): number
deviceSupportsOps(index, stage, family, dtypes): Promise<OpCoverage>
audioFamilies(): string[]

asrLoad(path, deviceIndex | null): Promise<AsrModel>
  AsrModel.capabilities
  AsrModel.run(pcm: Float32Array, lang | null, { signal?, onProgress? }): Promise<string>
  AsrModel.openStream(lang | null): AsrStream
    AsrStream.feed(pcm): Promise<{ committed, tentative }>
    AsrStream.finalize({ signal? }): Promise<string>;  AsrStream.close(): void
  AsrModel.unload(): Promise<void>

translateLoad(path, deviceIndex | null, { nCtx?, flashAttn? }): Promise<Translator>
  Translator.chat(messages, { maxTokens?, assistantPrefill? }, { onToken, signal? }): Promise<void>
  Translator.complete(prompt, { maxTokens? }, { onToken, signal? }): Promise<void>
  Translator.unload(): Promise<void>

ttsLoad(path, deviceIndex | null, { family, language? }): Promise<Tts>
  Tts.capabilities;  Tts.presets(): Promise<string[]>
  Tts.setVoice(pcm: Float32Array, sampleRate, refText | null): Promise<void>
  Tts.setPreset(name): Promise<void>
  Tts.synth(text, language, speed, { onAudio(pcm, sampleRate, channels), signal? }): Promise<void>
  Tts.unload(): Promise<void>
```

Rules the addon enforces, each answering a sentence in the header:

- **One worker thread per handle, with a FIFO queue.** Every call on a model, stream,
  translator or TTS handle is queued on that handle's thread. This matches the library's
  per-handle serialisation, keeps calls in the order JS made them (stream feeds), and
  keeps long native work off libuv's four-thread pool, which the engine also needs for
  file and network I/O.
- **Callbacks never block on JS.** Progress, tokens, audio and logs are posted through
  `napi_threadsafe_function` in non-blocking mode. The bool a native callback must return
  comes from the job's atomic cancel flag, which `AbortSignal` sets. Nothing JS does can
  re-enter a handle from inside its own callback, so the TTS deadlock the header warns
  about cannot happen.
- **Data crossing threads is copied.** PCM going in is copied out of the `Float32Array`
  before queuing (garbage collection safe). Audio coming out of `sk_audio_cb` is copied into
  a new `ArrayBuffer`. Token pieces are passed as bytes; the engine decodes them with a
  streaming `TextDecoder`, because a piece may end in the middle of a UTF-8 character.
- **Errors are read where they happen.** After a failing status the worker thread reads
  `sk_last_error()` immediately and rejects the promise with `{ status, message }`.
- **Lifetimes follow the header.** A stream holds a reference to its model; `unload()`
  cancels queued jobs, closes open streams, then unloads on the handle's thread. A handle
  that JS drops without unloading is unloaded by its finalizer (and logged, since it is a bug).
- **`sk_init` once, log sink alive forever.** The log thread-safe function is created
  once, never released, and unref'd so it does not keep the process alive.

### 6.3 Where each Python module goes

The engine lives in TypeScript under `electron/engine/` and is built by Vite as one more
main-process entry (`dist-electron/engine.js`, inside the asar).

| Python module | Lines | Goes to | How |
|---|---:|---|---|
| `wire.py` + `wire_schema.json` | 76 + schema | `wire.ts`; the schema moves to a shared path | Same validator, strict in tests. `nativeProtocol.consistency.test.ts` reads the moved schema and the TS handlers instead of scanning `.py` files |
| `server.py`, `__main__.py` | 197 | `server.ts`, `main.ts` | `ws` server on `127.0.0.1:0`, 64 MiB max frame, binary-then-JSON send order, serial dispatch per connection, `on_close` cleanups; port reported over `parentPort` |
| `native.py` | 61 | `native.ts` | Loads the addon once, `init` with `SOKUJI_NATIVE_THREADS`, log sink into the app log |
| `backends.py` | 46 | `backends.ts` | Registry and `BackendLoadError` (the fallback signal) |
| `catalog.py` | 1,301 | `catalog.ts` | Data tables and row builders, ported as code. Golden: every card's deployments, licenses and voice capability exported from Python before deletion |
| `gguf_header.py` | 108 | `ggufHeader.ts` | `fs` + `DataView`; the synthetic GGUF writer from the tests ports with it |
| `planner.py` | 691 | `planner.ts` | Pure functions, ported line for line. Golden: `test_characterization.py`'s Machine × model × override matrix and `test_planner.py`'s tables, exported as JSON vectors |
| `accel.py` | 1,152 | `accel/probe.ts`, `accel/loader.ts`, `accel/bench.ts` | Probe through the addon; load-with-fallback, measured memory ledger, RTF/tokens-per-second benches. The bench cache gets a new key (below) |
| `native_models.py` | 706 | `models/hfCache.ts`, `models/download.ts`, `models/handlers.ts` | Our own downloader writing the same Hugging Face cache layout (§6.4) |
| `asr_backend.py` | 174 | `asr/backend.ts` | Language mapping and the stream adapter (committed deltas, final full text) |
| `asr_engine.py` | 606 | `asr/engine.ts` | Marks, 0.7 s pre-roll, 30 s cap, always-stream ↔ per-utterance backpressure, 20 s run-on cap. The Int16 → 16 kHz linear-interpolation downsample ports exactly so outputs match |
| `translate_backend.py` | 445 | `translate/backend.ts` | Qwen / Hunyuan / Gemma prompt strategies, `_GEMMA_LANG_NAME`, output cleaning, ChatML fallback; cancellation through `AbortSignal` |
| `translate_engine.py` | 330 | `translate/engine.ts` | Generation token, disconnect race |
| `tts_backend.py` | 715 | `tts/backend.ts` | Nine families, staging hard-links (copy fallback), voice rules, warm-up synth; streaming through `onAudio` |
| `tts_engine.py` | 513 | `tts/engine.ts` | Owner-connection check, cancel relay; downmix + resample to Int16 24 kHz mono (§6.6) |
| `tts_voices.py` | 65 | `tts/voices.ts` | Supertonic presets, pocket_tts embeddings from the local snapshot |

Expected size: about 6,000–7,500 lines of TypeScript plus the addon (~900–1,200 lines of
C++), and the ported tests.

**Bench cache key.** `accel.py` hashes with blake2s at a 6-byte digest over Python `repr`
strings. Node's `crypto` has no variable-length blake2s, and reproducing `repr` exactly is
fragile. The TS engine uses a new key (sha256 over a JSON fingerprint, truncated) in a new
file; benches are re-measured once. Nothing shipped depends on the old file.

### 6.4 Model downloads and the cache

The cache stays where it is (`userData/hf-cache`) in the same layout
(`models--org--repo/{blobs,snapshots,refs}`), so testers' models keep working and, during
the transition, both engines can read each other's downloads.

`download.ts` replaces `hf_hub_download`:

- Resolves `{HF_ENDPOINT or https://huggingface.co}/{repo}/resolve/{revision}/{file}`,
  follows redirects, and honours `HF_ENDPOINT` so a mirror can be configured.
- Writes to `blobs/<etag>.incomplete`, **resumes with HTTP Range** (the Python path does
  not), then renames atomically and links `snapshots/<commit>/<file>` (a copy where Windows
  does not allow symlinks, as huggingface_hub does).
- **Verifies sha256** against the LFS object id, which the Python path never did.
- Reports progress from bytes actually written instead of polling `.incomplete` sizes.
- Cancels between chunks (today: only between files).

`@huggingface/hub` (npm) writes the same layout but, in the version checked (2.6.12), has
no resume and no progress, so it is a reference rather than a dependency. Status and delete
port from `native_models.py` against the same layout; a test builds a cache with Python's
`huggingface_hub` and checks the TS side reads it, and the reverse.

### 6.5 Crash, hang and restart

- **Crash.** The engine's `exit` event (a nonzero code or a signal) clears the port, logs
  the code with the engine's last log lines, and closes the renderer's sockets as today; the
  next `connect()` respawns. New: three crashes within 60 s stop automatic respawns.
- **How the renderer hears about it.** Every engine-level failure (the addon cannot load,
  for example on an old Linux; the engine keeps crashing) comes back as the existing
  `native-host:start` reply `{ ok: false, error }`, which the renderer already turns into
  `sidecarStatus: 'unavailable'`. No WebSocket message is added. Showing the error text on
  the model library page is part of the re-port's UI work (#578).
- **Hang.** The JS thread never runs native work, so main pings it over `parentPort` every
  5 s and kills it after 15 s without a reply. A native call that never returns (a GPU
  driver stuck in a fence wait) leaves the JS thread responsive, so each job also has a
  deadline scaled to its input (audio length, max tokens, text length); past the deadline
  the engine reports an error to that socket and main restarts the process, the only way to
  stop a stuck native call.
- **Shutdown.** Main stops the engine on quit, before installs, and on sandbox recovery,
  the same call sites as `stop()` today. The engine closes sockets and unloads models on
  a polite stop and is killed after 2 s.

### 6.6 What Python libraries did that now needs a home

- **soxr resampling (TTS → 24 kHz).** Options: a BSD resampler (speexdsp's) vendored into
  the addon, or a small `sk_resample` added to the C ABI. Recommendation: vendor into the
  addon and gate it with an SNR test against soxr output captured before deletion. The
  ASR side's linear downsample stays in TypeScript.
- **numpy.** Only array conversions and concatenation: typed arrays cover it.
- **psutil.** RSS for the memory ledger: `process.memoryUsage().rss`.
- **huggingface_hub.** §6.4.

### 6.7 Small fixes the port brings for free

The Python engine still blocks its own event loop in `asr_init` / `translate_init` (load
plus benchmark), offline transcription, streaming `feed`, and `hardware_info` /
`models_catalog` / `model_status`. In the TS engine all of these are promises on native
worker threads or async file I/O. One-shot TTS also becomes cancellable between chunks for
streaming families, and the known issue where `cancel()` can hit another connection's
translation (`_workers[-1]`) goes away because each job carries its own `AbortSignal`.

### 6.8 Origin check on the WebSocket

The WebSocket has no token and no Origin check. Any web page open in a browser on the same
machine can connect to `ws://127.0.0.1:<port>` and, for example, start or delete model
downloads. The TS engine rejects upgrade requests that carry an `Origin` header other than
the app's own origins (the dev server in development, the packaged renderer's origin in
releases; both checked in phase 3). Browsers always send `Origin`, so a web page cannot
pass. No message changes, so the protocol stays as it is.

## 7. Protocol compatibility

The parity target is the protocol on `main` today: `wire_schema.json`, the handlers in
`sidecar/sokuji_sidecar/`, and the four `Native*Client` classes. It is frozen for the
duration of this work; the re-port (#578) uses the clients as they are. Any change to it
from here on is made in both engines at once, or waits for the TS engine.

Nothing the renderer sends or receives changes: same message types, same fields, same
binary frame formats (Int16 LE ASR input at the client's rate, Float32 LE voice clips,
Int16 LE 24 kHz TTS output sent immediately before its JSON), same per-socket model
lifetime. Two checks keep it that way:

- The strict wire validator runs in every engine test, as `SOKUJI_WIRE_STRICT=1` does today.
- A recorded-session test: before Python is deleted, record the JSON and binary frames of a
  scripted session against the Python engine (catalog, status, ASR init and a JFK
  transcription, translate, TTS init and a short synth). The TS engine must produce the same
  message sequence and fields.

What counts as passing, on the same machine and the same native library:

- Golden vectors (catalog, planner, characterization, GGUF header, DSP): identical.
- Transcripts and translations of the recorded session: identical text (both engines call
  the same library with the same greedy settings).
- TTS: same sample rate and chunk sequence; total duration within 5 %; not silent.
  Audio bytes are not compared (resampler changes, §6.6).
- Speed: ASR real-time factor and translation tokens per second within 10 % of the Python
  engine.

CI has no GPU, so the native CI runs the addon tests on CPU on all five runners. GPU runs
are manual: Vulkan on the linux-arm64 development machine, Metal on a real Mac. A Windows
machine with a GPU and a linux-x64 machine are still needed (§12).

## 8. Packaging and signing

### 8.1 What ships per platform (native-v1.2.0, measured)

| SKU | Native files (compressed, wheel) | Installed on disk | Biggest files | Python sidecar today (separate download) |
|---|---:|---:|---|---:|
| mac-arm64 | 6.0 MB | 17.2 MB | `libsokuji_native.dylib` 12.2 MB, Metal backend 2.1 MB | 47 MB |
| mac-x64 | 12.2 MB | 33.4 MB | `libsokuji_native.dylib` 13.1 MB, 14 CPU variants ~20 MB | 49 MB |
| linux-arm64 | 21.0 MB | 60.3 MB | `libggml-vulkan.so` 40.8 MB, `libsokuji_native.so` 13.1 MB | 106 MB |
| linux-x64 | 25.1 MB | 72.8 MB | `libggml-vulkan.so` 40.9 MB, `libsokuji_native.so` 15.0 MB | 134 MB |
| win-x64 | 19.7 MB | 59.0 MB | `ggml-vulkan.dll` 40.7 MB, `sokuji_native.dll` 10.0 MB | 52 MB |

The addon adds about 0.1 MB. Installers are compressed archives too (zip, xz, squashfs), so each
installer grows by roughly the compressed column; disk use after install grows by the
installed column. In exchange, the separate engine download (47–134 MB compressed, more
unpacked) disappears, and the one-time "install engine" step goes with it.

### 8.2 Layout in the app

The libraries and the addon go under `resources/native/` via each packager's extra
resources, outside the asar: `dlopen` cannot read from inside an asar, and the
`OnlyLoadAppFromAsar` fuse applies to the app's JavaScript, not to these files. The
engine's JavaScript stays inside the asar. `sk_init` receives
`module_dir = resources/native/` so ggml finds its backend modules there. Only the current
platform and architecture's files are copied into each build (electron-builder `${arch}`
for macOS/Linux, a Forge hook for Windows).

### 8.3 macOS

- electron-builder already signs every Mach-O file inside the `.app` with the Developer ID,
  hardened runtime and a timestamp, and notarization rejects the app if any is unsigned,
  so the dylibs and `.so` backend modules are covered by the existing pipeline. The
  existing post-build check in `build.yml` should be extended to assert that each native
  file is signed with our team ID.
- The utilityProcess runs as a helper app. `entitlementsInherit` already grants
  `cs.disable-library-validation`; because every library is signed with our own team ID,
  library validation would pass even without it.
- Metal shaders are embedded in the library (`GGML_METAL_EMBED_LIBRARY`), so there is no
  `.metallib` to place or sign.
- To verify on a real Mac: notarization passes, Metal is used from the helper
  process, and the helper is not throttled when the window is in the background.

### 8.4 Windows

- The DLLs and `sokuji_native_node.node` are signed through SignPath **when the native release
  is built** (`native-build.yml`), not in every app build. The archive and its committed
  checksum then cover signed files, and app builds change nothing. This needs a SignPath
  artifact configuration for the native files, and SignPath Foundation's policy has to
  accept them: they are built from source in this repository's CI, as
  `sokuji-audio-host.exe` is, but most of the code is vendored (ggml, llama.cpp,
  transcribe.cpp, audio.cpp). If SignPath declines, the files ship unsigned, which is no
  worse than today's unsigned bundle, but Windows Smart App Control can block unsigned
  DLLs on machines where it is on.
- Node loads the addon with an altered search path, so DLLs next to it are found; ggml
  loads its backend DLLs from `module_dir`. The Vulkan loader (`vulkan-1.dll`) comes from
  the GPU driver; without it the Vulkan backend fails to load and CPU is used, as today.
- Squirrel packages are full packages: each app update re-downloads the native files
  (~20 MB compressed) even when they did not change. macOS zips and AppImages use
  electron-updater's blockmap differential download, which skips unchanged blocks.

### 8.5 Linux

- The native libraries are built on Ubuntu 22.04: the newest glibc symbol they use is
  2.34 and they need libstdc++ with `GLIBCXX_3.4.30` (Ubuntu 22.04+, Debian 12+), while
  the app itself is built on `ubuntu-latest`. On an older system the addon fails to load: the engine catches
  that and reports Local Native as unsupported on this system with the loader's message,
  instead of crashing.
- `RUNPATH $ORIGIN` is already set, so the libraries find each other in `resources/native/`.
- AppImage and deb both carry the files. The Vulkan loader (`libvulkan.so.1`) is a system
  library; without it ggml's Vulkan backend does not load and CPU is used. Adding
  `libvulkan1` to the deb's `recommends` makes the GPU path work out of the box.

### 8.6 Ship the Vulkan backend, or download it on demand?

On Windows and Linux the Vulkan backend is 40.8 MB on disk and about 12 MB of the
compressed installer (zstd at level 19 gets it to 5 MB). Downloading it on demand would
keep that out of the installer, but it brings back exactly what this design removes: a
binary fetched at run time, signed separately, version-locked to the app, with its own
download, resume and error states. **Recommendation: ship it.** If installer size becomes
a concern later, trimming the x64 CPU variants (14 builds on Linux and macOS, 16–19 MB on
disk; 9 on Windows, 7.5 MB) is the cheaper lever, at some performance risk on older CPUs.

### 8.7 Build pipeline

- `native-build.yml` keeps building the libraries on its five runners, adds the addon to
  the same CMake project (against `node-api-headers`, no Node needed at build time beyond
  the headers), runs the addon's tests against the fresh stage, and publishes one
  `sokuji-native-<sku>-vX.Y.Z.tar.zst` per platform plus a `manifest.json` with sha256s on
  the `native-vX.Y.Z` prerelease. On Windows the files are signed before archiving
  (§8.4). Wheels stop being published once Python is gone.
- `build.yml` gets a `nativeVersion` from `package.json`, downloads the matching archive,
  checks its sha256 against a checksum committed in the repo, unpacks it into
  `resources/native/`, and then packages and signs as usual. Native builds (the slow part,
  with the Vulkan toolchain) stay out of every app build.
- `sidecar-bundles.yml`, `scripts/build-sidecar-bundle.py`, the bundle smoke test and
  `electron/sidecar-bundle.js` are deleted at the end (§9).

## 9. Rollout

Local Native has never been released, so there is no transition to manage: the new engine
replaces the Python one, protected by gates rather than by a release that carries both.

**How the phases reach `main`.** Phases 1–3 merge one by one as dormant code: native CI
changes, the addon, and the TS engine under `electron/engine/`. Nothing in them changes
what `build.yml` packages or what `native-host:start` launches; the engine's own tests run
it as a plain Node process with a WebSocket client. There is no switch between engines.
Phase 4 is **the switch PR**: it adds the native files to packaging, makes
`native-host:start` launch the Node engine, and deletes the Python sidecar, in one change.
Before it merges, its branch is built on all five platforms through a manual run of
`build.yml`, and those packaged builds pass the gate.

| Phase | Work | Exit gate |
|---|---|---|
| 1. Addon and native packaging | Addon for the full ABI; addon tests in native CI; Windows signing; per-SKU archives on a `native-v1.2.x` prerelease | Addon tests green on all five runners; JFK transcribes from the archive on each |
| 2. Golden export | One script exports catalog, planner, characterization and DSP vectors from the Python code, plus the recorded session (§7) | Vectors committed |
| 3. Engine port | TS modules per §6.3, ported tests, downloader, Origin check | Vectors and the recorded session match; strict wire validation passes |
| 4. The switch | utilityProcess host, restart and watchdog, packaging; `sidecar-bundle:status` answers `ready`, `install` / `remove` do nothing (renderer unchanged); remove `sidecar/`, the sidecar workflows, `sidecar-bundle.js`, `sidecarVersion`, the Python CI job; delete `userData/sidecar/` on first run | Packaged builds from the branch on all five platforms run a full session; the re-port's real-session e2e tests pass against the Node engine; Mac build notarized and checked on a real Mac; full unit and e2e suites green |
| 5. Renderer cleanup | Remove the dead bundle states (`bundleStatus`, `bundlePhase`, the install card, `sidecar-bundle-progress`) and the IPC stubs | Full suites green |

Testers' models in `userData/hf-cache` stay. The old bundle directory (up to a few hundred
MB unpacked) is removed on first run of the new version.

**Order with the Local Native re-port (#578).** The re-port re-lands the closed PR #587 onto
the current provider structure in four stacked PRs (preparation; the whole unit, testers
only; split transcription / translation / speech units; the UI, including the native model
library on the Models and storage page, plus real-session e2e tests on this machine). It
runs on the Python engine and touches `nativeModelStore` and the native model screens.

- The re-port goes first. Phases 1–3 here run in parallel with it: they touch `native/`
  and `electron/engine/`, which it does not.
- Phase 4 waits for the re-port's real-session e2e tests, because they are its acceptance
  gate: the same sessions must pass on the Node engine.
- Phase 4 keeps the main-process IPC contract (`sidecar-bundle:status` answers `ready`),
  so the re-port's UI needs no change at the switch.
- Phase 5 removes the bundle states only after the re-port's stack has landed, so the two
  never edit the same lines at the same time.
- The engine keeps today's one-engine-per-stage behaviour, shared by all connections.
  Moving to one engine per connection is a separate decision; the TS engine makes it
  easier but does not include it.

## 10. Effort

Estimated in working days for one developer agent, including tests and review rounds:

| Phase | Days |
|---|---:|
| 1. Addon (full ABI, threads, callbacks, tests) and native CI archives | 5–6 |
| 2. Golden export | 1 |
| 3. Engine port: catalog, planner, GGUF header, accel | 4–5 |
| 3. Engine port: downloads and cache | 2–3 |
| 3. Engine port: server, wire, ASR / translate / TTS engines | 4–5 |
| 4. The switch: Electron integration, packaging, signing, deletion | 5–7 |
| 4. Cross-platform verification, parity and performance | 3–4 |
| 5. Renderer cleanup | 1–2 |
| **Total** | **25–33** |

About five to seven weeks of calendar time with reviews and the Mac and Windows checks,
which depend on other people's machines. Phases 1 and 2–3 can run in parallel with two
agents, which brings the calendar time toward four weeks.

## 11. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Porting changes a placement or catalog decision silently | Medium | Golden vectors exported from Python before deletion; the TS port must reproduce them exactly |
| Windows DLL loading problems (search path, antivirus) | Medium | Phase 4 gate is a packaged build on a real Windows machine |
| SignPath declines to sign the vendored native code | Low–medium | Ship unsigned as today; Smart App Control may block it where enabled |
| macOS notarization or Metal in the helper process | Low–medium | Existing signing covers all Mach-O files; verified on a real Mac in phase 4 |
| Linux systems older than Ubuntu 22.04 / Debian 12 | Low | The addon fails to load; `native-host:start` reports it and the engine is shown as unavailable |
| A native call hangs (GPU driver) | Low | Per-job deadline; main restarts the engine |
| First GPU run per executable is slow (shader compile, ~8 s observed) | Certain, once per machine | Within the renderer's 120 s init timeout; same cost the Python engine has today |
| libuv pool starvation by long native calls | Avoided by design | One native thread per handle (§6.2) |
| Installer growth (+6 to +25 MB compressed) and full-package Windows updates | Certain | Accepted against removing a 47–134 MB separate download; CPU variant trimming is available if needed |
| The downloader behaves differently from huggingface_hub (redirects, proxies, mirrors) | Medium | Same cache layout both ways during the transition; tests against a Python-built cache; `HF_ENDPOINT` honoured |
| Protocol drift breaks the renderer or the re-port | Low | Protocol frozen (§7); strict wire validator; recorded-session test |

## 12. Decisions

Decided by the maintainer on 2026-11-23:

1. **Node-API addon**, not koffi (§4, §5).
2. **The Vulkan backend ships in the installer** (§8.6).
3. **No transition.** Local Native was never released, so the new engine replaces the
   Python one in a single change (§9).

Still open:

4. **SignPath for the native DLLs and the addon** at native-release time (§8.4). Needs a
   SignPath configuration change; asked when phase 1 reaches it.
5. **Machines for the GPU checks**: a Windows machine with a GPU and a linux-x64 machine
   for phase 4 (§7). The linux-arm64 machine and a real Mac are already available.

Decided in this document rather than asked: the Origin check (§6.8), the new bench-cache
key (§6.3), keeping the Hugging Face cache layout (§6.4), and signing on Windows at
native-release time rather than per app build (§8.4).

## Appendix: reproducing the spike

The spike used three small programs outside the repository: a koffi script and a Node-API
addon (one C file, built with `gcc -shared` against Node's headers and the unpacked
wheel's `_native/` directory with an rpath), each running init → devices → load →
capabilities → run (sync and async) → cancel → unload on `jfk.wav`, and an Electron main
script that runs both in a utilityProcess and then raises `SIGSEGV` and `SIGABRT` in two
more utility processes. They are kept in the author's workspace and can be added to the
repository if reviewers want them.
