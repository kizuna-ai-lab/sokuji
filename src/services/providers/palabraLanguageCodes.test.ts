import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isPalabraAIEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
}));

import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';

/**
 * Palabra validates source_language and target_language against two different
 * enums, and offering a code outside them fails the whole set_task with a
 * VALIDATION_ERROR — i.e. the session connects and then translates nothing.
 *
 * The lists below are the API's own enums, captured on 2026-07-30 from the
 * `desc` field of that VALIDATION_ERROR, which enumerates every permitted
 * member. They are not published anywhere. To refresh them, run the
 * palabra-probe harness with a deliberately bogus code — `?src=zz` for the
 * source enum, `?tgt=zz` for the target enum — and read the error payload.
 *
 * Two properties worth knowing, both verified against the live API:
 *  - The source enum holds plain codes only, but the API strips a region suffix
 *    before validating, so `en-us` is accepted as a source and normalised to
 *    `en`. That is what makes a plain source/target swap viable for participant
 *    mode (see createParticipantSessionConfig).
 *  - The target enum keeps region variants, and spells Vietnamese `vi` — there
 *    is no `vn` target.
 */
const API_SOURCE_LANGUAGES = new Set([
  'af', 'am', 'ar', 'as', 'auto', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'ceb', 'cs', 'cy', 'da',
  'de', 'el', 'en', 'es', 'et', 'eu', 'fa', 'fi', 'fil', 'fr', 'ga', 'gl', 'gu', 'ha', 'he',
  'hi', 'hr', 'hu', 'hy', 'id', 'ig', 'is', 'it', 'ja', 'jv', 'ka', 'kk', 'km', 'kn', 'ko',
  'ku', 'ky', 'lb', 'lg', 'ln', 'lo', 'lt', 'lv', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt',
  'my', 'ne', 'nl', 'no', 'ny', 'or', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd', 'sk', 'sl',
  'sn', 'so', 'sq', 'sr', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'tl', 'tr', 'ug', 'uk', 'ur',
  'uz', 'vi', 'wo', 'xh', 'yue', 'zh', 'zu',
]);

const API_TARGET_LANGUAGES = new Set([
  'af', 'ar', 'ar-ae', 'ar-sa', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de',
  'el', 'en', 'en-au', 'en-ca', 'en-gb', 'en-us', 'es', 'es-ar', 'es-ch', 'es-co', 'es-eu',
  'es-la', 'es-mx', 'et', 'fa', 'fi', 'fil', 'fr', 'fr-ca', 'fr-eu', 'gl', 'gu', 'he', 'hi',
  'hr', 'hu', 'hy', 'id', 'is', 'it', 'ja', 'ka', 'kk', 'kn', 'ko', 'lt', 'lv', 'mi', 'mk',
  'ml', 'mr', 'ms', 'ne', 'nl', 'no', 'pa', 'pl', 'pt', 'pt-br', 'pt-eu', 'pt-la', 'ro', 'ru',
  'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh',
  'zh-hans', 'zh-hant',
]);

describe('PalabraAI language codes match the API enums', () => {
  const descriptor = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);

  it('offers only source languages the API accepts', () => {
    const offered = descriptor.resolveSourceLanguages().map((l) => l.value);
    const rejected = offered.filter((code) => !API_SOURCE_LANGUAGES.has(code));

    expect(rejected).toEqual([]);
  });

  it('offers only target languages the API accepts', () => {
    const offered = descriptor.resolveTargetLanguages('en').map((l) => l.value);
    const rejected = offered.filter((code) => !API_TARGET_LANGUAGES.has(code));

    expect(rejected).toEqual([]);
  });

  it('keeps every offered target usable as a participant-mode source', () => {
    // Participant mode swaps source and target. The API strips the region suffix
    // before validating a source, so the base of every target we offer has to be
    // a valid source code or the reversed session dies on set_task.
    const offered = descriptor.resolveTargetLanguages('en').map((l) => l.value);
    const unswappable = offered.filter((code) => !API_SOURCE_LANGUAGES.has(code.split('-')[0]));

    expect(unswappable).toEqual([]);
  });
});
