# Sidecar ggml-only — Slice 6 (release) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the ggml-only runtime: `native-v1.0.0` (five wheels), wire the wheels
into `requirements.txt`, ship `sidecar-v0.2.0` (five bundles that actually contain
sokuji-native — today's bundles are hollow), run the five-SKU smoke matrix, and land
the docs/memory deliverables. Spec §10 row 6.

**Architecture:** No new code systems. Release plumbing already exists (native-build.yml
release job publishes wheels on `native-v*` tags; sidecar-bundles.yml publishes bundles
on `sidecar-v*` tags; the Electron app downloads by `package.json.sidecarVersion`).
Ground truth: `.superpowers/slice6-release-inventory.md` (REQUIRED READING — the
hollow-bundle finding, version plumbing, blockers) + the memory decisions of 2026-09-02.

**Spec:** docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md §4.6, §9.3,
§10 row 6 (gate: five-SKU live smoke matrix), §11.

## Global Constraints

- Branch `refactor/sidecar-ggml-only-slice6` from merged main `ea0ed06b`. Baselines:
  sidecar 715/0/12, electron 411, tsc 534, ctest 5/5, parity 17/3sk, native 0.6.1.
- Decisions (jiangzhuo 2026-09-02): #459 merged FIRST (done); versions **native-v1.0.0**
  and **sidecar-v0.2.0** (clean break from the ONNX-era 0.1.x line); release notes on
  the GitHub Releases themselves (no root CHANGELOG.md revival); sidecar/native ship
  first, the app's `sidecarVersion` bump rides the next normal app release; Metal ships
  M4-validated with the real-M1 gap documented; win-x64 GPU smoke on the .13 box
  (jiangzhuo boots it on request).
- Ruling R37 (as executed, see R38 below): the two Linux lanes move to **ubuntu-22.04**,
  wheel tags **manylinux_2_35_{x86_64,aarch64}**. The original text said "LunarG's jammy apt
  repo for glslc"; that was rejected in Task 1's review (LunarG's jammy repo has no arm64
  index and its libvulkan-dev ships no headers) and replaced by **Ruling R38**: glslc plus the
  Vulkan/SPIRV headers are built from pinned Khronos sources by `native/ci/vulkan-toolchain.sh`
  and cached per pin — `native/README.md` documents the shipped recipe. Evidence: the Ubuntu box
  built the vulkan lane green on 22.04/gcc-11 with max glibc symbol 2.34
  (.superpowers/linux-x64-vulkan-validation.md §9); 2.39 wheels excluded 22.04/Debian-12
  /RHEL-9 users for no reason. sidecar-bundles.yml linux jobs move to 22.04 too (the
  bundled python-build-standalone is portable; only the wheel floor matters).
- ORDERING IS HARD: native-v1.0.0 must exist (assets downloadable) BEFORE
  requirements.txt can pin its URLs; requirements.txt must carry the URLs BEFORE a
  sidecar bundle is built non-hollow; sidecar-v0.2.0 last.
- **Every push and every tag to `kizuna-ai-lab/sokuji` is jiangzhuo-gated, per act**
  (the controller asks; a task NEVER pushes). Both release workflows publish
  `prerelease: true` — electron-updater's "latest" is never affected.
- Worktree Bash guard: runner scripts under `/home/jiangzhuo/.claude/jobs/387091ff/tmp/`;
  explicit-pathspec commits; never `git stash`; never push from a task.
- Fleet (memory `sokuji-test-fleet`): GB10 local (Vulkan, glibc 2.39); Ubuntu 22.04 at
  `jiangzhuo@192.168.1.13` (dual-boot — ask jiangzhuo to boot the right OS); Windows at
  `jiang@192.168.1.13`; Mac mini M4 at `192.168.1.15`.

---

### Task 1: Release prep — version 1.0.0 + R37 lanes

**Files:**
- Modify: `native/CMakeLists.txt` (VERSION 0.6.1 → 1.0.0), `native/tests/test_common.cpp`
  (version literal), `.github/workflows/native-build.yml` (linux runners → ubuntu-22.04,
  LunarG glslc install step, plat tags manylinux_2_35_*, stale "24.04 because glslc"
  comment), `.github/workflows/sidecar-bundles.yml` (linux runners → 22.04),
  `native/ci/check_linux_deps.py` (CXX_CEILINGS row for the 2.35 floor: GLIBCXX 3.4.30 /
  CXXABI 1.3.13 measured on the Ubuntu box), `native/README.md` (floor + release section),
  `sidecar/tests/test_sidecar_bundles_workflow.py` (runner pins if asserted)
- LunarG jammy repo install (from linux-x64-vulkan-validation.md): add LunarG's apt
  source for jammy and `apt-get install shaderc` (glslc is statically linked), keep
  `libvulkan-dev spirv-headers` from Ubuntu (verify the 22.04 spirv-headers ships the
  CMake config; if not, LunarG's package or the extracted-config trick — the Ubuntu box
  recipe documents what worked).

- [ ] **Step 1:** version bumps (both sites); local cpu rebuild → ctest 5/5, native
  python green, parity 17/3sk; wheel rebuild+reinstall to venv (1.0.0); full sidecar
  suite 715/0/12.
- [ ] **Step 2:** workflow edits (runners, glslc source, plat tags, comments); YAML
  sanity; workflow-pinning test updated; the tag-vs-version guard must accept 1.0.0.
- [ ] **Step 3:** Commit — `chore(release): native 1.0.0; linux lanes to ubuntu-22.04 +
  LunarG glslc, wheels manylinux_2_35 (R37)`
- [ ] **Step 4 (controller, gated):** temp trigger → push → native-build dry run green
  ×5 with 2_35 wheel names → remove trigger → push. Then jiangzhuo tags
  `native-v1.0.0` (or approves the controller doing it) → release job publishes the
  five wheels as a prerelease. Verify: five assets downloadable, names exact.

### Task 2: requirements.txt wheel URLs + setup.sh override semantics

**Files:**
- Modify: `sidecar/requirements.txt` (five `sokuji-native @ https://github.com/
  kizuna-ai-lab/sokuji/releases/download/native-v1.0.0/<wheel> ; <markers>` lines —
  markers per platform/machine: linux×{x86_64,aarch64} 2_35, win_amd64, macosx arm64/
  x86_64; verify pip marker syntax for macOS arch via platform_machine arm64 vs x86_64),
  `sidecar/setup.sh` (local dist / $SOKUJI_NATIVE_WHEEL becomes override-only: if
  present install it AFTER -r requirements.txt to shadow the release wheel; otherwise
  trust requirements), `sidecar/tests/test_runtime_gate.py` (the eight-package assertion
  now must accept the sokuji-native URL lines — adjust to assert exactly 7 PyPI names +
  5 sokuji-native URL lines with correct markers)
- Verify: `scripts/build-sidecar-bundle.py` needs zero changes (its pip -r now pulls
  the right wheel per platform) — prove by a LOCAL bundle build for linux-arm64 on GB10
  and unpacking the archive: `sokuji_native/_native/libsokuji_native.so` present,
  `import sokuji_native; version()` == 1.0.0 from the bundle's own interpreter (the
  slice-6 inventory's hollow-bundle finding is the regression this guards).

- [ ] Steps: failing runtime-gate test first → requirements lines → setup.sh → local
  fresh-venv install test (linux-arm64 marker resolves, wheel downloads, imports) →
  local bundle build + unpack assertion → full sidecar suite → commit
  `feat(sidecar): pin sokuji-native 1.0.0 release wheels in requirements.txt; bundles
  are no longer hollow`

### Task 3: sidecar-v0.2.0

**Files:**
- Modify: `package.json` `sidecarVersion` → `0.2.0` (root only — the app-release
  five-site rule concerns the APP version; verify nothing else pins sidecarVersion:
  grep), release-notes body text for the sidecar release (hand to the controller).
- [ ] Local: bundle build for linux-arm64 with `--version 0.2.0` → archive name
  `sidecar-linux-arm64-v0.2.0.tar.zst`, manifest sane, wheel inside. Sidecar suite,
  electron tests (bundle-name fixtures?), tsc. Commit —
  `chore(release): sidecarVersion 0.2.0 — first ggml-only bundle line`
- [ ] **(controller, gated):** dry run sidecar-bundles via temp trigger (five bundles,
  sizes, wheel-in-archive spot check from the artifact) → remove trigger → jiangzhuo
  tags `sidecar-v0.2.0` → release publishes five bundles + merged manifest. Verify
  assets + manifest.json.

### Task 4: Five-SKU smoke matrix

**Files:**
- Modify: `.github/workflows/sidecar-bundles.yml` (extend the linux-arm boot-smoke
  pattern to the mac-arm64/mac-x64/win-x64/linux-x64 jobs — boot the packed bundle's
  python, `import sokuji_sidecar` + `sokuji_native.version()`, one CPU whisper-tiny
  decode if the model cache allows; keep it under a minute per job), plus a
  fleet-smoke runner script (gitignored scratch is fine) for the live legs.
- [ ] CI boot-smoke ×5 (rides Task 3's dry run or a follow-up trigger — coordinate
  with the controller).
- [ ] Live matrix from the PUBLISHED v0.2.0 assets: GB10 = linux-arm64 bundle
  (download, unpack, boot, ASR+translate+TTS one round, Vulkan device visible);
  Ubuntu box = linux-x64 (glibc 2.35 floor proof on real hardware); M4 = mac-arm64
  (Metal visible); Windows box = win-x64 (jiangzhuo boots it); mac-x64 = CI boot-smoke
  only (no box) — documented. Record a matrix table; failures = fix rounds.
- [ ] Commit (workflow) — `ci(sidecar): boot-smoke every bundle job (five-SKU matrix)`

### Task 5: Docs + memory close-out

**Files:**
- Modify: `CLAUDE.md` ("Native runtime" section rewrite: sk_* ABI, three engines on one
  ggml 0.22, five SKUs/lanes, tiers incl. R36 Metal, versions and where they live,
  release flow native→requirements→sidecar→app, the smoke matrix, thread policy,
  known gaps: real-M1, moss bf16 Vulkan peak), `native/README.md` release section,
  release-notes bodies for both GitHub releases (controller applies via gh, gated).
- Memory: final arc close-out entry (controller writes at slice end).
- [ ] Commit — `docs: ggml-only runtime section in CLAUDE.md; release notes`

### Task 6: Final review + integration

- [ ] fable whole-branch review of the slice-6 branch; one fix wave; then (gated)
  push + PR into main (per house rule: a PR, since main now carries the refactor —
  ask jiangzhuo whether direct PR merge or another route).

---

## Execution notes (controller)

- Gates between tasks are HUMAN acts: T1's tag, T3's tag, every push. Batch asks.
- The sidecar-tests CI job (wheel-less by design) will START installing the release
  wheel once requirements.txt carries URLs — its runtime grows and its importorskip
  guards go live. Watch its first run after T2; if the wheel download is flaky in CI,
  gate the URL lines behind a marker CI can't satisfy? No — accept and observe.
- Windows box needed only for T4's live leg — ask jiangzhuo to boot Windows then.
- qwen3-tts-1.7b bf16, real-M1 Metal, moss bf16 Vulkan clipping: documented gaps, not
  release blockers (inherited list in memory sokuji-native-slice5b-status).
