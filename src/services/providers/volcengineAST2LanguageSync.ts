/**
 * Synchronisation rules for the Volcengine AST 2.0 provider's source/target
 * language pair. The server requires both fields to be 'zhen' for Chinese↔English
 * bidirectional mode and rejects any mixed combination involving 'zhen'. This
 * helper enforces that constraint as a pure transformation so call sites can
 * write both fields in a single Zustand update.
 *
 * Rules (from docs/superpowers/specs/2026-05-14-volcengine-ast2-bidirectional-mode-design.md §2):
 *   R1: picks 'zhen' on either side → both become 'zhen'
 *   R2: leaves 'zhen' on one side (other side stays 'zhen') → reset the other
 *       side to its server-contract default ('zh' source / 'en' target). Covers
 *       both the spec's R3/R4 (zhen/zhen → non-zhen) AND legacy persisted
 *       'zhen/<other>' pairs that were possible before this PR exposed 'zhen'
 *       on the target side.
 *   passthrough: any other change updates only the side the user touched.
 */
export interface AST2LanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface AST2LanguageChange {
  side: 'source' | 'target';
  value: string;
}

const ZHEN = 'zhen';
// DEFAULT_SOURCE / DEFAULT_TARGET are anchored to the server contract, not to
// the provider's UI defaults. AST 2.0 requires at least one of source/target
// to be 'zh' or 'en' in non-bidirectional mode, so resetting an orphaned
// 'zhen' side to anything other than 'zh'/'en' could still produce a
// server-invalid pair. Keep these as literals — sourcing them from
// VolcengineAST2ProviderConfig.defaults would couple the helper to UI defaults
// that may legitimately diverge from server constraints.
const DEFAULT_SOURCE = 'zh';
const DEFAULT_TARGET = 'en';

export function resolveAST2LanguagePair(
  current: AST2LanguagePair,
  change: AST2LanguageChange,
): AST2LanguagePair {
  // R1: picking 'zhen' on either side forces both to 'zhen'.
  if (change.value === ZHEN) {
    return { sourceLanguage: ZHEN, targetLanguage: ZHEN };
  }

  // R2: changing one side to a non-zhen value while the OTHER side is 'zhen'
  // would produce a server-invalid 'zhen / <other>' pair. Reset the other
  // side to its server-contract default. This subsumes the spec's R3/R4 (the
  // both-sides-zhen → non-zhen case) and additionally cleans up legacy
  // persisted 'zhen/<other>' pairs from older builds where 'zhen' was only
  // exposed on the source side.
  if (change.side === 'source') {
    return {
      sourceLanguage: change.value,
      targetLanguage: current.targetLanguage === ZHEN ? DEFAULT_TARGET : current.targetLanguage,
    };
  }
  return {
    sourceLanguage: current.sourceLanguage === ZHEN ? DEFAULT_SOURCE : current.sourceLanguage,
    targetLanguage: change.value,
  };
}
