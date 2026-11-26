// @vitest-environment node
/**
 * The per-deployment platform filter (D9), ported from sidecar/tests/test_platform_filter.py: the platform tag, the
 * resolve wrappers dropping off-platform rows, and models_catalog hiding an off-platform tier. Python monkeypatches
 * catalog.translate_model for one case; here a module mock stands in for it, scoped to this file.
 */
import '../test/env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asrModelCard, deployment, translateModelCard, type Deployment, type ModelBase } from '../catalog';
import { createState, handleMessage } from '../server';
import { catalogSources, register, restoreCatalogSources } from './handlers';
import { machine, type Machine } from './machine';
import { currentPlatform, resetProbeForTests, setMachineForTests } from './probe';
import { resolve, resolveDeployments, resolveTranslate, restoreResolveSeams } from './resolve';
import { restoreSeams, seams } from './seams';

const synthetic = vi.hoisted(() => ({ translate: null as ModelBase | null }));
vi.mock('../catalog', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../catalog')>();
  return { ...orig, translateModel: (id: string) => (synthetic.translate?.id === id ? synthetic.translate : orig.translateModel(id)) };
});

const SYSTEM: Record<string, string> = { linux: 'Linux', windows: 'Windows', macos: 'Darwin' };
const onPlatform = (tag: string) => { seams.system = () => SYSTEM[tag]; };

const testMachine = ({ apple = false, gpus = [] as Array<[string, string, number]>, tc = [] as string[], installed = new Set(['be']) } = {}): Machine =>
  machine({ os: 'Linux', arch: 'x86_64', cpuCores: 8, appleSilicon: apple, installed, fingerprint: 'pf-test', tcKinds: tc, gpus });

/** An NVIDIA GPU as the probe reports it; `tc: ['vulkan', 'cpu']` alongside it is what lights gpu-vulkan. */
const NV_GPUS: Array<[string, string, number]> = [['vulkan', 'NVIDIA GeForce RTX 4070 SUPER', 12 * 2 ** 30]];

const asr = (...deps: Deployment[]) => asrModelCard('m', 'M', ['multi'], deps);

/** A windows-only tier over a cross-platform cpu floor; the tier label is synthetic, the filtering is generic. */
const platformRestricted = () => asrModelCard('syn', 'Syn', ['multi'], [
  deployment('be', 'gpu-hypothetical', 'q8_0', 'r', 1.0, { platforms: ['windows'] }),
  deployment('be', 'cpu', 'q8_0', 'r', 1.0),
]);

const catalogTiers = async () => {
  const st = createState();
  register(st);
  const [reply] = await handleMessage(st, JSON.stringify({ type: 'models_catalog', id: 1 }));
  return ((reply as Record<string, any>).models[0].tiers) as Array<{ tier: string; available: boolean }>;
};

let benchDir: string;
beforeEach(() => {
  benchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-bench-'));
  process.env.SOKUJI_BENCH_DIR = benchDir;
  restoreSeams();
  restoreResolveSeams();
  restoreCatalogSources();
  resetProbeForTests();
});

afterEach(() => {
  synthetic.translate = null;
  restoreSeams();
  restoreResolveSeams();
  restoreCatalogSources();
  resetProbeForTests();
  fs.rmSync(benchDir, { recursive: true, force: true });
});

describe('the platform filter', () => {
  it('maps the system name to the platform tag', () => {
    for (const [sys, tag] of [['Linux', 'linux'], ['Windows', 'windows'], ['Darwin', 'macos']]) {
      seams.system = () => sys;
      expect(currentPlatform()).toBe(tag);
    }
  });

  it('drops a windows-only row on linux', () => {
    onPlatform('linux');
    const model = asr(deployment('be', 'cpu', 'int8', 'r-win', 1.0, { platforms: ['windows'] }), deployment('be', 'cpu', 'int8', 'r-all', 1.0));
    expect(resolveDeployments(model, testMachine()).map((p) => p.artifact)).toEqual(['r-all']);
  });

  it('keeps a row on its own platform', () => {
    onPlatform('windows');
    const model = asr(deployment('be', 'cpu', 'int8', 'r-win', 1.0, { platforms: ['windows'] }), deployment('be', 'cpu', 'int8', 'r-all', 1.0));
    expect(new Set(resolveDeployments(model, testMachine()).map((p) => p.artifact))).toEqual(new Set(['r-win', 'r-all']));
  });

  it('drops a macos-only row on linux, whatever apple_silicon says', () => {
    onPlatform('linux');
    const model = asr(deployment('be', 'cpu', 'int8', 'r-mac', 1.0, { platforms: ['macos'] }), deployment('be', 'cpu', 'int8', 'r-all', 1.0));
    expect(resolveDeployments(model, testMachine({ apple: true })).map((p) => p.artifact)).toEqual(['r-all']);
  });

  it("translate's auto branch drops off-platform rows before picking the floor", async () => {
    // The auto branch builds its plans through selectVariant, never resolveDeployments, so it filters up front;
    // without that, r-win would be the cpu floor. A synthetic non-GGUF backend keeps selectVariant's generic path.
    onPlatform('linux');
    synthetic.translate = translateModelCard('syn', 'Syn', ['multi'], [
      deployment('hunyuan_translate', 'cpu', 'int8', 'r-win', 1.0, { platforms: ['windows'] }),
      deployment('hunyuan_translate', 'cpu', 'int8', 'r-all', 1.0),
    ]);
    const plans = await resolveTranslate('syn', 'auto', testMachine({ installed: new Set(['hunyuan_translate']) }));
    expect(plans.map((p) => p.artifact)).toEqual(['r-all']);
  });

  it('a real all-platforms card resolves as before on linux', async () => {
    onPlatform('linux');
    const plans = await resolve('whisper-base', 'auto', testMachine({ gpus: NV_GPUS, tc: ['vulkan', 'cpu'], installed: new Set(['native_asr']) }));
    expect(plans.map((p) => p.device)).toEqual(['vulkan', 'cpu']);
  });

  it('models_catalog hides an off-platform tier', async () => {
    onPlatform('linux');
    catalogSources.asr = () => [platformRestricted()];
    setMachineForTests(testMachine());
    expect((await catalogTiers()).map((t) => t.tier)).toEqual(['cpu']);
  });

  it('models_catalog lists an on-platform tier with its availability', async () => {
    onPlatform('windows');
    catalogSources.asr = () => [platformRestricted()];
    setMachineForTests(testMachine());
    const tiers = Object.fromEntries((await catalogTiers()).map((t) => [t.tier, t]));
    expect(new Set(Object.keys(tiers))).toEqual(new Set(['gpu-hypothetical', 'cpu']));
    expect(tiers['gpu-hypothetical'].available).toBe(false);
    expect(tiers.cpu.available).toBe(true);
  });
});
