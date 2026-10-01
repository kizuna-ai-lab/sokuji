/**
 * Which voice a Doubao AST 2.0 pair speaks in (#577 catalog §2.2–2.4).
 * Cloning is a peer of the catalog's voices, not a mode: it runs only the
 * pairs the cloning model has ("声音复刻模式"), and every other speaking pair
 * takes a catalog voice. Pure; nothing here writes a setting.
 */
import type { LanguagePair } from '../../lib/provider/types';
import { defaultVoice, isFixedTarget, speaks } from './catalog';
import { CLONING_LANGUAGES, ZH_EN, type Ast2Settings } from './settings';

/** The voice-list entry, and the stored value, for the speaker's own voice. */
export const CLONE = 'clone';

const zhOrEn = (v: string) => v === 'zh' || v === 'en';

/**
 * Whether the cloning model runs a pair: lang_8 on both sides with Chinese or
 * English on one, or zh+en with itself. Elsewhere the server answers "group
 * model:volc_tob-<src>2<tgt>-s2s not found" (#576; ko→en, yue→zh, zh→ko).
 */
export function clonable({ source, target }: LanguagePair): boolean {
  if (source === ZH_EN || target === ZH_EN) return source === ZH_EN && target === ZH_EN;
  if (source === target) return false;
  return CLONING_LANGUAGES.has(source) && CLONING_LANGUAGES.has(target) && (zhOrEn(source) || zhOrEn(target));
}

/**
 * The voice a pair speaks in: the one chosen for its target when it can run
 * the pair; else cloning where cloning runs it, so a profile from before the
 * catalog keeps cloning; else the target's first catalog voice. A fallback
 * never writes: a stored choice outlives a pair it cannot apply to.
 * Undefined only for a target no voice speaks, which no offered pair has.
 */
export function effectiveVoice(pair: LanguagePair, s: Pick<Ast2Settings, 'voices'>): string | undefined {
  const chosen = isFixedTarget(pair.target) ? s.voices[pair.target] : undefined;
  if (chosen === CLONE ? clonable(pair) : chosen !== undefined && speaks(chosen, pair.target)) return chosen;
  if (clonable(pair)) return CLONE;
  return defaultVoice(pair.target)?.id;
}
