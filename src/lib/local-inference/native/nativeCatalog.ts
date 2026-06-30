/**
 * Catalog of native (Electron sidecar) models per stage, plus the helpers that
 * turn settings into concrete model ids. Centralized so settings UI + session
 * config share one source of truth.
 */
import type { NativeModelInfo, NativeVoiceInfo, VariantInfo } from './nativeProtocol';

/**
 * Aliases between the app's source-language values (src/utils/languages.ts) and
 * the ISO codes the model catalogs use. The picker emits `cantonese`/`tl`, while
 * catalog rows use `yue`/`fil` (SenseVoice, Qwen3-ASR, Fun-ASR-MLT-Nano). Without
 * this, selecting Cantonese or Tagalog would mark those models incompatible even
 * though they support the language. Canonicalize both sides so the convention a
 * given row uses doesn't matter.
 */
const LANG_ALIASES: Record<string, string> = {
  cantonese: 'yue',
  tl: 'fil',
};
const canonLang = (l: string): string => LANG_ALIASES[l] ?? l;

/** `['multi']` matches any language; otherwise the language must be listed (alias-aware). */
export function supportsLanguage(opt: { languages?: string[] }, lang: string): boolean {
  if (!opt.languages) return false;
  if (opt.languages.includes('multi')) return true;
  const want = canonLang(lang);
  return opt.languages.some((l) => canonLang(l) === want);
}


/** Catalog entries of a kind, recommended-first then `order`. */
function catalogModels(catalog: Record<string, NativeModelInfo>, kind: NativeModelInfo['kind']): NativeModelInfo[] {
  return Object.values(catalog).filter((m) => m.kind === kind)
    .sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended) || a.order - b.order);
}

/** ASR models that support the source language, recommended then order first. */
export function compatibleNativeAsr(srcLang: string, catalog: Record<string, NativeModelInfo>): NativeModelInfo[] {
  return catalogModels(catalog, 'asr').filter((m) => supportsLanguage(m, srcLang));
}

/** ASR models that do NOT support the source language (shown behind a "show all" toggle). */
export function incompatibleNativeAsr(srcLang: string, catalog: Record<string, NativeModelInfo>): NativeModelInfo[] {
  return catalogModels(catalog, 'asr').filter((m) => !supportsLanguage(m, srcLang));
}

/** Auto-select an ASR model for the source language: keep current if it still
 *  supports the language, else the best (recommended) compatible model. */
export function nativeAsrForLanguage(srcLang: string, current: string, catalog: Record<string, NativeModelInfo>): string {
  const cur = catalog[current];
  if (cur && cur.kind === 'asr' && supportsLanguage(cur, srcLang)) return current;
  return (catalogModels(catalog, 'asr').filter((m) => supportsLanguage(m, srcLang))[0])?.id || current;
}

export type VoiceShape = 'none' | 'range' | 'list';
/** A TTS model's voice control shape: list (named voices + clones), range
 *  (numeric speaker id 0..N-1), or none (single voice). */
export function voiceShape(info: NativeModelInfo | undefined): VoiceShape {
  if (!info) return 'none';
  if (info.clones) return 'list';
  if ((info.numSpeakers ?? 1) > 1) return 'range';
  return 'none';
}

/** TTS models supporting the target language, recommended+order first. */
export function nativeTtsModels(tgt: string, catalog: Record<string, NativeModelInfo>): NativeModelInfo[] {
  return catalogModels(catalog, 'tts').filter((m) => supportsLanguage(m, tgt));
}

/** The per-language default built-in voice ('' when the list is empty). Reads the
 *  sidecar descriptor flagged `default` for the target language; else the first
 *  curated voice; else ''. */
export function defaultTtsVoice(targetLanguage: string, voices: NativeVoiceInfo[]): string {
  const want = canonLang(targetLanguage);
  const def = voices.find((v) => v.default && v.language && canonLang(v.language) === want);
  if (def) return `builtin:${def.name}`;
  const firstCurated = voices.find((v) => v.curated);
  return firstCurated ? `builtin:${firstCurated.name}` : '';
}

/** Split descriptors into curated (shown first; target-language curated before
 *  other curated) and the rest (alphabetical). */
export function curatedBuiltinVoices(
  targetLanguage: string, voices: NativeVoiceInfo[],
): { curated: NativeVoiceInfo[]; rest: NativeVoiceInfo[] } {
  const want = canonLang(targetLanguage);
  const curated = voices.filter((v) => v.curated);
  const rest = voices.filter((v) => !v.curated);
  curated.sort((a, b) => {
    const am = a.language && canonLang(a.language) === want ? 0 : 1;
    const bm = b.language && canonLang(b.language) === want ? 0 : 1;
    return am - bm || a.name.localeCompare(b.name);
  });
  rest.sort((a, b) => a.name.localeCompare(b.name));
  return { curated, rest };
}

export function nativeTtsModelIsVoiceCapable(modelId: string, catalog: Record<string, NativeModelInfo>): boolean {
  return !!catalog[modelId]?.clones;
}

/** Default native TTS model for the target language ('' = no speech output). */
export function pickNativeTts(tgt: string, catalog: Record<string, NativeModelInfo>): string {
  return nativeTtsModels(tgt, catalog)[0]?.id || '';
}

/** Whether a target language has native speech output available. */
export function hasNativeTts(tgt: string, catalog: Record<string, NativeModelInfo>): boolean {
  return nativeTtsModels(tgt, catalog).length > 0;
}

/**
 * Resolve the TTS model id from the settings choice + target language:
 *  - 'off'                 -> undefined (text only)
 *  - a voice valid for tgt -> that voice
 *  - '' or a stale voice   -> the default voice for tgt (Auto), or undefined
 */
export function resolveNativeTts(choice: string, tgt: string, catalog: Record<string, NativeModelInfo>): string | undefined {
  if (choice === 'off') return undefined;
  if (choice && nativeTtsModels(tgt, catalog).some((m) => m.id === choice)) return choice;
  return pickNativeTts(tgt, catalog) || undefined;
}

/**
 * Resolve the translation model id from the settings choice:
 *  - a model id     -> passed through unchanged (e.g. 'qwen2.5-0.5b', 'qwen3-0.6b')
 *  - '' (no choice) -> undefined; the sidecar then defaults to qwen2.5-0.5b
 */
export function resolveNativeTranslation(choice: string): string | undefined {
  return choice || undefined;
}

/**
 * The native model ids a given config requires (for download/readiness). Always
 * an ASR model + a translation model, plus a TTS model when speech output is on.
 * An empty translation choice falls back to the qwen2.5-0.5b download id.
 */
export function requiredNativeModels(
  asrModel: string, translationChoice: string, ttsChoice: string, _src: string, tgt: string,
  textOnly = false, catalog: Record<string, NativeModelInfo> = {},
): string[] {
  const ids = [asrModel, resolveNativeTranslation(translationChoice) || 'qwen2.5-0.5b'];
  // TTS is only required when speech output is on (text-only skips it entirely).
  if (!textOnly) {
    const tts = resolveNativeTts(ttsChoice, tgt, catalog);
    if (tts) ids.push(tts);
  }
  return ids;
}

/** True when the sidecar feed reports any available non-cpu tier — i.e. this
 *  machine has a usable GPU/NPU, so the "Force GPU" device option is meaningful. */
export function gpuTierAvailable(catalog: Record<string, NativeModelInfo>): boolean {
  return Object.values(catalog).some((m) => m.tiers.some((t) => t.available && t.tier !== 'cpu'));
}

/** A model is hardware-gated when the sidecar reports tiers for it but NONE are
 *  available on this machine (e.g. a GPU-only model with no GPU). Unknown (no
 *  catalog entry yet) is NOT gated — we don't grey a card before the feed loads. */
export function hardwareGated(info: NativeModelInfo | undefined): boolean {
  return !!info && info.tiers.length > 0 && !info.tiers.some((t) => t.available);
}

/** One active native stage for the memory estimate: the model's download id and
 *  the device override chosen for that stage ('auto' resolves to GPU when one is
 *  available). TTS has no device override, so callers pass 'cpu'. */
export interface NativeMemoryStage { id?: string | null; device: 'auto' | 'cpu' | 'cuda'; }

/**
 * Split the active native models into VRAM vs RAM, mirroring LOCAL_INFERENCE's
 * `estimateModelMemoryByDevice`: same "footprint ≈ on-disk size" heuristic, but
 * the GPU/CPU split comes from the per-stage device override and the sidecar's
 * tier availability instead of a static manifest flag.
 *
 * A stage counts toward VRAM when the user forced `cuda`, OR left it on `auto`
 * AND the model has an available non-cpu tier on this machine (so the resolver
 * would land it on the GPU). Everything else — explicit `cpu`, an auto model
 * with no usable GPU tier, or an unknown model (no catalog entry) — counts as
 * RAM. Sizes come from the sidecar's on-disk byte counts; a missing/zero size is
 * skipped so a not-yet-measured model doesn't show a phantom 0.
 */
export function estimateNativeMemoryByDevice(
  stages: NativeMemoryStage[],
  sizes: Record<string, number>,
  catalog: Record<string, NativeModelInfo>,
): { vramMb: number; ramMb: number } {
  let vramMb = 0;
  let ramMb = 0;
  for (const { id, device } of stages) {
    if (!id) continue;
    const mb = Math.round((sizes[id] || 0) / 1_048_576);
    if (mb === 0) continue;
    const gpuAvailable = !!catalog[id]?.tiers.some((t) => t.available && t.tier !== 'cpu');
    const usesGpu = device === 'cuda' || (device === 'auto' && gpuAvailable);
    if (usesGpu) vramMb += mb; else ramMb += mb;
  }
  return { vramMb, ramMb };
}

/** A resolved stage as stored after a session — device + the measured footprint
 *  on that device, plus the gate's fallback notice when it was moved off GPU. */
export interface NativeResolved { model: string; device: string; memoryBytes?: number; fallbackReason?: string; }

/** Format a megabyte figure: GB (one decimal) at/over 1024 MB, MB below. */
export function formatMemMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

/** Sum the ACTUAL measured footprint of the resolved stages by their real
 *  device — VRAM for cuda, RAM otherwise. Stages with no measured bytes are
 *  skipped (so a not-yet-measured stage doesn't show a phantom 0). Replaces the
 *  pre-session estimate once a session has resolved. */
export function actualNativeMemoryByDevice(
  ...resolveds: (NativeResolved | null | undefined)[]
): { vramMb: number; ramMb: number } {
  let vramMb = 0;
  let ramMb = 0;
  for (const r of resolveds) {
    if (!r?.memoryBytes) continue;
    const mb = Math.round(r.memoryBytes / 1_048_576);
    if (r.device === 'cpu') ramMb += mb; else vramMb += mb;
  }
  return { vramMb, ramMb };
}

/** Derive the model-card "live" tier badge from a resolved stage: the real tier,
 *  whether it degraded (CPU with a fallback reason — the gate moved it off GPU),
 *  and the measured memory in MB. null when nothing has resolved yet (the card
 *  then shows the catalog capability tier instead). */
export function resolvedTierState(
  resolved: NativeResolved | null | undefined,
): { tier: string; degraded: boolean; memoryMb?: number } | null {
  if (!resolved) return null;
  return {
    tier: resolved.device === 'cpu' ? 'cpu' : `gpu-${resolved.device}`,
    degraded: resolved.device === 'cpu' && !!resolved.fallbackReason,
    memoryMb: resolved.memoryBytes ? Math.round(resolved.memoryBytes / 1_048_576) : undefined,
  };
}

/** Human label for a measured RTF (process-time / audio-seconds): how many times
 *  faster than real-time. rtf 0.015 → "67× realtime". */
export function formatRtf(rtf: number): string {
  if (!(rtf > 0) || !Number.isFinite(rtf)) return 'realtime';
  return `${Math.round(1 / rtf)}× realtime`;
}

/**
 * The per-model status repo overrides: each card's CHOSEN variant repo (pinned,
 * else recommended). Cards without variant data are omitted → the sidecar checks
 * their default repo. Feeds the variant-aware model_status query.
 */
export function statusReposFor(
  ids: string[],
  variantData: Record<string, { variants: VariantInfo[]; recommended: string }>,
  variantByModel: Record<string, string>,
): Record<string, string> {
  const repos: Record<string, string> = {};
  for (const id of ids) {
    const vd = variantData[id];
    if (!vd) continue;
    const chosenId = variantByModel[id] ?? vd.recommended;
    const repo = vd.variants.find((v) => v.id === chosenId)?.repo;
    if (repo) repos[id] = repo;
  }
  return repos;
}

/** Human label for a measured translation throughput. tps 130.5 → "131 tok/s".
 *  Empty string for a non-positive/invalid value (caller omits the metric). */
export function formatTps(tps: number): string {
  if (!(tps > 0) || !Number.isFinite(tps)) return '';
  return `${Math.round(tps)} tok/s`;
}

/** Display label for a hardware tier string from the sidecar models_catalog. */
export function tierLabel(tier: string): { label: string; accel: boolean } {
  switch (tier) {
    case 'cpu': return { label: 'CPU', accel: false };
    case 'gpu-cuda': return { label: 'GPU · CUDA', accel: true };
    case 'gpu-metal': return { label: 'GPU · Metal', accel: true };
    case 'gpu-vulkan': return { label: 'GPU · Vulkan', accel: true };
    case 'gpu-dml': return { label: 'GPU · DirectML', accel: true };
    default: return { label: tier, accel: false };
  }
}

/**
 * A selectable + downloadable model card for the native settings UI.
 * `selectId` is written to localNative.{asr,translation,tts}Model; `downloadId`
 * is the id the sidecar downloads/reports status for (null = nothing to download,
 * e.g. the TTS "Off" option). The two may differ for a card whose download id is
 * not its select id; they're equal for every current model.
 */
export interface NativeModelCardSpec {
  selectId: string;
  downloadId: string | null;
  name: string;
  languages?: string[];
  recommended?: boolean;
  sortOrder?: number;
  note?: string;
  streaming?: boolean;
  clones?: boolean;
}

/** Map a catalog NativeModelInfo entry to a NativeModelCardSpec. */
export function infoToCard(m: NativeModelInfo): NativeModelCardSpec {
  return {
    selectId: m.id, downloadId: m.id, name: m.name, languages: m.languages,
    recommended: m.recommended, sortOrder: m.order,
    streaming: m.streaming, clones: m.clones,
  };
}

/** ASR cards compatible with the source language, recommended/order first. */
export function nativeAsrCards(srcLang: string, catalog: Record<string, NativeModelInfo>): NativeModelCardSpec[] {
  return compatibleNativeAsr(srcLang, catalog).map(infoToCard);
}

/** ASR cards that do NOT support the source language (for the "show all" toggle). */
export function nativeAsrIncompatibleCards(srcLang: string, catalog: Record<string, NativeModelInfo>): NativeModelCardSpec[] {
  return incompatibleNativeAsr(srcLang, catalog).map(infoToCard);
}

export function nativeTranslationCards(src: string, tgt: string, catalog: Record<string, NativeModelInfo>): NativeModelCardSpec[] {
  const wantSrc = canonLang(src);
  const wantTgt = canonLang(tgt);
  const all = catalogModels(catalog, 'translate');
  const multilingual = all.filter((m) => m.languages.includes('multi'));
  const pair = all.filter((m) => {
    const ls = m.languages.map(canonLang);
    return !m.languages.includes('multi') && ls[0] === wantSrc && ls[1] === wantTgt;
  });
  return [...multilingual, ...pair].map(infoToCard);
}

export function nativeTtsCards(tgt: string, catalog: Record<string, NativeModelInfo>): NativeModelCardSpec[] {
  // Voice picker only — there's no "Off" card; text-only is the common textOnly
  // toggle. Languages with no TTS models yield an empty list (the UI shows a
  // "text only" notice).
  return nativeTtsModels(tgt, catalog).map((m, i) => ({
    selectId: m.id, downloadId: m.id, name: m.name, languages: [tgt],
    recommended: i === 0, sortOrder: m.order,
    streaming: m.streaming, clones: m.clones,
  }));
}

/** The per-stage selection (the selectIds written to LocalNativeSettings). */
export interface NativeSelection {
  asrModel: string;
  translationModel: string;
  ttsModel: string;
}

/**
 * Reconcile the native selection for a language pair — the native twin of
 * LOCAL_INFERENCE's `autoSelectModels`. Steps, in order, mirror that logic:
 *   1. recalled history (per-direction) overrides the current choice;
 *   2. each stage is validated — the chosen card must exist for this pair AND
 *      be downloaded (a null downloadId, i.e. TTS Off, counts as downloaded);
 *   3. an invalid choice falls back to the best *downloaded* card, else the
 *      recommended card (translation), else '' (ASR — nothing until downloaded).
 * Returns only the changed fields (null if nothing changed).
 */
export function autoSelectNative(
  src: string,
  tgt: string,
  current: NativeSelection,
  isDownloaded: (downloadId: string | null) => boolean,
  recalled?: Partial<NativeSelection> | null,
  isHardwareGated: (downloadId: string | null) => boolean = () => false,
  catalog: Record<string, NativeModelInfo> = {},
): Partial<NativeSelection> | null {
  let { asrModel, translationModel, ttsModel } = current;
  const input = { asrModel, translationModel, ttsModel };

  // 1. recalled history overrides "current" where present and different
  if (recalled) {
    if (recalled.asrModel != null && recalled.asrModel !== asrModel) asrModel = recalled.asrModel;
    if (recalled.translationModel != null && recalled.translationModel !== translationModel) translationModel = recalled.translationModel;
    if (recalled.ttsModel != null && recalled.ttsModel !== ttsModel) ttsModel = recalled.ttsModel;
  }

  const updates: Partial<NativeSelection> = {};

  // 2+3. ASR — compatible with src (cards are pre-filtered), downloaded, AND runnable
  // on this machine. A GPU-only model on a CPU-only box is hardware-gated; auto-selecting
  // it passes readiness but then resolves to NoUsablePlan and fails at Start, so skip it.
  const asrCards = nativeAsrCards(src, catalog);
  const asrUsable = (c: { downloadId: string | null }) =>
    isDownloaded(c.downloadId) && !isHardwareGated(c.downloadId);
  const curAsr = asrCards.find((c) => c.selectId === asrModel);
  if (!(curAsr && asrUsable(curAsr))) {
    const best = asrCards.find(asrUsable);
    const newId = best?.selectId ?? '';
    if (newId !== asrModel) updates.asrModel = newId;
  }

  // Translation — directional cards; downloaded, else best downloaded, else recommended (Qwen '')
  const trCards = nativeTranslationCards(src, tgt, catalog);
  const curTr = trCards.find((c) => c.selectId === translationModel);
  if (!(curTr && isDownloaded(curTr.downloadId))) {
    const best = trCards.find((c) => isDownloaded(c.downloadId)) ?? trCards.find((c) => c.recommended) ?? trCards[0];
    const newId = best?.selectId ?? '';
    if (newId !== translationModel) updates.translationModel = newId;
  }

  // TTS — optional; '' (Auto) = the default voice for tgt. A specific voice that
  // isn't valid for tgt, or a legacy 'off' (the Off card was removed — text-only
  // is the common textOnly toggle now), resets to Auto.
  if (ttsModel === 'off' || (ttsModel && ttsModel !== '' && !nativeTtsModels(tgt, catalog).some((m) => m.id === ttsModel))) {
    updates.ttsModel = '';
  }

  // Surface recalled values that survived validation (current still holds the old value)
  if (updates.asrModel == null && asrModel !== input.asrModel) updates.asrModel = asrModel;
  if (updates.translationModel == null && translationModel !== input.translationModel) updates.translationModel = translationModel;
  if (updates.ttsModel == null && ttsModel !== input.ttsModel) updates.ttsModel = ttsModel;

  return Object.keys(updates).length > 0 ? updates : null;
}
