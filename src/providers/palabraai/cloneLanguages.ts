/**
 * What Palabra accepts when making a voice (voice library spec §4): the
 * languages a sample may be in (`SingleVoiceInstantCloneLangCode`, the
 * public OpenAPI document), and the rule a voice's name must meet — Palabra's
 * `^[\w\-. ()]+$`, 3-64 characters, where its server's `\w` is Unicode
 * (measured 2026-11-03: "Teszt hang ő" and "测试 声音" were accepted).
 */

export const PALABRA_CLONE_LANGUAGES: readonly string[] = [
  'ar', 'ar-ae', 'ar-sa', 'az', 'bg', 'cs', 'cy', 'da', 'de', 'el',
  'en', 'en-au', 'en-ca', 'en-gb', 'en-us', 'es', 'es-mx', 'es-co', 'es-ar', 'es-ch',
  'es-la', 'fi', 'fil', 'fr', 'fr-ca', 'he', 'hi', 'hr', 'hu', 'id',
  'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'pt-br', 'ro',
  'ru', 'sk', 'sv', 'ta', 'tr', 'uk', 'vi', 'zh', 'zh-hans', 'zh-hant',
];
const SUPPORTED = new Set(PALABRA_CLONE_LANGUAGES);

/** App codes whose clone code is not their own spelling. */
const ALIASES: Readonly<Record<string, string>> = {
  'zh-tw': 'zh-hant', 'zh-hk': 'zh-hant', 'zh-cn': 'zh-hans', 'zh-sg': 'zh-hans', nb: 'no', nn: 'no', iw: 'he', tl: 'fil',
};

const norm = (code: string) => code.trim().toLowerCase().replace(/_/g, '-');
/** An app or clone code's base language: `es-la` and `es_MX` are both `es`. */
export const baseLanguage = (code: string) => norm(code).split('-')[0];
const base = baseLanguage;

/** The clone code for an app code: its own, an alias, else its base language; null when Palabra clones from none of them. */
export function cloneLanguageFor(appCode: string | null | undefined): string | null {
  if (!appCode) return null;
  const code = norm(appCode);
  const candidates = [code, ALIASES[code], base(code), ALIASES[base(code)]];
  return candidates.find((c): c is string => !!c && SUPPORTED.has(c)) ?? null;
}

/** Clone codes whose meaning a plain canonicalisation would get wrong: Palabra's `es-la` is Latin America, `es-ch` Chile (its built-ins "Spanish LA", "Spanish Chile"). */
const DISPLAY: Readonly<Record<string, string>> = { 'es-la': 'es-419', 'es-ch': 'es-CL' };

/** A clone code as the app's language names read it (`en-us` → `en-US`, `zh-hant` → `zh-Hant`), so the select shows words, not codes. */
export function cloneLanguageDisplayCode(code: string): string {
  if (DISPLAY[code]) return DISPLAY[code];
  try {
    return Intl.getCanonicalLocales(code)[0] ?? code;
  } catch {
    return code;
  }
}

/** Whether a voice's language is the same language as an app code, by base language (`es-la` is Spanish). */
export function sameLanguage(voiceLang: string | null, appCode: string): boolean {
  return !!voiceLang && base(voiceLang) === base(appCode);
}

/** Palabra's name rule, with the Unicode classes its server's `\w` covers. */
export const PALABRA_VOICE_NAME = /^[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\-. ()]{3,64}$/u;
const OUTSIDE = /[^\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\-. ()]/gu;

/** A suggestion Palabra will accept: characters outside the rule dropped, trimmed, at most 64. */
export function cleanVoiceName(raw: string): string {
  return raw.replace(OUTSIDE, '').trim().slice(0, 64).trim();
}
