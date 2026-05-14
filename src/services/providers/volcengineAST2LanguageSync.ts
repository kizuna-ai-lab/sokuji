/**
 * Synchronisation rules for the Volcengine AST 2.0 provider's source/target
 * language pair. The server requires both fields to be 'zhen' for Chinese↔English
 * bidirectional mode (and rejects any mixed combination involving 'zhen'). This
 * helper enforces that constraint as a pure transformation so call sites can
 * write both fields in a single Zustand update.
 *
 * Rules (from docs/superpowers/specs/2026-05-14-volcengine-ast2-bidirectional-mode-design.md §2):
 *   R1: picks 'zhen' on source → both become 'zhen'
 *   R2: picks 'zhen' on target → both become 'zhen'
 *   R3: leaves 'zhen' on source (current state was zhen/zhen) → target resets to 'en'
 *   R4: leaves 'zhen' on target (current state was zhen/zhen) → source resets to 'zh'
 *   passthrough: any other change updates only the side the user touched
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
const DEFAULT_SOURCE = 'zh';
const DEFAULT_TARGET = 'en';

export function resolveAST2LanguagePair(
  current: AST2LanguagePair,
  change: AST2LanguageChange,
): AST2LanguagePair {
  // R1 / R2: picking 'zhen' on either side forces both to 'zhen'.
  if (change.value === ZHEN) {
    return { sourceLanguage: ZHEN, targetLanguage: ZHEN };
  }

  // R3 / R4: leaving 'zhen' on one side while the other was also 'zhen' means
  // we must reset the other side to its provider default to avoid a transient
  // 'zhen / <other>' state that the server rejects.
  if (change.side === 'source' && current.sourceLanguage === ZHEN && current.targetLanguage === ZHEN) {
    return { sourceLanguage: change.value, targetLanguage: DEFAULT_TARGET };
  }
  if (change.side === 'target' && current.sourceLanguage === ZHEN && current.targetLanguage === ZHEN) {
    return { sourceLanguage: DEFAULT_SOURCE, targetLanguage: change.value };
  }

  // Passthrough: ordinary source/target edit, no cross-side effect.
  if (change.side === 'source') {
    return { sourceLanguage: change.value, targetLanguage: current.targetLanguage };
  }
  return { sourceLanguage: current.sourceLanguage, targetLanguage: change.value };
}
