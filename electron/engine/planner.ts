/**
 * The deployment planner (port of sidecar/sokuji_sidecar/planner.py): given a Machine and a catalog card, the ordered
 * Plans, best first, CPU floor last — tier gating, quant and variant picking, the platform filter. No probing, no
 * downloads, no loading: every environment fact (the platform, the bench cache, the downloaded quants, a deployment's
 * size estimate, whether a compute type's runtime is present, op coverage) arrives as a parameter, supplied by the
 * caller that did the I/O (accel). Every function here is table-testable with plain values.
 */
import {
  TC_CURATED_MIN_RANK, asrModel, resolveTtsCard, translateModel,
  type Deployment, type ModelBase, type TranslateModel, type TtsModel,
} from './catalog';
import type { DeviceProfile, Machine, OpCoverage } from './accel/machine';

/**
 * Per-load hints read from the resolved card and consumed by the backends at load: native_translate reads the two
 * thinking flags and the prompt family; native_tts reads the family (sk_tts_load's hint), the load language
 * (pocket_tts's language package) and the extra files to stage beside the GGUF. All inert by default.
 */
export interface PlanConfig {
  readonly disableThinking: boolean;
  readonly appendNoThink: boolean;
  readonly promptFamily: string;
  readonly ttsFamily: string;
  readonly ttsLanguage: string;
  readonly ttsExtraFiles: ReadonlyArray<readonly [string, number]>;
}

export interface Plan {
  readonly backend: string;
  readonly tier: string;
  readonly device: string;
  readonly computeType: string;
  readonly artifact: string;
  readonly rank: number;
  readonly config: PlanConfig;
}

/** A known model has no deployment runnable on this machine (e.g. a GPU-only model on a CPU-only box). */
export class NoUsablePlan extends Error {
  constructor(modelId: string) {
    super(modelId);
    this.name = 'NoUsablePlan';
  }
}

/** (device index, stage, graph family, compute type) → coverage, or null when nothing was computed (passes). */
export type OpCoverageFor = (index: number, stage: string, family: string, computeType: string) => OpCoverage | null;
/** A deployment's size estimate, or null when unknown. */
export type EstBytes = (d: Deployment) => number | null;
/** Whether a compute type's runtime is present. */
export type FormatReady = (computeType: string) => boolean;
/** The bench cache: generation-and-fingerprint-prefixed keys → RTF (or "tps:" → tokens per second). */
export type BenchCache = Readonly<Record<string, number>>;

/** The default: nothing computed, everything passes (premise 5). */
export const NO_COVERAGE: OpCoverageFor = () => null;

export function planConfig(model: ModelBase): PlanConfig {
  const m = model as Partial<TranslateModel & TtsModel>;
  return {
    disableThinking: m.disableThinking ?? false,
    appendNoThink: m.appendNoThink ?? false,
    promptFamily: m.promptFamily ?? '',
    ttsFamily: m.family ?? '',
    ttsLanguage: m.loadLanguage ?? '',
    ttsExtraFiles: m.extraFiles ?? [],
  };
}

export const TIER_RANK: Readonly<Record<string, number>> = { 'gpu-metal': 3.0, 'gpu-vulkan': 2.5, cpu: 1.0 };
export const TIER_DEVICE: Readonly<Record<string, string>> = { cpu: 'cpu', 'gpu-metal': 'metal', 'gpu-vulkan': 'vulkan' };

/** Deployment.backend → op-recording stage name. */
export const STAGE_OF_BACKEND: Readonly<Record<string, string>> = {
  native_asr: 'asr', native_asr_stream: 'asr', native_translate: 'translate', native_tts: 'tts',
};

// A hosted-macOS VM exposes its GPU as "Apple Paravirtual device" — a virtualisation shim lacking
// has_simdgroup_reduction, so ggml refuses NORM/RMS_NORM/ARGMAX there and every TTS family that normalises aborts the
// process (ruling R36). The description is the only signal: the device still reports kind "metal".
const PARAVIRTUAL_GPU_RE = /paravirtual/i;

/** True when every Metal device this machine reports is a paravirtual shim; an empty list is no evidence of one. */
function paravirtualMetalOnly(machine: Machine): boolean {
  const metal = machine.gpus.filter(([kind]) => kind === 'metal').map(([, desc]) => desc);
  return metal.length > 0 && metal.every((desc) => PARAVIRTUAL_GPU_RE.test(desc ?? ''));
}

export function tierAvailable(tier: string, machine: Machine, _backend: string | null = null): boolean {
  if (tier === 'cpu') return true;
  if (tier === 'gpu-metal') {
    if (paravirtualMetalOnly(machine)) return false;
    const dev = deviceForTier(machine, 'gpu-metal');
    if (dev !== null && dev.known && !dev.features.has('mtl_simdgroup_reduction')) return false; // the structured R36 signal
    return machine.appleSilicon || machine.tcKinds.includes('metal');
  }
  if (tier === 'gpu-vulkan') {
    // The native probe is authoritative (AMD/Intel/NVIDIA). Arch-gated to hosts whose Vulkan binaries exist: x86_64
    // everywhere, plus Linux/aarch64; other arches (Windows-on-ARM) are never offered an unrunnable plan.
    return machine.tcKinds.includes('vulkan')
      && (machine.arch === 'x86_64' || machine.arch === 'AMD64' || (machine.os === 'Linux' && machine.arch === 'aarch64'));
  }
  return false;
}

// audio.cpp computes single-backend: an op its device cannot execute ABORTS the process, so a refused tts rung never
// reaches the loader. llama.cpp and transcribe.cpp schedule an unsupported node onto the CPU and keep running, so their
// coverage is recorded for diagnostics and never gates a plan.
const ABORTS_ON_UNSUPPORTED = new Set(['tts']);

function deviceForTier(machine: Machine, tier: string): DeviceProfile | null {
  const kind = TIER_DEVICE[tier];
  return machine.devices.find((d) => d.kind === kind) ?? null;
}

/**
 * Spec A §3.3: tierAvailable, then — for a GPU tier on a device with a known profile — the family's op coverage for
 * THIS rung. Only the tts stage refuses; asr and translate run with CPU fallback. Anything unknown passes through.
 */
export function deploymentAvailable(model: ModelBase, d: Deployment, machine: Machine, opCoverage: OpCoverageFor = NO_COVERAGE): boolean {
  if (!tierAvailable(d.tier, machine, d.backend)) return false;
  if (d.tier === 'cpu') return true;
  const dev = deviceForTier(machine, d.tier);
  if (dev === null || !dev.known) return true;
  const stage = STAGE_OF_BACKEND[d.backend];
  if (stage === undefined) return true;
  const cov = opCoverage(dev.index, stage, model.graphFamily ?? '', d.computeType);
  if (cov === null) return true;
  if (ABORTS_ON_UNSUPPORTED.has(stage)) return cov.allSupported;
  return true;
}

/** Whether `d` runs on this host's OS (D9). */
export function platformOk(d: Deployment, _machine: Machine, platform: string): boolean {
  return d.platforms.includes(platform);
}

const toPlan = (d: Deployment, config: PlanConfig): Plan => ({
  backend: d.backend, tier: d.tier, device: TIER_DEVICE[d.tier], computeType: d.computeType, artifact: d.artifact, rank: d.rank, config,
});

/** The bench map's key: (backend, device, compute type). */
export const benchKey3 = (backend: string, device: string, computeType: string) => `${backend}|${device}|${computeType}`;

/**
 * Ordered Plans for `model` on `machine`: filter to runnable, rank by tier (GPU >> CPU), then a non-"auto" override
 * pins its tier to the front, then the bench cache demotes a proven-slow GPU plan. The CPU floor always survives.
 */
export function resolveDeployments(
  model: ModelBase, machine: Machine, override = 'auto', bench: ReadonlyMap<string, number> | null = null,
  { platform, opCoverage = NO_COVERAGE }: { platform: string; opCoverage?: OpCoverageFor },
): Plan[] {
  let usable = model.deployments.filter((d) => machine.installed.has(d.backend)
    && deploymentAvailable(model, d, machine, opCoverage)
    && platformOk(d, machine, platform));
  usable = [...usable].sort((a, b) => ((TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0)) || (b.rank - a.rank));
  if (override !== 'auto') {
    // The renderer's device control is auto/cpu/gpu; "gpu" pins ANY accelerator tier.
    const pinned = (d: Deployment) => TIER_DEVICE[d.tier] === override || (override === 'gpu' && d.tier !== 'cpu');
    usable = [...usable.filter(pinned), ...usable.filter((d) => !pinned(d))];
  }
  const config = planConfig(model);
  let plans = usable.map((d) => toPlan(d, config));
  // Bench demotion is an AUTO-mode refinement; an explicit override is never second-guessed.
  if (bench && bench.size > 0 && override === 'auto') plans = applyBench(plans, bench);
  return plans;
}

export function benchKey(fingerprint: string, modelId: string, backend: string, device: string, computeType: string): string {
  return `${fingerprint}|${modelId}|${backend}|${device}|${computeType}`;
}

/** Every bench entry, read and written: the generation names the software, the fingerprint the hardware. */
export function cacheKey(machine: Machine, ns: string, modelId: string, backend: string, device: string, computeType: string): string {
  return `${machine.generation}|${ns}${benchKey(machine.fingerprint, modelId, backend, device, computeType)}`;
}

function resolveModel(
  model: ModelBase, modelId: string, override: string, machine: Machine,
  { cache, platform, opCoverage = NO_COVERAGE }: { cache: BenchCache; platform: string; opCoverage?: OpCoverageFor },
): Plan[] {
  const bench = new Map<string, number>();
  for (const d of model.deployments) {
    const device = TIER_DEVICE[d.tier];
    const key = cacheKey(machine, '', modelId, d.backend, device, d.computeType);
    if (key in cache) bench.set(benchKey3(d.backend, device, d.computeType), cache[key]);
  }
  const plans = resolveDeployments(model, machine, override, bench.size > 0 ? bench : null, { platform, opCoverage });
  if (plans.length === 0) throw new NoUsablePlan(modelId);
  return plans;
}

/**
 * The size-descending fit walk shared by tcPickQuant and llamacppVariantRow: `sized` maps compute type → a size with
 * the caller's resident factor baked in. A non-empty `downloaded` restricts the candidates, but only when that leaves
 * at least one. Returns the largest that fits within `budget`, or null.
 */
export function fitWalk(sized: ReadonlyMap<string, number>, { budget, downloaded }: { budget: number; downloaded: ReadonlySet<string> | null }): string | null {
  let entries = [...sized];
  if (downloaded && downloaded.size > 0) {
    const restricted = entries.filter(([q]) => downloaded.has(q));
    if (restricted.length > 0) entries = restricted;
  }
  for (const [quant, size] of [...entries].sort((a, b) => b[1] - a[1])) {
    if (size <= budget) return quant;
  }
  return null;
}

export const TC_RESIDENT_FACTOR = 1.15;

/**
 * The STABLE per-machine basis for quant selection: the largest device's TOTAL memory. Quant choice only decides which
 * file is recommended for download — and the file downloaded is the one run — so the basis must never flap with
 * transient memory pressure. Runtime pressure is placement's job (the loader's GPU → CPU fallback).
 */
export function quantBudgetBytes(machine: Machine): number | null {
  const total = machine.gpus.reduce((max, [, , t]) => Math.max(max, t), 0);
  return total || null;
}

/** The first key with the smallest value, in insertion order (Python's `min(d, key=d.get)`). */
function minKey(m: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  for (const [k, v] of m) if (best === null || v < m.get(best)!) best = k;
  return best;
}

/** The first key with the largest value, in insertion order (Python's `max(d, key=d.get)`). */
function maxKey(m: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  for (const [k, v] of m) if (best === null || v > m.get(best)!) best = k;
  return best;
}

const mapFilter = (m: ReadonlyMap<string, number>, keep: (q: string) => boolean) => new Map([...m].filter(([q]) => keep(q)));

/**
 * The quant for a multi-quant native ASR card: the pin wins; on a GPU-capable machine walk quality-descending and take
 * the first that fits FULLY resident within the budget, else the rank-default; without a GPU the smallest wins (CPU is
 * bandwidth-bound: smaller is faster).
 */
export function tcPickQuant(
  model: ModelBase, machine: Machine, pin: string | null, budget: number | null,
  downloaded: ReadonlySet<string> | null = null, { opCoverage = NO_COVERAGE }: { opCoverage?: OpCoverageFor } = {},
): string {
  const sizesAll = new Map<string, number>();   // every listed rung: the pin and the downloaded restriction see these
  let sizes = new Map<string, number>();        // curated rungs only: the auto-recommend walk
  let def: string | null = null;                // the highest-ranked rung of any kind
  let bestRank = -1.0;
  for (const d of model.deployments) {
    if (d.estBytes && (!sizesAll.has(d.computeType) || d.estBytes > sizesAll.get(d.computeType)!)) sizesAll.set(d.computeType, d.estBytes);
    if (d.rank >= TC_CURATED_MIN_RANK && d.estBytes && (!sizes.has(d.computeType) || d.estBytes > sizes.get(d.computeType)!)) {
      sizes.set(d.computeType, d.estBytes);     // listed-only (f16/q5) never auto-recommended
    }
    if (d.rank > bestRank) {
      bestRank = d.rank;
      def = d.computeType;
    }
  }
  if (pin !== null && sizesAll.has(pin)) return pin;
  // Load-time reality: only cached quants load — restrict when any exist (a downloaded listed-only rung counts).
  if (downloaded && downloaded.size > 0) {
    const cached = mapFilter(sizesAll, (q) => downloaded.has(q));
    if (cached.size > 0) {
      sizes = cached;
      if (def === null || !sizes.has(def)) def = maxKey(sizes);
    }
  }
  const gpuPossible = model.deployments.some((d) => d.tier !== 'cpu' && deploymentAvailable(model, d, machine, opCoverage));
  if (!gpuPossible) return (sizes.size > 0 ? minKey(sizes) : def)!;
  if (budget === null || sizes.size === 0) return def!;
  // The walk sees only RUNNABLE rungs (spec A §3.3); if none has an available GPU row, the walk keeps them all.
  const runnable = mapFilter(sizes, (q) => model.deployments.some((d) => d.computeType === q && d.tier !== 'cpu' && deploymentAvailable(model, d, machine, opCoverage)));
  if (runnable.size > 0) sizes = runnable;
  const picked = fitWalk(new Map([...sizes].map(([q, sz]) => [q, sz * TC_RESIDENT_FACTOR])), { budget, downloaded: null });
  return picked ?? def!;
}

export interface ResolveOptions {
  machine: Machine;
  platform: string;
  cache: BenchCache;
  downloaded: ReadonlySet<string>;
  pin?: string | null;
  opCoverage?: OpCoverageFor;
}

const withDeployments = <M extends ModelBase>(model: M, deployments: readonly Deployment[]): M => ({ ...model, deployments });

export function resolve(modelId: string, override = 'auto', { machine, platform, cache, downloaded, pin = null, opCoverage = NO_COVERAGE }: ResolveOptions): Plan[] {
  let model: ModelBase | null = asrModel(modelId);
  if (model === null) throw new Error(`unknown asr model: ${modelId}`);
  // Multi-quant ladder: narrow to ONE quant before the generic tier resolution, so plans stay one per tier. The quant
  // is the download recommendation, restricted to what is cached.
  if (new Set(model.deployments.map((d) => d.computeType)).size > 1) {
    const quant = tcPickQuant(model, machine, pin, quantBudgetBytes(machine), downloaded, { opCoverage });
    model = withDeployments(model, model.deployments.filter((d) => d.computeType === quant));
  }
  return resolveModel(model, modelId, override, machine, { cache, platform, opCoverage });
}

/** A GPU pick and its CPU floor at the same quant (or any CPU row), installed backends only. */
function pickWithCpuFloor(model: ModelBase, chosen: Deployment | null, machine: Machine, modelId: string): Deployment[] {
  let cpu = chosen !== null ? model.deployments.find((d) => d.tier === 'cpu' && d.computeType === chosen.computeType) ?? null : null;
  if (cpu === null) cpu = model.deployments.find((d) => d.tier === 'cpu') ?? null;
  const picks = [chosen, ...(cpu !== null && cpu !== chosen ? [cpu] : [])].filter((d): d is Deployment => d !== null && machine.installed.has(d.backend));
  if (picks.length === 0) throw new NoUsablePlan(modelId);
  return picks;
}

export function resolveTranslate(
  modelId: string, override = 'auto',
  { machine, platform, cache, downloaded, reservedBytes = 0, pin = null, estBytes, formatReady, opCoverage = NO_COVERAGE }:
    ResolveOptions & { reservedBytes?: number; estBytes: EstBytes; formatReady: FormatReady },
): Plan[] {
  let model: ModelBase | null = translateModel(modelId);
  if (model === null) throw new Error(`unknown translate model: ${modelId}`);
  // The auto branch never flows through resolveDeployments' filter, so drop off-platform rows up front.
  model = withDeployments(model, model.deployments.filter((d) => platformOk(d, machine, platform)));
  if (override === 'auto') {
    // The same stable basis as the download recommendation: the file run is the file recommended.
    const chosen = selectVariant(model, machine, reservedBytes, pin, quantBudgetBytes(machine), downloaded, { estBytes, formatReady, opCoverage });
    const picks = pickWithCpuFloor(model, chosen, machine, modelId);
    const config = planConfig(model);
    let plans = picks.map((d) => toPlan(d, config));
    // Bench correction (E6): when both the GPU pick and its CPU floor have measured decode throughput and the GPU is
    // not faster, lead with CPU. tps is higher-is-better.
    if (plans.length > 1 && plans[0].device !== 'cpu') {
      const tps = (p: Plan) => cache[cacheKey(machine, 'tps:', modelId, p.backend, p.device, p.computeType)];
      const gpuTps = tps(plans[0]);
      const cpuTps = tps(plans[1]);
      if (gpuTps !== undefined && cpuTps !== undefined && gpuTps <= cpuTps) plans = [plans[1], plans[0]];
    }
    return plans;
  }
  // An explicit device override still honours a quant pin on a GGUF LLM card.
  if (pin !== null && isGgufLlm(model)) {
    const quant = llamacppQuant(model, pin);
    model = withDeployments(model, model.deployments.filter((d) => d.computeType === quant));
  }
  return resolveModel(model, modelId, override, machine, { cache, platform, opCoverage });
}

/**
 * Plans for a TTS card. Every card is a single-file audio.cpp GGUF with the same tiers per quant, so selection is
 * resolveTranslate's GGUF-LLM auto path: the largest fully-resident quant plus a same-quant (or any) CPU floor, and a
 * plain tier-pinned resolve on an explicit override.
 */
export function resolveTts(
  modelId: string, override = 'auto',
  { machine, platform, cache, downloaded = new Set(), pin = null, estBytes, opCoverage = NO_COVERAGE }:
    Omit<ResolveOptions, 'downloaded'> & { downloaded?: ReadonlySet<string>; estBytes?: EstBytes },
): Plan[] {
  let model: ModelBase | null = resolveTtsCard(modelId);
  if (model === null) throw new Error(`unknown tts model: ${modelId}`);
  model = withDeployments(model, model.deployments.filter((d) => platformOk(d, machine, platform)));
  const est = estBytes ?? ((d: Deployment) => d.estBytes);
  if (override === 'auto') {
    const chosen = llamacppVariantRow(model, machine, pin, 0, quantBudgetBytes(machine), downloaded, { estBytes: est, opCoverage });
    const picks = pickWithCpuFloor(model, chosen, machine, modelId);
    const config = planConfig(model);
    return picks.map((d) => toPlan(d, config));
  }
  if (pin !== null) {
    const quant = llamacppQuant(model, pin);
    model = withDeployments(model, model.deployments.filter((d) => d.computeType === quant));
  }
  return resolveModel(model, modelId, override, machine, { cache, platform, opCoverage });
}

// Free memory must clear weights × this factor plus a fixed slab for the GPU runtime's context before a GPU load.
const VRAM_WEIGHT_FACTOR = 1.2;
const VRAM_CONTEXT_BYTES = 2 ** 30;
// FP8 dequantises per forward: peak ~1.5× weights. Missing → VRAM_WEIGHT_FACTOR.
const VARIANT_WEIGHT_FACTOR: Readonly<Record<string, number>> = { fp8: 1.5 };

function weightFactor(computeType: string): number {
  return VARIANT_WEIGHT_FACTOR[computeType] ?? VRAM_WEIGHT_FACTOR;
}

// Higher is better quality.
const VARIANT_QUALITY: Readonly<Record<string, number>> = { bfloat16: 3.0, float16: 3.0, fp8: 2.0, int4: 1.5, nvfp4: 1.8 };

/** A single-file GGUF card picked by the budget fit walk: native_translate and native_tts. */
export function isGgufLlm(model: ModelBase): boolean {
  return model.deployments[0].backend === 'native_translate' || model.deployments[0].backend === 'native_tts';
}

/** `pin` when it names one of the card's quants, else the rank-default quant. */
export function llamacppQuant(model: ModelBase, pin: string | null): string {
  const quants = new Map<string, Deployment>();
  for (const d of model.deployments) {
    const cur = quants.get(d.computeType);
    if (cur === undefined || d.rank > cur.rank) quants.set(d.computeType, d);
  }
  if (pin !== null && quants.has(pin)) return pin;
  let best: Deployment | null = null;
  for (const d of quants.values()) if (best === null || d.rank > best.rank) best = d;
  return best!.computeType;
}

// A fully-resident model needs its weights plus KV/context headroom.
const LLAMA_RESIDENT_FACTOR = 1.1;
// Below this fraction of the smallest quant's size, partial offload is slower than fully CPU.
const LLAMA_MIN_FIT_FRACTION = 0.5;

/**
 * Pick (quant, tier) for a GGUF card: a pre-load download and placement heuristic, not a runtime memory manager.
 * pin → that quant. Budget known → the LARGEST quant that fits fully resident (size × 1.1 ≤ budget − reserved);
 * nothing fits → keep the GPU tier at the rank-default quant while the budget still covers half the smallest quant
 * (unified memory always stays), below that fully CPU. Budget unknown → the rank-default quant, best tier.
 */
export function llamacppVariantRow(
  model: ModelBase, machine: Machine, pin: string | null, reservedBytes = 0, budgetBytes: number | null = null,
  downloaded: ReadonlySet<string> | null = null,
  { estBytes, opCoverage = NO_COVERAGE }: { estBytes: EstBytes; opCoverage?: OpCoverageFor },
): Deployment | null {
  const row = (quant: string, wantGpu = true): Deployment | null => {
    const rows = model.deployments.filter((d) => d.computeType === quant);
    const sorted = [...rows].sort((a, b) => (wantGpu ? (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0) : (TIER_RANK[a.tier] ?? 0) - (TIER_RANK[b.tier] ?? 0)));
    for (const d of sorted) {
      if (deploymentAvailable(model, d, machine, opCoverage) && (wantGpu || d.tier === 'cpu')) return d;
    }
    return sorted.find((d) => d.tier === 'cpu') ?? null;
  };

  if (pin !== null && llamacppQuant(model, pin) === pin) return row(pin);

  let defaultQuant = llamacppQuant(model, null);
  const gpuPossible = model.deployments.some((d) => d.tier !== 'cpu' && deploymentAvailable(model, d, machine, opCoverage));
  if (budgetBytes === null || !gpuPossible) return row(defaultQuant);

  const budget = budgetBytes - reservedBytes;
  let quants = new Map<string, number>();
  for (const d of model.deployments) {
    const size = estBytes(d);
    if (size && (!quants.has(d.computeType) || size > quants.get(d.computeType)!)) quants.set(d.computeType, size);
  }
  if (downloaded && downloaded.size > 0) {
    const cached = mapFilter(quants, (q) => downloaded.has(q));
    if (cached.size > 0) {
      quants = cached;
      if (!quants.has(defaultQuant)) defaultQuant = maxKey(quants)!;
    }
  }
  if (quants.size === 0) return row(defaultQuant);
  // Only RUNNABLE rungs (spec A §3.3); if none has an available GPU row, the walk keeps them all.
  const runnable = mapFilter(quants, (q) => model.deployments.some((d) => d.computeType === q && d.tier !== 'cpu' && deploymentAvailable(model, d, machine, opCoverage)));
  if (runnable.size > 0) quants = runnable;
  const picked = fitWalk(new Map([...quants].map(([q, sz]) => [q, sz * LLAMA_RESIDENT_FACTOR])), { budget, downloaded: null });
  if (picked !== null) return row(picked);
  // Nothing fully fits. Unified memory (Apple Silicon): moving to CPU frees nothing and loses Metal — stay on GPU.
  if (machine.appleSilicon) return row(defaultQuant);
  const smallest = Math.min(...quants.values());
  if (budget >= smallest * LLAMA_MIN_FIT_FRACTION) return row(defaultQuant);
  return row(defaultQuant, false);
}

/**
 * The best downloadable variant of `model` for this machine; deterministic. GGUF cards take llamacppVariantRow. The
 * generic path (no shipped card takes it) falls back to the CPU floor when no GPU variant fits, the memory total is
 * unknown, or a format's runtime is missing; a valid `pin` forces that variant.
 */
export function selectVariant(
  model: ModelBase, machine: Machine, reservedBytes: number, pin: string | null = null, budgetBytes: number | null = null,
  downloaded: ReadonlySet<string> | null = null,
  { estBytes, formatReady, opCoverage = NO_COVERAGE }: { estBytes: EstBytes; formatReady: FormatReady; opCoverage?: OpCoverageFor },
): Deployment | null {
  if (isGgufLlm(model)) return llamacppVariantRow(model, machine, pin, reservedBytes, budgetBytes, downloaded, { estBytes, opCoverage });
  const total = quantBudgetBytes(machine);
  const cpuFloor = model.deployments.find((d) => d.tier === 'cpu') ?? null;
  const candidate = (d: Deployment): boolean => {
    if (d.tier === 'cpu') return false;
    if (!machine.installed.has(d.backend) || !formatReady(d.computeType)) return false;
    if (total === null || !deploymentAvailable(model, d, machine, opCoverage)) return false;
    const need = estBytes(d);
    if (need === null) return false;
    return need * weightFactor(d.computeType) <= total - reservedBytes - VRAM_CONTEXT_BYTES;
  };
  const cands = model.deployments.filter(candidate);
  if (pin !== null) {
    const pinned = cands.find((d) => d.computeType === pin);
    if (pinned) return pinned;
  }
  if (cands.length > 0) {
    let best = cands[0];
    const score = (d: Deployment): [number, number] => [VARIANT_QUALITY[d.computeType] ?? 0.0, d.rank];
    for (const d of cands.slice(1)) {
      const [q, r] = score(d);
      const [bq, br] = score(best);
      if (q > bq || (q === bq && r > br)) best = d;
    }
    return best;
  }
  return cpuFloor;
}

/** Demote any non-CPU plan whose cached RTF is ≥ the CPU floor's (proven not faster). `bench`: benchKey3 → RTF. */
export function applyBench(plans: Plan[], bench: ReadonlyMap<string, number>): Plan[] {
  if (bench.size === 0) return plans;
  const cpu = plans.find((p) => p.tier === 'cpu');
  const cpuRtf = cpu ? bench.get(benchKey3(cpu.backend, cpu.device, cpu.computeType)) : undefined;
  if (cpuRtf === undefined) return plans;
  const fast: Plan[] = [];
  const slow: Plan[] = [];
  for (const p of plans) {
    const rtf = bench.get(benchKey3(p.backend, p.device, p.computeType));
    (p.tier !== 'cpu' && rtf !== undefined && rtf >= cpuRtf ? slow : fast).push(p);
  }
  return [...fast, ...slow];
}
