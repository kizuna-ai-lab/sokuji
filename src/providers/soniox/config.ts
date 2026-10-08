/**
 * Soniox's `C`, `build` and `describe` (survey §2.7). `build` never
 * refuses: an auto source with the participant leg is the gate's (D20).
 * The vocabulary helpers are copied from `SonioxProviderConfig.ts:73-165`
 * (ruling 1), deleted since with the old descriptor (Stage 2 deletion,
 * ruling 2).
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { reportWarning } from '../../lib/diagnostics/report';
import type { SharedSettings } from '../../lib/provider/types';
import { asSonioxRegion } from '../../lib/soniox/regions';
import { SONIOX_DEFAULT_VOICE, SONIOX_TTS_MODEL } from '../../lib/soniox/ttsCatalog';
import { sonioxVoiceField, type SonioxSettings } from './settings';

export const SONIOX_STT_MODEL = 'stt-rt-v5';

/** The STT config frame's `context`, wire-shaped. */
export interface SonioxWireContext {
  terms?: string[];
  translation_terms?: Array<{ source: string; target: string }>;
  text?: string;
}

export interface SonioxConfig {
  stt: {
    model: string;
    /** Present when there is vocabulary or background; budgeted under Soniox's context limit. */
    context?: SonioxWireContext;
    endpointSensitivity: number;
    endpointLatencyAdjustmentLevel: number;
    endpointMaxDelayMs: number;
  };
  /** Present when this leg speaks. */
  tts?: { voice: string; speed: number };
  /** Both mode on one mixed socket (D23); read by `startBoth`. */
  sharedBoth: boolean;
  /** The participant's leg: its own socket labels its people (the shared socket always does). */
  diarize: boolean;
}

/** One term per line; trimmed, empties dropped, duplicates removed. */
export function parseVocabularyTerms(raw: string): string[] {
  const seen = new Set<string>();
  for (const line of raw.split('\n')) {
    const term = line.trim();
    if (term) seen.add(term);
  }
  return [...seen];
}

/** One "source=target" per line; split on the FIRST '=', both sides trimmed
 *  and required non-empty. Lines without '=' are ignored. */
export function parseVocabularyTranslations(raw: string): Array<{ source: string; target: string }> {
  const out: Array<{ source: string; target: string }> = [];
  for (const line of raw.split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const source = line.slice(0, eq).trim();
    const target = line.slice(eq + 1).trim();
    if (source && target) out.push({ source, target });
  }
  return out;
}

export function clampNumber(value: unknown, min: number, max: number, dflt: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : dflt;
}

// Soniox rejects a session whose serialized context exceeds ~10,000 chars
// ("Context is too long (max length 10000)"). The textarea maxLength caps only
// the RAW text: 1,000 four-char "a=b" lines fit in one textarea but serialize
// to ~26 KB of {"source":…,"target":…} objects. Budget the WIRE-shaped
// serialization (with headroom for the JSON scaffolding Soniox counts) so a
// session always starts; entries are dropped from the tail — the user's
// earlier lines win — taking the expensive translation pairs first.
const SONIOX_CONTEXT_CHAR_BUDGET = 9000;

function fitContextToBudget(
  terms: string[],
  translationTerms: Array<{ source: string; target: string }>,
  text: string
): { terms: string[]; translationTerms: Array<{ source: string; target: string }>; text: string } {
  const serializedSize = (): number =>
    JSON.stringify({
      ...(terms.length ? { terms } : {}),
      ...(translationTerms.length ? { translation_terms: translationTerms } : {}),
      ...(text ? { text } : {}),
    }).length;
  const dropped = { terms: 0, translationTerms: 0, textChars: 0 };
  // Background text is the weakest context evidence: truncate it first.
  // Raw-length arithmetic misjudges the cut when characters JSON-escape to
  // 2-6 output units (newlines and quotes are certain in pasted agendas), so
  // binary-search the longest prefix whose actual serialization fits the
  // budget (~12 stringify probes at connect time, once per session).
  if (text && serializedSize() > SONIOX_CONTEXT_CHAR_BUDGET) {
    const full = text;
    const fits = (keep: number): boolean => {
      text = full.slice(0, keep);
      return serializedSize() <= SONIOX_CONTEXT_CHAR_BUDGET;
    };
    let lo = 0;
    let hi = full.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    // A cut landing mid-surrogate-pair would leave a lone high surrogate
    // (serializes as a 6-char escape and renders as U+FFFD downstream).
    text = full.slice(0, lo).replace(/[\uD800-\uDBFF]$/, '');
    dropped.textChars = full.length - text.length;
  }
  while (serializedSize() > SONIOX_CONTEXT_CHAR_BUDGET && translationTerms.length) {
    translationTerms = translationTerms.slice(0, -1);
    dropped.translationTerms++;
  }
  while (serializedSize() > SONIOX_CONTEXT_CHAR_BUDGET && terms.length) {
    terms = terms.slice(0, -1);
    dropped.terms++;
  }
  if (dropped.terms || dropped.translationTerms || dropped.textChars) {
    // The user typed this vocabulary and it was silently cut to fit the
    // provider's context budget, which changes what gets recognised.
    reportWarning(
      'SonioxConfig',
      `Custom vocabulary exceeds the Soniox context limit — truncated ${dropped.textChars} background char(s), ` +
      `dropped ${dropped.translationTerms} translation(s) and ${dropped.terms} term(s) from the end`,
      { dedupeKey: 'soniox:context-budget' } // a two-leg start builds twice
    );
  }
  return { terms, translationTerms, text };
}

export function buildSoniox(context: SessionContext, s: SonioxSettings, shared: SharedSettings): SonioxConfig {
  const { terms, translationTerms, text } = fitContextToBudget(
    parseVocabularyTerms(s.vocabularyTerms ?? ''),
    parseVocabularyTranslations(s.vocabularyTranslations ?? ''),
    (s.contextText ?? '').trim(),
  );
  const wire: SonioxWireContext = {
    ...(terms.length ? { terms } : {}),
    ...(translationTerms.length ? { translation_terms: translationTerms } : {}),
    ...(text ? { text } : {}),
  };
  return {
    stt: {
      model: SONIOX_STT_MODEL,
      ...(Object.keys(wire).length > 0 ? { context: wire } : {}),
      endpointSensitivity: clampNumber(s.endpointSensitivity, -1, 1, 0),
      endpointLatencyAdjustmentLevel: Math.round(clampNumber(s.endpointLatencyAdjustmentLevel, 0, 3, 0)),
      endpointMaxDelayMs: Math.round(clampNumber(s.endpointMaxDelayMs, 500, 3000, 2000)),
    },
    ...(context.speech
      ? { tts: { voice: s[sonioxVoiceField(asSonioxRegion(s.region))] || SONIOX_DEFAULT_VOICE, speed: clampNumber(s.ttsSpeed, 0.7, 1.3, 1.0) } }
      : {}),
    sharedBoth: s.bothModeSharedSession,
    diarize: shared.reversed(context.direction),
  };
}

export function describeSoniox(c: SonioxConfig): { asrModel?: string; ttsModel?: string } {
  return { asrModel: c.stt.model, ...(c.tts ? { ttsModel: SONIOX_TTS_MODEL } : {}) };
}
