# Slice 4 — TTS on the Native Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve TTS through `sk_tts_*` on `libsokuji_native` (audio.cpp's five families in-process), fix the three known `tts_engine.py` defects, shrink the catalog 68→10 with scoped-snapshot downloads, delete the nine ONNX/sherpa/MLX backends with their packages/scripts/deps, and land the audio.cpp parity suite.

**Architecture:** `sk_tts.cpp` wraps audio.cpp's engine-as-library (registry→load with explicit `family_hint`→one long-lived session per handle, per-handle mutex mirroring the reference server's BusyGuard). Offline families (moss_tts_nano, qwen3_tts Base, pocket_tts) synth via `run()`; streaming families (omnivoice, supertonic) via the PULL loop (`start_stream`→`next_stream_event`→`finish_stream`) — one `sk_audio_cb` call per chunk, cb-false cancels between chunks. Voice cloning is per-request state stored on the handle (ref PCM + reference_text); presets via `cached_voice_id`. The sidecar gets one `native_tts` backend; `tts_engine.py` moves every blocking call into the executor, wires cancel for streaming supersede, and resamples with soxr. TTS downloads become scoped directory snapshots (gguf + small siblings); the gpu-cuda/gpu-dml tier vocabulary dies with its last consumers.

**Tech Stack:** C++17 over audio.cpp v0.7.0 (vendored at `native/build/cpu/_deps/audiocpp-src`), ctypes, Python sidecar (pytest), TypeScript renderer (vitest), `compare_pcm.py` parity comparator.

**Spec:** `docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md` §5.3–5.5 (as corrected 2026-08-31: 10 cards, scoped-snapshot downloads), §6, §8, §9.1/9.2, rollout row 4.

**REQUIRED READING for every implementer (investigation ground truth, gitignored but on disk):**
- `.superpowers/audiocpp-tts-api-report.md` — the audio.cpp API with verbatim signatures/line numbers (tasks 1–3 live off it)
- `.superpowers/sidecar-tts-inventory.md` — the sidecar/renderer inventory with file:line specifics (tasks 4–7 live off it)

## Global Constraints

- English only in code, comments, tests, commit messages.
- TDD where a test can exist before the code; run red first where the plan says so.
- Worktree guard: Write/Edit tools for files; plain Bash commands; runner scripts under `/home/jiangzhuo/.claude/jobs/387091ff/tmp/` for env-heavy commands; 600000ms timeouts for builds/model runs.
- Branch `refactor/sidecar-ggml-only-slice4`. Never push.
- Sidecar tests: `PYTHONPATH=$PWD/sidecar /home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest <paths> -q`. Baseline failures BEFORE this slice: 3× pyopenjtalk + 1× bundles-workflow — note that the 3 pyopenjtalk failures live in TTS test files this slice DELETES, so the end-state baseline is 1 (bundles-workflow) — verify and report the new baseline explicitly.
- The dev venv wheel is Vulkan-lane 0.4.0 until Task 7 rebuilds 0.5.0 — sidecar unit tests FAKE `sokuji_sidecar.native.module` (the asr/translate test pattern).
- Wire contract: `wire_schema.json` ↔ `ServerMsg` pinned bidirectionally — schema and TS changes land in the same task (Task 6).
- Rulings in force: cards = 10; no hard-link staging (pass the HF snapshot's `.gguf` symlink path as given); gpu-cuda/gpu-dml tier cleanup folds INTO this slice; MOSS loses streaming (audio.cpp offline-only — contract-driven, flags tell the renderer); speed maps to supertonic's `speaking_rate` only (no-op elsewhere, documented).
- `sk_*` conventions from slices 2–3 hold; `native/src/sk_asr.cpp`/`sk_translate.cpp` are the structural templates; per-handle mutex is MANDATORY here (the API report §5 documents a real data race in session construction).

## Contract introduced by this plan (all tasks)

C ABI (added to `native/include/sokuji_native.h`):

```c
/* ---- TTS (audio.cpp) ----
 * One loaded model per handle; family is REQUIRED and passed as audio.cpp's family_hint
 * string. One long-lived session per handle (offline or streaming per the family);
 * all access is serialised per handle (audio.cpp sessions are not thread-safe).
 * Voice state (clone clip + reference text, or a preset id) is stored on the handle and
 * applied to every subsequent synth. sk_tts_synth delivers f32 PCM through sk_audio_cb:
 * offline families call it exactly once with the whole buffer; streaming families call
 * it once per pulled chunk. The callback returning false cancels between chunks
 * (streaming) or discards the result (offline, which cannot be interrupted mid-run).
 * The authoritative sample rate rides every callback; caps.sample_rate is the family's
 * expected rate for pre-synth UI. Errors are audio.cpp exceptions mapped to sk_status
 * with sk_last_error carrying ex.what(). */
typedef struct sk_tts sk_tts;
typedef struct sk_tts_options {
    const char *family;    /* required: moss_tts_nano | qwen3_tts | omnivoice | pocket_tts | supertonic */
    const char *language;  /* pocket_tts load-time language package ("english", ...); ignored elsewhere; NULL ok */
} sk_tts_options;
typedef struct sk_tts_caps {
    bool streaming;            /* omnivoice, supertonic */
    bool clones;               /* moss_tts_nano, qwen3_tts (Base), omnivoice, pocket_tts */
    bool transcript_required;  /* omnivoice: reference_text is mandatory with a ref clip */
    int32_t sample_rate;       /* family default: 48000 moss / 24000 qwen3+omnivoice+pocket / 44100 supertonic */
} sk_tts_caps;
typedef bool (*sk_audio_cb)(const float *pcm, size_t n_samples, int32_t sample_rate,
                            int32_t channels, void *user);
sk_status sk_tts_load(const char *model_path, const sk_device *device,
                      const sk_tts_options *opts, sk_tts **out);
sk_status sk_tts_capabilities(sk_tts *, sk_tts_caps *);
sk_status sk_tts_presets(sk_tts *, sk_text_cb on_name, void *user);   /* one call per preset name; supertonic + pocket only, others succeed with zero calls */
sk_status sk_tts_set_voice(sk_tts *, const float *ref_pcm, size_t n, int32_t sample_rate,
                           const char *ref_text /* NULL ok except omnivoice */);
sk_status sk_tts_set_preset(sk_tts *, const char *name);              /* clears any clone state */
sk_status sk_tts_synth(sk_tts *, const char *text, const char *language, float speed,
                       sk_audio_cb on_audio, void *user);
void      sk_tts_unload(sk_tts *);
```

Python binding: `sokuji_native.tts_load(path, family, device=None, language=None) -> TtsModel`; `TtsModel.capabilities` (TtsCaps dataclass mirroring sk_tts_caps); `.presets() -> list[str]`; `.set_voice(pcm, sample_rate, ref_text=None)`; `.set_preset(name)`; `.synth(text, language=None, speed=1.0, on_chunk=None) -> (samples: np.float32 concat, sample_rate: int)` where `on_chunk(pcm: np.ndarray, sample_rate: int)` streams and returning `False` cancels (raises `NativeError` CANCELLED); `.unload()`.

Sidecar: backend NAME `native_tts` with the duck contract `tts_engine.py` drives (STREAMING/CLONES/sample_rate class+instance attrs, load/unload/is_loaded, generate/generate_stream, set_voice/set_builtin_voice, set_language no-op); `PlanConfig` gains `tts_family: str = ""` and `tts_language: str = ""` (pocket's load-time package); `TtsModel` (catalog) gains `family` and `load_language`, loses `style_voices`/`num_speakers`; wire `ready` gains optional `family`.

---

### Task 1: `sk_tts` C surface + CTest

**Files:**
- Create: `native/src/sk_tts.cpp`, `native/tests/test_tts.cpp`
- Modify: `native/include/sokuji_native.h`, `native/CMakeLists.txt` (target_sources + VERSION 0.4.0→0.5.0), `native/tests/CMakeLists.txt`, `native/tests/test_common.cpp` (version literal), `.github/workflows/native-build.yml` (model cache + env vars), `native/README.md`
- Read first: `.superpowers/audiocpp-tts-api-report.md` IN FULL (it is the API truth: §1 flow + family_hint, §2 pull streaming, §3 voice control table, §5 exceptions + the per-model serialisation mandate, §8 file expectations, §9 the call-sequence precedent) and `native/src/sk_translate.cpp` (structural template).

**Implementation notes (all verified in the report):**
- Load: `make_default_registry()` once per handle is fine (cheap); `ModelLoadRequest{model_path, family_hint=opts->family}` + `options["language"]` for pocket_tts. Session created AT LOAD: `TaskSpec{task=VoiceTaskKind::Tts, mode = streaming-family ? RunMode::Streaming : RunMode::Offline}`, `SessionOptions{backend={type per sk_device kind (Cpu/Vulkan/Metal), device index, threads=sk::threads()}}`. dynamic_cast to IOffline/IStreaming per family; store both pointers.
- Family table baked into the wrapper: `{name, streaming, clones, transcript_required, default_rate}` for the five families; unknown family → SK_ERR_INVALID_ARGUMENT listing the valid names.
- Synth request build: `TaskRequest.text_input = Transcript{text, language or ""}`; clone state → `voice.speaker.audio = stored AudioBuffer` + `options["reference_text"]`; preset state → `voice.speaker.cached_voice_id = name`; speed → `options["speaking_rate"] = std::to_string(speed)` ONLY for supertonic and only when speed != 1.0f; greedy determinism for parity: set `options["do_sample"] = "false"` and `options["seed"] = "0"` ALWAYS (deterministic synthesis is the product behavior AND the parity precondition).
- `session->prepare(build_preparation_request(request))` before EVERY run/start_stream (report §2).
- Offline: `run(request)` → one cb with `audio_output` (rate+channels from the buffer). Streaming: `start_stream(request)`; loop `next_stream_event()` — each event's `named_audio_outputs[i].audio` → one cb each; cb false → call `reset()` on the session and return SK_ERR_CANCELLED; after nullopt → `finish_stream()` and do NOT re-deliver the merged buffer (chunks already went out) — but DO fall back to delivering `finish_stream()`'s audio_output in one cb if zero chunk events were pulled (defensive against a family emitting only the final).
- After every request (success/cancel/failure) call `reset()` on streaming sessions so the next request starts clean.
- Presets: supertonic → `registry.inspect(load_request).discovered_configs`, ids prefixed `voice_style_` → strip prefix (report §3); pocket_tts → list `<model_root>/embeddings/*.safetensors` basenames; run this at LOAD and cache the vector on the handle (inspect() needs the load request — keep a copy).
- Exceptions: wrap every audio.cpp call in try/catch(std::exception) → SK_ERR_BACKEND with ex.what() (the translate mapping style); "unknown ... session option"/"unsupported speaker"/"reference_text" validation errors pass through as INVALID_ARGUMENT when the message clearly indicates caller error — use a small classify-by-substring helper with a comment (audio.cpp has no status codes; report §5).
- Per-handle `std::mutex` held across load-time session creation AND every synth/set call (report §5's data race).
- sk_audio_cb: add the typedef to the header near sk_text_cb; note in the comment that pieces are f32 interleaved.

- [ ] **Step 1: Write the failing CTest** — `native/tests/test_tts.cpp`, gated on `SK_TEST_TTS_SUPERTONIC_DIR` and `SK_TEST_TTS_MOSS_DIR` env vars (skip 77 when absent; these point at model DIRECTORIES containing the gguf + siblings). Assertions: (a) supertonic: load (family "supertonic"), caps.streaming true + clones false + sample_rate 44100; presets cb collects ≥10 names incl. "M1"; set_preset("M1"); synth "Hello from the parity gate." language "en" → ≥2 cb calls (streaming chunks), total samples > 0, every cb rate == 44100; cancel test: cb returns false after the first chunk → SK_ERR_CANCELLED, then a fresh synth still works; (b) moss: load (family "moss_tts_nano"), caps.streaming false + clones true; synth → EXACTLY one cb call with rate 48000 and non-empty audio; set_voice with a 1-second 440Hz sine at 24k + ref_text "test" then synth again → still one cb, non-empty (clone path exercised end to end). Register in tests/CMakeLists mirroring test_translate. Model acquisition: read `native/build/cpu/_deps/audiocpp-src/docs/tts.md` + `model_specs/{supertonic,moss_tts_nano}.json` for the official HF gguf sources; download the q8_0 (or smallest) variant of each WITH its sibling files into `~/.cache/sokuji-native-tests/tts/{supertonic-3,moss-tts-nano}/`; wire the same into the CI cache step (extend key to v3, add the curl/hf lines; keep total cache growth reasonable — pick the smallest usable quants, expect ~100-400MB combined; report the exact sizes).
- [ ] **Step 2: Header + build wiring; implement.** VERSION 0.5.0; test_common literal bump.
- [ ] **Step 3: Build + run ctest** (all env vars via runner script) — expect test_common/test_asr/test_translate/test_tts all pass. `nm -D` → exactly the seven sk_tts symbols.
- [ ] **Step 4: README section** ("## TTS (slice 4)": entry points, one-session-per-handle, pull streaming, voice state model, preset discovery, model-dir expectations incl. the snapshot-symlink note, CTest model setup).
- [ ] **Step 5: Commit** — `feat(native): sk_tts over audio.cpp — five families, pull streaming, cloning, presets (0.5.0)`

---

### Task 2: Python binding — `TtsModel`

**Files:** `native/python/sokuji_native/{_ffi.py,__init__.py}`, `native/python/tests/test_sokuji_native.py`

- [ ] **Step 1: Failing tests** (gates `needs_tts_supertonic`/`needs_tts_moss` off the same env vars):
```python
@needs_tts_supertonic
def test_tts_supertonic_streams_presets_and_cancel():
    sokuji_native.init()
    t = sokuji_native.tts_load(TTS_SUPERTONIC_DIR, "supertonic")
    caps = t.capabilities
    assert caps.streaming and not caps.clones and caps.sample_rate == 44100
    names = t.presets()
    assert "M1" in names and len(names) >= 10
    t.set_preset("M1")
    chunks = []
    samples, rate = t.synth("Hello from the binding.", language="en",
                            on_chunk=lambda pcm, sr: chunks.append((len(pcm), sr)))
    assert rate == 44100 and len(samples) > 0 and len(chunks) >= 2
    assert sum(n for n, _ in chunks) == len(samples)
    seen = []
    def stop_after_one(pcm, sr):
        seen.append(len(pcm))
        return False
    with pytest.raises(sokuji_native.NativeError):
        t.synth("A much longer sentence that should produce several chunks of audio output.",
                language="en", on_chunk=stop_after_one)
    assert len(seen) == 1
    samples2, _ = t.synth("Still alive.", language="en")
    assert len(samples2) > 0
    t.unload()


@needs_tts_moss
def test_tts_moss_offline_and_clone():
    sokuji_native.init()
    t = sokuji_native.tts_load(TTS_MOSS_DIR, "moss_tts_nano")
    assert not t.capabilities.streaming and t.capabilities.clones
    assert t.presets() == []
    samples, rate = t.synth("Hello from MOSS.")
    assert rate == 48000 and len(samples) > 0
    ref = np.sin(np.linspace(0, 2 * np.pi * 440, 24000)).astype(np.float32)
    t.set_voice(ref, 24000, ref_text="test")
    samples2, _ = t.synth("Hello again.")
    assert len(samples2) > 0
    t.unload()
    t.unload()
```
- [ ] **Step 2: Implement** — structures + registrations mirroring the translate block; `AUDIO_CB` trampoline copies each chunk into a numpy array (np.ctypeslib or from_buffer_copy — MUST copy, the pointer dies after the cb) and appends to an accumulator; `on_chunk` returning exactly `False` cancels; keepalive rules per the established comments. `synth` returns the concatenation + the last chunk's rate.
- [ ] **Step 3: Run green** (15 prior + 2 = 17 with all model env vars). Commit — `feat(native/python): TtsModel binding — synth streaming, cloning, presets`

---

### Task 3: audio.cpp parity suite (spec §9.2)

**Files:**
- Create: `native/tests/parity/build_reference_cli.sh`, `native/tests/parity/test_tts_parity.py`, `native/tests/parity/README.md`
- Modify: `native/README.md` (parity section pointer)

**Design:** the reference side is the OFFICIAL `audiocpp_cli` built from the SAME vendored source with its OWN fork ggml (a standalone out-of-tree build: `cmake -S native/build/cpu/_deps/audiocpp-src -B <scratch>/audiocpp-official -DAUDIOCPP_MODEL_SET=custom -DAUDIOCPP_MODELS=... CPU only`, ~15 min on GB10 — script it, cache the binary under `~/.cache/sokuji-native-tests/audiocpp-official/`). The candidate side is `sokuji_native.tts_load(...).synth(...)` writing a WAV. Comparison via the existing `compare_pcm.py` (`--exact` on CPU; the Vulkan ≥60dB leg runs only when a Vulkan wheel/lane is present — env-gated, expected to run at the GB10 validation session, not in this plan's gates). Determinism: both sides seed=0, do_sample=false, same text/preset/ref clip; CLI flags per the report §7 verbatim examples (`--seed 0 --request-option do_sample=false`, `--voice-id M1`, `--voice-ref` + `--reference-text` for the clone cases).
Cases (env-gated per model dir, each skips independently): supertonic-3 offline "M1"; moss text-only; moss clone (fixed ref wav checked into `native/tests/parity/assets/ref-1s-440hz.wav` — generate it in the script, 24k mono 1s sine, do NOT commit a binary >100KB); qwen3-tts-0.6b Base clone (env `SK_TEST_TTS_QWEN3_DIR`); pocket-tts-en preset "alba" (env `SK_TEST_TTS_POCKET_DIR`); omnivoice clone (env `SK_TEST_TTS_OMNIVOICE_DIR`; reference_text mandatory). Each case: run CLI → ref.wav; run binding → got.wav; `compare_pcm --exact`.
- [ ] **Step 1: Write the harness + script** (pytest file with per-case env skips; runner-script pattern for the multi-env invocations).
- [ ] **Step 2: Run what's runnable now** — supertonic + moss (models already cached from Task 1; download qwen3-0.6b/pocket-en/omnivoice dirs if disk and time allow — report sizes and which cases ran; cases that need absent models skip and are ledgered for the live-gate task).
- [ ] **Step 3: Commit** — `test(native): audio.cpp parity harness — official CLI vs sk_tts, CPU sample-exact`

---

### Task 4: Sidecar — `native_tts` backend + `tts_engine.py` fixes + voices rewrite

**Files:**
- Create: `sidecar/sokuji_sidecar/tts_backend.py`, `sidecar/tests/test_tts_backend.py`
- Modify: `sidecar/sokuji_sidecar/tts_engine.py` (+ its tests: keep `test_tts_engine.py`, rewrite content), `sidecar/sokuji_sidecar/tts_voices.py` (rewrite ~30 lines), `sidecar/sokuji_sidecar/backends.py` (bottom-import), `sidecar/tests/test_tts_voices.py` (rewrite small)
- Read first: `.superpowers/sidecar-tts-inventory.md` §1–3 + §6.1 (wire handlers, duck contract, defect locations, voices logic)

**Backend design** (mirror `asr_backend`/`translate_backend` patterns):
- `NativeTtsBackend(NAME="native_tts")`: `load(model_ref, device, compute_type, config=None)` — model_ref is the artifact `"org/repo/<dir>/<file>.gguf"`; resolve the LOCAL SNAPSHOT path via `huggingface_hub.snapshot_download(repo, allow_patterns=[f"{dir}/*"], local_files_only=True)` then the gguf symlink inside it (pass the symlink path AS GIVEN — ruling: no hard-links); `native.module().tts_load(path, family=config.tts_family, device=native.device_for(device), language=config.tts_language or None)` — EXPLICIT device always (the slice-3 F1 lesson; a `cpu` plan passes the cpu device). Post-load: `self.STREAMING/CLONES/sample_rate` set from `.capabilities` (instance attrs shadowing the class defaults — `tts_engine` reads them per instance).
- `generate(text, speed=1.0) -> (np.float32 samples, gen_ms)`: synth without on_chunk; `generate_stream(text, speed=1.0)`: a generator bridging the callback — run synth in the CALLING thread and yield chunks via a queue is overkill; instead call `.synth(..., on_chunk=collect)` where collect appends to a local list and the generator yields... a Python generator cannot yield from inside a C callback. Bridge with a `queue.Queue` + a worker thread INSIDE the backend: `generate_stream` starts a thread running synth with on_chunk=lambda pcm, sr: (q.put((pcm, sr)), not cancelled.is_set())[1], yields q.get() items until a sentinel, and `.cancel()` sets the event so the next chunk's callback returns False (this is what makes tts_cancel/supersede REALLY stop the GPU — defect 2's fix reaches the native layer). Expose `cancel()` on the backend; the engine's should_cancel flag now calls it.
- `set_voice(audio, sr, ref_text="")` / `set_builtin_voice(name)` / `set_language(lang)` (store; passed per synth) / `list_builtin_voices()` → `.presets()`.
- Fakes for tests mirror the established `_FakeTranslator` pattern (fake `tts_load` returning a scripted TtsModel with capabilities/presets/synth honoring on_chunk-False).

**Engine fixes (the three defects, inventory §3):**
1. `_h_tts_init`, `_h_set_voice`, `_h_tts_generate`'s one-shot branch → `await loop.run_in_executor(None, ...)` (measure_rtf_tts rides inside init's executor call). Mirror `_h_translate`'s shape incl. the teardown-ordering caveat: note in a comment that a stale teardown vs re-init has the same ownership window as translate (ledgered slice-5 debt; do not fix here).
2. Supersede + cancel: `_h_tts_generate` streaming branch sets `state["tts_cancels"][prior_mid] = True` AND calls `eng.cancel_active()` (engine → backend.cancel()) BEFORE `prior.cancel()`; `_h_tts_cancel` also calls `eng.cancel_active()`. One-shot cancel stays a no-op (offline runs are not interruptible — comment it).
3. `_to_int16_24k_mono` → soxr: `soxr.resample(x, src_sr, 24000)` then int16 conversion; delete the linear-interp body; keep the function name/signature (its callers stand).
**Voices rewrite:** `list_builtin_voices(model_id)` → if the engine has the model loaded, `backend.list_builtin_voices()`; else load-free path: read the preset names from the LOCAL snapshot dir (supertonic `voice_styles/*.json` stems, pocket `embeddings/*.safetensors` stems) resolved via the same scoped-snapshot lookup; MOSS/qwen3/omnivoice → `[]`. The `_VOICE_META` curation dict and manifest readers die. Target ≈30 lines + tests.

- [ ] **Step 1: Tests red** (backend: load passes family+explicit device+snapshot path; caps→attrs; generate one-shot; generate_stream yields chunks and cancel stops before the next chunk; set_voice/preset plumbed into synth calls — all against the fake native module. Engine: executor usage asserted via a blocking-fake + loop-responsiveness probe OR simpler: monkeypatch run_in_executor to record calls; supersede sets prior cancel flag AND calls backend.cancel; soxr path produces the right sample count for 44100→24000).
- [ ] **Step 2: Implement; full targeted runs green.**
- [ ] **Step 3: Commit** — `feat(sidecar): native_tts backend; tts_engine executor/cancel/soxr fixes; voices rewrite`

---

### Task 5: Catalog 68→10, scoped downloads, planner collapse, deletions, dep purge

**Files:**
- Modify: `sidecar/sokuji_sidecar/{catalog.py,native_models.py,planner.py,accel.py,__main__.py,requirements.txt}`, `sidecar/tests/{test_catalog.py,test_native_models.py,test_planner.py,test_accel.py,test_characterization.py,test_torch_free_gate.py,test_backends.py}`
- Delete (git rm): packages `qwen3_tts/ cosyvoice3/ omnivoice/ moss_tts/ gpt_sovits/`; modules `tts_backends.py sherpa_tts.py supertonic_frontend.py pocket_inference.py pocket_bundle.py pocket_tokenizer.py qwen_tokenizer.py mlx_tts.py hf_symlinks.py`; the 36 pure-TTS test files listed in the inventory §7.3; scripts per inventory §7.4 (all 12 files + 2 dirs, including the two slice-3 stragglers `convert-opus-ct2.py` and `record_llama_checksums.py`)
- Read first: `.superpowers/sidecar-tts-inventory.md` §4, §5, §7, §8

**Catalog:** `TtsModel` gains `family: str` + `load_language: str = ""`, loses `style_voices`/`num_speakers`; `Deployment.requires_apple_silicon` dies. The 10 rows (families: moss-tts-nano→moss_tts_nano, qwen3-tts-*→qwen3_tts, omnivoice-0.6b→omnivoice, supertonic-3→supertonic, pocket-tts-XX→pocket_tts with load_language en→"english" etc.), each with backend `native_tts`, tiers `("gpu-metal", "gpu-vulkan", "cpu")`, artifact `"<org>/<repo>/<dir>/<file>.gguf"` + quant ladder like the ASR rows — the implementer derives the REAL repo/dir/file names from `audiocpp-src`'s `model_specs/*.json` package sources + `docs/tts.md`, verifies each artifact exists via the HF API (curl the tree endpoint), and records sizes; where audio.cpp has no official GGUF repo for a family, STOP and report (controller decides mirroring — do not invent repos). `voice_capability()` reworks off `named_voices`/`clones` only. `_plan_config` populates `tts_family`/`tts_language` via getattr. gpu-cuda/gpu-dml: delete the tier strings from TIER_RANK/TIER_DEVICE/TierIcon-facing vocab, `has_nvidia`, `_dml_adapters`, `_ort_cuda`, `__main__._preload_cuda_dlls`, the aarch64 ORT special case (inventory §7.5's accel/__main__ rows; spec §5.2 names them).
**Downloads:** `_base_specs` TTS branch → scoped snapshot spec `{"repos": [], "urls": [], "snapshot": (repo, [f"{dir}/*"])}` or reuse the files-shape generalized — design choice: add a `"scoped"` spec shape `(repo, allow_patterns)` consumed by download()/model_status(); the variant_repos any-rung branch (~38 lines) and the MLX repo-swap die; `_ladder_artifacts` extends to TTS quant ladders (per-file hf_hub_download local check within the scoped dir).
**Planner:** `_tts_pick_quant`/`resolve_tts` collapse toward the GGUF-LLM path (`_llamacpp_variant_row`-style single-file quant ladder); keep `resolve_tts` as the entry point name.
**Deps:** requirements.txt drops `sentencepiece, tokenizers, jieba, pypinyin, g2pM, nltk, pyopenjtalk-plus, mlx-audio` + their comments (verify each has zero remaining imports post-deletion — `tokenizers` was consumed only by the deleted `qwen_tokenizer.py`); `requirements-nvidia.txt` and any other per-SKU files: check what exists and remove dead TTS/ONNX lines (full file deletion is slice 5's "one requirements file" — here only prune). `test_torch_free_gate.py` BANNED += `sherpa_onnx` (its own comment says slice 4), plus the freed G2P packages.
**Tests:** neighbor surgery per inventory §10.1 (planner 122 hits, catalog 84, characterization 58 re-recorded by running, accel 57, native_models 57); characterization re-record method = run the real resolver against the file's own fixtures (the slice-3 precedent).

- [ ] Steps: tests-first where feasible (catalog row shape tests, scoped-download specs tests), then implement, then the FULL sidecar suite — expect the new baseline (1 known failure: bundles-workflow) and a large drop in totals; record exact counts. Commit — `feat(sidecar): TTS catalog 68→10 on native_tts; scoped snapshots; delete the ONNX/sherpa/MLX stacks and their deps`

---

### Task 6: Wire + renderer

**Files:**
- Modify: `sidecar/sokuji_sidecar/wire_schema.json` (+`ready` optional `family`), `sidecar/sokuji_sidecar/tts_engine.py` (`ready` reply includes family), `sidecar/tests/test_wire.py`, `src/lib/local-inference/native/nativeProtocol.ts` (ReadyMsg + `family?`), `src/lib/local-inference/native/NativeTtsClient.ts` (+test: delete `setSpeaker`/`setStyleVoice`, add `family` to TtsReady), `src/services/clients/LocalNativeClient.ts` (+test: the `sid:`/`style` voice-apply branches die; `voiceCapability` consumers), `src/lib/local-inference/native/nativeVoiceStores.ts` (narrow to clip-only; the `'style'` kind dies), `src/lib/local-inference/native/nativeCatalog.ts` (FRAMEWORK_LABELS: 5 TTS entries → `native_tts: 'audio.cpp'`; `VoiceCustom` loses `'style'`; `numSpeakers` consumer), `src/components/Settings/sections/{NativeVoiceSection.tsx,TierIcon.tsx}` (+tests), plus test fixture updates the runs surface (`nativeCatalog.test.ts`, `nativeModelStore.test.ts`, `useNativeEngineAdapter.test.ts`, `participantConfig.test.ts`, `candidates.native.test.ts`, `StoragePage.test.tsx`)
- Constraints: schema+TS in one commit (bidirectional pin); `voiceStorage.ts` itself is SHARED with the WASM lane — do NOT delete it (inventory §6.2); `LocalInferenceVoiceSection.tsx` and everything WASM-lane stays untouched.
- [ ] Tests red → implement → `npx vitest run` targeted paths + consistency test + `npx tsc --noEmit` (534 baseline; if the TS deletions REDUCE the count, record the new baseline). Sidecar wire tests green. Commit — `feat(wire+renderer): ready.family; style/speaker voice paths removed; native_tts labels`

---

### Task 7: Sweep, wheel 0.5.0, live gates

- [ ] **Repo sweep**: `grep -rn "sherpa\|onnxruntime\|mlx\|_onnx\|style_voice\|styleVoice\|gpu-cuda\|gpu-dml\|num_speakers\|numSpeakers\|hf_symlinks" sidecar src electron .github native --include=...` — judge every hit (WASM-lane sherpa/onnx hits are LEGITIMATE and stay: `src/lib/local-inference/**` except `native/`, `extension/`, `scripts/download-sherpa-wasm.sh`, `copy-ort-wasm.sh` per spec §1.2; `requirements` comments; docs/specs/plans historical). Also delete `.superpowers/audiocpp-tts-api-report.md` + `sidecar-tts-inventory.md`? NO — leave (gitignored scratch).
- [ ] **Wheel**: `bash native/ci/build.sh none manylinux_2_39_aarch64` (PYTHON= runner script) — note this replaces the venv's VULKAN 0.4.0 with CPU-lane 0.5.0; that is expected (the Vulkan 0.5.0 returns at the CI-artifact validation session). pip force-reinstall; full sidecar suite.
- [ ] **Live gate — TTS→ASR loopback per family (spec rollout row 4)**: new env-gated test `SOKUJI_RUN_TTS_LOOPBACK=1` in `test_tts_engine.py` (or a bench script if pytest fits poorly): for each of the five families with a locally-downloaded model (download what Task 3 didn't already: qwen3-tts-0.6b, omnivoice-0.6b, pocket-tts-en; report sizes), synth "The quick brown fox jumps over the lazy dog." (preset/clone per family capability; omnivoice needs the ref clip + text), resample to 16k, run through `sokuji_native.asr_load(whisper-tiny)` and assert the transcript contains "quick" or "fox". Run it; record per-family transcripts + timings.
- [ ] **Full gates**: native ctest (4 targets), native python tests (17), sidecar full (new baseline), targeted vitest, tsc count. Commit any sweep fixes — `chore(slice4): sweep, 0.5.0 wheel, TTS live gates`
