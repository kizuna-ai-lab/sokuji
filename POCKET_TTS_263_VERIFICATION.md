# Pocket TTS #263 — web (WASM) vs node (native) re-verification

Empirical re-measurement on **latest code** (branch `feat/pocket-tts-electron-native-poc`),
identical shared `pocketInferenceCore` on both runtimes, identical models/text/reference.
Machine: **Intel i7-14700F** (AVX2 + AVX-VNNI, no AVX-512, no iGPU) + **NVIDIA RTX 4070 SUPER**,
Node v24.3, onnxruntime-node 1.26.0, onnxruntime-web 1.26.0-dev.20260416, Chrome 147.

## TL;DR

- The issue's headline **"browser WASM ~0.6× — not viable"** does **NOT reproduce** on current code.
  On this machine the web path is **~1.38× realtime** (comfortably real-time), confirmed via **two
  independent paths** (a controlled bench worker AND the real production `pocket-tts.worker.ts`).
- **Node** reproduces (~3.0×, matches the issue's ~3.2×). So the real web↔node gap is **~2.2×, not ~5×.**
- The issue's per-stage **decoder 6× tax was an outlier** — measured here it's **2.57×**. The AR backbone
  is **2.07×** (issue said 2.5×). Absolute RTF is **hardware-dependent**; the ~2.2× *ratio* is the stable metric.

## Verified numbers (best-of-3, cached voice; steady-state generate only)

| runtime / config | RTF | per-frame stages |
|---|---|---|
| node onnxruntime-node, 1 thread | **3.0×** (2.5–3.0) | main 18.7ms · flow 1.1ms · decode 6.3ms |
| node, 4 threads | 2.5× | (worse — thread oversubscription on seqlen-1 GEMV) |
| node, 8 threads | 3.1× | |
| **web WASM, 1 thread, SIMD (bench)** | **1.38×** (1.27–1.42) | main 38.7ms · flow 1.9ms · decode 16.2ms |
| **web WASM, 1 thread (real prod worker)** | **1.38×** | main 38.7 · decode 16.2 (identical → no harness bias) |
| web WASM, multi-thread (2/4/8) | — | `InferenceSession.create` **hangs** in 3 environments (MCP headless + main-thread + real Chrome 147), despite `crossOriginIsolated===true` + SharedArrayBuffer present |
| web **WebGPU EP** (int8, RTX 4070) | **0.18×** | **output all-NaN** — broken. `MatMulInteger`/`DynamicQuantizeLinear` have no WebGPU kernel → per-node CPU fallback + GPU↔CPU copies |

Per-stage web/native tax (same machine): **flow_lm_main 2.07×**, **mimi_decoder 2.57×**.

## Root cause (code-verified, not theory)

The gap is the **int8 dot-product instruction**, confirmed in source AND in the shipped binary:

- onnxruntime-node dispatches MLAS **AVX-VNNI `VPDPBUSD`** (`QgemmU8X8KernelAvx2.S`, 256-bit, 4 int8 MACs/lane fused).
- onnxruntime-web npm uses MLAS **fixed 128-bit** `qgemm_kernel_wasmsimd.cpp` → `wasm_i32x4_dot_i16x8`
  (widen i8→i16, pairwise multiply-add; 2 MACs/lane, no single-instruction 8-bit dot).
- ORT *contains* a relaxed-SIMD VNNI-mapping kernel (`qgemm_kernel_wasmrelaxedsimd.cpp`,
  `wasm_i32x4_relaxed_dot_i8x16_i7x16_add`, gated by `HasUSDot()`) but it is **only compiled with
  `--enable_wasm_relaxed_simd`**, which the **official npm build does not set**.
- **Binary proof:** the installed `ort-wasm-simd-threaded.jsep.wasm` (and `.wasm`) contain 19× the fixed
  `i32x4.dot_i16x8_s` opcode (`fd ba 01`) and **zero** relaxed int-dot opcodes (`fd 92 02`/`fd 93 02`),
  zero "relaxed" strings.
- Ranked contributors: (1) missing VNNI fused dot; (2) WASM SIMD 128-bit vs native 256-bit AVX2 (stacks on #1,
  hits the compute-bound decoder hardest → why decoder 2.57× > backbone 2.07×); (3) WASM packing/quantize/JIT
  overhead (dominates the seqlen-1 GEMV backbone, where the VNNI win is diluted). **Not** a fusion miss —
  `DynamicQuantizeMatMul`/`MatMulIntegerToFloat` already fire at default opt level but call the same QGEMM path.

## Can web approach node? — levers, ranked

| lever | class | web RTF | notes |
|---|---|---|---|
| **Custom relaxed-SIMD ORT-web build** | the real lever — **BUILT & MEASURED** | **1.51× (+8% vs 1.40×)** | Built from the exact npm commit `b7804b056c` with `--enable_wasm_relaxed_simd` (emsdk 4.0.23, cmake 3.31); the `.wasm` has 44× the relaxed int-dot opcode `fd 93 02`, self-hosted via a Vite override. Same-session A/B (threads=1): decoder −13.4%, GEMV backbone −5.9%, RTF 1.40→1.51, audio valid. **Real but modest** — far below the optimistic ~1.6–1.9× extrapolation; matches ORT #22533's ~1.15× calibration. Reason: at seqlen-1 the AR backbone is memory-bound, so a faster int8 dot barely helps; only the batched decoder benefits. Still ~2× short of node. |
| Decoder-only multi-thread WASM | try-now | decoder ~1.3–1.8× (sublinear); backbone ~0 | Needs COOP/COEP. Currently `create()` hangs in this setup; and node shows threads regress the backbone. Low net value. |
| WebGPU EP on **current int8** graphs | **DEAD END** | regression + NaN (measured 0.18×) | No WebGPU kernel for the int8 ops. Do not ship. |
| WebGPU + **MatMulNBits 4-bit / fp16 re-export** | bigger lift | could **beat** node on RTX 4070 (unmeasured) | New model files, different numerics → re-validate TTS audio quality. AR backbone (seqlen-1) may stay GPU-starved; decoder benefits most. |
| Reserve GPU for **native node** (CUDA/DirectML EP) | — | fastest overall | Runs MatMulInteger with no re-export. |

**Honest ceiling (now empirically bounded):** browser WASM cannot approach native 3.0× on this model class.
The only instruction-level lever — a custom relaxed-SIMD build — was built and measured at **1.51× (+8%)**, still
~2× short of node. Reasons: WASM SIMD is 128-bit vs native 256-bit AVX2, AND the dominant AR backbone is a
seqlen-1 GEMV (memory-bound), so the faster int8 dot mostly helps only the batched decoder. Best realistic WASM
web ≈ **~1.5×** (comfortably real-time, but not native-class). The only path that could *exceed* node is a WebGPU
re-export to MatMulNBits/fp16 (bigger lift + quality re-validation) — untested.

## Why the old 0.64× differed (it was recorded on THIS same i7-14700F)

The prior session's 0.64× / ~122 ms-per-frame was on the **same machine and essentially the same web code**
(the `simd=true` + bundled single-thread ORT worker was already in place on the playground branch). Things ruled
OUT as the cause:
- **Not SIMD**: `simd=0` here gives the *identical* 1.38× (40.4 ms/frame) — ORT-web 1.26 ships only the
  always-SIMD `ort-wasm-simd-threaded.wasm`, so the flag is a no-op and there is no scalar build to regress to.
- **Not the code path**: the worker config is unchanged between the playground branch and this branch.

Most likely cause: **CPU throttling in the earlier session.** The governor is `powersave`; cores DO boost to
5.3 GHz under load now, but if the earlier run was held low (no boost) or scheduled on the E-cores
(~4.2 GHz, lower IPC), single-thread WASM would run ~2× slower — matching 122 ms/frame vs 57 ms/frame.
The earlier decoder figure (38 ms/frame vs 16.2 ms here; native decoder 6 ms then ≈ 6.3 ms now) is consistent
with the *web* side being throttled while the native side was measured at full speed.

**Stable, hardware-independent metric:** the ~2.07× (backbone) / ~2.57× (decoder) web/native *ratio* measured
in the same session. Absolute RTF tracks single-core speed, so on a genuinely slow laptop the web path can still
dip below real-time — the regime relaxed-SIMD would rescue.

## Reproduce

- node:  `THREADS=1 npx tsx scripts/bench-pocket-native-stages.ts`  (and `scripts/bench-pocket-native.ts` for the thread sweep)
- web:   `SOKUJI_NO_ELECTRON=1 [SOKUJI_COI=1] npx vite --port 5173` then drive `/pocket-web-bench.html?ep=wasm|webgpu&threads=N&mainthread=0|1&reps=3`
  (Playwright for WASM; `node scripts/chrome-drive.mjs <url> <probe.js>` to use the real GPU for WebGPU).
