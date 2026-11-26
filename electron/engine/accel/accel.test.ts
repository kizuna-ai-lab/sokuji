// @vitest-environment node
/**
 * accel (ported from sidecar/tests/test_accel.py): the probe, the loader and its memory gate, the measured load and
 * the ledger, the bench cache, op coverage, and the three handlers. Python's monkeypatching of accel's module globals
 * is `seams` here; every test starts from the defaults with no device profile and no engine identity, as Python's
 * autouse fixture does.
 */
import '../test/env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AsrResult, BackendLoadError } from '../backends';
import { RUNG_FALLBACK_DTYPES, asrModel, deployment, translateModelCard, ttsModel, ttsModelCard } from '../catalog';
import { setNativeForTests } from '../native';
import { NoUsablePlan, benchKey, cacheKey, resolveTts as plannerResolveTts, tierAvailable, type Plan } from '../planner';
import { createState, handleMessage } from '../server';
import { makeFakeNative } from '../test/fakeNative';
import { checkOutbound } from '../wire';
import { benchLoad, benchRead, benchSave, measureRtf, measureRtfTts, measureTps } from './bench';
import { catalogSources, register, restoreCatalogSources } from './handlers';
import { ledgerClaim, ledgerEffectiveReserve, ledgerOther, ledgerRelease, ledgerReset } from './ledger';
import { AllPlansFailed, loadMeasured, loadSeams, loadWithFallback, loaderSeams, modelWeightBytes, restoreLoaderSeams } from './loader';
import { machine, type DeviceProfile, type Machine } from './machine';
import { cachedOpCoverage, computeOpCoverage, downloadedQuants, opCoverageFor, opsKey, weightDtypes } from './opCoverage';
import { deviceFreeBytes, probe, ramFreeBytes, resetProbeForTests, setMachineForTests } from './probe';
import { resolve, resolveDeployments, resolveTranslate, resolveTts, resolveSeams, restoreResolveSeams } from './resolve';
import { restoreSeams, seams } from './seams';

const GIB = 2 ** 30;
const MIB = 2 ** 20;
let benchDir: string;

/** Devices as the addon lists them, from Python's _native_kinds / _native_gpus pair. */
function devicesFor(kinds: string[], gpus: Array<[string, string, number]> = []) {
  const devs = gpus.map(([kind, description, memTotal], index) => ({ index, kind, name: `${kind}${index}`, description, memTotal, memFree: memTotal }));
  for (const k of kinds) if (!devs.some((d) => d.kind === k)) devs.push({ index: devs.length, kind: k, name: `${k}${devs.length}`, description: k === 'cpu' ? 'CPU' : k, memTotal: 0, memFree: 0 });
  return devs as never;
}

function probeWith({ kinds = [] as string[], gpus = [] as Array<[string, string, number]>, apple = false, installed = new Set<string>() } = {}): Machine {
  seams.nativeDevices = () => devicesFor(kinds, gpus);
  seams.appleSilicon = () => apple;
  seams.installed = () => installed;
  return probe(true);
}

const testMachine = ({ apple = false, installed = new Set(['native_asr', 'native_asr_stream']), tc = [] as string[], gpus = [] as Array<[string, string, number]> } = {}): Machine =>
  machine({ os: 'Linux', arch: 'x86_64', cpuCores: 8, appleSilicon: apple, installed, fingerprint: 'test', tcKinds: tc, gpus });

const INERT = { disableThinking: false, appendNoThink: false, promptFamily: '', ttsFamily: '', ttsLanguage: '', ttsExtraFiles: [] };
const plan = (device: string): Plan => ({ backend: 'ctranslate2', tier: device === 'cpu' ? 'cpu' : 'gpu-vulkan', device, computeType: 'int8', artifact: 'large-v3', rank: 1.0, config: INERT });
const planOf = (backend: string, tier: string, device: string, computeType: string, artifact: string, rank: number): Plan => ({ backend, tier, device, computeType, artifact, rank, config: INERT });

beforeEach(() => {
  benchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accel-bench-'));
  process.env.SOKUJI_BENCH_DIR = benchDir;
  restoreSeams();
  restoreLoaderSeams();
  restoreResolveSeams();
  restoreCatalogSources();
  resetProbeForTests();
  seams.nativeProfiles = () => [];
  seams.nativeIdentity = () => { throw new Error('no identity'); };
});

afterEach(() => {
  restoreSeams();
  restoreLoaderSeams();
  restoreResolveSeams();
  restoreCatalogSources();
  resetProbeForTests();
  setNativeForTests(null);
  fs.rmSync(benchDir, { recursive: true, force: true });
});

describe('probe', () => {
  it('assembles the machine', () => {
    const m = probeWith({ kinds: ['cpu', 'vulkan'], gpus: [['vulkan', 'NVIDIA GeForce RTX 4070', 12 * GIB]], installed: new Set(['native_translate', 'native_tts']) });
    expect(m.gpus).toEqual([['vulkan', 'NVIDIA GeForce RTX 4070', 12 * GIB]]);
    expect(m.installed.has('native_tts')).toBe(true);
    expect(m.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it('degrades when a detector throws', () => {
    seams.nativeDevices = () => { throw new Error('probe broken'); };
    seams.appleSilicon = () => false;
    seams.installed = () => new Set();
    expect(probe(true).gpus).toEqual([]);
  });

  it('is cached', () => {
    const first = probeWith();
    seams.nativeDevices = () => devicesFor([], [['vulkan', 'NVIDIA x', GIB]]);
    expect(probe()).toBe(first);
  });
});

describe('resolve through the probe', () => {
  it('sense-voice on a CPU-only machine', async () => {
    probeWith({ kinds: ['cpu'], installed: new Set(['native_asr']) });
    const plans = await resolve('sense-voice');
    expect([plans[0].backend, plans[0].device]).toEqual(['native_asr', 'cpu']);
  });
});

/** A backend whose load succeeds or throws BackendLoadError(reason). */
class FakeBackend {
  loaded = false;
  constructor(private readonly failWith: string | null = null, private readonly attempted: string[] = []) {}
  async load(_artifact: string, device: string) {
    this.attempted.push(device);
    if (this.failWith !== null) throw new BackendLoadError(this.failWith);
    this.loaded = true;
  }
}

describe('loadWithFallback', () => {
  it('steps to CPU and says so', async () => {
    const seq = [new FakeBackend('OOM'), new FakeBackend()];
    seams.makeBackend = () => seq.shift();
    const [backend, p, notice] = await loadWithFallback([plan('vulkan'), plan('cpu')]);
    expect((backend as FakeBackend).loaded).toBe(true);
    expect(p.device).toBe('cpu');
    expect(notice).toContain('falling back');
  });

  it('the first plan wins without a notice', async () => {
    seams.makeBackend = () => new FakeBackend();
    const [, p, notice] = await loadWithFallback([plan('cpu')]);
    expect(p.device).toBe('cpu');
    expect(notice).toBeNull();
  });

  it('every plan failing throws', async () => {
    seams.makeBackend = () => new FakeBackend('nope');
    await expect(loadWithFallback([plan('vulkan'), plan('cpu')])).rejects.toBeInstanceOf(AllPlansFailed);
  });

  it('the memory gate sends a GPU plan that cannot fit straight to CPU', async () => {
    loaderSeams.deviceFreeBytes = () => 2 * GIB;
    loaderSeams.modelWeightBytes = () => 5 * GIB;
    const attempted: string[] = [];
    seams.makeBackend = () => new FakeBackend(null, attempted);
    const [, p, notice] = await loadWithFallback([plan('vulkan'), plan('cpu')]);
    expect(p.device).toBe('cpu');
    expect(attempted).toEqual(['cpu']);
    expect(notice).toContain('CPU');
  });

  it('the gate lets a GPU plan that fits through', async () => {
    loaderSeams.deviceFreeBytes = () => 10 * GIB;
    loaderSeams.modelWeightBytes = () => 4 * GIB;
    seams.makeBackend = () => new FakeBackend();
    const [, p, notice] = await loadWithFallback([plan('vulkan'), plan('cpu')]);
    expect(p.device).toBe('vulkan');
    expect(notice).toBeNull();
  });

  it('the gate stays out of the way without estimates; a real OOM still steps down', async () => {
    loaderSeams.deviceFreeBytes = () => null;
    loaderSeams.modelWeightBytes = () => null;
    const seq = [new FakeBackend('vulkan out of memory'), new FakeBackend()];
    seams.makeBackend = () => seq.shift();
    expect((await loadWithFallback([plan('vulkan'), plan('cpu')]))[1].device).toBe('cpu');
  });

  it("the gate reads the vendor-agnostic free memory", async () => {
    loaderSeams.deviceFreeBytes = () => 2 * GIB;
    loaderSeams.modelWeightBytes = () => 5 * GIB;
    const attempted: string[] = [];
    seams.makeBackend = () => new FakeBackend(null, attempted);
    const [, p, notice] = await loadWithFallback([plan('vulkan'), plan('cpu')]);
    expect([p.device, attempted]).toEqual(['cpu', ['cpu']]);
    expect(notice).toContain('CPU');
  });

  it('the gate keeps Metal on unified memory', async () => {
    loaderSeams.deviceFreeBytes = () => 2 * GIB;
    loaderSeams.modelWeightBytes = () => 5 * GIB;
    const attempted: string[] = [];
    seams.makeBackend = () => new FakeBackend(null, attempted);
    const [, p, notice] = await loadWithFallback([plan('metal'), plan('cpu')]);
    expect([p.device, attempted, notice]).toEqual(['metal', ['metal'], null]);
  });

  it('a CPU allocation failure is not a GPU OOM', async () => {
    loaderSeams.deviceFreeBytes = () => null;
    seams.makeBackend = () => new FakeBackend('failed to allocate 3.00 GiB');
    const err = await loadWithFallback([plan('cpu')]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllPlansFailed);
    expect((err as Error).message).not.toContain('GPU memory');
  });

  it('a GPU-only OOM says so honestly, not "falling back"', async () => {
    loaderSeams.deviceFreeBytes = () => GIB;
    seams.makeBackend = () => new FakeBackend('vulkan out of memory. Failed to allocate 54.00 MiB');
    const err = await loadWithFallback([plan('vulkan')]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllPlansFailed);
    expect((err as Error).message).toContain('GPU memory');
    expect((err as Error).message).not.toContain('falling back');
  });
});

describe('loadMeasured', () => {
  it('reports the free-memory delta on a GPU', async () => {
    const free = [10 * GIB, 2 * GIB];
    loaderSeams.deviceFreeBytes = () => free.shift() ?? null;
    seams.rssBytes = () => 1000;
    loadSeams.loadWithFallback = async () => ['BE', plan('vulkan'), null];
    const [backend, p, notice, mem] = await loadMeasured([plan('vulkan')]);
    expect([backend, p.device, notice, mem]).toEqual(['BE', 'vulkan', null, 8 * GIB]);
  });

  it('reports the RSS delta on CPU', async () => {
    const rss = [Math.floor((1000 * GIB) / 1000), Math.floor((1400 * GIB) / 1000)];
    loaderSeams.deviceFreeBytes = () => null;
    seams.rssBytes = () => rss.shift() ?? null;
    loadSeams.loadWithFallback = async () => ['BE', plan('cpu'), 'vulkan skipped; using CPU'];
    const [, p, notice, mem] = await loadMeasured([plan('cpu')]);
    expect([p.device, notice, mem]).toEqual(['cpu', 'vulkan skipped; using CPU', Math.floor((1400 * GIB) / 1000) - Math.floor((1000 * GIB) / 1000)]);
  });

  it('omits the memory when it cannot be measured', async () => {
    loaderSeams.deviceFreeBytes = () => null;
    seams.rssBytes = () => null;
    loadSeams.loadWithFallback = async () => ['BE', plan('vulkan'), null];
    expect((await loadMeasured([plan('vulkan')]))[3]).toBeNull();
  });

  it('omits a delta that is not positive', async () => {
    const free = [2 * GIB, 3 * GIB];
    loaderSeams.deviceFreeBytes = () => free.shift() ?? null;
    loadSeams.loadWithFallback = async () => ['BE', plan('vulkan'), null];
    expect((await loadMeasured([plan('vulkan')]))[3]).toBeNull();
  });
});

const call = async (type: string, msg: Record<string, unknown> = {}) => {
  const st = createState();
  register(st);
  const [reply] = await handleMessage(st, JSON.stringify({ type, ...msg }));
  return reply as Record<string, any>;
};

describe('hardware_info', () => {
  it('hardware_info_result passes the strict wire check', async () => {
    probeWith({ kinds: ['cpu', 'vulkan'], gpus: [['vulkan', 'NVIDIA GeForce RTX 4070', 12288 * MIB]], installed: new Set(['native_asr']) });
    const reply = await call('hardware_info', { id: 3 });
    expect(reply.type).toBe('hardware_info_result');
    expect(() => checkOutbound(reply)).not.toThrow();
  });

  it('answers with the probed machine', async () => {
    probeWith({ kinds: ['cpu', 'vulkan'], gpus: [['vulkan', 'NVIDIA GeForce RTX 4070', 12288 * MIB]], installed: new Set(['ctranslate2', 'sherpa']) });
    const reply = await call('hardware_info', { id: 7 });
    expect([reply.type, reply.id, reply.accelAvailable]).toEqual(['hardware_info_result', 7, true]);
    expect(reply.gpus).toEqual([{ vendor: 'nvidia', name: 'NVIDIA GeForce RTX 4070', vramMb: 12288 }]);
    expect(reply.backendsInstalled).toContain('sherpa');
  });

  it('reports an AMD GPU from the probe', async () => {
    probeWith({ kinds: ['cpu', 'vulkan'], gpus: [['vulkan', 'AMD Radeon RX 7800 XT', 16 * GIB]] });
    const reply = await call('hardware_info', { id: 1 });
    expect(reply.gpus).toEqual([{ vendor: 'amd', name: 'AMD Radeon RX 7800 XT', vramMb: 16384 }]);
    expect(reply.accelAvailable).toBe(true);
  });

  it('reports the engine, preferring an available GPU tier over a paravirtual one', async () => {
    restoreSeams();
    setNativeForTests(makeFakeNative({
      devices: [
        { kind: 'metal', description: 'Apple Paravirtual device', memTotal: 8 * GIB, memFree: 8 * GIB },
        { kind: 'vulkan', description: 'NVIDIA GB10', memTotal: 96 * GIB, memFree: 90 * GIB },
        { kind: 'cpu', description: 'CPU', memTotal: 120 * GIB, memFree: 100 * GIB },
      ],
      version: '1.0.1',
      engineVersions: { ggml: '0.22.0', transcribe: '0.2.2', llama: '0.3.0', audiocpp: '0.7.0', lane: 'cpu-vulkan' },
    }));
    setMachineForTests(testMachine({ tc: ['cpu', 'metal', 'vulkan'], gpus: [['metal', 'Apple Paravirtual device', 8 * GIB], ['vulkan', 'NVIDIA GB10', 96 * GIB]] }));
    const reply = await call('hardware_info', { id: 1 });
    expect(reply.nativeVersion).toBe('1.0.1');
    expect(reply.engineVersions).toEqual({ ggml: '0.22.0', transcribe: '0.2.2', llama: '0.3.0', audiocpp: '0.7.0' });
    expect(reply.lane).toBe('cpu-vulkan');
    expect(reply.preferredDevice).toEqual({ kind: 'vulkan', name: 'vulkan1', description: 'NVIDIA GB10' });
  });

  it('falls back to the CPU device when no GPU tier is available', async () => {
    restoreSeams();
    setNativeForTests(makeFakeNative({ devices: [{ kind: 'cpu', description: 'CPU', memTotal: 64 * GIB, memFree: 60 * GIB }], version: '1.0.1', engineVersions: { ggml: '0.22.0', transcribe: '0.2.2', llama: '0.3.0', audiocpp: '0.7.0', lane: 'cpu' } }));
    setMachineForTests(testMachine({ tc: ['cpu'] }));
    const reply = await call('hardware_info', { id: 1 });
    expect(reply.lane).toBe('cpu');
    expect('lane' in reply.engineVersions).toBe(false);
    expect(reply.preferredDevice).toEqual({ kind: 'cpu', name: 'cpu0', description: 'CPU' });
  });

  it('the engine fields are null without an addon; the rest is reported', async () => {
    restoreSeams();
    setNativeForTests(null);
    const m = testMachine({ installed: new Set(['native_asr']) });
    setMachineForTests(m);
    const reply = await call('hardware_info', { id: 1 });
    expect([reply.nativeVersion, reply.engineVersions, reply.lane, reply.preferredDevice]).toEqual([null, null, null, null]);
    expect([reply.os, reply.arch, reply.cpuCores]).toEqual([m.os, m.arch, m.cpuCores]);
    expect(reply.backendsInstalled).toEqual([...m.installed].sort());
  });
});

describe('models_catalog (basics)', () => {
  it('on a CPU machine', async () => {
    probeWith({ kinds: ['cpu'], installed: new Set(['native_asr']) });
    const reply = await call('models_catalog', { id: 3 });
    expect([reply.type, reply.id]).toEqual(['models_catalog_result', 3]);
    const byId = Object.fromEntries((reply.models as Array<Record<string, any>>).map((m) => [m.id, m]));
    expect(byId['sense-voice'].languages).toEqual(['zh', 'en', 'ja', 'ko', 'yue']);
    expect(byId['sense-voice'].tiers).toEqual([
      { tier: 'gpu-vulkan', backend: 'native_asr', available: false },
      { tier: 'gpu-metal', backend: 'native_asr', available: false },
      { tier: 'cpu', backend: 'native_asr', available: true },
    ]);
    expect(byId['whisper-large-v3-turbo'].recommended).toBe(true);
    expect(byId['whisper-large-v3'].recommended).toBe(false);
    expect(byId['sense-voice'].sizeBytes).toBe(252684608);
  });

  // Review on #888: only speech models carried `streaming`, so no recognition card could show its Streaming tag.
  it('says which recognition models stream: those run by the streaming backend', async () => {
    probeWith({ kinds: ['cpu'], installed: new Set(['native_asr', 'native_asr_stream']) });
    const reply = await call('models_catalog', { id: 5 });
    const byId = Object.fromEntries((reply.models as Array<Record<string, any>>).map((m) => [m.id, m]));
    expect(byId['moonshine-streaming-medium'].streaming).toBe(true);
    expect(byId['sense-voice'].streaming).toBe(false);
  });

  it('a filter narrows the results', async () => {
    probeWith({ installed: new Set(['ctranslate2', 'sherpa']) });
    const reply = await call('models_catalog', { id: 4, models: ['sense-voice'] });
    expect((reply.models as Array<{ id: string }>).map((m) => m.id)).toEqual(['sense-voice']);
  });
});

describe('the bench cache', () => {
  it('round-trips', () => {
    expect(benchLoad()).toEqual({});
    const m = { ...testMachine(), generation: 'G1' };
    const key = cacheKey(m, '', 'whisper-base', 'ctranslate2', 'cuda', 'float16');
    benchSave({ [key]: 0.12 }, { generation: 'G1' });
    expect(benchLoad()[key]).toBe(0.12);
  });

  it('reads a corrupt file as empty', () => {
    fs.writeFileSync(path.join(benchDir, 'accel-bench.v2.json'), '{ not json');
    expect(benchLoad()).toEqual({});
  });

  it('the bench key is stable and distinct', () => {
    const a = benchKey('fp', 'm', 'ctranslate2', 'cuda', 'float16');
    expect(a).not.toBe(benchKey('fp', 'm', 'ctranslate2', 'cpu', 'int8'));
    expect(a).toBe(benchKey('fp', 'm', 'ctranslate2', 'cuda', 'float16'));
  });

  it('measureRtf runs and caches', async () => {
    const m = { ...testMachine(), generation: 'G1' };
    const p = planOf('ctranslate2', 'cpu', 'cpu', 'int8', 'tiny', 1.0);
    const rtf = await measureRtf({ transcribe: async () => new AsrResult('') }, p, 'whisper-base', m);
    expect(rtf).not.toBeNull();
    expect(rtf!).toBeGreaterThanOrEqual(0);
    expect(cacheKey(m, '', 'whisper-base', 'ctranslate2', 'cpu', 'int8') in benchLoad()).toBe(true);
  });

  it('measureTps warms up, measures, and caches under tps:', async () => {
    let calls = 0;
    let t = 0;
    seams.now = () => (t += 100);
    const backend = { translate: async (): Promise<[string, number]> => { calls++; return ['bonjour le monde', 12]; } };
    const m = { ...testMachine(), generation: 'G1' };
    const p = planOf('qwen_translate', 'gpu-cuda', 'cuda', 'bfloat16', 'repo', 1.0);
    const tps = await measureTps(backend, p, 'qwen2.5-0.5b', m);
    expect(tps).not.toBeNull();
    expect(tps!).toBeGreaterThan(0);
    expect(calls).toBe(2);
    expect(Object.keys(benchLoad()).some((k) => k.includes('|tps:'))).toBe(true);
    let calls2 = 0;
    expect(await measureTps({ translate: async (): Promise<[string, number]> => { calls2++; return ['x', 1]; } }, p, 'qwen2.5-0.5b', m)).toBe(tps);
    expect(calls2).toBe(0);
  });

  it('a save rotates the generations and drops keys of none', () => {
    fs.writeFileSync(path.join(benchDir, 'accel-bench.v2.json'), '{"fp|whisper-base|native_asr|cpu|q8_0": 0.5}');
    let [entries, gens] = benchRead();
    expect([entries, gens]).toEqual([{ 'fp|whisper-base|native_asr|cpu|q8_0': 0.5 }, []]);
    benchSave({ ...entries, 'G1|fp|m|b|d|c': 1.0 }, { generation: 'G1' });
    [entries, gens] = benchRead();
    expect([gens, entries]).toEqual([['G1'], { 'G1|fp|m|b|d|c': 1.0 }]);
    for (const g of ['G2', 'G3', 'G4']) benchSave({ ...benchRead()[0], [`${g}|fp|m|b|d|c`]: 1.0 }, { generation: g });
    [entries, gens] = benchRead();
    expect(gens).toEqual(['G2', 'G3', 'G4']);
    expect(new Set(Object.keys(entries))).toEqual(new Set(['G2|fp|m|b|d|c', 'G3|fp|m|b|d|c', 'G4|fp|m|b|d|c']));
    expect(benchLoad()).toEqual(entries);
  });

  it('a failed save leaves the old file whole and no temp file', () => {
    benchSave({ 'G1|k': 1.0 }, { generation: 'G1' });
    fs.mkdirSync(path.join(benchDir, 'accel-bench.v2.json.tmp'));          // the temp path cannot be written
    benchSave({ 'G1|k': 2.0 }, { generation: 'G1' });
    expect(benchRead()[0]).toEqual({ 'G1|k': 1.0 });
    fs.rmSync(path.join(benchDir, 'accel-bench.v2.json.tmp'), { recursive: true, force: true });
  });

  it('the empty generation is a generation', () => {
    benchSave({ '|fp|m|b|d|c': 1.0 }, { generation: '' });
    let [entries, gens] = benchRead();
    expect([entries, gens]).toEqual([{ '|fp|m|b|d|c': 1.0 }, ['']]);
    benchSave({ ...entries, 'fp|m|b|d|c': 2.0 }, { generation: '' });
    [entries, gens] = benchRead();
    expect([entries, gens]).toEqual([{ '|fp|m|b|d|c': 1.0 }, ['']]);
    benchSave({ ...entries, 'G1|fp|m|b|d|c': 3.0 }, { generation: 'G1' });
    [entries, gens] = benchRead();
    expect(gens).toEqual(['', 'G1']);
    expect(entries).toEqual({ '|fp|m|b|d|c': 1.0, 'G1|fp|m|b|d|c': 3.0 });
  });

  it('a measurement is keyed by its generation', async () => {
    const m1 = machine({ os: 'Linux', arch: 'x86_64', cpuCores: 4, appleSilicon: false, installed: new Set(), fingerprint: 'fp', generation: 'G1' });
    const m2 = { ...m1, generation: 'G2' };
    const p = planOf('native_asr', 'cpu', 'cpu', 'q8_0', 'r/f.gguf', 2.0);
    let calls = 0;
    const backend = { transcribe: async () => { calls++; } };
    let t = 0;
    seams.now = () => (t += 1260);
    const first = await measureRtf(backend, p, 'whisper-base', m1);
    expect(await measureRtf(backend, p, 'whisper-base', m1)).toBe(first);
    expect(calls).toBe(1);
    await measureRtf(backend, p, 'whisper-base', m2);
    expect(calls).toBe(2);
    expect(cacheKey(m1, '', 'whisper-base', 'native_asr', 'cpu', 'q8_0') in benchLoad()).toBe(true);
  });

  it('a measurement under the empty generation persists across a reload', async () => {
    const m = machine({ os: 'Linux', arch: 'x86_64', cpuCores: 4, appleSilicon: false, installed: new Set(), fingerprint: 'fp', generation: '' });
    const p = planOf('native_asr', 'cpu', 'cpu', 'q8_0', 'r/f.gguf', 2.0);
    let calls = 0;
    const backend = { transcribe: async () => { calls++; } };
    await measureRtf(backend, p, 'whisper-base', m);
    expect(calls).toBe(1);
    expect(cacheKey(m, '', 'whisper-base', 'native_asr', 'cpu', 'q8_0') in benchLoad()).toBe(true);
    await measureRtf(backend, p, 'whisper-base', m);
    expect(calls).toBe(1);
  });
});

const nvGpus = (vramMb = 0): Array<[string, string, number]> => [['vulkan', 'NVIDIA GeForce RTX 4070', vramMb * MIB]];
const gpuMachine = (vramMb: number, installed = ['hunyuan_translate']) => testMachine({ gpus: nvGpus(vramMb), tc: ['vulkan', 'cpu'], installed: new Set(installed) });
const hymt2Synthetic = () => translateModelCard('hy-mt2-7b-synthetic', 'Hunyuan-MT2 7B (synthetic)', ['multi'], [
  deployment('hunyuan_translate', 'gpu-vulkan', 'bfloat16', 'tencent/Hy-MT2-7B', 1.0),
  deployment('hunyuan_translate', 'cpu', 'float32', 'tencent/Hy-MT2-7B', 1.0),
  deployment('hunyuan_translate', 'gpu-vulkan', 'fp8', 'tencent/Hy-MT2-7B-FP8', 1.0),
]);
/** Same ladder shape as every real TTS card, backed by native_tts. */
const ttsVariantCard = () => ttsModelCard('fake-tts', 'Fake TTS', ['en'], [
  deployment('native_tts', 'gpu-vulkan', 'bf16', 'org/fake/repo/fake-bf16.gguf', 1.0, { estBytes: 5_000 }),
  deployment('native_tts', 'cpu', 'bf16', 'org/fake/repo/fake-bf16.gguf', 1.0, { estBytes: 5_000 }),
  deployment('native_tts', 'gpu-vulkan', 'q8_0', 'org/fake/repo/fake-q8_0.gguf', 2.0, { estBytes: 2_000 }),
  deployment('native_tts', 'cpu', 'q8_0', 'org/fake/repo/fake-q8_0.gguf', 2.0, { estBytes: 2_000 }),
], { family: 'fake_family', clones: true, streaming: false });
const ALL_NATIVE = new Set(['native_asr', 'native_asr_stream', 'native_translate', 'native_tts']);

describe('gating by machine and runtime', () => {
  it('granite is gated off on a CPU-only machine', async () => {
    await expect(resolve('granite-speech-4.1-2b', 'auto', testMachine({ installed: new Set(['transformers']) }))).rejects.toBeInstanceOf(NoUsablePlan);
  });

  it('granite is gated off without its runtime', async () => {
    await expect(resolve('granite-speech-4.1-2b', 'auto', testMachine({ gpus: nvGpus(), installed: new Set(['ctranslate2']) }))).rejects.toBeInstanceOf(NoUsablePlan);
  });

  it('qwen3-asr has no plan without its runtime', () => {
    const m = testMachine({ gpus: nvGpus(12000), installed: new Set(['ctranslate2', 'sherpa', 'transformers']) });
    expect(resolveDeployments(asrModel('qwen3-asr-1.7b')!, m)).toEqual([]);
  });

  it('with no addon loaded nothing is installed; with one, every native backend is', () => {
    setNativeForTests(null);
    expect([...seams.installed()]).toEqual([]);
    setNativeForTests(makeFakeNative());
    expect(new Set(seams.installed())).toEqual(ALL_NATIVE);
  });

  it('the installed translation backends are the native one only (test_catalog.py)', () => {
    setNativeForTests(makeFakeNative());
    const installed = seams.installed();
    expect(installed.has('native_translate')).toBe(true);
    for (const old of ['qwen_translate', 'qwen35_translate', 'hunyuan_translate', 'gemma_translate', 'opus_translate', 'llamacpp_qwen', 'llamacpp_hunyuan', 'llamacpp_gemma', 'ct2_opus_translate']) {
      expect(installed.has(old)).toBe(false);
    }
  });

  it('voxtral has no plan without its runtime', () => {
    const m = testMachine({ gpus: nvGpus(12000), installed: new Set(['ctranslate2', 'sherpa', 'transformers']) });
    expect(resolveDeployments(asrModel('voxtral-mini-4b-realtime')!, m)).toEqual([]);
  });

  it('no ASR model resolves without the native runtime', async () => {
    await expect(resolve('whisper-base', 'auto', testMachine({ installed: new Set() }))).rejects.toBeInstanceOf(NoUsablePlan);
  });
});

describe('models_catalog by kind', () => {
  it('translate lists the Qwen rows, with gpu-vulkan available and no gpu-cuda', async () => {
    setMachineForTests(testMachine({ gpus: nvGpus(), tc: ['vulkan', 'cpu'], installed: new Set(['native_translate']) }));
    const reply = await call('models_catalog', { id: 1, kind: 'translate' });
    const ids = (reply.models as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['qwen2.5-0.5b', 'qwen3-0.6b']));
    const row = (reply.models as Array<Record<string, any>>).find((m) => m.id === 'qwen2.5-0.5b')!;
    const tiers = Object.fromEntries((row.tiers as Array<{ tier: string; available: boolean }>).map((t) => [t.tier, t.available]));
    expect('gpu-cuda' in tiers).toBe(false);
    expect([tiers['gpu-vulkan'], tiers.cpu]).toEqual([true, true]);
  });

  it('defaults to ASR', async () => {
    setMachineForTests(testMachine());
    expect(((await call('models_catalog', { id: 2 })).models as Array<{ id: string }>).map((m) => m.id)).toContain('sense-voice');
  });

  it('carries order, repo and kind for ASR', async () => {
    setMachineForTests(testMachine());
    const sv = ((await call('models_catalog', { id: 1, kind: 'asr' })).models as Array<Record<string, any>>).find((m) => m.id === 'sense-voice')!;
    expect(sv.kind).toBe('asr');
    expect(Number.isInteger(sv.order)).toBe(true);
    expect(sv.repo).toBeTruthy();
  });

  it('TTS lists its voice fields', async () => {
    setMachineForTests(testMachine());
    const tts = Object.fromEntries(((await call('models_catalog', { id: 1, kind: 'tts' })).models as Array<Record<string, any>>).map((m) => [m.id, m]));
    expect([tts['moss-tts-nano'].kind, tts['moss-tts-nano'].clones]).toEqual(['tts', true]);
    expect('streaming' in tts['moss-tts-nano'] && !('numSpeakers' in tts['moss-tts-nano'])).toBe(true);
    expect(tts['moss-tts-nano'].voice).toEqual({ builtin: 'none', custom: 'clip', required: false });
    expect(tts['index-tts2.5'].voice.required).toBe(true);
  });

  it('carries each model\'s size', async () => {
    setMachineForTests(testMachine());
    const asr = Object.fromEntries(((await call('models_catalog', { id: 1, kind: 'asr' })).models as Array<Record<string, any>>).map((m) => [m.id, m]));
    const tts = Object.fromEntries(((await call('models_catalog', { id: 1, kind: 'tts' })).models as Array<Record<string, any>>).map((m) => [m.id, m]));
    expect(asr['sense-voice'].sizeBytes).toBeGreaterThan(0);
    expect(tts['supertonic-3'].sizeBytes).toBe(312784196);
    expect(tts['moss-tts-nano'].sizeBytes).toBe(193337984);
    expect(tts['moss-tts-nano'].repo).toBe('audio-cpp/audio.cpp-gguf/MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf');
  });

  it('a translation card lists its variant ids', async () => {
    setMachineForTests(testMachine({ installed: ALL_NATIVE }));
    const byId = Object.fromEntries(((await call('models_catalog', { kind: 'translate' })).models as Array<Record<string, any>>).map((m) => [m.id, m]));
    expect(byId['translategemma-4b'].variantIds).toEqual(['q4_k_m', 'q8_0']);
  });

  it('TTS variants: all supported, the budget pick recommended, none downloaded', async () => {
    setMachineForTests(testMachine({ gpus: nvGpus(12000), tc: ['vulkan', 'cpu'] }));
    catalogSources.tts = () => [ttsVariantCard()];
    const entry = ((await call('models_catalog', { kind: 'tts', id: 1 })).models as Array<Record<string, any>>)[0];
    const byId: Record<string, Record<string, any>> = Object.fromEntries((entry.variants as Array<Record<string, any>>).map((v) => [v.id, v]));
    expect(new Set(Object.keys(byId))).toEqual(new Set(['bf16', 'q8_0']));
    expect(Object.values(byId).every((v) => v.supported)).toBe(true);
    expect([byId.bf16.recommended, byId.q8_0.recommended]).toEqual([true, false]);
    expect(byId.bf16.repo).toBe('org/fake/repo/fake-bf16.gguf');
    expect(Object.values(byId).every((v) => v.downloaded === false)).toBe(true);
  });

  it('says which rungs are cached, without changing the recommendation', async () => {
    setMachineForTests(testMachine({ gpus: nvGpus(12000), tc: ['vulkan', 'cpu'] }));
    catalogSources.tts = () => [ttsVariantCard()];
    seams.cachedFilePath = (_repo, file) => (file.includes('q8_0') ? '/fake/cache/path' : null);
    const byId = Object.fromEntries((((await call('models_catalog', { kind: 'tts', id: 1 })).models as Array<Record<string, any>>)[0].variants as Array<Record<string, any>>).map((v) => [v.id, v]));
    expect([byId.q8_0.downloaded, byId.bf16.downloaded]).toEqual([true, false]);
    expect([byId.bf16.recommended, byId.q8_0.recommended]).toEqual([true, false]);
  });
});

describe('list_variants', () => {
  it('the generic path marks what fits and recommends', async () => {
    const model = hymt2Synthetic();
    catalogSources.translateModel = (id) => (id === model.id ? model : null);
    resolveSeams.formatReady = () => true;
    resolveSeams.estBytes = (d) => ({ bfloat16: 15, fp8: 8, float32: 15 } as Record<string, number>)[d.computeType] * GIB;
    seams.modelSize = () => 8 * GIB;
    setMachineForTests(gpuMachine(16 * 1024));
    const reply = await call('list_variants', { id: 1, model: model.id, asrId: null, ttsId: null });
    const by = Object.fromEntries((reply.variants as Array<Record<string, any>>).map((v) => [v.computeType, v]));
    expect([by.fp8.supported, by.fp8.repo]).toEqual([true, 'tencent/Hy-MT2-7B-FP8']);
    expect(by.bfloat16.supported).toBe(false);
    expect(reply.recommended).toBe('fp8');
  });

  it('a GGUF card is one row per quant, all supported, the stable-total pick recommended', async () => {
    setMachineForTests(testMachine({ gpus: nvGpus(12282), tc: ['vulkan', 'cpu'], installed: ALL_NATIVE }));
    const reply = await call('list_variants', { model: 'translategemma-4b' });
    expect((reply.variants as Array<{ id: string }>).map((v) => v.id).sort()).toEqual(['q4_k_m', 'q8_0']);
    expect((reply.variants as Array<{ supported: boolean }>).every((v) => v.supported)).toBe(true);
    expect(reply.recommended).toBe('q8_0');
  });
});

describe('the loader with real plan shapes', () => {
  it('the fp8 factor gates a Vulkan plan', async () => {
    loaderSeams.deviceFreeBytes = () => 12 * GIB;
    loaderSeams.modelWeightBytes = () => 8 * GIB;
    const attempted: string[] = [];
    seams.makeBackend = () => new FakeBackend(null, attempted);
    const [, p, notice] = await loadWithFallback([planOf('hunyuan_translate', 'gpu-vulkan', 'vulkan', 'fp8', 'repo', 1.0), plan('cpu')]);
    expect([p.device, attempted]).toEqual(['cpu', ['cpu']]);
    expect(notice).toContain('CPU');
  });

  it('the memory gate never pre-skips a GGUF translation plan', async () => {
    loaderSeams.deviceFreeBytes = () => GIB;
    loaderSeams.modelWeightBytes = () => 8 * GIB;
    const loaded: string[] = [];
    seams.makeBackend = () => new FakeBackend(null, loaded);
    const [, p, notice] = await loadWithFallback([
      planOf('native_translate', 'gpu-vulkan', 'vulkan', 'q4_k_m', 'repo', 2.0),
      planOf('native_translate', 'cpu', 'cpu', 'q4_k_m', 'repo', 2.0),
    ]);
    expect([p.device, notice, loaded]).toEqual(['vulkan', null, ['vulkan']]);
  });
});

describe('the native backends resolve with an addon loaded', () => {
  beforeEach(() => {
    restoreSeams();
    seams.nativeProfiles = () => [];
    seams.nativeIdentity = () => { throw new Error('no identity'); };
    setNativeForTests(makeFakeNative({ devices: [{ kind: 'cpu', description: 'CPU' }] }));
    probe(true);
  });

  it('translation: hy-mt2 and TranslateGemma', async () => {
    expect(seams.installed().has('native_translate')).toBe(true);
    expect((await resolveTranslate('hy-mt2-1.8b', 'auto')).some((p) => p.backend === 'native_translate')).toBe(true);
    expect((await resolveTranslate('translategemma-4b', 'auto')).some((p) => p.backend === 'native_translate')).toBe(true);
  });

  it('omnivoice resolves to gpu-vulkan on a Vulkan machine', () => {
    const m = machine({ os: 'Linux', arch: 'x86_64', cpuCores: 8, appleSilicon: false, installed: seams.installed(), fingerprint: 't', tcKinds: ['vulkan'], gpus: [['vulkan', 'NVIDIA GeForce RTX 4070', 12 * GIB]] });
    const plans = plannerResolveTts('omnivoice-0.6b', 'auto', { machine: m, platform: 'linux', cache: {} });
    expect([plans[0].backend, plans[0].tier]).toEqual(['native_tts', 'gpu-vulkan']);
  });

  it('supertonic, qwen3-tts and pocket TTS resolve on CPU', async () => {
    const st = await resolveTts('supertonic-3', 'cpu');
    expect([st[0].backend, st[0].computeType]).toEqual(['native_tts', 'f16']);
    expect((await resolveTts('qwen3-tts-0.6b', 'cpu'))[0].backend).toBe('native_tts');
    const pocket = await resolveTts('pocket-tts-en', 'cpu');
    expect([pocket[0].backend, pocket[0].tier, pocket[0].computeType]).toEqual(['native_tts', 'cpu', 'q8_0']);
  });
});

describe('cached rungs and the TTS wrapper', () => {
  it("downloadedQuants checks each TTS artifact's own file", () => {
    seams.cachedFilePath = (repo, file) => (repo === 'org/fake' && file === 'repo/fake-q8_0.gguf' ? '/fake/cache/path' : null);
    expect(downloadedQuants(ttsVariantCard())).toEqual(new Set(['q8_0']));
  });

  it('the TTS wrapper hands the planner the pin and the cached rungs', async () => {
    // moss-tts-nano: q8_0 cached, bf16 pinned → the pin wins; without the pin the cached rung restricts the walk.
    seams.cachedFilePath = (_repo, file) => (file.includes('q8_0') ? '/cached' : null);
    const m = testMachine({ gpus: nvGpus(12000), tc: ['vulkan', 'cpu'], installed: ALL_NATIVE });
    expect((await resolveTts('moss-tts-nano', 'auto', m, 'bf16'))[0].computeType).toBe('bf16');
    expect((await resolveTts('moss-tts-nano', 'auto', m))[0].computeType).toBe('q8_0');
  });

  it('measureRtfTts uses the rate the synthesis returned', async () => {
    const backend = { sampleRate: 24000, generate: async (): Promise<[Float32Array, number, number]> => [new Float32Array(24000), 16000, 150] };
    const p = planOf('native_tts', 'cpu', 'cpu', 'q8_0', 'repo', 1.0);
    expect(await measureRtfTts(backend, p, 'moss-tts-nano', probeWith())).toBeCloseTo(0.1);
  });
});

/** A fake addon whose devices carry the profile fields too (Python's _FakeDev / _fake_native_module). */
type FakeDev = { kind: string; description: string; memTotal: number; memFree: number; known?: boolean; features?: string[]; driverName?: string; driverVersion?: string; deviceUuid?: string; cpuFeatures?: string };
function fakeWith(devs: FakeDev[], { version = '1.0.2', engineVersions, profiles = true }: { version?: string; engineVersions?: Record<string, string>; profiles?: boolean } = {}) {
  const fake = makeFakeNative({
    devices: devs.map((d) => ({ kind: d.kind as never, description: d.description, memTotal: d.memTotal, memFree: d.memFree })),
    profiles: devs.map((d, index) => ({ index, kind: d.kind as never, name: `${d.kind}${index}`, description: d.description, memTotal: d.memTotal, known: d.known ?? true, features: d.features ?? [], driverName: d.driverName ?? '', driverVersion: d.driverVersion ?? '', deviceUuid: d.deviceUuid ?? '', cpuFeatures: d.cpuFeatures ?? '' })),
    version,
    engineVersions: engineVersions ?? { ggml: '0.22.0', transcribe: '0.2.3', llama: '0.3.0', audiocpp: '0.7.1', lane: 'cpu-vulkan' },
  });
  if (!profiles) (fake as unknown as { deviceProfiles: () => never }).deviceProfiles = () => { throw new TypeError('deviceProfiles is not a function'); };
  setNativeForTests(fake);
  return fake;
}

/** Real detectors over the fake addon (Python's monkeypatch.undo()). */
function realDetectors() {
  restoreSeams();
  seams.appleSilicon = () => false;
}

const profileOf = (p: Partial<DeviceProfile> & Pick<DeviceProfile, 'index' | 'kind'>): DeviceProfile => ({
  name: `${p.kind}${p.index}`, description: '', memTotal: 0, known: true, features: new Set(), driverName: '', driverVersion: '', deviceUuid: '', cpuFeatures: '', ...p,
});
function knownGpuMachine(kind = 'vulkan'): Machine {
  const dev = profileOf({ index: 0, kind, name: `${kind}0`, description: 'GB10', memTotal: 96 * GIB, driverName: 'NVIDIA', driverVersion: '580', deviceUuid: 'ab'.repeat(16) });
  const cpu = profileOf({ index: 1, kind: 'cpu', name: 'CPU', description: 'CPU', memTotal: 120 * GIB, cpuFeatures: 'NEON=1' });
  return machine({ os: 'Linux', arch: 'x86_64', cpuCores: 8, appleSilicon: false, installed: new Set(['native_tts', 'native_translate', 'native_asr']), fingerprint: 'fp', tcKinds: [kind, 'cpu'], gpus: [[kind, 'GB10', 96 * GIB]], devices: [dev, cpu], generation: 'G1' });
}

/** A GGUF header with these ggml type ids (no data), written to `dir`. */
function writeGguf(dir: string, typeIds: number[]): string {
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const str = (x: string) => Buffer.concat([u64(Buffer.byteLength(x)), Buffer.from(x)]);
  const parts = [Buffer.from('GGUF'), u32(3), u64(typeIds.length), u64(1), str('general.architecture'), u32(8), str('voxcpm2')];
  typeIds.forEach((ty, i) => parts.push(str(`t${i}`), u32(1), u64(4), u32(ty), u64(0)));
  const p = path.join(dir, 'x.gguf');
  fs.writeFileSync(p, Buffer.concat(parts));
  return p;
}

describe('device profiles and the generation', () => {
  it('the probe fills the devices and the generation', () => {
    realDetectors();
    fakeWith([
      { kind: 'vulkan', description: 'NVIDIA GB10', memTotal: 96 * GIB, memFree: 90 * GIB, features: ['vk_integer_dot', 'vk_coopmat'], driverName: 'NVIDIA', driverVersion: '580.65.06', deviceUuid: 'ab'.repeat(16) },
      { kind: 'cpu', description: 'CPU', memTotal: 120 * GIB, memFree: 100 * GIB, cpuFeatures: 'NEON=1,DOTPROD=1' },
    ], { version: '1.1.0' });
    seams.installed = () => new Set(['native_tts']);
    const m = probe(true);
    expect(m.devices.map((d) => d.kind)).toEqual(['vulkan', 'cpu']);
    expect(m.devices[0].known && m.devices[0].features.has('vk_coopmat') && m.devices[0].deviceUuid === 'ab'.repeat(16)).toBe(true);
    expect(m.devices[1].cpuFeatures.startsWith('NEON=1')).toBe(true);
    expect(m.generation).toMatch(/^[0-9a-f]{12}$/);
    expect(m.gpus).toEqual([['vulkan', 'NVIDIA GB10', 96 * GIB]]);
  });

  it('the generation moves with the version, a pin, the driver and GGML_* — not with free memory', () => {
    const saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('GGML_')));
    const gen = ({ version = '1.1.0', pins, driver = '580', free = 90 * GIB, env = {} }: { version?: string; pins?: Record<string, string>; driver?: string; free?: number; env?: Record<string, string> } = {}) => {
      for (const k of Object.keys(process.env)) if (k.startsWith('GGML_')) delete process.env[k];
      Object.assign(process.env, env);
      realDetectors();
      fakeWith([{ kind: 'vulkan', description: 'GB10', memTotal: 96 * GIB, memFree: free, driverName: 'NVIDIA', driverVersion: driver, deviceUuid: 'ab'.repeat(16) }], { version, engineVersions: pins });
      seams.installed = () => new Set();
      return probe(true).generation;
    };
    try {
      const base = gen();
      expect(gen()).toBe(base);
      expect(gen({ free: GIB })).toBe(base);
      expect(gen({ version: '1.1.1' })).not.toBe(base);
      expect(gen({ pins: { ggml: '0.22.0', transcribe: '0.2.3', llama: '0.3.0', audiocpp: '0.7.2', lane: 'cpu-vulkan' } })).not.toBe(base);
      expect(gen({ driver: '581' })).not.toBe(base);
      expect(gen({ env: { GGML_VK_DISABLE_COOPMAT: '1' } })).not.toBe(base);
      expect(gen({ env: { GGML_METAL_BF16_DISABLE: '1' } })).not.toBe(base);
    } finally {
      for (const k of Object.keys(process.env)) if (k.startsWith('GGML_')) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  it('each detector degrades on its own', () => {
    realDetectors();
    fakeWith([{ kind: 'cpu', description: 'CPU', memTotal: 8 * GIB, memFree: 7 * GIB }], { version: '1.1.0' });
    seams.installed = () => new Set();
    seams.nativeProfiles = () => { throw new Error('no'); };
    let m = probe(true);
    expect(m.devices).toEqual([]);
    expect(m.generation).not.toBe('');
    seams.nativeIdentity = () => { throw new Error('no'); };
    m = probe(true);
    expect(m.generation).toBe('');
  });

  it('an addon without profiles degrades to the plans a profile-less machine gets', async () => {
    realDetectors();
    fakeWith([{ kind: 'vulkan', description: 'GB10', memTotal: 96 * GIB, memFree: 90 * GIB }], { version: '1.0.2', profiles: false });
    seams.installed = () => new Set(['native_tts']);
    const m = probe(true);
    expect(m.devices).toEqual([]);
    expect(m.generation).not.toBe('');
    const bare = { ...m, devices: [], generation: '' };
    expect(await resolveTts('voxcpm2', 'auto', m)).toEqual(await resolveTts('voxcpm2', 'auto', bare));
  });

  it("the machine's GPUs are a stable identity", () => {
    fakeWith([{ kind: 'vulkan', description: 'AMD Radeon RX 7800 XT', memTotal: 16 * GIB, memFree: 15 * GIB }, { kind: 'cpu', description: 'Ryzen 7', memTotal: 64 * GIB, memFree: 60 * GIB }]);
    restoreSeams();
    seams.appleSilicon = () => false;
    seams.installed = () => new Set(['native_asr']);
    seams.nativeProfiles = () => [];
    const m = probe(true);
    expect(m.gpus).toEqual([['vulkan', 'AMD Radeon RX 7800 XT', 16 * GIB]]);
    expect(m.tcKinds).toEqual(['cpu', 'vulkan']);
  });

  it('the fingerprint ignores free memory', () => {
    const fp = (free: number) => {
      fakeWith([{ kind: 'vulkan', description: 'RTX 4070', memTotal: 12 * GIB, memFree: free }]);
      restoreSeams();
      seams.appleSilicon = () => false;
      seams.installed = () => new Set();
      return probe(true).fingerprint;
    };
    expect(fp(10 * GIB)).toBe(fp(2 * GIB));
  });
});

describe('fresh memory readings', () => {
  it('free memory comes from the addon', () => {
    restoreSeams();
    fakeWith([{ kind: 'vulkan', description: 'RTX 4070', memTotal: 12 * GIB, memFree: 9 * GIB }]);
    expect(deviceFreeBytes()).toBe(9 * GIB);
  });

  it('none without an addon', () => {
    restoreSeams();
    setNativeForTests(null);
    expect(deviceFreeBytes()).toBeNull();
  });

  it('none without a GPU', () => {
    restoreSeams();
    fakeWith([{ kind: 'cpu', description: 'Ryzen', memTotal: 64 * GIB, memFree: 60 * GIB }]);
    expect(deviceFreeBytes()).toBeNull();
  });

  it('free system memory is positive', () => {
    const n = ramFreeBytes();
    expect(n === null || n > 0).toBe(true);
  });
});

describe('recommendations and the ASR catalog', () => {
  it('list_variants recommends on the stable total, not the free reading', async () => {
    setMachineForTests(testMachine({ gpus: nvGpus(12288), tc: ['vulkan', 'cpu'], installed: new Set(['native_translate']) }));
    loaderSeams.deviceFreeBytes = () => GIB;
    expect((await call('list_variants', { id: 9, model: 'translategemma-4b' })).recommended).toBe('q8_0');
  });

  it('the ASR catalog lists the full ladder, default first, with tiers deduped', async () => {
    probeWith({ kinds: ['cpu'], installed: new Set(['native_asr', 'native_asr_stream']) });
    const reply = await call('models_catalog', { id: 5, kind: 'asr', models: ['cohere-transcribe-03-2026', 'sense-voice'] });
    const byId = Object.fromEntries((reply.models as Array<Record<string, any>>).map((m) => [m.id, m]));
    expect(byId['cohere-transcribe-03-2026'].variantIds).toEqual(['q4_k_m', 'f16', 'q8_0', 'q6_k', 'q5_k_m']);
    expect(byId['sense-voice'].variantIds[0]).toBe('q8_0');
    expect(byId['cohere-transcribe-03-2026'].tiers.map((t: { tier: string }) => t.tier)).toEqual(['gpu-vulkan', 'gpu-metal', 'cpu']);
  });
});

describe('the ledger', () => {
  it('claims, releases, and counts the other stages', () => {
    ledgerReset();
    ledgerClaim('asr', GIB);
    ledgerClaim('tts', 0);
    expect(ledgerOther('translate')).toBe(GIB);
    expect(ledgerOther('asr')).toBe(0);
    ledgerRelease('asr');
    expect(ledgerOther('translate')).toBe(0);
  });

  it('a loaded stage reserves nothing: its memory is already out of every free reading', () => {
    ledgerReset();
    ledgerClaim('asr', 6252 * MIB);
    expect(ledgerEffectiveReserve('translate', { asr: 5 * GIB, tts: 80 * MIB })).toBe(80 * MIB);
  });

  it('stages not loaded yet reserve their estimates', () => {
    ledgerReset();
    expect(ledgerEffectiveReserve('translate', { asr: 3 * GIB, tts: 4 * GIB })).toBe(7 * GIB);
  });

  it('a stage loaded on CPU reserves nothing', () => {
    ledgerReset();
    ledgerClaim('asr', 0);
    expect(ledgerEffectiveReserve('translate', { asr: 3 * GIB })).toBe(0);
  });

  it('a measured load claims its bytes', async () => {
    ledgerReset();
    const frees = [10 * GIB, 10 * GIB, 8 * GIB];
    loaderSeams.deviceFreeBytes = () => frees.shift() ?? null;
    loaderSeams.modelWeightBytes = () => null;
    seams.rssBytes = () => null;
    seams.makeBackend = () => ({ load: async () => {} });
    const [, , , mem] = await loadMeasured([planOf('native_asr', 'gpu-vulkan', 'vulkan', 'q8_0', 'org/r/f.gguf', 1.0)], 'asr');
    expect(mem).toBe(2 * GIB);
    expect(ledgerOther('translate')).toBe(2 * GIB);
    ledgerRelease('asr');
  });

  it('a measured CPU load claims zero, but is present', async () => {
    ledgerReset();
    seams.rssBytes = () => GIB;
    seams.makeBackend = () => ({ load: async () => {} });
    await loadMeasured([planOf('native_asr', 'cpu', 'cpu', 'q8_0', 'org/r/f.gguf', 1.0)], 'asr');
    expect(ledgerOther('translate')).toBe(0);
    expect(ledgerEffectiveReserve('translate', { asr: 5 * GIB })).toBe(0);
    ledgerRelease('asr');
  });
});

async function catalogReply({ gpus = [] as Array<[string, string, number]>, kind = 'asr', models }: { gpus?: Array<[string, string, number]>; kind?: string; models?: string[] } = {}) {
  probeWith({ kinds: gpus.length > 0 ? ['cpu', 'vulkan'] : ['cpu'], gpus, installed: new Set(['native_asr', 'native_asr_stream', 'native_translate']) });
  const reply = await call('models_catalog', { id: 7, kind, ...(models ? { models } : {}) });
  return Object.fromEntries((reply.models as Array<Record<string, any>>).map((m) => [m.id, m]));
}

describe('the precomputed variant list', () => {
  it('the full ladder, quality-descending', async () => {
    const v = (await catalogReply({ gpus: [['vulkan', 'RTX 4070', 12 * GIB]], models: ['cohere-transcribe-03-2026'] }))['cohere-transcribe-03-2026'].variants as Array<Record<string, any>>;
    expect(v.map((x) => x.id)).toEqual(['f16', 'q8_0', 'q6_k', 'q5_k_m', 'q4_k_m']);
    expect(v.every((x) => x.sizeBytes > 0 && x.supported)).toBe(true);
    expect(v.filter((x) => x.recommended)).toHaveLength(1);
  });

  it('supported respects a small GPU', async () => {
    const byId = await catalogReply({ gpus: [['vulkan', 'iGPU', 2 * GIB]], models: ['cohere-transcribe-03-2026'] });
    const v = Object.fromEntries((byId['cohere-transcribe-03-2026'].variants as Array<Record<string, any>>).map((x) => [x.id, x]));
    expect([v.f16.supported, v.q4_k_m.supported]).toEqual([false, true]);
    expect((byId['cohere-transcribe-03-2026'].variants as Array<Record<string, any>>).filter((x) => x.recommended).map((x) => x.id)).toEqual(['q4_k_m']);
  });

  it('CPU only recommends the smallest', async () => {
    const v = (await catalogReply({ models: ['whisper-large-v3'] }))['whisper-large-v3'].variants as Array<Record<string, any>>;
    expect(v.filter((x) => x.recommended).map((x) => x.id)).toEqual(['q4_k_m']);
  });

  it('translation cards are included', async () => {
    const v = (await catalogReply({ gpus: nvGpus(12288), kind: 'translate', models: ['translategemma-4b'] }))['translategemma-4b'].variants as Array<Record<string, any>>;
    expect(v.map((x) => x.id)).toEqual(['q8_0', 'q4_k_m']);
    expect(v.every((x) => x.supported)).toBe(true);
    expect(v.filter((x) => x.recommended).map((x) => x.id)).toEqual(['q8_0']);
  });

  it('carries the figures the renderer words its reasons from', async () => {
    const entry = (await catalogReply({ gpus: [['vulkan', 'iGPU', 2 * GIB]], models: ['cohere-transcribe-03-2026'] }))['cohere-transcribe-03-2026'];
    expect(entry.deviceMemBytes).toBe(2 * GIB);
    const f16 = (entry.variants as Array<Record<string, any>>).find((v) => v.id === 'f16')!;
    expect(f16.needBytes).toBe(Math.trunc(f16.sizeBytes * 1.15));
    expect(f16.supported).toBe(false);
  });
});

describe('tiers, weights and dtypes', () => {
  it('no NVML anywhere in the engine', () => {
    const dir = path.resolve(__dirname, '..');
    const needle = 'nv' + 'ml';
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'golden') walk(p); } else if (/\.ts$/.test(e.name) && !e.name.endsWith('.test.ts') && fs.readFileSync(p, 'utf8').toLowerCase().includes(needle)) hits.push(p);
      }
    };
    walk(dir);
    expect(hits).toEqual([]);
  });

  it('gpu-metal on Apple Silicon, and through the probe\'s metal kind', () => {
    expect(tierAvailable('gpu-metal', machine({ os: 'Darwin', arch: 'arm64', cpuCores: 8, appleSilicon: true, installed: new Set(), fingerprint: 'as' }))).toBe(true);
    expect(tierAvailable('gpu-metal', machine({ os: 'Darwin', arch: 'arm64', cpuCores: 8, appleSilicon: false, installed: new Set(), fingerprint: 'intel-mac', tcKinds: ['cpu', 'metal'] }))).toBe(true);
  });

  it('a model directory with no variant directory counts every weight file', () => {
    const onnx = path.join(benchDir, 'model', 'onnx');
    fs.mkdirSync(onnx, { recursive: true });
    fs.writeFileSync(path.join(onnx, 'talker.onnx'), Buffer.alloc(100));
    fs.writeFileSync(path.join(onnx, 'talker.onnx.data'), Buffer.alloc(50));
    expect(modelWeightBytes(path.join(benchDir, 'model'))).toBe(150);
  });

  it("weightDtypes prefers the file's header over the fallback", async () => {
    const card = ttsModel('voxcpm2')!;
    expect(new Set(await weightDtypes(card, 'q8_0'))).toEqual(RUNG_FALLBACK_DTYPES.q8_0);
    const p = writeGguf(benchDir, [8, 30, 0]);                 // q8_0, bf16, f32
    seams.cachedFilePath = () => p;
    expect(await weightDtypes(card, 'q8_0')).toEqual(['bf16', 'f32', 'q8_0']);
  });

  it('weightDtypes never yields an integer type', async () => {
    const card = ttsModel('voxcpm2')!;
    const p = writeGguf(benchDir, [8, 30, 0, 26, 27]);         // + i32, i64
    seams.cachedFilePath = () => p;
    expect(await weightDtypes(card, 'q8_0')).toEqual(['bf16', 'f32', 'q8_0']);
    const onlyInt = writeGguf(fs.mkdtempSync(path.join(benchDir, 'i-')), [26, 27]);
    seams.cachedFilePath = () => onlyInt;
    expect(new Set(await weightDtypes(card, 'q8_0'))).toEqual(RUNG_FALLBACK_DTYPES.q8_0);
    seams.cachedFilePath = () => null;
    for (const ct of [...new Set(card.deployments.map((d) => d.computeType))].sort()) {
      expect((await weightDtypes(card, ct)).filter((t) => ['i8', 'i16', 'i32', 'i64', 'f64'].includes(t))).toEqual([]);
    }
  });

  it('the ops key carries the dtype set', () => {
    const m = knownGpuMachine();
    const a = opsKey(m, 0, 'tts', 'voxcpm2', 'q8_0', ['q8_0', 'bf16', 'f32']);
    expect(a).toBe('G1|ops:0:tts:voxcpm2:q8_0:bf16+f32+q8_0');
    expect(a).not.toBe(opsKey(m, 0, 'tts', 'voxcpm2', 'q8_0', ['q8_0', 'bf16', 'f16', 'f32']));
  });
});

const nativeError = (status: number) => Object.assign(new Error(`sk: failed (status ${status})`), { name: 'NativeError', status });

describe('op coverage', () => {
  it('computes once per key and caches answers, never errors', async () => {
    const m = knownGpuMachine();
    const calls: unknown[] = [];
    seams.deviceSupportsOps = async (i, s, f, dts) => { calls.push([i, s, f, [...dts]]); return { allSupported: false, unsupported: ['NORM[f32,-,-,-,-]->f32'], checked: ['NORM[f32,-,-,-,-]->f32'] }; };
    const cov = await computeOpCoverage(m, 0, 'tts', 'voxcpm2', 'q8_0', ['f32', 'q8_0']);
    expect(cov).toEqual({ allSupported: false, unsupported: ['NORM[f32,-,-,-,-]->f32'] });
    expect(await computeOpCoverage(m, 0, 'tts', 'voxcpm2', 'q8_0', ['f32', 'q8_0'])).toEqual(cov);
    expect(calls).toHaveLength(1);
    expect(benchLoad()[opsKey(m, 0, 'tts', 'voxcpm2', 'q8_0', ['f32', 'q8_0'])]).toEqual({ allSupported: false, unsupported: ['NORM[f32,-,-,-,-]->f32'] });
    await computeOpCoverage(m, 0, 'tts', 'voxcpm2', 'q8_0', ['bf16', 'f32', 'q8_0']);
    expect(calls).toHaveLength(2);
    seams.deviceSupportsOps = async () => { throw nativeError(-4); };
    expect(await computeOpCoverage(m, 0, 'asr', 'whisper', 'q8_0', ['q8_0'])).toBeNull();
    expect(opsKey(m, 0, 'asr', 'whisper', 'q8_0', ['q8_0']) in benchLoad()).toBe(false);
    seams.deviceSupportsOps = async () => { throw nativeError(-3); };
    expect(await computeOpCoverage(m, 0, 'tts', 'voxcpm2', 'bf16', ['bf16'])).toBeNull();
    seams.deviceSupportsOps = async () => { throw nativeError(-1); };
    await expect(computeOpCoverage(m, 0, 'tts', 'voxcpm2', 'q8_0', ['q8_0'])).rejects.toMatchObject({ status: -1 });
    process.env.SOKUJI_WIRE_STRICT = '0';
    try {
      expect(await computeOpCoverage(m, 0, 'tts', 'voxcpm2', 'q8_0', ['q8_0'])).toBeNull();
    } finally {
      process.env.SOKUJI_WIRE_STRICT = '1';
    }
  });

  it('a cache entry that is not the dict shape is a miss at both read sites', async () => {
    const m = knownGpuMachine();
    const card = ttsModel('voxcpm2')!;
    const dts = await weightDtypes(card, 'q8_0');
    const key = opsKey(m, 0, 'tts', 'voxcpm2', 'q8_0', dts);
    benchSave({ [key]: 0.5 }, { generation: 'G1' });
    seams.deviceSupportsOps = async () => { throw new Error('read-only lookup reached the addon'); };
    expect((await cachedOpCoverage(m, [card]))(0, 'tts', 'voxcpm2', 'q8_0')).toBeNull();
    let calls = 0;
    seams.deviceSupportsOps = async () => { calls++; return { allSupported: true, unsupported: [], checked: [] }; };
    expect(await computeOpCoverage(m, 0, 'tts', 'voxcpm2', 'q8_0', dts)).toEqual({ allSupported: true, unsupported: [] });
    expect(calls).toBe(1);
    expect(benchLoad()[key]).toEqual({ allSupported: true, unsupported: [] });
  });

  it('precomputes only what the planner may gate', async () => {
    const calls: Array<[number, string, string]> = [];
    seams.deviceSupportsOps = async (i, s, f) => { calls.push([i, f, s]); return { allSupported: true, unsupported: [], checked: [] }; };
    const card = ttsModel('voxcpm2')!;
    const m = knownGpuMachine();
    const cb = await opCoverageFor(m, card, 'auto');
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c[0] === 0 && c[1] === 'voxcpm2' && c[2] === 'tts')).toBe(true);
    expect(cb(0, 'tts', 'voxcpm2', 'q8_0')?.allSupported).toBe(true);
    expect(cb(0, 'tts', 'voxcpm2', 'f16')).toBeNull();
    calls.length = 0;
    await opCoverageFor(m, card, 'cpu');
    expect(calls).toEqual([]);
    await opCoverageFor({ ...m, devices: [] }, card, 'auto');
    expect(calls).toEqual([]);
    await opCoverageFor({ ...m, devices: [{ ...m.devices[0], known: false }, m.devices[1]] }, card, 'auto');
    expect(calls).toEqual([]);
    const second = { ...m.devices[0], index: 2, name: 'vulkan2', description: 'other' };
    await opCoverageFor({ ...m, devices: [m.devices[0], second, m.devices[1]], generation: 'G2' }, card, 'auto');
    expect(calls.length).toBeGreaterThan(0);
    expect(new Set(calls.map((c) => c[0]))).toEqual(new Set([0]));
  });

  it('the lookup takes four arguments on every path', async () => {
    const m = knownGpuMachine();
    const card = ttsModel('voxcpm2')!;
    for (const cb of [await opCoverageFor(m, card, 'cpu'), await opCoverageFor(m, null, 'auto'), await opCoverageFor({ ...m, devices: [] }, card, 'auto')]) {
      expect(cb(0, 'tts', 'voxcpm2', 'q8_0')).toBeNull();
    }
  });

  it('an explicit CPU load resolves on profile-carrying hardware', async () => {
    seams.system = () => 'Linux';
    expect((await resolveTts('voxcpm2', 'cpu', knownGpuMachine()))[0].device).toBe('cpu');
  });

  it('the cached lookup only reads', async () => {
    const m = knownGpuMachine();
    const card = ttsModel('voxcpm2')!;
    seams.deviceSupportsOps = async () => { throw new Error('read-only lookup reached the addon'); };
    expect((await cachedOpCoverage(m, [card]))(0, 'tts', 'voxcpm2', 'q8_0')).toBeNull();
    const dts = await weightDtypes(card, 'q8_0');
    benchSave({ [opsKey(m, 0, 'tts', 'voxcpm2', 'q8_0', dts)]: { allSupported: false, unsupported: ['X'] } }, { generation: 'G1' });
    expect((await cachedOpCoverage(m, [card]))(0, 'tts', 'voxcpm2', 'q8_0')).toEqual({ allSupported: false, unsupported: ['X'] });
  });
});

describe('hardware_info with profiles', () => {
  it('carries the profiles and the cached coverage, and never computes any', async () => {
    restoreSeams();
    const m = knownGpuMachine();
    setMachineForTests(m);
    fakeWith([{ kind: 'vulkan', description: 'GB10', memTotal: 96 * GIB, memFree: 90 * GIB }, { kind: 'cpu', description: 'CPU', memTotal: 120 * GIB, memFree: 100 * GIB }], { version: '1.1.0', engineVersions: { ggml: '0.22.0', lane: 'cpu-vulkan' } });
    benchSave({ [opsKey(m, 0, 'tts', 'voxcpm2', 'q8_0', ['bf16', 'f32', 'q8_0'])]: { allSupported: false, unsupported: ['NORM[f32,-,-,-,-]->f32'] } }, { generation: 'G1' });
    seams.deviceSupportsOps = async () => { throw new Error('hardware_info must not compute coverage'); };
    const out = await call('hardware_info', { id: 7 });
    expect(out.generation).toBe('G1');
    const dev = out.devices[0];
    expect([dev.kind, dev.known, dev.deviceUuid, dev.driverName]).toEqual(['vulkan', true, 'ab'.repeat(16), 'NVIDIA']);
    expect(dev.opCoverage).toEqual({ 'tts/voxcpm2/q8_0': { allSupported: false, unsupported: ['NORM[f32,-,-,-,-]->f32'] } });
    expect([out.devices[1].cpuFeatures, out.devices[1].opCoverage]).toEqual(['NEON=1', {}]);
    checkOutbound(out);
  });

  it("without profiles it is today's wire plus nulls", async () => {
    restoreSeams();
    setNativeForTests(null);
    setMachineForTests({ ...knownGpuMachine(), devices: [], generation: '' });
    const out = await call('hardware_info', { id: 8 });
    expect([out.generation, out.devices]).toEqual([null, null]);
  });
});

describe('models_catalog with cached coverage', () => {
  it('marks the refusing tiers, keeps supported true, and a miss is the plain wire', async () => {
    const m = knownGpuMachine();
    setMachineForTests(m);
    const card = ttsModel('voxcpm2')!;
    benchSave({
      [opsKey(m, 0, 'tts', 'voxcpm2', 'bf16', await weightDtypes(card, 'bf16'))]: { allSupported: false, unsupported: ['X'] },
      [opsKey(m, 0, 'tts', 'voxcpm2', 'q8_0', await weightDtypes(card, 'q8_0'))]: { allSupported: true, unsupported: [] },
    }, { generation: 'G1' });
    const out = await call('models_catalog', { id: 1, kind: 'tts', models: ['voxcpm2'] });
    const cardOut = out.models[0];
    expect(cardOut.tiers.find((t: { tier: string }) => t.tier === 'gpu-vulkan').available).toBe(true);
    const byId = Object.fromEntries((cardOut.variants as Array<Record<string, any>>).map((v) => [v.id, v]));
    expect([byId.bf16.supported, byId.bf16.unsupportedTiers]).toEqual([true, ['gpu-vulkan']]);
    expect(byId.q8_0.supported).toBe(true);
    expect('unsupportedTiers' in byId.q8_0).toBe(false);
    checkOutbound(out);
    process.env.SOKUJI_BENCH_DIR = path.join(benchDir, 'empty');
    const out2 = await call('models_catalog', { id: 2, kind: 'tts', models: ['voxcpm2'] });
    expect((out2.models[0].variants as Array<Record<string, any>>).every((v) => !('unsupportedTiers' in v))).toBe(true);
    expect(out2.models[0].tiers.find((t: { tier: string }) => t.tier === 'gpu-vulkan').available).toBe(true);
  });

  it('a tier where every rung is refused is unavailable', async () => {
    const m = knownGpuMachine();
    setMachineForTests(m);
    const card = ttsModel('voxcpm2')!;
    const entries: Record<string, unknown> = {};
    for (const ct of new Set(card.deployments.map((d) => d.computeType))) entries[opsKey(m, 0, 'tts', 'voxcpm2', ct, await weightDtypes(card, ct))] = { allSupported: false, unsupported: ['X'] };
    benchSave(entries, { generation: 'G1' });
    const out = await call('models_catalog', { id: 3, kind: 'tts', models: ['voxcpm2'] });
    expect(out.models[0].tiers.find((t: { tier: string }) => t.tier === 'gpu-vulkan').available).toBe(false);
    expect(out.models[0].tiers.find((t: { tier: string }) => t.tier === 'cpu').available).toBe(true);
  });
});
