/**
 * Palabra's languages and the table between the app's codes and Palabra's own. Kept apart from `settings.ts` so the
 * session side (the adapter) can read the table without reaching the settings side.
 */
import { wireTable } from '../../lib/language/wire';
import { AUTO } from '../../lib/provider/languages';
import type { LanguageOption, LanguagePair, Provider } from '../../lib/provider/types';
import type { PalabraSettings } from './settings';

/**
 * Palabra's documented languages (ruling 8): the docs' own tables, read
 * from the `models-map` their language page loads (2026-09-29) — each row
 * its app code, Palabra's own code, and the app code its docs give the
 * other way round (`to_target` for a source, `to_source` for a target;
 * null where they give none). In English-name order. The targets the docs
 * hide (`en-AU`, `en-CA`, and plain `zh`) are not offered.
 */
type Row = readonly [code: string, vendor: string, other: string | null];

const SOURCE_ROWS: readonly Row[] = [
  ['ar', 'ar', 'ar'],
  ['hy', 'hy', 'hy'],
  ['eu', 'eu', null],
  ['be', 'be', 'be'],
  ['bn', 'bn', null],
  ['bg', 'bg', 'bg'],
  ['yue', 'yue', null],
  ['ca', 'ca', 'ca'],
  ['zh', 'zh', 'zh'],
  ['hr', 'hr', 'hr'],
  ['cs', 'cs', 'cs'],
  ['da', 'da', 'da'],
  ['nl', 'nl', 'nl'],
  ['en', 'en', 'en-US'],
  ['et', 'et', 'et'],
  ['fil', 'fil', 'fil'],
  ['fi', 'fi', 'fi'],
  ['fr', 'fr', 'fr'],
  ['gl', 'gl', 'gl'],
  ['de', 'de', 'de'],
  ['el', 'el', 'el'],
  ['he', 'he', 'he'],
  ['hi', 'hi', 'hi'],
  ['hu', 'hu', 'hu'],
  ['id', 'id', 'id'],
  ['ga', 'ga', null],
  ['it', 'it', 'it'],
  ['ja', 'ja', 'ja'],
  ['kk', 'kk', 'kk'],
  ['ko', 'ko', 'ko'],
  ['lv', 'lv', 'lv'],
  ['lt', 'lt', 'lt'],
  ['mk', 'mk', 'mk'],
  ['ms', 'ms', 'ms'],
  ['mt', 'mt', null],
  ['mr', 'mr', null],
  ['mn', 'mn', null],
  ['no', 'no', 'no'],
  ['fa', 'fa', null],
  ['pl', 'pl', 'pl'],
  ['pt', 'pt', 'pt'],
  ['ro', 'ro', 'ro'],
  ['ru', 'ru', 'ru'],
  ['sr', 'sr', 'sr'],
  ['sk', 'sk', 'sk'],
  ['sl', 'sl', 'sl'],
  ['es', 'es', 'es'],
  ['sw', 'sw', 'sw'],
  ['sv', 'sv', 'sv'],
  ['ta', 'ta', 'ta'],
  ['th', 'th', 'th'],
  ['tr', 'tr', 'tr'],
  ['uk', 'uk', 'uk'],
  ['ur', 'ur', 'ur'],
  ['ug', 'ug', null],
  ['vi', 'vi', 'vi'],
  ['cy', 'cy', 'cy'],
];

const TARGET_ROWS: readonly Row[] = [
  ['ar', 'ar', 'ar'],
  ['ar-SA', 'ar-sa', 'ar'],
  ['ar-AE', 'ar-ae', 'ar'],
  ['hy', 'hy', 'hy'],
  ['az', 'az', null],
  ['be', 'be', 'be'],
  ['bs', 'bs', null],
  ['bg', 'bg', 'bg'],
  ['ca', 'ca', 'ca'],
  ['zh-Hans', 'zh-hans', 'zh'],
  ['zh-Hant', 'zh-hant', 'zh'],
  ['hr', 'hr', 'hr'],
  ['cs', 'cs', 'cs'],
  ['da', 'da', 'da'],
  ['nl', 'nl', 'nl'],
  ['en', 'en', 'en'],
  ['en-GB', 'en-gb', 'en'],
  ['en-US', 'en-us', 'en'],
  ['et', 'et', 'et'],
  ['fil', 'fil', null],
  ['fi', 'fi', 'fi'],
  ['fr', 'fr', 'fr'],
  ['fr-CA', 'fr-ca', 'fr'],
  ['gl', 'gl', 'gl'],
  ['de', 'de', 'de'],
  ['el', 'el', 'el'],
  ['he', 'he', 'he'],
  ['hi', 'hi', 'hi'],
  ['hu', 'hu', 'hu'],
  ['is', 'is', null],
  ['id', 'id', 'id'],
  ['it', 'it', 'it'],
  ['ja', 'ja', 'ja'],
  ['kk', 'kk', null],
  ['ko', 'ko', 'ko'],
  ['lv', 'lv', 'lv'],
  ['lt', 'lt', 'lt'],
  ['mk', 'mk', null],
  ['ms', 'ms', 'ms'],
  ['no', 'no', 'no'],
  ['pl', 'pl', 'pl'],
  ['pt', 'pt', 'pt'],
  ['pt-BR', 'pt-br', 'pt'],
  ['ro', 'ro', 'ro'],
  ['ru', 'ru', 'ru'],
  ['sr', 'sr', null],
  ['sk', 'sk', 'sk'],
  ['sl', 'sl', 'sl'],
  ['es', 'es', 'es'],
  ['es-AR', 'es-ar', 'es'],
  ['es-CL', 'es-ch', 'es'],
  ['es-CO', 'es-co', 'es'],
  ['es-419', 'es-la', 'es'],
  ['es-MX', 'es-mx', 'es'],
  ['sw', 'sw', 'sw'],
  ['sv', 'sv', 'sv'],
  ['ta', 'ta', 'ta'],
  ['th', 'th', 'th'],
  ['tr', 'tr', 'tr'],
  ['uk', 'uk', 'uk'],
  ['ur', 'ur', 'ur'],
  ['vi', 'vi', 'vi'],
  ['cy', 'cy', 'cy'],
];

/** The targets the docs hide, with their source code: `zh` is still one source's documented `to_target`. */
const HIDDEN_TARGETS: Readonly<Record<string, string>> = { zh: 'zh', 'en-AU': 'en', 'en-CA': 'en' };

const option = ([value]: Row): LanguageOption => ({ value });
/** Auto-detect first, as every provider that detects offers it (ruling 8), then the documented sources. */
const SOURCES: readonly LanguageOption[] = [{ value: AUTO }, ...SOURCE_ROWS.map(option)];
const TARGETS: readonly LanguageOption[] = TARGET_ROWS.map(option);
const TO_TARGET: ReadonlyMap<string, string | null> = new Map(SOURCE_ROWS.map(([code, , other]) => [code, other]));
const TO_SOURCE: ReadonlyMap<string, string | null> = new Map(TARGET_ROWS.map(([code, , other]) => [code, other]));

/**
 * A source's documented target, as offered: one the docs hide takes the
 * first offered target of its own source — `zh`'s documented `to_target`
 * is the hidden `zh`, so Chinese reverses to Simplified Chinese (choice 5).
 */
function offeredTarget(code: string | null | undefined): string | null {
  if (!code) return null;
  if (TO_SOURCE.has(code)) return code;
  const source = HIDDEN_TARGETS[code];
  return source === undefined ? null : (TARGET_ROWS.find(([, , other]) => other === source)?.[0] ?? null);
}

/**
 * Palabra's languages (ruling 8): its documented tables, the same whatever
 * the source and whether the run speaks — `bn`, `mr` and `fa`, which the
 * docs do not list as targets, are not offered. Its reverse (ruling 9) is
 * its documented codes, not a plain swap: a target reverses to its
 * `to_source` (`en-us` → `en`) and a source to its `to_target` (`en` →
 * `en-us`), and a pair either side of which has none has no reverse — an
 * `auto` source among them.
 */
export const palabraLanguages: Provider<PalabraSettings, never, never>['languages'] = {
  sources: () => SOURCES,
  targets: () => TARGETS,
  // The old defaults (`PalabraAIProviderConfig.ts:31-32`).
  initial: () => ({ source: 'en', target: 'es' }),
  // Every code either table holds, and `auto`, which Palabra takes as a source: Palabra's own spelling on the wire.
  wire: wireTable([
    [AUTO],
    ...[...new Map([...SOURCE_ROWS, ...TARGET_ROWS].map(([code, vendor]) => [code, vendor])).entries()].map(([code, vendor]) =>
      code === vendor ? ([code] as const) : ([code, vendor] as const),
    ),
  ]),
  reverse: (pair: LanguagePair) => {
    const source = TO_SOURCE.get(pair.target) ?? null;
    const target = offeredTarget(TO_TARGET.get(pair.source));
    return source !== null && target !== null ? { source, target } : null;
  },
};

/** Whether Palabra runs this direction: `build`'s guard, over the same two lists. */
export function palabraOffers(direction: LanguagePair): boolean {
  return SOURCES.some((o) => o.value === direction.source) && TARGETS.some((o) => o.value === direction.target);
}
