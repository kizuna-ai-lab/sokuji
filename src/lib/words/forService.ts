// src/lib/words/forService.ts
//
// What each service gets of the word list (spec §9): only the columns it has a field for — written forms as terms or
// hot words, translations as its glossary, "often heard as" as its corrections, the session background as its
// context — the first entries up to its limit, and how many were left out, for its stage to say so. A service with
// no field gets nothing in this version.
// Types only from the list: the services' builders import this module, and must not pull the settings storage in.
import type { WordEntry } from './list';

/** Where several "often heard as" forms are told apart: any comma, the full-width and ideographic ones too. */
export const HEARD_AS_SEPARATOR = /[,，、]/;

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

/**
 * The columns each service has a field for, and how many entries it takes (from the services' documents). `byModel`:
 * the columns only some of its models take (the usage table says "depends on model").
 */
export const WORD_LIMITS: Record<string, { columns: readonly Column[]; byModel?: readonly Column[]; entries: number; items?: number; backgroundChars?: number }> = {
  // Terms, translations and background share one context of about 8,000 tokens: kept under SONIOX_CONTEXT_CHARS.
  soniox: { columns: ['terms', 'translations', 'background'], entries: Number.POSITIVE_INFINITY },
  // The written forms to every model (keywords to gpt-transcribe and gpt-live-transcribe, the prompt to the older
  // models); the background to the older models' prompt only.
  openai: { columns: ['terms', 'background'], byModel: ['background'], entries: 1000 },
  qwen_livetranslate: { columns: ['translations'], entries: 1000 },
  // Hot words, glossary entries and corrections: at most 1,000 of them together.
  volcengine_ast2: { columns: ['terms', 'translations', 'heardAs'], entries: Number.POSITIVE_INFINITY, items: 1000 },
  // Custom vocabulary: gemini-3.8-live only (WORD_LIST_MODELS).
  gemini: { columns: ['terms'], byModel: ['terms'], entries: 1000 },
  // This device's translation: the words and the start of the background go into the prompt a small model reads for
  // every sentence; each token there costs time on every one.
  // Read by its large-language-model translators only.
  local_inference: { columns: ['terms', 'translations', 'background'], byModel: ['terms', 'translations', 'background'], entries: 30, backgroundChars: 300 },
};

/**
 * Where a service's models differ in taking the list at all, the ones that do (from the service's documents). Any other
 * model, a new one included, gets nothing: a Live session refuses a setup field its model does not know.
 */
export const WORD_LIST_MODELS: Readonly<Record<string, readonly string[]>> = {
  gemini: ['gemini-3.8-live'],
};

/** Whether `model` of `service` takes the word list (a service without such a rule: yes). */
export function modelTakesWords(service: string, model: string | null | undefined): boolean {
  const only = WORD_LIST_MODELS[service];
  return !only || (!!model && only.includes(model));
}

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
    const h = entries.flatMap((e) => (e.heardAs ? e.heardAs.split(HEARD_AS_SEPARATOR).map((x) => x.trim()).filter(Boolean).map((x): [string, string] => [x, e.written]) : []));
    if (h.length > 0) out.heardAs = h;
  }
  if (columns.includes('background') && background) out.background = background;
  return out;
}

export function wordsFor(service: string, entries: readonly WordEntry[], background: string): ServiceWords {
  const limit = WORD_LIMITS[service];
  if (!limit) return { leftOut: 0 };
  const trimmed = background.trim();
  const text = limit.backgroundChars !== undefined && trimmed.length > limit.backgroundChars
    ? trimmed.slice(0, limit.backgroundChars).replace(/[\uD800-\uDBFF]$/, '') : trimmed;
  // Only the entries the service would take count: an entry without a translation is nothing to a glossary alone.
  const relevant = limit.columns.includes('terms') ? [...entries]
    : entries.filter((e) => (limit.columns.includes('translations') && e.translation) || (limit.columns.includes('heardAs') && e.heardAs));
  let kept = relevant.slice(0, limit.entries);
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
    // quotes take two characters or more), at a whole character; then entries go from the end.
    const points = [...text];
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (sonioxContextSize(mapped(limit.columns, kept, points.slice(0, mid).join(''))) <= SONIOX_CONTEXT_CHARS) lo = mid;
      else hi = mid - 1;
    }
    words = mapped(limit.columns, kept, points.slice(0, lo).join(''));
    while (sonioxContextSize(words) > SONIOX_CONTEXT_CHARS && kept.length > 0) {
      kept = kept.slice(0, -1);
      words = mapped(limit.columns, kept, '');
    }
  }
  return { ...words, leftOut: relevant.length - kept.length };
}
