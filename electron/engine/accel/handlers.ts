/**
 * The accel handlers (port of accel.py's _h_list_variants, _h_hardware_info and _h_models_catalog): this machine and
 * its engine for the Logs and the engine card, the catalog with each tier's availability and each rung's fit, and a
 * translation card's variants with the recommended one.
 */
import { asrModels, licenseDict, translateModel, translateModels, ttsModels, voiceCapability, type ModelBase, type TtsModel } from '../catalog';
import * as planner from '../planner';
import { TIER_RANK, deploymentAvailable, isGgufLlm, platformOk, quantBudgetBytes, tcPickQuant, tierAvailable } from '../planner';
import { register as registerHandler, type EngineState, type Handler, type Msg } from '../server';
import { benchLoad } from './bench';
import type { Machine } from './machine';
import { cachedOpCoverage, downloadedQuants } from './opCoverage';
import { currentPlatform, probe } from './probe';
import { estBytes, formatReady, llamacppVariantRow, selectVariant } from './resolve';
import { seams } from './seams';

const VRAM_CONTEXT_BYTES = 2 ** 30;
const VARIANT_WEIGHT_FACTOR: Readonly<Record<string, number>> = { fp8: 1.5 };
const weightFactor = (ct: string) => VARIANT_WEIGHT_FACTOR[ct] ?? 1.2;
const TC_RESIDENT_FACTOR = planner.TC_RESIDENT_FACTOR;
const LLAMA_RESIDENT_FACTOR = 1.1;

export const listVariants: Handler = async (_state, msg) => {
  const m = probe();
  const model = catalogSources.translateModel(String(msg.model));
  if (model === null) return [{ type: 'error', id: msg.id, message: 'unknown model' }, null];
  let reserve = 0;
  for (const k of ['asrId', 'ttsId']) if (msg[k]) reserve += seams.modelSize(String(msg[k])) || 0;
  const cov = await cachedOpCoverage(m, [model]);
  // The recommendation basis is STABLE across sessions (it decides which quant is downloaded): total memory.
  const chosen = selectVariant(model, m, reserve, (msg.pin as string | undefined) ?? null, quantBudgetBytes(m), null, cov);
  if (chosen === null) return [{ type: 'error', id: msg.id, message: 'no runnable variant' }, null];
  if (isGgufLlm(model)) {
    // A GGUF quant serves every tier: one row per compute type, no memory math.
    const seen = new Map<string, (typeof model.deployments)[number]>();
    for (const d of model.deployments) if (!seen.has(d.computeType)) seen.set(d.computeType, d);
    const variants = [...seen].map(([ct, d]) => ({ id: ct, computeType: ct, repo: d.artifact, sizeBytes: estBytes(d) || 0, supported: true, reason: 'ok' }));
    return [{ type: 'list_variants_result', id: msg.id, variants, recommended: chosen.computeType }, null];
  }
  const total = quantBudgetBytes(m);
  const budget = total ? total - reserve - VRAM_CONTEXT_BYTES : 0;
  const variants: Array<Record<string, unknown>> = [];
  for (const d of model.deployments) {
    if (d.tier === 'cpu') continue;
    const need = estBytes(d);
    let supported: boolean;
    let reason: string;
    if (!m.installed.has(d.backend) || !formatReady(d.computeType)) [supported, reason] = [false, 'runtime not installed'];
    else if (total === null || !tierAvailable(d.tier, m, d.backend)) [supported, reason] = [false, 'no usable GPU'];
    else if (need === null) [supported, reason] = [false, 'size unknown'];
    else if (need * weightFactor(d.computeType) > budget) [supported, reason] = [false, 'too big for available VRAM'];
    else [supported, reason] = [true, 'fits'];
    variants.push({ id: d.computeType, computeType: d.computeType, repo: d.artifact, sizeBytes: need || 0, supported, reason });
  }
  return [{ type: 'list_variants_result', id: msg.id, variants, recommended: chosen.computeType }, null];
};

const GPU_VENDORS = ['nvidia', 'amd', 'intel', 'apple'];

/** The vendor slug in a device description, best-effort. */
export function gpuVendor(description: string | null | undefined): string {
  const d = (description ?? '').toLowerCase();
  return GPU_VENDORS.find((v) => d.includes(v)) ?? 'unknown';
}

const ENGINE_TIER_FOR_KIND: Readonly<Record<string, string>> = { metal: 'gpu-metal', vulkan: 'gpu-vulkan', cpu: 'cpu' };

/**
 * [nativeVersion, engineVersions, lane, preferredDevice] — all null together when the addon fails, so this reply
 * degrades instead of breaking. preferredDevice is the device with the highest tier rank among those tierAvailable
 * accepts (a paravirtual Metal GPU is never preferred), else the CPU device.
 */
export function engineIdentity(m: Machine): [string | null, Record<string, string> | null, string | null, Record<string, string> | null] {
  let nativeVersion: string;
  let engineVersions: Record<string, string>;
  let devices: ReturnType<typeof seams.nativeDevices>;
  try {
    [nativeVersion, engineVersions] = seams.nativeIdentity();
    engineVersions = { ...engineVersions };
    devices = seams.nativeDevices();
  } catch {
    // Only the native boundary is guarded; the ranking below must fail loudly if it is wrong.
    return [null, null, null, null];
  }
  // The build lane rides in engineVersions; the wire carries it as its own field.
  const lane = engineVersions.lane ?? null;
  delete engineVersions.lane;
  let best: (typeof devices)[number] | null = null;
  let bestRank = -Infinity;
  for (const d of devices) {
    const tier = ENGINE_TIER_FOR_KIND[d.kind];
    if (tier !== undefined && tierAvailable(tier, m)) {
      const rank = TIER_RANK[tier] ?? 0.0;
      if (rank > bestRank) {
        bestRank = rank;
        best = d;
      }
    }
  }
  if (best === null) best = devices.find((d) => d.kind === 'cpu') ?? null;
  const preferred = best !== null ? { kind: best.kind, name: best.name, description: best.description } : null;
  return [nativeVersion, engineVersions, lane, preferred];
}

/**
 * Spec A §3.4: each profile plus whatever op coverage is already cached — read-only. The wire key drops the dtype
 * segment; when a pre-download and a post-download entry both exist for a rung, the later-written one wins.
 */
export function devicesWire(m: Machine): Array<Record<string, unknown>> {
  if (m.devices.length === 0) return [];
  const entries = benchLoad();
  const prefix = `${m.generation}|ops:`;
  const perDevice = new Map<number, Record<string, unknown>>(m.devices.map((d) => [d.index, {}]));
  for (const [k, v] of Object.entries(entries)) {
    if (!k.startsWith(prefix) || typeof v !== 'object' || v === null || Array.isArray(v)) continue;
    const rest = k.slice(k.indexOf('|') + 1);
    const parts = rest.split(':');
    const [, idx, stage, family, ct] = [parts[0], parts[1], parts[2], parts[3], parts[4]];
    const target = perDevice.get(Number.parseInt(idx, 10));
    if (target) {
      const e = v as { allSupported?: unknown; unsupported?: unknown };
      target[`${stage}/${family}/${ct}`] = { allSupported: Boolean(e.allSupported), unsupported: Array.isArray(e.unsupported) ? [...e.unsupported] : [] };
    }
  }
  return m.devices.map((d) => ({
    index: d.index, kind: d.kind, name: d.name, description: d.description, memTotalMb: Math.floor(d.memTotal / 2 ** 20), known: d.known,
    features: [...d.features].sort(), driverName: d.driverName, driverVersion: d.driverVersion, deviceUuid: d.deviceUuid,
    cpuFeatures: d.cpuFeatures, opCoverage: perDevice.get(d.index),
  }));
}

export const hardwareInfo: Handler = async (_state, msg) => {
  const m = probe();
  const [nativeVersion, engineVersions, lane, preferredDevice] = engineIdentity(m);
  const devices = devicesWire(m);
  return [{
    type: 'hardware_info_result', id: msg.id,
    os: m.os, arch: m.arch, cpuCores: m.cpuCores,
    gpus: m.gpus.map(([, name, total]) => ({ vendor: gpuVendor(name), name, vramMb: Math.floor(total / 2 ** 20) })),
    backendsInstalled: [...m.installed].sort(),
    accelAvailable: m.gpus.length > 0 || m.appleSilicon,
    nativeVersion, engineVersions, lane, preferredDevice,
    generation: m.generation || null,
    devices: devices.length > 0 ? devices : null,
  }, null];
};

/** Which cards a catalog request lists, by kind; replaceable in tests as Python's monkeypatch of catalog.asr_models. */
export const catalogSources = {
  translateModel: (id: string): ModelBase | null => translateModel(id),
  asr: (): readonly ModelBase[] => asrModels(),
  translate: (): readonly ModelBase[] => translateModels(),
  tts: (): readonly ModelBase[] => ttsModels(),
};

export const modelsCatalog: Handler = async (_state, msg) => {
  const m = probe();
  const kind = (msg.kind as string | undefined) ?? 'asr';
  const source = kind === 'translate' ? catalogSources.translate() : kind === 'tts' ? catalogSources.tts() : catalogSources.asr();
  let wanted = msg.models as unknown;
  if (wanted && !Array.isArray(wanted)) wanted = [wanted];
  let models = [...source];
  if (Array.isArray(wanted) && wanted.length > 0) models = models.filter((x) => (wanted as unknown[]).includes(x.id));
  const out: Array<Record<string, unknown>> = [];
  const platformTag = currentPlatform();
  const cov = await cachedOpCoverage(m, models);
  for (const mdl of models) {
    const tiers: Array<Record<string, unknown>> = [];
    const seenTiers = new Set<string>();
    for (const d of mdl.deployments) {
      if (!platformOk(d, m, platformTag)) continue;          // an off-platform tier
      if (seenTiers.has(d.tier)) continue;                   // multi-quant ladders repeat tiers
      seenTiers.add(d.tier);
      // "available": some rung can execute there, even when one quant is op-refused.
      const anyRung = mdl.deployments.some((x) => x.tier === d.tier && platformOk(x, m, platformTag) && m.installed.has(x.backend) && deploymentAvailable(mdl, x, m, cov));
      tiers.push({ tier: d.tier, backend: d.backend, available: anyRung });
    }
    const entry: Record<string, unknown> = {
      id: mdl.id, name: mdl.name, languages: [...mdl.languages], recommended: mdl.recommended, tiers,
      order: mdl.sortOrder, repo: mdl.deployments[0].artifact, kind, sizeBytes: mdl.sizeBytes,
    };
    if (kind === 'tts') {
      const tts = mdl as TtsModel;
      entry.clones = tts.clones;
      entry.streaming = tts.streaming;
      entry.voice = voiceCapability(tts);
      const lic = licenseDict(tts);
      if (lic) entry.license = lic;
    }
    const seenCts: string[] = [];
    const sizesByCt = new Map<string, number>();
    const artifactByCt = new Map<string, string>();
    for (const d of mdl.deployments) {
      if (!platformOk(d, m, platformTag)) continue;
      if (!seenCts.includes(d.computeType)) {
        seenCts.push(d.computeType);
        artifactByCt.set(d.computeType, d.artifact);
      }
      if (d.estBytes) sizesByCt.set(d.computeType, Math.max(sizesByCt.get(d.computeType) ?? 0, d.estBytes));
    }
    if (kind === 'translate' || seenCts.length > 1) entry.variantIds = seenCts;
    if (seenCts.length > 1 && sizesByCt.size > 0) {
      // Machine-aware variants, quality-descending, each with whether it fits at all and the stable recommendation.
      const budget = quantBudgetBytes(m);
      const isLlama = isGgufLlm(mdl);
      let rec: string | null;
      if (isLlama) rec = llamacppVariantRow(mdl, m, null, 0, budget, null, cov)?.computeType ?? null;
      else rec = tcPickQuant(mdl, m, null, budget, null, { opCoverage: cov });
      // The rungs already cached, once per card: "downloaded ⇒ selectable" for the renderer.
      const cachedCts = downloadedQuants(mdl);
      const factor = isLlama ? LLAMA_RESIDENT_FACTOR : TC_RESIDENT_FACTOR;
      const variants: Array<Record<string, unknown>> = [];
      for (const [ct, size] of [...sizesByCt].sort((a, b) => b[1] - a[1])) {
        const need = Math.trunc(size * factor);
        const supported = isLlama ? true : budget === null ? true : need <= budget;
        const v: Record<string, unknown> = { id: ct, sizeBytes: size, needBytes: need, repo: artifactByCt.get(ct), supported, recommended: ct === rec, downloaded: cachedCts.has(ct) };
        // A refused rung stays "supported" (it fits, and CPU still runs it); unsupportedTiers names the GPU tiers that refuse it.
        const refused = [...new Set(mdl.deployments
          .filter((x) => x.computeType === ct && x.tier !== 'cpu' && platformOk(x, m, platformTag) && tierAvailable(x.tier, m, x.backend) && !deploymentAvailable(mdl, x, m, cov))
          .map((x) => x.tier))].sort();
        if (refused.length > 0) v.unsupportedTiers = refused;
        variants.push(v);
      }
      entry.variants = variants;
      entry.deviceMemBytes = budget;
    }
    out.push(entry);
  }
  return [{ type: 'models_catalog_result', id: msg.id, models: out }, null];
};

const CATALOG_DEFAULTS = { ...catalogSources };
/** Puts the catalog lookups back (tests). */
export function restoreCatalogSources(): void {
  Object.assign(catalogSources, CATALOG_DEFAULTS);
}

export function register(state: EngineState): void {
  registerHandler(state, 'hardware_info', hardwareInfo);
  registerHandler(state, 'models_catalog', modelsCatalog);
  registerHandler(state, 'list_variants', listVariants);
}

export type { Msg };
