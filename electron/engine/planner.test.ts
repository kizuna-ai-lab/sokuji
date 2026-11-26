// @vitest-environment node
/**
 * The planner (ported from sidecar/tests/test_planner.py, plus test_catalog.py's tier-order case): every function
 * called with a hand-built Machine and plain values or injected callables, no module patched. Machine fixtures mirror
 * the characterisation suite's four, plus the shapes the platform and tier branches need.
 */
import './test/env';
import { describe, expect, it } from 'vitest';
import {
  asrModel, asrModelCard, deployment, translateModel, translateModelCard, ttsModel, type Deployment, type ModelBase,
} from './catalog';
import { machine, type DeviceProfile, type Machine, type OpCoverage } from './accel/machine';
import {
  NO_COVERAGE, applyBench, benchKey3, cacheKey, deploymentAvailable, fitWalk, llamacppVariantRow, planConfig, platformOk,
  quantBudgetBytes, resolve, resolveDeployments, resolveTranslate, resolveTts, selectVariant, tcPickQuant, tierAvailable,
  type OpCoverageFor, type Plan, type PlanConfig,
} from './planner';

const GiB = 2 ** 30;
const MiB = 2 ** 20;
const ALL_BACKENDS = new Set(['native_asr', 'native_asr_stream', 'native_translate', 'native_tts']);

const CPU_ONLY = machine({ os: 'Linux', arch: 'x86_64', cpuCores: 8, appleSilicon: false, installed: ALL_BACKENDS, fingerprint: 'p-cpu', tcKinds: ['cpu'] });
const CUDA_12GB = machine({ os: 'Linux', arch: 'x86_64', cpuCores: 16, appleSilicon: false, installed: ALL_BACKENDS, fingerprint: 'p-cuda12', tcKinds: ['vulkan', 'cpu'], gpus: [['vulkan', 'NVIDIA GeForce RTX 4070', 12 * GiB]] });
const CUDA_24GB = machine({ os: 'Linux', arch: 'x86_64', cpuCores: 32, appleSilicon: false, installed: ALL_BACKENDS, fingerprint: 'p-cuda24', tcKinds: ['vulkan', 'cpu'], gpus: [['vulkan', 'NVIDIA GeForce RTX 4090', 24 * GiB]] });
const APPLE_SILICON = machine({ os: 'Darwin', arch: 'arm64', cpuCores: 10, appleSilicon: true, installed: ALL_BACKENDS, fingerprint: 'p-apple', tcKinds: ['metal', 'cpu'], gpus: [['metal', 'Apple M2', 16 * GiB]] });
// Linux/aarch64 NVIDIA box (DGX Spark shape): Vulkan-capable.
const ARM_NV = machine({ os: 'Linux', arch: 'aarch64', cpuCores: 20, appleSilicon: false, installed: new Set(['native_asr', 'native_asr_stream', 'native_translate']), fingerprint: 'p-arm-nv', tcKinds: ['cpu', 'vulkan'], gpus: [['vulkan', 'NVIDIA GB10', 97 * GiB]] });
// Windows-on-ARM: reports vulkan but has no vulkan asset lane.
const WOA = machine({ os: 'Windows', arch: 'ARM64', cpuCores: 8, appleSilicon: false, installed: new Set(), fingerprint: 'p-woa', tcKinds: ['cpu', 'vulkan'] });
const INTEL_MAC = machine({ os: 'Darwin', arch: 'x86_64', cpuCores: 8, appleSilicon: false, installed: new Set(), fingerprint: 'p-intel-mac', tcKinds: ['cpu', 'metal'] });

function genericMachine({ osName = 'Linux', arch = 'x86_64', apple = false, installed = ALL_BACKENDS, tc = [] as string[], gpus = [] as Array<[string, string, number]>, fingerprint = 'p-generic' } = {}): Machine {
  return machine({ os: osName, arch, cpuCores: 8, appleSilicon: apple, installed, fingerprint, tcKinds: tc, gpus });
}

/** An x86_64 box whose probe sees one NVIDIA device through Vulkan with `vramMb` total (0: no memory figure). */
function nvMachine(vramMb: number, installed: ReadonlySet<string> = ALL_BACKENDS): Machine {
  return machine({ os: 'Linux', arch: 'x86_64', cpuCores: 8, appleSilicon: false, installed, fingerprint: `p-nv-${vramMb}`, tcKinds: ['vulkan', 'cpu'], gpus: [['vulkan', 'NVIDIA GeForce RTX 4070', vramMb * MiB]] });
}

function llmMachine({ gpu = false, apple = false, vramMb = 12282, installed = new Set(['native_translate']) as ReadonlySet<string> } = {}): Machine {
  if (apple) return machine({ os: 'Darwin', arch: 'arm64', cpuCores: 10, appleSilicon: true, installed, fingerprint: 'p-llm-apple', tcKinds: ['cpu', 'metal'], gpus: [['metal', 'Apple M2', 16 * GiB]] });
  return machine({ os: 'Linux', arch: 'x86_64', cpuCores: 8, appleSilicon: false, installed, fingerprint: `p-llm-${gpu}-${vramMb}`, tcKinds: gpu ? ['vulkan', 'cpu'] : ['cpu'], gpus: gpu ? [['vulkan', 'NVIDIA GeForce RTX 4070', vramMb * MiB]] : [] });
}

const winDmlMachine = (installed: ReadonlySet<string>) => machine({ os: 'Windows', arch: 'AMD64', cpuCores: 8, appleSilicon: false, installed, fingerprint: 'p-win-dml' });

const profile = (p: Partial<DeviceProfile> & Pick<DeviceProfile, 'index' | 'kind'>): DeviceProfile => ({
  name: `${p.kind}${p.index}`, description: '', memTotal: 0, known: true, features: new Set(), driverName: '', driverVersion: '', deviceUuid: '', cpuFeatures: '', ...p,
});

/** A machine with a known device profile (sidecar/tests/_fixtures.py). */
function knownGpuMachine(kind = 'vulkan'): Machine {
  const dev = profile({ index: 0, kind, name: `${kind}0`, description: 'GB10', memTotal: 96 * GiB, features: new Set(), driverName: 'NVIDIA', driverVersion: '580', deviceUuid: 'ab'.repeat(16) });
  const cpu = profile({ index: 1, kind: 'cpu', name: 'CPU', description: 'CPU', memTotal: 120 * GiB, cpuFeatures: 'NEON=1' });
  return machine({ os: 'Linux', arch: 'x86_64', cpuCores: 8, appleSilicon: false, installed: new Set(['native_tts', 'native_translate', 'native_asr']), fingerprint: 'fp', tcKinds: [kind, 'cpu'], gpus: [[kind, 'GB10', 96 * GiB]], devices: [dev, cpu], generation: 'G1' });
}

const must = <T>(v: T | null | undefined): T => {
  if (v === null || v === undefined) throw new Error('missing');
  return v;
};
const card = (id: string): ModelBase => must(asrModel(id) ?? translateModel(id) ?? ttsModel(id));
const est = (d: Deployment) => d.estBytes;
const ready = () => true;
const NONE_DOWNLOADED = new Set<string>();
const INERT: PlanConfig = { disableThinking: false, appendNoThink: false, promptFamily: '', ttsFamily: '', ttsLanguage: '', ttsExtraFiles: [] };
const plan = (backend: string, tier: string, device: string, computeType: string, artifact: string, rank: number): Plan => ({ backend, tier, device, computeType, artifact, rank, config: INERT });
const config = (over: Partial<PlanConfig>): PlanConfig => ({ ...INERT, ...over });

describe('fitWalk', () => {
  it.each([
    ['largest_fitting_wins', { q4: 10, q8: 20 }, 25, null, 'q8'],
    ['skips_too_big_falls_to_next', { q4: 10, q8: 20 }, 15, null, 'q4'],
    ['nothing_fits_returns_none', { q4: 10, q8: 20 }, 5, null, null],
    ['empty_sized_returns_none', {}, 100, null, null],
    ['exact_boundary_fits', { q4: 10, q8: 20 }, 20, null, 'q8'],
    ['downloaded_restricts_candidate_set', { q4: 10, q8: 20, q16: 40 }, 100, ['q4'], 'q4'],
    ['empty_downloaded_set_is_no_restriction', { q4: 10, q8: 20, q16: 40 }, 100, [], 'q16'],
    ['downloaded_with_no_overlap_falls_back_to_full_set', { q4: 10, q8: 20, q16: 40 }, 100, ['nonexistent'], 'q16'],
    ['none_downloaded_is_no_restriction', { q4: 10, q8: 20, q16: 40 }, 100, null, 'q16'],
  ] as const)('%s', (_id, sized, budget, downloaded, expected) => {
    expect(fitWalk(new Map(Object.entries(sized)), { budget, downloaded: downloaded === null ? null : new Set(downloaded) })).toBe(expected);
  });
});

describe('platformOk', () => {
  it('the default platforms allow every OS', () => {
    const d = deployment('x', 'cpu', 'q4', 'repo', 1.0);
    for (const plat of ['linux', 'windows', 'macos']) expect(platformOk(d, CPU_ONLY, plat)).toBe(true);
  });

  it('filters to the declared platforms', () => {
    const d = deployment('x', 'gpu-dml', 'q4', 'repo', 1.0, { platforms: ['windows'] });
    expect(platformOk(d, winDmlMachine(new Set()), 'windows')).toBe(true);
    expect(platformOk(d, winDmlMachine(new Set()), 'linux')).toBe(false);
  });
});

describe('tierAvailable', () => {
  it('gpu-vulkan covers Linux/aarch64, not Windows-on-ARM', () => {
    expect(tierAvailable('gpu-vulkan', genericMachine({ tc: ['cpu', 'vulkan'] }))).toBe(true);
    expect(tierAvailable('gpu-vulkan', ARM_NV)).toBe(true);
    expect(tierAvailable('gpu-vulkan', WOA)).toBe(false);
  });

  it('gpu-cuda and gpu-dml are never available', () => {
    expect(tierAvailable('gpu-cuda', nvMachine(12288))).toBe(false);
    expect(tierAvailable('gpu-dml', winDmlMachine(new Set()))).toBe(false);
  });

  it("gpu-vulkan needs the probe's own signal, not an NVIDIA description", () => {
    expect(tierAvailable('gpu-vulkan', genericMachine({ gpus: [['vulkan', 'NVIDIA GeForce RTX 4070', 12 * GiB]] }))).toBe(false);
  });

  it('gpu-vulkan is not lit by a DML adapter alone', () => {
    const dmlOnly = genericMachine({ installed: new Set(['native_translate']) });
    expect(tierAvailable('gpu-vulkan', dmlOnly)).toBe(false);
    expect(tierAvailable('gpu-vulkan', genericMachine({ tc: ['cpu', 'vulkan'] }))).toBe(true);
    const plans = resolveTranslate('qwen3-0.6b', 'auto', { machine: dmlOnly, platform: 'linux', cache: {}, downloaded: NONE_DOWNLOADED, estBytes: est, formatReady: ready });
    expect(plans.map((p) => p.device)).toEqual(['cpu']);
  });

  it('gpu-metal on Apple Silicon', () => {
    expect(tierAvailable('gpu-metal', genericMachine({ osName: 'Darwin', arch: 'arm64', apple: true, installed: new Set() }))).toBe(true);
  });

  it('gpu-metal through the probe\'s metal kind', () => {
    expect(tierAvailable('gpu-metal', genericMachine({ osName: 'Darwin', arch: 'arm64', apple: false, tc: ['cpu', 'metal'], installed: new Set() }))).toBe(true);
  });
});

/** A virtualised Mac (ruling R36): Apple Silicon, a metal kind, and a paravirtual description. */
const paravirtualMac = (desc = 'Apple Paravirtual device') => machine({
  os: 'Darwin', arch: 'arm64', cpuCores: 3, appleSilicon: true, installed: ALL_BACKENDS, fingerprint: 'p-paravirt', tcKinds: ['metal', 'cpu'], gpus: [['metal', desc, 8 * GiB]],
});

describe('gpu-metal on a paravirtual GPU', () => {
  it('is excluded, case-insensitively and by substring; the CPU floor survives', () => {
    expect(tierAvailable('gpu-metal', paravirtualMac())).toBe(false);
    expect(tierAvailable('gpu-metal', paravirtualMac('APPLE PARAVIRTUAL DEVICE'))).toBe(false);
    expect(tierAvailable('gpu-metal', paravirtualMac('Paravirtual GPU (VZ)'))).toBe(false);
    expect(tierAvailable('cpu', paravirtualMac())).toBe(true);
  });

  it('is kept on real Apple Silicon and when no description was reported', () => {
    expect(tierAvailable('gpu-metal', APPLE_SILICON)).toBe(true);
    expect(tierAvailable('gpu-metal', paravirtualMac('Apple M4'))).toBe(true);
    expect(tierAvailable('gpu-metal', INTEL_MAC)).toBe(true);
  });

  it('removes the metal plans end to end, even under a GPU override', () => {
    const m = paravirtualMac();
    expect(resolveTts('moss-tts-nano', 'auto', { machine: m, platform: 'macos', cache: {}, downloaded: new Set() }).map((p) => p.tier)).toEqual(['cpu']);
    expect(new Set(resolveTts('moss-tts-nano', 'gpu', { machine: m, platform: 'macos', cache: {}, downloaded: new Set() }).map((p) => p.tier))).toEqual(new Set(['cpu']));
    expect(resolveTts('moss-tts-nano', 'auto', { machine: paravirtualMac('Apple M4'), platform: 'macos', cache: {}, downloaded: new Set() })[0].tier).toBe('gpu-metal');
  });
});

const modelCpuAndVulkan = () => asrModelCard('m', 'M', ['multi'], [
  deployment('native_asr', 'gpu-vulkan', 'float16', 'large-v3', 1.0),
  deployment('native_asr', 'cpu', 'int8', 'large-v3', 1.0),
]);

describe('resolveDeployments', () => {
  it('prefers the GPU when one is present', () => {
    expect(resolveDeployments(modelCpuAndVulkan(), nvMachine(12288), 'auto', null, { platform: 'linux' }).map((p) => p.device)).toEqual(['vulkan', 'cpu']);
  });

  it('a CPU-only machine drops the GPU plan', () => {
    expect(resolveDeployments(modelCpuAndVulkan(), CPU_ONLY, 'auto', null, { platform: 'linux' }).map((p) => p.device)).toEqual(['cpu']);
  });

  it('an override pins CPU to the front', () => {
    expect(resolveDeployments(modelCpuAndVulkan(), nvMachine(12288), 'cpu', null, { platform: 'linux' }).map((p) => p.device)).toEqual(['cpu', 'vulkan']);
  });

  it('a GPU-only model on a CPU machine has no plan', () => {
    const gpuOnly = asrModelCard('v', 'Voxtral', ['multi'], [deployment('llamacpp', 'gpu-vulkan', 'q4', 'v', 1.0)]);
    expect(resolveDeployments(gpuOnly, CPU_ONLY, 'auto', null, { platform: 'linux' })).toEqual([]);
  });

  it('a translation card leads with gpu-vulkan, then cpu (from test_catalog.py)', () => {
    const m = machine({ os: 'Linux', arch: 'x86_64', cpuCores: 8, appleSilicon: false, installed: new Set(['native_translate']), fingerprint: 't', tcKinds: ['cpu', 'vulkan'], gpus: [['vulkan', 'NVIDIA x', 12288]] });
    const seen: string[] = [];
    for (const p of resolveDeployments(must(translateModel('translategemma-4b')), m, 'auto', null, { platform: 'linux' })) if (!seen.includes(p.tier)) seen.push(p.tier);
    expect(seen).toEqual(['gpu-vulkan', 'cpu']);
  });
});

describe('applyBench', () => {
  it('demotes a GPU measured slower than the CPU', () => {
    const cpu = plan('ctranslate2', 'cpu', 'cpu', 'int8', 'tiny', 1.0);
    const gpu = plan('ctranslate2', 'gpu-cuda', 'cuda', 'float16', 'tiny', 1.0);
    const slow = new Map([[benchKey3('ctranslate2', 'cuda', 'float16'), 0.9], [benchKey3('ctranslate2', 'cpu', 'int8'), 0.4]]);
    expect(applyBench([gpu, cpu], slow).map((p) => p.device)).toEqual(['cpu', 'cuda']);
    const fast = new Map([[benchKey3('ctranslate2', 'cuda', 'float16'), 0.1], [benchKey3('ctranslate2', 'cpu', 'int8'), 0.4]]);
    expect(applyBench([gpu, cpu], fast).map((p) => p.device)).toEqual(['cuda', 'cpu']);
  });
});

const asrOpts = (m: Machine, over: { cache?: Record<string, number>; downloaded?: ReadonlySet<string>; pin?: string | null } = {}) => ({
  machine: m, platform: 'linux', cache: over.cache ?? {}, downloaded: over.downloaded ?? NONE_DOWNLOADED, pin: over.pin ?? null,
});

describe('resolve (ASR)', () => {
  it('an unknown model throws', () => {
    expect(() => resolve('nope', 'auto', asrOpts(CPU_ONLY))).toThrow('unknown asr model: nope');
  });

  it.each([
    ['gpu_present_vulkan_first', CUDA_12GB, 'auto', ['vulkan', 'cpu'], 'q8_0'],
    ['gpu_present_24gb_vulkan_first', CUDA_24GB, 'auto', ['vulkan', 'cpu'], 'q8_0'],
    ['cpu_only_drops_gpu_plan', CPU_ONLY, 'auto', ['cpu'], null],
    ['override_pins_cpu_on_nvidia', CUDA_12GB, 'cpu', ['cpu', 'vulkan'], 'q8_0'],
  ] as const)('whisper-base: %s', (_id, m, override, devices, quant) => {
    const plans = resolve('whisper-base', override, asrOpts(m));
    expect(plans.map((p) => p.device)).toEqual(devices);
    expect(plans.every((p) => p.backend === 'native_asr')).toBe(true);
    if (quant !== null) expect(plans.every((p) => p.computeType === quant)).toBe(true);
  });

  it('sense-voice: vulkan then cpu on NVIDIA', () => {
    expect(resolve('sense-voice', 'auto', asrOpts(CUDA_12GB)).map((p) => p.device)).toEqual(['vulkan', 'cpu']);
  });

  it("leads with vulkan from the probe's own signal, with no NVIDIA device", () => {
    expect(resolve('whisper-base', 'auto', asrOpts(genericMachine({ tc: ['cpu', 'vulkan'] })))[0].device).toBe('vulkan');
  });

  const slowGpu = (m: Machine) => ({
    [cacheKey(m, '', 'whisper-base', 'native_asr', 'vulkan', 'q8_0')]: 0.8,
    [cacheKey(m, '', 'whisper-base', 'native_asr', 'cpu', 'q8_0')]: 0.3,
  });

  it('the bench cache demotes a GPU measured slower', () => {
    expect(resolve('whisper-base', 'auto', asrOpts(CUDA_12GB, { cache: slowGpu(CUDA_12GB) }))[0].device).toBe('cpu');
  });

  it('a "gpu" override pins any accelerator tier and beats the bench', () => {
    expect(resolve('whisper-base', 'gpu', asrOpts(CUDA_12GB, { cache: slowGpu(CUDA_12GB) }))[0].device).toBe('vulkan');
  });

  it.each(['granite-speech-4.1-2b', 'qwen3-asr-1.7b', 'voxtral-mini-4b-realtime', 'cohere-transcribe-03-2026', 'fun-asr-mlt-nano'])('speech LLM %s: vulkan then cpu on NVIDIA', (modelId) => {
    const m = genericMachine({ tc: ['vulkan', 'cpu'], gpus: [['vulkan', 'NVIDIA GeForce RTX 4070', 12288 * MiB]] });
    const plans = resolve(modelId, 'auto', asrOpts(m));
    expect(plans.map((p) => p.device)).toEqual(['vulkan', 'cpu']);
    expect(plans.every((p) => p.backend.startsWith('native_asr'))).toBe(true);
  });

  it('an ARM NVIDIA box leads with vulkan', () => {
    expect(resolve('sense-voice', 'auto', asrOpts(ARM_NV))[0].device).toBe('vulkan');
  });
});

const COHERE = must(asrModel('cohere-transcribe-03-2026'));

describe('tcPickQuant', () => {
  it.each([
    ['gpu_roomy_budget_curated_upgrade', nvMachine(12282), null, null, 'q8_0'],
    ['gpu_tight_budget_keeps_default', nvMachine(2048), null, null, 'q4_k_m'],
    ['cpu_only_smallest_wins_ignores_budget', CPU_ONLY, null, null, 'q4_k_m'],
    ['unknown_memory_keeps_default_on_gpu', nvMachine(0), null, null, 'q4_k_m'],
    ['pin_overrides_ladder_even_if_it_would_not_fit', nvMachine(2048), 'q8_0', null, 'q8_0'],
    ['pin_listed_only_quant_honored', nvMachine(12282), 'f16', null, 'f16'],
    ['downloaded_listed_only_quant_wins', nvMachine(12282), null, ['f16'], 'f16'],
    ['fresh_recommendation_never_listed_only', nvMachine(24564), null, null, 'q8_0'],
    ['downloaded_restricts_to_cached_quant', nvMachine(12282), null, ['q4_k_m'], 'q4_k_m'],
    ['ignores_download_state_when_nothing_cached', nvMachine(12282), null, [], 'q8_0'],
  ] as const)('%s', (_id, m, pin, downloaded, expected) => {
    expect(tcPickQuant(COHERE, m, pin, quantBudgetBytes(m), downloaded === null ? null : new Set(downloaded))).toBe(expected);
  });

  it('a ladder still narrows to one quant end to end through resolve', () => {
    expect(resolve('sense-voice', 'auto', asrOpts(nvMachine(12282))).map((p) => p.computeType)).toEqual(['q8_0', 'q8_0']);
  });

  it.each([
    ['roomy_budget_upgrades_to_q8', nvMachine(12282), null, [], 'q8_0', ['vulkan', 'cpu']],
    ['tight_budget_keeps_default', nvMachine(2048), null, [], 'q4_k_m', ['vulkan', 'cpu']],
    ['cpu_only_prefers_smallest_quant', CPU_ONLY, null, [], 'q4_k_m', ['cpu']],
    ['unknown_memory_keeps_default_on_gpu', nvMachine(0), null, [], 'q4_k_m', ['vulkan', 'cpu']],
    ['pin_narrows_ladder', nvMachine(2048), 'q8_0', [], 'q8_0', ['vulkan', 'cpu']],
    ['pin_listed_only_quant_honored', nvMachine(12282), 'f16', [], 'f16', ['vulkan', 'cpu']],
    ['downloaded_listed_only_quant_loads', nvMachine(12282), null, ['f16'], 'f16', ['vulkan', 'cpu']],
    ['fresh_recommendation_never_listed_only', nvMachine(24564), null, [], 'q8_0', ['vulkan', 'cpu']],
    ['quant_pick_prefers_downloaded', nvMachine(12282), null, ['q4_k_m'], 'q4_k_m', ['vulkan', 'cpu']],
    ['quant_pick_ignores_download_state_when_nothing_cached', nvMachine(12282), null, [], 'q8_0', ['vulkan', 'cpu']],
  ] as const)('cohere end to end: %s', (_id, m, pin, downloaded, quant, devices) => {
    const plans = resolve('cohere-transcribe-03-2026', 'auto', asrOpts(m, { downloaded: new Set(downloaded), pin }));
    expect(plans[0].computeType).toBe(quant);
    expect(plans.map((p) => p.device)).toEqual(devices);
  });

  it("the bench reads the narrowed quant's keys", () => {
    const m = nvMachine(12282);
    const cache = {
      [cacheKey(m, '', 'cohere-transcribe-03-2026', 'native_asr', 'vulkan', 'q4_k_m')]: 0.9,
      [cacheKey(m, '', 'cohere-transcribe-03-2026', 'native_asr', 'cpu', 'q4_k_m')]: 0.2,
    };
    expect(resolve('cohere-transcribe-03-2026', 'auto', asrOpts(m, { cache, downloaded: new Set(['q4_k_m']) }))[0].device).toBe('cpu');
  });

  it('bench entries are read only within their generation', () => {
    const m = { ...nvMachine(24576), generation: 'G1' };
    const cache = {
      [cacheKey(m, '', 'whisper-base', 'native_asr', 'vulkan', 'q8_0')]: 0.8,
      [cacheKey(m, '', 'whisper-base', 'native_asr', 'cpu', 'q8_0')]: 0.3,
    };
    expect(resolve('whisper-base', 'auto', asrOpts(m, { cache }))[0].device).toBe('cpu');
    expect(resolve('whisper-base', 'auto', asrOpts({ ...m, generation: 'G2' }, { cache }))[0].device).toBe('vulkan');
  });
});

/** A synthetic non-GGUF translate card, keeping selectVariant's generic path under test. */
const hymt2Synthetic = () => translateModelCard('hy-mt2-7b-synthetic', 'Hunyuan-MT2 7B (synthetic)', ['multi'], [
  deployment('hunyuan_translate', 'gpu-vulkan', 'bfloat16', 'tencent/Hy-MT2-7B', 1.0),
  deployment('hunyuan_translate', 'cpu', 'float32', 'tencent/Hy-MT2-7B', 1.0),
  deployment('hunyuan_translate', 'gpu-vulkan', 'fp8', 'tencent/Hy-MT2-7B-FP8', 1.0),
]);
const estMap = (mapping: Record<string, number>) => (d: Deployment) => mapping[d.computeType] * GiB;
const HUNYUAN = new Set(['hunyuan_translate']);

describe('selectVariant: the generic path', () => {
  it('the budget comes from the probe totals', () => {
    const d = selectVariant(hymt2Synthetic(), nvMachine(16 * 1024, HUNYUAN), 2 * GiB, null, null, null, { estBytes: estMap({ bfloat16: 15, fp8: 8, float32: 15 }), formatReady: ready });
    expect(must(d).computeType).toBe('fp8');
  });

  it('fp8 drops out when its format is unavailable', () => {
    const d = selectVariant(hymt2Synthetic(), nvMachine(12 * 1024, HUNYUAN), 0, null, null, null, { estBytes: estMap({ bfloat16: 15, fp8: 8, float32: 15 }), formatReady: (ct) => ct !== 'fp8' });
    expect(must(d).tier).toBe('cpu');
  });

  it('prefers bf16 when it fits', () => {
    const d = selectVariant(hymt2Synthetic(), nvMachine(24 * 1024, HUNYUAN), 0, null, null, null, { estBytes: estMap({ bfloat16: 4, fp8: 2, float32: 4 }), formatReady: ready });
    expect(must(d).computeType).toBe('bfloat16');
  });

  it('honours a valid pin', () => {
    const d = selectVariant(hymt2Synthetic(), nvMachine(24 * 1024, HUNYUAN), 0, 'fp8', null, null, { estBytes: estMap({ bfloat16: 4, fp8: 2, float32: 4 }), formatReady: ready });
    expect(must(d).computeType).toBe('fp8');
  });

  it('with no memory reading, never gambles', () => {
    const d = selectVariant(hymt2Synthetic(), nvMachine(0, HUNYUAN), 0, null, null, null, { estBytes: () => 4 * GiB, formatReady: ready });
    expect(must(d).tier).toBe('cpu');
  });

  it('needs an available GPU tier, not just a memory total', () => {
    const m = genericMachine({ gpus: [['vulkan', 'AMD Radeon RX 7800 XT', 16 * GiB]], installed: HUNYUAN });
    const d = selectVariant(hymt2Synthetic(), m, 0, null, null, null, { estBytes: () => GiB, formatReady: ready });
    expect(must(d).tier).toBe('cpu');
  });

  it.each([
    ['fp8_1_5x_factor_too_big_at_12gib', 12, 'cpu', null],
    ['fp8_1_5x_factor_fits_at_16gib', 16, 'gpu-vulkan', 'fp8'],
  ] as const)('the fp8 weight factor is larger than bf16\'s: %s', (_id, vramGb, tier, ct) => {
    const d = must(selectVariant(hymt2Synthetic(), nvMachine(vramGb * 1024, HUNYUAN), 0, null, null, null, { estBytes: estMap({ bfloat16: 15, fp8: 8, float32: 15 }), formatReady: ready }));
    expect(d.tier).toBe(tier);
    if (ct !== null) expect(d.computeType).toBe(ct);
  });
});

const GEMMA = must(translateModel('translategemma-4b'));
const QWEN35_2B = must(translateModel('qwen3.5-2b'));
const QWEN06 = must(translateModel('qwen3-0.6b'));
const variantOpts = { estBytes: est, formatReady: ready };

describe('selectVariant / llamacppVariantRow: the GGUF path', () => {
  it('the default and a pin', () => {
    const m = llmMachine({ gpu: true });
    const chosen = must(selectVariant(GEMMA, m, 0, null, null, null, variantOpts));
    expect([chosen.computeType, chosen.tier]).toEqual(['q4_k_m', 'gpu-vulkan']);
    const pinned = must(selectVariant(GEMMA, m, 0, 'q8_0', null, null, variantOpts));
    expect([pinned.computeType, pinned.tier]).toEqual(['q8_0', 'gpu-vulkan']);
  });

  it('metal and cpu', () => {
    expect(must(selectVariant(QWEN35_2B, llmMachine({ apple: true }), 0, null, null, null, variantOpts)).tier).toBe('gpu-metal');
    expect(must(selectVariant(QWEN35_2B, llmMachine({ gpu: false }), 0, null, null, null, variantOpts)).tier).toBe('cpu');
  });

  it('a pin wins over the budget', () => {
    const m = llmMachine({ gpu: true });
    const d = must(llamacppVariantRow(QWEN06, m, 'q4_k_m', 0, quantBudgetBytes(m), null, { estBytes: est }));
    expect([d.computeType, d.tier]).toEqual(['q4_k_m', 'gpu-vulkan']);
  });

  it.each([
    ['plenty_of_budget_picks_largest_quant', 10 * GiB, 0, null, 'q8_0', 'gpu-vulkan'],
    ['tight_budget_steps_down_to_default', 3 * GiB, 0, null, 'q4_k_m', 'gpu-vulkan'],
    ['half_fits_keeps_gpu_via_fit', Math.trunc(1.5 * GiB), 0, null, 'q4_k_m', 'gpu-vulkan'],
    ['starved_budget_goes_cpu', 2 ** 29, 0, null, 'q4_k_m', 'cpu'],
    ['pin_beats_budget', 2 ** 29, 0, 'q8_0', 'q8_0', 'gpu-vulkan'],
    ['no_budget_reading_keeps_rank_default', null, 0, null, 'q4_k_m', 'gpu-vulkan'],
    ['reserved_subtracts_from_budget', 10 * GiB, 7 * GiB, null, 'q4_k_m', 'gpu-vulkan'],
  ] as const)('the budget walk: %s', (_id, budget, reserved, pin, ct, tier) => {
    const d = must(selectVariant(GEMMA, llmMachine({ gpu: true }), reserved, pin, budget, null, variantOpts));
    expect([d.computeType, d.tier]).toEqual([ct, tier]);
  });

  it('unified memory never degrades to CPU for memory; a discrete GPU does', () => {
    expect(must(selectVariant(GEMMA, llmMachine({ apple: true }), 0, null, 2 ** 29, null, variantOpts)).tier).toBe('gpu-metal');
    expect(must(selectVariant(GEMMA, llmMachine({ gpu: true }), 0, null, 2 ** 29, null, variantOpts)).tier).toBe('cpu');
  });
});

const NATIVE_TRANSLATE = new Set(['native_translate']);
const trOpts = (m: Machine, over: { cache?: Record<string, number>; downloaded?: ReadonlySet<string>; pin?: string | null; estBytes?: (d: Deployment) => number | null } = {}) => ({
  machine: m, platform: 'linux', cache: over.cache ?? {}, downloaded: over.downloaded ?? NONE_DOWNLOADED, pin: over.pin ?? null, estBytes: over.estBytes ?? est, formatReady: ready,
});

describe('resolveTranslate', () => {
  it('prefers the GPU, with the upstream GGUF artifact', () => {
    const plans = resolveTranslate('qwen2.5-0.5b', 'auto', trOpts(nvMachine(12288, NATIVE_TRANSLATE), { estBytes: () => GiB }));
    expect(plans[0].device).toBe('vulkan');
    expect(plans[plans.length - 1].device).toBe('cpu');
    expect(plans[0].artifact).toBe('Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf');
  });

  it('a CPU-only machine', () => {
    expect(resolveTranslate('qwen3-0.6b', 'auto', trOpts(genericMachine({ installed: NATIVE_TRANSLATE }))).map((p) => p.device)).toEqual(['cpu']);
  });

  it('a CPU override returns every installed row of both quants, CPU first', () => {
    const plans = resolveTranslate('qwen3-0.6b', 'cpu', trOpts(nvMachine(0, NATIVE_TRANSLATE)));
    expect(plans.map((p) => p.device)).toEqual(['cpu', 'cpu', 'vulkan', 'vulkan']);
  });

  it('qwen3.5 no longer self-gates', () => {
    const plans = resolveTranslate('qwen3.5-0.8b', 'auto', trOpts(nvMachine(0, ALL_BACKENDS)));
    expect(plans[0].device).toBe('vulkan');
    expect(plans.some((p) => p.backend === 'native_translate')).toBe(true);
  });

  it('an unknown id throws', () => {
    expect(() => resolveTranslate('nope', 'auto', trOpts(CPU_ONLY))).toThrow('unknown translate model: nope');
  });

  it('an explicit device override keeps tier pinning', () => {
    expect(resolveTranslate('hy-mt2-7b', 'cpu', trOpts(nvMachine(12 * 1024, NATIVE_TRANSLATE)))[0].device).toBe('cpu');
  });

  it('an override honours a quant pin', () => {
    const plans = resolveTranslate('qwen3-0.6b', 'cpu', trOpts(nvMachine(0, NATIVE_TRANSLATE), { pin: 'q8_0' }));
    expect(plans.map((p) => p.device)).toEqual(['cpu', 'vulkan']);
    expect(plans.every((p) => p.computeType === 'q8_0')).toBe(true);
  });

  it('an override without a pin keeps both quants', () => {
    expect(new Set(resolveTranslate('qwen3-0.6b', 'cpu', trOpts(nvMachine(0, NATIVE_TRANSLATE))).map((p) => p.computeType))).toEqual(new Set(['q8_0', 'q4_k_m']));
  });

  it('hy-mt1.5 prefers the GPU', () => {
    const plans = resolveTranslate('hy-mt15-1.8b', 'auto', trOpts(nvMachine(12288, NATIVE_TRANSLATE)));
    expect(plans[0].device).toBe('vulkan');
    expect(plans[plans.length - 1].device).toBe('cpu');
    expect(plans.every((p) => p.backend === 'native_translate')).toBe(true);
    expect(plans[0].artifact.startsWith('tencent/HY-MT1.5-1.8B-GGUF/')).toBe(true);
  });

  it('the CPU floor is at the same quant', () => {
    const plans = resolveTranslate('hy-mt2-1.8b', 'auto', trOpts(llmMachine({ gpu: true }), { pin: 'q8_0' }));
    expect(plans.map((p) => [p.tier, p.computeType])).toEqual([['gpu-vulkan', 'q8_0'], ['cpu', 'q8_0']]);
  });

  it('auto loads on the same basis as the recommendation', () => {
    const plans = resolveTranslate('translategemma-4b', 'auto', trOpts(nvMachine(12282, NATIVE_TRANSLATE)));
    expect(plans[0].computeType).toBe('q8_0');
    expect(plans[0].device).not.toBe('cpu');
  });

  it('auto loads the downloaded file', () => {
    expect(resolveTranslate('translategemma-4b', 'auto', trOpts(nvMachine(12282, NATIVE_TRANSLATE), { downloaded: new Set(['q4_k_m']) }))[0].computeType).toBe('q4_k_m');
  });

  it('the quant pick prefers what is downloaded', () => {
    expect(resolveTranslate('translategemma-4b', 'auto', trOpts(nvMachine(12282, NATIVE_TRANSLATE), { downloaded: new Set(['q4_k_m']) }))[0].computeType).toBe('q4_k_m');
  });

  const tpsCache = (m: Machine) => ({
    [cacheKey(m, 'tps:', 'translategemma-4b', 'native_translate', 'vulkan', 'q8_0')]: 5.0,
    [cacheKey(m, 'tps:', 'translategemma-4b', 'native_translate', 'cpu', 'q8_0')]: 12.0,
  });

  it('the bench demotes the GPU when the CPU decodes faster', () => {
    const m = nvMachine(12282, NATIVE_TRANSLATE);
    expect(resolveTranslate('translategemma-4b', 'auto', trOpts(m, { cache: tpsCache(m) }))[0].device).toBe('cpu');
  });

  it('tps entries are read only within their generation', () => {
    const m = { ...nvMachine(12282, NATIVE_TRANSLATE), generation: 'G1' };
    const cache = tpsCache(m);
    expect(resolveTranslate('translategemma-4b', 'auto', trOpts(m, { cache }))[0].device).toBe('cpu');
    expect(resolveTranslate('translategemma-4b', 'auto', trOpts({ ...m, generation: 'G2' }, { cache }))[0].device).toBe('vulkan');
  });

  it('keeps the GPU without a bench measurement', () => {
    expect(resolveTranslate('translategemma-4b', 'auto', trOpts(nvMachine(12282, NATIVE_TRANSLATE)))[0].device).toBe('vulkan');
  });

  it('an ARM NVIDIA box leads with vulkan and keeps a CPU floor', () => {
    const plans = resolveTranslate('qwen2.5-0.5b', 'auto', trOpts(ARM_NV));
    expect(plans[0].device).toBe('vulkan');
    expect(plans.some((p) => p.device === 'cpu')).toBe(true);
  });
});

const ttsOpts = (m: Machine, over: { downloaded?: ReadonlySet<string>; pin?: string | null; opCoverage?: OpCoverageFor } = {}) => ({
  machine: m, platform: 'linux', cache: {}, downloaded: over.downloaded, pin: over.pin ?? null, opCoverage: over.opCoverage,
});

describe('resolveTts', () => {
  it('the largest fitting quant, with a CPU floor', () => {
    const plans = resolveTts('moss-tts-nano', 'auto', ttsOpts(CUDA_12GB));
    expect(plans.map((p) => p.tier)).toEqual(['gpu-vulkan', 'cpu']);
    expect(plans[0].device).toBe('vulkan');
    expect(plans.every((p) => p.computeType === 'bf16')).toBe(true);
    expect(plans.every((p) => p.backend === 'native_tts')).toBe(true);
    expect(plans.every((p) => p.config.ttsFamily === 'moss_tts_nano')).toBe(true);
  });

  it('a single-quant card still gets a CPU floor', () => {
    const plans = resolveTts('supertonic-3', 'auto', ttsOpts(CUDA_12GB));
    expect(plans.map((p) => p.tier)).toEqual(['gpu-vulkan', 'cpu']);
    expect(plans.every((p) => p.computeType === 'f16')).toBe(true);
    expect(plans.every((p) => p.config.ttsFamily === 'supertonic')).toBe(true);
  });

  it('a CPU-only machine takes the rank default', () => {
    const plans = resolveTts('moss-tts-nano', 'auto', ttsOpts(CPU_ONLY));
    expect(plans.map((p) => p.tier)).toEqual(['cpu']);
    expect(plans[0].computeType).toBe('q8_0');
  });

  it('an unknown model throws', () => {
    expect(() => resolveTts('nope', 'auto', ttsOpts(CPU_ONLY))).toThrow('unknown tts model: nope');
  });

  it('a pin overrides the fit pick', () => {
    const plans = resolveTts('moss-tts-nano', 'auto', ttsOpts(CUDA_12GB, { pin: 'q8_0' }));
    expect([plans[0].computeType, plans[0].tier]).toEqual(['q8_0', 'gpu-vulkan']);
  });

  it('downloaded restricts the fit walk', () => {
    const plans = resolveTts('moss-tts-nano', 'auto', ttsOpts(CUDA_12GB, { downloaded: new Set(['q8_0']) }));
    expect([plans[0].computeType, plans[0].tier]).toEqual(['q8_0', 'gpu-vulkan']);
  });

  it('a CPU override pins the CPU tier', () => {
    expect(resolveTts('moss-tts-nano', 'cpu', ttsOpts(CUDA_12GB))[0].tier).toBe('cpu');
  });

  it("pocket TTS's load language threads through", () => {
    const plans = resolveTts('pocket-tts-en', 'auto', ttsOpts(CPU_ONLY));
    expect(plans.every((p) => p.config.ttsFamily === 'pocket_tts' && p.config.ttsLanguage === 'english')).toBe(true);
  });
});

describe('planConfig', () => {
  it('qwen3-0.6b disables thinking and appends /no_think', () => {
    expect(planConfig(must(translateModel('qwen3-0.6b')))).toEqual(config({ disableThinking: true, appendNoThink: true, promptFamily: 'qwen' }));
  });

  it('qwen3.5-0.8b disables thinking without /no_think', () => {
    expect(planConfig(must(translateModel('qwen3.5-0.8b')))).toEqual(config({ disableThinking: true, appendNoThink: false, promptFamily: 'qwen' }));
  });

  it('qwen2.5-0.5b is inert but for its prompt family', () => {
    expect(planConfig(must(translateModel('qwen2.5-0.5b')))).toEqual(config({ promptFamily: 'qwen' }));
  });

  it("reads a card's TTS family and load language", () => {
    expect(planConfig({ family: 'pocket_tts', loadLanguage: 'english' } as never)).toEqual(config({ ttsFamily: 'pocket_tts', ttsLanguage: 'english' }));
  });

  it('the TTS fields are inert for a translation card', () => {
    const cfg = planConfig(must(translateModel('qwen2.5-0.5b')));
    expect([cfg.ttsFamily, cfg.ttsLanguage]).toEqual(['', '']);
  });

  it('reads the TTS extra files', () => {
    expect(planConfig(must(ttsModel('pocket-tts-en'))).ttsExtraFiles).toEqual([['embeddings/alba.safetensors', 6194424]]);
  });

  it('the extra files are an empty list for a card without one', () => {
    expect(planConfig(must(ttsModel('moss-tts-nano'))).ttsExtraFiles).toEqual([]);
  });

  it("a real resolve carries the card's config to every plan", () => {
    const plans = resolveTranslate('qwen3-0.6b', 'auto', trOpts(CUDA_12GB));
    expect(plans[0].config).toEqual(config({ disableThinking: true, appendNoThink: true, promptFamily: 'qwen' }));
    expect(plans.every((p) => JSON.stringify(p.config) === JSON.stringify(plans[0].config))).toBe(true);
  });
});

const cov = (allSupported: boolean, unsupported: string[] = []): OpCoverageFor => () => ({ allSupported, unsupported });
const covFor = (mapping: Record<string, OpCoverage>): OpCoverageFor => (_i, s, f, ct) => mapping[`${s}|${f}|${ct}`] ?? null;

describe('deploymentAvailable: the op-coverage gate', () => {
  it('with no known profile it is tierAvailable', () => {
    const m = nvMachine(24576);
    for (const c of [card('voxcpm2'), card('qwen3-0.6b'), card('whisper-base')]) {
      for (const d of c.deployments) expect(deploymentAvailable(c, d, m, NO_COVERAGE)).toBe(tierAvailable(d.tier, m, d.backend));
    }
  });

  it('TTS refuses a GPU row only on an unsupported node', () => {
    const m = knownGpuMachine();
    const c = card('voxcpm2');
    const gpu = must(c.deployments.find((d) => d.tier === 'gpu-vulkan' && d.computeType === 'q8_0'));
    const cpu = must(c.deployments.find((d) => d.tier === 'cpu' && d.computeType === 'q8_0'));
    expect(deploymentAvailable(c, gpu, m, cov(false, ['NORM[f32,-,-,-,-]->f32']))).toBe(false);
    expect(deploymentAvailable(c, cpu, m, cov(false))).toBe(true);
    expect(deploymentAvailable(c, gpu, m, cov(true))).toBe(true);
    expect(deploymentAvailable(c, gpu, m, NO_COVERAGE)).toBe(true);
  });

  it('ASR and translation never refuse', () => {
    const m = knownGpuMachine();
    for (const c of [card('qwen3-0.6b'), card('whisper-base')]) {
      const gpu = must(c.deployments.find((d) => d.tier === 'gpu-vulkan'));
      expect(deploymentAvailable(c, gpu, m, cov(false, ['X']))).toBe(true);
    }
  });

  it('an unknown backend passes', () => {
    const d = deployment('ctranslate2', 'gpu-vulkan', 'int8', 'r', 1.0, { estBytes: 1 });
    expect(deploymentAvailable({ graphFamily: 'x', deployments: [d] } as never, d, knownGpuMachine(), cov(false))).toBe(true);
  });

  it('a refused TTS rung lands on its CPU row under a pin, a download, and a GPU override with a pin', () => {
    const m = knownGpuMachine();
    const coverage = covFor({ 'tts|voxcpm2|bf16': { allSupported: false, unsupported: ['MUL_MAT[bf16,f32,-,-,-]->f32'] }, 'tts|voxcpm2|q8_0': { allSupported: true, unsupported: [] } });
    let plans = resolveTts('voxcpm2', 'auto', { machine: m, platform: 'linux', cache: {}, pin: 'bf16', downloaded: new Set(), estBytes: est, opCoverage: coverage });
    expect([plans[0].device, plans[0].computeType]).toEqual(['cpu', 'bf16']);
    plans = resolveTts('voxcpm2', 'auto', { machine: m, platform: 'linux', cache: {}, downloaded: new Set(['bf16']), estBytes: est, opCoverage: coverage });
    expect([plans[0].device, plans[0].computeType]).toEqual(['cpu', 'bf16']);
    plans = resolveTts('voxcpm2', 'gpu', { machine: m, platform: 'linux', cache: {}, pin: 'bf16', downloaded: new Set(), estBytes: est, opCoverage: coverage });
    expect([plans[0].device, plans[0].computeType]).toEqual(['cpu', 'bf16']);
  });

  it('the fit walk sees only runnable rungs', () => {
    const coverage = covFor({ 'tts|voxcpm2|bf16': { allSupported: false, unsupported: ['X'] }, 'tts|voxcpm2|q8_0': { allSupported: true, unsupported: [] } });
    const plans = resolveTts('voxcpm2', 'auto', { machine: knownGpuMachine(), platform: 'linux', cache: {}, downloaded: new Set(), estBytes: est, opCoverage: coverage });
    expect([plans[0].device, plans[0].computeType]).toEqual(['vulkan', 'q8_0']);
  });

  it('gpu-metal reads the structured bit when the profile is known; the description rule stays', () => {
    const devOk = profile({ index: 0, kind: 'metal', name: 'MTL0', description: 'Apple M4', memTotal: 16 * GiB, features: new Set(['mtl_simdgroup_reduction', 'uma']), driverName: 'Metal', driverVersion: '25A' });
    const devVm = { ...devOk, description: 'Apple Paravirtual device', features: new Set(['uma']) };
    const base = machine({ os: 'Darwin', arch: 'arm64', cpuCores: 10, appleSilicon: true, installed: new Set(['native_tts']), fingerprint: 'fp', tcKinds: ['metal', 'cpu'], gpus: [['metal', 'Apple M4', 16 * GiB]] });
    expect(tierAvailable('gpu-metal', { ...base, devices: [devOk] })).toBe(true);
    expect(tierAvailable('gpu-metal', { ...base, devices: [devVm] })).toBe(false);
    const vmNamed = { ...base, gpus: [['metal', 'Apple Paravirtual device', 8 * GiB] as const], devices: [{ ...devOk, description: 'Apple Paravirtual device' }] };
    expect(tierAvailable('gpu-metal', vmNamed)).toBe(false);
  });
});
