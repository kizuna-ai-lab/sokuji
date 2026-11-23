/**
 * Op coverage (port of accel.py's coverage half, spec A §3.3): whether a device can execute a card's recorded graph
 * for one rung, asked of the native library once per key and cached in the bench file. The dtype set is part of the
 * key, so the pre-download (fallback-set) answer and the post-download (header-set) answer coexist.
 *
 * The native query is a promise here, so the precompute is async; what the planner is handed is still a plain lookup.
 */
import { RUNG_FALLBACK_DTYPES, WEIGHT_CAPABLE_DTYPES, splitArtifact, type ModelBase } from '../catalog';
import { readHeader } from '../ggufHeader';
import { STAGE_OF_BACKEND, TIER_DEVICE, tierAvailable, type OpCoverageFor } from '../planner';
import { benchLoad, benchSave } from './bench';
import type { DeviceProfile, Machine, OpCoverage } from './machine';
import { seams } from './seams';

/** The local path of the rung's file when it is in the HF cache, else null. */
export function artifactPath(model: ModelBase, computeType: string): string | null {
  const d = model.deployments.find((x) => x.computeType === computeType);
  if (!d) return null;
  const [repo, fname] = splitArtifact(d.artifact);
  if (!fname) return null;
  try {
    return seams.cachedFilePath(repo, fname);
  } catch {
    return null;
  }
}

/**
 * The compute types of `model` whose file is already cached. Load-time quant selection restricts itself to these; an
 * empty set means nothing is cached yet, so selection falls back to the budget logic.
 */
export function downloadedQuants(model: ModelBase): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  for (const d of model.deployments) {
    if (seen.has(d.computeType)) continue;
    seen.add(d.computeType);
    const [repo, fname] = splitArtifact(d.artifact);
    if (!fname) continue;
    try {
      if (seams.cachedFilePath(repo, fname) !== null) out.add(d.computeType);
    } catch {
      // not cached
    }
  }
  return out;
}

/**
 * The dtype set WEIGHT expands over (premise 7): the file's header set intersected with the weight-capable types when
 * the rung is on disk, else the rung's deliberately wide fallback set. Sorted, so it keys. An all-integer header leaves
 * nothing to ask, so the fallback stands in.
 */
export async function weightDtypes(model: ModelBase, computeType: string): Promise<string[]> {
  const fallback = [...(RUNG_FALLBACK_DTYPES[computeType] ?? new Set(['f32']))].sort();
  const p = artifactPath(model, computeType);
  if (p) {
    try {
      const header = [...(await readHeader(p)).tensorDtypes].filter((t) => WEIGHT_CAPABLE_DTYPES.has(t));
      if (header.length > 0) return header.sort();
    } catch {
      // unreadable: the fallback
    }
  }
  return fallback;
}

/** gen|ops:idx:stage:family:ct:dt1+dt2 */
export function opsKey(machine: Machine, deviceIndex: number, stage: string, family: string, computeType: string, dtypes: Iterable<string>): string {
  return `${machine.generation}|ops:${deviceIndex}:${stage}:${family}:${computeType}:${[...dtypes].sort().join('+')}`;
}

export function stageOfModel(model: ModelBase): string {
  return STAGE_OF_BACKEND[model.deployments[0].backend] ?? '';
}

/** SK_ERR_NOT_FOUND (no recording) and SK_ERR_BACKEND (Vulkan first-init threw): a miss, not an error. */
export const OK_TO_MISS: readonly number[] = [-4, -3];

/** One cache entry as an OpCoverage, or null when it is not the shape a write produces. */
export function opCoverageFromDict(v: unknown): OpCoverage | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const e = v as { allSupported?: unknown; unsupported?: unknown };
  return { allSupported: Boolean(e.allSupported), unsupported: Array.isArray(e.unsupported) ? e.unsupported.map(String) : [] };
}

/**
 * The native query once per key, cached in the bench file. NOT_FOUND and BACKEND answer null, uncached; any other
 * error is a programming error: thrown under SOKUJI_WIRE_STRICT (the test suite), logged and degraded otherwise.
 */
export async function computeOpCoverage(machine: Machine, deviceIndex: number, stage: string, family: string, computeType: string, dtypes: readonly string[]): Promise<OpCoverage | null> {
  const key = opsKey(machine, deviceIndex, stage, family, computeType, dtypes);
  const entries = benchLoad();
  if (key in entries) {
    const cached = opCoverageFromDict(entries[key]);
    if (cached !== null) return cached;
  }
  let cov: { allSupported: boolean; unsupported: readonly string[] };
  try {
    cov = await seams.deviceSupportsOps(deviceIndex, stage as 'asr' | 'translate' | 'tts', family, dtypes);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status !== undefined && OK_TO_MISS.includes(status)) return null;
    if (process.env.SOKUJI_WIRE_STRICT === '1') throw e;
    seams.log('warn', `device_supports_ops failed: ${String(e)}`);
    return null;
  }
  const out: OpCoverage = { allSupported: Boolean(cov.allSupported), unsupported: [...cov.unsupported] };
  const fresh = benchLoad();
  fresh[key] = { allSupported: out.allSupported, unsupported: [...out.unsupported] };
  benchSave(fresh, { generation: machine.generation });
  return out;
}

function firstDeviceOfKind(machine: Machine, kind: string): DeviceProfile | null {
  return machine.devices.find((d) => d.kind === kind) ?? null;
}

/** [device, tier] for each GPU tier the card lists that tierAvailable accepts: the first KNOWN device of that kind. */
export function gpuTargets(machine: Machine, model: ModelBase): Array<[DeviceProfile, string]> {
  const out: Array<[DeviceProfile, string]> = [];
  const seen = new Set<string>();
  for (const d of model.deployments) {
    if (d.tier === 'cpu' || !tierAvailable(d.tier, machine, d.backend)) continue;
    const kind = TIER_DEVICE[d.tier];
    if (seen.has(kind)) continue;
    seen.add(kind);
    const dev = firstDeviceOfKind(machine, kind);
    if (dev !== null && dev.known) out.push([dev, d.tier]);
  }
  return out;
}

const lookupOf = (results: Map<string, OpCoverage>): OpCoverageFor => (index, stage, family, ct) => results.get(`${index}|${stage}|${family}|${ct}`) ?? null;

/**
 * What the resolve wrappers hand the planner: a lookup over results PRECOMPUTED here — per accepted GPU tier, this
 * card's graph family, every rung it lists, each keyed by that rung's current dtype set. Nothing is computed for an
 * explicit CPU load, without profiles, or for no card; the lookup has the same four-argument shape on every path.
 */
export async function opCoverageFor(machine: Machine, model: ModelBase | null, override: string): Promise<OpCoverageFor> {
  const results = new Map<string, OpCoverage>();
  if (override === 'cpu' || machine.devices.length === 0 || model === null) return lookupOf(results);
  const stage = stageOfModel(model);
  for (const [dev] of gpuTargets(machine, model)) {
    for (const ct of [...new Set(model.deployments.map((x) => x.computeType))].sort()) {
      const cov = await computeOpCoverage(machine, dev.index, stage, model.graphFamily, ct, await weightDtypes(model, ct));
      if (cov !== null) results.set(`${dev.index}|${stage}|${model.graphFamily}|${ct}`, cov);
    }
  }
  return lookupOf(results);
}

/** The read-only twin for the wire producers: the same keys, looked up in the bench file, never computed. */
export async function cachedOpCoverage(machine: Machine, models: readonly ModelBase[]): Promise<OpCoverageFor> {
  const entries = benchLoad();
  const results = new Map<string, OpCoverage>();
  if (machine.devices.length > 0) {
    for (const model of models) {
      const stage = stageOfModel(model);
      for (const [dev] of gpuTargets(machine, model)) {
        for (const ct of [...new Set(model.deployments.map((x) => x.computeType))].sort()) {
          const cov = opCoverageFromDict(entries[opsKey(machine, dev.index, stage, model.graphFamily, ct, await weightDtypes(model, ct))]);
          if (cov !== null) results.set(`${dev.index}|${stage}|${model.graphFamily}|${ct}`, cov);
        }
      }
    }
  }
  return lookupOf(results);
}
