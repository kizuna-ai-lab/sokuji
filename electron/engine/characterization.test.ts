// @vitest-environment node
/**
 * The planner held to the Python planner's own answers (characterization.json): every catalog card on each of the
 * characterisation machines, under each override, through resolve / resolveTranslate / resolveTts, and the three quant
 * pickers with each machine's budget, a tiny budget, and the card's first two quants as pins. As the Python suite
 * pins it: nothing downloaded, an empty bench cache, and no op coverage (the machines carry no device profiles).
 */
import './test/env';
import { describe, expect, it } from 'vitest';
import golden from './test/golden/characterization.json';
import { asrModel, translateModel, ttsModel, type Deployment, type ModelBase } from './catalog';
import { machine, type Machine } from './accel/machine';
import { llamacppVariantRow, resolve, resolveTranslate, resolveTts, selectVariant, tcPickQuant } from './planner';

type GoldenMachine = { os: string; arch: string; cpu_cores: number; apple_silicon: boolean; installed: string[]; fingerprint: string; tc_kinds: string[]; gpus: Array<[string, string, number]>; devices: unknown[]; generation: string };

const MACHINES: Record<string, { machine: Machine; platform: string; quantBudget: number | null }> = Object.fromEntries(
  Object.entries(golden.machines as unknown as Record<string, { machine: GoldenMachine; platform: string; quant_budget: number | null }>).map(([name, g]) => [name, {
    machine: machine({
      os: g.machine.os, arch: g.machine.arch, cpuCores: g.machine.cpu_cores, appleSilicon: g.machine.apple_silicon,
      installed: new Set(g.machine.installed), fingerprint: g.machine.fingerprint, tcKinds: g.machine.tc_kinds,
      gpus: g.machine.gpus, devices: [], generation: g.machine.generation,
    }),
    platform: g.platform,
    quantBudget: g.quant_budget,
  }]),
);

function snake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snake);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), snake(v)]));
  }
  return value;
}

const answer = (run: () => unknown): unknown => {
  try {
    return snake(run());
  } catch (e) {
    return { error: (e as Error).name, message: (e as Error).message };
  }
};

const card = (id: string): ModelBase => (asrModel(id) ?? translateModel(id) ?? ttsModel(id))!;
const estBytes = (d: Deployment) => d.estBytes;
const formatReady = () => true;

type Case = { fn: string; machine: string; model: string; override?: string; pin?: string | null; budget?: number | null; result: unknown };

describe('the planner equals the Python planner', () => {
  it('has the machines and the cases', () => {
    expect(Object.keys(MACHINES).sort()).toEqual(['APPLE_SILICON', 'CPU_ONLY', 'CUDA_12GB', 'CUDA_24GB']);
    expect(golden.cases.length).toBeGreaterThan(3000);
  });

  it.each((golden.cases as Case[]).map((c, i) => [`${i} ${c.fn} ${c.machine} ${c.model} ${c.override ?? ''}${c.pin !== undefined ? ` pin=${c.pin}` : ''}${c.budget !== undefined ? ` budget=${c.budget}` : ''}`, c] as const))('%s', (_label, c) => {
    const { machine: m, platform } = MACHINES[c.machine];
    const opts = { machine: m, platform, cache: {}, downloaded: new Set<string>() };
    const pin = c.pin ?? null;
    const budget = c.budget ?? null;
    let got: unknown;
    switch (c.fn) {
      case 'resolve': got = answer(() => resolve(c.model, c.override, opts)); break;
      case 'resolve_translate': got = answer(() => resolveTranslate(c.model, c.override, { ...opts, estBytes, formatReady })); break;
      case 'resolve_tts': got = answer(() => resolveTts(c.model, c.override, { ...opts, estBytes })); break;
      case '_tc_pick_quant': got = answer(() => tcPickQuant(card(c.model), m, pin, budget, new Set())); break;
      case 'select_variant': got = answer(() => selectVariant(card(c.model), m, 0, pin, budget, new Set(), { estBytes, formatReady })); break;
      case '_llamacpp_variant_row': got = answer(() => llamacppVariantRow(card(c.model), m, pin, 0, budget, new Set(), { estBytes })); break;
      default: throw new Error(`unknown fn ${c.fn}`);
    }
    expect(got).toEqual(c.result);
  });
});
