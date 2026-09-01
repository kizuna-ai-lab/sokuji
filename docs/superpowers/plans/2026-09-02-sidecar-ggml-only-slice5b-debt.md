# Sidecar ggml-only — Slice 5b (pre-release debt clearing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear every debt jiangzhuo ruled must be resolved before slice 6 (2026-09-02):
Metal TTS support on Apple GPUs, the validation/perf findings from the three-machine
fleet run, the parity-cache trap, thread policy, GPU warm-up, and the four carried
lifecycle/renderer items.

**Architecture:** No new subsystems. Native: two resurrected Metal kernels via the
existing `native/patches/*.json` mechanism + one shim extension + log fallback; a
thread-default policy in `sk_common`. Sidecar/renderer/electron: small, tested fixes.
Ground truth (REQUIRED READING per task, all gitignored under `.superpowers/`):
`metal-fix-experiments.md` (+ `metal-fix-repo.patch`, the two `metal-fix-ggml-*.json`),
`metal-tts-validation.md`, `windows-vulkan-validation.md`, `vulkan-perf-investigation.md`.

**Tech Stack:** unchanged.

**Spec:** docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md (§9 gates, §10
row 5/6). Fleet: memory `sokuji-test-fleet` — Mac mini M4 `ssh 192.168.1.15`
(jiangzhuo; /opt/homebrew/bin cmake+ninja+python3), Windows `ssh jiang@192.168.1.13`
(RTX 4070 SUPER), this box GB10 (Vulkan).

## Global Constraints

- Branch `refactor/sidecar-ggml-only-slice5` from **be26f136** (main merged; PR #459 head).
  Baselines: sidecar 697/0/12; tsc 534; electron 402; targeted vitest 1021 (79 files,
  incl. locales+consoleLedger); native ctest 4/4; native python 17/17; parity 9/3sk
  (cpu stage, AFTER purging `~/.cache/sokuji-native-tests/{sokuji-native-nosve,audiocpp-official-nosve}`).
- CPU numerics must not move: parity supertonic sample-exact, moss bit-exact stay green on
  the cpu lane after every native change.
- Metal decisions: tiers restored per family ONLY after the CI macos-14 (M1/Apple7) lane
  confirms — M4 passes are Apple9 evidence (memory: sokuji-test-fleet).
- Worktree Bash guard: no heredocs / multi-env-prefix / complex pipelines — runner scripts
  under `/home/jiangzhuo/.claude/jobs/387091ff/tmp/`. Explicit-pathspec commits. Never
  `git stash`. Never push (controller pushes with approval). Remote boxes: scratch dirs
  only (`~/sokuji-metal-fix/` on the Mac; `C:\Users\jiang\sokuji-vulkan-probe\` on Windows).
- Machine test-time rule (from Q2): every timing row records `n_threads`; never run CPU
  timings at `n_threads = nproc`.

---

### Task 1: Land the Metal fixes + a real GPU-device TTS test

**Files:**
- Apply verbatim: `.superpowers/metal-fix-repo.patch` (7 files: `native/cmake/ggml_options.cmake`,
  `native/cmake/patch_upstream.py`, `native/cmake/upstreams.cmake`,
  `native/patches/ggml-metal-diag-mask-inf.json`, `native/patches/ggml-metal-pad-leading.json`,
  `native/src/audiocpp_compat.h` (ggml_sub shim now conts src1 too), `native/src/sk_common.cpp`
  (ggml log → stderr fallback when no sink))
- Create: GPU-device TTS test in `native/python/tests/test_sokuji_native.py` gated on
  `SK_TEST_TTS_GPU=1`: for each family with a model dir env var set, load on the first
  non-CPU device, synth the pangram, assert non-empty + sane duration; run each family in
  its own subprocess (an abort must not kill the suite) and report per-family
  PASS/abort-text. Wire the env var into `.github/workflows/native-build.yml` for the
  metal lane only (and the vulkan lanes harmlessly — headless runners have no GPU device
  → test skips itself when `devices()` has no non-CPU entry).
- Modify: `native/README.md` (Metal section: the two resurrected kernels, why, the
  M1-vs-M4 caveat), `native/CMakeLists.txt` VERSION 0.5.0 → 0.6.0 (native change).

- [ ] **Step 1:** `git apply .superpowers/metal-fix-repo.patch`; read every hunk (the patch
  mechanism edits must be understood, not trusted). Rebuild the cpu lane on GB10; ctest
  4/4; native python 17/17; **parity 9/3sk with purged nosve caches** (Task 2's fix not
  yet in — purge manually first). If parity moves: STOP, report (the R13 src1 clause
  must be inert on CPU).
- [ ] **Step 2:** GPU test written (TDD: with SK_TEST_TTS_GPU=1 on GB10's vulkan stage it
  runs all five on Vulkan → 5 PASS; without the var → skipped).
- [ ] **Step 3:** Mac: rsync the worktree's `native/` to `~/sokuji-metal-fix/native/`
  (excluding build/), rebuild the metal lane there (`native/ci/build.sh metal
  macosx_11_0_arm64`, PATH=/opt/homebrew/bin:$PATH, PYTHON=/opt/homebrew/bin/python3,
  SK_TEST_* → the ~/sokuji-metal-probe models), then run the new GPU test with
  SK_TEST_TTS_GPU=1 on Metal → expect 5/5 PASS (moss transcript may drift in wording —
  sampled family; assert markers not exact text). Record per-family Metal vs CPU synth.
- [ ] **Step 4:** Commit —
  `feat(native): Metal DIAG_MASK_INF + leading PAD kernels; ggml_sub shim conts src1; ggml log fallback; GPU-device TTS test (0.6.0)`
  NOTE: gpu-metal tiers are NOT restored here (Task 9, after the CI M1 run).

### Task 2: Parity cache trap

**Files:** `native/tests/parity/test_tts_parity.py` (`_sve_free_copy`, `_candidate_native_dir_nosve`, `_official_cli_nosve`)

- [ ] **Step 1:** failing test: two source dirs with different content but the newer key
  mtime on the wrong one must NOT share a cache; simulate with tmp dirs.
- [ ] **Step 2:** fix: cache subdir keyed by a hash of the SOURCE DIR's absolute path
  (`CACHE_DIR / f"nosve-{sha1(str(src))[:12]}"`), refresh when key mtime OR size differs
  (equality, not `>=`), and copy ALL non-SVE files again on refresh (stale extras like a
  foreign `libggml-vulkan.so` removed first). Docstring explains the 2026-09-02 incident.
- [ ] **Step 3:** parity 9/3sk on cpu stage; then point SOKUJI_NATIVE_DIR at the vulkan
  stage and back — both runs must use their own copies (assert by listing the cache).
- [ ] **Step 4:** Commit — `test(parity): per-source nosve cache keyed by path+mtime+size (2026-09-02 contamination)`

### Task 3: contract.json backends + thread-default policy

**Files:** `native/CMakeLists.txt:~120` (backends list scoping), `native/src/sk_common.cpp`
(n_threads==0 policy), `sidecar/sokuji_sidecar/native.py:29` (comment), tests in
`native/tests/test_common.cpp` / `native/python/tests`.

- [ ] **Step 1:** fix the CMake scoping so a vulkan/metal build's `contract.json` lists its
  GPU backend (verify on GB10 vulkan stage + the cpu stage: `["cpu"]` vs `["cpu","vulkan"]`).
- [ ] **Step 2:** thread policy: measure on GB10 (moss + pocket + supertonic synth, CPU,
  `n_threads` ∈ {4, 6, 8, 12, 16, 20}, 4 runs each, fresh process, load excluded) — pick
  the knee; ruling default: `n_threads == 0 → min(hardware_concurrency, KNEE)` with
  KNEE from the measurement (expected 8), implemented in `sk_init` so every consumer
  benefits; `SOKUJI_NATIVE_THREADS` override unchanged. Table in the report + a comment
  citing vulkan-perf-investigation.md (spin-barrier oversubscription).
- [ ] **Step 3:** rebuild cpu; ctest; python; parity unchanged (parity pins THREADS itself).
  Commit — `fix(native): contract.json lists GPU backends; n_threads=0 caps at the measured knee (spin-barrier oversubscription)`

### Task 4: GPU warm-up synth at TTS load (W-1)

**Files:** `sidecar/sokuji_sidecar/tts_backend.py` (`load`), `sidecar/tests/test_tts_backend.py`

- [ ] **Step 1:** failing test: loading on a non-CPU device performs one short warm-up
  synth (fake model records the call; text is a fixed short phrase; result discarded;
  voice-required families use a built-in silent/preset path — for clone-only families
  SKIP warm-up with a comment, they have no voice yet); CPU loads do NOT warm up.
- [ ] **Step 2:** implement; keep it inside the worker registry (it is a one-shot generate).
  Ruling: warm-up only when `device != cpu` (Windows measured 16.5s first-synth pipeline
  compile per family; CPU pays nothing).
- [ ] **Step 3:** sidecar suite; commit — `feat(sidecar): warm-up synth on GPU TTS load hides first-synth pipeline compile (W-1)`

### Task 5: M5 TOCTOU lock

**Files:** `sidecar/sokuji_sidecar/tts_engine.py`, `translate_engine.py`, their tests

- [ ] **Step 1:** failing test: two concurrent inits (tts off-loop) — the teardown
  registered by init N must carry generation N even when init N+1's executor bump
  interleaves; construct with events.
- [ ] **Step 2:** fix: bump the generation on the LOOP thread before dispatching init to
  the executor (or return the generation from init and capture it atomically) — no lock
  needed if the bump is loop-synchronous; document the choice.
- [ ] **Step 3:** suite; commit — `fix(sidecar): generation token captured atomically with init dispatch (M5 TOCTOU)`

### Task 6: Orphaned old-SKU bundle dirs

**Files:** `electron/sidecar-bundle.js`, `electron/sidecar-bundle.test.js`

- [ ] **Step 1:** failing test: userData/sidecar contains `linux-nvidia`, `mac`, and the
  current sku dir → after the cleanup pass only the current sku dir (and any
  `sidecar-*.part` in flight) remain.
- [ ] **Step 2:** implement `pruneStaleSkuDirs(root, currentSku)` called once at bundle
  resolution; known-old names AND any dir not in the five-SKU set are removed; log one line.
- [ ] **Step 3:** electron tests; commit — `fix(electron): prune stale sidecar bundle dirs from the old SKU vocabulary`

### Task 7: reconcileTtsVoice stale custom selection

**Files:** `src/services/clients/LocalNativeClient.ts` (reconcile block), test

- [ ] **Step 1:** failing test: clone-required model, stored selection `custom:X` where X
  lacks a transcript, another eligible clip Y exists → reconcile must NOT keep X (pick Y
  or clear + gate message), never apply an ineligible clip.
- [ ] **Step 2:** fix: build `customIds` from the ELIGIBLE list (same predicate as the
  gate/picker). Targeted vitest; tsc 534; commit —
  `fix(renderer): reconcileTtsVoice only keeps eligible clips (transcript-required families)`

### Task 8: Catalog narrative + supertonic load investigation

**Files:** `sidecar/sokuji_sidecar/catalog.py` comment block (R19→R29 saga), `.superpowers/` note

- [ ] **Step 1:** correct the comment: supertonic Vulkan is 10-19x on synth, the earlier
  ~1.0x was load-dominated (99% of wall = 14s load); cite vulkan-perf-investigation.md;
  add the per-lane real-GPU validation table (linux-arm64 GB10 5/5; win-x64 RTX 4070
  SUPER 5/5 with the speedups; mac-arm64 M4 5/5 after Task 1, M1 pending CI).
- [ ] **Step 2 (investigation, fix only if ≤ 1 day):** supertonic's 14s load (299MB @
  22MB/s, `load_backend_weights` conversion-bound, audiocpp-src supertonic/runtime.cpp:327-365):
  what is converted, from what to what, can the conversion be skipped for an F16 GGUF or
  memoized? Report findings; implement only a contained fix (e.g. avoiding a redundant
  F16→F32→F16 pass) with parity + ctest proof; otherwise document as slice-6+ item.
- [ ] **Step 3:** commit — `docs(catalog): supertonic Vulkan is synth-10x/load-bound; fleet validation table` (+ any load fix separately)

### Task 9: tsc baseline assessment (report, fix only what this branch introduced)

- [ ] **Step 1:** run `npx tsc --noEmit` on a clean checkout of `origin/main` (temporary
  clone under the job tmp dir) and on this branch; diff the error sets. Errors that exist
  only on this branch → fix them here (tests + code), keeping behavior. Errors shared
  with main → list them in the report as repo-wide debt (not this slice's job).
- [ ] **Step 2:** commit fixes if any — `fix(types): branch-introduced tsc errors`

### Task 10: CI dry run + Metal tier decision (controller-gated push)

- [ ] **Step 1 (controller):** temp triggers on native-build.yml (and sidecar-bundles.yml
  if Task 1 touched bundle inputs — it does not); push; the macos-14 lane runs the new
  GPU test on M1 → per-family Metal result on Apple7.
- [ ] **Step 2 (implementer, after CI):** restore `gpu-metal` in `_TTS_TIER_OVERRIDES`
  for exactly the families that passed on BOTH M4 and M1; catalog comment records both
  boxes; tier tests updated; TierIcon already renders gpu-metal. Commit —
  `feat(catalog): restore gpu-metal TTS tiers validated on M4 + CI M1`
- [ ] **Step 3:** remove temp trigger; final full gates; slice 5b done → slice 6.

---

## Execution notes (controller)

- Order: 1 → 2 → 3 (native, sequential — one build tree); 4 → 5 (sidecar); 6, 7
  independent; 8, 9 anytime; 10 last.
- Every native task ends with parity 9/3sk on the cpu lane using the Task-2 cache (or
  purged caches before Task 2 lands).
- Mac/Windows access per memory `sokuji-test-fleet`; the Mac crash-reporter dialogs
  during GPU-test aborts are expected noise (jiangzhuo informed).
