/**
 * The one language code the app uses outside a provider (spec
 * `2026-10-01-unified-language-codes-design.md` §1): a canonical BCP-47 tag
 * (`zh-Hant`, `zh-TW`, `yue`, `pt-BR`, `mul`), `auto`, or `a+b` for a
 * bidirectional pair. The two extensions cannot be BCP-47 tags: a
 * four-letter primary subtag is reserved, and `+` is not a BCP-47 character.
 */
export type LanguageCode = string;

/** The source value that asks the provider to detect the language. Never a target. */
export const AUTO = 'auto';

export type ParsedCode =
  | { kind: 'auto' }
  | { kind: 'tag'; tag: string }
  | { kind: 'pair'; a: string; b: string };

/** A primary subtag of 2–3 letters, then any well-formed subtags; the rest is Intl's to judge. */
const TAG_SHAPE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

function canonical(tag: string): string | null {
  if (!TAG_SHAPE.test(tag)) return null;
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

/** Intl's canonical spelling of a BCP-47 tag, aliases replaced (`tl` → `fil`). For building tables and tests, never for reading a vendor's code. */
export function canonicalTag(tag: string): string {
  const c = canonical(tag);
  if (c === null) throw new RangeError(`Not a BCP-47 language tag: "${tag}"`);
  return c;
}

/** The code's form, or null when it is not written exactly as an app code. */
export function parseCode(code: string): ParsedCode | null {
  if (code === AUTO) return { kind: 'auto' };
  const parts = code.split('+');
  if (parts.length === 2) {
    const [a, b] = parts;
    return canonical(a) === a && canonical(b) === b ? { kind: 'pair', a, b } : null;
  }
  if (parts.length !== 1) return null;
  return canonical(code) === code ? { kind: 'tag', tag: code } : null;
}

/** A bidirectional pair's code. */
export function pairCode(a: string, b: string): LanguageCode {
  return `${a}+${b}`;
}

/** The primary language subtag (`zh-Hant-TW` → `zh`); `auto` for `auto`; null for a pair or a code that is not an app code. */
export function baseLanguage(code: LanguageCode): string | null {
  const parsed = parseCode(code);
  if (parsed === null || parsed.kind === 'pair') return null;
  if (parsed.kind === 'auto') return AUTO;
  return parsed.tag.split('-')[0];
}
