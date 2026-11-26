/**
 * The TTS cards (port of the TTS half of sidecar/sokuji_sidecar/catalog.py): single-file audio.cpp GGUFs on the
 * native_tts backend, with each family's voice facts and, where a card needs it, its licence terms.
 */
import { deployment, license, ttsModelCard, type Deployment, type License, type TtsModel } from './types';



// Ruling R16: families whose engine CANNOT synthesize until a voice is set --
// they ship no usable built-in voice at all, so a bare generate() can only ever
// fail. tts_backend._ensure_voice_ready() turns that into a clean, family-named
// BackendLoadError before the native layer is reached, and voice_capability()
// below puts the same fact on the wire as `required` so the renderer's own
// pre-init gate reads it instead of guessing.
// 
// It lives HERE, not in tts_backend, because two consumers need it and this is
// the module both can import (tts_backend already imports from .catalog; the
// reverse would be a cycle). tts_backend re-exports it under its historical
// private name.
// 
// Membership is by ENGINE BEHAVIOUR, live-verified per family, not by voice
// shape -- which is exactly the distinction the renderer used to get wrong:
//   qwen3_tts   base checkpoint has no default voice, and its ICL clone mode
//               additionally requires ref_text (R15(s4), task-7-report.md §3).
//   omnivoice   same, ref_text likewise mandatory.
//   index_tts2  (2026-09-03) request parser refuses outright -- "IndexTTS2
//               request requires --voice-ref or voice.speaker.audio" -- and
//               audio.cpp exposes no built-in voices for it. Needs the CLIP
//               only, not a transcript: transcript_required stays False.
// Deliberately NOT members, though all five report clones=True and expose no
// presets (i.e. they LOOK identical to the three above from the outside):
//   moss_tts_nano  ships a genuinely working built-in default (CPU-verified).
//   pocket_tts     does NOT -- but adding it here would only make the failure
//                  clean, not make a bare synth work; ruling R34 gives it a real
//                  default voice at load() instead (_DEFAULT_PRESET_FAMILIES).
//   voxcpm1, voxcpm2, irodori_tts  (2026-09-03) all synthesize with nothing set;
//                  their speaker reference is optional (irodori's own request
//                  default is no_ref=true). CPU-verified against the real GGUFs.
export const VOICE_REQUIRED_FAMILIES: ReadonlySet<string> = new Set(['qwen3_tts', 'omnivoice', 'index_tts2']);

/** builtin: named | none; custom: clip | none; required: a clip or preset MUST be set before the model can speak. */
export interface VoiceCapability { builtin: 'named' | 'none'; custom: 'clip' | 'none'; required: boolean; transcriptRequired?: true }

/**
 * Native voice capability from static catalog facts. `required` is its own axis and always present, because it is not
 * derivable from the other two: moss_tts_nano, voxcpm1, voxcpm2 and irodori_tts report builtin none + custom clip and
 * speak fine with nothing set, while qwen3_tts/omnivoice/index_tts2 report the same shape and cannot. It is always
 * emitted (unlike transcriptRequired) so an absent field means "engine too old to say", not "false".
 */
export function voiceCapability(model: TtsModel): VoiceCapability {
  const custom = model.clones ? 'clip' : 'none';
  const builtin = model.namedVoices ? 'named' : 'none';
  const out: VoiceCapability = { builtin, custom, required: VOICE_REQUIRED_FAMILIES.has(model.family) };
  if (custom === 'clip' && model.transcriptRequired) out.transcriptRequired = true;
  return out;
}

export interface LicenseWire { spdx: string; name: string; url: string; nonCommercial: boolean; requiresConsent: boolean; sourceRepo: string; attribution: string }

/** The wire (camelCase) form of a card's licence, or null when it carries no non-standard terms. */
export function licenseDict(model: TtsModel): LicenseWire | null {
  const lic: License | null = model.license;
  if (lic === null) return null;
  return {
    spdx: lic.spdx,
    name: lic.name,
    url: lic.url,
    nonCommercial: lic.nonCommercial,
    requiresConsent: lic.requiresConsent,
    sourceRepo: lic.sourceRepo,
    attribution: lic.attribution,
  };
}

// All 14 cards are single-file GGUFs from audio.cpp's official mirror,
// verified 2026-09-01 (the first ten) and 2026-09-03 (the four added then)
// via the HF tree API (`GET
// api/models/audio-cpp/audio.cpp-gguf/tree/main/<dir>`) — every (dir, file)
// pair below resolves to a real LFS object and the byte count shown is its
// exact `lfs.size`. Cross-checked against the repo's own `model_specs/
// <family>.json` package list (vendored at
// native/build/cpu/_deps/audiocpp-src/model_specs/) for the curated default
// per family and, for pocket_tts, exactly which languages ship a preset asset
// (see the pocket-tts-en row below).
export const AUDIOCPP_GGUF_REPO = 'audio-cpp/audio.cpp-gguf';

// Ruling R18(s4): name of the sokuji-owned hard-link staging tree tts_backend.py's
// load() creates as a sibling of HF's own models--*/ directories, directly under the
// SAME cache root. Shared between tts_backend.py (creates/refreshes staged entries)
// and native_models.py (removes a deleted card's staged entries so a hard link never
// outlives the HF-cache-side file it was staged from) — defined here, the one module
// both already import from, so neither has to import the other just for this name.
export const TTS_STAGING_DIRNAME = 'sokuji-tts-staging';

// R19 (2026-09-01): TTS is CPU-ONLY until GPU execution is validated per
// family per lane (a slice-5/6 task) — every native_tts card COULD ship the
// same tiers for every quant, since audio.cpp has no CUDA-only/DirectML-only
// TTS kernel path (unlike the deleted ONNX backends' per-platform/
// per-precision restrictions: bf16-CUDA-only, macOS-only MLX rows, ...), but
// the slice-4 CI dry run's mac-arm64 metal lane gave the FIRST-EVER real-GPU
// TTS contact and it aborted hard: the Python binding tests pass device=None
// (NULL -> engine auto, per A1), which picked Metal for supertonic, and that
// graph hit ggml_abort inside synthesize_supertonic_chunk ("unsupported op",
// ggml-metal-ops.cpp:204) in upstream ggml's Metal backend. The C tests never
// hit this because they load with an explicit CPU device (see
// native/python/tests/test_sokuji_native.py). ASR (_TC_TIERS) and translate
// (native_translate's own three-tier tuple in _llm_translate_row) are
// untouched by this ruling — Metal ran moonshine (ASR) clean on the same
// lane. (Retroactive correction, R36 below: that "first-ever real-GPU TTS
// contact" was never M1 evidence either — GitHub's macos-14 arm64 runner is
// the same paravirtual VM described there, and this abort is that VM's
// GGML_OP_NORM gate, not a real-hardware finding.)
// 
// `_TTS_TIERS` below is the cpu-only default for any family not listed in
// `_TTS_TIER_OVERRIDES` — it exists for the NEXT family, which starts cpu-only
// until it, too, earns a tier through real-GPU evidence (one fleet run per
// family per lane, R19). Today it is dormant: all nine shipped families are in
// that dict — the four added on 2026-09-03 (voxcpm1, voxcpm2, irodori_tts,
// index_tts2) arrived cpu-only and earned their rows the same evening (commit
// 2f2b28bc) once the native-1.0.2 wheels were validated per family on the fleet. A family that
// fails every GPU lane loses its card rather than keeping a tier it cannot serve.
export const TTS_TIERS: readonly string[] = ['cpu'];

// R19 follow-up / ruling R25 (2026-09-01, task 8): the first real Vulkan TTS
// contact — CI's Linux lanes are headless (no GPU), so accel auto-detection
// had only ever fallen back to CPU there; this is a GB10 (NVIDIA GB10,
// aarch64, manylinux_2_39_aarch64) dev box with a real Vulkan device. Built
// `native/ci/build.sh vulkan manylinux_2_39_aarch64` locally (ctest 4/4,
// native/python/tests + native/tests/parity: 23 passed/2 xfailed/4 failed at
// the time — since fixed by slice-5b task 2, which pinned the parity
// candidate to the CPU device (device=NULL was resolving to the GPU on a
// Vulkan stage) and keyed the nosve cache per source; the vulkan stage now
// runs 13 passed/3 skipped like the cpu one). Then, per family, in its OWN
// subprocess (a GGML abort is an uncatchable SIGABRT — isolating per family
// means one family's crash can't take down the others or the other four
// results, same precedent as test_tts_parity.py's `_run_candidate`
// subprocess isolation): loaded with the EXPLICIT Vulkan device
// (`sokuji_native.devices()`, kind == "vulkan" — "Vulkan0" / NVIDIA GB10),
// did the family's normal voice setup (supertonic/pocket: `set_preset`;
// qwen3_tts/omnivoice: `set_voice` cloning a reference clip synthesized by
// supertonic on the CPU device first, with that clip's own text as
// `ref_text`), synthesized "The quick brown fox jumps over the lazy dog.",
// and whisper-tiny (CPU device) transcribed the result. PASS bar: clean exit
// + transcript contains "quick"/"fox" + audio duration in [0.5s, 30s].
//
// All five families PASSED the crash/correctness bar — supertonic's Metal
// "unsupported op" abort above does NOT reproduce on Vulkan (ggml-vulkan's op
// coverage differs from ggml-metal's here). Per-family wall time is
// tts_load()+synth() together (same measurement the CPU-lane numbers below
// use, cited from task-7-report.md's loopback table, same box/build):
//   moss_tts_nano: 3.92s audio, 5.62s wall vulkan (cpu 15.03s) -> gpu-vulkan
//   supertonic:    3.10s audio, 14.45s wall vulkan (cpu 14.50s) -> gpu-vulkan.
//                  That ~1.0x is a MEASUREMENT ARTEFACT, not parity: 99% of
//                  the wall was model load, a device-independent CPU-side path
//                  (.superpowers/vulkan-perf-investigation.md, Q1). Split at
//                  n_threads=8: load 14.0s on BOTH devices, synth 0.097s
//                  vulkan vs 0.981s cpu = 10.1x on this short text and 19.0x
//                  on a 2-chunk 380-char one (each chunk 17-20x), with the GPU
//                  83% busy under vulkan synth and 2% under cpu synth
//   qwen3_tts:     3.04s audio, 7.19s wall vulkan (cpu 29.03s) -> gpu-vulkan
//   omnivoice:     2.48s audio, 6.69s wall vulkan (cpu 43.81s) -> gpu-vulkan
//   pocket_tts:    2.72s audio, 1.94s wall vulkan (cpu 1.31s production
//                  chain, task-7's number) -> gpu-vulkan (ruling R29,
//                  superseding R28). R28 briefly pinned this family
//                  cpu-only on that single, cross-session, not-apples-to-
//                  apples comparison (a raw vulkan probe vs. a different
//                  session's heavier production-chain cpu number). A
//                  controlled re-measurement (one warm-up call + 4 timed
//                  tts_load()+synth() runs, same call shape, both devices)
//                  showed a 5-9x GPU speedup instead: vulkan 0.42-0.46s
//                  (tight) vs cpu 2.46-4.22s (noisy) — and even the original,
//                  most favorable-to-cpu figure (1.31s) still loses to
//                  Vulkan's worst run by ~3x. The cpu-side run-to-run variance
//                  is now explained (vulkan-perf-investigation.md, Q2): it was
//                  thread OVERSUBSCRIPTION against ggml's spin-wait barrier at
//                  n_threads=nproc(=20). Held at n_threads=8 it is tight (cpu
//                  1.014s vs vulkan 0.234s synth = 4.3x). No measurement in
//                  either round has cpu winning, so R29 restores gpu-vulkan.
//
// The old caveat here — "ggml's scheduler may have silently fallen individual
// ops back to CPU, so a clean run is only a BEHAVIORAL pass" — is retracted:
// `ggml_backend_sched` has ZERO hits in native/src, native/include and
// audiocpp-src/{src,include,app,tools,tests}, i.e. in every line that is
// compiled into libsokuji_native. (It does appear under
// audiocpp-src/external/ggml — audio.cpp's own bundled ggml fork, which this
// project does not build. Those hits are ggml's OWN scheduler, in files this
// build never compiles: 3 example programs that drive it
// (examples/{gpt-2/main-sched.cpp, mnist/mnist-common.h,
// simple/simple-backend.cpp}) plus tests/test-opt.cpp, the
// include/ggml-{backend,cpp,opt}.h declarations, and the two IMPLEMENTATION
// files behind them, src/ggml-{backend,opt}.cpp — an earlier version of this
// footnote called that whole tail "declarations", which understated it.) So a
// session holds exactly
// ONE backend and an op Vulkan cannot service ABORTS ("Missing op" ->
// GGML_ABORT), exactly as Metal did. A clean run is therefore proof the graph
// ran on the GPU. Per-dispatch streaming overhead is ruled out too: the
// advantage WIDENS with more chunks.
//
// The 14s load was a real defect, and it is fixed (native 0.6.1): ggml 0.22.0
// read GGUF array KVs one element at a time — one locked fread each — and
// audio.cpp reopens a model GGUF 14 times per load, so supertonic's 57MB
// `audiocpp.embedded_files.data` sidecar KV cost ~800M freads. With
// native/patches/ggml-gguf-bulk-array-read.json: supertonic load 13.85s ->
// 1.50s, omnivoice 3.85 -> 1.42, qwen3 2.35 -> 1.21, moss 0.93 -> 0.19,
// pocket 0.16 -> 0.14 (GB10, cpu lane, n_threads=12; see native/README.md
// "GGUF array reads"). Every wall figure in the table above is PRE-fix.
//
// Fleet validation on real GPUs, 2026-09-02 — 5/5 families everywhere (clean
// exit, whisper-checked transcript, duration in bar). Long form in
// .superpowers/{vulkan-perf-investigation,windows-vulkan-validation,
// linux-x64-vulkan-validation,metal-fix-experiments}.md and the slice-5b
// task-1 report. Speedups are warm SYNTH, GPU vs cpu device on the same box.
// The CPU side of a ratio depends on the thread count, and these four runs did
// NOT share one, so each row carries its own — only linux-x64 ran at the
// measured knee (ruling R32: n_threads=0 -> min(hw, 12); the knee is 12 and
// only 12). Any cross-row comparison of the CPU columns is invalid:
//
//   lane         GPU                                    result  cpu threads  synth speedup
//   linux-arm64  NVIDIA GB10, Vulkan                    5/5      8           4.3-19x
//   win-x64      RTX 4070 SUPER, Vulkan (Win 11)        5/5     28 (hw)      14-56x
//   linux-x64    RTX 4070 SUPER, Vulkan (Ubuntu 22.04)  5/5     12 (knee)    7.5-65.8x
//   mac-arm64    Apple M4, Metal                        5/5      unrecorded  1.3-3.9x
//
// The win-x64 row predates R32 entirely — it is the 0.5.0 CI wheel, whose
// sk_init logged "28 threads" (= hw), so its CPU numbers are the pessimistic
// oversubscribed ones and its ratios are, if anything, flattering to the GPU.
// The GB10 row is n_threads=8, the value that sweep found optimal on that
// 20-core big.LITTLE box before the knee was fixed at 12 fleet-wide. The M4
// probe did not record a thread count at all. The mac row's lower bound was
// briefly written as 0.83x (i.e. "Metal loses to CPU on pocket_tts"); that
// came from a single-shot pocket measurement and was RETRACTED in task 1's
// fix round — the controlled rerun on the same box put pocket at 0.25s Metal
// vs 0.39s CPU, so 1.3x is the honest floor and no family is slower on Metal.
//
// The mac row holds only AFTER slice-5b task 1's two Metal kernel patches
// (before them moss/qwen3/omnivoice aborted): the resurrected
// GGML_OP_DIAG_MASK_INF/PAD kernels (ruling R30 — native/patches/ggml-metal-
// {diag-mask-inf,pad-leading}.json) plus audiocpp_compat.h's ggml_sub now
// ggml_cont-ing src1 too (Metal wants both operands row-contiguous) took the
// M4 from 2/5 aborting to 5/5 clean.
//
// Ruling R36 (2026-09-02, slice-5b task 10) supersedes R31's deferral above:
// gpu-metal is RESTORED for all five families on the strength of that M4
// (Apple9) evidence. R31 held tiers back pending a CI mac-arm64 run to
// confirm an M1; that run happened (native-build.yml dry run round 2) and
// could NOT confirm or deny an M1 either way, for a hardware reason, not a
// code reason: GitHub's macos-14 arm64 runner is a VM whose Metal device
// reports as "Apple Paravirtual device", which lacks has_simdgroup_reduction
// (ggml-metal-device.m:1044-1045 requires MTLGPUFamilyApple7 or Metal3).
// ggml gates GGML_OP_NORM/RMS_NORM/ARGMAX on that capability, so every
// family that normalizes (all five) aborts there ("unsupported op 'NORM'",
// run 33581291942) regardless of which macOS or Xcode version the runner
// carries. That paravirtual GPU is not evidence about real Apple silicon in
// either direction — it is a virtualization shim the CI vendor puts in front
// of every hosted macOS VM, not a downlevel real GPU, and (retroactive
// correction to R19 above) it is also almost certainly what produced R19's
// original "supertonic aborts on Metal" contact: the slice-4 dry run used
// the same runner class.
//
// The capability gates our Metal kernels/shims actually consult are Apple7
// (simdgroup reduction and simdgroup matrix-multiply — what the resurrected
// diag-mask-inf/pad kernels and the ops they unblock need) and Apple6
// (bfloat — three of the five checkpoints carry BF16 tensors). Every real
// Mac from the M1 onward satisfies both: the M1/M2/M3 GPU family is Apple7
// (M1 is also where Apple's Metal bfloat support began), and the M4 tested
// here is Apple9, a strict superset. Intel Macs are unaffected either way —
// they have no eligible Metal compute device at all and build the `none`
// lane (CPU only; no gpu-metal tier is ever reachable there, paravirtual or
// real).
//
// What this evidence does NOT include: no real M1, M2, or M3 has run this
// suite — the M4 is the only real-hardware data point, and CI's own Metal
// lane structurally cannot supply one (see above), so this gap cannot close
// via CI. R36 accepts it deliberately: the gates that matter are
// architectural (Apple7/Apple6), not M4-specific, so satisfying them is the
// bar this ruling relies on, not "measured on every generation". A future
// real M1/M2/M3 check is a slice-6 nice-to-have, not a blocker. If one ever
// aborts on a kernel here despite reporting Apple7, that is new information
// this ruling did not have, and the fix is cheap and scoped: drop that one
// family's gpu-metal row back out of `_TTS_TIER_OVERRIDES`.
//
// native/python/tests/test_sokuji_native.py::test_tts_synthesises_on_a_gpu_device
// skips outright when the resolved device's description matches
// /paravirtual/i, precisely so a future CI run reports "skipped" there
// instead of a green pass that would misrepresent a VM shim as validating
// real Metal hardware. The PLANNER refuses that device for real, too:
// `planner._tier_available("gpu-metal", ...)` drops the tier when every Metal
// device the probe reports has a /paravirtual/i description, so a virtualized
// Mac (CI, or a user in a VM) resolves these cards cpu-only instead of being
// handed a plan that aborts the process.
//
//   lane        macOS runner GPU               tier decision
//   mac-arm64   Apple Paravirtual device       gpu-metal restored anyway (R36,
//                                               on M4 real-hardware evidence —
//                                               this GPU cannot confirm OR
//                                               deny it; see above)
//
// First-ever synth on an NVIDIA box additionally pays a one-time, per-machine
// driver pipeline-cache compile of 2-14s (W-1, linux-x64-vulkan-validation.md);
// the load-time warm-up synth (R33) absorbs it.
//
// WHICH QUANT those fleet runs loaded, and the gap that closed on 2026-09-02:
// every row in the table above loaded the card's DEFAULT rung (q8_0; f16 for
// supertonic). That is not what a GPU machine actually resolves — `resolve_tts`
// auto runs `_llamacpp_variant_row`, which picks the LARGEST quant that fits the
// device budget, so on every GPU fixture in test_characterization.py
// (CUDA_12GB/CUDA_24GB/APPLE_SILICON) the recommended and resolved rung is
// **bf16** for the four families that ship one. BF16 is a distinct ggml tensor
// type with its own per-backend kernel coverage, so those green q8_0 runs said
// nothing about the rung users would actually get. The bf16 rungs are now
// validated directly, same bar as the table above (clean exit, non-silent audio
// of a sane duration), via the second `quant` dimension of
// test_tts_synthesises_on_a_gpu_device:
//
//   family          bf16 rung shipped   GB10/Vulkan   M4/Metal
//   moss_tts_nano   yes                 PASS          PASS
//   pocket_tts      yes                 PASS          PASS
//   qwen3_tts       yes (0.6b tested)   PASS          PASS
//   omnivoice       yes                 PASS          PASS
//   supertonic      NO (f16 only)       n/a           n/a
//
// 4/4 on both devices, so no family loses its bf16 GPU rung; the ladders below
// are unchanged. qwen3-tts-1.7b was not loaded — same family, same graph, same
// tensor types as the 0.6b that was. Numbers:
// .superpowers/sdd/2026-09-02-sidecar-ggml-only-slice5b-debt/final-fixwave-report.md.
export const TTS_TIER_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  moss_tts_nano: ['gpu-vulkan', 'gpu-metal', 'cpu'],
  supertonic: ['gpu-vulkan', 'gpu-metal', 'cpu'],
  qwen3_tts: ['gpu-vulkan', 'gpu-metal', 'cpu'],
  omnivoice: ['gpu-vulkan', 'gpu-metal', 'cpu'],
  pocket_tts: ['gpu-vulkan', 'gpu-metal', 'cpu'], // ruling R29 (supersedes R28) -- see table above
  // The four added 2026-09-03. Measured per lane with the native-1.0.2 wheels
  // (the first build to compile these four -- AUDIOCPP_MODELS gained them there;
  // 1.0.1 cannot load them at all). requirements.txt pinned 1.0.1 when this was
  // measured and has since moved on (1.0.2 with sidecar-v0.2.1, 1.1.0 with
  // sidecar-v0.3.0) in the release order native/README.md sets out: tag, then pin.
  // Warm RTF = synth / audio, so <1 is faster than speech:
  //                GB10 Vulkan   M4 Metal   M4 CPU
  //   voxcpm1          0.47         0.91      1.55
  //   voxcpm2          0.63         1.42      3.27
  //   irodori_tts      0.28         0.97      2.32
  //   index_tts2       0.45         1.77      4.94
  // Vulkan clears real time for all four. Metal does not for voxcpm2 and
  // index_tts2 -- but it still beats the same machine's CPU by 1.7-2.8x, and a
  // tier list says what CAN run, not what is worth choosing. Keeping Metal shut
  // would only push a Mac onto the slower path. Which device and which quant a
  // machine SHOULD use is the planner's and the download recommendation's
  // decision (jiangzhuo's ruling, 2026-09-03).
  voxcpm1: ['gpu-vulkan', 'gpu-metal', 'cpu'],
  voxcpm2: ['gpu-vulkan', 'gpu-metal', 'cpu'],
  irodori_tts: ['gpu-vulkan', 'gpu-metal', 'cpu'],
  index_tts2: ['gpu-vulkan', 'gpu-metal', 'cpu'],
};


/**
 * One native_tts card. `quants` maps QUANT token (the filename's own suffix, e.g. "q8_0") to [filename, bytes] under
 * `dir` in AUDIOCPP_GGUF_REPO; `defaultQuant` gets rank 2.0, any other listed quant rank 1.0 — the translation rows'
 * two-rung shape, including its picking: `defaultQuant` is the RANK default (the pin-absent, no-budget, nothing-fits
 * fallback), while the planner's auto path picks the LARGEST quant that fits the machine's budget. `extraFiles` are
 * [filename relative to `dir`, bytes] assets sk_tts_presets finds next to the loaded GGUF (only pocket-tts-en has
 * one), downloaded beside every quant and counted once in sizeBytes. Tiers come from TTS_TIER_OVERRIDES, else
 * TTS_TIERS.
 */
export function ttsGgufRow(
  mid: string, name: string, langs: readonly string[], family: string, dir: string,
  quants: Readonly<Record<string, readonly [string, number]>>,
  opts: {
    defaultQuant: string; order: number; loadLanguage?: string; clones?: boolean; streaming?: boolean; sampleRate?: number;
    namedVoices?: boolean; transcriptRequired?: boolean; recommended?: boolean; extraFiles?: ReadonlyArray<readonly [string, number]>;
    license?: License | null;
  },
): TtsModel {
  const {
    defaultQuant, order, loadLanguage = '', clones = false, streaming = false, sampleRate = 24000, namedVoices = false,
    transcriptRequired = false, recommended = false, extraFiles = [], license = null,
  } = opts;
  const deps: Deployment[] = [];
  const tiers = TTS_TIER_OVERRIDES[family] ?? TTS_TIERS;
  const orderKeys = [defaultQuant, ...Object.keys(quants).filter((q) => q !== defaultQuant)];
  orderKeys.forEach((q, i) => {
    const [fname, nbytes] = quants[q];
    const artifact = `${AUDIOCPP_GGUF_REPO}/${dir}/${fname}`;
    const rank = i === 0 ? 2.0 : 1.0;
    for (const tier of tiers) deps.push(deployment('native_tts', tier, q, artifact, rank, { estBytes: nbytes }));
  });
  const totalBytes = quants[defaultQuant][1] + extraFiles.reduce((sum, [, size]) => sum + size, 0);
  return ttsModelCard(mid, name, langs, deps, {
    family, loadLanguage, clones, streaming, sampleRate, namedVoices, transcriptRequired, recommended,
    sortOrder: order, sizeBytes: totalBytes, extraFiles, license, graphFamily: family,
  });
}

export const SUPERTONIC_LANGS: readonly string[] = [
  'en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt',
  'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi',
];


export const TTS_MODELS: readonly TtsModel[] = [
  // Offline, clones from a reference clip, no presets (sk_tts_presets() ==
  // []). audio.cpp ships Q8_0 (default) and BF16; languages per
  // model_specs/moss_tts_nano.json (19 — the old catalog's "nl" entry was
  // never in audio.cpp's own list).
  ttsGgufRow(
    'moss-tts-nano',
    'MOSS-TTS-Nano (100M)',
    [
      'ar', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fr', 'hu', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'sv', 'tr',
      'zh',
    ],
    'moss_tts_nano',
    'MOSS-TTS-Nano-100M-GGUF',
    { q8_0: ['moss-tts-nano-100m-q8_0.gguf', 193_337_984], bf16: ['moss-tts-nano-100m-bf16.gguf', 332_423_040] },
    { defaultQuant: 'q8_0', order: 0, clones: true, streaming: false, sampleRate: 48000, recommended: true },
  ),
  // Streaming, no cloning, 10 named presets (F1-F5/M1-M5, sk_tts_presets()).
  // audio.cpp's own Q8_0 conversion hits unresolved CUDA copy/layout
  // blockers (docs/gguf.md: "Q8 blockers unresolved") — the repo's
  // "supertonic-3-q8_0.gguf" is in fact a byte-for-byte copy of "-orig.gguf"
  // (same LFS oid), not a real quant. F16 is the smallest WORKING rung, so
  // it is the only quant offered (no ladder) — matches Task 1's CTest model.
  ttsGgufRow(
    'supertonic-3',
    'Supertonic 3',
    SUPERTONIC_LANGS,
    'supertonic',
    'Supertonic-3-GGUF',
    { f16: ['supertonic-3-f16.gguf', 312_784_196] },
    { defaultQuant: 'f16', order: 1, clones: false, streaming: true, sampleRate: 44100, namedVoices: true, recommended: true },
  ),
  // Base checkpoint (audio.cpp's dedicated "...-Base-GGUF" repo — NOT
  // CustomVoice/VoiceDesign, which are separate GGUF repos/families as far
  // as sk_tts_load's family_hint is concerned): clones from a reference
  // clip, no discoverable presets. ref_text IS mandatory (R15(s4)) — the
  // base checkpoint has no default built-in voice at all (it must always
  // clone) and its ICL clone mode separately requires ref_text one level
  // deeper inside synth() itself, live-verified in task-7-report.md §3; the
  // old comment here ("ref_text optional, unlike the old ONNX qwen3tts_onnx
  // backend") was wrong for this GGUF-native family.
  ttsGgufRow(
    'qwen3-tts-0.6b',
    'Qwen3-TTS 0.6B',
    ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    'qwen3_tts',
    'Qwen3-TTS-12Hz-0.6B-Base-GGUF',
    {
      q8_0: ['qwen3-tts-12hz-0.6b-base-q8_0.gguf', 1_991_211_136],
      bf16: ['qwen3-tts-12hz-0.6b-base-bf16.gguf', 2_516_154_496],
    },
    { defaultQuant: 'q8_0', order: 2, clones: true, streaming: false, sampleRate: 24000, transcriptRequired: true },
  ),
  // Same family, larger checkpoint. audio.cpp's Q8_0 file for this size is
  // named "...q8_0_v2.gguf" (a real, distinct LFS object from a v1 the repo
  // no longer ships) — kept verbatim.
  ttsGgufRow(
    'qwen3-tts-1.7b',
    'Qwen3-TTS 1.7B',
    ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    'qwen3_tts',
    'Qwen3-TTS-12Hz-1.7B-Base-GGUF',
    {
      q8_0: ['qwen3-tts-12hz-1.7b-base-q8_0_v2.gguf', 2_695_175_104],
      bf16: ['qwen3-tts-12hz-1.7b-base-bf16.gguf', 4_203_158_464],
    },
    { defaultQuant: 'q8_0', order: 3, clones: true, streaming: false, sampleRate: 24000, transcriptRequired: true },
  ),
  // Streaming, 600+-language zero-shot cloning; ref_text is mandatory
  // (sk_tts_set_voice), same as qwen3_tts above (R15(s4) made qwen3_tts join
  // this group — omnivoice is no longer the only one).
  // k2-fsa/OmniVoice ships under CC-BY-NC-4.0 — non-commercial only. This
  // descriptor is DATA the download gate reads generically; it isn't a
  // Sokuji-specific restriction.
  ttsGgufRow(
    'omnivoice-0.6b',
    'OmniVoice 0.6B',
    ['multi'],
    'omnivoice',
    'OmniVoice-GGUF',
    { q8_0: ['omnivoice-q8_0.gguf', 1_350_288_416], bf16: ['omnivoice-bf16.gguf', 1_639_548_640] },
    {
      defaultQuant: 'q8_0', order: 4, clones: true, streaming: true, sampleRate: 24000, transcriptRequired: true,
      license: license({
        spdx: 'CC-BY-NC-4.0',
        name: 'Creative Commons Attribution-NonCommercial 4.0 International',
        url: 'https://creativecommons.org/licenses/by-nc/4.0/',
        nonCommercial: true,
        sourceRepo: AUDIOCPP_GGUF_REPO,
        attribution: 'k2-fsa/OmniVoice',
      }),
    },
  ),
  // Pocket TTS (Kyutai CALM): offline, clones from a reference clip, one
  // bundle per load-time language package. Per model_specs/pocket_tts.json's
  // own `packages[]`, only the "english" package's files[] lists a preset
  // asset (embeddings/alba.safetensors, ships "alba" as sk_tts_presets()'
  // one name) — german/italian/portuguese/spanish package specs list ONLY
  // their gguf, even though the audio-cpp/audio.cpp-gguf mirror happens to
  // also host (materially DIFFERENT, verified by LFS content hash — not a
  // copy-paste) embeddings/*.safetensors files under those language
  // directories too; audio.cpp's own package spec is the authority for what
  // ships, so only English gets extra_files/named_voices here — the other
  // four are clone-only BY DESIGN (R9).
  ttsGgufRow(
    'pocket-tts-en',
    'Pocket TTS (English)',
    ['en'],
    'pocket_tts',
    'PocketTTS-GGUF/english',
    { q8_0: ['pocket-tts-english-q8_0.gguf', 127_856_704], bf16: ['pocket-tts-english-bf16.gguf', 219_096_064] },
    { defaultQuant: 'q8_0', order: 5, loadLanguage: 'english', clones: true, streaming: false, sampleRate: 24000, namedVoices: true, extraFiles: [['embeddings/alba.safetensors', 6_194_424]] },
  ),
  ttsGgufRow(
    'pocket-tts-de',
    'Pocket TTS (German)',
    ['de'],
    'pocket_tts',
    'PocketTTS-GGUF/german',
    { q8_0: ['pocket-tts-german-q8_0.gguf', 127_857_184], bf16: ['pocket-tts-german-bf16.gguf', 219_096_544] },
    { defaultQuant: 'q8_0', order: 6, loadLanguage: 'german', clones: true, streaming: false, sampleRate: 24000 },
  ),
  ttsGgufRow(
    'pocket-tts-es',
    'Pocket TTS (Spanish)',
    ['es'],
    'pocket_tts',
    'PocketTTS-GGUF/spanish',
    { q8_0: ['pocket-tts-spanish-q8_0.gguf', 127_858_240], bf16: ['pocket-tts-spanish-bf16.gguf', 219_097_600] },
    { defaultQuant: 'q8_0', order: 7, loadLanguage: 'spanish', clones: true, streaming: false, sampleRate: 24000 },
  ),
  ttsGgufRow(
    'pocket-tts-it',
    'Pocket TTS (Italian)',
    ['it'],
    'pocket_tts',
    'PocketTTS-GGUF/italian',
    { q8_0: ['pocket-tts-italian-q8_0.gguf', 127_857_440], bf16: ['pocket-tts-italian-bf16.gguf', 219_096_800] },
    { defaultQuant: 'q8_0', order: 8, loadLanguage: 'italian', clones: true, streaming: false, sampleRate: 24000 },
  ),
  ttsGgufRow(
    'pocket-tts-pt',
    'Pocket TTS (Portuguese)',
    ['pt'],
    'pocket_tts',
    'PocketTTS-GGUF/portuguese',
    {
      q8_0: ['pocket-tts-portuguese-q8_0.gguf', 127_858_368],
      bf16: ['pocket-tts-portuguese-bf16.gguf', 219_097_728],
    },
    { defaultQuant: 'q8_0', order: 9, loadLanguage: 'portuguese', clones: true, streaming: false, sampleRate: 24000 },
  ),
  // ---- 2026-09-03 batch ----------------------------------------------------
  // Four more audio.cpp families. They arrived CPU-ONLY (no _TTS_TIER_OVERRIDES
  // entry, so `_tts_gguf_row` gave each the default `_TTS_TIERS = ("cpu",)`) and
  // earned their gpu-vulkan/gpu-metal rows the same evening (commit 2f2b28bc) the
  // way the first five did -- one fleet run per family per lane (R19), not by analogy with a
  // sibling family. Every byte count below is the exact `lfs.size`
  // from `GET api/models/audio-cpp/audio.cpp-gguf/tree/main/<dir>`, read
  // 2026-09-03, and every family was loaded and synthesized on this repo's CPU
  // lane (linux-arm64) before the row was written.
  //
  // VoxCPM 0.5B (community model in audio.cpp: src/community_models/voxcpm1).
  // Streaming, optional reference clip (continuation-mode cloning), no presets.
  // The repo ships exactly ONE file for it, so there is no quant ladder. 16 kHz
  // is genuinely this family's native rate, not a typo -- it is the lowest of
  // any card here.
  ttsGgufRow(
    'voxcpm1-0.5b',
    'VoxCPM 0.5B',
    ['zh', 'en', 'ja', 'ko'],
    'voxcpm1',
    'VoxCPM1-GGUF',
    { q8_0: ['voxcpm-0.5b-q8_0-audiovae-f16.gguf', 847_888_032] },
    { defaultQuant: 'q8_0', order: 10, clones: true, streaming: true, sampleRate: 16000 },
  ),
  // VoxCPM2: the same lineage at 48 kHz across 30 languages
  // (model_specs/voxcpm2.json lists 31 entries; the non-code "zh dialects" one
  // is dropped here because these tuples are BCP-47-ish codes the renderer
  // matches against, not prose).
  ttsGgufRow(
    'voxcpm2',
    'VoxCPM2',
    [
      'ar', 'my', 'zh', 'da', 'nl', 'en', 'fi', 'fr', 'de', 'el', 'he', 'hi', 'id', 'it', 'ja', 'km', 'ko', 'lo',
      'ms', 'no', 'pl', 'pt', 'ru', 'es', 'sw', 'sv', 'tl', 'th', 'tr', 'vi',
    ],
    'voxcpm2',
    'VoxCPM2-GGUF',
    { q8_0: ['voxcpm2-q8_0.gguf', 2_955_000_480], bf16: ['voxcpm2-bf16.gguf', 4_772_288_288] },
    { defaultQuant: 'q8_0', order: 11, clones: true, streaming: true, sampleRate: 48000 },
  ),
  // Irodori-TTS v4 Small: Japanese only (audio.cpp throws "Irodori-TTS language
  // must be ja" for anything else), offline, 48 kHz. Its reference clip is
  // optional -- the request default is no_ref=true, so a bare synth works.
  ttsGgufRow(
    'irodori-tts-v4-small',
    'Irodori TTS v4 Small',
    ['ja'],
    'irodori_tts',
    'Irodori-TTS-v4-Small-GGUF',
    {
      q8_0: ['irodori-tts-v4-small-q8_0.gguf', 1_368_991_360],
      f16: ['irodori-tts-v4-small-f16.gguf', 1_762_148_352],
    },
    { defaultQuant: 'q8_0', order: 12, clones: true, streaming: false, sampleRate: 48000 },
  ),
  // IndexTTS 2.5: offline, 22.05 kHz, and the only card here whose reference
  // clip is MANDATORY -- audio.cpp exposes no built-in voices for it and its
  // request parser refuses without one, so tts_backend._VOICE_REQUIRED_FAMILIES
  // turns that into a clean error before the native layer. `clones=True` with
  // `transcript_required=False`: it needs the clip, not a transcript of it.
  //
  // bilibili's Model Use License is NOT an OSI licence and is not in the SPDX
  // list, hence the LicenseRef- id. It DOES permit commercial use and
  // redistribution below 100M MAU / RMB 1B revenue, so `non_commercial` is
  // False and the consent modal must not call it non-commercial;
  // `requires_consent` is what actually raises the gate (see License's own
  // comment). Terms worth the acknowledgement: the MAU/revenue ceiling, the
  // prohibition on high-risk uses, and the ban on using outputs to train other
  // models.
  ttsGgufRow(
    'index-tts2.5',
    'IndexTTS 2.5',
    ['zh', 'en', 'ja', 'es', 'ar'],
    'index_tts2',
    'IndexTTS2.5-GGUF',
    { q8_0: ['index-tts2_5-q8_0.gguf', 3_502_955_328], f16: ['index-tts2_5-f16.gguf', 4_547_355_072] },
    {
      defaultQuant: 'q8_0', order: 13, clones: true, streaming: false, sampleRate: 22050,
      license: license({
        spdx: 'LicenseRef-bilibili-Model-Use-License',
        name: 'bilibili Model Use License',
        url: 'https://huggingface.co/IndexTeam/IndexTTS-2/blob/main/LICENSE',
        nonCommercial: false,
        sourceRepo: AUDIOCPP_GGUF_REPO,
        attribution: 'bilibili IndexTeam',
      }),
    },
  ),
];

export function ttsModels(): TtsModel[] {
  return [...TTS_MODELS];
}

export function ttsModel(modelId: string): TtsModel | null {
  return TTS_MODELS.find((m) => m.id === modelId) ?? null;
}

/** The static TTS card for `modelId`, or null for an unknown id. */
export function resolveTtsCard(modelId: string): TtsModel | null {
  return ttsModel(modelId);
}
