/**
 * The Loader's wrappers around the pure planner (port of accel.py's wrappers): each fetches the environment facts —
 * the platform, the bench cache, the probed machine, the cached quants, size estimates, the format runtimes, op
 * coverage — and hands them to the planner. Async because op coverage asks the native library.
 */
import { asrModel, resolveTtsCard, translateModel, type Deployment, type ModelBase } from '../catalog';
import * as planner from '../planner';
import type { Plan } from '../planner';
import { benchLoad } from './bench';
import type { Machine } from './machine';
import { downloadedQuants, opCoverageFor } from './opCoverage';
import { currentPlatform, probe } from './probe';
import { seams } from './seams';

/** A deployment's size: its own estimate, else the artifact's size; null when unknown. */
function defaultEstBytes(d: Deployment): number | null {
  return d.estBytes ?? seams.modelSize(d.artifact);
}

/** The runtimes a compute type needs beyond its backend: fp8 needs compressed_tensors, which no TypeScript engine has. */
const FORMAT_MODULE: Readonly<Record<string, string>> = { fp8: 'compressed_tensors' };

function defaultFormatReady(computeType: string): boolean {
  return FORMAT_MODULE[computeType] === undefined;
}

/** Replaceable in tests, as Python's tests replace accel._est_bytes and accel._format_ready. */
export const resolveSeams = { estBytes: defaultEstBytes, formatReady: defaultFormatReady };
const RESOLVE_DEFAULTS = { ...resolveSeams };
export function restoreResolveSeams(): void {
  Object.assign(resolveSeams, RESOLVE_DEFAULTS);
}
export const estBytes = (d: Deployment): number | null => resolveSeams.estBytes(d);
export const formatReady = (computeType: string): boolean => resolveSeams.formatReady(computeType);

export function resolveDeployments(model: ModelBase, machine: Machine, override = 'auto', bench: ReadonlyMap<string, number> | null = null, { platform, opCoverage }: { platform?: string; opCoverage?: planner.OpCoverageFor } = {}): Plan[] {
  return planner.resolveDeployments(model, machine, override, bench, { platform: platform ?? currentPlatform(), opCoverage: opCoverage ?? planner.NO_COVERAGE });
}

export async function resolve(modelId: string, override = 'auto', machine: Machine | null = null, pin: string | null = null): Promise<Plan[]> {
  const m = machine ?? probe();
  const model = asrModel(modelId);
  const multiQuant = model !== null && new Set(model.deployments.map((d) => d.computeType)).size > 1;
  const downloaded = multiQuant ? downloadedQuants(model) : new Set<string>();
  return planner.resolve(modelId, override, { machine: m, platform: currentPlatform(), cache: benchLoad() as planner.BenchCache, downloaded, pin, opCoverage: await opCoverageFor(m, model, override) });
}

export async function resolveTranslate(modelId: string, override = 'auto', machine: Machine | null = null, reservedBytes = 0, pin: string | null = null): Promise<Plan[]> {
  const m = machine ?? probe();
  const model = translateModel(modelId);
  const downloaded = override === 'auto' && model !== null ? downloadedQuants(model) : new Set<string>();
  return planner.resolveTranslate(modelId, override, {
    machine: m, platform: currentPlatform(), cache: benchLoad() as planner.BenchCache, downloaded, reservedBytes, pin, estBytes, formatReady,
    opCoverage: await opCoverageFor(m, model, override),
  });
}

/** TTS's artifacts are single-file GGUFs, so the cached-rung check is the same as every other multi-quant kind's. */
export async function resolveTts(modelId: string, override = 'auto', machine: Machine | null = null, pin: string | null = null): Promise<Plan[]> {
  const m = machine ?? probe();
  const model = resolveTtsCard(modelId);
  const multiQuant = model !== null && new Set(model.deployments.map((d) => d.computeType)).size > 1;
  const downloaded = multiQuant ? downloadedQuants(model) : new Set<string>();
  return planner.resolveTts(modelId, override, { machine: m, platform: currentPlatform(), cache: benchLoad() as planner.BenchCache, downloaded, pin, estBytes, opCoverage: await opCoverageFor(m, model, override) });
}

export function selectVariant(model: ModelBase, machine: Machine, reservedBytes: number, pin: string | null = null, budgetBytes: number | null = null, downloaded: ReadonlySet<string> | null = null, opCoverage: planner.OpCoverageFor | null = null): Deployment | null {
  return planner.selectVariant(model, machine, reservedBytes, pin, budgetBytes, downloaded, { estBytes, formatReady, opCoverage: opCoverage ?? planner.NO_COVERAGE });
}

export function llamacppVariantRow(model: ModelBase, machine: Machine, pin: string | null, reservedBytes = 0, budgetBytes: number | null = null, downloaded: ReadonlySet<string> | null = null, opCoverage: planner.OpCoverageFor | null = null): Deployment | null {
  return planner.llamacppVariantRow(model, machine, pin, reservedBytes, budgetBytes, downloaded, { estBytes, opCoverage: opCoverage ?? planner.NO_COVERAGE });
}
