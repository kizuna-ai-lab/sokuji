/**
 * Catalog of native (Electron sidecar) models per stage, plus the helpers that
 * turn settings into concrete model ids. Centralized so settings UI + session
 * config share one source of truth. TTS languages are limited to the sherpa
 * piper repos confirmed to exist.
 */
import type { NativeModelInfo } from './nativeProtocol';
export interface NativeModelOption {
  id: string;
  label: string;
  /** Supported languages; `['multi']` means any language. */
  languages?: string[];
  recommended?: boolean;
  sortOrder?: number;
}

/** `['multi']` matches any language; otherwise the language must be listed. */
export function supportsLanguage(opt: { languages?: string[] }, lang: string): boolean {
  return !!opt.languages && (opt.languages.includes('multi') || opt.languages.includes(lang));
}

export const NATIVE_ASR: NativeModelOption[] = [
  { id: 'cohere-transcribe-03-2026', label: 'Cohere Transcribe', languages: ['en', 'de', 'fr', 'it', 'es', 'pt', 'el', 'nl', 'pl', 'ar', 'vi', 'zh', 'ja', 'ko'], recommended: true, sortOrder: 0 },
  { id: 'sense-voice', label: 'SenseVoice', languages: ['zh', 'en', 'ja', 'ko', 'yue'], recommended: true, sortOrder: 1 },
  { id: 'whisper-base', label: 'Whisper base', languages: ['multi'], recommended: true, sortOrder: 2 },
  { id: 'whisper-small', label: 'Whisper small', languages: ['multi'], sortOrder: 3 },
  { id: 'whisper-tiny', label: 'Whisper tiny', languages: ['multi'], sortOrder: 4 },
  { id: 'whisper-large-v3', label: 'Whisper large-v3', languages: ['multi'], sortOrder: 5 },
  { id: 'granite-speech-4.1-2b', label: 'Granite Speech 4.1 (2B)', languages: ['en', 'fr', 'de', 'es', 'pt', 'ja'], sortOrder: 6 },
  { id: 'granite-speech-4.1-2b-plus', label: 'Granite Speech 4.1 (2B+)', languages: ['en', 'fr', 'de', 'es', 'pt'], sortOrder: 7 },
  { id: 'qwen3-asr-1.7b', label: 'Qwen3-ASR 1.7B', languages: ['zh', 'en', 'ja', 'ko', 'yue', 'ar', 'de', 'es', 'fr', 'it', 'pt', 'ru', 'th', 'vi', 'hi', 'id'], recommended: true, sortOrder: 8 },
];

export const NATIVE_TRANSLATION: NativeModelOption[] = [
  { id: '', label: 'Qwen LLM', languages: ['multi'], recommended: true, sortOrder: 0 },
  { id: 'opus-mt', label: 'Opus-MT (fast)', sortOrder: 1 },
];

/** recommended-first, then sortOrder. Shared by the compatible/incompatible splits. */
function byRecommendedThenOrder(a: NativeModelOption, b: NativeModelOption): number {
  return Number(!!b.recommended) - Number(!!a.recommended) || (a.sortOrder ?? 99) - (b.sortOrder ?? 99);
}

/** ASR models that support the source language, recommended/sortOrder first. */
export function compatibleNativeAsr(srcLang: string): NativeModelOption[] {
  return NATIVE_ASR.filter((m) => supportsLanguage(m, srcLang)).sort(byRecommendedThenOrder);
}

/** ASR models that do NOT support the source language (shown behind a "show all" toggle). */
export function incompatibleNativeAsr(srcLang: string): NativeModelOption[] {
  return NATIVE_ASR.filter((m) => !supportsLanguage(m, srcLang)).sort(byRecommendedThenOrder);
}

/** Auto-select an ASR model for the source language: keep current if it still
 *  supports the language, else the best (recommended) compatible model. */
export function nativeAsrForLanguage(srcLang: string, current: string): string {
  const cur = NATIVE_ASR.find((m) => m.id === current);
  if (cur && supportsLanguage(cur, srcLang)) return current;
  return compatibleNativeAsr(srcLang)[0]?.id || current;
}

/**
 * Non-cloning sherpa piper TTS voices by target language. Every repo here was
 * existence + layout verified. The first entry per language is the default
 * (used when the TTS choice is Auto). `off` and `''`(Auto) are added by the UI.
 */
export const NATIVE_TTS_BY_LANG: Record<string, NativeModelOption[]> = {
  en: [
    { id: 'csukuangfj/vits-piper-en_US-amy-low', label: 'Amy (US)' },
    { id: 'csukuangfj/vits-piper-en_US-libritts_r-medium', label: 'LibriTTS (US)' },
    { id: 'csukuangfj/vits-piper-en_US-ryan-low', label: 'Ryan (US)' },
    { id: 'csukuangfj/vits-piper-en_US-lessac-medium', label: 'Lessac (US)' },
    { id: 'csukuangfj/vits-piper-en_GB-alan-low', label: 'Alan (GB)' },
  ],
  de: [
    { id: 'csukuangfj/vits-piper-de_DE-thorsten-low', label: 'Thorsten' },
    { id: 'csukuangfj/vits-piper-de_DE-eva_k-x_low', label: 'Eva K' },
    { id: 'csukuangfj/vits-piper-de_DE-kerstin-low', label: 'Kerstin' },
  ],
  es: [
    { id: 'csukuangfj/vits-piper-es_ES-davefx-medium', label: 'DaveFX (ES)' },
    { id: 'csukuangfj/vits-piper-es_ES-carlfm-x_low', label: 'CarlFM (ES)' },
    { id: 'csukuangfj/vits-piper-es_MX-ald-medium', label: 'Ald (MX)' },
  ],
  fr: [
    { id: 'csukuangfj/vits-piper-fr_FR-siwis-medium', label: 'Siwis' },
    { id: 'csukuangfj/vits-piper-fr_FR-gilles-low', label: 'Gilles' },
    { id: 'csukuangfj/vits-piper-fr_FR-tom-medium', label: 'Tom' },
  ],
  it: [
    { id: 'csukuangfj/vits-piper-it_IT-riccardo-x_low', label: 'Riccardo' },
    { id: 'csukuangfj/vits-piper-it_IT-paola-medium', label: 'Paola' },
  ],
  ru: [
    { id: 'csukuangfj/vits-piper-ru_RU-denis-medium', label: 'Denis' },
    { id: 'csukuangfj/vits-piper-ru_RU-irina-medium', label: 'Irina' },
    { id: 'csukuangfj/vits-piper-ru_RU-dmitri-medium', label: 'Dmitri' },
  ],
  zh: [
    { id: 'csukuangfj/vits-piper-zh_CN-huayan-medium', label: 'Huayan' },
  ],
};

/** Voice options for a target language (empty = no native voice → text only). */
export function nativeTtsVoices(targetLanguage: string): NativeModelOption[] {
  return NATIVE_TTS_BY_LANG[targetLanguage] || [];
}

/** Default native TTS model for the target language ('' = no speech output). */
export function pickNativeTts(targetLanguage: string): string {
  return NATIVE_TTS_BY_LANG[targetLanguage]?.[0]?.id || '';
}

/** Whether a target language has native speech output available. */
export function hasNativeTts(targetLanguage: string): boolean {
  return nativeTtsVoices(targetLanguage).length > 0;
}

/**
 * Resolve the TTS model id from the settings choice + target language:
 *  - 'off'                 -> undefined (text only)
 *  - a voice valid for tgt -> that voice
 *  - '' or a stale voice   -> the default voice for tgt (Auto), or undefined
 */
export function resolveNativeTts(choice: string, targetLanguage: string): string | undefined {
  if (choice === 'off') return undefined;
  if (choice && nativeTtsVoices(targetLanguage).some((o) => o.id === choice)) return choice;
  return pickNativeTts(targetLanguage) || undefined;
}

/**
 * Resolve the translation model id from the settings choice:
 *  - 'opus-mt'  -> Xenova/opus-mt-<src>-<tgt> (onnxruntime, torch-free)
 *  - ''         -> undefined (sidecar defaults to the Qwen LLM)
 */
export function resolveNativeTranslation(choice: string, src: string, tgt: string): string | undefined {
  if (choice === 'opus-mt') return `Xenova/opus-mt-${src}-${tgt}`;
  return choice || undefined;
}

/**
 * The native model ids a given config requires (for download/readiness). Always
 * an ASR model + a translation model (Qwen LLM default), plus a TTS model when
 * speech output is on. '' translation resolves to the 'qwen' download id.
 */
export function requiredNativeModels(
  asrModel: string, translationChoice: string, ttsChoice: string, src: string, tgt: string,
  textOnly = false
): string[] {
  const ids = [asrModel, resolveNativeTranslation(translationChoice, src, tgt) || 'qwen'];
  // TTS is only required when speech output is on (text-only skips it entirely).
  if (!textOnly) {
    const tts = resolveNativeTts(ttsChoice, tgt);
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

/** Human label for a measured RTF (process-time / audio-seconds): how many times
 *  faster than real-time. rtf 0.015 → "67× realtime". */
export function formatRtf(rtf: number): string {
  if (!(rtf > 0) || !Number.isFinite(rtf)) return 'realtime';
  return `${Math.round(1 / rtf)}× realtime`;
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
 * e.g. the TTS "Off" option). The two differ for choices like Opus-MT (selectId
 * 'opus-mt' → downloadId is the pair-specific repo).
 */
export interface NativeModelCardSpec {
  selectId: string;
  downloadId: string | null;
  name: string;
  languages?: string[];
  recommended?: boolean;
  sortOrder?: number;
  note?: string;
}

function asrToCard(m: NativeModelOption): NativeModelCardSpec {
  return {
    selectId: m.id, downloadId: m.id, name: m.label, languages: m.languages,
    recommended: m.recommended, sortOrder: m.sortOrder,
  };
}

/** ASR cards compatible with the source language, recommended/sortOrder ordered. */
export function nativeAsrCards(srcLang: string): NativeModelCardSpec[] {
  return compatibleNativeAsr(srcLang).map(asrToCard);
}

/** ASR cards that do NOT support the source language (for the "show all" toggle). */
export function nativeAsrIncompatibleCards(srcLang: string): NativeModelCardSpec[] {
  return incompatibleNativeAsr(srcLang).map(asrToCard);
}

export function nativeTranslationCards(src: string, tgt: string): NativeModelCardSpec[] {
  return [
    { selectId: '', downloadId: 'qwen', name: 'Qwen LLM', languages: ['multi'], recommended: true, sortOrder: 0 },
    { selectId: 'opus-mt', downloadId: `Xenova/opus-mt-${src}-${tgt}`, name: 'Opus-MT (fast)', languages: [src, tgt], sortOrder: 1 },
  ];
}

export function nativeTtsCards(tgt: string): NativeModelCardSpec[] {
  // Voice picker only — there's no "Off" card; text-only is the common textOnly
  // toggle. Languages without a piper voice simply yield an empty list (the UI
  // shows a "text only" notice).
  return nativeTtsVoices(tgt).map((v, i) => ({
    selectId: v.id, downloadId: v.id, name: v.label, languages: [tgt],
    recommended: i === 0, sortOrder: i,
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
 *
 * Directionality: `nativeTranslationCards(src, tgt)` builds opus-mt's downloadId
 * as `Xenova/opus-mt-${src}-${tgt}`, so after a src↔tgt swap the *reverse* repo's
 * download state is what gets validated — a model downloaded only one way is
 * correctly treated as absent for the other direction.
 */
export function autoSelectNative(
  src: string,
  tgt: string,
  current: NativeSelection,
  isDownloaded: (downloadId: string | null) => boolean,
  recalled?: Partial<NativeSelection> | null,
  isHardwareGated: (downloadId: string | null) => boolean = () => false,
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
  const asrCards = nativeAsrCards(src);
  const asrUsable = (c: { downloadId: string | null }) =>
    isDownloaded(c.downloadId) && !isHardwareGated(c.downloadId);
  const curAsr = asrCards.find((c) => c.selectId === asrModel);
  if (!(curAsr && asrUsable(curAsr))) {
    const best = asrCards.find(asrUsable);
    const newId = best?.selectId ?? '';
    if (newId !== asrModel) updates.asrModel = newId;
  }

  // Translation — directional cards; downloaded, else best downloaded, else recommended (Qwen '')
  const trCards = nativeTranslationCards(src, tgt);
  const curTr = trCards.find((c) => c.selectId === translationModel);
  if (!(curTr && isDownloaded(curTr.downloadId))) {
    const best = trCards.find((c) => isDownloaded(c.downloadId)) ?? trCards.find((c) => c.recommended) ?? trCards[0];
    const newId = best?.selectId ?? '';
    if (newId !== translationModel) updates.translationModel = newId;
  }

  // TTS — optional; '' (Auto) = the default voice for tgt. A specific voice that
  // isn't valid for tgt, or a legacy 'off' (the Off card was removed — text-only
  // is the common textOnly toggle now), resets to Auto.
  if (ttsModel === 'off' || (ttsModel && ttsModel !== '' && !nativeTtsVoices(tgt).some((v) => v.id === ttsModel))) {
    updates.ttsModel = '';
  }

  // Surface recalled values that survived validation (current still holds the old value)
  if (updates.asrModel == null && asrModel !== input.asrModel) updates.asrModel = asrModel;
  if (updates.translationModel == null && translationModel !== input.translationModel) updates.translationModel = translationModel;
  if (updates.ttsModel == null && ttsModel !== input.ttsModel) updates.ttsModel = ttsModel;

  return Object.keys(updates).length > 0 ? updates : null;
}
