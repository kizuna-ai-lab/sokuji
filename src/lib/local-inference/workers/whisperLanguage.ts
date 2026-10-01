import { WHISPER_LANGUAGES } from '../languageSupport';

/** App codes whose Whisper code differs: Whisper's table spells Filipino `tl` and Javanese `jw`. */
const WHISPER_CODES: Record<string, string> = { fil: 'tl', jv: 'jw' };

/**
 * The language to hand transformers.js's Whisper, or undefined to let it
 * detect. It throws "Language … is not supported" on a code its table lacks,
 * so only a base language Whisper knows goes (`WHISPER_LANGUAGES`, in app
 * codes), spelled as Whisper spells it.
 */
export function whisperLanguage(code: string | undefined | null): string | undefined {
  if (!code || code === 'auto') return undefined;
  const base = code.split(/[-_]/)[0].toLowerCase();
  if (!WHISPER_LANGUAGES.includes(base)) return undefined;
  return WHISPER_CODES[base] ?? base;
}
