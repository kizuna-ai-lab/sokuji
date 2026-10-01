/** App codes whose Whisper code differs (Whisper's table has `tl`, not `fil`). */
const WHISPER_CODES: Record<string, string> = { fil: 'tl' };

/**
 * The language to hand transformers.js's Whisper, or undefined to let it
 * detect: its table is two-letter codes (it throws "Language … is not
 * supported" on `yue`, `cantonese`), so only a two-letter base goes, plus
 * `fil` as `tl`.
 */
export function whisperLanguage(code: string | undefined | null): string | undefined {
  if (!code || code === 'auto') return undefined;
  const mapped = WHISPER_CODES[code];
  if (mapped) return mapped;
  const base = code.split(/[-_]/)[0].toLowerCase();
  return /^[a-z]{2}$/.test(base) ? base : undefined;
}
