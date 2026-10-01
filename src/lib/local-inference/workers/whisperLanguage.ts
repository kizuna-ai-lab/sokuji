/**
 * The language to hand transformers.js's Whisper, or undefined to let it
 * detect: its table is two-letter codes (it throws "Language … is not
 * supported" on `yue`, `cantonese`, `fil`), so only a two-letter base goes.
 */
export function whisperLanguage(code: string | undefined | null): string | undefined {
  if (!code || code === 'auto') return undefined;
  const base = code.split(/[-_]/)[0].toLowerCase();
  return /^[a-z]{2}$/.test(base) ? base : undefined;
}
