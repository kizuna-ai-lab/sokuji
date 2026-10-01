import { describe, it, expect } from 'vitest';
import { AUTO, normalizePair, reversedPair, reverseSupported, swapped } from '../../lib/provider/languages';
import type { AuthContext } from '../../lib/provider/types';
import {
  DESIRED_QUEUE_RANGE, effectiveQueue, effectiveThreshold, MAX_QUEUE_RANGE, maxQueueFloor, migratePalabraSettings, PALABRA_DEFAULTS, PALABRA_VOICES,
  palabraCredentials, palabraLanguages, palabraOffers, SILENCE_THRESHOLD_RANGE,
} from './settings';

const auth: AuthContext = { signedIn: false, getToken: async () => null };
const p = { languages: palabraLanguages };
const S = PALABRA_DEFAULTS;
const codes = (options: readonly { value: string }[]) => options.map((o) => o.value);

/** Palabra's docs' language tables as captured on 2026-09-29 (`models-map`, `source_languages_meta` / `target_languages_meta`): the codes, and the targets they hide. */
const DOC_SOURCES = [
  'ar', 'hy', 'auto', 'be', 'bg', 'bn', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu', 'fil', 'kk', 'mk', 'sr', 'fa', 'fi', 'fr', 'ga', 'gl', 'he', 'hi',
  'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'mn', 'mr', 'ms', 'mt', 'no', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'sw', 'ta', 'th', 'tr', 'ug', 'uk', 'ur', 'vi',
  'yue', 'zh',
];
const DOC_TARGETS = [
  'ar', 'ar-ae', 'ar-sa', 'az', 'hy', 'be', 'bg', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'en-au', 'en-ca', 'en-gb', 'en-us', 'es', 'es-mx', 'es-co', 'es-ar', 'es-ch',
  'es-la', 'et', 'fi', 'fil', 'fr', 'fr-ca', 'gl', 'he', 'hi', 'hr', 'hu', 'id', 'is', 'it', 'ja', 'kk', 'ko', 'lt', 'lv', 'mk', 'ms', 'nl', 'no', 'pl', 'pt', 'pt-br', 'ro',
  'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'th', 'tr', 'uk', 'ur', 'vi', 'zh', 'zh-hans', 'zh-hant',
];
const DOC_HIDDEN_TARGETS = ['en-au', 'en-ca', 'zh'];

/** The API's own validator enums, captured from a VALIDATION_ERROR's `desc` on 2026-07-30 (`palabraLanguageCodes.test.ts`, which left with the old code). */
const API_SOURCE_LANGUAGES = new Set([
  'af', 'am', 'ar', 'as', 'auto', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'ceb', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu', 'fa', 'fi', 'fil', 'fr', 'ga', 'gl', 'gu',
  'ha', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'ig', 'is', 'it', 'ja', 'jv', 'ka', 'kk', 'km', 'kn', 'ko', 'ku', 'ky', 'lb', 'lg', 'ln', 'lo', 'lt', 'lv', 'mi', 'mk', 'ml',
  'mn', 'mr', 'ms', 'mt', 'my', 'ne', 'nl', 'no', 'ny', 'or', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd', 'sk', 'sl', 'sn', 'so', 'sq', 'sr', 'sv', 'sw', 'ta', 'te', 'tg',
  'th', 'tl', 'tr', 'ug', 'uk', 'ur', 'uz', 'vi', 'wo', 'xh', 'yue', 'zh', 'zu',
]);
const API_TARGET_LANGUAGES = new Set([
  'af', 'ar', 'ar-ae', 'ar-sa', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'en-au', 'en-ca', 'en-gb', 'en-us', 'es', 'es-ar', 'es-ch', 'es-co',
  'es-eu', 'es-la', 'es-mx', 'et', 'fa', 'fi', 'fil', 'fr', 'fr-ca', 'fr-eu', 'gl', 'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'is', 'it', 'ja', 'ka', 'kk', 'kn', 'ko', 'lt',
  'lv', 'mi', 'mk', 'ml', 'mr', 'ms', 'ne', 'nl', 'no', 'pa', 'pl', 'pt', 'pt-br', 'pt-eu', 'pt-la', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tl', 'tr',
  'uk', 'ur', 'vi', 'zh', 'zh-hans', 'zh-hant',
]);

describe("Palabra AI's settings", () => {
  it('defaults to the platform key, the low voice, a 0.7 s threshold, the splitter on, no partial translations, and our buffer: 8 s, 24 s, no adaptive speed (ruling 10)', () => {
    expect(PALABRA_DEFAULTS).toEqual({
      authMode: 'platform', voiceId: 'default_low', segmentConfirmationSilenceThreshold: 0.7, sentenceSplitterEnabled: true, translatePartialTranscriptions: false,
      desiredQueueLevelMs: 8_000, maxQueueLevelMs: 24_000, autoTempo: false,
    });
    expect(PALABRA_VOICES).toEqual([{ value: 'default_low', name: 'Default Low' }, { value: 'default_high', name: 'Default High' }]);
  });

  it('keeps what was stored field by field, a value of the wrong kind falling to its default, and converts nothing (ruling 2)', () => {
    expect(migratePalabraSettings({
      authMode: 'app', voiceId: 'default_high', segmentConfirmationSilenceThreshold: 0.1, sentenceSplitterEnabled: false, translatePartialTranscriptions: true,
      desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000, autoTempo: true,
    })).toEqual({
      // Out-of-range numbers are kept as stored: `build` clamps them where they are used.
      authMode: 'app', voiceId: 'default_high', segmentConfirmationSilenceThreshold: 0.1, sentenceSplitterEnabled: false, translatePartialTranscriptions: true,
      desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000, autoTempo: true,
    });
    expect(migratePalabraSettings({
      authMode: 'clientCredentials', voiceId: 'Default Low', segmentConfirmationSilenceThreshold: 'x', sentenceSplitterEnabled: 'yes',
      translatePartialTranscriptions: 1, desiredQueueLevelMs: Number.NaN, maxQueueLevelMs: null, autoTempo: undefined,
    })).toEqual(PALABRA_DEFAULTS);
  });

  it('opens a profile that stored no mode in the platform mode, whatever credentials it holds: a stated departure (ruling 2)', () => {
    // The old load pinned such a profile to the app pair (`settingsStore.ts:529-537`); nothing reads the credentials here.
    expect(migratePalabraSettings({}).authMode).toBe('platform');
  });

  it("clamps the threshold to the API's 0.3 floor and the slider's 2.0 ceiling, and keeps the max buffer above the target, on the sliders' grids (ruling 10)", () => {
    expect(SILENCE_THRESHOLD_RANGE).toEqual({ min: 0.3, max: 2, step: 0.01 });
    expect(effectiveThreshold({ segmentConfirmationSilenceThreshold: 0.1 })).toBe(0.3);
    expect(effectiveThreshold({ segmentConfirmationSilenceThreshold: 0.7 })).toBe(0.7);
    expect(effectiveThreshold({ segmentConfirmationSilenceThreshold: 9 })).toBe(2);
    expect(DESIRED_QUEUE_RANGE).toEqual({ min: 3_000, max: 15_000, step: 1_000 });
    expect(MAX_QUEUE_RANGE).toEqual({ min: 12_000, max: 60_000, step: 3_000 });
    expect([3_000, 8_000, 11_000, 12_000, 14_000, 15_000].map(maxQueueFloor)).toEqual([12_000, 12_000, 12_000, 15_000, 15_000, 18_000]);
    for (let desired = DESIRED_QUEUE_RANGE.min; desired <= DESIRED_QUEUE_RANGE.max; desired += DESIRED_QUEUE_RANGE.step) {
      expect(maxQueueFloor(desired), String(desired)).toBeGreaterThan(desired);
      expect(maxQueueFloor(desired) % MAX_QUEUE_RANGE.step, String(desired)).toBe(0);
    }
    // The probe's refused pair: a 15 s target over a 12 s max is raised to 18 s.
    expect(effectiveQueue({ desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000 })).toEqual({ desiredMs: 15_000, maxMs: 18_000 });
    expect(effectiveQueue({ desiredQueueLevelMs: 8_000, maxQueueLevelMs: 24_000 })).toEqual({ desiredMs: 8_000, maxMs: 24_000 });
    expect(effectiveQueue({ desiredQueueLevelMs: 500, maxQueueLevelMs: 99_000 })).toEqual({ desiredMs: 3_000, maxMs: 60_000 });
  });
});

describe("Palabra AI's credentials (ruling 1)", () => {
  it('shows the API key in the platform mode, and the Client ID and Secret in the app mode, all three stored', () => {
    expect(palabraCredentials.keys).toEqual(['apiKey', 'clientId', 'clientSecret']);
    expect(palabraCredentials.fields(S).map((f) => [f.key, f.labelKey, f.secret, f.placeholderKey])).toEqual([
      ['apiKey', 'setup.credentials.apiKey', true, 'providers.palabraai.apiKeyPlaceholder'],
    ]);
    expect(palabraCredentials.fields({ ...S, authMode: 'app' }).map((f) => [f.key, f.labelKey, f.secret])).toEqual([
      ['clientId', 'providers.palabraai.clientIdPlaceholder', true],
      ['clientSecret', 'providers.palabraai.clientSecretPlaceholder', true],
    ]);
  });

  it('offers the choice above the fields, on authMode, in the old labels (F4)', () => {
    expect(palabraCredentials.choice).toEqual({
      setting: 'authMode',
      options: [{ value: 'platform', labelKey: 'providers.palabraai.authModePlatform' }, { value: 'app', labelKey: 'providers.palabraai.authModeApp' }],
    });
  });

  it('reads the mode its fields name, trimmed; a blank field is missing, in words the runner puts as credentials_missing', () => {
    expect(palabraCredentials.read({ apiKey: '  plbr_readKey0123456789 \n' }, auth)).toEqual({ kind: 'apiKey', apiKey: 'plbr_readKey0123456789' });
    expect(palabraCredentials.read({ clientId: ' id-1 ', clientSecret: 'secret-1' }, auth)).toEqual({ kind: 'app', clientId: 'id-1', clientSecret: 'secret-1' });
    expect(palabraCredentials.read({ apiKey: '   ' }, auth)).toEqual({ missing: 'Enter the API key of your Palabra AI account.' });
    expect(palabraCredentials.read({ clientId: 'id-1', clientSecret: '' }, auth)).toEqual({ missing: 'Enter the Client ID and the Client Secret of your Palabra AI app.' });
    // A number a store handed back as one reads as its text.
    expect(palabraCredentials.read({ clientId: 12345 as unknown as string, clientSecret: 's' }, auth)).toEqual({ kind: 'app', clientId: '12345', clientSecret: 's' });
  });
});

describe("Palabra AI's languages: its documented tables (ruling 8)", () => {
  it('offers Auto-detect first, then every documented source, in English-name order', () => {
    const sources = codes(palabraLanguages.sources(S));
    expect(sources[0]).toBe(AUTO);
    expect([...sources].sort()).toEqual([...DOC_SOURCES].sort());
    const names = palabraLanguages.sources(S).slice(1).map((o) => o.englishName);
    expect(names).toEqual([...names].sort());
  });

  it('offers every documented target the docs do not hide, in English-name order, whatever the source', () => {
    const targets = codes(palabraLanguages.targets('en', S));
    expect([...targets].sort()).toEqual(DOC_TARGETS.filter((c) => !DOC_HIDDEN_TARGETS.includes(c)).sort());
    const names = palabraLanguages.targets('en', S).map((o) => o.englishName);
    expect(names).toEqual([...names].sort());
    for (const source of codes(palabraLanguages.sources(S))) expect(codes(palabraLanguages.targets(source, S)), source).toEqual(targets);
  });

  it("offers only codes the API's validator accepts", () => {
    expect(codes(palabraLanguages.sources(S)).filter((c) => !API_SOURCE_LANGUAGES.has(c))).toEqual([]);
    expect(codes(palabraLanguages.targets('en', S)).filter((c) => !API_TARGET_LANGUAGES.has(c))).toEqual([]);
  });

  it('leaves out what the docs do not list: bn, mr and fa as targets, the hidden zh, en-au and en-ca, and the old app\'s vn, ba, eo and ia', () => {
    const targets = codes(palabraLanguages.targets('en', S));
    for (const code of ['bn', 'mr', 'fa', 'zh', 'en-au', 'en-ca', 'vn']) expect(targets, code).not.toContain(code);
    const sources = codes(palabraLanguages.sources(S));
    for (const code of ['ba', 'eo', 'ia']) expect(sources, code).not.toContain(code);
  });

  it('starts from en → es, and a stored code it no longer offers falls to the first of its list, nothing converted (ruling 2)', () => {
    expect(palabraLanguages.initial?.(S)).toEqual({ source: 'en', target: 'es' });
    expect(normalizePair(p, S, { source: 'ja', target: 'vn' })).toEqual({ source: 'ja', target: 'ar' });
    // The old app's plain `zh` target, Simplified Chinese: hidden in the docs, it falls too.
    expect(normalizePair(p, S, { source: 'ja', target: 'zh' })).toEqual({ source: 'ja', target: 'ar' });
    expect(normalizePair(p, S, { source: 'eo', target: 'ja' })).toEqual({ source: AUTO, target: 'ja' });
  });

  it("runs a direction its lists offer, and no other (build's guard)", () => {
    expect(palabraOffers({ source: 'ja', target: 'en-us' })).toBe(true);
    expect(palabraOffers({ source: AUTO, target: 'es' })).toBe(true);
    expect(palabraOffers({ source: 'ja', target: 'bn' })).toBe(false);
    expect(palabraOffers({ source: 'en-us', target: 'ja' })).toBe(false);
  });
});

describe("Palabra AI's reverse: its documented codes (ruling 9)", () => {
  it('reverses a target by its to_source and a source by its to_target', () => {
    expect(reversedPair(p, S, { source: 'ja', target: 'en-us' })).toEqual({ source: 'en', target: 'ja' });
    expect(reversedPair(p, S, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en-us' });
    expect(reversedPair(p, S, { source: 'pt', target: 'es-mx' })).toEqual({ source: 'es', target: 'pt' });
  });

  it("takes, for a documented target the docs hide, the first offered target of its source: Chinese reverses to Simplified Chinese (choice 5)", () => {
    expect(reversedPair(p, S, { source: 'zh', target: 'en' })).toEqual({ source: 'en', target: 'zh-hans' });
    expect(reversedPair(p, S, { source: 'en', target: 'zh-hant' })).toEqual({ source: 'zh', target: 'en-us' });
  });

  it('has none where the docs give none: an auto source, a source with no documented target, a target with no documented source', () => {
    expect(reversedPair(p, S, { source: AUTO, target: 'en' })).toBeNull();
    for (const source of ['bn', 'eu', 'fa', 'ga', 'mn', 'mr', 'mt', 'ug', 'yue']) expect(reversedPair(p, S, { source, target: 'en' }), source).toBeNull();
    for (const target of ['az', 'bs', 'fil', 'is', 'kk', 'mk', 'sr']) expect(reversedPair(p, S, { source: 'en', target }), target).toBeNull();
  });

  it('refuses to reverse exactly an auto source, the nine sources and the seven targets above, and no other offered pair', () => {
    const NO_REVERSE_SOURCES = new Set(['bn', 'eu', 'fa', 'ga', 'mn', 'mr', 'mt', 'ug', 'yue']);
    const NO_REVERSE_TARGETS = new Set(['az', 'bs', 'fil', 'is', 'kk', 'mk', 'sr']);
    for (const source of codes(palabraLanguages.sources(S))) {
      for (const target of codes(palabraLanguages.targets(source, S))) {
        const expected = source !== AUTO && !NO_REVERSE_SOURCES.has(source) && !NO_REVERSE_TARGETS.has(target);
        expect(reverseSupported(p, S, { source, target }), `${source} → ${target}`).toBe(expected);
      }
    }
  });

  it('reverses every offered pair into the offer, or not at all', () => {
    for (const source of codes(palabraLanguages.sources(S))) {
      for (const target of codes(palabraLanguages.targets(source, S))) {
        const reversed = reversedPair(p, S, { source, target });
        expect(reverseSupported(p, S, { source, target }), `${source} → ${target}`).toBe(reversed !== null);
      }
    }
  });

  it('swaps into the reverse, and not at all when that is the same pair', () => {
    expect(swapped(p, S, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en-us' });
    expect(swapped(p, S, { source: 'ja', target: 'en-us' })).toEqual({ source: 'en', target: 'ja' });
    expect(swapped(p, S, { source: 'en', target: 'en-us' })).toBeNull();
    expect(swapped(p, S, { source: AUTO, target: 'ja' })).toBeNull();
  });
});
