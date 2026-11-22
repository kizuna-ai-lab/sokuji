/**
 * The languages Bing Translator translates between (app codes): its own list, and the pairs it takes. A source
 * that is not known yet (`auto`) is never translated: the engine is loaded for one fixed pair.
 */
import { BING_SUPPORTED_LANGUAGES, isSupportedByBing, mapToBingCode } from '../../lib/bing-translator/languageMap';
import { AUTO, canonicalTag } from '../../lib/language/code';

/** Two codes Bing reads as one language (`no` and `nb`, `zh` and `zh-CN`). */
function sameForBing(a: string, b: string): boolean {
  try {
    return mapToBingCode(a) === mapToBingCode(b);
  } catch {
    return false;
  }
}

/** Whether Bing translates from `source` into `target` (app codes): both are on its list, and they are not one language to it. */
export function bingTranslates(source: string, target: string): boolean {
  if (source === AUTO || target === AUTO || source === target) return false;
  return isSupportedByBing(source) && isSupportedByBing(target) && !sameForBing(source, target);
}

/** Bing's list as app codes, each once; a code that is no language tag is left out. */
export function bingLanguages(): string[] {
  const out = new Set<string>();
  for (const code of BING_SUPPORTED_LANGUAGES) {
    try {
      out.add(canonicalTag(code));
    } catch {
      // Not a language tag: no language of its own.
    }
  }
  return [...out].filter(isSupportedByBing);
}
