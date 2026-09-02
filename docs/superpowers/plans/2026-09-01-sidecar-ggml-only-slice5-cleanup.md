# Sidecar ggml-only — Slice 5 (cleanup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the ggml-only refactor's cleanup slice: platform-named SKUs (with a
real mac-x64 bundle), one requirements file, the runtime import gate, modernized
bundle workflows with sizes in the job summary, the parked TTS/translate lifecycle
debts, renderer clone pre-gating, the MOSS sampling fix, and GB10 Vulkan TTS
validation.

**Architecture:** No new subsystems. Every task edits surfaces that already exist,
guided by the ground-truth inventory at `.superpowers/slice5-surface-inventory.md`
(REQUIRED READING for every implementer — every file:line below is verified there).
Native changes are confined to one per-family option override in `sk_tts.cpp`.

**Tech Stack:** unchanged (sidecar Python 3.12 + pytest; native CMake/C++ on upstream
ggml 0.22; Electron; React/TS + vitest).

**Spec:** docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md — §7
(packaging/SKUs), §9.3 (eight-package allowlist), §10 row 5 (this slice; gate:
"pytest + vitest green; five bundles built with sizes printed"), §11 (acceptance).

## Global Constraints

- The five SKUs are **`linux-x64`, `linux-arm64`, `win-x64`, `mac-arm64`, `mac-x64`**
  — identical to `.github/workflows/native-build.yml:30-38`'s matrix, verbatim.
- Spec §9.3 / §11.1: `sokuji_sidecar/` imports none of onnxruntime, torch,
  sherpa_onnx, ctranslate2, transcribe_cpp, mlx; `requirements.txt` is the
  eight-package allowlist (numpy, websockets, huggingface_hub, psutil, zstandard,
  soundfile, soxr + sokuji-native installed by setup.sh).
- R19 stands: `_TTS_TIERS` stays `("cpu",)` except where Task 8's live Vulkan
  validation explicitly earns a family `"gpu-vulkan"` back. Metal stays off this
  slice (no Apple-GPU box in reach).
- WASM lane (`src/lib/local-inference/**` outside `native/`, `extension/`,
  wasm scripts) untouched, per spec §1.2.
- Worktree Bash guard: no heredocs, no multi-env-prefix one-liners, no complex
  pipelines — runner scripts under `/home/jiangzhuo/.claude/jobs/387091ff/tmp/`.
  Commits use explicit pathspec. Never `git stash`. Never push (controller pushes).
- Baselines at branch tip 3faadebe: sidecar 690 passed / 1 failed (bundles-workflow
  test — Task 3 fixes it) / 12 skipped; tsc `--noEmit | wc -l` = 534; targeted
  vitest (src/lib/local-inference/native, LocalNativeClient.test.ts,
  src/components/Settings/sections/) = 487; native ctest 4/4; native python+parity
  25 passed / 3 skipped / 1 xfailed.

---

### Task 1: SKU rename + mac-x64 bundle + NVIDIA probe removal

**Files:**
- Modify: `electron/sidecar-sku.js`, `electron/native-host-manager.js:82-83`,
  `electron/main.js:610,614,640`, `scripts/build-sidecar-bundle.py:37-58,162`,
  `src/stores/nativeModelStore.ts:27,39-40`,
  `src/components/Settings/sections/EngineSection.tsx:96-106`, locales touching
  `engine.detected`
- Test: `electron/sidecar-sku.test.js` (rewrite), `electron/sidecar-bundle.test.js`,
  `electron/native-host-manager.test.js`, `sidecar/tests/test_build_sidecar_bundle.py`,
  `src/components/Settings/sections/EngineSection.test.tsx`,
  `src/stores/nativeModelStore.test.ts`

**Interfaces:**
- Produces: `detectSku(platform, {arch})` → one of the five SKU strings or `null`
  only for genuinely unsupported platforms; **no `hasNvidia` argument anymore**.
  `SKU_TRIPLE = {"linux-x64": "x86_64-unknown-linux-gnu", "linux-arm64":
  "aarch64-unknown-linux-gnu", "win-x64": "x86_64-pc-windows-msvc", "mac-arm64":
  "aarch64-apple-darwin", "mac-x64": "x86_64-apple-darwin"}`. Task 3 consumes these
  names in the workflow matrix; Task 2 consumes the `SKU_REQUIREMENTS` deletion.

- [ ] **Step 1: failing tests first** — rewrite `electron/sidecar-sku.test.js` to the
  new contract: `detectSku('linux',{arch:'x64'})==='linux-x64'`,
  `('linux',{arch:'arm64'})==='linux-arm64'`, `('win32',{arch:'x64'})==='win-x64'`,
  `('darwin',{arch:'arm64'})==='mac-arm64'`, `('darwin',{arch:'x64'})==='mac-x64'`,
  unknown → `null`; assert the module no longer exports `probeNvidia`/`nvidiaGpuName`.
  For `SKU_TRIPLE`, KEEP the existing dict's triple VALUES verbatim (only the keys
  are renamed; `linux-nvidia`→`linux-x64`, `win-nvidia`/`win-directml` collapse to
  one `win-x64` entry, `mac`→`mac-arm64`); the only NEW value is
  `mac-x64: "x86_64-apple-darwin"` — verify that exact triple exists in the
  python-build-standalone release the script downloads before hardcoding it.
- [ ] **Step 2:** implement `detectSku` on platform+arch only; delete
  `probeNvidia`/`_probeNvidiaUncached`/`nvidiaGpuName`/`parseGpuName` (lines 21-54)
  and their call sites in `native-host-manager.js` / `main.js` (drop `gpuName` from
  the `sidecar-bundle:status` IPC payload). Renderer: remove `bundleGpuName` from
  `nativeModelStore.ts` and the `engine.detected` row in `EngineSection.tsx`;
  update the SKU doc comment to the five new names. Remove the now-unused
  `engine.detected` locale keys (all locales; grep).
- [ ] **Step 3:** `build-sidecar-bundle.py`: `SKU_TRIPLE` → the five entries above;
  delete `SKU_REQUIREMENTS`/`sku_requirements()`; line 162 uses
  `repo / "sidecar" / "requirements.txt"` unconditionally. Update
  `test_build_sidecar_bundle.py` fixtures to the new SKUs (include one mac-x64 case).
- [ ] **Step 4:** run: electron tests (`npm test -- electron` or the repo's runner for
  `electron/*.test.js`), targeted vitest, sidecar tests for
  `test_build_sidecar_bundle.py`, `npx tsc --noEmit | wc -l` (≤534; deletions may
  lower it — record).
- [ ] **Step 5: Commit** — `feat(sku): platform-named SKUs incl. mac-x64; NVIDIA probe
  removed (spec §7)`

### Task 2: One requirements file + `test_runtime_gate.py`

**Files:**
- Delete: `sidecar/requirements-nvidia.txt`, `requirements-directml.txt`,
  `requirements-arm64.txt`, `requirements-mac.txt`, `sidecar/tests/test_sku_requirements.py`
- Modify: `sidecar/tests/test_torch_free_gate.py` → rename to
  `sidecar/tests/test_runtime_gate.py`; `scripts/mirror_translate_models.py:6-7`
  (stale convert-opus-ct2.py docstring — one-line fix)

**Interfaces:** Consumes Task 1's `SKU_REQUIREMENTS` deletion (order: Task 1 first).

- [ ] **Step 1:** `git rm` the four overlay files. Repo-wide grep for their filenames;
  the only allowed remaining mentions are historical comments (judge each hit).
- [ ] **Step 2:** `git mv test_torch_free_gate.py test_runtime_gate.py`; add
  `"onnxruntime"` to `BANNED` (the file's own line-7 comment promises exactly this);
  migrate `test_base_requirements_is_the_eight_package_end_state` (the 7-package
  assertion from the deleted `test_sku_requirements.py:88-95`) into it verbatim.
- [ ] **Step 3:** full sidecar suite — count drops by the deleted file's tests, gains
  the migrated one; record the new baseline.
- [ ] **Step 4: Commit** — `chore(sidecar): one requirements file; test_runtime_gate
  bans onnxruntime (spec §9.3/§11)`

### Task 3: Bundle workflow modernization + sidecar-pytest CI job

**Files:**
- Modify: `.github/workflows/sidecar-bundles.yml` (job matrix → five platform SKUs;
  add a `$GITHUB_STEP_SUMMARY` size step per SKU mirroring `native-build.yml:98-100`;
  keep the hardening/prerelease behavior its tests pin), `.github/workflows/build.yml`
  (new `sidecar-tests` job, path-gated on `sidecar/**`)
- Test: `sidecar/tests/test_sidecar_bundles_workflow.py` (wholesale rewrite: new
  five-SKU matrix shape, `actions/upload-artifact@v6` / `download-artifact@v7`
  current pins — fixes the pre-existing 1-failure)

**Interfaces:** Consumes Task 1's SKU names. The five bundle jobs must each invoke
`build-sidecar-bundle.py --sku <new-sku>`; mac jobs: `mac-arm64` on macos-14,
`mac-x64` on macos-15-intel (mirror native-build.yml's runner choices).

- [ ] **Step 1:** rewrite `test_sidecar_bundles_workflow.py` against the TARGET
  workflow shape first (five SKUs across the job matrix, upload@v6/download@v7,
  size-summary step present, prerelease + hardening assertions preserved) — run it,
  watch it fail against the old workflow.
- [ ] **Step 2:** rewrite `sidecar-bundles.yml` to match; add the size step
  (`ls -la` + manifest bytes `| tee -a "$GITHUB_STEP_SUMMARY"`).
- [ ] **Step 3:** add the `sidecar-tests` job to `build.yml`: ubuntu-24.04, python
  3.12, `pip install -r sidecar/requirements.txt pytest scipy`, run
  `pytest sidecar/tests -q` **without** sokuji-native installed. First run it that
  way locally (fresh venv without the wheel); add `pytest.importorskip`/skip guards
  ONLY where a test genuinely needs the native module, keeping the skip count
  explicit and recorded. The job must go green wheel-less.
- [ ] **Step 4:** full sidecar suite locally (expect: the former bundles-workflow
  failure now passes → 0 failed) + `actionlint` if available (best-effort).
- [ ] **Step 5: Commit** — `ci(sidecar): five-platform bundle matrix with sizes in
  summary; sidecar pytest job (slice-3 debt)`

### Task 4: TTS lifecycle debts (M3, M5+twin, M2 ownership token, M4, F2, F4)

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_engine.py`, `translate_engine.py` (M5 twin
  only), `tts_backend.py` (F2), `native_models.py` (M4, F4)
- Test: `sidecar/tests/test_tts_engine.py`, `test_translate_engine.py`,
  `test_tts_backend.py`, `test_native_models.py`

All six are inventory item 10 with exact file:line cites — the implementer reads
those sections first. TDD each fix: failing test → fix → green.

- [ ] **Step 1 (M3):** supersede path `tts_engine.py:294-301` — pop
  `cancels[prior_mid]` if the superseded task was cancelled before its coroutine
  ever ran (add a done-callback or pop after `prior.cancel()` when
  `prior.cancelled()` and the entry survived). Test: supersede a never-scheduled
  task; assert no stale entry.
- [ ] **Step 2 (M5 + twin):** teardown ownership: `eng.init()`'s close-on-entry must
  not race a prior connection's `on_close` teardown — guard with a monotonically
  increasing init-generation token checked by the teardown closure (a stale
  teardown no-ops). Apply the identical fix to `translate_engine.py:28`'s twin.
  Tests for both: stale teardown after re-init must not close the new engine.
- [ ] **Step 3 (M2):** ownership token on `TtsEngine`: record the owning `conn` at
  `tts_init`; `tts_cancel`/`tts_generate` from a different live connection than the
  owner → clear wire error (`code: "not_owner"`-shaped message via the existing
  error path), owner change happens only through `tts_init` (which evicts, as
  today, but now records the new owner). Test: two fake connections; second's
  cancel does not touch first's stream; second's init evicts and takes ownership.
- [ ] **Step 4 (M4):** `delete_model(model_id, repo=None)` deletes EVERY cached rung
  of the model (iterate the model's variant repos), not just the default-resolved
  one; staging pruned for each. Test: download-fake two rungs, delete with
  repo=None, assert both gone and status not-ready.
- [ ] **Step 5 (F2):** `_stage_for_native` catches `FileExistsError` from `os.link`
  → re-run the exists+samefile check and return if satisfied (another loader won);
  only genuine link failure falls to copy (which uses the realpath'd source
  already). Test: pre-create the staged link between check and link (monkeypatch
  os.link to simulate) — no copy performed.
- [ ] **Step 6 (F4):** `delete_model`'s early return at `native_models.py:428-429`
  (`cache is None`) must still prune the model's staged tree. Test: staging exists,
  scan_cache_dir raises → staged tree removed, return 0.
- [ ] **Step 7:** full sidecar suite; record baseline. Commit —
  `fix(sidecar): TTS/translate lifecycle debts M2-M5, F2, F4 (slice-4 ledger)`

### Task 5: Translate teardown UAF + disconnect-triggered cancel (no new wire message)

**Files:**
- Modify: `sidecar/sokuji_sidecar/translate_backend.py` (worker tracking +
  cancel event), `translate_engine.py` (set cancel on teardown before unload)
- Test: `sidecar/tests/test_translate_backend.py`, `test_translate_engine.py`

**Ruling (controller):** no `translate_cancel` wire message this slice —
`max_tokens=512` bounds worst-case latency and no client sends one; the real defects
are (1) `unload()` can free the native handle while an executor thread is inside
`chat()/complete()` (the exact class Task-I3 fixed for TTS), and (2) a disconnected
client's generation runs to completion for nothing.

- [ ] **Step 1:** port the TTS worker-registry pattern (`tts_backend.py:87-98`) to
  `NativeTranslateBackend`: register the executor-side translate in a worker list
  with a `threading.Event`; `on_token` returns `False` when the event is set
  (binding cb-False → clean native cancel); `unload()` sets every event then joins
  workers under a deadline before freeing the model. TDD with a slow fake.
- [ ] **Step 2:** `_translate_teardown` sets the cancel event(s) first, then closes —
  disconnect mid-generation now cancels within one token. Test: teardown during a
  fake in-flight translate → thread joined, no use-after-unload, output discarded.
- [ ] **Step 3:** full sidecar suite; ledger note that the wire-level cancel remains
  deliberately absent (R-ruling recorded by controller). Commit —
  `fix(sidecar): translate unload joins in-flight work; disconnect cancels via
  token callback`

### Task 6: Renderer clone pre-gating + inert nativeCatalog fallbacks

**Files:**
- Modify: `src/components/Settings/sections/NativeVoiceSection.tsx` (and the
  session-start / generate trigger surface located in Step 1),
  `src/lib/local-inference/native/nativeCatalog.ts:307-311,355-358`
- Test: colocated .test.tsx/.test.ts files

- [ ] **Step 1:** trace where a native_tts synthesis is actually triggered for a
  clone-required family (participant session start in MainPanel vs settings
  preview) — write the finding into the task report before coding.
- [ ] **Step 2:** gate it: when `voiceCapability(model)` is clone-only
  (`builtin==='none' && custom==='clip'`) and no clip is stored for that model,
  disable the trigger with a tooltip/i18n message ("set a voice clip first") at
  the trigger surface(s) found in Step 1. Add locale keys (en + ja + zh minimum;
  other locales fall back to en). Tests: clone-only model without clip → disabled
  + message; with clip → enabled; preset family unaffected.
- [ ] **Step 3:** delete the two documented-inert fallbacks in `nativeCatalog.ts`
  (`_onnx`→'ONNXRuntime' at 310, the MLX repo-hiding guard at 355-358) and update
  the two T6-era tests that documented their inertness to instead pin their
  absence. tsc must not rise; vitest green.
- [ ] **Step 4: Commit** — `feat(renderer): clone-required families gate synthesis on
  a stored clip; drop inert ONNX/MLX fallbacks`

### Task 7: MOSS sampling fix + parity/loopback rebase

**Files:**
- Modify: `native/src/sk_tts.cpp:158-159` (per-family override),
  `native/tests/parity/test_tts_parity.py` (moss_text case),
  `sidecar/tests/test_tts_engine.py` (loopback MOSS expectations)
- Read first: `.superpowers/moss-eoc-verdict.md` (the experiment this fix rests on)

**Ruling (controller, R-ledgered):** MOSS stays recommended (jiangzhuo 2026-09-01);
therefore it must not run away. `moss_tts_nano` gets `do_sample=true` (seed stays
`"0"` — fixed-seed sampling is deterministic per build); every other family keeps
greedy. R7's determinism goal survives; bit-parity with the greedy fork reference
does not, by design.

- [ ] **Step 1:** family-table flag in `sk_tts.cpp` (e.g. `bool sample_decode`) set
  only for moss; request build emits `do_sample=true` for it. Comment cites the
  verdict file's numbers (greedy: 300-frame cap 3/3; sampled: EOC 3/3, 2.6-3.7s).
- [ ] **Step 2:** rebuild cpu lane; run the moss C test + binding test (durations
  should collapse from ~24s to ~3-4s; assertions on duration<10s replace any
  cap-shaped expectations).
- [ ] **Step 3:** parity `test_moss_text_only`: try same-seed sampled parity against
  the official CLI (`--request-option do_sample=true --seed 0`) — if ≤1 LSB holds,
  keep it; if not, replace the sample-compare with duration-below-cap + whisper
  transcript containing the marker words, xfail nothing, and record the ruling in
  the test comment. Run the full parity suite.
- [ ] **Step 4:** loopback MOSS leg: full sentence expected now (drop the 8s-retry
  fallback if the full transcript is reliably complete; keep if not — judge and
  document). Run the full loopback once (all five legs green).
- [ ] **Step 5:** rebuild + reinstall the wheel; full sidecar suite. Commit —
  `fix(native): moss_tts_nano samples with fixed seed — greedy never reaches EOC
  (moss-eoc-verdict)`

### Task 8: GB10 Vulkan TTS validation; restore earned tiers

**Files:**
- Create: `native/build/vulkan/` (local build, not committed)
- Modify: `sidecar/sokuji_sidecar/catalog.py:677` region (per-family tier
  restoration ONLY for passing families), affected catalog/planner tests
- Test: extend the loopback or a bench script to accept a device parameter

- [ ] **Step 1:** build the vulkan lane locally (`bash native/ci/build.sh ql
  manylinux_2_39_aarch64`-style — read build.sh for the exact vulkan flavor arg;
  GB10 featcode `ql`).
- [ ] **Step 2:** for each of the five families with a cached model: load with the
  explicit vulkan device, synth the standard sentence, whisper-loopback the
  output; record per-family PASS/FAIL + timings + any abort text. Supertonic's
  Metal-style abort may or may not reproduce on Vulkan — that is the question.
- [ ] **Step 3:** for families that PASS: catalog gains `"gpu-vulkan"` in a
  per-family tier override (structure: a `_TTS_TIER_OVERRIDES: dict[family,
  tuple]` consulted by `_tts_gguf_row`, default `_TTS_TIERS`), with a comment
  naming this validation run. Families that fail stay cpu-only with the failure
  recorded. Update tier-pinning tests accordingly. Metal stays off everywhere
  (no box).
- [ ] **Step 4:** full sidecar suite + the R19-touched tests; targeted vitest
  (TierIcon renders gpu-vulkan already — no TS change expected). Commit —
  `feat(catalog): restore gpu-vulkan TTS tiers for families validated on GB10
  (R19 follow-up)`

---

## Execution notes (controller)

- Spec row-5's "tiers" bullet is VERIFIED COMPLETE (inventory item 1: sidecar and
  renderer tier vocabulary already cpu/gpu-vulkan/gpu-metal everywhere) — no task;
  the one tier-flavored leftover (`hasNvidia`) is Task 1's to delete. "setup.sh"
  and "nativeModelStore" are likewise already at target except the SKU-string
  touches Task 1 makes.
- Order: 1 → 2 → 3 sequential (shared files); 4 → 5 sequential (engine twins);
  6 anytime after 1; 7 → 8 last (8 wants 7's rebuilt tree, and 8's wheel swap
  changes the venv — rerun the sidecar suite after).
- The slice gate ("five bundles built with sizes printed") is proven at the CI dry
  run after all tasks land — the same temp-trigger flow as slices 2-4, now also
  triggering `sidecar-bundles.yml` (needs its own temp branch trigger).
- Open items deliberately NOT in this slice: Metal TTS restoration (needs an
  Apple-GPU box — jiangzhuo decision), `translate_cancel` wire message (YAGNI
  ruling, Task 5), HF repo rename `pocket-tts-en-onnx` (external, jiangzhuo's
  account).
