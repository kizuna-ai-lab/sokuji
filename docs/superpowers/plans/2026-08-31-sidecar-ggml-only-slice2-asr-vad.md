# ggml-only sidecar — Slice 2: ASR + VAD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put ASR and VAD behind the slice-1 native library — `sk_asr_*` over transcribe.cpp, `sk_vad_*` over audio.cpp's bundled silero — and move the sidecar's ASR backend, device probe and VAD onto the `sokuji_native` binding, so `transcribe-cpp` leaves `requirements.txt` and `silero_vad.onnx` is never downloaded again.

**Architecture:** Two new translation units in `native/src/` (`sk_asr.cpp`, `sk_vad.cpp`) share the helpers `sk_common.cpp` already has (error slot, init check, device table, thread count) through a small internal header. The C surface is additive on ABI 1: the library version becomes 0.2.0, the ABI number stays 1. On the Python side `sokuji_native` gains `AsrModel` / `AsrStream` / `Vad` classes over the new ctypes declarations; the sidecar gets one entry-point module (`native.py`) that owns `sk_init`, an `asr_backend.py` that replaces `transcribe_backend.py` with the same adapter contract, and a `vad.py` whose `NativeVad` reproduces the duck-typed protocol `asr_engine.py` already depends on, so the engine's VAD loops do not change.

**Tech Stack:** C++17 over transcribe.cpp v0.2.2's C API (`transcribe.h`) and audio.cpp v0.7.0's runtime API (`engine/framework/runtime/*.h`); ctypes; pytest; CTest; GitHub Actions (`native-build.yml`).

**Spec:** `docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md` — §4.3 (C ABI: ASR + VAD), §5.1–5.3 (naming, `native.py`, backends), §9.1/9.3/9.4/9.6 (gates, tests, bench), §10 row 2 (scope + gate).

## Global Constraints

- Upstream pins are unchanged from slice 1: ggml `34dc0e5589504286cb40e13cbdae4bf2b5b4071b` (v0.22.0), transcribe.cpp `c6a9257cdf8e9c6918c0f8f876246db048a22103` (v0.2.2), llama.cpp `c1d0e7a004015f23bc0233470b747b596f29b264` (v0.3.0), audio.cpp `d2ff37009c69d464bcab6aa4a44a13746e84a914` (v0.7.0). No pin moves in this slice.
- C ABI conventions (spec §4.3): opaque handles; every call returns `sk_status` (0 ok, negative error) and sets `sk_last_error()` (thread-local UTF-8) on failure; callbacks take `void *user` and return `bool` (`false` = cancel); PCM is float32, ASR and VAD input is 16 kHz mono; strings the library hands out through pointers are owned by the handle they came from and valid until the next call on that handle (documented per function); `sk_free` frees malloc'd memory only.
- Nothing works before `sk_init()` succeeds; every new entry point returns `SK_ERR_NOT_INITIALISED` before it (the C test checks this for `sk_asr_load` and `sk_vad_open`).
- Additive ABI: `SK_ABI_VERSION` stays `1`; `project(sokuji_native VERSION 0.2.0)`; `contract.json` shape is unchanged.
- Naming (spec §1.1 item 7, §5.1): stage names only — `sk_asr_*`, `sk_vad_*`, `asr_backend.py`, `NativeAsrBackend` / `NativeAsrStreamBackend`, backend `NAME`s `native_asr` / `native_asr_stream`, `vad.py` / `NativeVad`, `native.py`. No `transcribe`, `tc`, `silero` or `sherpa` in a new public identifier. (`Machine.tc_kinds` in `accel.py` is a dataclass field with fixtures across the test suite; it is renamed in slice 5's cleanup, not here — Ruling A.)
- Thread count: one policy, `SOKUJI_NATIVE_THREADS` (env, default `0` = hardware concurrency), passed once to `sk_init`. transcribe.cpp sessions and the VAD session take it from there. (`SOKUJI_TTS_THREADS` keeps serving the ORT TTS backends until slice 4.)
- VAD runs on the CPU device always (1.2 MB model, one 32 ms chunk per call — a GPU round-trip would only add latency) — Ruling B.
- The engine-side VAD defaults reproduce what sherpa-onnx's `SileroVadModelConfig` gave the sidecar (verified on the dev box): threshold `0.5`, min silence `0.5 s`, min speech `0.25 s`, max speech `20 s`, window `512` samples. audio.cpp's own defaults differ (`min_silence_duration_ms = 100`, unbounded max speech); the adapter passes the sherpa values explicitly.
- Gates (spec §10 row 2 + §9): ASR loopback (real model, env-gated pytest); VAD ≤ 1 frame (32 ms) against sherpa-silero on the same recording (env-gated pytest); RTF on par with the PyPI wheel (bench, numbers recorded in the PR). CTest: `sk_asr_run` on whisper-tiny Q8, streaming on moonshine-streaming-tiny Q8, `sk_vad_feed` on the bundled silero, cancellation.
- Sidecar tests run from the main checkout's venv: `/home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests -q` from the worktree root. The baseline has 4 pre-existing failures (3 × `pyopenjtalk` missing, 1 × `test_sidecar_bundles_workflow` artifact-version assertion); A/B against `main` before blaming a change (memory: `sokuji-worktree-test-baseline`).
- Native tests: `PYTHON=/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/sidecar-ggml-only/native/build/pyenv/bin/python native/ci/build.sh none manylinux_2_39_aarch64` rebuilds, runs CTest, the deps gate, both Python suites, and the wheel import — the one command that proves a native task.
- Everything persisted in the repo (code, comments, commit messages, docs) is English. Conventional commits. No push without jiangzhuo's word; PR creation is a separate ask.
- `requirements.txt` drops `transcribe-cpp` in this slice. `sherpa-onnx` stays until slice 4: `sherpa_tts.py` (piper voices) still imports it; only its VAD use ends here — Ruling C. `sokuji-native` has no release URL yet (no `native-v*` tag is being published, decided 2026-08-31), so `setup.sh` installs it from `native/python/dist/*.whl` or from `$SOKUJI_NATIVE_WHEEL` — Ruling D; the pinned-URL form in spec §4.6 lands with the first published wheel.

---

## Rulings made while writing this plan (so the executor does not re-decide them)

- **A** — `accel.Machine.tc_kinds` / `gpus` field names stay; only the probe functions are renamed (`_native_devices`, `_native_kinds`, `_native_gpus`).
- **B** — VAD always on CPU.
- **C** — `sherpa-onnx` remains a dependency until slice 4 (TTS); this slice removes its VAD use and `transcribe-cpp`.
- **D** — `sokuji-native` is installed from a local wheel until a release exists.
- **E** — `sk_text_cb` doubles as the cancellation poll: during `sk_asr_run` the library calls it with `text == NULL` between decode steps ("still running"); a `false` return cancels (`SK_ERR_CANCELLED`); at the end it is called once with the transcript. One callback, one `user`, the spec's one cancellation mechanism.
- **F** — Streaming is a mode on transcribe.cpp's session, so one `sk_asr_model` has at most one open `sk_asr_stream`; `sk_asr_stream_open` while one is open returns `SK_ERR_INVALID_ARGUMENT`. `sk_asr_stream_finalize` returns the session to idle itself (so `close` after `finalize` only frees), matching the Python adapter's `end()` = finalize + reset.
- **G** — `sk_vad_finalize(sk_vad *, sk_vad_event *out)` is added to the spec's four VAD calls: the engine's `flush()` needs the trailing open segment at end-of-audio, which audio.cpp only reports from `finalize()`.
- **H** — The silero weights (`silero_vad_16k.safetensors`, 1.2 MB, safetensors not GGUF, read from disk by audio.cpp) are installed into the wheel's `_native/` directory next to the library; `sk_vad_options.weights == NULL` means "that file, next to this library". "Bundled" in the spec means this.
- **I** — The Python `_NativeStream.drain()` keeps the committed-length diff exactly as `_TcStream` does today, even though `sk_asr_stream_feed` returns the whole committed text each call — the append-only partial the engine builds relies on deltas, and the diff is the proven way to make them.
- **J** — `sk_device` → transcribe device: transcribe.cpp's `transcribe_device_t` is the `ggml_backend_dev_t` cast (`src/transcribe.cpp:1019-1023`, validated against the registry in `device_from_handle`), so `sk_asr_load` passes `g_devices[index]` directly and sets `transcribe_model_load_params.backend` from the device's kind (`CPU` / `VULKAN` / `METAL`, `AUTO` for `SK_DEVICE_OTHER`).
- **K** — CTest models are not vendored: `test_asr` skips (exit 77) unless `SK_TEST_ASR_GGUF` (whisper-tiny Q8_0, 46 MB) / `SK_TEST_ASR_STREAM_GGUF` (moonshine-streaming-tiny Q8_0, 50 MB) point at files; CI downloads them from Hugging Face into `native/build/models/` behind `actions/cache`. `test_vad` never skips (weights are in the source tree).
- **L** — The characterization snapshots change only in the backend-name strings; they are updated by text substitution (`transcribe_cpp_stream` → `native_asr_stream`, then `transcribe_cpp` → `native_asr`, in that order), not re-recorded.
- **M** — For the CI dry run of this branch, `native-build.yml` temporarily gets `push: branches: ['refactor/sidecar-ggml-only-slice2']` again (same reason as slice 1: `workflow_dispatch` cannot target a workflow absent from `main`); it is removed in the last commit.

---

## File structure

```
native/
  include/sokuji_native.h              + sk_asr_* / sk_vad_* declarations and their types (Task 1, 4)
  src/sk_internal.h                    NEW: the helpers sk_common.cpp already has, shared (Task 1)
  src/sk_common.cpp                    helpers moved into namespace sk (Task 1)
  src/sk_asr.cpp                       NEW: sk_asr_load/capabilities/run/stream_*/unload (Tasks 1–3)
  src/sk_vad.cpp                       NEW: sk_vad_open/feed/finalize/reset/close (Task 4)
  CMakeLists.txt                       VERSION 0.2.0; new sources; silero weights installed (Tasks 1, 4)
  tests/CMakeLists.txt                 test_asr (env-gated), test_vad (Tasks 1, 4)
  tests/test_asr.cpp                   NEW (Tasks 1–3)
  tests/test_vad.cpp                   NEW (Task 4)
  tests/wav.h                          NEW: 40-line dr_wav shim shared by the two tests (Task 2)
  python/sokuji_native/_ffi.py         + declarations (Task 5)
  python/sokuji_native/__init__.py     + AsrCaps, AsrModel, AsrStream, StreamText, VadEvent, Vad (Task 5)
  python/tests/test_sokuji_native.py   + VAD tests (always), ASR tests (env-gated) (Task 5)
  README.md                            ASR/VAD section (Task 10)
.github/workflows/native-build.yml     model cache + env for CTest; temporary branch trigger (Task 1, 10)
sidecar/
  sokuji_sidecar/native.py             NEW: the one module that touches sokuji_native (Task 6)
  sokuji_sidecar/accel.py              probe over native.py; _installed keys (Task 6)
  sokuji_sidecar/asr_backend.py        NEW: replaces transcribe_backend.py (Task 7)
  sokuji_sidecar/backends.py           imports asr_backend (Task 7)
  sokuji_sidecar/vad.py                NEW: NativeVad (Task 8)
  sokuji_sidecar/asr_engine.py         _init_vad over NativeVad; VAD download code deleted (Task 8)
  prefetch_models.py                   VAD download block deleted (Task 8)
  sokuji_sidecar/catalog.py            backend strings (Task 9)
  sokuji_sidecar/planner.py            comment only (Task 9)
  requirements.txt, setup.sh           transcribe-cpp out, sokuji-native in (Task 9)
  bench/native_bench.py                NEW (Task 10)
  tests/test_native.py                 NEW (Task 6)
  tests/test_accel.py                  sokuji_native stubs (Task 6)
  tests/test_asr_backend.py            NEW, replaces test_transcribe_backend.py (Task 7)
  tests/test_vad.py                    NEW (Task 8)
  tests/test_asr_engine.py             one string (Task 9)
  tests/test_catalog.py, test_planner.py, test_platform_filter.py, test_characterization.py  names (Task 9)
  tests/test_torch_free_gate.py        bans transcribe_cpp (Task 9)
```

## The C ABI added in this slice (the contract every task codes against)

```c
/* ---- ASR (transcribe.cpp) ---- */
typedef struct sk_asr_model  sk_asr_model;
typedef struct sk_asr_stream sk_asr_stream;

typedef struct sk_asr_caps {
    int32_t            n_languages;
    const char *const *languages;          /* owned by the model; valid until sk_asr_unload */
    bool               supports_streaming;
    bool               supports_language_detect;
    int32_t            native_sample_rate;  /* 16000 for every family the catalog lists */
    const char        *arch;                /* e.g. "whisper"; owned by the model */
} sk_asr_caps;

/* Called by sk_asr_run: with text == NULL between decode steps (return false to cancel),
 * and once with the transcript when the run completes. Called by sk_asr_stream_finalize
 * once with the stream's FINAL text — the post-finalize full hypothesis, not the
 * committed display prefix (transcribe.cpp documents committed_text as best-effort
 * append-only, never rolled back; on some families it ends stale while full_text is
 * correct — Ruling N). `text` is valid only during the call. */
typedef bool (*sk_text_cb)(const char *text, void *user);

typedef struct sk_stream_text {
    const char *committed;   /* append-only prefix; owned by the stream, valid until the next call on it */
    const char *tentative;   /* volatile suffix; same lifetime */
} sk_stream_text;

SK_API sk_status sk_asr_load(const char *gguf, const sk_device *device, sk_asr_model **out);   /* device NULL = auto */
SK_API sk_status sk_asr_capabilities(sk_asr_model *, sk_asr_caps *out);
SK_API sk_status sk_asr_run(sk_asr_model *, const float *pcm, size_t n, const char *lang, sk_text_cb, void *user);
SK_API sk_status sk_asr_stream_open(sk_asr_model *, const char *lang, sk_asr_stream **out);
SK_API sk_status sk_asr_stream_feed(sk_asr_stream *, const float *pcm, size_t n, sk_stream_text *out);
SK_API sk_status sk_asr_stream_finalize(sk_asr_stream *, sk_text_cb, void *user);
SK_API void      sk_asr_stream_close(sk_asr_stream *);
SK_API void      sk_asr_unload(sk_asr_model *);

/* ---- VAD (audio.cpp silero_vad, bundled weights) ---- */
typedef struct sk_vad sk_vad;

typedef struct sk_vad_options {
    const char *weights;        /* NULL = silero_vad_16k.safetensors next to this library */
    float       threshold;      /* <= 0 = 0.5 */
    int32_t     min_speech_ms;  /* <= 0 = 250 */
    int32_t     min_silence_ms; /* <= 0 = 100 */
    int32_t     speech_pad_ms;  /* < 0 = 30 (0 is a valid value) */
    float       max_speech_s;   /* <= 0 = unbounded */
} sk_vad_options;

enum sk_vad_kind { SK_VAD_NONE = 0, SK_VAD_SPEECH_START = 1, SK_VAD_SPEECH_END = 2 };

typedef struct sk_vad_event {
    int32_t kind;          /* sk_vad_kind */
    int64_t sample;        /* START: padded start sample; END: end sample */
    float   probability;   /* the probability at the transition */
    int64_t seg_start;     /* END only: the finished segment [seg_start, seg_end) in samples */
    int64_t seg_end;
} sk_vad_event;

SK_API sk_status sk_vad_open(const sk_vad_options *, sk_vad **out);      /* options NULL = all defaults */
SK_API sk_status sk_vad_feed(sk_vad *, const float *pcm512, sk_vad_event *out);   /* exactly 512 samples @ 16 kHz */
SK_API sk_status sk_vad_finalize(sk_vad *, sk_vad_event *out);           /* end of audio: closes an open segment (END or NONE), then resets */
SK_API void      sk_vad_reset(sk_vad *);
SK_API void      sk_vad_close(sk_vad *);
```

Status mapping from transcribe.cpp (`transcribe_status`, `transcribe.h:197-296`), used by every `sk_asr_*` call:

| transcribe.cpp | sk_status |
|---|---|
| `TRANSCRIBE_OK`, `TRANSCRIBE_ERR_OUTPUT_TRUNCATED` (partial text kept) | `SK_OK` |
| `TRANSCRIBE_ERR_FILE_NOT_FOUND` | `SK_ERR_NOT_FOUND` |
| `TRANSCRIBE_ERR_INVALID_ARG`, `TRANSCRIBE_ERR_BAD_STRUCT_SIZE`, `TRANSCRIBE_ERR_UNSUPPORTED_LANGUAGE`, `TRANSCRIBE_ERR_NOT_IMPLEMENTED`, `TRANSCRIBE_ERR_INPUT_TOO_LONG` | `SK_ERR_INVALID_ARGUMENT` |
| `TRANSCRIBE_ERR_ABORTED` | `SK_ERR_CANCELLED` |
| `TRANSCRIBE_ERR_OOM`, `TRANSCRIBE_ERR_BACKEND`, `TRANSCRIBE_ERR_GGUF`, `TRANSCRIBE_ERR_UNSUPPORTED_ARCH`, `TRANSCRIBE_ERR_UNSUPPORTED_VARIANT` | `SK_ERR_BACKEND` |
| anything else | `SK_ERR_INTERNAL` |

The message set by `set_error` is always `"<function>: <transcribe_status_string(st)>"` plus the path for load failures, so the sidecar's existing `"out of memory"` substring check in `accel.load_with_fallback` keeps working (`transcribe_status_string(TRANSCRIBE_ERR_OOM)` contains it).

---

### Task 1: shared helpers, ASR header block, `sk_asr_load` / `sk_asr_capabilities` / `sk_asr_unload`

**Files:**
- Create: `native/src/sk_internal.h`, `native/src/sk_asr.cpp`, `native/tests/test_asr.cpp`
- Modify: `native/src/sk_common.cpp` (helper bridge), `native/include/sokuji_native.h` (ASR block), `native/CMakeLists.txt` (VERSION 0.2.0, source list), `native/tests/CMakeLists.txt` (test_asr), `.github/workflows/native-build.yml` (model cache + env)
- Test: `native/tests/test_asr.cpp` (CTest `test_asr`), `native/tests/test_common.cpp` (one new assertion)

**Interfaces:**
- Consumes: slice-1 `sk_common.cpp` internals (`t_last_error`, `g_mutex`, `g_initialised`, `g_threads`, `g_devices`, `own_directory()`, `kind_of()`).
- Produces: `native/src/sk_internal.h`:
  ```cpp
  namespace sk {
  void set_error(const std::string &msg);            // thread-local message behind sk_last_error()
  bool require_init(const char *what);                // caller holds sk::mutex(); false + error when sk_init has not succeeded
  std::mutex &mutex();                                // the library-wide mutex
  int threads();                                      // the sk_init thread count (already resolved, > 0)
  const std::vector<ggml_backend_dev_t> &devices();   // the listed devices, index == sk_device.index
  int32_t kind_of(ggml_backend_dev_t dev);            // SK_DEVICE_*
  std::string own_directory();                        // directory of libsokuji_native
  void log_line(int32_t level, const char *msg);
  }
  ```
  and the ASR declarations in the header exactly as in "The C ABI added in this slice". `sk_asr_model` layout (private to `sk_asr.cpp`; Tasks 2–3 use the same struct):
  ```cpp
  struct sk_asr_model {
      transcribe_model   *model   = nullptr;
      transcribe_session *session = nullptr;
      std::mutex          mutex;                 // transcribe.cpp 0.x: one compute at a time per model
      std::vector<std::string> language_storage; // copies; caps.languages points into `languages`
      std::vector<const char *> languages;
      std::string         arch;
      sk_asr_caps         caps{};
      bool                stream_open = false;
      std::string         run_text, committed, tentative;   // buffers handed to callers
  };
  ```

- [ ] **Step 1: Write the failing test** — `native/tests/test_asr.cpp`:

```cpp
// Slice-2 ASR surface test. Needs a real GGUF: SK_TEST_ASR_GGUF (whisper-tiny Q8_0).
// Without it the test SKIPS (exit 77, see tests/CMakeLists.txt) — the models are not
// vendored; CI downloads them (native-build.yml), developers export the variable.
#undef NDEBUG
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include "sokuji_native.h"

static const char *env_or_skip(const char *name) {
    const char *v = std::getenv(name);
    if (!v || !*v) { std::printf("test_asr: %s not set, skipping\n", name); std::exit(77); }
    return v;
}

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";
    const char *gguf = env_or_skip("SK_TEST_ASR_GGUF");

    sk_asr_model *before = nullptr;
    assert(sk_asr_load(gguf, nullptr, &before) == SK_ERR_NOT_INITIALISED);   // nothing before sk_init
    assert(before == nullptr);

    sk_init_options opts = {};
    opts.abi_version = SK_ABI_VERSION;
    opts.n_threads = 4;
    opts.module_dir = module_dir;
    assert(sk_init(&opts) == SK_OK);

    sk_asr_model *m = nullptr;
    assert(sk_asr_load("/nonexistent/model.gguf", nullptr, &m) == SK_ERR_NOT_FOUND);
    assert(m == nullptr && std::strstr(sk_last_error(), "sk_asr_load") != nullptr);

    sk_device devs[8];
    int n = sk_devices(devs, 8);
    const sk_device *cpu = nullptr;
    for (int i = 0; i < n; ++i) if (devs[i].kind == SK_DEVICE_CPU) cpu = &devs[i];
    assert(cpu != nullptr);

    assert(sk_asr_load(gguf, cpu, &m) == SK_OK);
    assert(m != nullptr);
    sk_asr_caps caps = {};
    assert(sk_asr_capabilities(m, &caps) == SK_OK);
    assert(caps.native_sample_rate == 16000);
    assert(caps.arch != nullptr && caps.arch[0] != '\0');
    assert(caps.n_languages > 0 && caps.languages != nullptr);        // whisper publishes its 99
    bool saw_en = false;
    for (int i = 0; i < caps.n_languages; ++i) if (std::strcmp(caps.languages[i], "en") == 0) saw_en = true;
    assert(saw_en);
    assert(caps.supports_streaming == false);                          // whisper: batch only
    assert(sk_asr_capabilities(nullptr, &caps) == SK_ERR_INVALID_ARGUMENT);
    sk_asr_unload(m);
    sk_asr_unload(nullptr);                                            // must accept null
    std::printf("test_asr: load/capabilities ok (arch=%s, %d languages)\n", caps.arch, caps.n_languages);
    return 0;
}
```

- [ ] **Step 2: Wire it into CTest** — append to `native/tests/CMakeLists.txt`:

```cmake
# Slice 2: ASR surface. Needs SK_TEST_ASR_GGUF (and, from Task 3, SK_TEST_ASR_STREAM_GGUF);
# exit code 77 = skipped, so a developer without the models still gets a green ctest.
add_executable(test_asr test_asr.cpp)
target_link_libraries(test_asr PRIVATE sokuji_native)
add_test(NAME test_asr COMMAND test_asr ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_asr PROPERTIES
    ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib"
    SKIP_RETURN_CODE 77)
```

- [ ] **Step 3: See it fail** — `cmake -S native -B native/build/cpu -DSOKUJI_GPU=none && cmake --build native/build/cpu -j20 2>&1 | tail -5`. Expected: compile error in `test_asr.cpp` (`sk_asr_model` undeclared) — red.

- [ ] **Step 4: Shared helpers** — create `native/src/sk_internal.h`:

```cpp
/* Internal to libsokuji_native: what sk_common.cpp owns and the other sk_*.cpp files use.
 * Never installed. Each function states its locking rule. */
#pragma once
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>
#include "ggml-backend.h"

namespace sk {
void set_error(const std::string &msg);            // thread-local; read back by sk_last_error()
bool require_init(const char *what);                // caller holds mutex(); sets the error when false
std::mutex &mutex();                                // the library-wide lock (init, device table)
int threads();                                      // resolved sk_init thread count, always > 0 after init
const std::vector<ggml_backend_dev_t> &devices();   // index == sk_device.index; stable after sk_init
int32_t kind_of(ggml_backend_dev_t dev);            // SK_DEVICE_CPU / VULKAN / METAL / OTHER
std::string own_directory();                        // directory containing this shared library
void log_line(int32_t level, const char *msg);      // the sk_init log sink, if any
}  // namespace sk
```

Then in `native/src/sk_common.cpp`: add `#include "sk_internal.h"` after `#include "version.h"`, and immediately before `extern "C" {` add the bridge (the anonymous-namespace functions are reachable from the same translation unit):

```cpp
namespace sk {
void set_error(const std::string &msg) { ::set_error(msg); }
bool require_init(const char *what) { return ::require_init(what); }
std::mutex &mutex() { return g_mutex; }
int threads() { return g_threads; }
const std::vector<ggml_backend_dev_t> &devices() { return g_devices; }
int32_t kind_of(ggml_backend_dev_t dev) { return ::kind_of(dev); }
std::string own_directory() { return ::own_directory(); }
void log_line(int32_t level, const char *msg) { ::log_line(level, msg); }
}  // namespace sk
```

Nothing else in `sk_common.cpp` changes.

- [ ] **Step 5: Header** — in `native/include/sokuji_native.h`, after the `sk_audio_families` declaration and before the closing `#ifdef __cplusplus } #endif`, add the ASR block from "The C ABI added in this slice" (`sk_asr_model`, `sk_asr_stream`, `sk_asr_caps`, `sk_text_cb`, `sk_stream_text`, the eight `sk_asr_*` prototypes), preceded by:

```c
/* ---- ASR (transcribe.cpp) ----
 * A model is loaded once per (GGUF, device) and serialises its own compute: sk_asr_run,
 * sk_asr_stream_feed and sk_asr_stream_finalize on the same model never overlap (the
 * engine's 0.x contract). A model has at most one open stream. Pointers in sk_asr_caps
 * belong to the model (valid until sk_asr_unload); pointers in sk_stream_text belong to
 * the stream and are valid until the next call on that stream. */
```

- [ ] **Step 6: `sk_asr.cpp` (load / capabilities / unload)** — create `native/src/sk_asr.cpp`:

```cpp
#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"

#include "transcribe.h"

#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

struct sk_asr_model {
    transcribe_model   *model   = nullptr;
    transcribe_session *session = nullptr;
    std::mutex          mutex;
    std::vector<std::string>  language_storage;
    std::vector<const char *> languages;
    std::string         arch;
    sk_asr_caps         caps{};
    bool                stream_open = false;
    std::string         run_text, committed, tentative;
};

namespace {

sk_status map_status(transcribe_status st) {
    switch (st) {
        case TRANSCRIBE_OK:
        case TRANSCRIBE_ERR_OUTPUT_TRUNCATED:       return SK_OK;
        case TRANSCRIBE_ERR_FILE_NOT_FOUND:         return SK_ERR_NOT_FOUND;
        case TRANSCRIBE_ERR_INVALID_ARG:
        case TRANSCRIBE_ERR_BAD_STRUCT_SIZE:
        case TRANSCRIBE_ERR_UNSUPPORTED_LANGUAGE:
        case TRANSCRIBE_ERR_NOT_IMPLEMENTED:
        case TRANSCRIBE_ERR_INPUT_TOO_LONG:         return SK_ERR_INVALID_ARGUMENT;
        case TRANSCRIBE_ERR_ABORTED:                return SK_ERR_CANCELLED;
        case TRANSCRIBE_ERR_OOM:
        case TRANSCRIBE_ERR_BACKEND:
        case TRANSCRIBE_ERR_GGUF:
        case TRANSCRIBE_ERR_UNSUPPORTED_ARCH:
        case TRANSCRIBE_ERR_UNSUPPORTED_VARIANT:    return SK_ERR_BACKEND;
        default:                                    return SK_ERR_INTERNAL;
    }
}

sk_status fail(const char *fn, transcribe_status st, const char *detail = nullptr) {
    std::string msg = std::string(fn) + ": " + transcribe_status_string(st);
    if (detail && *detail) msg += std::string(": ") + detail;
    sk::set_error(msg);
    return map_status(st);
}

transcribe_backend_request backend_for(int32_t kind) {
    switch (kind) {
        case SK_DEVICE_CPU:    return TRANSCRIBE_BACKEND_CPU;
        case SK_DEVICE_VULKAN: return TRANSCRIBE_BACKEND_VULKAN;
        case SK_DEVICE_METAL:  return TRANSCRIBE_BACKEND_METAL;
        default:               return TRANSCRIBE_BACKEND_AUTO;
    }
}

}  // namespace

extern "C" {

SK_API sk_status sk_asr_load(const char *gguf, const sk_device *device, sk_asr_model **out) {
    if (out) *out = nullptr;
    if (!gguf || !*gguf || !out) { sk::set_error("sk_asr_load: gguf path and out-pointer are required"); return SK_ERR_INVALID_ARGUMENT; }

    transcribe_model_load_params lp;
    transcribe_model_load_params_init(&lp);
    int threads = 0;
    {
        std::lock_guard<std::mutex> lock(sk::mutex());
        if (!sk::require_init("sk_asr_load")) return SK_ERR_NOT_INITIALISED;
        threads = sk::threads();
        if (device) {
            const auto &devs = sk::devices();
            if (device->index < 0 || static_cast<size_t>(device->index) >= devs.size()) {
                sk::set_error("sk_asr_load: unknown device index " + std::to_string(device->index));
                return SK_ERR_INVALID_ARGUMENT;
            }
            ggml_backend_dev_t dev = devs[static_cast<size_t>(device->index)];
            lp.backend = backend_for(sk::kind_of(dev));                       // Ruling J
            lp.device  = reinterpret_cast<transcribe_device_t>(dev);
        } else {
            lp.backend = TRANSCRIBE_BACKEND_AUTO;
        }
    }   // model loading takes seconds; never hold the library lock for it

    transcribe_model *model = nullptr;
    transcribe_status st = transcribe_model_load_file(gguf, &lp, &model);
    if (st != TRANSCRIBE_OK) return fail("sk_asr_load", st, gguf);

    transcribe_session_params sp;
    transcribe_session_params_init(&sp);
    sp.n_threads = threads;
    transcribe_session *session = nullptr;
    st = transcribe_session_init(model, &sp, &session);
    if (st != TRANSCRIBE_OK) { transcribe_model_free(model); return fail("sk_asr_load: session", st, gguf); }

    auto *h = new sk_asr_model;
    h->model = model;
    h->session = session;

    transcribe_capabilities caps;
    transcribe_capabilities_init(&caps);
    if (transcribe_model_get_capabilities(model, &caps) == TRANSCRIBE_OK) {
        for (int i = 0; i < caps.n_languages && caps.languages; ++i)
            h->language_storage.emplace_back(caps.languages[i] ? caps.languages[i] : "");
        h->caps.supports_streaming       = caps.supports_streaming;
        h->caps.supports_language_detect = caps.supports_language_detect;
        h->caps.native_sample_rate       = caps.native_sample_rate > 0 ? caps.native_sample_rate : 16000;
    } else {
        h->caps.native_sample_rate = 16000;
    }
    h->languages.reserve(h->language_storage.size());          // pointers only after storage is final
    for (const auto &s : h->language_storage) h->languages.push_back(s.c_str());
    h->caps.n_languages = static_cast<int32_t>(h->languages.size());
    h->caps.languages   = h->languages.empty() ? nullptr : h->languages.data();
    const char *arch = transcribe_model_arch_string(model);
    h->arch = arch ? arch : "";
    h->caps.arch = h->arch.c_str();

    *out = h;
    return SK_OK;
}

SK_API sk_status sk_asr_capabilities(sk_asr_model *m, sk_asr_caps *out) {
    if (!m || !out) { sk::set_error("sk_asr_capabilities: model and out-pointer are required"); return SK_ERR_INVALID_ARGUMENT; }
    std::lock_guard<std::mutex> lock(m->mutex);
    *out = m->caps;
    return SK_OK;
}

SK_API void sk_asr_unload(sk_asr_model *m) {
    if (!m) return;
    {
        std::lock_guard<std::mutex> lock(m->mutex);
        if (m->session) transcribe_session_free(m->session);   // tears down any stream state too
        if (m->model)   transcribe_model_free(m->model);
        m->session = nullptr;
        m->model = nullptr;
    }
    delete m;
}

}  // extern "C"
```

- [ ] **Step 7: CMake** — in `native/CMakeLists.txt`: `project(sokuji_native VERSION 0.1.0 …)` → `VERSION 0.2.0`; where `sokuji_native` gets its sources (the `add_library(sokuji_native SHARED …)` line or the `target_sources(sokuji_native PRIVATE …)` that follows) add `src/sk_asr.cpp`. `transcribe` is already linked and its include dir already added (the `target_link_libraries(sokuji_native PRIVATE transcribe)` block).

- [ ] **Step 8: Build and run** — fetch the model once on the dev box:

```bash
mkdir -p ~/.cache/sokuji-native-tests
curl -L -o ~/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf https://huggingface.co/handy-computer/whisper-tiny-gguf/resolve/main/whisper-tiny-Q8_0.gguf
```

then `cmake --build native/build/cpu -j20 && SK_TEST_ASR_GGUF=$HOME/.cache/sokuji-native-tests/whisper-tiny-Q8_0.gguf ctest --test-dir native/build/cpu --output-on-failure`. Expected: `test_common` and `test_asr` pass; `test_asr` prints `arch=whisper`. Run `ctest` once more WITHOUT the variable: `test_asr` shows as **Skipped** (not failed).

- [ ] **Step 9: Version assertion** — in `native/tests/test_common.cpp` replace `assert(std::string(sk_version()).rfind("0.", 0) == 0);          // "0.1.0"` with `assert(std::string(sk_version()) == "0.2.0");` — the bump is part of this task. Rebuild, ctest: green.

- [ ] **Step 10: CI model cache** — in `.github/workflows/native-build.yml`, after the `setup-python` step and before the Vulkan steps, add:

```yaml
      - name: CTest models (whisper-tiny Q8_0, moonshine-streaming-tiny Q8_0)
        id: models
        uses: actions/cache@v4
        with:
          path: native/build/models
          key: ctest-models-v1-whisper-tiny-Q8_0-moonshine-streaming-tiny-Q8_0
      - name: Download CTest models
        if: steps.models.outputs.cache-hit != 'true'
        shell: bash
        run: |
          mkdir -p native/build/models
          curl -sSL -o native/build/models/whisper-tiny-Q8_0.gguf https://huggingface.co/handy-computer/whisper-tiny-gguf/resolve/main/whisper-tiny-Q8_0.gguf
          curl -sSL -o native/build/models/moonshine-streaming-tiny-Q8_0.gguf https://huggingface.co/handy-computer/moonshine-streaming-tiny-gguf/resolve/main/moonshine-streaming-tiny-Q8_0.gguf
          ls -la native/build/models
```

and extend the workflow-level `env:` block (it holds `VULKAN_SDK_VERSION`) with:

```yaml
  SK_TEST_ASR_GGUF: ${{ github.workspace }}/native/build/models/whisper-tiny-Q8_0.gguf
  SK_TEST_ASR_STREAM_GGUF: ${{ github.workspace }}/native/build/models/moonshine-streaming-tiny-Q8_0.gguf
```

`ctest` inherits the job environment on every runner; `build.sh`/`build.ps1` only ever remove `stage`, so `native/build/models` survives the build. Task 10 adds the temporary branch trigger that lets this run.

- [ ] **Step 11: Commit** — `native/src/sk_internal.h native/src/sk_asr.cpp native/src/sk_common.cpp native/include/sokuji_native.h native/CMakeLists.txt native/tests/CMakeLists.txt native/tests/test_asr.cpp native/tests/test_common.cpp .github/workflows/native-build.yml`, message `feat(native): sk_asr_load / sk_asr_capabilities / sk_asr_unload over transcribe.cpp`.

---

### Task 2: `sk_asr_run` with the cancellation poll

**Files:**
- Create: `native/tests/wav.h`
- Modify: `native/src/sk_asr.cpp`, `native/tests/test_asr.cpp`, `native/tests/CMakeLists.txt` (include dir for dr_wav + sample path define)

**Interfaces:**
- Consumes: `sk_asr_model` from Task 1; transcribe.cpp `transcribe_run`, `transcribe_set_abort_callback`, `transcribe_full_text`, `transcribe_run_params` (`transcribe.h:1077-1112, 1535-1538, 1646-1668, 2334`).
- Produces: `sk_status sk_asr_run(sk_asr_model *, const float *pcm, size_t n, const char *lang, sk_text_cb, void *user)` with Ruling E semantics (callback with `NULL` = poll, `false` = cancel; once with the text at the end; `n == 0` → callback with `""`, `SK_OK`); `native/tests/wav.h` exposing `static std::vector<float> read_wav_16k_mono(const char *path)` (asserts 16 kHz mono).

- [ ] **Step 1: WAV shim** — create `native/tests/wav.h` (dr_wav is public domain and ships with the transcribe.cpp checkout at `examples/common/dr_wav.h`; the tests include it from there, nothing is copied into the repo):

```cpp
// Test-only WAV reader over dr_wav (from the fetched transcribe.cpp tree). 16 kHz mono only.
#pragma once
#define DR_WAV_IMPLEMENTATION
#include "dr_wav.h"
#include <cassert>
#include <vector>

static std::vector<float> read_wav_16k_mono(const char *path) {
    unsigned int channels = 0, rate = 0;
    drwav_uint64 frames = 0;
    float *data = drwav_open_file_and_read_pcm_frames_f32(path, &channels, &rate, &frames, NULL);
    assert(data != nullptr && "could not read the sample WAV");
    assert(channels == 1 && rate == 16000 && "test WAVs must be 16 kHz mono");
    std::vector<float> out(data, data + frames);
    drwav_free(data, NULL);
    return out;
}
```

- [ ] **Step 2: Test additions** — in `native/tests/test_asr.cpp` add `#include "wav.h"` and `#include <vector>` at the top, and before the final `sk_asr_unload(m);` in `main`, insert:

```cpp
    // ---- Task 2: batch run + cancellation ----
    std::vector<float> jfk = read_wav_16k_mono(SK_TEST_SAMPLE_WAV);      // "ask not what your country…", 11 s
    struct Collect { std::string text; int polls = 0; bool cancel_at_first_poll = false; };
    auto on_text = [](const char *text, void *user) -> bool {
        auto *c = static_cast<Collect *>(user);
        if (text == nullptr) { ++c->polls; return !c->cancel_at_first_poll; }   // progress poll
        c->text = text;
        return true;
    };
    Collect c;
    assert(sk_asr_run(m, jfk.data(), jfk.size(), "en", on_text, &c) == SK_OK);
    std::printf("test_asr: run -> %s\n", c.text.c_str());
    assert(c.text.find("ask not") != std::string::npos || c.text.find("Ask not") != std::string::npos);
    assert(c.polls > 0);                                                 // the poll fired at least once

    Collect empty;
    assert(sk_asr_run(m, jfk.data(), 0, "en", on_text, &empty) == SK_OK); // n == 0 short-circuits
    assert(empty.text.empty() && empty.polls == 0);

    Collect cancelled;
    cancelled.cancel_at_first_poll = true;
    assert(sk_asr_run(m, jfk.data(), jfk.size(), nullptr, on_text, &cancelled) == SK_ERR_CANCELLED);
    assert(cancelled.text.empty());                                      // no transcript after a cancel
    assert(std::strstr(sk_last_error(), "cancel") != nullptr);

    Collect again;                                                       // the model is reusable after a cancel
    assert(sk_asr_run(m, jfk.data(), jfk.size(), "en", on_text, &again) == SK_OK);
    assert(!again.text.empty());
    assert(sk_asr_run(nullptr, jfk.data(), jfk.size(), "en", on_text, &again) == SK_ERR_INVALID_ARGUMENT);
```

and in `native/tests/CMakeLists.txt` extend the `test_asr` target:

```cmake
target_include_directories(test_asr PRIVATE ${transcribe_SOURCE_DIR}/examples/common)   # dr_wav.h
target_compile_definitions(test_asr PRIVATE SK_TEST_SAMPLE_WAV="${transcribe_SOURCE_DIR}/samples/jfk.wav")
```

(`transcribe_SOURCE_DIR` is set by FetchContent in `upstreams.cmake`, which is included before `tests/`.)

- [ ] **Step 3: See it fail** — build: `sk_asr_run` undeclared/undefined → red.

- [ ] **Step 4: Implement** — append to `native/src/sk_asr.cpp` inside `extern "C" {` (after `sk_asr_capabilities`), plus the helper in the anonymous namespace:

```cpp
// in namespace { … }:
struct run_ctx {
    sk_text_cb cb;
    void *user;
    bool cancelled;
};

bool abort_poll(void *p) {                       // transcribe.cpp polls this between decode steps
    auto *c = static_cast<run_ctx *>(p);
    if (!c->cb) return false;
    if (c->cb(nullptr, c->user)) return false;   // keep going
    c->cancelled = true;
    return true;                                 // abort
}
```

```cpp
SK_API sk_status sk_asr_run(sk_asr_model *m, const float *pcm, size_t n, const char *lang, sk_text_cb cb, void *user) {
    if (!m || (!pcm && n > 0) || n > static_cast<size_t>(INT32_MAX)) {
        sk::set_error("sk_asr_run: model and pcm (n <= INT32_MAX) are required");
        return SK_ERR_INVALID_ARGUMENT;
    }
    std::lock_guard<std::mutex> lock(m->mutex);
    if (m->stream_open) { sk::set_error("sk_asr_run: a stream is open on this model"); return SK_ERR_INVALID_ARGUMENT; }
    m->run_text.clear();
    if (n == 0) { if (cb) cb("", user); return SK_OK; }

    transcribe_run_params rp;
    transcribe_run_params_init(&rp);
    rp.language = (lang && *lang) ? lang : nullptr;              // NULL = autodetect (transcribe.h:1041)

    run_ctx ctx{cb, user, false};
    transcribe_set_abort_callback(m->session, abort_poll, &ctx);
    transcribe_status st = transcribe_run(m->session, pcm, static_cast<int>(n), &rp);
    transcribe_set_abort_callback(m->session, nullptr, nullptr);

    if (st == TRANSCRIBE_ERR_ABORTED || ctx.cancelled) { sk::set_error("sk_asr_run: cancelled by the callback"); return SK_ERR_CANCELLED; }
    if (st != TRANSCRIBE_OK && st != TRANSCRIBE_ERR_OUTPUT_TRUNCATED) return fail("sk_asr_run", st);

    const char *text = transcribe_full_text(m->session);
    m->run_text = text ? text : "";
    if (cb) cb(m->run_text.c_str(), user);
    return SK_OK;
}
```

- [ ] **Step 5: Run** — rebuild + `SK_TEST_ASR_GGUF=… ctest --test-dir native/build/cpu --output-on-failure -R test_asr`. Expected: PASS; the printed transcript contains "ask not". If the poll count assertion fails on whisper-tiny (11 s of audio is one 30 s chunk, but decode steps are polled), lower nothing — inspect: transcribe.cpp documents the poll "between chunks and between decode steps" (`transcribe.h:1648-1657`).

- [ ] **Step 6: Commit** — `native/src/sk_asr.cpp native/tests/test_asr.cpp native/tests/wav.h native/tests/CMakeLists.txt`, message `feat(native): sk_asr_run with the text callback as cancellation poll`.

---

### Task 3: streaming — `sk_asr_stream_open` / `feed` / `finalize` / `close`

**Files:**
- Modify: `native/src/sk_asr.cpp`, `native/tests/test_asr.cpp`

**Interfaces:**
- Consumes: `sk_asr_model` (Task 1); transcribe.cpp `transcribe_stream_begin/feed/finalize/reset/get_text` (`transcribe.h:2125-2168, 2185, 2032`), `transcribe_stream_params`, `transcribe_stream_update`, `transcribe_stream_text` (`transcribe.h:1901-1906, 1966-1976, 2019-2028`).
- Produces: the four `sk_asr_stream_*` functions with Ruling F semantics. `struct sk_asr_stream { sk_asr_model *model; }` (private).

- [ ] **Step 1: Test additions** — in `test_asr.cpp`, after the Task-2 block and still before `sk_asr_unload(m);`:

```cpp
    // ---- Task 3: streaming (whisper cannot stream; moonshine-streaming-tiny can) ----
    sk_asr_stream *no = nullptr;
    assert(sk_asr_stream_open(m, "en", &no) == SK_ERR_INVALID_ARGUMENT);   // caps.supports_streaming == false
    assert(no == nullptr);

    const char *stream_gguf = std::getenv("SK_TEST_ASR_STREAM_GGUF");
    if (stream_gguf && *stream_gguf) {
        sk_asr_model *sm = nullptr;
        assert(sk_asr_load(stream_gguf, cpu, &sm) == SK_OK);
        sk_asr_caps scaps = {};
        assert(sk_asr_capabilities(sm, &scaps) == SK_OK && scaps.supports_streaming);

        sk_asr_stream *st = nullptr;
        assert(sk_asr_stream_open(sm, "en", &st) == SK_OK && st != nullptr);
        sk_asr_stream *second = nullptr;
        assert(sk_asr_stream_open(sm, "en", &second) == SK_ERR_INVALID_ARGUMENT);   // one stream per model (Ruling F)
        assert(sk_asr_run(sm, jfk.data(), jfk.size(), "en", on_text, &c) == SK_ERR_INVALID_ARGUMENT); // no batch while streaming

        const size_t chunk = 8000;                                             // 500 ms
        std::string last_committed;
        size_t committed_grew = 0;
        for (size_t off = 0; off < jfk.size(); off += chunk) {
            size_t len = std::min(chunk, jfk.size() - off);
            sk_stream_text txt = {};
            assert(sk_asr_stream_feed(st, jfk.data() + off, len, &txt) == SK_OK);
            assert(txt.committed != nullptr && txt.tentative != nullptr);
            std::string now = txt.committed;
            assert(now.compare(0, last_committed.size(), last_committed) == 0);   // append-only prefix
            if (now.size() > last_committed.size()) ++committed_grew;
            last_committed = now;
        }
        Collect fin;
        assert(sk_asr_stream_finalize(st, on_text, &fin) == SK_OK);
        std::printf("test_asr: stream -> %s (committed grew %zu times)\n", fin.text.c_str(), committed_grew);
        assert(!fin.text.empty());
        assert(fin.text.find("country") != std::string::npos || fin.text.find("Country") != std::string::npos);
        sk_stream_text after = {};
        assert(sk_asr_stream_feed(st, jfk.data(), chunk, &after) == SK_ERR_INVALID_ARGUMENT);   // finalized: closed
        sk_asr_stream_close(st);

        sk_asr_stream *st2 = nullptr;                                          // reopen on the same model
        assert(sk_asr_stream_open(sm, nullptr, &st2) == SK_OK);
        sk_stream_text t2 = {};
        assert(sk_asr_stream_feed(st2, jfk.data(), chunk, &t2) == SK_OK);
        sk_asr_stream_close(st2);                                              // abort without finalize
        Collect batch_again;                                                   // and the model is back to batch use
        assert(sk_asr_run(sm, jfk.data(), jfk.size(), "en", on_text, &batch_again) == SK_OK);
        sk_asr_stream_close(nullptr);
        sk_asr_unload(sm);
    } else {
        std::printf("test_asr: SK_TEST_ASR_STREAM_GGUF not set, streaming block skipped\n");
    }
```

Add `#include <algorithm>` for `std::min`.

- [ ] **Step 2: See it fail** — build: `sk_asr_stream_open` undefined → red.

- [ ] **Step 3: Implement** — append to `sk_asr.cpp`. Above `extern "C"`:

```cpp
struct sk_asr_stream {
    sk_asr_model *model;
};

namespace {
// Copy the session's committed/tentative view into the model's buffers (caller holds m->mutex).
sk_status snapshot_text(sk_asr_model *m, const char *fn) {
    transcribe_stream_text t;
    transcribe_stream_text_init(&t);
    transcribe_status st = transcribe_stream_get_text(m->session, &t);
    if (st != TRANSCRIBE_OK) return fail(fn, st);
    m->committed.assign(t.committed_text ? t.committed_text : "", t.committed_text ? t.committed_text_bytes : 0);
    m->tentative.assign(t.tentative_text ? t.tentative_text : "", t.tentative_text ? t.tentative_text_bytes : 0);
    return SK_OK;
}
}  // namespace
```

Inside `extern "C"`:

```cpp
SK_API sk_status sk_asr_stream_open(sk_asr_model *m, const char *lang, sk_asr_stream **out) {
    if (out) *out = nullptr;
    if (!m || !out) { sk::set_error("sk_asr_stream_open: model and out-pointer are required"); return SK_ERR_INVALID_ARGUMENT; }
    std::lock_guard<std::mutex> lock(m->mutex);
    if (!m->caps.supports_streaming) { sk::set_error("sk_asr_stream_open: this model does not support streaming"); return SK_ERR_INVALID_ARGUMENT; }
    if (m->stream_open) { sk::set_error("sk_asr_stream_open: a stream is already open on this model"); return SK_ERR_INVALID_ARGUMENT; }

    transcribe_run_params rp;
    transcribe_run_params_init(&rp);
    rp.language = (lang && *lang) ? lang : nullptr;
    transcribe_stream_params sp;
    transcribe_stream_params_init(&sp);                              // family defaults, AUTO commit policy
    transcribe_status st = transcribe_stream_begin(m->session, &rp, &sp);
    if (st != TRANSCRIBE_OK) return fail("sk_asr_stream_open", st);

    m->stream_open = true;
    m->committed.clear();
    m->tentative.clear();
    *out = new sk_asr_stream{m};
    return SK_OK;
}

SK_API sk_status sk_asr_stream_feed(sk_asr_stream *s, const float *pcm, size_t n, sk_stream_text *out) {
    if (!s || !s->model || (!pcm && n > 0) || n > static_cast<size_t>(INT32_MAX)) {
        sk::set_error("sk_asr_stream_feed: stream and pcm (n <= INT32_MAX) are required");
        return SK_ERR_INVALID_ARGUMENT;
    }
    sk_asr_model *m = s->model;
    std::lock_guard<std::mutex> lock(m->mutex);
    if (!m->stream_open) { sk::set_error("sk_asr_stream_feed: the stream is finalized or closed"); return SK_ERR_INVALID_ARGUMENT; }
    if (n > 0) {
        transcribe_stream_update u;
        transcribe_stream_update_init(&u);
        transcribe_status st = transcribe_stream_feed(m->session, pcm, static_cast<int>(n), &u);
        if (st != TRANSCRIBE_OK) return fail("sk_asr_stream_feed", st);
    }
    sk_status rc = snapshot_text(m, "sk_asr_stream_feed");
    if (rc != SK_OK) return rc;
    if (out) { out->committed = m->committed.c_str(); out->tentative = m->tentative.c_str(); }
    return SK_OK;
}

SK_API sk_status sk_asr_stream_finalize(sk_asr_stream *s, sk_text_cb cb, void *user) {
    if (!s || !s->model) { sk::set_error("sk_asr_stream_finalize: stream is required"); return SK_ERR_INVALID_ARGUMENT; }
    sk_asr_model *m = s->model;
    std::lock_guard<std::mutex> lock(m->mutex);
    if (!m->stream_open) { sk::set_error("sk_asr_stream_finalize: the stream is finalized or closed"); return SK_ERR_INVALID_ARGUMENT; }
    transcribe_stream_update u;
    transcribe_stream_update_init(&u);
    transcribe_status st = transcribe_stream_finalize(m->session, &u);
    sk_status rc;
    if (st == TRANSCRIBE_OK || st == TRANSCRIBE_ERR_OUTPUT_TRUNCATED) {
        // Ruling N: the final text is the post-finalize FULL hypothesis. committed_text is
        // a best-effort append-only display prefix that transcribe.cpp never rolls back —
        // on moonshine-streaming-tiny it demonstrably ends stale while full_text is right.
        transcribe_stream_text t;
        transcribe_stream_text_init(&t);
        transcribe_status gt = transcribe_stream_get_text(m->session, &t);
        if (gt == TRANSCRIBE_OK) {
            m->run_text.assign(t.full_text ? t.full_text : "", t.full_text ? t.full_text_bytes : 0);
            rc = SK_OK;
        } else {
            rc = fail("sk_asr_stream_finalize", gt);
        }
    } else {
        rc = fail("sk_asr_stream_finalize", st);
    }
    transcribe_stream_reset(m->session);                              // back to idle either way (Ruling F)
    m->stream_open = false;
    if (rc != SK_OK) return rc;
    if (cb) cb(m->run_text.c_str(), user);
    return SK_OK;
}

SK_API void sk_asr_stream_close(sk_asr_stream *s) {
    if (!s) return;
    if (sk_asr_model *m = s->model) {
        std::lock_guard<std::mutex> lock(m->mutex);
        if (m->stream_open) { transcribe_stream_reset(m->session); m->stream_open = false; }   // abandon
    }
    delete s;
}
```

- [ ] **Step 4: Run** — fetch the streaming model once (`curl -L -o ~/.cache/sokuji-native-tests/moonshine-streaming-tiny-Q8_0.gguf https://huggingface.co/handy-computer/moonshine-streaming-tiny-gguf/resolve/main/moonshine-streaming-tiny-Q8_0.gguf`), then `SK_TEST_ASR_GGUF=… SK_TEST_ASR_STREAM_GGUF=… ctest --test-dir native/build/cpu --output-on-failure -R test_asr`. Expected: PASS, transcript printed. If moonshine's committed text only appears at finalize (commit policy AUTO may commit late for a 34M model), `committed_grew` may be 0 — that is allowed by the test; the prefix property and the final text are what is asserted.

- [ ] **Step 5: Commit** — `native/src/sk_asr.cpp native/tests/test_asr.cpp`, message `feat(native): sk_asr_stream_open/feed/finalize/close`.

---

### Task 4: `sk_vad_*` over audio.cpp's bundled silero

**Files:**
- Create: `native/src/sk_vad.cpp`, `native/tests/test_vad.cpp`
- Modify: `native/include/sokuji_native.h` (VAD block), `native/CMakeLists.txt` (source; install the weights), `native/tests/CMakeLists.txt` (test_vad), `native/python/setup.py` (no change needed — `_native/*` package-data already covers the file; verify), `native/ci/check_linux_deps.py` (no change — it only inspects `*.so*`)

**Interfaces:**
- Consumes: audio.cpp runtime API — `engine::runtime::make_default_registry()` (`include/engine/framework/runtime/registry.h:43`), `ModelRegistry::load(const ModelLoadRequest &)` (`registry.h:29`), `ModelLoadRequest{model_path, family_hint}` (`model.h:69-75`), `ILoadedVoiceModel::create_task_session(const TaskSpec &, const SessionOptions &)` (`model.h:107`), `TaskSpec{task, mode}`, `SessionOptions{backend, options}` (`session.h:52-60`), `engine::core::BackendConfig{type, device, threads}` (`core/backend.h:18-22`), `BackendType::Cpu` (`core/module.h:13`), `IVoiceTaskSession::prepare(const SessionPreparationRequest &)` (`session.h:242`; a default-constructed request means 16 kHz), `IStreamingVoiceTaskSession::reset() / process_audio_chunk(const AudioChunk &) / finalize()` (`session.h:276-278`), `AudioChunk{sample_rate, channels, start_sample, samples}` (`session.h:74-79`), `StreamEvent::voice_activity` (`std::vector<VoiceActivityEvent>`, `session.h:205-206`), `VoiceActivityEvent{kind, sample, probability, segment}` with `Kind::SpeechStart/SpeechEnd/SpeechSegment` (`session.h:181-192`), `SpeechSegment{span{start_sample,end_sample}, confidence, text}` (`session.h:86-95`), `TaskResult::speech_segments` (`session.h:194-198`). Weights: `${audiocpp_SOURCE_DIR}/assets/framework/models/silero_vad/silero_vad_16k.safetensors`; audio.cpp's option keys `threshold`, `min_speech_duration_ms`, `min_silence_duration_ms`, `speech_pad_ms`, `max_speech_duration_s` (strings in `SessionOptions.options`). Chunk must be exactly 512 samples, mono, contiguous `start_sample` (`src/models/silero_vad/runtime.cpp:622-644`). Everything throws `std::runtime_error`.
- Produces: the VAD declarations from "The C ABI added in this slice" and `struct sk_vad` (private).

- [ ] **Step 1: Write the failing test** — `native/tests/test_vad.cpp`:

```cpp
// Slice-2 VAD surface test. No download: the silero weights ship in the audio.cpp tree and
// are installed next to the library; the test points at the source copy explicitly.
#undef NDEBUG
#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include "sokuji_native.h"
#include "wav.h"

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";

    sk_vad *before = nullptr;
    assert(sk_vad_open(nullptr, &before) == SK_ERR_NOT_INITIALISED);
    assert(before == nullptr);

    sk_init_options opts = {};
    opts.abi_version = SK_ABI_VERSION;
    opts.n_threads = 2;
    opts.module_dir = module_dir;
    assert(sk_init(&opts) == SK_OK);

    sk_vad_options bad = {};
    bad.weights = "/nonexistent/silero.safetensors";
    sk_vad *v = nullptr;
    assert(sk_vad_open(&bad, &v) == SK_ERR_BACKEND);
    assert(v == nullptr && std::strstr(sk_last_error(), "sk_vad_open") != nullptr);

    sk_vad_options o = {};
    o.weights = SK_TEST_VAD_WEIGHTS;                 // the source-tree copy
    o.min_silence_ms = 500;                          // the sidecar's values (sherpa defaults)
    o.min_speech_ms = 250;
    o.speech_pad_ms = -1;
    assert(sk_vad_open(&o, &v) == SK_OK && v != nullptr);

    std::vector<float> jfk = read_wav_16k_mono(SK_TEST_SAMPLE_WAV);
    float wrong[100] = {};
    sk_vad_event ev = {};
    (void)wrong;                                       // (the C ABI takes pcm512; a short buffer is UB, not tested)

    int starts = 0, ends = 0;
    int64_t last_end = -1, first_start = -1;
    for (size_t off = 0; off + 512 <= jfk.size(); off += 512) {
        assert(sk_vad_feed(v, jfk.data() + off, &ev) == SK_OK);
        if (ev.kind == SK_VAD_SPEECH_START) { ++starts; if (first_start < 0) first_start = ev.sample; }
        if (ev.kind == SK_VAD_SPEECH_END) {
            ++ends;
            assert(ev.seg_end > ev.seg_start && ev.seg_end <= static_cast<int64_t>(off + 512));
            assert(ev.seg_start >= last_end);            // segments never overlap or go backwards
            last_end = ev.seg_end;
        }
    }
    sk_vad_event tail = {};
    assert(sk_vad_finalize(v, &tail) == SK_OK);        // closes a trailing open segment, if any
    if (tail.kind == SK_VAD_SPEECH_END) ++ends;
    std::printf("test_vad: %d starts, %d ends, first start at sample %lld\n", starts, ends, static_cast<long long>(first_start));
    assert(starts >= 1 && ends >= 1 && ends <= starts);
    assert(first_start >= 0 && first_start < 16000 * 2);   // JFK starts speaking within the first 2 s

    // reset: the same audio again yields the same first start
    sk_vad_reset(v);
    int64_t first_again = -1;
    for (size_t off = 0; off + 512 <= jfk.size() && first_again < 0; off += 512) {
        assert(sk_vad_feed(v, jfk.data() + off, &ev) == SK_OK);
        if (ev.kind == SK_VAD_SPEECH_START) first_again = ev.sample;
    }
    assert(first_again == first_start);
    assert(sk_vad_feed(nullptr, jfk.data(), &ev) == SK_ERR_INVALID_ARGUMENT);
    sk_vad_close(v);
    sk_vad_close(nullptr);

    sk_vad *dflt = nullptr;                             // NULL weights: next to the library — only the stage has it
    sk_status rc = sk_vad_open(nullptr, &dflt);
    std::printf("test_vad: default-weights open -> %d (%s)\n", rc, rc == SK_OK ? "found next to the library" : sk_last_error());
    if (rc == SK_OK) sk_vad_close(dflt);
    return 0;
}
```

CTest wiring (append to `native/tests/CMakeLists.txt`):

```cmake
add_executable(test_vad test_vad.cpp)
target_link_libraries(test_vad PRIVATE sokuji_native)
target_include_directories(test_vad PRIVATE ${transcribe_SOURCE_DIR}/examples/common)
target_compile_definitions(test_vad PRIVATE
    SK_TEST_SAMPLE_WAV="${transcribe_SOURCE_DIR}/samples/jfk.wav"
    SK_TEST_VAD_WEIGHTS="${audiocpp_SOURCE_DIR}/assets/framework/models/silero_vad/silero_vad_16k.safetensors")
add_test(NAME test_vad COMMAND test_vad ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_vad PROPERTIES ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib")
```

- [ ] **Step 2: See it fail** — build: `sk_vad` undeclared → red.

- [ ] **Step 3: Header** — after the ASR block in `sokuji_native.h`, add the VAD block from "The C ABI added in this slice", preceded by:

```c
/* ---- VAD (audio.cpp silero_vad) ----
 * A VAD runs on the CPU device, at 16 kHz, on exactly 512-sample chunks fed in order.
 * Events are edge-triggered: START once when speech begins (sample = padded start), END
 * once when it ends (with the finished segment), NONE otherwise. sk_vad_finalize reports a
 * trailing open segment as END and resets. A VAD is not thread-safe; one caller at a time. */
```

- [ ] **Step 4: Implement** — create `native/src/sk_vad.cpp`:

```cpp
#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"

#include "engine/framework/core/backend.h"
#include "engine/framework/core/module.h"
#include "engine/framework/runtime/model.h"
#include "engine/framework/runtime/registry.h"
#include "engine/framework/runtime/session.h"

#include <algorithm>
#include <cstdint>
#include <exception>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace rt = engine::runtime;

struct sk_vad {
    std::unique_ptr<rt::ILoadedVoiceModel> model;
    std::unique_ptr<rt::IVoiceTaskSession> session;
    rt::IStreamingVoiceTaskSession *stream = nullptr;   // the same object, streaming view
    int64_t cursor = 0;                                 // samples fed since the last reset
    int64_t last_end = 0;                               // end of the last emitted segment
    bool in_speech = false;
};

namespace {

constexpr int kRate = 16000;
constexpr size_t kChunk = 512;

std::string default_weights() { return sk::own_directory() + "/silero_vad_16k.safetensors"; }

void clear(sk_vad_event *out) { if (out) { out->kind = SK_VAD_NONE; out->sample = 0; out->probability = 0.f; out->seg_start = 0; out->seg_end = 0; } }

// Translate one StreamEvent into at most one sk_vad_event (silero emits at most one
// transition per 512-sample chunk).
void translate(sk_vad *v, const rt::StreamEvent &ev, sk_vad_event *out) {
    for (const auto &va : ev.voice_activity) {
        if (va.kind == rt::VoiceActivityEvent::Kind::SpeechStart) {
            v->in_speech = true;
            if (out) { out->kind = SK_VAD_SPEECH_START; out->sample = va.sample; out->probability = va.probability; }
        } else if (va.kind == rt::VoiceActivityEvent::Kind::SpeechEnd) {
            v->in_speech = false;
            int64_t s = va.segment ? va.segment->span.start_sample : v->last_end;
            int64_t e = va.segment ? va.segment->span.end_sample : va.sample;
            v->last_end = e;
            if (out) { out->kind = SK_VAD_SPEECH_END; out->sample = e; out->probability = va.probability; out->seg_start = s; out->seg_end = e; }
        }
    }
}

}  // namespace

extern "C" {

SK_API sk_status sk_vad_open(const sk_vad_options *o, sk_vad **out) {
    if (out) *out = nullptr;
    if (!out) { sk::set_error("sk_vad_open: out-pointer is required"); return SK_ERR_INVALID_ARGUMENT; }
    int threads = 0;
    {
        std::lock_guard<std::mutex> lock(sk::mutex());
        if (!sk::require_init("sk_vad_open")) return SK_ERR_NOT_INITIALISED;
        threads = sk::threads();
    }
    try {
        auto registry = rt::make_default_registry();
        rt::ModelLoadRequest req;
        req.model_path = (o && o->weights && *o->weights) ? std::string(o->weights) : default_weights();   // Ruling H
        req.family_hint = "silero_vad";
        auto model = registry.load(req);

        rt::SessionOptions so;
        so.backend.type = engine::core::BackendType::Cpu;                       // Ruling B
        so.backend.device = 0;
        so.backend.threads = std::max(1, threads);
        float threshold = (o && o->threshold > 0.f) ? o->threshold : 0.5f;
        int min_speech = (o && o->min_speech_ms > 0) ? o->min_speech_ms : 250;
        int min_silence = (o && o->min_silence_ms > 0) ? o->min_silence_ms : 100;
        int pad = (o && o->speech_pad_ms >= 0) ? o->speech_pad_ms : 30;
        so.options["threshold"] = std::to_string(threshold);
        so.options["min_speech_duration_ms"] = std::to_string(min_speech);
        so.options["min_silence_duration_ms"] = std::to_string(min_silence);
        so.options["speech_pad_ms"] = std::to_string(pad);
        if (o && o->max_speech_s > 0.f) so.options["max_speech_duration_s"] = std::to_string(o->max_speech_s);

        rt::TaskSpec spec;
        spec.task = rt::VoiceTaskKind::Vad;
        spec.mode = rt::RunMode::Streaming;
        auto session = model->create_task_session(spec, so);
        auto *stream = dynamic_cast<rt::IStreamingVoiceTaskSession *>(session.get());
        if (!stream) throw std::runtime_error("silero_vad session is not streaming-capable");
        session->prepare(rt::SessionPreparationRequest{});                     // 16 kHz
        stream->reset();

        auto *v = new sk_vad;
        v->model = std::move(model);
        v->session = std::move(session);
        v->stream = stream;
        *out = v;
        return SK_OK;
    } catch (const std::exception &e) {
        sk::set_error(std::string("sk_vad_open: ") + e.what());
        return SK_ERR_BACKEND;
    }
}

SK_API sk_status sk_vad_feed(sk_vad *v, const float *pcm512, sk_vad_event *out) {
    clear(out);
    if (!v || !pcm512) { sk::set_error("sk_vad_feed: vad and pcm512 are required"); return SK_ERR_INVALID_ARGUMENT; }
    try {
        rt::AudioChunk chunk;
        chunk.sample_rate = kRate;
        chunk.channels = 1;
        chunk.start_sample = v->cursor;
        chunk.samples.assign(pcm512, pcm512 + kChunk);
        rt::StreamEvent ev = v->stream->process_audio_chunk(chunk);
        v->cursor += static_cast<int64_t>(kChunk);
        translate(v, ev, out);
        return SK_OK;
    } catch (const std::exception &e) {
        sk::set_error(std::string("sk_vad_feed: ") + e.what());
        return SK_ERR_BACKEND;
    }
}

SK_API sk_status sk_vad_finalize(sk_vad *v, sk_vad_event *out) {
    clear(out);
    if (!v) { sk::set_error("sk_vad_finalize: vad is required"); return SK_ERR_INVALID_ARGUMENT; }
    try {
        rt::TaskResult result = v->stream->finalize();
        // finalize() returns every segment of the stream; the only one not yet reported is
        // a trailing segment that ends after the last END we emitted.
        for (const auto &seg : result.speech_segments) {
            if (seg.span.end_sample > v->last_end && seg.span.start_sample >= v->last_end) {
                if (out) { out->kind = SK_VAD_SPEECH_END; out->sample = seg.span.end_sample; out->probability = seg.confidence;
                           out->seg_start = seg.span.start_sample; out->seg_end = seg.span.end_sample; }
                v->last_end = seg.span.end_sample;
            }
        }
        v->stream->reset();
        v->cursor = 0; v->last_end = 0; v->in_speech = false;
        return SK_OK;
    } catch (const std::exception &e) {
        sk::set_error(std::string("sk_vad_finalize: ") + e.what());
        return SK_ERR_BACKEND;
    }
}

SK_API void sk_vad_reset(sk_vad *v) {
    if (!v) return;
    try { v->stream->reset(); } catch (const std::exception &) {}
    v->cursor = 0; v->last_end = 0; v->in_speech = false;
}

SK_API void sk_vad_close(sk_vad *v) {
    delete v;   // session before model: member order in the struct guarantees it
}

}  // extern "C"
```

Note on member order: `std::unique_ptr` members are destroyed in reverse declaration order, so `session` (declared second) is destroyed before `model` — the session must not outlive its model. Keep `model` declared first.

- [ ] **Step 5: CMake** — `native/CMakeLists.txt`: add `src/sk_vad.cpp` beside `src/sk_asr.cpp`; the audio.cpp include dir is already on the target (`target_include_directories(sokuji_native PRIVATE ${audiocpp_SOURCE_DIR}/include)`). Install the weights into the stage (next to the library, same component):

```cmake
# silero VAD weights: audio.cpp reads them from disk (safetensors, not GGUF); the wheel carries
# the file next to the library and sk_vad_open finds it there when no path is given (Ruling H).
install(FILES ${audiocpp_SOURCE_DIR}/assets/framework/models/silero_vad/silero_vad_16k.safetensors
        DESTINATION . COMPONENT sokuji)
```

- [ ] **Step 6: Run** — `PYTHON=… native/ci/build.sh none manylinux_2_39_aarch64` (rebuild + ctest + stage + gate + wheel + both Python suites). Expected: `test_vad` PASS with `starts >= 1, ends >= 1`, `first start` within 2 s; the "default-weights open" line prints `found next to the library` only when run against the stage (CTest runs from `build/cpu/lib`, where the file is not — so `rc != SK_OK` there is fine and printed, not asserted). `ls native/build/cpu/stage` shows `silero_vad_16k.safetensors`; `unzip -l native/python/dist/*.whl | grep safetensors` shows it in the wheel.

- [ ] **Step 7: Commit** — `native/src/sk_vad.cpp native/tests/test_vad.cpp native/include/sokuji_native.h native/CMakeLists.txt native/tests/CMakeLists.txt`, message `feat(native): sk_vad_open/feed/finalize/reset/close over audio.cpp silero_vad`.

---

### Task 5: Python binding — `AsrModel`, `AsrStream`, `Vad`

**Files:**
- Modify: `native/python/sokuji_native/_ffi.py`, `native/python/sokuji_native/__init__.py`, `native/python/tests/test_sokuji_native.py`

**Interfaces:**
- Consumes: the C ABI of Tasks 1–4; `_state`, `_load()`, `_raise()`, `native_dir()` from slice 1's `__init__.py`.
- Produces (public, `__all__` extended):
  ```python
  @dataclass(frozen=True)
  class AsrCaps: languages: tuple[str, ...]; supports_streaming: bool; supports_language_detect: bool; native_sample_rate: int; arch: str
  @dataclass(frozen=True)
  class StreamText: committed: str; tentative: str
  @dataclass(frozen=True)
  class VadEvent: kind: str  # "start" | "end"
                  sample: int; probability: float; seg_start: int; seg_end: int
  class AsrModel:
      capabilities: AsrCaps                       # read at load
      def run(self, pcm: np.ndarray | Sequence[float], language: str | None = None, on_poll=None) -> str
      def open_stream(self, language: str | None = None) -> "AsrStream"
      def unload(self) -> None                    # idempotent; also __del__
  class AsrStream:
      def feed(self, pcm) -> StreamText
      def finalize(self) -> str                   # the stream's final text (Ruling N); closed afterwards
      def close(self) -> None                     # idempotent; abandon without finalize
  class Vad:
      def feed(self, pcm512) -> VadEvent | None
      def finalize(self) -> VadEvent | None
      def reset(self) -> None
      def close(self) -> None
  def asr_load(path: str, device: Device | None = None) -> AsrModel
  def vad_open(*, weights: str | None = None, threshold: float = 0.5, min_speech_ms: int = 250, min_silence_ms: int = 100, speech_pad_ms: int = 30, max_speech_s: float = 0.0) -> Vad
  ```
  `run(on_poll=callable)` — `on_poll()` is called between decode steps; returning `False` cancels and `run` raises `NativeError` with `status == SK_ERR_CANCELLED`. PCM arguments accept anything `np.asarray(x, dtype=np.float32)` handles; the ctypes call releases the GIL (ctypes does for foreign calls), so `run` may be called from an executor thread.

- [ ] **Step 1: Failing tests** — append to `native/python/tests/test_sokuji_native.py`:

```python
import numpy as np

ASR_GGUF = os.environ.get("SK_TEST_ASR_GGUF")
STREAM_GGUF = os.environ.get("SK_TEST_ASR_STREAM_GGUF")
needs_asr = pytest.mark.skipif(not (HAVE_TREE and ASR_GGUF), reason="needs a built tree and SK_TEST_ASR_GGUF")
needs_stream = pytest.mark.skipif(not (HAVE_TREE and STREAM_GGUF), reason="needs a built tree and SK_TEST_ASR_STREAM_GGUF")


def _jfk() -> np.ndarray:
    import wave
    path = os.environ.get("SK_TEST_SAMPLE_WAV") or str(
        pathlib.Path(__file__).resolve().parents[2] / "build" / "cpu" / "_deps" / "transcribe-src" / "samples" / "jfk.wav")
    with wave.open(path, "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


@needs_tree
def test_vad_events_on_speech():
    sokuji_native.init()
    v = sokuji_native.vad_open(min_silence_ms=500, min_speech_ms=250)
    pcm = _jfk()
    kinds = []
    for off in range(0, len(pcm) - 512 + 1, 512):
        ev = v.feed(pcm[off:off + 512])
        if ev is not None:
            kinds.append(ev.kind)
            if ev.kind == "end":
                assert ev.seg_end > ev.seg_start
    tail = v.finalize()
    if tail is not None:
        kinds.append(tail.kind)
    assert kinds and kinds[0] == "start" and "end" in kinds
    with pytest.raises(ValueError):
        v.feed(pcm[:100])                       # not 512 samples
    v.close()
    v.close()                                   # idempotent


@needs_tree
def test_vad_default_weights_live_next_to_the_library():
    sokuji_native.init()
    v = sokuji_native.vad_open()                # no path: <native_dir>/silero_vad_16k.safetensors
    v.close()


@needs_asr
def test_asr_load_run_cancel():
    sokuji_native.init()
    cpu = next(d for d in sokuji_native.devices() if d.kind == "cpu")
    m = sokuji_native.asr_load(ASR_GGUF, cpu)
    assert m.capabilities.native_sample_rate == 16000 and "en" in m.capabilities.languages
    assert m.capabilities.supports_streaming is False
    pcm = _jfk()
    text = m.run(pcm, "en")
    assert "ask not" in text.lower()
    assert m.run(pcm[:0], "en") == ""
    polls = []
    with pytest.raises(sokuji_native.NativeError) as e:
        m.run(pcm, None, on_poll=lambda: (polls.append(1), False)[1])
    assert e.value.status == sokuji_native._ffi.SK_ERR_CANCELLED and polls
    with pytest.raises(sokuji_native.NativeError):
        m.open_stream("en")                     # whisper cannot stream
    m.unload()
    m.unload()
    with pytest.raises(sokuji_native.NativeError):
        sokuji_native.asr_load("/nonexistent.gguf")


@needs_stream
def test_asr_stream_prefix_and_finalize():
    sokuji_native.init()
    m = sokuji_native.asr_load(STREAM_GGUF)
    assert m.capabilities.supports_streaming
    pcm = _jfk()
    st = m.open_stream("en")
    with pytest.raises(sokuji_native.NativeError):
        m.open_stream("en")                     # one stream per model
    last = ""
    for off in range(0, len(pcm), 8000):
        t = st.feed(pcm[off:off + 8000])
        assert t.committed.startswith(last)
        last = t.committed
    final = st.finalize()
    assert "country" in final.lower()
    with pytest.raises(sokuji_native.NativeError):
        st.feed(pcm[:8000])                     # closed after finalize
    st.close()
    st2 = m.open_stream()
    st2.feed(pcm[:8000])
    st2.close()                                 # abandon
    assert "ask not" in m.run(pcm, "en").lower()
    m.unload()
```

Run: `SOKUJI_NATIVE_DIR=$PWD/native/build/cpu/stage SK_TEST_ASR_GGUF=… SK_TEST_ASR_STREAM_GGUF=… native/build/pyenv/bin/python -m pytest native/python/tests -q` — expected: the four new tests fail with `AttributeError: module 'sokuji_native' has no attribute 'vad_open'`.

- [ ] **Step 2: `_ffi.py`** — add the declarations. After `sk_device`:

```python
class sk_asr_caps(Structure):
    _fields_ = [("n_languages", c_int32), ("languages", POINTER(c_char_p)), ("supports_streaming", c_bool),
                ("supports_language_detect", c_bool), ("native_sample_rate", c_int32), ("arch", c_char_p)]


class sk_stream_text(Structure):
    _fields_ = [("committed", c_char_p), ("tentative", c_char_p)]


class sk_vad_options(Structure):
    _fields_ = [("weights", c_char_p), ("threshold", c_float), ("min_speech_ms", c_int32), ("min_silence_ms", c_int32),
                ("speech_pad_ms", c_int32), ("max_speech_s", c_float)]


class sk_vad_event(Structure):
    _fields_ = [("kind", c_int32), ("sample", c_int64), ("probability", c_float), ("seg_start", c_int64), ("seg_end", c_int64)]


TEXT_CB = CFUNCTYPE(c_bool, c_char_p, c_void_p)
VAD_KIND = {1: "start", 2: "end"}
```

(`c_float`, `c_int64` join the `from ctypes import …` line.) In `bind()` add, one per line as before:

```python
    lib.sk_asr_load.argtypes = [c_char_p, POINTER(sk_device), POINTER(c_void_p)]
    lib.sk_asr_load.restype = c_int32
    lib.sk_asr_capabilities.argtypes = [c_void_p, POINTER(sk_asr_caps)]
    lib.sk_asr_capabilities.restype = c_int32
    lib.sk_asr_run.argtypes = [c_void_p, POINTER(c_float), c_size_t, c_char_p, TEXT_CB, c_void_p]
    lib.sk_asr_run.restype = c_int32
    lib.sk_asr_stream_open.argtypes = [c_void_p, c_char_p, POINTER(c_void_p)]
    lib.sk_asr_stream_open.restype = c_int32
    lib.sk_asr_stream_feed.argtypes = [c_void_p, POINTER(c_float), c_size_t, POINTER(sk_stream_text)]
    lib.sk_asr_stream_feed.restype = c_int32
    lib.sk_asr_stream_finalize.argtypes = [c_void_p, TEXT_CB, c_void_p]
    lib.sk_asr_stream_finalize.restype = c_int32
    lib.sk_asr_stream_close.argtypes = [c_void_p]
    lib.sk_asr_stream_close.restype = None
    lib.sk_asr_unload.argtypes = [c_void_p]
    lib.sk_asr_unload.restype = None
    lib.sk_vad_open.argtypes = [POINTER(sk_vad_options), POINTER(c_void_p)]
    lib.sk_vad_open.restype = c_int32
    lib.sk_vad_feed.argtypes = [c_void_p, POINTER(c_float), POINTER(sk_vad_event)]
    lib.sk_vad_feed.restype = c_int32
    lib.sk_vad_finalize.argtypes = [c_void_p, POINTER(sk_vad_event)]
    lib.sk_vad_finalize.restype = c_int32
    lib.sk_vad_reset.argtypes = [c_void_p]
    lib.sk_vad_reset.restype = None
    lib.sk_vad_close.argtypes = [c_void_p]
    lib.sk_vad_close.restype = None
```

(`c_size_t` joins the import too.)

- [ ] **Step 3: `__init__.py`** — add `import numpy as np` is NOT allowed (the package has no dependencies; `numpy` is the sidecar's). Accept buffers through `memoryview`/`array` instead: the helper below converts anything with the buffer protocol or any sequence to a `ctypes` float array without numpy, and takes the fast path when the object is a C-contiguous float32 buffer.

```python
def _pcm(x):
    """(ctypes float32 array, n) from a C-contiguous float32 buffer (zero copy: a numpy
    float32 array), any other buffer-protocol object, or a plain sequence of floats."""
    try:
        mv = memoryview(x)
    except TypeError:
        vals = [float(v) for v in x]
        return (ctypes.c_float * len(vals))(*vals), len(vals)
    if mv.format == "f" and mv.c_contiguous:
        n = mv.nbytes // 4
        arr = (ctypes.c_float * n).from_buffer_copy(mv) if mv.readonly else (ctypes.c_float * n).from_buffer(mv)
        return arr, n
    flat = mv.tolist()
    while flat and isinstance(flat[0], list):        # ndim > 1: flatten row-major
        flat = [v for row in flat for v in row]
    vals = [float(v) for v in flat]
    return (ctypes.c_float * len(vals))(*vals), len(vals)
```

`from_buffer` keeps a reference to the source buffer for the array's lifetime, so the caller's numpy array stays alive during the C call by construction.

Then the classes (after `audio_families`):

```python
@dataclass(frozen=True)
class AsrCaps:
    languages: tuple[str, ...]
    supports_streaming: bool
    supports_language_detect: bool
    native_sample_rate: int
    arch: str


@dataclass(frozen=True)
class StreamText:
    committed: str
    tentative: str


@dataclass(frozen=True)
class VadEvent:
    kind: str            # "start" | "end"
    sample: int
    probability: float
    seg_start: int
    seg_end: int


class AsrStream:
    """One open stream on an AsrModel. feed() returns the committed/tentative view after
    the chunk; finalize() returns the final committed text and closes the stream; close()
    abandons it. Both are idempotent."""

    def __init__(self, lib, handle):
        self._lib = lib
        self._h = handle

    def feed(self, pcm) -> StreamText:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_INVALID_ARGUMENT, "sk_asr_stream_feed: stream is closed")
        arr, n = _pcm(pcm)
        out = _ffi.sk_stream_text()
        status = self._lib.sk_asr_stream_feed(self._h, ctypes.cast(arr, ctypes.POINTER(ctypes.c_float)), n, ctypes.byref(out))
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_asr_stream_feed")
        return StreamText((out.committed or b"").decode("utf-8", "replace"), (out.tentative or b"").decode("utf-8", "replace"))

    def finalize(self) -> str:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_INVALID_ARGUMENT, "sk_asr_stream_finalize: stream is closed")
        got: list[str] = []
        cb = _ffi.TEXT_CB(lambda text, _user: (got.append((text or b"").decode("utf-8", "replace")), True)[1])
        status = self._lib.sk_asr_stream_finalize(self._h, cb, None)
        if status != _ffi.SK_OK:
            self.close()
            _raise(self._lib, status, "sk_asr_stream_finalize")
        self.close()
        return got[0] if got else ""

    def close(self) -> None:
        h, self._h = self._h, None
        if h is not None:
            self._lib.sk_asr_stream_close(h)

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass


class AsrModel:
    """A loaded ASR model. Compute on one model is serialised by the library."""

    def __init__(self, lib, handle, caps: AsrCaps):
        self._lib = lib
        self._h = handle
        self.capabilities = caps

    def run(self, pcm, language: str | None = None, on_poll=None) -> str:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_NOT_INITIALISED, "sk_asr_run: model is unloaded")
        arr, n = _pcm(pcm)
        got: list[str] = []

        def _cb(text, _user):
            if text is None:
                return True if on_poll is None else bool(on_poll())
            got.append(text.decode("utf-8", "replace"))
            return True

        cb = _ffi.TEXT_CB(_cb)
        status = self._lib.sk_asr_run(self._h, ctypes.cast(arr, ctypes.POINTER(ctypes.c_float)), n,
                                      language.encode() if language else None, cb, None)
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_asr_run")
        return got[0] if got else ""

    def open_stream(self, language: str | None = None) -> AsrStream:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_NOT_INITIALISED, "sk_asr_stream_open: model is unloaded")
        out = ctypes.c_void_p()
        status = self._lib.sk_asr_stream_open(self._h, language.encode() if language else None, ctypes.byref(out))
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_asr_stream_open")
        return AsrStream(self._lib, out.value)

    def unload(self) -> None:
        h, self._h = self._h, None
        if h is not None:
            self._lib.sk_asr_unload(h)

    def __del__(self):
        try:
            self.unload()
        except Exception:
            pass


def asr_load(path: str, device: Device | None = None) -> AsrModel:
    lib = _load()
    out = ctypes.c_void_p()
    dev = None
    if device is not None:
        dev = _ffi.sk_device()
        dev.index = int(device.index)
    status = lib.sk_asr_load(str(path).encode(), ctypes.byref(dev) if dev is not None else None, ctypes.byref(out))
    if status != _ffi.SK_OK:
        _raise(lib, status, "sk_asr_load")
    raw = _ffi.sk_asr_caps()
    status = lib.sk_asr_capabilities(out.value, ctypes.byref(raw))
    if status != _ffi.SK_OK:
        lib.sk_asr_unload(out.value)
        _raise(lib, status, "sk_asr_capabilities")
    langs = tuple(raw.languages[i].decode() for i in range(raw.n_languages)) if raw.languages else ()
    caps = AsrCaps(langs, bool(raw.supports_streaming), bool(raw.supports_language_detect),
                   int(raw.native_sample_rate), (raw.arch or b"").decode())
    return AsrModel(lib, out.value, caps)


class Vad:
    """One silero VAD instance: feed exactly 512 float32 samples at 16 kHz per call."""

    def __init__(self, lib, handle):
        self._lib = lib
        self._h = handle

    def _event(self, ev) -> VadEvent | None:
        kind = _ffi.VAD_KIND.get(ev.kind)
        if kind is None:
            return None
        return VadEvent(kind, int(ev.sample), float(ev.probability), int(ev.seg_start), int(ev.seg_end))

    def feed(self, pcm512) -> VadEvent | None:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_INVALID_ARGUMENT, "sk_vad_feed: vad is closed")
        arr, n = _pcm(pcm512)
        if n != 512:
            raise ValueError(f"sk_vad_feed: exactly 512 samples per call, got {n}")
        ev = _ffi.sk_vad_event()
        status = self._lib.sk_vad_feed(self._h, ctypes.cast(arr, ctypes.POINTER(ctypes.c_float)), ctypes.byref(ev))
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_vad_feed")
        return self._event(ev)

    def finalize(self) -> VadEvent | None:
        if self._h is None:
            raise NativeError(_ffi.SK_ERR_INVALID_ARGUMENT, "sk_vad_finalize: vad is closed")
        ev = _ffi.sk_vad_event()
        status = self._lib.sk_vad_finalize(self._h, ctypes.byref(ev))
        if status != _ffi.SK_OK:
            _raise(self._lib, status, "sk_vad_finalize")
        return self._event(ev)

    def reset(self) -> None:
        if self._h is not None:
            self._lib.sk_vad_reset(self._h)

    def close(self) -> None:
        h, self._h = self._h, None
        if h is not None:
            self._lib.sk_vad_close(h)

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass


def vad_open(*, weights: str | None = None, threshold: float = 0.5, min_speech_ms: int = 250,
             min_silence_ms: int = 100, speech_pad_ms: int = 30, max_speech_s: float = 0.0) -> Vad:
    lib = _load()
    o = _ffi.sk_vad_options()
    o.weights = weights.encode() if weights else None
    o.threshold = float(threshold)
    o.min_speech_ms = int(min_speech_ms)
    o.min_silence_ms = int(min_silence_ms)
    o.speech_pad_ms = int(speech_pad_ms)
    o.max_speech_s = float(max_speech_s)
    out = ctypes.c_void_p()
    status = lib.sk_vad_open(ctypes.byref(o), ctypes.byref(out))
    if status != _ffi.SK_OK:
        _raise(lib, status, "sk_vad_open")
    return Vad(lib, out.value)
```

`__all__` gains `"AsrCaps", "AsrModel", "AsrStream", "StreamText", "VadEvent", "Vad", "asr_load", "vad_open"`. Keep the trampoline objects (`cb`) alive for the duration of each call only — they are locals of the calling frame, which is exactly the call's lifetime; the native side does not retain text callbacks.

- [ ] **Step 4: Run** — same pytest command as Step 1, against the stage from Task 4's build (`SOKUJI_NATIVE_DIR=$PWD/native/build/cpu/stage`, which now contains the safetensors). Expected: all pass (the ASR ones skip without the env vars). Then the full `native/ci/build.sh none …` run (it sets `SOKUJI_NATIVE_DIR` to the stage): green.

- [ ] **Step 5: `build.sh`/`build.ps1` pass the model env through** — nothing to change: pytest inherits the environment, and CI's job `env` sets `SK_TEST_ASR_GGUF` / `SK_TEST_ASR_STREAM_GGUF` (Task 1). Add `SK_TEST_SAMPLE_WAV` to the same CI `env` block: `${{ github.workspace }}/native/build/<lane>/_deps/transcribe-src/samples/jfk.wav` is lane-specific, so instead in `build.sh` export it before the pytest line: `export SK_TEST_SAMPLE_WAV="$BUILD/_deps/transcribe-src/samples/jfk.wav"`, and in `build.ps1`: `$env:SK_TEST_SAMPLE_WAV = "$Build\_deps\transcribe-src\samples\jfk.wav"` (remove it with the other two afterwards).

- [ ] **Step 6: Commit** — `native/python/sokuji_native/_ffi.py native/python/sokuji_native/__init__.py native/python/tests/test_sokuji_native.py native/ci/build.sh native/ci/build.ps1`, message `feat(native): sokuji_native AsrModel/AsrStream/Vad over sk_asr_* and sk_vad_*`.

---

### Task 6: sidecar entry point `native.py` and the device probe over it

**Files:**
- Create: `sidecar/sokuji_sidecar/native.py`, `sidecar/tests/test_native.py`
- Modify: `sidecar/sokuji_sidecar/accel.py` (`_tc_devices/_tc_kinds/_tc_gpus/device_free_bytes/_installed`), `sidecar/tests/test_accel.py` (the `transcribe_cpp` stubs → `sokuji_native` stubs)

**Interfaces:**
- Consumes: `sokuji_native.init(n_threads, log)`, `devices() -> list[Device(index, kind, name, description, mem_total, mem_free)]`, `device_free_mem(index)`.
- Produces `sidecar/sokuji_sidecar/native.py`:
  ```python
  def module():            # the imported sokuji_native, initialised exactly once (sk_init); raises ImportError if the wheel is absent
  def devices() -> list    # module().devices()
  def device_for(kind: str)  # first Device whose .kind == kind, else raises BackendLoadError
  def reset_for_tests()    # forgets the cached module (tests swap sys.modules["sokuji_native"])
  ```
  `accel.py`: `_native_devices()`, `_native_kinds()`, `_native_gpus()` replace the three `_tc_*` functions with identical return shapes; `_installed()` maps `"native_asr"` and `"native_asr_stream"` to `"sokuji_native"`.

- [ ] **Step 1: Failing tests** — `sidecar/tests/test_native.py`:

```python
"""native.py: the one module that touches sokuji_native. The wheel is faked at the module
level (sys.modules), exactly the way the accel tests fake it."""
import sys
import types

import pytest

from sokuji_sidecar import native
from sokuji_sidecar.backends import BackendLoadError


class _Dev:
    def __init__(self, index, kind, description, total=0, free=0):
        self.index, self.kind, self.name = index, kind, f"{kind}{index}"
        self.description, self.mem_total, self.mem_free = description, total, free


def fake_native(monkeypatch, devs, calls=None):
    mod = types.ModuleType("sokuji_native")
    calls = calls if calls is not None else []
    mod.init = lambda n_threads=0, log=None: calls.append(("init", n_threads, log is not None))
    mod.devices = lambda: list(devs)
    mod.device_free_mem = lambda i: next(d.mem_free for d in devs if d.index == i)
    monkeypatch.setitem(sys.modules, "sokuji_native", mod)
    native.reset_for_tests()
    return calls


def test_module_inits_once_with_thread_policy(monkeypatch):
    monkeypatch.setenv("SOKUJI_NATIVE_THREADS", "6")
    calls = fake_native(monkeypatch, [_Dev(0, "cpu", "CPU")])
    assert native.module() is native.module()
    assert calls == [("init", 6, True)]            # once, with the env thread count and a log sink


def test_device_for_picks_first_of_kind(monkeypatch):
    fake_native(monkeypatch, [_Dev(0, "vulkan", "NVIDIA GB10", 1 << 30, 1 << 29), _Dev(1, "cpu", "CPU")])
    assert native.device_for("vulkan").description == "NVIDIA GB10"
    assert native.device_for("cpu").index == 1
    with pytest.raises(BackendLoadError):
        native.device_for("metal")


def test_missing_wheel_is_import_error(monkeypatch):
    monkeypatch.setitem(sys.modules, "sokuji_native", None)
    native.reset_for_tests()
    with pytest.raises(ImportError):
        native.module()
```

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests/test_native.py -q` → `ModuleNotFoundError: sokuji_sidecar.native`.

- [ ] **Step 2: `native.py`**:

```python
"""The sidecar's one door to sokuji_native (spec §5.2). Lazily imports the wheel, calls
sk_init exactly once per process with the SOKUJI_NATIVE_THREADS policy (0 = hardware
concurrency) and a log sink into `logging`, and answers device questions. Every other
module goes through here; none imports sokuji_native directly (test_torch_free_gate keeps
that honest from slice 5 on)."""
import logging
import os
import threading

from .backends import BackendLoadError

_log = logging.getLogger("sokuji_native")
_LEVELS = {0: logging.DEBUG, 1: logging.INFO, 2: logging.WARNING, 3: logging.ERROR}
_lock = threading.Lock()
_module = None


def _sink(level: int, message: str) -> None:
    _log.log(_LEVELS.get(int(level), logging.INFO), "%s", message)


def module():
    """The initialised sokuji_native module. ImportError when the wheel is absent — callers
    that must degrade (accel.probe) wrap it in _safe; backends turn it into BackendLoadError."""
    global _module
    with _lock:
        if _module is None:
            import sokuji_native  # the wheel; heavy, so only on first use
            sokuji_native.init(n_threads=int(os.environ.get("SOKUJI_NATIVE_THREADS", "0") or 0), log=_sink)
            _module = sokuji_native
        return _module


def devices() -> list:
    return list(module().devices())


def device_for(kind: str):
    """The first device of `kind` ("cpu" | "vulkan" | "metal"), or BackendLoadError — the
    resolver then falls back to the next plan."""
    for d in devices():
        if d.kind == kind:
            return d
    raise BackendLoadError(f"no {kind} device in this process")


def reset_for_tests() -> None:
    global _module
    with _lock:
        _module = None
```

- [ ] **Step 3: Run** — `test_native.py`: 3 passed.

- [ ] **Step 4: `accel.py`** — replace the three `_tc_*` functions and `device_free_bytes` (lines 68-103) with:

```python
def _native_devices():
    """sokuji_native's device list — one process, one ggml registry, the vendor-agnostic
    ground truth (sees AMD/Intel/Apple where NVML can't). Raises when the wheel is absent
    (probe() degrades via _safe)."""
    from . import native
    return native.devices()


def _native_kinds() -> tuple[str, ...]:
    """Accelerator kinds the native library can actually use here. Sorted for a stable
    fingerprint; () when the wheel is absent (probe degrades)."""
    return tuple(sorted({d.kind for d in _native_devices()}))


def _native_gpus() -> tuple[tuple[str, str, int], ...]:
    """Stable identity of the non-cpu devices: (kind, name, mem_total)."""
    return tuple((d.kind, d.description or "", int(d.mem_total or 0))
                 for d in _native_devices() if d.kind != "cpu")


def device_free_bytes():
    """FRESH free memory (bytes) of the primary accelerator device, or None when there is
    none (wheel absent, or no accelerator device). Volatile by design — call at plan/load
    time, never cache in Machine. Callers treat None as 'skip VRAM gating/measurement'."""
    try:
        from . import native
        for d in _native_devices():
            if d.kind != "cpu":
                free = int(native.module().device_free_mem(d.index) or 0)
                if free > 0:
                    return free
    except Exception:
        pass
    return None
```

In `_installed()` replace the two `"transcribe_cpp*"` entries with `"native_asr": "sokuji_native", "native_asr_stream": "sokuji_native",`. In `probe()` rename the two locals and calls (`tc_kinds = _safe(_native_kinds, ())`, `tc_gpus = _safe(_native_gpus, ())`; the `Machine(...)` keyword arguments `tc_kinds=` / `gpus=` are unchanged — Ruling A). Update the `Machine.tc_kinds` docstring's first line to "Accelerator kinds the native library reports on this machine".

- [ ] **Step 5: `test_accel.py`** — mechanical replacements:
  - every `monkeypatch.setattr(accel, "_tc_gpus", …)` → `"_native_gpus"`; `"_tc_kinds"` → `"_native_kinds"` (the `_machine()` helper's `tc=`/`gpus=` kwargs stay).
  - `installed=frozenset({"transcribe_cpp", "transcribe_cpp_stream"})` → `frozenset({"native_asr", "native_asr_stream"})` everywhere in this file (also the `_catalog_reply` helper and `test_models_catalog_exposes_asr_variant_ids_and_deduped_tiers`).
  - the E1 block (`_FakeTcDev`, `_fake_tc_module`, and the five tests using them): replace with

```python
class _FakeDev:
    def __init__(self, index, kind, desc, total, free):
        self.index, self.kind, self.name = index, kind, f"{kind}{index}"
        self.description, self.mem_total, self.mem_free = desc, total, free


def _fake_native_module(monkeypatch, devs):
    import sys, types
    from sokuji_sidecar import native
    mod = types.ModuleType("sokuji_native")
    mod.init = lambda n_threads=0, log=None: None
    mod.devices = lambda: list(devs)
    mod.device_free_mem = lambda i: next(d.mem_free for d in devs if d.index == i)
    monkeypatch.setitem(sys.modules, "sokuji_native", mod)
    native.reset_for_tests()
    return mod


def test_machine_gpus_stable_identity(monkeypatch):
    _fake_native_module(monkeypatch, [
        _FakeDev(0, "vulkan", "AMD Radeon RX 7800 XT", 16 << 30, 15 << 30),
        _FakeDev(1, "cpu", "Ryzen 7", 64 << 30, 60 << 30),
    ])
    monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
    monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
    monkeypatch.setattr(accel, "_installed", lambda: frozenset({"native_asr"}))
    m = accel.probe(force=True)
    assert m.gpus == (("vulkan", "AMD Radeon RX 7800 XT", 16 << 30),)
    assert m.tc_kinds == ("cpu", "vulkan")


def test_fingerprint_ignores_volatile_free(monkeypatch):
    def probe_with_free(free):
        _fake_native_module(monkeypatch, [_FakeDev(0, "vulkan", "RTX 4070", 12 << 30, free)])
        monkeypatch.setattr(accel, "_apple_silicon", lambda: False)
        monkeypatch.setattr(accel, "_dml_adapters", lambda: ())
        monkeypatch.setattr(accel, "_installed", lambda: frozenset())
        return accel.probe(force=True).fingerprint
    assert probe_with_free(10 << 30) == probe_with_free(2 << 30)


def test_device_free_bytes_prefers_native(monkeypatch):
    _fake_native_module(monkeypatch, [_FakeDev(0, "vulkan", "RTX 4070", 12 << 30, 9 << 30)])
    assert accel.device_free_bytes() == 9 << 30


def test_device_free_bytes_none_without_native(monkeypatch):
    import sys
    from sokuji_sidecar import native
    monkeypatch.setitem(sys.modules, "sokuji_native", None)   # import fails
    native.reset_for_tests()
    assert accel.device_free_bytes() is None


def test_device_free_bytes_none_without_gpu(monkeypatch):
    _fake_native_module(monkeypatch, [_FakeDev(0, "cpu", "Ryzen", 64 << 30, 60 << 30)])
    assert accel.device_free_bytes() is None
```

  - `test_asr_unavailable_without_transcribe_cpp` → rename `test_asr_unavailable_without_native` (body unchanged; it uses `installed=frozenset()`).

- [ ] **Step 6: Run** — `pytest sidecar/tests/test_accel.py sidecar/tests/test_native.py -q`: green apart from tests that assert `Plan(...).backend == "transcribe_cpp"` from the catalog (they go green in Task 9 — list them in the task report, do not touch the catalog here).

- [ ] **Step 7: Commit** — `sidecar/sokuji_sidecar/native.py sidecar/sokuji_sidecar/accel.py sidecar/tests/test_native.py sidecar/tests/test_accel.py`, message `feat(sidecar): native.py entry point; device probe over sokuji_native`.

---

### Task 7: `asr_backend.py` replaces `transcribe_backend.py`

**Files:**
- Create: `sidecar/sokuji_sidecar/asr_backend.py`, `sidecar/tests/test_asr_backend.py`
- Delete: `sidecar/sokuji_sidecar/transcribe_backend.py`, `sidecar/tests/test_transcribe_backend.py`
- Modify: `sidecar/sokuji_sidecar/backends.py` (bottom import)

**Interfaces:**
- Consumes: `native.module()`, `native.device_for(kind)`; `sokuji_native.asr_load(path, device) -> AsrModel` with `.capabilities.languages / .supports_streaming`, `.run(pcm, language)`, `.open_stream(language) -> AsrStream(.feed -> StreamText, .finalize -> str, .close)`, `.unload()`; `NativeError`.
- Produces: `NativeAsrBackend` (`NAME = "native_asr"`, `STREAMING = False`) and `NativeAsrStreamBackend` (`NAME = "native_asr_stream"`, `STREAMING = True`) with the unchanged contract `load(model_ref, device, compute_type, config=None)`, `transcribe(samples, language) -> AsrResult`, `unload()`, `is_loaded`, `open_stream(language=None) -> _NativeStream(feed/drain/end/abort)`. `asr_engine.py` needs no change for these (it only uses that contract).

- [ ] **Step 1: Failing tests** — create `sidecar/tests/test_asr_backend.py` as a port of every test in `test_transcribe_backend.py` against a `sokuji_native` fake:

```python
"""NativeAsrBackend / NativeAsrStreamBackend: sokuji_native faked at the module level;
real-model smoke behind SOKUJI_RUN_NATIVE_ASR=1 (cached SenseVoice Q8_0 GGUF)."""
import os
import sys
import types

import numpy as np
import pytest

from sokuji_sidecar import native
from sokuji_sidecar.backends import BackendLoadError, make_backend


class _FakeStreamText:
    def __init__(self, committed, tentative=""):
        self.committed, self.tentative = committed, tentative


class _FakeStream:
    """Scripted committed-text progression + finalize behaviour."""
    def __init__(self, log, language):
        self._log, self.language = log, language
        self._committed = ""
        self.closed = False
        self.finalized = False

    def feed(self, pcm):
        self._log.append(("feed", len(pcm)))
        return _FakeStreamText(self._committed)

    def set_committed(self, text):
        self._committed = text

    def finalize(self):
        self._log.append(("finalize",))
        self.finalized = True
        self.closed = True
        return self._committed + " FINAL"

    def close(self):
        self._log.append(("close",))
        self.closed = True


class _FakeModel:
    def __init__(self, path, device, languages=(), supports_streaming=False):
        self.path, self.device = path, device
        self.capabilities = types.SimpleNamespace(languages=languages, supports_streaming=supports_streaming,
                                                  supports_language_detect=True, native_sample_rate=16000, arch="fake")
        self.log = []
        self.streams = []
        self.unloaded = False

    def run(self, pcm, language=None, on_poll=None):
        self.log.append({"n": len(pcm), "language": language})
        return "  hello world  "

    def open_stream(self, language=None):
        st = _FakeStream(self.log, language)
        self.streams.append(st)
        return st

    def unload(self):
        self.unloaded = True


class _Dev:
    def __init__(self, index, kind):
        self.index, self.kind, self.name, self.description = index, kind, f"{kind}{index}", kind
        self.mem_total = self.mem_free = 0


@pytest.fixture
def fake_native(monkeypatch, tmp_path):
    """sys.modules['sokuji_native'] fake + hf_hub_download → a dummy gguf path."""
    created = {}
    opts = {"languages": (), "supports_streaming": False}
    mod = types.ModuleType("sokuji_native")
    mod.NativeError = type("NativeError", (RuntimeError,), {"status": -6})
    mod.init = lambda n_threads=0, log=None: None
    mod.devices = lambda: [_Dev(0, "vulkan"), _Dev(1, "cpu")]
    mod.device_free_mem = lambda i: 0

    def _load(path, device=None):
        m = _FakeModel(path, device, **opts)
        created["model"] = m
        return m
    mod.asr_load = _load
    monkeypatch.setitem(sys.modules, "sokuji_native", mod)
    native.reset_for_tests()
    gguf = tmp_path / "x.gguf"
    gguf.write_bytes(b"GGUF")
    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", lambda repo, fname, **kw: str(gguf))
    created["opts"] = opts
    created["mod"] = mod
    return created


REF = "handy-computer/SenseVoiceSmall-gguf/SenseVoiceSmall-Q8_0.gguf"


def test_load_maps_device_to_native_device(fake_native):
    b = make_backend("native_asr")
    b.load(REF, "vulkan", "q8_0")
    assert b.is_loaded
    assert fake_native["model"].device.kind == "vulkan"
    b.load(REF, "cpu", "q8_0")
    assert fake_native["model"].device.kind == "cpu"


def test_unknown_device_kind_is_backend_error(fake_native):
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError):
        b.load(REF, "metal", "q8_0")         # no metal device in this process


def test_transcribe_passes_language_and_strips(fake_native):
    b = make_backend("native_asr")
    b.load(REF, "cpu", "q8_0")
    r = b.transcribe(np.zeros(16000, np.float32), "zh")
    assert r.text == "hello world" and r.language == "zh"
    assert fake_native["model"].log[0]["language"] == "zh"
    b.transcribe(np.zeros(160, np.float32), "")
    assert fake_native["model"].log[1]["language"] is None      # empty → autodetect


def test_transcribe_before_load_raises_backend_error():
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError):
        b.transcribe(np.zeros(1600, np.float32), "en")


def test_empty_audio_short_circuits(fake_native):
    b = make_backend("native_asr")
    b.load(REF, "cpu", "q8_0")
    assert b.transcribe(np.zeros(0, np.float32), "en").text == ""
    assert fake_native["model"].log == []


def test_unload_unloads_model(fake_native):
    b = make_backend("native_asr")
    b.load(REF, "cpu", "q8_0")
    m = fake_native["model"]
    b.unload()
    assert not b.is_loaded and m.unloaded


def test_bad_artifact_raises(fake_native):
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError):
        b.load("just-a-repo-id", "cpu", "q8_0")


def test_missing_gguf_raises(fake_native, monkeypatch):
    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError("not cached")))
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError):
        b.load(REF, "cpu", "q8_0")


def test_native_error_becomes_backend_error(fake_native):
    mod = fake_native["mod"]
    def _boom(path, device=None):
        raise mod.NativeError("sk_asr_load: out of memory")
    mod.asr_load = _boom
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError) as e:
        b.load(REF, "vulkan", "q8_0")
    assert "out of memory" in e.value.reason           # accel's OOM fallback keys on this substring


def test_missing_wheel_is_backend_error(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "sokuji_native", None)
    native.reset_for_tests()
    b = make_backend("native_asr")
    with pytest.raises(BackendLoadError):
        b.load(REF, "cpu", "q8_0")


@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_NATIVE_ASR"),
                    reason="set SOKUJI_RUN_NATIVE_ASR=1 (needs the sokuji-native wheel + cached GGUF)")
def test_real_sensevoice_smoke():
    import wave
    from huggingface_hub import snapshot_download
    native.reset_for_tests()
    b = make_backend("native_asr")
    b.load(REF, "cpu", "q8_0")
    d = snapshot_download("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    w = wave.open(f"{d}/test_wavs/en.wav", "rb")
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    r = b.transcribe(audio, "en")
    assert "tribal" in r.text.lower()
    b.unload()


# ── streaming variant (native_asr_stream) ───────────────────────────────────


def _load_stream_backend(fake):
    fake["opts"]["supports_streaming"] = True
    b = make_backend("native_asr_stream")
    b.load("handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf/Voxtral-Mini-4B-Realtime-2602-Q4_K_M.gguf",
           "vulkan", "q4_k_m")
    return b


def test_stream_backend_flag_and_open(fake_native):
    b = _load_stream_backend(fake_native)
    assert b.STREAMING is True and b.is_loaded
    assert b.open_stream() is not None


def test_open_stream_passes_language(fake_native):
    b = _load_stream_backend(fake_native)
    model = fake_native["model"]
    b.open_stream("ja")
    assert model.streams[-1].language == "ja"
    b.open_stream("")
    assert model.streams[-1].language is None
    b.open_stream()
    assert model.streams[-1].language is None


def test_stream_language_mapped_to_model_tag_set(fake_native):
    fake_native["opts"]["languages"] = ("en-US", "zh-CN", "ja-JP")     # nemotron shape
    b = _load_stream_backend(fake_native)
    model = fake_native["model"]
    b.open_stream("zh")
    assert model.streams[-1].language == "zh-CN"
    b.open_stream("ko")
    assert model.streams[-1].language is None                          # unknown → autodetect
    model.capabilities.languages = ("en", "zh", "ja")                  # whisper/voxtral shape
    b.open_stream("zh")
    assert model.streams[-1].language == "zh"


def test_batch_language_mapped_to_model_tag_set(fake_native):
    fake_native["opts"]["languages"] = ("en-US", "zh-CN")
    b = _load_stream_backend(fake_native)
    b.transcribe(np.zeros(1600, np.float32), "zh")
    assert fake_native["model"].log[-1]["language"] == "zh-CN"


def test_stream_drain_emits_committed_deltas_only(fake_native):
    b = _load_stream_backend(fake_native)
    st = b.open_stream()
    raw = fake_native["model"].streams[-1]
    st.feed(np.zeros(1600, np.float32))
    assert st.drain() == []
    raw.set_committed("The tribal")
    st.feed(np.zeros(1600, np.float32))          # the view refreshes on feed
    assert st.drain() == ["The tribal"]
    raw.set_committed("The tribal chief called")
    st.feed(np.zeros(1600, np.float32))
    assert st.drain() == [" chief called"]
    assert st.drain() == []


def test_stream_end_finalizes_and_returns_full_text(fake_native):
    b = _load_stream_backend(fake_native)
    st = b.open_stream()
    raw = fake_native["model"].streams[-1]
    raw.set_committed("hello world")
    assert st.end() == "hello world FINAL"
    assert raw.closed


def test_stream_reopen_after_end_uses_same_model(fake_native):
    b = _load_stream_backend(fake_native)
    st = b.open_stream()
    st.end()
    assert b.open_stream() is not None
    assert len(fake_native["model"].streams) == 2


def test_stream_abort_closes_without_finalize(fake_native):
    b = _load_stream_backend(fake_native)
    st = b.open_stream()
    raw = fake_native["model"].streams[-1]
    st.abort()
    assert raw.closed and not raw.finalized


def test_stream_backend_rejects_non_streaming_model(fake_native):
    fake_native["opts"]["supports_streaming"] = False
    b = make_backend("native_asr_stream")
    with pytest.raises(BackendLoadError):
        b.load("handy-computer/x-gguf/x.gguf", "cpu", "q4_k_m")
    assert not b.is_loaded
```

Run: `pytest sidecar/tests/test_asr_backend.py -q` → `BackendLoadError: unknown backend: native_asr` on every test.

- [ ] **Step 2: `asr_backend.py`**:

```python
"""Native ASR backends (spec §5.3): the two classes that used to wrap the transcribe_cpp
PyPI binding now wrap sokuji_native's AsrModel — same load()/transcribe()/unload()
contract, same stream adapter contract (feed/drain/end/abort), same language mapping.

model_ref is an upstream artifact path "org/repo/file.gguf"; the file must already be in
the HF cache (the manager downloads it first). Batch mode: one AsrModel.run() per VAD
segment. The streaming variant adapts AsrStream's committed/tentative view to asr_engine's
stream contract: drain() emits committed-prefix DELTAS only (tentative text can be revised,
so it never enters the append-only partial), and end() finalizes + returns the whole
utterance's committed text."""
import numpy as np

from . import native
from .backends import AsrResult, BackendLoadError, register_backend
from .catalog import split_artifact

# Plan device -> sokuji_native device kind. (cuda/dml tiers never existed for ASR.)
_DEVICE_KIND = {"cpu": "cpu", "vulkan": "vulkan", "metal": "metal"}


@register_backend
class NativeAsrBackend:
    """sokuji_native AsrModel wrapper (batch). The model family is auto-detected from the
    GGUF; language is passed as a hint when set."""
    NAME = "native_asr"
    STREAMING = False

    def __init__(self):
        self._model = None

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self.unload()
        try:
            from huggingface_hub import hf_hub_download
            repo, fname = split_artifact(model_ref)
            if not fname:
                raise BackendLoadError(f"native_asr needs an 'org/repo/file.gguf' artifact, got {model_ref!r}")
            path = hf_hub_download(repo, fname, local_files_only=True)
            kind = _DEVICE_KIND.get(device)
            if kind is None:
                raise BackendLoadError(f"unknown device for native_asr: {device!r}")
            self._model = native.module().asr_load(path, native.device_for(kind))
        except BackendLoadError:
            self.unload()
            raise
        except Exception as e:  # missing wheel/gguf, no vulkan device, NativeError → resolver falls back
            self.unload()
            raise BackendLoadError(str(e))

    def _match_language(self, language):
        """Map the app's language code onto the tag set the LOADED model publishes
        (capabilities.languages). Families disagree: whisper / voxtral / sense-voice list
        bare ISO codes ('zh'), nemotron lists full locales ('zh-CN') and HARD-REJECTS
        anything else. Exact match first, then primary-subtag match ('zh' → 'zh-CN'); a
        tag the model doesn't know becomes None so the run degrades to autodetect instead
        of failing (every catalog card reports supports_language_detect)."""
        if not language:
            return None
        caps = getattr(self._model, "capabilities", None)
        tags = tuple(getattr(caps, "languages", ()) or ())
        if not tags:
            return language                # model publishes no list — pass through
        want = language.lower().replace("_", "-")
        for t in tags:
            if t.lower() == want:
                return t
        primary = want.split("-")[0]
        for t in tags:
            if t.lower().split("-")[0] == primary:
                return t
        return None

    def transcribe(self, samples, language) -> AsrResult:
        if self._model is None:
            raise BackendLoadError("native_asr not loaded")
        pcm = np.ascontiguousarray(np.asarray(samples, dtype=np.float32).reshape(-1))
        if pcm.size == 0:
            return AsrResult("", language)
        try:
            text = self._model.run(pcm, self._match_language(language))
        except Exception as e:
            raise BackendLoadError(str(e))
        return AsrResult((text or "").strip(), language)

    def unload(self) -> None:
        model, self._model = self._model, None
        if model is not None:
            try:
                model.unload()
            except Exception:
                pass

    @property
    def is_loaded(self) -> bool:
        return self._model is not None


class _NativeStream:
    """asr_engine stream adapter over one sokuji_native AsrStream. Lifecycle: the engine
    opens at speech start, feed()s audio, drain()s partial deltas, end()s at the VAD
    endpoint (or abort()s on teardown). The committed view refreshes on every feed(); drain()
    diffs it against what it already emitted (Ruling I)."""

    def __init__(self, model, language=None):
        self._raw = model.open_stream(language or None)
        self._committed = ""
        self._emitted = 0        # chars of committed text already drained
        self._done = False

    def feed(self, samples_f32_16k) -> None:
        pcm = np.ascontiguousarray(np.asarray(samples_f32_16k, dtype=np.float32).reshape(-1))
        if pcm.size and not self._done:
            self._committed = self._raw.feed(pcm).committed or ""

    def drain(self) -> list:
        if len(self._committed) > self._emitted:
            delta = self._committed[self._emitted:]
            self._emitted = len(self._committed)
            return [delta]
        return []

    def end(self) -> str:
        """Finalize and return the WHOLE utterance's committed text (the engine replaces
        the accumulated partial with this)."""
        if self._done:
            return self._committed.strip()
        try:
            final = self._raw.finalize() or ""
        finally:
            self._close()
        return final.strip()

    def abort(self) -> None:
        self._close()

    def _close(self) -> None:
        if self._done:
            return
        self._done = True
        try:
            self._raw.close()
        except Exception:
            pass


@register_backend
class NativeAsrStreamBackend(NativeAsrBackend):
    """Streaming twin for GGUFs whose runtime reports supports_streaming (Voxtral Realtime,
    Moonshine Streaming, Parakeet streaming, Nemotron streaming). Registered under its own
    NAME so the catalog row selects it and asr_engine's class-flag pre-check routes it to
    the streaming loop."""
    NAME = "native_asr_stream"
    STREAMING = True

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        super().load(model_ref, device, compute_type, config)
        caps = getattr(self._model, "capabilities", None)
        if not (caps and getattr(caps, "supports_streaming", False)):
            self.unload()
            raise BackendLoadError(f"{model_ref} does not support streaming")

    def open_stream(self, language=None) -> _NativeStream:
        """`language` is the user's source-language hint — same contract as the batch
        path; None/empty = autodetect. Mapped onto the model's own tag set first."""
        if self._model is None:
            raise BackendLoadError("native_asr_stream not loaded")
        try:
            return _NativeStream(self._model, self._match_language(language))
        except BackendLoadError:
            raise
        except Exception as e:
            raise BackendLoadError(str(e))
```

- [ ] **Step 3: `backends.py`** — the bottom import becomes `from . import asr_backend  # noqa: E402,F401` with the comment reworded ("so the native ASR backends self-register"). Delete `sidecar/sokuji_sidecar/transcribe_backend.py` and `sidecar/tests/test_transcribe_backend.py` (`git rm`).

- [ ] **Step 4: Run** — `pytest sidecar/tests/test_asr_backend.py -q`: 21 passed, 1 skipped. `pytest sidecar/tests -q -x --deselect` nothing: expect the catalog/planner/characterization name assertions to fail until Task 9 — record their count in the task report.

- [ ] **Step 5: Commit** — `sidecar/sokuji_sidecar/asr_backend.py sidecar/sokuji_sidecar/backends.py sidecar/tests/test_asr_backend.py` plus the two deletions, message `feat(sidecar): asr_backend.py over sokuji_native replaces transcribe_backend.py`.

---

### Task 8: `vad.py` — `NativeVad` behind the engine's VAD protocol; sherpa's VAD leaves `asr_engine.py`

**Files:**
- Create: `sidecar/sokuji_sidecar/vad.py`, `sidecar/tests/test_vad.py`
- Modify: `sidecar/sokuji_sidecar/asr_engine.py` (`_init_vad`, delete `VAD_URL` / `_resolve_vad_model`), `sidecar/prefetch_models.py` (delete the VAD block)

**Interfaces:**
- Consumes: `native.module().vad_open(threshold=, min_speech_ms=, min_silence_ms=, max_speech_s=)` → `Vad(feed(pcm512) -> VadEvent|None, finalize() -> VadEvent|None, reset(), close())`.
- Produces `sokuji_sidecar.vad.NativeVad` — the duck-typed protocol `asr_engine.py` already codes against (nothing in the engine's VAD loops changes):
  ```python
  class NativeVad:
      window: int = 512
      def __init__(self, *, threshold=0.5, min_silence_s=0.5, min_speech_s=0.25, max_speech_s=20.0)
      def accept_waveform(self, window512: np.ndarray) -> None   # one 512-sample window
      def is_speech_detected(self) -> bool                       # state after the last window
      def empty(self) -> bool                                    # finished-segment queue
      @property front(self)   -> Segment(samples: np.ndarray, start: int)
      def pop(self) -> None
      def flush(self) -> None                                    # end of audio: closes an open segment, resets
      def reset(self) -> None
      def close(self) -> None
  ```
  `Segment` is a small dataclass. `samples` is the audio of the finished segment (`[seg_start, seg_end)` of everything fed since `reset`), so the engine's `_drain()` keeps working unchanged (`seg.samples`, `seg.start`).

- [ ] **Step 1: Failing tests** — `sidecar/tests/test_vad.py`:

```python
"""NativeVad: the engine's VAD protocol (is_speech_detected / accept_waveform / empty /
front / pop / flush) over sokuji_native.vad_open. The native Vad is scripted."""
import sys
import types

import numpy as np
import pytest

from sokuji_sidecar import native


class _Ev:
    def __init__(self, kind, sample=0, seg_start=0, seg_end=0):
        self.kind, self.sample, self.probability, self.seg_start, self.seg_end = kind, sample, 0.9, seg_start, seg_end


class _ScriptedVad:
    """feed() returns the scripted event for the k-th window, else None."""
    def __init__(self, script, opened):
        self.script, self.k, self.opened = dict(script), 0, opened
        self.tail = None
        self.resets = 0
        self.closed = False

    def feed(self, pcm512):
        assert len(pcm512) == 512
        ev = self.script.get(self.k)
        self.k += 1
        return ev

    def finalize(self):
        self.k = 0
        return self.tail

    def reset(self):
        self.resets += 1
        self.k = 0

    def close(self):
        self.closed = True


@pytest.fixture
def scripted(monkeypatch):
    holder = {}
    mod = types.ModuleType("sokuji_native")
    mod.init = lambda n_threads=0, log=None: None
    mod.devices = lambda: []

    def _open(**kw):
        v = _ScriptedVad(holder.get("script", {}), kw)
        v.tail = holder.get("tail")
        holder["vad"] = v
        return v
    mod.vad_open = _open
    monkeypatch.setitem(sys.modules, "sokuji_native", mod)
    native.reset_for_tests()
    return holder


def _windows(n):
    return [np.full(512, i / 100.0, np.float32) for i in range(n)]


def test_options_are_passed_in_milliseconds(scripted):
    from sokuji_sidecar.vad import NativeVad
    NativeVad(threshold=0.6, min_silence_s=0.5, min_speech_s=0.25, max_speech_s=20.0)
    assert scripted["vad"].opened == {"threshold": 0.6, "min_speech_ms": 250, "min_silence_ms": 500, "max_speech_s": 20.0}


def test_edges_and_segment_queue(scripted):
    from sokuji_sidecar.vad import NativeVad
    # window 1 starts speech at (padded) sample 400; window 4 ends it: segment [400, 2048)
    scripted["script"] = {1: _Ev("start", sample=400), 4: _Ev("end", sample=2048, seg_start=400, seg_end=2048)}
    v = NativeVad()
    assert v.window == 512 and v.empty() and not v.is_speech_detected()
    seen = []
    for w in _windows(6):
        was = v.is_speech_detected()
        v.accept_waveform(w)
        seen.append((was, v.is_speech_detected()))
    assert seen[1] == (False, True)                 # rising edge on window 1
    assert seen[4] == (True, False)                 # falling edge on window 4
    assert not v.empty()
    seg = v.front
    assert seg.start == 400 and len(seg.samples) == 2048 - 400
    assert seg.samples[0] == pytest.approx(0.0)     # window 0 was value 0.00 → sample 400 is in window 0
    assert seg.samples[-1] == pytest.approx(0.03)   # sample 2047 lies in window 3 (value 0.03)
    v.pop()
    assert v.empty()


def test_flush_closes_open_segment_and_resets(scripted):
    from sokuji_sidecar.vad import NativeVad
    scripted["script"] = {0: _Ev("start", sample=0)}
    scripted["tail"] = _Ev("end", sample=1024, seg_start=0, seg_end=1024)
    v = NativeVad()
    for w in _windows(2):
        v.accept_waveform(w)
    assert v.is_speech_detected() and v.empty()
    v.flush()
    assert not v.is_speech_detected()
    assert not v.empty() and v.front.start == 0 and len(v.front.samples) == 1024
    v.pop()
    v.flush()                                       # nothing open: no segment, no error
    assert v.empty()


def test_reset_and_close(scripted):
    from sokuji_sidecar.vad import NativeVad
    scripted["script"] = {0: _Ev("start", sample=0)}
    v = NativeVad()
    v.accept_waveform(_windows(1)[0])
    v.reset()
    assert not v.is_speech_detected() and v.empty() and scripted["vad"].resets == 1
    v.close()
    assert scripted["vad"].closed
    v.close()                                       # idempotent


def test_wrong_window_size_rejected(scripted):
    from sokuji_sidecar.vad import NativeVad
    v = NativeVad()
    with pytest.raises(ValueError):
        v.accept_waveform(np.zeros(100, np.float32))
```

Run: `pytest sidecar/tests/test_vad.py -q` → `ModuleNotFoundError: sokuji_sidecar.vad`.

- [ ] **Step 2: `vad.py`**:

```python
"""Voice activity detection for the ASR stage (spec §5.1: VAD is an ASR-side capability
implemented by audio.cpp). NativeVad wraps one sokuji_native.Vad behind the protocol
asr_engine.py has always driven — sherpa-onnx's VoiceActivityDetector shape:
is_speech_detected() / accept_waveform(window) / empty() / front / pop() / flush() — so
the engine's edge detection, pre-roll and 20 s cap did not have to move."""
from dataclasses import dataclass

import numpy as np

from . import native

WINDOW = 512          # samples per accept_waveform call, 16 kHz


@dataclass
class Segment:
    samples: np.ndarray   # the finished segment's audio, [start, end) of everything fed since reset
    start: int            # first sample index (relative to the reset point)


class NativeVad:
    window = WINDOW

    def __init__(self, *, threshold=0.5, min_silence_s=0.5, min_speech_s=0.25, max_speech_s=20.0):
        # sherpa defaults: threshold 0.5, min_silence 0.5 s, min_speech 0.25 s, max_speech 20 s.
        self._vad = native.module().vad_open(threshold=float(threshold),
                                             min_speech_ms=int(round(min_speech_s * 1000)),
                                             min_silence_ms=int(round(min_silence_s * 1000)),
                                             max_speech_s=float(max_speech_s))
        self._speech = False
        self._queue: list[Segment] = []
        self._audio: list[np.ndarray] = []   # every window since reset, for segment extraction
        self._fed = 0

    # ── the protocol ────────────────────────────────────────────────────────
    def is_speech_detected(self) -> bool:
        return self._speech

    def accept_waveform(self, window) -> None:
        pcm = np.ascontiguousarray(np.asarray(window, dtype=np.float32).reshape(-1))
        if pcm.size != WINDOW:
            raise ValueError(f"NativeVad.accept_waveform: {WINDOW} samples per window, got {pcm.size}")
        self._audio.append(pcm)
        self._fed += WINDOW
        self._apply(self._vad.feed(pcm))

    def empty(self) -> bool:
        return not self._queue

    @property
    def front(self) -> Segment:
        return self._queue[0]

    def pop(self) -> None:
        self._queue.pop(0)

    def flush(self) -> None:
        """End of audio: close an open segment (the native side reports it as END) and
        return to the idle state. Queued segments stay until popped."""
        self._apply(self._vad.finalize())
        self._speech = False
        self._audio.clear()
        self._fed = 0

    def reset(self) -> None:
        self._vad.reset()
        self._speech = False
        self._queue.clear()
        self._audio.clear()
        self._fed = 0

    def close(self) -> None:
        vad, self._vad = self._vad, None
        if vad is not None:
            vad.close()

    # ── event → state ──────────────────────────────────────────────────────
    def _apply(self, ev) -> None:
        if ev is None:
            return
        if ev.kind == "start":
            self._speech = True
        elif ev.kind == "end":
            self._speech = False
            self._queue.append(Segment(self._slice(ev.seg_start, ev.seg_end), int(ev.seg_start)))

    def _slice(self, start: int, end: int) -> np.ndarray:
        """The audio of [start, end) in absolute samples-since-reset. Audio before `end` is
        dropped afterwards (native segments never overlap, so no later segment needs it);
        `self._fed` counts every sample since reset, which makes the buffer's absolute
        origin exact after any number of trims."""
        buf = np.concatenate(self._audio) if self._audio else np.zeros(0, np.float32)
        origin = self._fed - buf.size                     # absolute index of buf[0]
        lo = max(0, min(int(start) - origin, buf.size))
        hi = max(lo, min(int(end) - origin, buf.size))
        out = buf[lo:hi].copy()
        keep = buf[hi:]
        self._audio = [keep] if keep.size else []
        return out
```

- [ ] **Step 3: Run** — `pytest sidecar/tests/test_vad.py -q`: 5 passed. (In `test_edges_and_segment_queue` the expected sample values follow from windows of constant value `i/100`.)

- [ ] **Step 4: `asr_engine.py`** — replace `_init_vad` (lines 78-92) with:

```python
    def _init_vad(self, sample_rate, vad_threshold, vad_min_silence, vad_min_speech):
        from .vad import NativeVad    # lazy: the native library is loaded here
        self._src_rate = int(sample_rate)
        kw = {}
        if vad_threshold is not None:
            kw["threshold"] = float(vad_threshold)
        if vad_min_silence is not None:
            kw["min_silence_s"] = float(vad_min_silence)
        if vad_min_speech is not None:
            kw["min_speech_s"] = float(vad_min_speech)
        if self._vad is not None:
            try:
                self._vad.close()
            except Exception:
                pass
        self._vad = NativeVad(**kw)
        self._window = self._vad.window
        self._buf = np.zeros(0, np.float32)
```

Delete `VAD_URL` (lines 14-19's env/URL constant and its comment) and `_resolve_vad_model` (lines 38-53) and the `import urllib.request`/`os` uses they alone needed (keep `os` if still used elsewhere in the file — check with grep). In `close()`, after the backend is unloaded, add: `if self._vad is not None: (close it, best effort); self._vad = None` — the VAD holds a native handle now, and `init()` may be called many times per process.

Update the class docstring line that names silero's 300-600 ms lag (keep — still true) and the module docstring's mention of sherpa (replace with "audio.cpp silero via sokuji_native").

- [ ] **Step 5: `prefetch_models.py`** — delete the `VAD_URL` constant and comment (lines 22-27) and the "ASR VAD" download block (lines 62-73); the summary text at the end of the script that mentions VAD, if any, goes too.

- [ ] **Step 6: Engine tests** — `pytest sidecar/tests/test_asr_engine.py -q`: unchanged tests must stay green (they fake at the `_vad` / `_vad_state` / `_vad_events` seams). One string changes in this file in Task 9.

- [ ] **Step 7: The VAD ≤ 1-frame gate (env-gated, dev box)** — append to `sidecar/tests/test_vad.py`:

```python
@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_VAD_COMPARE"),
                    reason="set SOKUJI_RUN_VAD_COMPARE=1 (needs sokuji-native + sherpa-onnx + silero_vad.onnx)")
def test_native_vad_matches_sherpa_within_one_frame():
    """Spec §9.4 / §10 row 2: same recording through sherpa-silero and NativeVad; every
    speech-start and speech-end edge within one 512-sample frame (32 ms)."""
    import wave
    import sherpa_onnx
    native.reset_for_tests()
    from sokuji_sidecar.vad import NativeVad
    path = os.environ.get("SOKUJI_VAD_COMPARE_WAV") or os.path.join(
        os.path.dirname(__file__), "..", "..", "native", "build", "cpu", "_deps", "transcribe-src", "samples", "jfk.wav")
    with wave.open(path, "rb") as w:
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    cfg = sherpa_onnx.VadModelConfig()
    cfg.silero_vad.model = os.environ["SOKUJI_VAD_FILE"]          # the sherpa silero_vad.onnx
    cfg.sample_rate = 16000
    ref = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=30)
    ours = NativeVad()
    ref_edges, our_edges = [], []
    for k in range(len(pcm) // 512):
        w = pcm[k * 512:(k + 1) * 512]
        a = ref.is_speech_detected(); ref.accept_waveform(w); b = ref.is_speech_detected()
        if a != b: ref_edges.append((k, b))
        c = ours.is_speech_detected(); ours.accept_waveform(w); d = ours.is_speech_detected()
        if c != d: our_edges.append((k, d))
    assert len(ref_edges) == len(our_edges), (ref_edges, our_edges)
    for (k1, up1), (k2, up2) in zip(ref_edges, our_edges):
        assert up1 == up2 and abs(k1 - k2) <= 1, (ref_edges, our_edges)
```

(`import os` at the top of the file.) Run on the GB10 with the main checkout's venv (it still has sherpa-onnx) plus the sokuji-native wheel installed into it: `pip install native/python/dist/*.whl`, `SOKUJI_RUN_VAD_COMPARE=1 SOKUJI_VAD_FILE=~/.cache/huggingface/sokuji-vad/silero_vad.onnx pytest sidecar/tests/test_vad.py -q`. If an edge differs by more than one frame, the differences are in the option mapping (sherpa's `min_silence_duration` vs audio.cpp's `min_silence_duration_ms`, `speech_pad_ms`); report the measured offsets in the task report — this gate is a measurement the PR records, and a systematic 1-frame skew on one edge type is acceptable (spec: "within one frame").

- [ ] **Step 8: Commit** — `sidecar/sokuji_sidecar/vad.py sidecar/sokuji_sidecar/asr_engine.py sidecar/prefetch_models.py sidecar/tests/test_vad.py`, message `feat(sidecar): NativeVad over sokuji_native replaces sherpa-onnx VAD in asr_engine`.

---

### Task 9: names, requirements, the import gate

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (backend strings + `Deployment.backend` comment), `sidecar/sokuji_sidecar/planner.py` (comments naming transcribe.cpp), `sidecar/tests/test_catalog.py`, `test_planner.py`, `test_platform_filter.py`, `test_characterization.py`, `test_asr_engine.py:634`, `test_torch_free_gate.py`, `sidecar/requirements.txt`, `sidecar/setup.sh`

- [ ] **Step 1: Catalog** — in `catalog.py`: `_tc_row(... backend="transcribe_cpp" ...)` default → `backend="native_asr"`; the seven explicit `backend="transcribe_cpp_stream"` → `backend="native_asr_stream"`; the `Deployment.backend` docstring/comment (line 18) lists `"native_asr"` / `"native_asr_stream"` instead. `_tc_row` keeps its name (it describes the GGUF ladder shape, and 67 call sites would churn for nothing — the rename belongs to slice 5's cleanup if at all).

- [ ] **Step 2: Tests, by text substitution in this order** (the second string is a prefix of the first):
  1. `transcribe_cpp_stream` → `native_asr_stream`
  2. `transcribe_cpp` → `native_asr`
  in `sidecar/tests/test_catalog.py`, `test_planner.py`, `test_platform_filter.py`, `test_characterization.py`, `test_asr_engine.py`, and `sidecar/tests/test_accel.py` (any remaining occurrence). Then re-read `test_catalog.py` lines 9 and 35: the `startswith("transcribe_cpp")` assertion becomes `d.backend in ("native_asr", "native_asr_stream")`, and its test name `test_every_asr_row_is_transcribe_cpp_gguf` → `test_every_asr_row_is_native_asr_gguf`. Ruling L: the characterization file is only renamed, not re-recorded — confirm by running it.

- [ ] **Step 3: Gate** — `sidecar/tests/test_torch_free_gate.py`: add `"transcribe_cpp"` to `BANNED` with the comment `# gone in slice 2: ASR runs through sokuji_native (sherpa_onnx follows in slice 4, onnxruntime in slice 5)`.

- [ ] **Step 4: Requirements** — `sidecar/requirements.txt`: delete the `transcribe-cpp==0.2.2` line and its nine-line comment; in its place:

```
# ASR + VAD (and, from slices 3-4, translation + TTS) run in-process through the
# sokuji-native wheel built from native/ (one ggml, one C ABI). It is not on PyPI and has
# no published release yet, so setup.sh installs it from native/python/dist/ (built by
# native/ci/build.sh) or from $SOKUJI_NATIVE_WHEEL; the pinned per-platform URLs from the
# design (spec §4.6) replace that once a native-vX.Y.Z release exists.
```

`sidecar/setup.sh`: after the `pip install -r requirements.txt` step add:

```bash
# sokuji-native: local wheel until a release exists (spec §4.6). Build it with
#   native/ci/build.sh none <plat>     (CPU)   or   native/ci/build.sh vulkan <plat>
# or point SOKUJI_NATIVE_WHEEL at a wheel file / URL.
NATIVE_WHEEL="${SOKUJI_NATIVE_WHEEL:-}"
if [ -z "$NATIVE_WHEEL" ]; then
    NATIVE_WHEEL="$(ls "$(dirname "$0")"/../native/python/dist/sokuji_native-*.whl 2>/dev/null | head -1 || true)"
fi
if [ -n "$NATIVE_WHEEL" ]; then
    echo "[setup] stage runtimes: sokuji-native ($NATIVE_WHEEL)"
    "$PY" -m pip install -q --force-reinstall "$NATIVE_WHEEL"
else
    echo "[setup] WARNING: no sokuji-native wheel found; ASR/VAD will not be available (see native/README.md)" >&2
fi
```

Keep the `sherpa-onnx` install line (Ruling C) but change its comment from "TTS (piper) + VAD" wording to TTS only. Update the ASR line of the runtime summary comment block (lines 38-45) to say `sokuji-native`.

- [ ] **Step 5: Planner comments** — `planner.py` `_tier_available` comments say "transcribe.cpp's own probe is authoritative" etc.; reword to "the native library's device probe" (comments only; the logic reads `machine.tc_kinds` as before — Ruling A).

- [ ] **Step 6: Full sidecar suite** — `/home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest sidecar/tests -q`. Expected: only the 4 baseline failures remain (pyopenjtalk ×3, the bundles-workflow assertion). If `test_sku_requirements.py` or `test_characterization.py` fails, read the assertion — do not edit snapshots by hand beyond the name substitution.

- [ ] **Step 7: Commit** — the listed files, message `refactor(sidecar): ASR backends are native_asr / native_asr_stream; transcribe-cpp leaves requirements`.

---

### Task 10: bench, the three gates, docs, CI dry run

**Files:**
- Create: `sidecar/bench/native_bench.py`, `sidecar/bench/README.md`
- Modify: `native/README.md` (ASR/VAD section), `.github/workflows/native-build.yml` (temporary branch trigger — Ruling M), the memory file (outside the repo, by the controller)

**Interfaces:**
- Consumes: `sokuji_sidecar.native`, `sokuji_native.asr_load/AsrModel.run/open_stream`.
- Produces: `python -m sidecar.bench.native_bench --model <org/repo/file.gguf | path> [--device cpu|vulkan|metal] [--wav PATH] [--runs 3] [--stream] [--chunk-ms 500]` printing `model, device, arch, clip_s, warmup_s, rtf_median, rtf_runs, transcript_head`.

- [ ] **Step 1: The bench** — `sidecar/bench/native_bench.py`:

```python
"""RTF bench for the native ASR path (spec §9.6): warm-up, N timed runs, median RTF, the
transcript's head. Compare against the numbers recorded in the design (§2: Parakeet-v3
0.064 CPU / 0.005 Vulkan; whisper-large-v3-turbo 0.346 / 0.013; Cohere 0.190 / 0.009 on the
GB10, 58 s clip, Q8_0) and against a new upstream pin before bumping it.

    python -m sidecar.bench.native_bench --model handy-computer/whisper-tiny-gguf/whisper-tiny-Q8_0.gguf \
        --wav native/build/cpu/_deps/transcribe-src/samples/jfk.wav --device cpu
    python -m sidecar.bench.native_bench --model handy-computer/moonshine-streaming-tiny-gguf/moonshine-streaming-tiny-Q8_0.gguf \
        --wav <clip>.wav --stream --chunk-ms 500

`--model` is an HF artifact "org/repo/file.gguf" (downloaded into the HF cache) or a path.
Vulkan figures need a Vulkan-lane wheel (the CI linux-arm64 artifact on the GB10).
"""
import argparse
import os
import statistics
import sys
import time
import wave

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))   # sokuji_sidecar importable from the repo
from sokuji_sidecar import native  # noqa: E402
from sokuji_sidecar.catalog import split_artifact  # noqa: E402


def read_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2, "16 kHz mono 16-bit WAV"
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def resolve_model(ref: str) -> str:
    if os.path.exists(ref):
        return ref
    from huggingface_hub import hf_hub_download
    repo, fname = split_artifact(ref)
    return hf_hub_download(repo, fname)


def run_once(model, pcm, stream: bool, chunk: int) -> tuple[float, str]:
    t0 = time.perf_counter()
    if stream:
        st = model.open_stream("en")
        for off in range(0, len(pcm), chunk):
            st.feed(pcm[off:off + chunk])
        text = st.finalize()
    else:
        text = model.run(pcm, "en")
    return time.perf_counter() - t0, text


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True)
    p.add_argument("--wav", required=True)
    p.add_argument("--device", default="cpu", choices=["cpu", "vulkan", "metal"])
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--stream", action="store_true")
    p.add_argument("--chunk-ms", type=int, default=500)
    a = p.parse_args(argv)

    pcm = read_wav(a.wav)
    clip_s = len(pcm) / 16000
    mod = native.module()
    model = mod.asr_load(resolve_model(a.model), native.device_for(a.device))
    caps = model.capabilities
    if a.stream and not caps.supports_streaming:
        print(f"{a.model}: no streaming support (arch={caps.arch})", file=sys.stderr)
        return 2
    chunk = a.chunk_ms * 16
    warm, _ = run_once(model, pcm, a.stream, chunk)              # cold: shader compile + graph build
    times, text = [], ""
    for _ in range(a.runs):
        t, text = run_once(model, pcm, a.stream, chunk)
        times.append(t)
    rtf = [t / clip_s for t in times]
    print(f"model={a.model} device={a.device} arch={caps.arch} mode={'stream' if a.stream else 'batch'}")
    print(f"clip_s={clip_s:.1f} warmup_s={warm:.2f} rtf_median={statistics.median(rtf):.4f} rtf_runs={[round(r, 4) for r in rtf]}")
    print(f"transcript_head={text[:120]!r}")
    model.unload()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

`sidecar/bench/README.md` (10 lines): what the script measures, the two example invocations above, and the table from spec §2 as the reference numbers. Add `sidecar/bench/__init__.py` (empty) so `python -m sidecar.bench.native_bench` resolves from the repo root.

- [ ] **Step 2: Run the RTF gate on the GB10** (CPU lane, local wheel installed into the sidecar venv: `/home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/pip install --force-reinstall native/python/dist/*.whl`):

```bash
V=/home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python
$V -m sidecar.bench.native_bench --model handy-computer/parakeet-tdt-0.6b-v3-gguf/parakeet-tdt-0.6b-v3-Q8_0.gguf --wav <58s clip> --device cpu
$V -m sidecar.bench.native_bench --model handy-computer/whisper-large-v3-turbo-gguf/whisper-large-v3-turbo-Q8_0.gguf --wav <58s clip> --device cpu
```

(The exact artifact names come from `catalog.py` rows `parakeet-tdt-0.6b-v3` and `whisper-large-v3-turbo`; the 58 s clip is whatever the §2 measurement used — if it is gone, `native/build/cpu/_deps/transcribe-src/samples/whole-earth.wav` (84 s) is the substitute, noted as such.) Record the numbers in the task report next to the §2 CPU column: "on par" means within ±15 % (same engine, same ggml version family). Vulkan numbers are taken from the CI linux-arm64 wheel installed on the GB10 after the dry run (Step 6).

- [ ] **Step 3: ASR loopback gate** — with the local wheel in the sidecar venv: `SOKUJI_RUN_NATIVE_ASR=1 $V -m pytest sidecar/tests/test_asr_backend.py -q -k real` (SenseVoice "tribal" smoke, Task 7) and `SOKUJI_RUN_ASR_MODEL=1 $V -m pytest sidecar/tests/test_asr_engine.py -q -k real` (the engine's own gated corpus test: VAD + ASR end to end through `feed()`/`flush()`). Both must pass; paste the transcripts into the task report.

- [ ] **Step 4: VAD gate** — Task 8 Step 7's `SOKUJI_RUN_VAD_COMPARE=1` run; paste the edge lists.

- [ ] **Step 5: Docs** — `native/README.md`: add a section "ASR and VAD (slice 2)" with: the four ASR entry points and the stream lifecycle in five lines; the VAD chunk contract (512 samples, 16 kHz, edge events, `finalize`); where the silero weights live (`_native/silero_vad_16k.safetensors`, `weights=NULL` resolves there); CTest env vars (`SK_TEST_ASR_GGUF`, `SK_TEST_ASR_STREAM_GGUF`, `SK_TEST_SAMPLE_WAV`) and the two `curl` lines; the Python classes. Update the Layout list with `src/sk_internal.h`, `src/sk_asr.cpp`, `src/sk_vad.cpp`, `tests/wav.h`. `CLAUDE.md` item 6 already points at `native/README.md`; add "; ASR + VAD go through `sokuji_sidecar/native.py` → `asr_backend.py` / `vad.py`" to it.

- [ ] **Step 6: CI dry run** — add to `native-build.yml` under `on.push`: `branches: ['refactor/sidecar-ggml-only-slice2']` with the same three-line "temporary" comment slice 1 used. Commit `chore(ci): temporary branch trigger for the slice-2 dry run`. **Stop here and ask jiangzhuo before pushing** (house rule). After the push: watch the run; the new CTest steps (`test_asr` with both models, `test_vad`) and the Python suites run on all five lanes; fix fallout as its own commits. When green: install the linux-arm64 artifact on the GB10 for the Vulkan RTF numbers (Step 2), then remove the trigger in a final `chore(ci)` commit.

- [ ] **Step 7: Commit** — `sidecar/bench/native_bench.py sidecar/bench/README.md sidecar/bench/__init__.py native/README.md CLAUDE.md`, message `docs(native): ASR/VAD section; sidecar bench harness`; then the CI commits of Step 6.

---

## Self-review (done while writing; kept so the executor sees what was checked)

- **Spec coverage.** §4.3 ASR: 8 functions → Tasks 1–3 (`sk_asr_capabilities` carries `languages`, `supports_streaming` as the spec's comment lists). §4.3 VAD: `sk_vad_open/feed/reset/close` → Task 4, plus `sk_vad_finalize` (Ruling G, documented reason). §4.5 binding → Task 5. §5.2 `native.py`, `accel.probe()` from `sk_devices()`, `device_free_bytes()` from `sk_device_free_mem()`, `_installed` → Task 6. §5.3 ASR bullet (`asr_backend.py`, `_match_language`, committed-delta adapter, VAD swap keeping thresholds/min durations/pre-roll) → Tasks 7–8. §5.4 "ASR: 67 rows, backend names only" → Task 9. §7 `prefetch_models.py` no longer fetches silero → Task 8. §9.1 CTest smoke (`sk_asr_run` whisper-tiny, `sk_vad_feed` silero, cancellation) → Tasks 2, 4; §9.3 stub `sokuji_native` in the sidecar tests → Tasks 6–8; §9.4 VAD ≤ 1 frame → Task 8/10; §9.6 bench → Task 10; §10 row 2 gates → Task 10. Not in this slice by design: tier vocabulary cleanup (`gpu-cuda`/`gpu-dml`), the eight-package allowlist, `test_runtime_gate.py`, per-SKU requirements deletion — slice 5; `sherpa-onnx` removal — slice 4 (Ruling C).
- **Placeholders.** None: every code step carries the code; the two "read the assertion / record the numbers" instructions are measurements, not deferred work. The 58 s clip in Task 10 Step 2 has a named substitute.
- **Type consistency.** `sk_text_cb(const char *, void *) -> bool` is used identically in Tasks 2, 3, 5. `sk_stream_text{committed, tentative}` in Tasks 3 and 5. `sk_vad_event{kind, sample, probability, seg_start, seg_end}` in Tasks 4, 5, 8 (`VadEvent` mirrors it with `kind` as `"start"|"end"`). `sk_asr_caps.arch` is `const char *` everywhere (the earlier `char[32]` idea was dropped before writing Task 1). `Device.index` from slice 1 is what `sk_asr_load`'s `sk_device.index` receives (Task 5 `asr_load` fills only `index`; the C side reads only `index` — Task 1). `NativeVad` exposes `window`, `is_speech_detected`, `accept_waveform`, `empty`, `front`, `pop`, `flush`, `reset`, `close`, and `Segment(samples, start)` — exactly what `asr_engine.py` reads (`_drain`, `feed`, `flush`, `_vad_state`, `_vad_events`). `native.module()` raises `ImportError` without the wheel; `accel.probe` wraps it in `_safe`, `asr_backend.load` converts it to `BackendLoadError` (Task 7 test `test_missing_wheel_is_backend_error`).
