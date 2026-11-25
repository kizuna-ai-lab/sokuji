/**
 * Loading a model along its plans (port of accel.py's loader half): try each plan in order and fall back, with a
 * proactive memory gate before a GPU plan that still has a CPU plan after it, an honest message when a GPU-only model
 * runs out of memory, and the loaded footprint measured and claimed in the cross-stage ledger.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BackendLoadError } from '../backends';
import type { Plan, PlanConfig } from '../planner';
import { deviceFreeBytes } from './probe';
import { ledgerClaim } from './ledger';
import { seams } from './seams';

/** Every plan failed to load, the CPU floor included. */
export class AllPlansFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllPlansFailed';
  }
}

/** What a backend offers the loader. */
export interface Loadable { load(artifact: string, device: string, computeType: string, config?: PlanConfig): Promise<void> | void }

// Free memory must clear weights × this factor plus a fixed slab for the runtime's context (the planner's figures).
const VRAM_WEIGHT_FACTOR = 1.2;
const VARIANT_WEIGHT_FACTOR: Readonly<Record<string, number>> = { fp8: 1.5 };
const VRAM_CONTEXT_BYTES = 2 ** 30;
const weightFactor = (ct: string) => VARIANT_WEIGHT_FACTOR[ct] ?? VRAM_WEIGHT_FACTOR;

/** Weight files dominate a model's footprint; the rest (config, tokenizer) is negligible. */
const WEIGHT_EXTS = ['.safetensors', '.bin', '.pt', '.gguf', '.onnx', '.onnx.data'];

/**
 * The on-disk size of a model's weight files, read from a local directory or the repo's cached snapshot; null when it
 * cannot be told (no directory, not cached, no weight files), so the memory gate stays out of the way.
 */
export function modelWeightBytes(artifact: string): number | null {
  try {
    let dir: string | null = null;
    try {
      if (fs.statSync(artifact).isDirectory()) dir = artifact;
    } catch {
      dir = null;
    }
    if (dir === null) dir = seams.snapshotPath(artifact);
    if (dir === null) return null;
    let total = 0;
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (WEIGHT_EXTS.some((ext) => e.name.endsWith(ext))) total += fs.statSync(fs.realpathSync(p)).size;
      }
    };
    walk(dir);
    return total || null;
  } catch {
    return null;
  }
}

/** The seam tests replace, as Python's tests replace `_model_weight_bytes`. */
export const loaderSeams = { modelWeightBytes, deviceFreeBytes };

const gib = (n: number) => (n / 2 ** 30).toFixed(1);

/**
 * Tries plans in order and answers [backend, plan, notice]; `notice` says a higher plan was skipped. Throws
 * AllPlansFailed when none loads.
 *  - Proactive gate: before a GPU plan that still has a CPU plan after it, skip the attempt when free memory clearly
 *    cannot hold the weights. Not on Metal (unified memory: moving to CPU frees nothing) and not for a GGUF LLM (it
 *    loads fully or not at all, so a rough guess would only push a fittable model to CPU).
 *  - Honest exhaustion: when every plan failed on a GPU out-of-memory and there was no CPU floor, name the shortfall.
 */
export async function loadWithFallback(plans: readonly Plan[]): Promise<[unknown, Plan, string | null]> {
  let notice: string | null = null;
  let oom = false;
  let oomNeed: number | null = null;
  let oomFree: number | null = null;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const hasCpuFallback = plans.slice(i + 1).some((p) => p.device === 'cpu');
    const isGpu = plan.device !== 'cpu';
    const unified = plan.device === 'metal';
    const isGgufLlm = plan.backend === 'native_translate';
    // Read once per GPU plan, BEFORE the load: a failed load can leave allocator fragments behind.
    const free = isGpu && !isGgufLlm ? loaderSeams.deviceFreeBytes() : null;
    const need = isGpu && !isGgufLlm ? loaderSeams.modelWeightBytes(plan.artifact) : null;
    const budget = need !== null ? need * weightFactor(plan.computeType) + VRAM_CONTEXT_BYTES : null;
    if (isGpu && !unified && hasCpuFallback && free !== null && budget !== null && free < budget) {
      notice = `${plan.device} skipped (needs ~${gib(budget)} GiB, ${gib(free)} GiB free); using CPU`;
      continue;
    }
    try {
      const backend = seams.makeBackend(plan.backend) as Loadable;
      await backend.load(plan.artifact, plan.device, plan.computeType, plan.config);
      return [backend, plan, notice];
    } catch (e) {
      if (!(e instanceof BackendLoadError)) throw e;
      notice = `${plan.device} unavailable (${e.reason}); falling back`;
      // String-matched: GPU allocation failures share no error type across platforms, but say one of these.
      const reason = e.reason.toLowerCase();
      if (isGpu && (reason.includes('out of memory') || reason.includes('failed to allocate'))) {
        oom = true;
        oomNeed = budget;
        oomFree = free;
      }
    }
  }
  if (oom) {
    let short = '';
    if (oomNeed !== null && oomFree !== null) short = ` It needs ~${gib(oomNeed)} GiB but only ${gib(oomFree)} GiB is free.`;
    else if (oomFree !== null) short = ` Only ${gib(oomFree)} GiB GPU memory is free.`;
    throw new AllPlansFailed(`Not enough GPU memory to load this model.${short} Another model is using the GPU — switch a stage (ASR or translation) to CPU, or pick a smaller model.`);
  }
  throw new AllPlansFailed(notice ?? 'no plans to load');
}

/** The seam tests replace, as Python's tests replace `load_with_fallback`. */
export const loadSeams = { loadWithFallback };

/**
 * loadWithFallback, then the loaded model's footprint on its RESOLVED device: the free-memory delta on an
 * accelerator, the RSS delta on CPU; null when unmeasurable or not positive. With `stage`, the result is claimed in the
 * ledger: the bytes on an accelerator, an explicit 0 on CPU. Answers [backend, plan, notice, memoryBytes].
 */
export async function loadMeasured(plans: readonly Plan[], stage: string | null = null): Promise<[unknown, Plan, string | null, number | null]> {
  const vramBefore = loaderSeams.deviceFreeBytes();
  const rssBefore = seams.rssBytes();
  const [backend, plan, notice] = await loadSeams.loadWithFallback(plans);
  let memory: number | null = null;
  if (plan.device !== 'cpu' && vramBefore !== null) {
    const vramAfter = loaderSeams.deviceFreeBytes();
    if (vramAfter !== null) {
      const delta = vramBefore - vramAfter;
      memory = delta > 0 ? delta : null;
    }
  } else if (plan.device === 'cpu' && rssBefore !== null) {
    const rssAfter = seams.rssBytes();
    if (rssAfter !== null) {
      const delta = rssAfter - rssBefore;
      memory = delta > 0 ? delta : null;
    }
  }
  if (stage !== null) {
    if (plan.device === 'cpu') ledgerClaim(stage, 0);
    else ledgerClaim(stage, memory || loaderSeams.modelWeightBytes(plan.artifact) || 0);
  }
  return [backend, plan, notice, memory];
}

const LOADER_DEFAULTS = { ...loaderSeams };
const LOAD_DEFAULTS = { ...loadSeams };

/** Puts the loader's own seams back (tests). */
export function restoreLoaderSeams(): void {
  Object.assign(loaderSeams, LOADER_DEFAULTS);
  Object.assign(loadSeams, LOAD_DEFAULTS);
}
