# Native engine bump: ggml 0.25.3 + audio.cpp 0.8.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `libsokuji_native` from ggml 0.22.0 + audio.cpp 0.7.1 to the latest releases, ggml 0.25.3 + audio.cpp 0.8.2 (hotfix tag). The two other engines move with them, to the releases their own upstreams built on ggml 0.25: transcribe.cpp 0.2.4 and llama.cpp v0.5.0. transcribe.cpp 0.2.4 also brings a new ASR card (Granite Speech 5.0 TurboCTC). The result ships as `native-v1.2.0` and `sidecar-v0.4.0`. The only user-visible changes are that card and punctuated output from SenseVoice/Canary.

**Architecture:** One pristine upstream ggml stays under all three engines. The bump runs one engine per commit, so a regression bisects to one upstream: ggml first, then transcribe.cpp, then llama.cpp, then audio.cpp. audio.cpp's forked ggml gained 21 private symbols since 0.7.1. `native/src/audiocpp_compat.h` absorbs the ones our build reaches, following the same (A)/(B)/(C) discipline ruling R11 set. Every other gate from `native/README.md` "Bumping a pin" runs unchanged: patch anchors, TTS op recordings re-taken on a GPU, parity against a rebuilt reference CLI, the fleet smoke.

**Tech Stack:** CMake FetchContent pins (`native/cmake/upstreams.cmake`), exact-text patch specs (`native/patches/*.json` via `cmake/patch_upstream.py`), C/C++ CTest (`native/tests`), pytest (`native/python/tests`, `native/tests/parity`, `sidecar/tests`), GitHub Actions (`native-build.yml`, `sidecar-bundles.yml`).

**Spec:** none. This is a maintenance bump, and the survey below (run 2026-09-25 against source tarballs of every pinned and target commit) is its design record. The executor re-verifies each claim at the step that depends on it.

## Survey (2026-09-25)

| upstream | pinned today | target | commit | why this commit |
|---|---|---|---|---|
| ggml | v0.22.0 `34dc0e55` | **v0.25.3** | `353b63b439f27ab2cc19dac97ab1681ba6d2d084` | latest tag, = master HEAD (2026-09-24) |
| audio.cpp | v0.7.1 `c4dde1c2` | **v0.8.2-audio8-perf-hotfix** | `ac16661d144f00f84ea0483f3574c374c9868e2d` | NOT plain v0.8.2 (`4d88768f`): the hotfix tag is 14 commits ahead and carries #677 (Nemotron-3 diarization NeMo parity) and #670/#671 (pocket_tts fixes — a family we ship) |
| transcribe.cpp | v0.2.3 `63a44d92` | **v0.2.4** | `7d37cea2248a1fb6aca9652a1d37debccbbb1ff3` | vendors ggml 0.25.3 itself (0.2.3 vendored 0.20.2); adds arch `granite5_ctc` |
| llama.cpp | v0.3.0 `c1d0e7a0` | **v0.5.0** | `7fe450e19305b828c199d602c23a8337aaa1f03b` | in-tree ggml 0.25.1 (v0.3.0's was 0.22.0) |

Facts the tasks rely on:

1. **ggml public API**: no function was removed between 0.22.0 and 0.25.3, and five were added. `ggml_permute` widened its internal `ne`/`nb` locals from `int` to `int64_t`/`size_t`, which is a fix.
2. **`ggml-backend-impl.h`** changed in exactly one place we mirror: `ggml_backend_i::graph_optimize` gained a third parameter (`struct ggml_backend_graph_optimize_params *`). Member count and order are unchanged: 16 / 15 / 5 / 7. `GGML_BACKEND_API_VERSION` is still 2. `sk_ops_record.cpp`'s recording device passes `nullptr` in that slot.
3. **Vulkan driver priorities** in `ggml_vk_instance_init` have the same values as 0.22.0 (now ~line 5151). The dedup and eligibility code around them still has to be re-read line by line (Task 1).
4. **Every patch anchor still matches exactly once** against its target: all six ggml specs against 0.25.3, `audio.cpp.json` against ac16661, `transcribe.cpp.json` against 0.2.4. ggml 0.25.3's Metal backend still has no `DIAG_MASK_INF` and no leading-edge `PAD`, and `gguf.cpp` still reads arrays element by element, so all three of those patches are still needed.
5. **llama.cpp v0.5.0** still guards `if (NOT TARGET ggml AND NOT LLAMA_USE_SYSTEM_GGML)` and removed none of the `LLAMA_API` functions v0.3.0 had.
6. **audio.cpp fork ggml**: its version string still says 0.12.0, which means nothing. Against upstream 0.25.3 it declares 28 private functions (7 are already in `audiocpp_compat.h`) and 7 private enum types. Callers inside always-compiled code (`src/framework/**` is in `engine_core`) or inside our nine families:
   - `ggml_mul_mat_acc`: `framework/modules/conv_modules.cpp:253`, taken only on the **Metal** per-tap conv1d fast path when `in_channels >= 64 && output_frames > 8`. The line after it is the fork's own `ggml_add(acc, ggml_mul_mat(...))` fallback.
   - `ggml_round_bf16`: `framework/modules/transformers/qwen_decoder.cpp:284` (gated by `policy.fused_round`) and `qwen_causal_decode_runtime.cpp:128` (non-Metal). The fork's own comment says it equals the f32→bf16→f32 cast round trip.
   - `ggml_mul_mat_set_lowering` (`linear_module.cpp:95`) and `ggml_concat_set_lowering` (`structural_modules.cpp:341`): CUDA-only lowering hints, each behind a config flag.
   - `ggml_rope_interleaved_pairs`: `primitive_modules.cpp:326`. The only module user is `community_models/liveavatar`, which we do not build.
   - `wan_video_vae_runtime.cpp` (always compiled; the only user is a video codec we never call) references `ggml_conv_3d_concat_pad_spatial_gemm_ex`, `ggml_conv_3d_concat_pad_spatial_gemm_set_lowering`, `ggml_im2col_2d_set_lowering`, `ggml_im2col_3d_set_lowering`, `ggml_rms_norm_channels`, `ggml_rms_norm_channels_silu`, `ggml_rms_norm_channels_add_bias_silu`, `ggml_rms_norm_channels_set_lowering` and `ggml_mul_mat_set_lowering`, plus six enum types.
   - No fork-private function is called directly inside the nine family directories or `nemotron_3_diar`.
7. **R11 (B) rescan** of `ggml.c`: shared constructors whose bodies differ between the fork and upstream went from 20 to 22. The two new ones are harmless. `ggml_nbytes` gains extra bytes only for the fork-private `I8_S`/`I2_S` types. `ggml_permute` is the upstream widening from fact 1. The four conv constructors still differ only in the im2col dtype, so section (B) of the compat header stands. Kernel contracts, like (C)'s `ggml_sub`, are not covered by a constructor diff. The TTS→ASR loopback in Task 5 is what catches those.
8. **audio.cpp 0.8.2 CMake**: no option was removed. New options (`AUDIOCPP_BUILD_C_API`, default OFF; `AUDIOCPP_BUILD_BACKENDS`, a string built from `ENGINE_ENABLE_*`; and others) need nothing from us. All nine of our families are still registered; `moss_tts_nano` still rides the `moss_tts_local` target's alias list. `pocket_tts` now advertises `streaming` in its spec. This plan leaves our `kFamilies` row at `streaming=false` (a follow-up, see Out of scope).
9. **Version literals that hard-code today's pins** (the complete list is in Task 6): `native/tests/test_common.cpp:27-30,288`, `native/python/tests/test_sokuji_native.py:65-68`, `native/include/sokuji_native.h:185` (comment), `native/python/sokuji_native/__init__.py:139` (comment), `native/tests/test_ops_format.cpp:12` (fixture string, no need to change), the `# engine:` provenance line of every `native/src/ops/*.ops` (rewritten by re-recording), and prose in `native/README.md`, `native/cmake/ggml_options.cmake`, `native/src/audiocpp_compat.h`, `native/src/sk_ops_record.cpp:116`, `native/src/sk_vk_enum.{cpp,h}` and `native/tests/parity/*`.

## Decisions taken as defaults (jiangzhuo may overrule before execution)

- **D1** Also bump transcribe.cpp (0.2.4) and llama.cpp (v0.5.0) here. Today both run on a ggml their upstream never built them against. After this bump each one runs on the ggml its own release shipped with. Each is its own task and commit, so either can be dropped.
- **D2** Pin audio.cpp to the hotfix tag `ac16661d`, not `v0.8.2`. Reason: fact in the Survey table.
- **D3** Version numbers: native **1.2.0**. The ABI stays 2 (`SK_ABI_VERSION_NUM` unchanged), because no `sk_*` signature changes. Sidecar **0.4.0**. The minor bump reflects three ggml minors plus behaviour changes in pocket_tts; version numbers are cheap.
- **D4** Nemotron-3 diarization is **not** compiled in here. Adding `nemotron_3_diar` to `AUDIOCPP_MODELS` belongs to the diarization feature plan, together with its `sk_diar_*` ABI. This bump only makes that plan possible.

## Global Constraints

- **Exactly one shared ggml and no duplicated module code in the wheel** (jiangzhuo, 2026-09-25: bundle size). Every engine links the single upstream ggml target; no engine may compile its vendored ggml (transcribe.cpp 0.2.4 ships one in `ggml/`, audio.cpp in `external/ggml`, llama.cpp in `ggml/`), and no upstream option that builds an extra shared library may be enabled (audio.cpp's new `AUDIOCPP_BUILD_C_API` stays OFF). Task 0's gate enforces this on every build. Baseline to compare against, the native-v1.1.0 linux-arm64 wheel: 24.5 MB, containing exactly `libggml`, `libggml-base`, `libggml-vulkan`, six `libggml-cpu-armv8.*` variants and `libsokuji_native.so` (12.9 MB; 0 exported `ggml_*`, 287 imported).
- One pristine upstream ggml. Never build or link audio.cpp's `external/ggml` fork. If a family misbehaves, port that op into `audiocpp_compat.h` (the rule in that header's preamble).
- Pins are release-tag commit SHAs with `GIT_SHALLOW TRUE` (upstreams.cmake header comment). All four targets above are tag commits.
- Engine version strings are normalised: no `v`, no suffix. `SOKUJI_AUDIOCPP_VERSION` becomes `"0.8.2"` (the `-audio8-perf-hotfix` suffix is dropped, the same way llama's tag is normalised).
- English only in code, comments and docs. Conventional commits. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Outward acts need jiangzhuo's explicit go, each time, naming the target**: pushing a branch, opening a PR, a `workflow_dispatch` run, any tag. Task 7 marks each one with **ASK FIRST**.
- Release order is fixed (CLAUDE.md "Versions"): native tag → wheels exist → `sidecar/requirements.txt` five URLs + `sidecar/tests/test_runtime_gate.py` + root `package.json` `sidecarVersion`, in ONE commit on main → sidecar tag on that commit.
- Bundle smokes run with `PYTHONNOUSERSITE=1`.

## Review Focus

1. **Metal-only paths**: `ggml_mul_mat_acc` (per-tap conv1d) and our two Metal patches are exercised only on Apple hardware. If GB10 Vulkan passes, that proves nothing about the M4 (lesson from the 1.0.2 per-lane table). Task 7's fleet step must synthesise every family on the M4 and compare it against the 1.1.0 wheel.
2. **Silent numeric drift from a kernel-contract change** (the class of R13/(C) `ggml_sub`): a new upstream assert or stride rule in a CPU/Vulkan/Metal kernel that no constructor diff can show. Expected behaviour: the process aborts loudly, or a loopback transcript degrades. Covered by the TTS→ASR loopback on every family (Task 5) and by parity (Task 5).
3. **ASR text that now arrives already punctuated** (transcribe.cpp #157: `sensevoice-small` and the `canary-*` cards switch ITN/PnC on by default). Expected: the renderer does not punctuate it a second time or split sentences twice, and a Local Native session on `sensevoice-small` produces the same sentence boundaries a user would write. No native or sidecar test can see this. Check it in the running app (Local Native, SenseVoice, one ja and one en session) during Task 7's fleet step, and compare against a punctuating cloud provider.
4. **A stale parity reference passing for the wrong reason**: after PR #496, `build_reference_cli.sh` stamps `PIN_SHA` and `test_tts_parity.py` fails on a stale reference. Expected: the first parity run after the pin moves rebuilds the reference or fails loudly. Task 5 checks the stamp explicitly.
5. **Op-coverage refusing a rung that used to run** (spec A: only the `tts` stage refuses). A re-recorded `.ops` can now contain an op or dtype that some device's `supports_op` rejects. Expected: every family × rung stays `all_supported` on GB10 Vulkan, M4 Metal and the RTX 4070 SUPER. Covered by the GPU-lane `test_ops_coverage` run (Task 5) and the fleet smoke's coverage check (Task 7).

---

### Task 0: The single-ggml gate (before any pin moves)

Today, "one shared ggml" holds only because three patch/guard lines hold (`transcribe.cpp.json`, `audio.cpp.json`'s `if(NOT TARGET ggml)`, llama's own `NOT TARGET ggml`). Nothing fails if an upstream starts building its vendored copy under a new option name. The copy would be linked statically and with hidden visibility, so it is invisible in the stripped wheel's dynamic symbol table. This gate makes it a build failure instead.

**Files:**
- Create: `native/ci/check_single_ggml.py`
- Modify: `native/ci/build.sh` (call it between `cmake --install` and `strip`)

**Interfaces:**
- Consumes: the staged tree `native/build/<lane>/stage` (unstripped at that point).
- Produces: `check_single_ggml.py <stage_dir>`, exit 0 on pass, 1 with a list of violations. Every later task's build runs it.

- [ ] **Step 1: Write the gate**

`native/ci/check_single_ggml.py`:
```python
"""Gate: the staged tree carries exactly ONE ggml, and libsokuji_native carries none of it.

usage: check_single_ggml.py <stage_dir>

jiangzhuo's rule (2026-09-25): no duplicated module code in the sidecar bundle — every engine
links the single shared ggml. Each of transcribe.cpp, llama.cpp and audio.cpp vendors its own
ggml; three patch/guard lines keep them off it today. If an upstream ever builds its copy
anyway, the copy is linked statically with hidden visibility, so the stripped wheel's dynamic
symbol table cannot show it. This runs on the UNSTRIPPED stage (build.sh calls it before
strip) and checks:
  1. libsokuji_native defines none of ggml's core symbols (any binding: nm lists locals too).
     audiocpp_compat.h's static-inline shims are local ggml_* symbols by design, which is why
     this checks a fixed set of core names rather than every ggml_* symbol.
  2. every shared library in the stage is one we ship on purpose, and each appears once.
Linux and macOS (nm). The Windows lane (build.ps1) is not gated by this script.
"""
import pathlib
import re
import subprocess
import sys

CORE = ("ggml_init", "ggml_free", "ggml_graph_compute", "gguf_init_from_file",
        "ggml_backend_sched_new", "ggml_backend_load_all")
SHIPPED = re.compile(r"^lib(sokuji_native|ggml|ggml-base|ggml-cpu(-[A-Za-z0-9_.]+)?|ggml-vulkan|ggml-metal)"
                     r"\.(so|dylib)$")


def _nm(args: list[str]) -> tuple[set[str], bool]:
    """Defined symbol names, and whether nm had any symbol table to read at all."""
    r = subprocess.run(["nm", *args], capture_output=True, text=True)
    names = set()
    for line in r.stdout.splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[1] not in ("U", "w", "v"):
            names.add(parts[2][1:] if sys.platform == "darwin" and parts[2].startswith("_") else parts[2])
    readable = r.returncode == 0 and "no symbols" not in r.stderr and bool(r.stdout.strip())
    return names, readable


def defined_symbols(lib: pathlib.Path) -> set[str]:
    """Full symbol table (locals included) plus, on Linux, the dynamic table. Fails closed:
    a stripped library cannot prove it carries no second ggml, so that is an error, not a pass
    (seen while writing this gate: a stripped copy of libggml-base read as 'no ggml here')."""
    full, readable = _nm([str(lib)])
    if not readable:
        raise SystemExit(f"check_single_ggml: {lib.name} has no symbol table — run this on the "
                         f"unstripped stage (build.sh calls it before strip)")
    if sys.platform.startswith("linux"):
        full |= _nm(["-D", str(lib)])[0]
    return full


def main(stage: pathlib.Path) -> int:
    bad = []
    libs = [p for p in stage.rglob("*") if p.is_file() and re.search(r"\.(so|dylib)(\.|$)", p.name)]
    seen: dict[str, pathlib.Path] = {}
    for p in libs:
        if not SHIPPED.match(p.name):
            bad.append(f"unexpected shared library in the stage: {p.relative_to(stage)}")
        if p.name in seen:
            bad.append(f"duplicate: {p.relative_to(stage)} and {seen[p.name].relative_to(stage)}")
        seen[p.name] = p
    host = [p for p in libs if p.name.startswith("libsokuji_native.")]
    if len(host) != 1:
        bad.append(f"expected exactly one libsokuji_native, found {len(host)}")
    else:
        dup = sorted(set(CORE) & defined_symbols(host[0]))
        if dup:
            bad.append(f"{host[0].name} defines ggml core symbols (a second ggml is linked in): {dup}")
    for b in bad:
        print(f"check_single_ggml: {b}", file=sys.stderr)
    if not bad:
        print(f"check_single_ggml: OK — {len(libs)} shared libraries, one ggml")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(pathlib.Path(sys.argv[1])))
```

- [ ] **Step 2: Prove it can fail (mutation check), then prove it passes today**

Run on the existing 1.1.0-era CPU tree (`native/build/cpu`, built from main):
```bash
cmake --install native/build/cpu --prefix "$CLAUDE_JOB_DIR/tmp/stage-probe" --component sokuji
python3 native/ci/check_single_ggml.py "$CLAUDE_JOB_DIR/tmp/stage-probe"
```
Expected: `OK — N shared libraries, one ggml`.
Mutation 1: `cp "$CLAUDE_JOB_DIR/tmp/stage-probe/libggml-base.so" "$CLAUDE_JOB_DIR/tmp/stage-probe/libsokuji_native.so"` (a "host library" that defines `ggml_init`), then re-run. Expected: exit 1, naming `ggml_init`.
Mutation 1b: `strip --strip-unneeded "$CLAUDE_JOB_DIR/tmp/stage-probe/libsokuji_native.so"`, then re-run. Expected: exit non-zero with `has no symbol table` (fails closed, never reads as a pass).
Mutation 2: in a fresh probe stage, `touch "$CLAUDE_JOB_DIR/tmp/stage-probe/libaudiocpp.so"`, then re-run. Expected: exit 1, `unexpected shared library`.
Delete the probe stage afterwards.

- [ ] **Step 3: Wire it into build.sh before the strip**

In `native/ci/build.sh`, directly after `cmake --install "$BUILD" --prefix "$BUILD/stage" --component sokuji`:
```bash
# One shared ggml, nothing duplicated (jiangzhuo's bundle-size rule): checked on the
# UNSTRIPPED stage, since a statically linked second copy vanishes from a stripped .so's
# dynamic symbol table. Linux + macOS; build.ps1 is not gated.
"$PYTHON" "$ROOT/ci/check_single_ggml.py" "$BUILD/stage"
```
Run: `SOKUJI_BUILD_RECORD=0 native/ci/build.sh none manylinux_2_35_aarch64`
Expected: the log shows `check_single_ggml: OK`, and the rest of the script is green.

- [ ] **Step 4: Commit**

```bash
git add native/ci/check_single_ggml.py native/ci/build.sh
git commit -m "ci(native): gate the stage on a single shared ggml" -m "Fails the build if libsokuji_native defines ggml core symbols (a vendored copy linked in) or the stage carries a shared library we do not ship on purpose.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: ggml 0.22.0 → 0.25.3 (engines unchanged)

**Files:**
- Modify: `native/cmake/upstreams.cmake:24-30,34` (ggml pin, version, soname comment)
- Modify: `native/src/sk_ops_record.cpp:116-125` (mirror comment; graph_optimize slot)
- Modify: `native/src/sk_vk_enum.cpp:19-23`, `native/src/sk_vk_enum.h:22` (pin comments, and code only if the re-read finds a difference)
- Modify: `native/tests/test_common.cpp:28`, `native/python/tests/test_sokuji_native.py:65`
- Test: existing CTest + `native/python/tests`

**Interfaces:**
- Consumes: nothing.
- Produces: `SOKUJI_GGML_VERSION "0.25.3"`, so `sk_engine_versions()` reports `ggml=0.25.3`. Every later task builds on this tree.

- [ ] **Step 1: Point the failing version tests at the new version**

`native/tests/test_common.cpp:28`:
```cpp
    assert(std::strstr(sk_engine_versions(), "ggml=0.25.3") != nullptr);
```
`native/python/tests/test_sokuji_native.py:65`:
```python
    assert ev["ggml"] == "0.25.3"
```

- [ ] **Step 2: Build the CPU lane and watch those two fail**

Run: `native/ci/build.sh none manylinux_2_35_aarch64` (reuses `native/build/cpu`; set `SOKUJI_BUILD_RECORD=0` to skip the record tree for now).
Expected: `test_common` FAILS on the `ggml=0.25.3` assert. Everything else passes.

- [ ] **Step 3: Move the pin**

`native/cmake/upstreams.cmake`:
```cmake
FetchContent_Declare(ggml
    GIT_REPOSITORY https://github.com/ggml-org/ggml.git
    GIT_TAG        353b63b439f27ab2cc19dac97ab1681ba6d2d084   # v0.25.3
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE
    ${_ggml_patch})
set(SOKUJI_GGML_VERSION "0.25.3")
```
In the soname comment below it, change `libggml.so.0.22.0` to `libggml.so.0.25.3`.

- [ ] **Step 4: Re-verify the two ggml-internal mirrors against the fetched tree**

a. `native/build/cpu/_deps/ggml-src/src/ggml-backend-impl.h`: confirm `struct ggml_backend_i` still has 16 members, `ggml_backend_device_i` 15, `ggml_backend_dev_caps` 5 and `ggml_backend_dev_props` 7, in the order `sk_ops_record.cpp:117-124` lists. The only expected change is graph_optimize's third parameter. Update the comment at `sk_ops_record.cpp:116`:
```cpp
/* llama.cpp / transcribe.cpp path: a device that accepts everything and forwards to CPU.
 * Member orders below are ggml v0.25.3's ggml-backend-impl.h (GGML_BACKEND_API_VERSION 2;
 * graph_optimize gained a `ggml_backend_graph_optimize_params *` third parameter in 0.25 —
 * our slot is nullptr, so only its type changed):
```
b. `native/build/cpu/_deps/ggml-src/src/ggml-vulkan/ggml-vulkan.cpp`, `ggml_vk_instance_init` (starts ~line 4987): re-read the device-eligibility filter, the duplicate-device dedup (erase-and-append order) and the `driver_priorities` table (~5151-5186) against `sk_vk_select_like_ggml` in `native/src/sk_vk_enum.cpp`. The table values are known to match. If the logic matches too, change only the two pin comments (`sk_vk_enum.cpp:19` → `PINNED to ggml v0.25.3 ggml-vulkan.cpp ggml_vk_instance_init's driver priorities (~5151-5186)`, and `sk_vk_enum.h:22` → `(ggml-vulkan.cpp:4987-5190 at v0.25.3)` with the exact span you read). If it differs, first add a failing case to `native/tests/test_vk_select.cpp` that reproduces the new ggml ordering, then change `sk_vk_select_like_ggml` until it passes.

- [ ] **Step 5: Rebuild and run everything on the CPU lane**

Run: `SOKUJI_BUILD_RECORD=0 native/ci/build.sh none manylinux_2_35_aarch64`
Expected: configure prints no `patch_upstream.py` failure. All CTest cases pass, with rc 77 skips allowed only where the model cache is absent. The Python suite passes.
If transcribe.cpp 0.2.3 or llama.cpp v0.3.0 fails to *compile* against 0.25.3, do NOT shim it. Fold Task 2 or Task 3 into this commit and note that in the commit body.

- [ ] **Step 6: Vulkan lane on GB10**

Run: `native/ci/build.sh vulkan manylinux_2_35_aarch64`
Expected: all CTest cases pass on `build/vulkan`, and `test_vk_select` passes.

- [ ] **Step 7: Commit**

```bash
git add native/cmake/upstreams.cmake native/src/sk_ops_record.cpp native/src/sk_vk_enum.cpp native/src/sk_vk_enum.h native/tests/test_common.cpp native/python/tests/test_sokuji_native.py
git commit -m "build(native): ggml 0.22.0 -> 0.25.3" -m "Every patch anchor still matches once; ggml-backend-impl.h member order unchanged (graph_optimize gained a params argument, our slot is nullptr); Vulkan driver priorities re-verified.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: transcribe.cpp 0.2.3 → 0.2.4

**Files:**
- Modify: `native/cmake/upstreams.cmake:45-53`
- Modify: `native/tests/test_common.cpp:29`, `native/python/tests/test_sokuji_native.py:66`
- Test: `test_asr`, `test_ops_coverage` (asr drift on the CPU record tree)

**Interfaces:**
- Consumes: Task 1's tree.
- Produces: `transcribe=0.2.4` in `sk_engine_versions()`.

**What 0.2.3 → 0.2.4 changes (13 upstream commits, surveyed 2026-09-25):**
- **#157**: `sensevoice` resolves `itn = DEFAULT` to ON (0.2.4 `transcribe.h:511-520`: its ITN toggle is also its only source of casing and punctuation), and `canary` turns PnC (punctuation and capitalization) on by default. `sk_asr.cpp` never sets `itn` or `pnc`; it zero-inits, which means DEFAULT. So after this bump the Local Native output of **`sensevoice-small` and the three `canary-*` cards changes from lowercase and unpunctuated to cased and punctuated**. That is the intended direction: sentence segmentation (#553) cuts on punctuation. It is still a behaviour change, and Step 5 checks it.
- **#165**: decode-budget scaling fix (can change output length where the budget used to bind).
- **#171**: runtime-error classification. The `transcribe_status` enum is unchanged (the header diff is only #157's comment plus the version), and `sk_asr.cpp:29-47` maps every code, so nothing needs to change on our side.
- #159 adds arch `granite5_ctc` (GGUF `general.architecture` = `granite_speech5_ctc`). Task 2b adds its card.
- #161 slimmer parakeet memory; the offline-voxtral patch; a conformer attention-stride fix; ggml 0.25.1 → 0.25.3 vendored.

- [ ] **Step 0: Capture the 0.2.3 baseline for SenseVoice before touching the pin**

On Task 1's CPU tree (still transcribe 0.2.3), save this as `$CLAUDE_JOB_DIR/tmp/asr_probe.py`. It is scratch and is not committed:
```python
# Transcribe transcribe.cpp's bundled jfk.wav with one GGUF on CPU; print the text.
import sys, wave, numpy as np, sokuji_native as sn
gguf, wav = sys.argv[1], sys.argv[2]
with wave.open(wav) as w:
    assert w.getframerate() == 16000 and w.getnchannels() == 1
    pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
sn.init()
cpu = next(d for d in sn.devices() if d.kind == "cpu")
m = sn.asr_load(gguf, cpu)
try:
    print(repr(m.run(np.ascontiguousarray(pcm), language="en")))
finally:
    m.unload()
```
Run:
```bash
SOKUJI_NATIVE_DIR=native/build/cpu/stage python3 "$CLAUDE_JOB_DIR/tmp/asr_probe.py" \
  ~/.cache/huggingface/hub/models--handy-computer--SenseVoiceSmall-gguf/snapshots/*/SenseVoiceSmall-Q8_0.gguf \
  native/build/cpu/_deps/transcribe-src/samples/jfk.wav | tee "$CLAUDE_JOB_DIR/tmp/sensevoice-0.2.3.txt"
```
Expected: lowercase text with no punctuation. Record it. (If a `canary-*` GGUF is cached, run the same for it.)

- [ ] **Step 1: Point the version tests at 0.2.4**

`test_common.cpp:29` → `"transcribe=0.2.4"`; `test_sokuji_native.py:66` → `assert ev["transcribe"] == "0.2.4"`.

- [ ] **Step 2: Run and watch them fail**

Run: `SOKUJI_BUILD_RECORD=0 native/ci/build.sh none manylinux_2_35_aarch64`
Expected: `test_common` FAILS on `transcribe=0.2.4`.

- [ ] **Step 3: Move the pin**

```cmake
FetchContent_Declare(transcribe
    GIT_REPOSITORY https://github.com/handy-computer/transcribe.cpp.git
    GIT_TAG        7d37cea2248a1fb6aca9652a1d37debccbbb1ff3   # v0.2.4
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE
    PATCH_COMMAND  ${Python3_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/patch_upstream.py
                   <SOURCE_DIR> ${CMAKE_CURRENT_LIST_DIR}/../patches/transcribe.cpp.json)
set(SOKUJI_TRANSCRIBE_VERSION "0.2.4")
```

- [ ] **Step 4: Build, CTest, Python suite, and the ASR drift gate**

Run: `native/ci/build.sh none manylinux_2_35_aarch64` with the model cache exported (`source native/ci/ops-env.sh` first, or `bash native/ci/ops-env.sh native/ci/build.sh none manylinux_2_35_aarch64`).
Expected: everything green. `test_ops_coverage` on `build/record` either passes, or prints a DIFF for `asr-whisper` / `asr-moonshine_streaming`. On a DIFF, re-record exactly that family: `native/build/record/lib/record_ops native/build/record/lib asr <arch> <model-path> native/src/ops/asr-<arch>.ops` (argument order: `native/tests/record_ops.cpp`). Keep the header's `# recorded-on: gpu`, then re-run the gate until it passes.

- [ ] **Step 5: Re-run the SenseVoice probe on 0.2.4 and compare**

Run Step 0's command again, writing `sensevoice-0.2.4.txt`.
Expected: the same words, now cased and punctuated (for example `"And so, my fellow Americans, ..."`). If the *words* differ beyond casing and punctuation, stop and report: that is #165's decode-budget change or a regression, not #157. Put both lines in the commit body.

- [ ] **Step 6: Commit**

```bash
git add native/cmake/upstreams.cmake native/tests/test_common.cpp native/python/tests/test_sokuji_native.py native/src/ops/asr-*.ops
git commit -m "build(native): transcribe.cpp 0.2.3 -> 0.2.4" -m "0.2.4 vendors ggml 0.25.3 itself, the version we now build on.

Behaviour change (#157): sensevoice and canary now default to ITN / PnC on; sk_asr passes DEFAULT, so Local Native output for sensevoice-small and the canary cards becomes cased and punctuated.
jfk.wav on sensevoice-small Q8_0 — 0.2.3: <line from Step 0>; 0.2.4: <line from Step 5>.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2b: ASR card for Granite Speech 5.0 470M TurboCTC (new in transcribe.cpp 0.2.4)

An arch that is new to Sokuji but already compiled in after Task 2, so this is catalog-only (CLAUDE.md "An ASR model of an architecture already compiled in"). Facts, read 2026-09-25:
- Repo `handy-computer/granite-speech-5.0-470m-turboctc-gguf`: Apache-2.0, `language: [en]`, not streaming, LibriSpeech test-clean WER 1.33 (q8_0), CPU RTF 17 on a Ryzen 4750U.
- `general.architecture` = `granite_speech5_ctc`, read with `gguf_header.read_header` from the Q4_K_M file's first 16 MiB. It is **not** the directory name `granite5_ctc`.
- Exact `lfs.size` bytes: F16 947824480, Q8_0 505606496, Q6_K 391836000, Q5_K_M 335737184, Q4_K_M 279114080. BF16 (947824480) is outside the `_tc_row` ladder and is not listed.
- The sibling `-nc` repo is CC-BY-NC-SA-4.0 and is skipped (the same roster rule that excluded canary-1b).
- Slot: sort_order **22**, between `granite-speech-4.1-2b` (20, WER 1.29) and `parakeet-tdt-1.1b` (25, WER 1.38). Default **Q8_0**, like the other sub-GB cards (WER is flat across rungs: 1.33 q8_0 vs 1.35 q4_k_m). `recommended=False`: the recommended set is a product decision, and `test_roster_is_wer_ranked` pins it at 7.

**Files:**
- Modify: `sidecar/sokuji_sidecar/catalog.py` (one row after `granite-speech-4.1-2b`)
- Modify: `sidecar/tests/test_catalog.py` (`test_roster_is_wer_ranked` count 66 → 67; new `test_granite_speech_5_turboctc_row`; a parametrize row in `test_asr_graph_family_matches_native_arch`)

**Interfaces:**
- Consumes: Task 2's engine (the arch only loads on transcribe.cpp ≥ 0.2.4). Model names cross the wire as plain strings, so there is no renderer, locale or `wire_schema.json` change. `en` is already a picker code, so `LANG_ALIASES` needs nothing.
- Produces: card id `granite-speech-5.0-470m-turboctc`.

- [ ] **Step 1: Write the failing tests**

In `sidecar/tests/test_catalog.py`, change `assert len(ids) == 66` to `assert len(ids) == 67` in `test_roster_is_wer_ranked`, and add after `test_qwen3_asr_row`:
```python
def test_granite_speech_5_turboctc_row():
    # transcribe.cpp 0.2.4 (#159): Granite Speech 5.0 TurboCTC, Apache-2.0 (the -nc sibling
    # is CC-BY-NC-SA and deliberately absent). WER 1.33 slots it between granite 4.1 2B
    # (20, 1.29) and parakeet-tdt-1.1b (25, 1.38).
    m = catalog.asr_model("granite-speech-5.0-470m-turboctc")
    assert m is not None
    assert m.name == "Granite Speech 5.0 TurboCTC (470M)"
    assert m.languages == ("en",)
    assert m.recommended is False
    assert m.sort_order == 22
    assert m.graph_family == "granite_speech5_ctc"     # GGUF general.architecture, not "granite5_ctc"
    assert m.size_bytes == 505606496
    d = m.deployments[0]
    assert (d.backend, d.compute_type, d.artifact) == (
        "native_asr", "q8_0",
        "handy-computer/granite-speech-5.0-470m-turboctc-gguf/granite-speech-5.0-470m-turboctc-Q8_0.gguf")
    assert catalog.asr_model("granite-speech-5.0-470m-turboctc-nc") is None
```
In the `test_asr_graph_family_matches_native_arch` parametrize list, append:
```python
    # transcribe.cpp 0.2.4's granite5_ctc directory reports Arch::name granite_speech5_ctc.
    ("granite-speech-5.0-470m-turboctc-Q8_0.gguf", "granite-speech-5.0-470m-turboctc"),
```

- [ ] **Step 2: Run and watch them fail**

Run: `PYTHONPATH=sidecar pytest sidecar/tests/test_catalog.py -k "wer_ranked or granite_speech_5" -v`
Expected: FAIL (`len(ids) == 66`, and `asr_model(...)` returns None).

- [ ] **Step 3: Add the row**

In `sidecar/sokuji_sidecar/catalog.py`, directly after the `granite-speech-4.1-2b` row:
```python
    # WER 1.33 — Granite Speech 5.0 TurboCTC (transcribe.cpp 0.2.4, #159): English-only
    # CTC, sub-GB and CPU-fast (RTF 17 on a Ryzen 4750U). Arch::name granite_speech5_ctc
    # (directory granite5_ctc). The -nc sibling is CC-BY-NC-SA and not listed.
    _tc_row("granite-speech-5.0-470m-turboctc", "Granite Speech 5.0 TurboCTC (470M)", ("en",),
            "handy-computer/granite-speech-5.0-470m-turboctc-gguf", "granite-speech-5.0-470m-turboctc",
            22, {"F16": 947824480, "Q8_0": 505606496, "Q6_K": 391836000,
                 "Q5_K_M": 335737184, "Q4_K_M": 279114080}, default="Q8_0", arch="granite_speech5_ctc"),
```

- [ ] **Step 4: Cache the GGUF, then run the tests including the arch check against the real engine**

```bash
curl -L -o ~/.cache/sokuji-native-tests/granite-speech-5.0-470m-turboctc-Q8_0.gguf \
  https://huggingface.co/handy-computer/granite-speech-5.0-470m-turboctc-gguf/resolve/main/granite-speech-5.0-470m-turboctc-Q8_0.gguf
PYTHONPATH=sidecar SOKUJI_NATIVE_DIR=native/build/cpu/stage pytest sidecar/tests/test_catalog.py -v
python3 "$CLAUDE_JOB_DIR/tmp/asr_probe.py" ~/.cache/sokuji-native-tests/granite-speech-5.0-470m-turboctc-Q8_0.gguf native/build/cpu/_deps/transcribe-src/samples/jfk.wav
```
Expected: all of `test_catalog.py` passes, including the load half of `test_asr_graph_family_matches_native_arch` for the new row (`sk_asr_caps.arch == "granite_speech5_ctc"`). The probe prints a correct JFK transcript. Then run the whole sidecar suite with `PYTHONPATH=sidecar pytest sidecar/tests -q`; it must be green.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sokuji_sidecar/catalog.py sidecar/tests/test_catalog.py
git commit -m "feat(sidecar): Granite Speech 5.0 TurboCTC ASR card (transcribe.cpp 0.2.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Note for Task 7: this card ships to users only with the sidecar that pins native 1.2.0. An older sidecar never sees the row, so the version gate is automatic.

---

### Task 3: llama.cpp v0.3.0 → v0.5.0

**Files:**
- Modify: `native/cmake/upstreams.cmake:72-78`
- Modify: `native/tests/test_common.cpp:30`, `native/python/tests/test_sokuji_native.py:68`
- Test: `test_translate`, `test_ops_coverage` (translate drift)

**Interfaces:**
- Consumes: Task 2's tree.
- Produces: `llama=0.5.0` in `sk_engine_versions()`.

- [ ] **Step 1: Point the version tests at 0.5.0**

`test_common.cpp:30` → `assert(std::strstr(sk_engine_versions(), "llama=0.5.0;") != nullptr);   // normalised: no "v", no suffix`
`test_sokuji_native.py:68` → `assert ev["llama"] == "0.5.0"       # normalised: the upstream tag is v0.5.0`

- [ ] **Step 2: Run and watch them fail**

Run: `SOKUJI_BUILD_RECORD=0 native/ci/build.sh none manylinux_2_35_aarch64`
Expected: FAIL on `llama=0.5.0;`.

- [ ] **Step 3: Move the pin**

```cmake
FetchContent_Declare(llama
    GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
    GIT_TAG        7fe450e19305b828c199d602c23a8337aaa1f03b   # v0.5.0 (in-tree ggml 0.25.1)
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE)
set(SOKUJI_LLAMA_VERSION "0.5.0")   # upstream tag is v0.5.0; the string is normalised like the other three
```

- [ ] **Step 4: Build and run the translation surface plus the drift gate**

Run: `bash native/ci/ops-env.sh native/ci/build.sh none manylinux_2_35_aarch64`
Expected: green. `test_translate` exercises streamed CJK output (R41's incremental UTF-8 decoder) and must still pass. On a `translate-qwen3.ops` DIFF, re-record it with flash_attn on and off merged (CLAUDE.md "A translation model"), then re-run the gate.

- [ ] **Step 5: Commit**

```bash
git add native/cmake/upstreams.cmake native/tests/test_common.cpp native/python/tests/test_sokuji_native.py native/src/ops/translate-*.ops
git commit -m "build(native): llama.cpp v0.3.0 -> v0.5.0" -m "v0.5.0's in-tree ggml is 0.25.1; the LLAMA_API surface we call is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: audio.cpp 0.7.1 → 0.8.2 hotfix, with the compat header extended

**Files:**
- Create: `native/tests/test_audiocpp_compat.cpp`
- Modify: `native/tests/CMakeLists.txt` (register the new test)
- Modify: `native/src/audiocpp_compat.h` (preamble scan status + new sections (D) and (E))
- Modify: `native/cmake/upstreams.cmake:85-104` (pin, version, line-number comment)
- Modify: `native/tests/test_common.cpp:288`, `native/python/tests/test_sokuji_native.py:67`

**Interfaces:**
- Consumes: Task 3's tree.
- Produces: `audiocpp=0.8.2` in `sk_engine_versions()`. `audiocpp_compat.h` now defines the 6 fork enum types (ssm_scan_fusion is unreferenced, so it is skipped) and these functions: `ggml_mul_mat_acc`, `ggml_round_bf16`, `ggml_mul_mat_set_lowering`, `ggml_concat_set_lowering`, `ggml_im2col_2d_set_lowering`, `ggml_im2col_3d_set_lowering`, `ggml_rms_norm_channels_set_lowering`, `ggml_conv_3d_concat_pad_spatial_gemm_set_lowering` (no-ops); `ggml_rope_interleaved_pairs`, `ggml_rms_norm_channels`, `ggml_rms_norm_channels_silu`, `ggml_rms_norm_channels_add_bias_silu`, `ggml_conv_3d_concat_pad_spatial_gemm_ex` (abort stubs).

- [ ] **Step 1: Write the failing compat test**

`native/tests/test_audiocpp_compat.cpp`:
```cpp
// Pins the audio.cpp 0.8.2 compat shims (audiocpp_compat.h sections (D) and (E)) against the
// fork's own documented equivalents, on the CPU backend of the ggml we actually build.
#undef NDEBUG   // every native test does this: the lanes build Release, and assert() is the test
#include "audiocpp_compat.h"
#include "ggml-alloc.h"
#include "ggml-backend.h"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

static ggml_backend_t g_cpu;

// Builds `out` in a fresh no_alloc context via `build`, uploads `inputs`, computes on CPU and
// returns the F32 result.
template <typename Build>
static std::vector<float> run(Build build, std::vector<std::pair<int, std::vector<float>>> inputs) {
    ggml_init_params p = {64 * ggml_tensor_overhead() + ggml_graph_overhead(), nullptr, true};
    ggml_context *ctx = ggml_init(p);
    std::vector<ggml_tensor *> ins;
    ggml_tensor *out = build(ctx, ins);
    ggml_cgraph *gf = ggml_new_graph(ctx);
    ggml_build_forward_expand(gf, out);
    ggml_backend_buffer_t buf = ggml_backend_alloc_ctx_tensors(ctx, g_cpu);
    for (auto &[i, data] : inputs) ggml_backend_tensor_set(ins[i], data.data(), 0, data.size() * sizeof(float));
    assert(ggml_backend_graph_compute(g_cpu, gf) == GGML_STATUS_SUCCESS);
    std::vector<float> r(ggml_nelements(out));
    ggml_backend_tensor_get(out, r.data(), 0, r.size() * sizeof(float));
    ggml_backend_buffer_free(buf);
    ggml_free(ctx);
    return r;
}

static std::vector<float> ramp(size_t n, float scale) {
    std::vector<float> v(n);
    for (size_t i = 0; i < n; ++i) v[i] = std::sin(0.37f * (float)i) * scale;
    return v;
}

int main(int argc, char **argv) {
    ggml_backend_load_all_from_path(argc > 1 ? argv[1] : nullptr);
    g_cpu = ggml_backend_init_by_type(GGML_BACKEND_DEVICE_TYPE_CPU, nullptr);
    assert(g_cpu);
    const int K = 96, M = 7, N = 12;   // a:[K,M] b:[K,N] acc:[M,N], in_channels>=64 like the Metal path

    // (D1) mul_mat_acc == acc + mul_mat(a, b), bit for bit: the fork's own fallback chain.
    auto a = ramp(K * M, 0.5f), b = ramp(K * N, 1.5f), acc = ramp(M * N, 3.0f);
    auto shim = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
        in = {ggml_new_tensor_2d(c, GGML_TYPE_F32, K, M), ggml_new_tensor_2d(c, GGML_TYPE_F32, K, N),
              ggml_new_tensor_2d(c, GGML_TYPE_F32, M, N)};
        return ggml_mul_mat_acc(c, in[0], in[1], in[2]);
    }, {{0, a}, {1, b}, {2, acc}});
    auto ref = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
        in = {ggml_new_tensor_2d(c, GGML_TYPE_F32, K, M), ggml_new_tensor_2d(c, GGML_TYPE_F32, K, N),
              ggml_new_tensor_2d(c, GGML_TYPE_F32, M, N)};
        return ggml_add(c, in[2], ggml_mul_mat(c, in[0], in[1]));
    }, {{0, a}, {1, b}, {2, acc}});
    assert(shim.size() == (size_t)(M * N));
    assert(std::memcmp(shim.data(), ref.data(), shim.size() * sizeof(float)) == 0);

    // (D2) round_bf16 == f32 -> bf16 -> f32, and it really rounds (1 + 2^-10 is not a bf16).
    std::vector<float> x = {1.0f + 1.0f / 1024.0f, -3.14159265f, 65504.0f, 1e-30f};
    auto rounded = run([&](ggml_context *c, std::vector<ggml_tensor *> &in) {
        in = {ggml_new_tensor_1d(c, GGML_TYPE_F32, 4)};
        return ggml_round_bf16(c, in[0]);
    }, {{0, x}});
    for (size_t i = 0; i < x.size(); ++i) {
        const float want = ggml_bf16_to_fp32(ggml_fp32_to_bf16(x[i]));
        assert(std::memcmp(&rounded[i], &want, sizeof(float)) == 0);
    }
    assert(rounded[0] == 1.0f);

    // (D3) every lowering hint is a no-op on this build: op, type and params untouched.
    {
        ggml_init_params p = {16 * ggml_tensor_overhead(), nullptr, true};
        ggml_context *c = ggml_init(p);
        ggml_tensor *mm = ggml_mul_mat(c, ggml_new_tensor_2d(c, GGML_TYPE_F32, K, M), ggml_new_tensor_2d(c, GGML_TYPE_F32, K, N));
        ggml_tensor *cat = ggml_concat(c, ggml_new_tensor_2d(c, GGML_TYPE_F32, 4, 4), ggml_new_tensor_2d(c, GGML_TYPE_F32, 4, 4), 0);
        int32_t before_mm[GGML_MAX_OP_PARAMS / 4], before_cat[GGML_MAX_OP_PARAMS / 4];
        std::memcpy(before_mm, mm->op_params, sizeof before_mm);
        std::memcpy(before_cat, cat->op_params, sizeof before_cat);
        ggml_mul_mat_set_lowering(mm, GGML_MUL_MAT_LOWERING_CUDA_NVFP4_F16_ACTIVATION);
        ggml_concat_set_lowering(cat, GGML_CONCAT_LOWERING_CUDA_CONTIGUOUS_4D);
        assert(mm->op == GGML_OP_MUL_MAT && std::memcmp(before_mm, mm->op_params, sizeof before_mm) == 0);
        assert(cat->op == GGML_OP_CONCAT && std::memcmp(before_cat, cat->op_params, sizeof before_cat) == 0);
        ggml_free(c);
    }

    ggml_backend_free(g_cpu);
    std::puts("test_audiocpp_compat: OK");
    return 0;
}
```

In `native/tests/CMakeLists.txt`, after the `test_ops_format` block:
```cmake
# The audio.cpp compat shims (src/audiocpp_compat.h (D)/(E)) against the fork's documented
# equivalents, on the ggml we build. Header-only, so compiled straight in, with ggml-impl.h
# from the ggml source tree like the engine targets that force-include it.
add_executable(test_audiocpp_compat test_audiocpp_compat.cpp)
target_include_directories(test_audiocpp_compat PRIVATE ../src ${SOKUJI_GGML_SOURCE_DIR}/src)
target_link_libraries(test_audiocpp_compat PRIVATE ggml)
add_test(NAME test_audiocpp_compat COMMAND test_audiocpp_compat ${CMAKE_BINARY_DIR}/lib)
set_tests_properties(test_audiocpp_compat PROPERTIES ENVIRONMENT "GGML_BACKEND_PATH=${CMAKE_BINARY_DIR}/lib")
```

- [ ] **Step 2: Build and watch it fail to compile**

Run: `cmake --build native/build/cpu -j --target test_audiocpp_compat`
Expected: compile errors, `ggml_mul_mat_acc` / `ggml_round_bf16` / `GGML_MUL_MAT_LOWERING_CUDA_NVFP4_F16_ACTIVATION` undeclared.

- [ ] **Step 3: Add sections (D) and (E) to `audiocpp_compat.h`**

Insert immediately before `/* ===== (C) ggml_sub`:
```c
/* ===== (D) audio.cpp 0.8.2 fork additions our build reaches ========================
 *
 * The 0.8.2 fork (audio.cpp ac16661d, base still labelled 0.12.0) adds 21 functions and
 * 7 enum types over 0.7.1. Only the ones referenced from engine_core (src/framework/**,
 * always compiled) or from our nine families are shimmed; the rest live in families we do
 * not build and never reach the linker. Survey and reachability: the 2026-09-25 bump plan,
 * docs/superpowers/plans/2026-09-25-native-ggml-0.25-audiocpp-0.8.2-bump.md, fact 6.
 * Pinned by native/tests/test_audiocpp_compat.cpp.
 *
 * Enum values are the fork's verbatim (external/ggml/include/ggml.h at ac16661d). */
enum ggml_mul_mat_lowering {
    GGML_MUL_MAT_LOWERING_DEFAULT                    = 0,
    GGML_MUL_MAT_LOWERING_CUDA_NVFP4_F16_ACTIVATION  = 2,
    GGML_MUL_MAT_LOWERING_CUDA_TILE_F16_ACCUM_OUTPUT = 3,
};
enum ggml_concat_lowering {
    GGML_CONCAT_LOWERING_DEFAULT            = 0,
    GGML_CONCAT_LOWERING_CUDA_CONTIGUOUS_4D = 1,
};
enum ggml_im2col_2d_lowering {
    GGML_IM2COL_2D_LOWERING_DEFAULT           = 0,
    GGML_IM2COL_2D_LOWERING_CUDA_N_K3_PAD1_X8 = 1,
    GGML_IM2COL_2D_LOWERING_CUDA_N_K3_NOPAD_X8 = 2,
    GGML_IM2COL_2D_LOWERING_CUDA_F32_K3_TILED = 3,
};
enum ggml_im2col_3d_lowering {
    GGML_IM2COL_3D_LOWERING_DEFAULT             = 0,
    GGML_IM2COL_3D_LOWERING_CUDA_N1_K3_NOPAD_X8 = 1,
};
enum ggml_rms_norm_channels_lowering {
    GGML_RMS_NORM_CHANNELS_LOWERING_DEFAULT        = 0,
    GGML_RMS_NORM_CHANNELS_LOWERING_CUDA_COALESCED = 1,
};
enum ggml_conv_3d_concat_pad_spatial_gemm_lowering {
    GGML_CONV_3D_CONCAT_PAD_SPATIAL_GEMM_LOWERING_DEFAULT         = 0,
    GGML_CONV_3D_CONCAT_PAD_SPATIAL_GEMM_LOWERING_CUDA_C48        = 1,
    GGML_CONV_3D_CONCAT_PAD_SPATIAL_GEMM_LOWERING_CUDA_TILED_C48  = 2,
};

/* Lowering hints. In the fork each writes one op param that only CUDA kernels read
 * (e.g. ggml_mul_mat_set_lowering: ggml_set_op_params_i32(a, 1, lowering)); upstream kernels
 * have no such param, so the faithful port is to write nothing. Callers gate them on
 * CUDA-only config flags (linear_module.cpp:94, structural_modules.cpp:340), and we build no
 * CUDA lane. */
static inline void ggml_mul_mat_set_lowering(struct ggml_tensor *a, enum ggml_mul_mat_lowering l) { (void)a; (void)l; }
static inline void ggml_concat_set_lowering(struct ggml_tensor *t, enum ggml_concat_lowering l) { (void)t; (void)l; }
static inline void ggml_im2col_2d_set_lowering(struct ggml_tensor *t, enum ggml_im2col_2d_lowering l) { (void)t; (void)l; }
static inline void ggml_im2col_3d_set_lowering(struct ggml_tensor *t, enum ggml_im2col_3d_lowering l) { (void)t; (void)l; }
static inline void ggml_rms_norm_channels_set_lowering(struct ggml_tensor *t, enum ggml_rms_norm_channels_lowering l) { (void)t; (void)l; }
static inline void ggml_conv_3d_concat_pad_spatial_gemm_set_lowering(
        struct ggml_tensor *t, enum ggml_conv_3d_concat_pad_spatial_gemm_lowering l) { (void)t; (void)l; }

/* Fork: acc += a*b written in place into acc's memory (GGML_OP_MUL_MAT_ACC, a view of acc).
 * Reached only on Metal, by conv_modules.cpp's per-tap conv1d fast path when
 * in_channels >= 64 && output_frames > 8; the line after that call site is the fork's own
 * non-fused spelling, which is exactly this. Same F32 sum, one extra node, no aliasing —
 * the caller only ever uses the returned tensor. */
static inline struct ggml_tensor *ggml_mul_mat_acc(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b, struct ggml_tensor *acc) {
    return ggml_add(ctx, acc, ggml_mul_mat(ctx, a, b));
}

/* Fork: a fused GGML_UNARY_OP_ROUND_BF16, always F32 out. Its own header comment and its
 * caller (qwen_decoder.cpp:281-283) define it as the f32 -> bf16 -> f32 cast round trip,
 * which is what this builds. Reached by qwen_decoder (policy.fused_round) and by
 * qwen_causal_decode_runtime's non-Metal bf16 readback rounding. */
static inline struct ggml_tensor *ggml_round_bf16(struct ggml_context *ctx, struct ggml_tensor *a) {
    return ggml_cast(ctx, ggml_cast(ctx, a, GGML_TYPE_BF16), GGML_TYPE_F32);
}

/* ===== (E) fork ops referenced by engine_core but reachable only from families we do not
 * build: they must link, and reaching one is a bug, not a fallback (same rule as the
 * MiniMax-H3 stubs above). */
static inline struct ggml_tensor *ggml_rope_interleaved_pairs(
        struct ggml_context *ctx, struct ggml_tensor *even, struct ggml_tensor *odd,
        struct ggml_tensor *cos, struct ggml_tensor *sin) {
    (void)ctx; (void)even; (void)odd; (void)cos; (void)sin;
    GGML_ABORT("ggml_rope_interleaved_pairs: LiveAvatar op, not built in sokuji-native");
}
static inline struct ggml_tensor *ggml_rms_norm_channels(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *gamma, float eps) {
    (void)ctx; (void)a; (void)gamma; (void)eps;
    GGML_ABORT("ggml_rms_norm_channels: Wan video VAE op, not built in sokuji-native");
}
static inline struct ggml_tensor *ggml_rms_norm_channels_silu(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *gamma, float eps) {
    (void)ctx; (void)a; (void)gamma; (void)eps;
    GGML_ABORT("ggml_rms_norm_channels_silu: Wan video VAE op, not built in sokuji-native");
}
static inline struct ggml_tensor *ggml_rms_norm_channels_add_bias_silu(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *bias, struct ggml_tensor *gamma, float eps) {
    (void)ctx; (void)a; (void)bias; (void)gamma; (void)eps;
    GGML_ABORT("ggml_rms_norm_channels_add_bias_silu: Wan video VAE op, not built in sokuji-native");
}
static inline struct ggml_tensor *ggml_conv_3d_concat_pad_spatial_gemm_ex(
        struct ggml_context *ctx, struct ggml_tensor *a, struct ggml_tensor *b, struct ggml_tensor *w,
        int lp0, int rp0, int lp1, int rp1, int lp2, int rp2, enum ggml_type dst_type) {
    (void)ctx; (void)a; (void)b; (void)w; (void)lp0; (void)rp0; (void)lp1; (void)rp1; (void)lp2; (void)rp2; (void)dst_type;
    GGML_ABORT("ggml_conv_3d_concat_pad_spatial_gemm_ex: Wan video VAE op, not built in sokuji-native");
}
```

Update the preamble: at line 3 change `audio.cpp v0.7.1 (upstream c4dde1c2; ...)` to `audio.cpp v0.8.2-audio8-perf-hotfix (upstream ac16661d; re-scanned at the 2026-09-25 pin bump)`; at line 5 change `pristine upstream ggml 0.22.0` to `pristine upstream ggml 0.25.3` and `TWO ways` to `the ways below`. Add this paragraph to the end of SCAN STATUS:
```c
 * RESCAN 2026-09-25 (audio.cpp ac16661d vs ggml 0.25.3): fork-only functions 7 -> 28, of which
 * (D) shims the reachable ones and (E) stubs the link-only ones; differing shared ggml.c
 * bodies 20 -> 22, the two new ones harmless (ggml_nbytes adds bytes only for the fork-only
 * I8_S/I2_S types; ggml_permute is upstream widening int -> int64_t/size_t). (B) unchanged.
```

- [ ] **Step 4: Run the compat test and watch it pass**

Run: `cmake --build native/build/cpu -j --target test_audiocpp_compat && ctest --test-dir native/build/cpu -R test_audiocpp_compat --output-on-failure`
Expected: PASS, printing `test_audiocpp_compat: OK`.

- [ ] **Step 5: Point the audiocpp version tests at 0.8.2 and move the pin**

`test_common.cpp:288` → `assert(std::strstr(sk_engine_versions(), "audiocpp=0.8.2") != nullptr);`
`test_sokuji_native.py:67` → `assert ev["audiocpp"] == "0.8.2"`
`native/cmake/upstreams.cmake`:
```cmake
# audio.cpp's CMake adds AUDIOCPP_GGML_SOURCE_DIR as a subdirectory unconditionally
# (CMakeLists.txt line 365 at v0.8.2-audio8-perf-hotfix); the JSON patch guards that one line with
...
FetchContent_Declare(audiocpp
    GIT_REPOSITORY https://github.com/0xShug0/audio.cpp.git
    GIT_TAG        ac16661d144f00f84ea0483f3574c374c9868e2d   # v0.8.2-audio8-perf-hotfix
    ...
set(SOKUJI_AUDIOCPP_VERSION "0.8.2")   # upstream tag is v0.8.2-audio8-perf-hotfix; normalised like llama's
```
Beside the other `ENGINE_*` / `AUDIOCPP_*` cache forces lower in the same file, add:
```cmake
# 0.8.x adds a C ABI shared library (include/audiocpp.h). It defaults OFF; forced OFF so a
# changed upstream default can never put a second engine library into the wheel
# (single-shared-ggml rule, ci/check_single_ggml.py).
set(AUDIOCPP_BUILD_C_API OFF CACHE BOOL "" FORCE)
```

- [ ] **Step 6: Full CPU build**

Run: `SOKUJI_BUILD_RECORD=0 native/ci/build.sh none manylinux_2_35_aarch64`
Expected: it links, which means every fork symbol the engine targets reference is now defined. If the linker names one that is not in (D)/(E), work out its reachability the same way (grep `src/framework`, the nine family dirs) and add it to (D) or (E) with a test row in D3/D1 style. Do not guess. All CTest cases pass, `test_tts` (supertonic + moss) included. The Python suite passes, including the R39 warn-on-one moss guard.

- [ ] **Step 7: Commit**

```bash
git add native/cmake/upstreams.cmake native/src/audiocpp_compat.h native/tests/test_audiocpp_compat.cpp native/tests/CMakeLists.txt native/tests/test_common.cpp native/python/tests/test_sokuji_native.py
git commit -m "build(native): audio.cpp 0.7.1 -> 0.8.2-audio8-perf-hotfix" -m "The hotfix tag, not v0.8.2: it carries the Nemotron-3 diarization parity fix (#677) and two pocket_tts fixes (#670, #671). audiocpp_compat.h gains (D) shims for the fork ops engine_core reaches on our lanes (mul_mat_acc, round_bf16, six lowering hints) and (E) link stubs for Wan-VAE/LiveAvatar ops; test_audiocpp_compat pins them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: GPU gates on GB10: op recordings, parity, GPU synth, loopback

**Files:**
- Modify: `native/src/ops/tts-*.ops` (all nine, re-recorded), `native/src/ops/asr-*.ops` / `translate-*.ops` (only if they drift)
- Test: `test_ops_coverage` (record-vk tree), `native/tests/parity`, `native/python/tests` GPU cases, `sidecar/tests/test_tts_engine.py` loopback

**Interfaces:**
- Consumes: Task 4's tree.
- Produces: nine `tts-<family>.ops` files whose header reads `# recorded-on: vulkan` and `# engine: ggml=0.25.3;transcribe=0.2.4;llama=0.5.0;audiocpp=0.8.2;...`.

- [ ] **Step 1: Build the Vulkan record tree**

Run: `cmake -S native -B native/build/record-vk -DCMAKE_BUILD_TYPE=Release -DSOKUJI_GPU=vulkan -DSOKUJI_RECORD_OPS=ON && cmake --build native/build/record-vk -j`

- [ ] **Step 2: Run the gate to see which recordings drifted**

Run: `bash native/ci/ops-env.sh ctest --test-dir native/build/record-vk -R test_ops_coverage --output-on-failure`
Expected: DIFFs are likely (framework changed in 60 files). Record which families drift. That list goes into Task 6's README note.

- [ ] **Step 3: Re-record all nine TTS families (README rule: every bump, all nine)**

For each `<family>` in `moss_tts_nano qwen3_tts omnivoice pocket_tts supertonic voxcpm1 voxcpm2 irodori_tts index_tts2`, with `<model-dir>` taken from the matching `SK_TEST_TTS_*_DIR` export in `native/ci/ops-env.sh`:
```bash
bash native/ci/ops-env.sh sh -c 'native/build/record-vk/lib/record_ops native/build/record-vk/lib tts <family> <model-dir> native/src/ops/tts-<family>.ops "$SK_TEST_TTS_SUPERTONIC_DIR"'
head -3 native/src/ops/tts-<family>.ops   # must show "# recorded-on: vulkan" and the new engine line
```
Then rebuild (`cmake --build native/build/record-vk -j`; the glob is CONFIGURE_DEPENDS) and re-run Step 2's command.
Expected: `test_ops_coverage` PASSES with all nine TTS cases gated and none SKIPPED. Also run `ctest --test-dir native/build/record-vk -R test_common` to check the `n_tts`/`n_swept` counts, which should stay 9.

- [ ] **Step 4: Rebuild the parity reference and run parity**

Run: `bash native/tests/parity/build_reference_cli.sh` and confirm its log says it rebuilt at `ac16661d` (the PIN_SHA stamp from PR #496). Then `pytest native/tests/parity -v`.
Expected: supertonic sample-exact (max_abs == 0). Every other case within the thresholds the suite already carries. Any new failure is a Review Focus #2 candidate: find the op by bisecting the graph, then fix it in `audiocpp_compat.h`. Do not loosen a threshold.

- [ ] **Step 5: GPU synth for every family and quant rung on GB10 Vulkan**

Run: `SK_TEST_TTS_GPU=1 bash native/ci/ops-env.sh pytest native/python/tests -k tts_synthesises_on_a_gpu_device -v`
Expected: every family/quant row passes (one subprocess each).

- [ ] **Step 6: TTS→ASR loopback**

Run: `SOKUJI_RUN_TTS_LOOPBACK=1 PYTHONPATH=sidecar SOKUJI_NATIVE_DIR=native/build/vulkan/stage pytest sidecar/tests/test_tts_engine.py -v`
Expected: every leg passes. Compare transcripts with the same run on a 1.1.0 stage if one is still around; a leg that newly degrades is a Review Focus #2 finding.

- [ ] **Step 7: Commit the recordings**

```bash
git add native/src/ops/
git commit -m "chore(native): re-record op coverage on GB10 Vulkan for the 0.25.3/0.8.2 engines" -m "Drifted before re-recording: <list from Step 2>.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Version 1.2.0 and the prose sweep

**Files:**
- Modify: `native/CMakeLists.txt:8` (`project(sokuji_native VERSION 1.2.0 ...)`), `native/tests/test_common.cpp:27`
- Modify (prose only): `native/README.md` (lines 73, 263, 300, 310, 324; the "Bumping a pin" release history paragraph ~452-456; the compat-header residue section), `native/cmake/ggml_options.cmake` (lines 30, 55, 69, 80), `native/include/sokuji_native.h:185`, `native/python/sokuji_native/__init__.py:139`, `native/tests/parity/README.md:13-16`, `native/tests/parity/test_tts_parity.py:8-11,141-146`, `native/tests/parity/build_reference_cli.sh:93`, `sidecar/sokuji_sidecar/gguf_header.py:13`, `CLAUDE.md` (Native runtime bullets: "ONE pristine upstream ggml 0.22", "Current native version is 1.1.0", the pin-bump literals `transcribe=0.2.3` / `audiocpp=0.7.1` in "Adding a native model")

- [ ] **Step 1: Point the version test at 1.2.0**

`test_common.cpp:27` → `assert(std::string(sk_version()) == "1.2.0");`

- [ ] **Step 2: Run and watch it fail, bump, then watch it pass**

Run: `ctest --test-dir native/build/cpu -R "^test_common$" --output-on-failure`: FAIL. Set `project(sokuji_native VERSION 1.2.0 LANGUAGES C CXX)`, rebuild, re-run: PASS.

- [ ] **Step 3: Prose sweep**

For every file listed above, update each version statement that describes *what we build on now*. Leave any sentence that records history as history. Example: `native-v1.0.2 moved the engine pins to transcribe.cpp 0.2.3` stays, and a new sentence follows it: `native-v1.2.0 (2026-09-25) moves ggml to 0.25.3, transcribe.cpp to 0.2.4, llama.cpp to v0.5.0 and audio.cpp to 0.8.2-audio8-perf-hotfix; audiocpp_compat.h gains sections (D)/(E).` For statements about ggml behaviour (a "ggml 0.22.0's Metal backend implements no DIAG_MASK_INF" comment, for example), re-verify each one against 0.25.3 before rewording it. Facts 4 and 7 already confirm the three Metal/GGUF gaps still exist. `sidecar/sokuji_sidecar/gguf_header.py:13`: check that 0.25.3 added no `ggml_type` id a reader could meet (compare `enum ggml_type` in both `ggml.h`), then update the version in the comment.
Afterwards, this search must return only historical lines:
```bash
git grep -nE '0\.22\.0|audiocpp=0\.7\.1|transcribe=0\.2\.3|llama=0\.3\.0' -- native sidecar CLAUDE.md ':!native/src/ops' ':!sidecar/tests/test_accel.py'
```
(`sidecar/tests/test_accel.py` fixtures are fake engine dicts, and no production code reads them. Leave them.)

- [ ] **Step 4: Full sidecar suite (nothing should move)**

Run: `PYTHONPATH=sidecar pytest sidecar/tests -q`
Expected: green. The sidecar reads engine versions only for display and cache keys, and the native version change regenerates those keys by design.

- [ ] **Step 5: Commit**

```bash
git add -A native CLAUDE.md sidecar/sokuji_sidecar/gguf_header.py
git commit -m "chore(native): 1.2.0 — engines on ggml 0.25.3; prose follows the pins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CI dry run, fleet, release (every outward step is ASK FIRST)

No `sidecar-v*` tag may be cut from main between this branch's merge and the native-v1.2.0 pin
commit (Step 5): main's catalog lists `granite-speech-5.0-470m-turboctc`, which the native-v1.1.0
wheel pinned by sidecar/requirements.txt cannot load (no granite5_ctc arch).

**Files:**
- Modify (later, on main): `sidecar/requirements.txt`, `sidecar/tests/test_runtime_gate.py` (`NATIVE_RELEASE_BASE`/`NATIVE_WHEELS`), root `package.json` `sidecarVersion`

- [ ] **Step 1: ASK FIRST — push branch `worktree-native-ggml-audiocpp-bump` to `kizuna-ai-lab/sokuji` and run `native-build.yml` via `workflow_dispatch` on it (dry run, no tag)**

Expected: all five SKUs green (linux-x64, linux-arm64, win-x64, mac-arm64, mac-x64), five wheel names correct. If the gh token cannot dispatch, ask jiangzhuo to run `gh auth refresh -h github.com -s workflow`.

- [ ] **Step 1b: Wheel inventory and size against native-v1.1.0 (single-ggml rule)**

Download the five dry-run wheels (`gh run download <run>`) and the five 1.1.0 wheels (`gh release download native-v1.1.0 -R kizuna-ai-lab/sokuji -p '*.whl'`). For each SKU, list `sokuji_native/_native/*` with sizes from both (`python3 -c "import zipfile,sys; [print(i.file_size, i.filename) for i in zipfile.ZipFile(sys.argv[1]).infolist()]" <whl>`).
Expected: the same set of file names per SKU (in particular one `libggml`, one `libggml-base`, one GPU backend, the same CPU variants, and no new library). **win-x64 must be checked by hand here**, because Task 0's gate does not run on the Windows lane. Report the per-SKU wheel and `libsokuji_native` size delta in the PR body. Growth over 10% on any SKU is shown to jiangzhuo with its cause (likely audio.cpp's framework growth, 60 files) before the tag. It is not waved through.

- [ ] **Step 2: Fleet with the dry run's wheels**

`gh run download <run> -n sokuji-native-<sku>` for each box. In a scratch venv per box: `SK_TEST_TTS_GPU=1 pytest native/python/tests -k tts_synthesises_on_a_gpu_device` plus a warm-RTF measurement per family.
- Review Focus #3 check, on any one box with a packaged or dev build pointed at the dry-run wheel: a Local Native session on `sensevoice-small`, one ja and one en. Captions must be punctuated once, and sentence cuts must land on the engine's own punctuation.
- M4 Metal (`jiangzhuo@192.168.1.15`): all nine families. This is the only place `ggml_mul_mat_acc` and the Metal patches run (Review Focus #1). Compare warm RTF against the 1.0.2 table in memory (voxcpm2 1.42, index_tts2 1.77 were already slower than real time). A family that regresses by more than about 10% is a finding to report, not a blocker.
- RTX 4070 SUPER (`.13`, both OSes): Windows `win-x64` and Ubuntu `linux-x64` at the glibc 2.35 floor.
- GB10: already covered by Task 5 on a local build; rerun with the CI `linux-arm64` wheel.

- [ ] **Step 3: ASK FIRST — open a PR `worktree-native-ggml-audiocpp-bump` → `kizuna-ai-lab/sokuji` `main`**

The body carries the Survey table, the D1–D4 defaults, the fleet table, and the drift list from Task 5. Merge only on jiangzhuo's word. If the PR touches no workflow file, `gh pr merge` works. The PR body must also state: no `sidecar-v*` tag may be cut from main between this branch's merge and the native-v1.2.0 pin commit (Step 5), because main's catalog lists `granite-speech-5.0-470m-turboctc`, which the native-v1.1.0 wheel pinned by sidecar/requirements.txt cannot load (no granite5_ctc arch).

- [ ] **Step 4: ASK FIRST — tag `native-v1.2.0` on the merge commit, push the tag to `kizuna-ai-lab/sokuji` (publishes five prerelease wheels)**

Expected: the `native-build.yml` release job publishes five `py3-none-<platform>` wheels as a prerelease, and `releases/latest` is untouched.

- [ ] **Step 5: Sidecar pins in ONE commit, then ASK FIRST — PR to `kizuna-ai-lab/sokuji` `main`**

On a branch from updated main: point `sidecar/requirements.txt`'s five `sokuji_native` URLs at `native-v1.2.0`, mirror them in `sidecar/tests/test_runtime_gate.py` (`NATIVE_RELEASE_BASE`, `NATIVE_WHEELS`), and set root `package.json` `"sidecarVersion": "0.4.0"`, all in one commit. Run `PYTHONPATH=sidecar pytest sidecar/tests/test_runtime_gate.py -v` before committing.

- [ ] **Step 6: ASK FIRST — tag `sidecar-v0.4.0` on that merge commit and push it to `kizuna-ai-lab/sokuji`**

Expected: `sidecar-bundles.yml` step 1 accepts the tag (`sidecarVersion` matches), and five bundles plus `manifest.json` are published as a prerelease.

- [ ] **Step 7: Smoke the published bundles**

On GB10, the M4 and the 4070 SUPER box, with `PYTHONNOUSERSITE=1`: the handshake, `hardware_info`, 3× `models_catalog`, and op coverage for nine families × rungs all `all_supported` (Review Focus #5), plus supertonic warm RTF. Recipe: memory `sokuji-test-fleet`. Check that the linux-arm64 bundle is not hollow (contains `sokuji_native 1.2.0`).

## Out of scope (follow-ups, nothing filed without jiangzhuo's go)

- **Nemotron-3 diarization**: `nemotron_3_diar` in `AUDIOCPP_MODELS`, a `sk_diar_*` ABI (ABI 3), sidecar and renderer plumbing. This is its own spec, and it builds on this bump.
- `pocket_tts` streaming: 0.8.2 advertises it, but our `kFamilies` row stays `streaming=false` until streaming is measured on the fleet.
- Irodori-TTS v4.1 checkpoints (a new `irodori_tts_v4_1_anime_q8_0` package upstream): a catalog question, not an engine one.
- transcribe.cpp's own `patches/ggml/0001-fix-threadpool-oversubscription.patch` (present in 0.2.3 and 0.2.4, never applied to our shared ggml). Our thread-knee policy (R32) covers the same symptom; assess separately.
