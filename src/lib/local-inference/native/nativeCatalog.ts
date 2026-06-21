/**
 * Catalog of native (Electron sidecar) models per stage, plus the helpers that
 * turn settings into concrete model ids. Centralized so settings UI + session
 * config share one source of truth. TTS languages are limited to the sherpa
 * piper repos confirmed to exist.
 */
export interface NativeModelOption {
  id: string;
  label: string;
}

export const NATIVE_ASR: NativeModelOption[] = [
  { id: 'sense-voice', label: 'SenseVoice (zh/en/ja/ko/yue)' },
  { id: 'whisper-tiny', label: 'Whisper tiny (multilingual)' },
  { id: 'whisper-base', label: 'Whisper base (multilingual)' },
  { id: 'whisper-small', label: 'Whisper small (multilingual)' },
];

export const NATIVE_TRANSLATION: NativeModelOption[] = [
  { id: '', label: 'Auto — Qwen LLM (any language)' },
  { id: 'opus-mt', label: 'Opus-MT (fast, when the pair exists)' },
];

/** Non-cloning sherpa piper TTS by target language (verified repos). */
const PIPER_BY_LANG: Record<string, string> = {
  en: 'csukuangfj/vits-piper-en_US-amy-low',
  de: 'csukuangfj/vits-piper-de_DE-thorsten-low',
  es: 'csukuangfj/vits-piper-es_ES-davefx-medium',
  fr: 'csukuangfj/vits-piper-fr_FR-siwis-medium',
  it: 'csukuangfj/vits-piper-it_IT-riccardo-x_low',
  ru: 'csukuangfj/vits-piper-ru_RU-denis-medium',
  zh: 'csukuangfj/vits-piper-zh_CN-huayan-medium',
};

/** Pick a default native TTS model for the target language ('' = no speech output). */
export function pickNativeTts(targetLanguage: string): string {
  return PIPER_BY_LANG[targetLanguage] || '';
}

/** Whether a target language has native speech output available. */
export function hasNativeTts(targetLanguage: string): boolean {
  return !!PIPER_BY_LANG[targetLanguage];
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
