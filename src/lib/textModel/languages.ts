// src/lib/textModel/languages.ts
//
// The languages a text model translates between: any two of the app's languages. A text model is told the
// languages by their names, so it has no list of codes of its own; what a run offers is the transcriber's list
// (its sources, and its targets for a source), kept to the pairs the translator takes (`planLanguages`).

import { AUTO, parseCode } from '../language/code';
import { wireTable } from '../language/wire';
import type { LanguageOption, Provider } from '../provider/types';
import { LANGUAGE_PRIORITY, sortLanguageOptions } from '../../utils/languages';

/**
 * Whether a text model translates from `source` into `target` (app codes): any two different languages, never from
 * or into a language that is not known yet (`auto`), and never a language into itself.
 */
export function textModelTranslates(source: string, target: string): boolean {
  if (source === AUTO || target === AUTO || source === target) return false;
  return parseCode(source)?.kind === 'tag' && parseCode(target)?.kind === 'tag';
}

/**
 * A text-model provider's own lists, read only where nothing else answers (its entry's pair, the registry's
 * checks): the app's common languages, every one a target of every other. A run's offer comes from the provider
 * that transcribes.
 */
export const TEXT_MODEL_LANGUAGES: readonly LanguageOption[] = sortLanguageOptions(LANGUAGE_PRIORITY.map((value) => ({ value })));

export const textModelLanguages: Provider<unknown, never, never>['languages'] = {
  sources: () => TEXT_MODEL_LANGUAGES,
  targets: (source) => TEXT_MODEL_LANGUAGES.filter((o) => o.value !== source),
  initial: () => ({ source: 'en', target: 'ja' }),
  // Nothing goes out as a code: a model is told a language's name.
  wire: wireTable(TEXT_MODEL_LANGUAGES.map((o) => [o.value] as const)),
};
