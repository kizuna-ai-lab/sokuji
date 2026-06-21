/**
 * Catalog of native (Electron sidecar) models per stage, plus the helpers that
 * turn settings into concrete model ids. Centralized so settings UI + session
 * config share one source of truth. TTS languages are limited to the sherpa
 * piper repos confirmed to exist.
 */
export interface NativeModelOption {
  id: string;
  label: string;
  languages?: string[];
}

export const NATIVE_ASR: NativeModelOption[] = [
  { id: 'sense-voice', label: 'SenseVoice', languages: ['zh', 'en', 'ja', 'ko', 'yue'] },
  { id: 'whisper-tiny', label: 'Whisper tiny', languages: ['multi'] },
  { id: 'whisper-base', label: 'Whisper base', languages: ['multi'] },
  { id: 'whisper-small', label: 'Whisper small', languages: ['multi'] },
];

export const NATIVE_TRANSLATION: NativeModelOption[] = [
  { id: '', label: 'Auto — Qwen LLM (any language)' },
  { id: 'opus-mt', label: 'Opus-MT (fast, when the pair exists)' },
];

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
  asrModel: string, translationChoice: string, ttsChoice: string, src: string, tgt: string
): string[] {
  const ids = [asrModel, resolveNativeTranslation(translationChoice, src, tgt) || 'qwen'];
  const tts = resolveNativeTts(ttsChoice, tgt);
  if (tts) ids.push(tts);
  return ids;
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
  note?: string;
}

export function nativeAsrCards(): NativeModelCardSpec[] {
  return NATIVE_ASR.map((m) => ({ selectId: m.id, downloadId: m.id, name: m.label, languages: m.languages }));
}

export function nativeTranslationCards(src: string, tgt: string): NativeModelCardSpec[] {
  return [
    { selectId: '', downloadId: 'qwen', name: 'Qwen LLM', languages: ['multi'] },
    { selectId: 'opus-mt', downloadId: `Xenova/opus-mt-${src}-${tgt}`, name: 'Opus-MT (fast)', languages: [src, tgt] },
  ];
}

export function nativeTtsCards(tgt: string): NativeModelCardSpec[] {
  const voices: NativeModelCardSpec[] = nativeTtsVoices(tgt).map((v) => ({
    selectId: v.id, downloadId: v.id, name: v.label, languages: [tgt],
  }));
  return [...voices, { selectId: 'off', downloadId: null, name: 'Off', note: 'text only' }];
}
