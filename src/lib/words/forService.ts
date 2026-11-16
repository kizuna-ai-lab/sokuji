// src/lib/words/forService.ts
//
// What each service gets of the word list (spec §9): only the columns it has a field for — written forms as terms or
// hot words, translations as its glossary, "often heard as" as its corrections, the session background as its
// context — the first entries up to its limit, and how many were left out, for its stage to say so. A service with
// no field gets nothing in this version.
import type { WordEntry } from './list';

export interface ServiceWords {
  terms?: string[];
  /** [written, translation]. */
  translations?: Array<[string, string]>;
  /** [heard as, written]. */
  heardAs?: Array<[string, string]>;
  background?: string;
  /** Entries not sent: over the service's limit. */
  leftOut: number;
}

type Column = 'terms' | 'translations' | 'heardAs' | 'background';

/** The columns each service has a field for, and how many entries it takes (from the services' documents). */
export const WORD_LIMITS: Record<string, { columns: readonly Column[]; entries: number; items?: number }> = {
  // Terms, translations and background share one context of about 8,000 tokens: kept under SONIOX_CONTEXT_CHARS.
  soniox: { columns: ['terms', 'translations', 'background'], entries: Number.POSITIVE_INFINITY },
  // Transcription keywords, and the background as the transcription prompt.
  openai: { columns: ['terms', 'background'], entries: 1000 },
  qwen_livetranslate: { columns: ['translations'], entries: 1000 },
  // Hot words, glossary entries and corrections: at most 1,000 of them together.
  volcengine_ast2: { columns: ['terms', 'translations', 'heardAs'], entries: Number.POSITIVE_INFINITY, items: 1000 },
  gemini: { columns: ['terms'], entries: 1000 },
  // This device's translation: the words and the background go into its prompt, which a small model reads.
  local_inference: { columns: ['terms', 'translations', 'background'], entries: 100 },
};

/** The service a provider in the line-up sends the word list to: Kizuna AI's twins use their base's. */
export function wordServiceOf(providerId: string | null | undefined): string | null {
  if (!providerId) return null;
  const twin: Record<string, string> = { kizunaai_soniox: 'soniox', kizunaai_qwen: 'qwen_livetranslate' };
  return twin[providerId] ?? providerId;
}

/**
 * Soniox refuses a session whose serialized context is over 10,000 characters ("Context is too long"); the context is
 * kept under this, with room for the JSON around it that Soniox counts.
 */
export const SONIOX_CONTEXT_CHARS = 9000;

/** The size of Soniox's context as sent. */
export function sonioxContextSize(w: Pick<ServiceWords, 'terms' | 'translations' | 'background'>): number {
  return JSON.stringify({
    ...(w.terms?.length ? { terms: w.terms } : {}),
    ...(w.translations?.length ? { translation_terms: w.translations.map(([source, target]) => ({ source, target })) } : {}),
    ...(w.background ? { text: w.background } : {}),
  }).length;
}

function mapped(columns: readonly Column[], entries: readonly WordEntry[], background: string): Omit<ServiceWords, 'leftOut'> {
  const out: Omit<ServiceWords, 'leftOut'> = {};
  if (columns.includes('terms') && entries.length > 0) out.terms = entries.map((e) => e.written);
  if (columns.includes('translations')) {
    const t = entries.filter((e) => e.translation).map((e): [string, string] => [e.written, e.translation!]);
    if (t.length > 0) out.translations = t;
  }
  if (columns.includes('heardAs')) {
    const h = entries.flatMap((e) => (e.heardAs ? e.heardAs.split(',').map((x) => x.trim()).filter(Boolean).map((x): [string, string] => [x, e.written]) : []));
    if (h.length > 0) out.heardAs = h;
  }
  if (columns.includes('background') && background) out.background = background;
  return out;
}

export function wordsFor(service: string, entries: readonly WordEntry[], background: string): ServiceWords {
  const limit = WORD_LIMITS[service];
  if (!limit) return { leftOut: 0 };
  const text = background.trim();
  let kept = entries.slice(0, limit.entries);
  if (limit.items !== undefined) {
    // Entries while what they make (a term, a translation, each "heard as") fits the service's count.
    let items = 0;
    let n = 0;
    for (const e of kept) {
      const one = mapped(limit.columns, [e], '');
      const count = (one.terms?.length ?? 0) + (one.translations?.length ?? 0) + (one.heardAs?.length ?? 0);
      if (items + count > limit.items) break;
      items += count;
      n += 1;
    }
    kept = kept.slice(0, n);
  }
  let words = mapped(limit.columns, kept, text);
  if (service === 'soniox' && sonioxContextSize(words) > SONIOX_CONTEXT_CHARS) {
    // The background is the weakest hint: it is cut first, to the longest start whose escaped size fits (newlines and
    // quotes take two characters or more), never inside a surrogate pair; then entries go from the end.
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (sonioxContextSize(mapped(limit.columns, kept, text.slice(0, mid))) <= SONIOX_CONTEXT_CHARS) lo = mid;
      else hi = mid - 1;
    }
    words = mapped(limit.columns, kept, text.slice(0, lo).replace(/[\uD800-\uDBFF]$/, ''));
    while (sonioxContextSize(words) > SONIOX_CONTEXT_CHARS && kept.length > 0) {
      kept = kept.slice(0, -1);
      words = mapped(limit.columns, kept, '');
    }
  }
  return { ...words, leftOut: entries.length - kept.length };
}
