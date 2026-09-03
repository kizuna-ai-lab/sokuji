/**
 * Catalog of native (Electron sidecar) models per stage, plus the helpers that
 * turn settings into concrete model ids. Centralized so settings UI + session
 * config share one source of truth.
 */
import type { NativeModelInfo, NativeVoiceInfo } from './nativeProtocol';
import type { ResolutionNote, Selections } from '../selection/types';

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
  jap: 'ja',
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

export type VoiceBuiltin = 'none' | 'named';
export type VoiceCustom = 'none' | 'clip';
export interface VoiceCapability { builtin: VoiceBuiltin; custom: VoiceCustom; transcriptRequired?: boolean; }

/** A TTS model's voice capability: which built-in voice control it exposes
 *  (none/named) and which custom-voice mechanism it supports (none/clip
 *  clone). Reads the sidecar-reported `voice` field when present; otherwise
 *  derives a safe approximation from `clones`. The old range/style axes (a
 *  sid-range slider, Supertonic's uploaded style-vector JSON) died with the
 *  ONNX backends that were their only producers (Task 5's catalog rewire
 *  onto native_tts) — the `numSpeakers` field they relied on is gone from
 *  the model info entirely, so there is nothing to read here. */
export function voiceCapability(model: NativeModelInfo | undefined): VoiceCapability {
  if (model?.voice) return model.voice;
  const custom: VoiceCustom = model?.clones ? 'clip' : 'none';
  const builtin: VoiceBuiltin = model?.clones ? 'named' : 'none';
  return { builtin, custom };
}

/** True when a TTS model can ONLY speak via a cloned voice — no built-in voice
 *  exists at all (the sidecar's R16 `_VOICE_REQUIRED_FAMILIES`, e.g. qwen3_tts,
 *  omnivoice). Such a model produces no audio until the user records/imports at
 *  least one usable clip; pairs with an eligible-clip count (respecting
 *  `transcriptRequired` — a clip with no transcript doesn't count for a model
 *  that needs one) to decide whether that clip actually exists yet. */
export function isCloneOnlyVoice(capability: VoiceCapability): boolean {
  return capability.builtin === 'none' && capability.custom === 'clip';
}

/** The clips that actually count as a usable clone source, given
 *  `transcriptRequired`: a clip with no transcript doesn't count for a model
 *  that needs one. One predicate shared by the pre-init voice-required gate,
 *  the voice-selection reconciliation, and the picker UI, so "eligible" means
 *  the same thing everywhere a stored selection or clip count is decided —
 *  computing it separately at each call site is how a stale/ineligible clip
 *  (no transcript) can slip past a gate that only checked a DIFFERENT clip's
 *  eligibility and get applied anyway. */
export function eligibleCustomVoices<T extends { hasTranscript?: boolean }>(
  clips: T[], transcriptRequired?: boolean,
): T[] {
  return transcriptRequired ? clips.filter((v) => v.hasTranscript) : clips;
}

/** TTS models supporting the target language, recommended+order first. */
export function nativeTtsModels(tgt: string, catalog: Record<string, NativeModelInfo>): NativeModelInfo[] {
  return catalogModels(catalog, 'tts').filter((m) => supportsLanguage(m, tgt));
}

/** The per-language default built-in voice ('' when the list is empty). Reads the
 *  sidecar descriptor flagged `default` for the target language; else the first
 *  curated voice; else any descriptor flagged `default` regardless of language
 *  (covers models whose voices aren't per-language, e.g. Supertonic presets);
 *  else ''. */
export function defaultTtsVoice(targetLanguage: string, voices: NativeVoiceInfo[]): string {
  const want = canonLang(targetLanguage);
  const def = voices.find((v) => v.default && v.language && canonLang(v.language) === want);
  if (def) return `builtin:${def.name}`;
  // Language-agnostic voice sets (e.g. Supertonic presets, language:null) mark one
  // preset as the default; honor it before falling back to first-curated. MOSS-safe:
  // MOSS defaults always carry a language, so this never matches a MOSS voice.
  const langlessDefault = voices.find((v) => v.default && !v.language);
  if (langlessDefault) return `builtin:${langlessDefault.name}`;
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
 * No substitution: '' now means "resolution found nothing", and the Start gate
 * must see that rather than a model nobody chose.
 */
export function requiredNativeModels(
  asrModel: string, translationChoice: string, ttsChoice: string, _src: string, tgt: string,
  catalog: Record<string, NativeModelInfo>, textOnly = false,
): string[] {
  const ids = [asrModel, resolveNativeTranslation(translationChoice)]
    .filter((id): id is string => Boolean(id));
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
 *  available). TTS has no device override, so callers pass 'cpu'. 'gpu' is the
 *  pre-rename value ('gpu' is current) — kept accepted here defensively so a
 *  caller holding a stale value still counts it as VRAM instead of RAM. */
export interface NativeMemoryStage { id?: string | null; device: 'auto' | 'cpu' | 'gpu'; }

/**
 * Split the active native models into VRAM vs RAM, mirroring LOCAL_INFERENCE's
 * `estimateModelMemoryByDevice`: same "footprint ≈ on-disk size" heuristic, but
 * the GPU/CPU split comes from the per-stage device override and the sidecar's
 * tier availability instead of a static manifest flag.
 *
 * A stage counts toward VRAM when the user forced `gpu` (or the legacy
 * `gpu`), OR left it on `auto`
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
    const usesGpu = device === 'gpu' || (device === 'auto' && gpuAvailable);
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
 *  device — VRAM for an accelerator device, RAM otherwise. Stages with no measured bytes are
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
  // Structural minimum — only id/repo are read, so both the settings-store's
  // slim {id, repo} maps and full VariantInfo[] ladders satisfy it.
  variantData: Record<string, { variants: { id: string; repo: string }[]; recommended: string }>,
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

/** One row of the model-card backend/device tooltip. `key` selects the localized
 *  label in the component; `warn` marks the degraded/fallback row. */
export type BackendTooltipRow = { key: string; value: string; warn?: boolean };

const FRAMEWORK_LABELS: Record<string, string> = {
  transcribe_cpp: 'transcribe.cpp',
  transcribe_cpp_stream: 'transcribe.cpp',
  native_translate: 'llama.cpp',
  native_tts: 'audio.cpp',
};

/** Engine/library label for a sidecar backend id. Falls back by prefix so a new
 *  transcribe_cpp_X id still resolves, else echoes the raw id. The old
 *  `X_onnx` → 'ONNXRuntime' fallback died with the ONNX backends themselves
 *  (slice 5) — no backend id ends in `_onnx` anymore. */
export function frameworkLabel(backendId: string): string {
  if (FRAMEWORK_LABELS[backendId]) return FRAMEWORK_LABELS[backendId];
  if (backendId.startsWith('transcribe_cpp')) return 'transcribe.cpp';
  return backendId;
}

/** Hardware acceleration API for a GPU tier; null for cpu/unknown (no API row).
 *  gpu-cuda/gpu-dml died with the ONNX/MLX TTS backends that were their last
 *  catalog producers (slice 4 — R4): every sidecar tier is now cpu/gpu-metal/
 *  gpu-vulkan. */
export function accelApiLabel(tier: string): string | null {
  switch (tier) {
    case 'gpu-metal': return 'Metal';
    case 'gpu-vulkan': return 'Vulkan';
    default: return null;
  }
}

/** Ordered rows for the tier-badge tooltip. `resolved` present = model loaded
 *  (adds precision/speed/memory/fallback); null/undefined = idle catalog view. */
export function buildBackendTooltipRows(input: {
  tier: string;
  backendId?: string;
  resolved?: { computeType?: string; rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null;
  sizeMb?: number | null;
  repo?: string;
}): BackendTooltipRow[] {
  const { tier, backendId, resolved, sizeMb, repo } = input;
  const rows: BackendTooltipRow[] = [];
  if (backendId) rows.push({ key: 'framework', value: frameworkLabel(backendId) });
  rows.push({ key: 'device', value: tier === 'cpu' ? 'CPU' : 'GPU' });
  const api = accelApiLabel(tier);
  if (api) rows.push({ key: 'api', value: api });
  if (resolved?.computeType) rows.push({ key: 'precision', value: resolved.computeType.toUpperCase() });
  if (resolved) {
    // Guard rtf like tokensPerSec: a zero/unmeasured rtf is omitted rather than
    // shown as a degenerate "realtime" row (formatRtf already floors non-positive
    // rtf to 'realtime', so this is symmetry, not a divide-by-zero fix).
    if (resolved.rtf) rows.push({ key: 'speed', value: formatRtf(resolved.rtf) });
    else if (resolved.tokensPerSec !== undefined) {
      const tps = formatTps(resolved.tokensPerSec);
      if (tps) rows.push({ key: 'speed', value: tps });
    }
  }
  if (resolved?.memoryBytes) rows.push({ key: 'memory', value: formatMemMb(Math.round(resolved.memoryBytes / 1_048_576)) });
  if (sizeMb != null) rows.push({ key: 'size', value: formatMemMb(sizeMb) });
  // The #287 MLX repo-hiding guard (`repo && !(backendId && frameworkLabel(backendId)
  // === 'MLX')`) died with the ONNX/MLX TTS backends that were its only possible
  // match (Task 5's catalog rewire onto native_tts; frameworkLabel can no longer
  // produce 'MLX') — removed in slice 5 rather than left as dead code. The repo
  // row now shows unconditionally.
  if (repo) rows.push({ key: 'repo', value: repo });
  if (resolved?.fallbackReason) rows.push({ key: 'fallback', value: resolved.fallbackReason, warn: true });
  return rows;
}

/** Display label for a hardware tier string from the sidecar models_catalog.
 *  gpu-cuda/gpu-dml died with the ONNX/MLX TTS backends that were their last
 *  catalog producers (slice 4 — R4). */
export function tierLabel(tier: string): { label: string; accel: boolean } {
  switch (tier) {
    case 'cpu': return { label: 'CPU', accel: false };
    case 'gpu-metal': return { label: 'GPU · Metal', accel: true };
    case 'gpu-vulkan': return { label: 'GPU · Vulkan', accel: true };
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
  variantIds?: string[];
  license?: { spdx: string; name: string; url: string; nonCommercial: boolean; sourceRepo: string; attribution: string };
}

/** Map a catalog NativeModelInfo entry to a NativeModelCardSpec. */
export function infoToCard(m: NativeModelInfo): NativeModelCardSpec {
  return {
    selectId: m.id, downloadId: m.id, name: m.name, languages: m.languages,
    recommended: m.recommended, sortOrder: m.order,
    streaming: m.streaming, clones: m.clones, variantIds: m.variantIds,
    license: m.license,
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
    // Full language list, like ASR/translate cards — not just the selected target.
    selectId: m.id, downloadId: m.id, name: m.name, languages: m.languages,
    recommended: i === 0, sortOrder: m.order,
    streaming: m.streaming, clones: m.clones,
  }));
}

/** Why a LOCAL_NATIVE selection is / isn't session-ready. `settingsStore` maps
 * each reason to a user-facing message; the store never owns i18n strings. */
export type NativeReadinessReason =
  | 'ready'
  | 'not-electron'
  | 'engine-mismatch'
  | 'engine-absent'
  | 'unavailable'
  | 'starting'
  | 'asr-incompatible'
  | 'translation-incompatible';

/** The selection fields readiness depends on. The three per-stage model ids and
 *  the variant-pin map used to live here too (a structural subset of
 *  LocalNativeSettings) — now that both are folded into `selections`, resolved
 *  through the model store's `resolve()` against the language pair below,
 *  there is nothing left to read off the flat settings shape. */
export interface NativeReadinessSelection {
  sourceLanguage: string;
  targetLanguage: string;
}

/** Everything readiness reads out of settings, resolved in one go. Handed to the
 * facade as a thunk rather than a value: a cold sidecar start is slow, and the
 * user can change the pair / text-only while it runs, so the verdict must be
 * computed from the selection as of AFTER warmup — not a call-site snapshot. */
export interface NativeReadinessInput {
  selection: NativeReadinessSelection;
  textOnly: boolean;
}

export interface NativeReadinessResult {
  ready: boolean;
  reason: NativeReadinessReason;
  /**
   * Every stage note the speaker AND participant direction resolutions
   * produced (blocking or not), for the UI to render in place of the generic
   * `localNativeModelsRequired`-family strings. Empty before the sidecar has
   * warmed up far enough to resolve anything (`reason` is one of
   * 'not-electron' / 'engine-mismatch' / 'engine-absent' / 'unavailable' /
   * 'starting') — there is nothing to resolve yet at that point.
   */
  notes: ResolutionNote[];
}

/**
 * Collect every explicit (modelId, variant) pin recorded across the given
 * directions, keyed by model id — the shape {@link deriveVariantRepos}/
 * `statusReposFor` expect. Replaces the old global, misnamed
 * `translationVariantByModel` map: a pin is now scoped to the (direction,
 * stage) that carries it, so this walks exactly the directions the caller
 * cares about (never ALL of `selections` unless the caller passes every key)
 * rather than assuming one pin applies everywhere. A stage only contributes
 * when its choice is BOTH explicit (non-empty modelId) and carries a variant
 * — an auto stage's variant is always absent by the `StageSelection`
 * contract, so there is nothing to collect there.
 *
 * Collision rule: FIRST wins. Two directions can independently pin the same
 * model id to different variants (e.g. the speaker leg pins Q4_K_M, the
 * participant leg pins Q8_0 for the same translation model) — the sidecar's
 * status/repo protocol is keyed by model id alone, not by (direction, model
 * id), so only one pin can actually apply. Callers list the speaker
 * direction first specifically so the audible channel's pin wins over the
 * silent (participant, text-only) one when both exist. True per-direction
 * variant statuses would remove this collision entirely; that is a
 * structural follow-up, not fixed here.
 */
export function pinsFromSelections(selections: Selections, directions: string[]): Record<string, string> {
  const pins: Record<string, string> = {};
  for (const dir of directions) {
    const d = selections[dir];
    if (!d) continue;
    for (const stage of ['asr', 'translation', 'tts'] as const) {
      const sel = d[stage];
      if (sel?.modelId && sel.variant && !(sel.modelId in pins)) pins[sel.modelId] = sel.variant;
    }
  }
  return pins;
}

