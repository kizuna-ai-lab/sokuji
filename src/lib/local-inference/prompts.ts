/**
 * Shared prompt builder for local-inference Qwen-family translation workers.
 * Used by the store selector (for UI preview + Simple-mode at runtime) and
 * by the workers as the fallback when the main thread sends an empty system
 * prompt.
 */

export const LANG_NAMES: Record<string, string> = {
  ja: 'Japanese', zh: 'Chinese', en: 'English', ko: 'Korean',
  de: 'German', fr: 'French', es: 'Spanish', ru: 'Russian',
  ar: 'Arabic', pt: 'Portuguese', th: 'Thai', vi: 'Vietnamese',
  id: 'Indonesian', tr: 'Turkish', nl: 'Dutch', pl: 'Polish',
  it: 'Italian', hi: 'Hindi', sv: 'Swedish', da: 'Danish',
  fi: 'Finnish', hu: 'Hungarian', ro: 'Romanian', no: 'Norwegian',
  uk: 'Ukrainian', cs: 'Czech', et: 'Estonian', af: 'Afrikaans',
};

// Native language names reinforce the target language for small models that
// otherwise drift to English output even when asked to translate to other languages.
export const NATIVE_NAMES: Record<string, string> = {
  ja: '日本語', zh: '中文', en: 'English', ko: '한국어',
  de: 'Deutsch', fr: 'Français', es: 'Español', ru: 'Русский',
  ar: 'العربية', pt: 'Português', th: 'ไทย', vi: 'Tiếng Việt',
};

// Filler lists are only included when a language appears on the source or
// target side; putting unrelated scripts (e.g. Japanese fillers for a zh→en
// pair) in the prompt can steer small models toward the wrong language.
export const LANG_FILLERS: Record<string, string[]> = {
  en: ['um', 'uh', 'well', 'like'],
  ja: ['えーと', 'あのー', 'まあ'],
  zh: ['那个', '嗯', '就是'],
  ko: ['음', '그', '저기'],
};

export function buildDefaultLocalPrompt(sourceLang: string, targetLang: string): string {
  const srcName = LANG_NAMES[sourceLang] || sourceLang;
  const tgtName = LANG_NAMES[targetLang] || targetLang;
  const nativeTgt = NATIVE_NAMES[targetLang];
  const tgtLabel = nativeTgt ? `${nativeTgt} (${tgtName})` : tgtName;

  const langs = new Set([sourceLang, targetLang]);
  const fillerSet = new Set<string>();
  for (const l of langs) {
    for (const f of (LANG_FILLERS[l] || [])) fillerSet.add(f);
  }
  if (fillerSet.size === 0) {
    fillerSet.add('um');
    fillerSet.add('uh');
  }
  const fillerList = Array.from(fillerSet).join(', ');

  return (
    `You are a translator. Translate the speech transcript inside <transcript> tags from ${srcName} to ${tgtLabel}.\n` +
    `Drop fillers (${fillerList}). Fix stuttering and repetitions.\n` +
    `Output ONLY the ${tgtLabel} translation. No explanation, no refusal.`
  );
}
