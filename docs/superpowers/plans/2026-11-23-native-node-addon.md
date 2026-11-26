# Native Node Addon and App Archives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node-API addon over `libsokuji_native` (ABI 2) and a per-platform archive of the libraries plus the addon, built and tested by `native-build.yml` on the five runners.

**Architecture:** A C++ addon (node-addon-api, `NAPI_VERSION` 8) in `native/node/`, built by the existing native CMake project and installed under its own install component. Every model handle owns one native worker thread with a FIFO queue; callbacks reach JS through non-blocking thread-safe functions; cancellation is an atomic flag set from an `AbortSignal`. CI packs the stage and the addon into `sokuji-native-<sku>-v<version>.tar.zst` with a sha256 manifest.

**Tech Stack:** C++17, Node-API via node-addon-api 8.9.2 and node-api-headers 1.9.0 (both vendored, MIT), CMake ≥ 3.28, `node:test` for addon tests, speexdsp's resampler (BSD-3, vendored), Python 3.12 for the archive script (native CI only).

**Spec:** `docs/superpowers/specs/2026-11-23-sidecar-without-python-design.md` (§4, §5, §6.2, §6.6, §8). Plan 2 (`2026-11-23-engine-ts-port.md`) consumes this plan's JS API; plan 3 (`2026-11-23-engine-switch.md`) consumes its archives.

## Global Constraints

- The C ABI and `native/include/sokuji_native.h` do not change (ABI 2).
- `NAPI_VERSION` 8. The addon must load in Node ≥ 18 and in Electron 44 (Node-API 10) from one build per platform.
- One native worker thread per handle; nothing blocks the JS thread; no native callback ever waits for JS.
- Errors are `Error` objects with `name = 'NativeError'`, a numeric `status` (the `sk_status`), and the message `` `${what}: ${lastError || 'unknown error'} (status ${status})` `` where `what` is the C function name (same text as the Python binding's `NativeError`). `sk_last_error()` is read on the thread that got the failing status, immediately.
- Addon file name: `sokuji_native_node.node` (not `sokuji_native.node`, so it never shares a base name with `sokuji_native.dll` on Windows).
- SKUs and lanes are the existing ones: `linux-x64` (vulkan), `linux-arm64` (vulkan), `win-x64` (vulkan), `mac-arm64` (metal), `mac-x64` (none). The Vulkan backend ships in the archive.
- Linux objects stay within the existing floor checked by `native/ci/check_linux_deps.py` (glibc symbols ≤ 2.34, `GLIBCXX_3.4.30`), the addon included.
- The Python binding, its tests and the wheels stay as they are in this plan (plan 3 stops publishing wheels).
- Pushing a branch, running a workflow on GitHub, tagging, or opening a PR on `kizuna-ai-lab/sokuji` needs the maintainer's go-ahead first, naming the repo and branch.

## Review Focus

1. **Electron on Windows loading the addon.** Node-API addons link against `node.exe`; inside Electron the host is a different executable, which only the delay-load hook fixes. Expected: the addon loads under `ELECTRON_RUN_AS_NODE=1 electron` on `windows-2022`. Pinned in Task 9 (CI step).
2. **Model paths with non-ASCII characters** (a Windows user named 山田: `C:\Users\山田\AppData\...`). Expected: `asrLoad` succeeds or fails with a clear `NativeError`, never a crash. Pinned in Task 3 (`loads a model from a non-ASCII directory`).
3. **Calls after `unload()`, double `unload()`, `unload()` while a run is queued or a stream is open.** Expected: promises reject with `status` −2 or −5; no crash, no hang. Pinned in Task 8.
4. **The process exits while a native job is running** (main kills or the engine calls `process.exit`). Expected: exit code is the one requested, no abort from a thread still touching a torn-down environment. Pinned in Task 8 (`exits cleanly while a run is in flight`).
5. **Zero-length and very long PCM** (an empty segment; a 30 s segment). Expected: empty input resolves `''` without calling native; 30 s transcribes. Pinned in Task 3.

---

## File Structure

| Path | Responsibility |
|---|---|
| `native/node/CMakeLists.txt` | `sokuji_native_node` MODULE target, platform link flags, install component `sokuji_node`, the `node --test` CTest entry |
| `native/node/third_party/node-api-headers/` | Vendored node-api-headers 1.9.0: `include/*.h`, `def/node_api.def`, `LICENSE`, `VERSION` |
| `native/node/third_party/node-addon-api/` | Vendored node-addon-api 8.9.2: `napi.h`, `napi-inl.h`, `napi-inl.deprecated.h`, `LICENSE.md`, `VERSION` |
| `native/node/third_party/win_delay_load_hook.cc` | The node-gyp delay-load hook (MIT), Windows only |
| `native/node/third_party/speexdsp/` | `resample.c`, `speex_resampler.h`, `arch.h`, `os_support.h`, `stack_alloc.h`, `fixed_generic.h`, `COPYING`, `VERSION` (SpeexDSP-1.2.1) |
| `native/node/src/addon.cpp` | Module init and export table; env cleanup hook |
| `native/node/src/errors.h/.cpp` | `NativeError` construction from `(what, status, message)` |
| `native/node/src/worker.h/.cpp` | `HandleWorker`: one thread, FIFO of jobs, cancel-all, stop-and-join |
| `native/node/src/job.h` | `Job` base: deferred promise, shared cancel flag, `AbortSignal` hookup, resolve/reject on the JS thread |
| `native/node/src/common.cpp` | `init`, `abi`, `version`, `engineVersions`, `devices`, `deviceFreeMem`, `deviceProfiles`, `deviceSupportsOps`, `audioFamilies`, `contract` check |
| `native/node/src/asr.cpp` | `asrLoad`, `AsrModel`, `AsrStream` |
| `native/node/src/translate.cpp` | `translateLoad`, `Translator` |
| `native/node/src/tts.cpp` | `ttsLoad`, `Tts` |
| `native/node/src/resample.cpp` | `resample()` over speexdsp |
| `native/node/index.d.ts` | The JS API as TypeScript declarations (the contract plan 2 imports) |
| `native/node/test/*.test.mjs` | `node:test` suites; models from the existing `SK_TEST_*` variables, skipped when absent |
| `native/ci/make_app_archive.py` | Stage + addon → `sokuji-native-<sku>-v<ver>.tar.zst`, `.sha256`, manifest fragment |
| `native/ci/NOTICES.in` + upstream license paths | Third-party notices file shipped in the archive |
| `native/CMakeLists.txt` | `option(SOKUJI_NODE_ADDON ... ON)`, `add_subdirectory(node)` |
| `native/ci/build.sh`, `native/ci/build.ps1` | Install the `sokuji_node` component, run the archive script |
| `.github/workflows/native-build.yml` | Upload archives; the release job attaches archives and `manifest.json` |

## The JS API (`native/node/index.d.ts`)

Task 1 writes this file in full; later tasks fill in the implementations. Plan 2 imports these types.

```ts
export interface NativeError extends Error { name: 'NativeError'; status: number }
export type DeviceKind = 'cpu' | 'vulkan' | 'metal' | 'other';
export interface Device { index: number; kind: DeviceKind; name: string; description: string; memTotal: number; memFree: number }
export interface DeviceProfile { index: number; kind: DeviceKind; name: string; description: string; memTotal: number;
  known: boolean; features: string[]; driverName: string; driverVersion: string; deviceUuid: string; cpuFeatures: string }
export interface OpCoverage { allSupported: boolean; unsupported: string[]; checked: string[] }
export interface InitOptions { moduleDir: string; threads?: number; onLog?: (level: 0 | 1 | 2 | 3, message: string) => void }
export interface RunOptions { signal?: AbortSignal }

export function abi(): number;                                   // sk_abi_version()
export function version(): string;                               // sk_version()
export function engineVersions(): Record<string, string>;        // parsed "k=v;k=v"
export function contract(dir: string): { abi: number; version: string; lane: string; [k: string]: unknown };
export function init(opts: InitOptions): { threads: number };    // idempotent; first call wins
export function devices(): Device[];
export function deviceFreeMem(index: number): number;
export function deviceProfiles(): DeviceProfile[];
export function deviceSupportsOps(index: number, stage: 'asr' | 'translate' | 'tts', family: string, weightDtypes: string[]): Promise<OpCoverage>;
export function audioFamilies(): string[];
export function resample(pcm: Float32Array, channels: number, fromRate: number, toRate: number): Float32Array;

export interface AsrCaps { languages: string[]; supportsStreaming: boolean; supportsLanguageDetect: boolean; nativeSampleRate: number; arch: string }
export interface StreamText { committed: string; tentative: string }
export interface AsrStream {
  feed(pcm: Float32Array): Promise<StreamText>;
  finalize(opts?: RunOptions): Promise<string>;   // closes the stream
  close(): void;                                  // idempotent
}
export interface AsrModel {
  readonly capabilities: AsrCaps;
  run(pcm: Float32Array, language: string | null, opts?: RunOptions & { onProgress?: () => void }): Promise<string>;
  openStream(language: string | null): AsrStream;
  unload(): Promise<void>;                        // idempotent
}
export function asrLoad(path: string, deviceIndex: number | null): Promise<AsrModel>;

export interface ChatMessage { role: string; content: string }
export interface GenOptions { maxTokens?: number; assistantPrefill?: string }
export interface Translator {
  chat(messages: ChatMessage[], gen: GenOptions, opts: RunOptions & { onToken: (bytes: Uint8Array) => void }): Promise<void>;
  complete(prompt: string, gen: Omit<GenOptions, 'assistantPrefill'>, opts: RunOptions & { onToken: (bytes: Uint8Array) => void }): Promise<void>;
  unload(): Promise<void>;
}
export function translateLoad(path: string, deviceIndex: number | null, opts?: { nCtx?: number; flashAttn?: 0 | 1 | 2 }): Promise<Translator>;

export interface TtsCaps { streaming: boolean; clones: boolean; transcriptRequired: boolean; sampleRate: number }
export interface Tts {
  readonly capabilities: TtsCaps;
  presets(): Promise<string[]>;
  setVoice(pcm: Float32Array, sampleRate: number, refText: string | null): Promise<void>;
  setPreset(name: string): Promise<void>;
  synth(text: string, language: string | null, speed: number,
        opts: RunOptions & { onAudio: (pcm: Float32Array, sampleRate: number, channels: number) => void }): Promise<void>;
  unload(): Promise<void>;
}
export function ttsLoad(path: string, deviceIndex: number | null, opts: { family: string; language?: string | null }): Promise<Tts>;
```

Semantics every task follows:
- A rejected promise carries a `NativeError`. An `AbortSignal` already aborted when the call is made rejects with `status` −5 before any native call; one aborted later makes the next native callback return `false`.
- Token pieces and audio chunks are delivered in order, after any earlier piece, and all before the promise settles.
- `deviceIndex: null` passes `NULL` (auto); a number passes a `sk_device` with that index.

---

### Task 1: Addon scaffold, build wiring, `init` and device listing

**Files:**
- Create: `native/node/CMakeLists.txt`, `native/node/src/addon.cpp`, `native/node/src/errors.h`, `native/node/src/errors.cpp`, `native/node/src/common.cpp`, `native/node/index.d.ts`, `native/node/test/helpers.mjs`, `native/node/test/common.test.mjs`
- Create: the four `third_party/` trees from the File Structure table, each with its upstream `LICENSE` and a `VERSION` file naming the release
- Modify: `native/CMakeLists.txt` (option + `add_subdirectory(node)` after `add_subdirectory(tests)`)

**Interfaces:**
- Produces: `native/node/index.d.ts` (whole file, above); `abi()`, `version()`, `engineVersions()`, `contract(dir)`, `init(opts)`, `devices()`; `test/helpers.mjs` exporting `loadAddon(): Addon` (reads `SOKUJI_NATIVE_NODE` = path to the built `.node`, default `<build>/lib/sokuji_native_node.node`) and `nativeDir(): string` (`SOKUJI_NATIVE_DIR`, the directory with the libraries and backend modules); `tempContractDir(contract: object): string` (a temp dir holding only that `contract.json`); `jfk(): Float32Array` (`SK_TEST_SAMPLE_WAV` read as 16 kHz mono floats); `chunks(pcm, n)`, `sine(hz, rate, seconds)`, `snrDb(a, b)`.

- [ ] **Step 1: Write the failing test** `native/node/test/common.test.mjs`

```js
test('reports ABI 2 and the library version', () => {
  assert.equal(sk.abi(), 2);
  assert.match(sk.version(), /^\d+\.\d+\.\d+$/);
  assert.equal(sk.contract(nativeDir()).abi, 2);
  assert.ok('ggml' in sk.engineVersions() && 'lane' in sk.engineVersions());
});
test('init is idempotent and lists a CPU device', () => {
  const { threads } = sk.init({ moduleDir: nativeDir(), threads: 0 });
  assert.ok(threads >= 1);
  assert.deepEqual(sk.init({ moduleDir: nativeDir(), threads: 3 }), { threads });   // first call wins
  const cpu = sk.devices().find((d) => d.kind === 'cpu');
  assert.ok(cpu && cpu.memTotal > 0 && cpu.memFree > 0);
});
test('init rejects a contract whose ABI differs', () => {
  // helpers.mjs writes a temp dir with contract.json {"abi":1}
  assert.throws(() => sk.contract(tempContractDir({ abi: 1 })), /ABI 1 != binding ABI 2/);
});
```

- [ ] **Step 2: Configure and build; run it and see it fail**

Run: `cmake -S native -B native/build/cpu -DSOKUJI_GPU=none && cmake --build native/build/cpu -j && SOKUJI_NATIVE_DIR=$PWD/native/build/cpu/lib node --test native/node/test/common.test.mjs`
Expected: FAIL (the target or the exports do not exist yet).

- [ ] **Step 3: Implement the target and the functions**

- `native/node/CMakeLists.txt`: `add_library(sokuji_native_node MODULE src/addon.cpp src/errors.cpp src/common.cpp ...)`, `OUTPUT_NAME sokuji_native_node`, `PREFIX ""`, `SUFFIX ".node"`; include dirs for both vendored header trees; `NAPI_VERSION=8`, `NODE_ADDON_API_DISABLE_DEPRECATED`, `NAPI_CPP_EXCEPTIONS` (and `/EHsc` on MSVC); `target_link_libraries(... PRIVATE sokuji_native)`; rpath comes from the project-wide setting. macOS: `-undefined dynamic_lookup`. Linux: `-static-libstdc++ -static-libgcc`. Windows: build an import library for `node.exe` from `def/node_api.def` (`add_custom_command` with `lib.exe /def:... /name:node.exe /machine:x64`), link it, add `third_party/win_delay_load_hook.cc` and `/DELAYLOAD:node.exe`. `install(TARGETS sokuji_native_node LIBRARY DESTINATION . RUNTIME DESTINATION . COMPONENT sokuji_node)` — a separate component, so the wheel (component `sokuji`) is unchanged.
- `native/CMakeLists.txt`: `option(SOKUJI_NODE_ADDON "Build the Node-API addon" ON)` and `if(SOKUJI_NODE_ADDON) add_subdirectory(node) endif()`.
- `contract(dir)` reads `dir/contract.json` and throws `NativeError(status −1, "contract.json ABI <n> != binding ABI 2")` on mismatch. `init` calls `contract(moduleDir)` first, then `sk_init` with `module_dir = moduleDir`; the log sink is a thread-safe function created once, unref'd, never released.
- Device kinds map `0/1/2/99` → `cpu/vulkan/metal/other`; `devices()` reads up to 32 entries (as the Python binding).

- [ ] **Step 4: Run the test and see it pass**

Run: same as Step 2. Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add native/CMakeLists.txt native/node
git commit -m "feat(native): Node-API addon scaffold with init and device listing"
```

### Task 2: Device profiles, free memory, op coverage, audio families

**Files:**
- Modify: `native/node/src/common.cpp`
- Test: `native/node/test/devices.test.mjs`

**Interfaces:**
- Consumes: Task 1's `loadAddon`, `nativeDir`, `init`.
- Produces: `deviceFreeMem`, `deviceProfiles`, `deviceSupportsOps`, `audioFamilies` with the shapes in `index.d.ts`. Feature bit names are exactly the Python binding's `FEATURE_BITS` (`vk_shader_float16`, `vk_shader_bfloat16`, `vk_integer_dot`, `vk_coopmat`, `vk_coopmat2`, `mtl_simdgroup_reduction`, `mtl_bfloat`, `uma`).

- [ ] **Step 1: Write the failing tests**

```js
test('one profile per device, same order and index', () => {
  const ds = sk.devices(), ps = sk.deviceProfiles();
  assert.deepEqual(ps.map((p) => p.index), ds.map((d) => d.index));
  const cpu = ps.find((p) => p.kind === 'cpu');
  assert.ok(cpu.known && cpu.cpuFeatures.length > 0);
});
test('free memory is positive for every device', () => {
  for (const d of sk.devices()) assert.ok(sk.deviceFreeMem(d.index) > 0);
});
test('op coverage: a recorded asr family on CPU', async () => {
  const cpu = sk.devices().find((d) => d.kind === 'cpu');
  const cov = await sk.deviceSupportsOps(cpu.index, 'asr', 'whisper', ['q8_0']);
  assert.ok(cov.checked.length > 0);
  assert.equal(cov.allSupported, cov.unsupported.length === 0);
});
test('op coverage: unknown family rejects with NOT_FOUND', async () => {
  await assert.rejects(sk.deviceSupportsOps(0, 'asr', 'no-such-family', ['q8_0']), (e) => e.name === 'NativeError' && e.status === -4);
});
test('audio families are sorted and include supertonic', () => {
  const f = sk.audioFamilies();
  assert.deepEqual(f, [...f].sort());
  assert.ok(f.includes('supertonic'));
});
```

- [ ] **Step 2: Run and see them fail**

Run: `SOKUJI_NATIVE_DIR=$PWD/native/build/cpu/lib node --test native/node/test/devices.test.mjs`
Expected: FAIL (functions missing).

- [ ] **Step 3: Implement.** `deviceSupportsOps` runs on a process-wide "misc" `HandleWorker` (Task 3 introduces the class; until then, run it on a `Napi::AsyncWorker`, and Task 3 moves it). `sk_op_coverage` is ~140 KB, so allocate it on the heap. `unsupported`/`checked` follow the Python binding's `OpCoverage` construction.

- [ ] **Step 4: Run and see them pass.** Same command; 5 tests pass.

- [ ] **Step 5: Commit** `git commit -m "feat(native): addon device profiles, free memory, op coverage"`

### Task 3: The handle worker and batch ASR

**Files:**
- Create: `native/node/src/worker.h`, `native/node/src/worker.cpp`, `native/node/src/job.h`, `native/node/src/asr.cpp`
- Modify: `native/node/src/common.cpp` (move `deviceSupportsOps` onto the misc worker)
- Test: `native/node/test/asr.test.mjs`

**Interfaces:**
- Produces: `class HandleWorker { void post(std::unique_ptr<Job>); void cancelAll(); void stopAndJoin(); }` (one `std::thread`, FIFO, stop sentinel); `struct Job { std::shared_ptr<std::atomic_bool> cancel; virtual void execute() = 0; virtual void settle(Napi::Env) = 0; }` with settlement marshalled to the JS thread by a per-job thread-safe function. `asrLoad`, `AsrModel.run`, `AsrModel.unload`, `AsrModel.capabilities`.
- Model loads run on the misc worker; each loaded model then gets its own `HandleWorker`.

- [ ] **Step 1: Write the failing tests** (model: `SK_TEST_ASR_GGUF` = whisper-tiny; `test.skip` when unset; audio: `SK_TEST_SAMPLE_WAV` = jfk.wav, read with a 16-bit PCM reader in `helpers.mjs`)

```js
test('transcribes JFK', async () => {
  const m = await sk.asrLoad(env.SK_TEST_ASR_GGUF, null);
  assert.equal(m.capabilities.nativeSampleRate, 16000);
  let polls = 0, ticks = 0; const t = setInterval(() => ticks++, 5);
  const text = await m.run(jfk(), 'en', { onProgress: () => polls++ });
  clearInterval(t);
  assert.match(text.toLowerCase(), /ask not what your country can do for you/);
  assert.ok(polls > 0 && ticks > 0);        // progress arrived; JS thread was free
  await m.unload();
});
test('empty PCM resolves to empty text', async () => { assert.equal(await m.run(new Float32Array(0), 'en'), ''); });
test('30 s of audio transcribes', async () => { /* jfk() repeated to 480000 samples */ assert.ok((await m.run(long, 'en')).length > 0); });
test('an aborted signal rejects with CANCELLED before running', async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(m.run(jfk(), 'en', { signal: ac.signal }), (e) => e.status === -5);
});
test('abort mid-run cancels at the next decode step', async () => {
  const ac = new AbortController();
  const p = m.run(jfk(), 'en', { signal: ac.signal, onProgress: () => ac.abort() });
  await assert.rejects(p, (e) => e.status === -5 && /cancelled by the callback/.test(e.message));
});
test('a missing file rejects with NOT_FOUND and the right message', async () => {
  await assert.rejects(sk.asrLoad('/nonexistent.gguf', null), (e) => e.status === -4 && /^sk_asr_load: .*nonexistent\.gguf/.test(e.message));
});
test('the error text belongs to the failing call, not an earlier one', async () => {
  await assert.rejects(sk.asrLoad('/first-missing.gguf', null));
  await assert.rejects(sk.asrLoad('/second-missing.gguf', null), /second-missing/);
});
test('loads a model from a non-ASCII directory', async () => {
  // copy (or hard-link) the model into os.tmpdir()/'モデル 山田'/; load must succeed, or reject with a NativeError
});
test('two models run at the same time', async () => { /* two asrLoad handles, Promise.all of two runs; both texts match */ });
```

- [ ] **Step 2: Run and see them fail.** `SK_TEST_ASR_GGUF=... SK_TEST_SAMPLE_WAV=... SOKUJI_NATIVE_DIR=... node --test native/node/test/asr.test.mjs` → FAIL.

- [ ] **Step 3: Implement.** The `sk_text_cb` trampoline: `text == NULL` → post a progress call (non-blocking) and return `!cancel`; otherwise copy the text into the job. PCM is copied out of the `Float32Array` when the call is made. `n == 0` resolves `''` without queuing. An already-aborted signal rejects synchronously-queued with −5. `AbortSignal` hookup: add an `abort` listener that sets the job's flag; remove it on settle.

- [ ] **Step 4: Run and see them pass.** Same command. Expected: all pass; the non-ASCII test either passes or reports a `NativeError` (record which in the commit message; a crash is a failure).

- [ ] **Step 5: Commit** `git commit -m "feat(native): per-handle worker thread and batch ASR in the addon"`

### Task 4: Streaming ASR

**Files:**
- Modify: `native/node/src/asr.cpp`
- Test: `native/node/test/asr-stream.test.mjs`

**Interfaces:**
- Consumes: Task 3's `HandleWorker`, `AsrModel`.
- Produces: `AsrModel.openStream(language)`, `AsrStream.feed/finalize/close`. A model has at most one open stream; `openStream` while one is open throws `NativeError` status −1 `"sk_asr_stream_open: a stream is already open on this model"`. Stream calls run on the model's worker. `unload()` closes an open stream first.

- [ ] **Step 1: Write the failing tests** (model: `SK_TEST_ASR_STREAM_GGUF` = moonshine-streaming-tiny)

```js
test('streams JFK in 0.5 s chunks', async () => {
  const m = await sk.asrLoad(env.SK_TEST_ASR_STREAM_GGUF, null);
  assert.ok(m.capabilities.supportsStreaming);
  const s = m.openStream('en'); let last = { committed: '', tentative: '' };
  for (const chunk of chunks(jfk(), 8000)) last = await s.feed(chunk);
  assert.ok(last.committed.length + last.tentative.length > 0);
  assert.match((await s.finalize()).toLowerCase(), /ask not what your country/);
  s.close();                                   // idempotent after finalize
});
test('a second open stream is refused', () => { const s = m.openStream(null); assert.throws(() => m.openStream(null), /already open/); s.close(); });
test('feed after close rejects', async () => { const s = m.openStream(null); s.close(); await assert.rejects(s.feed(new Float32Array(160)), (e) => e.status === -1); });
test('unload closes an open stream', async () => { const s = m.openStream(null); await m.unload(); await assert.rejects(s.feed(new Float32Array(160))); });
```

- [ ] **Step 2: Run and see them fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** `feed` copies the `sk_stream_text` strings before the job settles (they are only valid until the next call on the stream).
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(native): streaming ASR in the addon"`

### Task 5: Translation

**Files:**
- Create: `native/node/src/translate.cpp`
- Test: `native/node/test/translate.test.mjs`

**Interfaces:**
- Produces: `translateLoad(path, deviceIndex, { nCtx, flashAttn })` (defaults `0`, `0`), `Translator.chat`, `Translator.complete`, `Translator.unload`. `onToken` receives each piece's raw bytes as a `Uint8Array` copy; the caller decodes with a streaming `TextDecoder`.

- [ ] **Step 1: Write the failing tests** (model: `SK_TEST_TRANSLATE_GGUF` = Qwen3-0.6B Q8_0)

```js
const PREFILL = '<think>\n\n</think>\n\n';
test('chat produces text', async () => {
  const tr = await sk.translateLoad(env.SK_TEST_TRANSLATE_GGUF, null, {});
  const dec = new TextDecoder('utf-8', { fatal: false }); let out = '';
  await tr.chat([{ role: 'user', content: 'Translate to French: Good morning' }], { maxTokens: 32, assistantPrefill: PREFILL },
                { onToken: (b) => { out += dec.decode(b, { stream: true }); } });
  out += dec.decode();
  assert.ok(out.trim().length > 0);
});
test('Japanese output survives pieces that split characters', async () => {
  // same, content 'Translate to Japanese: Good morning'; assert !out.includes('\uFFFD') && /[\u3040-\u30ff\u4e00-\u9fff]/.test(out)
});
test('complete produces text', async () => { /* complete('Hello', { maxTokens: 8 }, { onToken }) */ });
test('abort after the first token cancels', async () => {
  const ac = new AbortController(); let n = 0;
  await assert.rejects(tr.chat([{ role: 'user', content: 'Count to fifty' }], { maxTokens: 256 },
    { signal: ac.signal, onToken: () => { if (++n === 1) ac.abort(); } }), (e) => e.status === -5);
  assert.ok(n < 256);
});
```

- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** Message strings and the prefill are copied into the job before queuing (they must outlive the JS call).
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(native): translation in the addon"`

### Task 6: TTS

**Files:**
- Create: `native/node/src/tts.cpp`
- Test: `native/node/test/tts.test.mjs`

**Interfaces:**
- Produces: `ttsLoad(path, deviceIndex, { family, language })`, `Tts.capabilities/presets/setVoice/setPreset/synth/unload`. `onAudio` receives a fresh `Float32Array` copy of each chunk (interleaved when `channels > 1`), the chunk's sample rate, and its channel count.

- [ ] **Step 1: Write the failing tests.** Mirror the families, voice setup and assertions of `native/tests/test_tts.cpp`: supertonic from `SK_TEST_TTS_SUPERTONIC_DIR` (streaming, `presets()` non-empty, `setPreset(presets[0])`, synth "Hello world" delivers more than one chunk at `capabilities.sampleRate`, total samples > 0.2 s worth; abort after the first chunk rejects −5 and a following synth still succeeds) and moss_tts_nano from `SK_TEST_TTS_MOSS_DIR` (offline: exactly one `onAudio` call; `setVoice` with the reference clip that test uses). Plus:

```js
test('onAudio never runs after the promise settles', async () => { /* count calls after await; must stay unchanged after a 50 ms wait */ });
```

- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** The `sk_audio_cb` trampoline copies the buffer before returning and returns `!cancel`. Nothing on the JS side runs inside the native callback, so the header's non-recursive lock cannot deadlock.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(native): TTS in the addon"`

### Task 7: Resampler

**Files:**
- Create: `native/node/src/resample.cpp`; vendored `third_party/speexdsp/` (from Task 1's table)
- Test: `native/node/test/resample.test.mjs`

**Interfaces:**
- Produces: `resample(pcm, channels, fromRate, toRate): Float32Array` — synchronous, speexdsp quality 10, interleaved in and out; `fromRate === toRate` returns a copy; output length is `Math.round(frames * toRate / fromRate) * channels` (the resampler's latency is flushed by feeding `input_latency` zero frames at the end and trimming).

- [ ] **Step 1: Write the failing tests**

```js
test('48 kHz → 24 kHz keeps a 440 Hz tone (SNR > 60 dB)', () => {
  const out = sk.resample(sine(440, 48000, 1.0), 1, 48000, 24000);
  assert.equal(out.length, 24000);
  assert.ok(snrDb(out.subarray(1000, 23000), sine(440, 24000, 1.0).subarray(1000, 23000)) > 60);
});
test('44.1 kHz stereo → 24 kHz keeps both channels', () => { /* L=440 Hz, R=660 Hz; check each channel's SNR > 60 dB */ });
test('same rate returns an equal copy', () => { const x = sine(100, 24000, 0.1); const y = sk.resample(x, 1, 24000, 24000); assert.notEqual(x, y); assert.deepEqual([...y], [...x]); });
test('rejects bad arguments', () => { assert.throws(() => sk.resample(new Float32Array(3), 2, 48000, 24000), /multiple of channels/); });
```

- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** Compile `resample.c` with `FLOATING_POINT` and `OUTSIDE_SPEEX` defined; a local `RANDOM_PREFIX=sokuji` keeps its symbols out of any other copy's way.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(native): speexdsp resampler in the addon"`

### Task 8: Lifetimes, unload, finalizers and process exit

**Files:**
- Modify: `native/node/src/worker.cpp`, `asr.cpp`, `translate.cpp`, `tts.cpp`, `addon.cpp`
- Test: `native/node/test/lifetime.test.mjs`, `native/node/test/fixtures/exit-mid-run.mjs`

**Interfaces:**
- Consumes: every handle class from Tasks 3–6.
- Produces: the lifetime rules every handle obeys: `unload()` sets every queued job's cancel flag, lets the running job reach its next callback, unloads on the handle's thread, stops and joins the thread, then resolves; later calls reject with status −2 `"<fn>: model is unloaded"` (the Python binding's wording); a handle collected without `unload()` is unloaded by its finalizer and logs a warning through the log sink; an env cleanup hook cancels and joins every live worker.

- [ ] **Step 1: Write the failing tests**

```js
test('unload is idempotent and later calls reject with NOT_INITIALISED', async () => {
  await m.unload(); await m.unload();
  await assert.rejects(m.run(jfk(), 'en'), (e) => e.status === -2 && /model is unloaded/.test(e.message));
});
test('unload cancels queued runs', async () => {
  const a = m.run(jfk(), 'en'), b = m.run(jfk(), 'en');
  const u = m.unload();
  const [ra, rb] = await Promise.allSettled([a, b]); await u;
  assert.equal(rb.status, 'rejected'); assert.equal(rb.reason.status, -5);
});
test('a dropped handle is unloaded by its finalizer', async () => { /* run under --expose-gc; drop the only reference; gc(); expect a warning log line naming the handle */ });
test('exits cleanly while a run is in flight', () => {
  const r = spawnSync(process.execPath, ['test/fixtures/exit-mid-run.mjs'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);    // the fixture starts a 30 s run, then process.exit(0) after 50 ms
});
```

- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the rules in **Produces**.
- [ ] **Step 4: Run and see them pass**, then run the whole addon suite: `node --test native/node/test/` → all pass.
- [ ] **Step 5: Commit** `git commit -m "feat(native): addon lifetimes, finalizers and clean exit"`

### Task 9: Archives in native CI

**Files:**
- Create: `native/ci/make_app_archive.py`, `native/ci/NOTICES.in`, `native/tests/test_make_app_archive.py`
- Modify: `native/node/CMakeLists.txt` (CTest entry), `native/ci/build.sh`, `native/ci/build.ps1`, `.github/workflows/native-build.yml`

**Interfaces:**
- Consumes: the `sokuji_node` install component (Task 1).
- Produces: per SKU, `sokuji-native-<sku>-v<version>.tar.zst` whose single top-level directory `sokuji-native-<sku>-v<version>/` holds the flat stage (libraries, backend modules, `contract.json`), `sokuji_native_node.node`, and `NOTICES.txt`; a sibling `.sha256` file; and on the release, a `manifest.json` of the form `{"version": "1.2.1", "archives": {"<sku>": {"file": "...", "sha256": "...", "size": N}}}`. Plan 3 reads exactly this.

- [ ] **Step 1: Write the failing test** `native/tests/test_make_app_archive.py` (pytest, run by `build.sh` with the other Python tests): build a fake stage dir with `libsokuji_native.so`, `contract.json` and a `.node` file; run the script; assert the archive lists exactly `sokuji-native-linux-x64-v9.9.9/{libsokuji_native.so,contract.json,sokuji_native_node.node,NOTICES.txt}`, the `.sha256` matches the file, and a stage missing the `.node` file makes the script exit non-zero.

- [ ] **Step 2: Run and see it fail.** `python -m pytest native/tests/test_make_app_archive.py -q` → FAIL.

- [ ] **Step 3: Implement.**
  - `make_app_archive.py <stage_dir> <sku> <version> <out_dir>` (uses the `zstandard` module, level 19; tar entries sorted, mtime 0, uid/gid 0, so the archive is reproducible).
  - `NOTICES.in` lists the upstreams (ggml, llama.cpp, transcribe.cpp, audio.cpp, node-addon-api, node-api-headers, SpeexDSP) with the path of each license file in the build tree; the script concatenates them into `NOTICES.txt`.
  - CTest: `find_program(NODE_EXECUTABLE node)`; if found, `add_test(NAME test_node_addon COMMAND ${NODE_EXECUTABLE} --test ${CMAKE_CURRENT_SOURCE_DIR}/test/)` with `SOKUJI_NATIVE_DIR`, `SOKUJI_NATIVE_NODE` and `SK_TEST_SAMPLE_WAV` in its `ENVIRONMENT`.
  - `build.sh`/`build.ps1`: after the existing `cmake --install ... --component sokuji`, also `--component sokuji_node` into a second prefix `$BUILD/app-stage` together with `sokuji`, then run `make_app_archive.py "$BUILD/app-stage" "$SOKUJI_SKU" "<project version>" "$ROOT/build/archive"` when `SOKUJI_SKU` is set.
  - `native-build.yml`: `env: SOKUJI_SKU: ${{ matrix.sku }}` on both build steps; install Node 22 (`actions/setup-node`); a step that loads the addon under Electron (`npx --yes electron@44.11.5` with `ELECTRON_RUN_AS_NODE=1` running a three-line script that calls `abi()`, `init()`, `devices()`); upload `native/build/archive/*` as a second artifact; the `release` job attaches the archives and writes `manifest.json` from the `.sha256` files.

- [ ] **Step 4: Run and see it pass** locally: the pytest file passes, and `SOKUJI_SKU=linux-arm64 native/ci/build.sh vulkan manylinux_2_39_aarch64` ends with `native/build/archive/sokuji-native-linux-arm64-v1.2.0.tar.zst`; unpack it to a temp dir and run `node -e "const s=require('<dir>/sokuji_native_node.node'); s.init({moduleDir:'<dir>'}); console.log(s.devices())"` → lists `Vulkan0` and `CPU`.

- [ ] **Step 5: Commit** `git commit -m "ci(native): app archives with the Node addon"`

- [ ] **Step 6: CI dry run (needs the maintainer's go-ahead).** Ask to push branch `feat/native-node-addon` to `kizuna-ai-lab/sokuji` and run `native-build` with `workflow_dispatch` on it. Expected: five green jobs, five archives uploaded, the Electron load step passing on all five (Review Focus 1).

### Task 10: Windows signing of the native files (blocked on approval)

Starts only after the maintainer approves the SignPath configuration change (spec §8.4, §12 item 4). If SignPath declines, record that in the spec and close this task.

**Files:**
- Create: `.signpath/artifact-configurations/native.xml`
- Modify: `.github/workflows/native-build.yml` (win-x64 row: submit the stage's `*.dll` and `*.node` to SignPath before `make_app_archive.py`, the same action and slug variables `build.yml` uses for `sokuji-audio-host.exe`)

- [ ] **Step 1:** Add a CI check after archiving on win-x64: `Get-AuthenticodeSignature` on every `.dll`/`.node` in the archive reports `Valid`. Run once without the signing step: the check fails.
- [ ] **Step 2:** Add the signing step; the check passes.
- [ ] **Step 3: Commit** `git commit -m "ci(native): sign Windows native files through SignPath"`
