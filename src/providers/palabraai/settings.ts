/**
 * Palabra AI's `S`, credentials and languages (survey §2.3–2.6). `S` is the
 * old slice (`PalabraAIProviderConfig.ts:8-24`) without what leaves it — the
 * three credentials (same keys), the pair (`providerStore`, same keys) and
 * the two fields nothing read (`subscriberCount`, `publisherCanSubscribe`).
 * Stored under `settings.palabraai.*` as before; nothing is converted on the
 * way in (ruling 2). Nothing here imports `src/services`.
 */
import { AUTO } from '../../lib/provider/languages';
import type { CredentialField, CredentialsMissing, LanguageOption, LanguagePair, Provider } from '../../lib/provider/types';

/** Which credentials a run sends (ruling 1): the platform's API key, or the legacy app's Client ID and Client Secret. */
export type PalabraAuthMode = 'platform' | 'app';
/** Palabra's two built-in voices (`PalabraAIProviderConfig.ts:321-324`). */
export type PalabraVoice = 'default_low' | 'default_high';

export interface PalabraSettings {
  /** Picked in the credential form (F4). A profile that stored none opens in the platform mode (ruling 2). */
  authMode: PalabraAuthMode;
  voiceId: PalabraVoice;
  /** Seconds of silence that confirm a sentence (`segment_confirmation_silence_threshold`); `build` clamps it to `SILENCE_THRESHOLD_RANGE`. */
  segmentConfirmationSilenceThreshold: number;
  sentenceSplitterEnabled: boolean;
  translatePartialTranscriptions: boolean;
  /** The translated speech Palabra keeps buffered, in ms; `build` clamps it to `DESIRED_QUEUE_RANGE`. */
  desiredQueueLevelMs: number;
  /** The buffer's ceiling, in ms; `build` keeps it above the target (`effectiveQueue`). */
  maxQueueLevelMs: number;
  autoTempo: boolean;
}

/** The old defaults (`PalabraAIProviderConfig.ts:26-42`), ours rather than Palabra's recommended 5 000 / 20 000 with adaptive speed on (ruling 10). */
export const PALABRA_DEFAULTS: PalabraSettings = {
  authMode: 'platform',
  voiceId: 'default_low',
  segmentConfirmationSilenceThreshold: 0.7,
  sentenceSplitterEnabled: true,
  translatePartialTranscriptions: false,
  desiredQueueLevelMs: 8_000,
  maxQueueLevelMs: 24_000,
  autoTempo: false,
};

/** The silence threshold's range: the API's own — the owner's probe saw 0.1 refused, "ensure this value is greater than or equal to 0.3" — and the slider's (ruling 10). */
export const SILENCE_THRESHOLD_RANGE = { min: 0.3, max: 2, step: 0.01 } as const;
/** The target buffer's slider, as the old one (`ProviderSpecificSettings.tsx:1398-1406`). */
export const DESIRED_QUEUE_RANGE = { min: 3_000, max: 15_000, step: 1_000 } as const;
/** The max buffer's slider, as the old one; its floor follows the target (`maxQueueFloor`). */
export const MAX_QUEUE_RANGE = { min: 12_000, max: 60_000, step: 3_000 } as const;

const clamp = (value: number, range: { min: number; max: number }) => Math.min(range.max, Math.max(range.min, value));

/**
 * The max buffer's floor for a target (ruling 10): the first value of the
 * max slider's grid above it, and never below the slider's own minimum.
 * The API refuses a max that is not above the target — the owner's probe:
 * "`max_queue_level_ms` must be greater than `desired_queue_level_ms`".
 */
export function maxQueueFloor(desiredMs: number): number {
  return Math.max(MAX_QUEUE_RANGE.min, (Math.floor(desiredMs / MAX_QUEUE_RANGE.step) + 1) * MAX_QUEUE_RANGE.step);
}

/** The buffer a session asks for, the same numbers the view shows: the target on its slider, the max on its own, raised to the target's floor (ruling 10). */
export function effectiveQueue(s: Pick<PalabraSettings, 'desiredQueueLevelMs' | 'maxQueueLevelMs'>): { desiredMs: number; maxMs: number } {
  const desiredMs = clamp(s.desiredQueueLevelMs, DESIRED_QUEUE_RANGE);
  return { desiredMs, maxMs: clamp(s.maxQueueLevelMs, { min: maxQueueFloor(desiredMs), max: MAX_QUEUE_RANGE.max }) };
}

/** The threshold a session sends, the same number the view shows (ruling 10). */
export function effectiveThreshold(s: Pick<PalabraSettings, 'segmentConfirmationSilenceThreshold'>): number {
  return clamp(s.segmentConfirmationSilenceThreshold, SILENCE_THRESHOLD_RANGE);
}

const AUTH_MODES: readonly unknown[] = ['platform', 'app'];
const VOICES: readonly unknown[] = ['default_low', 'default_high'];
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** What was stored, made valid field by field; a number out of range is kept and clamped where it is used. Nothing is written back. */
export function migratePalabraSettings(stored: Readonly<Record<string, unknown>>): PalabraSettings {
  const d = PALABRA_DEFAULTS;
  return {
    authMode: AUTH_MODES.includes(stored.authMode) ? (stored.authMode as PalabraAuthMode) : d.authMode,
    voiceId: VOICES.includes(stored.voiceId) ? (stored.voiceId as PalabraVoice) : d.voiceId,
    segmentConfirmationSilenceThreshold: finite(stored.segmentConfirmationSilenceThreshold, d.segmentConfirmationSilenceThreshold),
    sentenceSplitterEnabled: flag(stored.sentenceSplitterEnabled, d.sentenceSplitterEnabled),
    translatePartialTranscriptions: flag(stored.translatePartialTranscriptions, d.translatePartialTranscriptions),
    desiredQueueLevelMs: finite(stored.desiredQueueLevelMs, d.desiredQueueLevelMs),
    maxQueueLevelMs: finite(stored.maxQueueLevelMs, d.maxQueueLevelMs),
    autoTempo: flag(stored.autoTempo, d.autoTempo),
  };
}

/** Palabra's two voices, named in English as the old list named them. */
export const PALABRA_VOICES: ReadonlyArray<{ value: PalabraVoice; name: string }> = [
  { value: 'default_low', name: 'Default Low' },
  { value: 'default_high', name: 'Default High' },
];

/** One leg's credentials: the kind decides the connect path (ruling 1; `wire.ts`). */
export type PalabraCredentials =
  | { kind: 'apiKey'; apiKey: string }
  | { kind: 'app'; clientId: string; clientSecret: string };

const API_KEY: CredentialField = { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'providers.palabraai.apiKeyPlaceholder' };
/** Labelled by the old placeholders, as the old wizard labelled them (`PalabraAIProviderConfig.ts:59-62`). */
const CLIENT_ID: CredentialField = { key: 'clientId', labelKey: 'providers.palabraai.clientIdPlaceholder', secret: true };
const CLIENT_SECRET: CredentialField = { key: 'clientSecret', labelKey: 'providers.palabraai.clientSecretPlaceholder', secret: true };

/** A stored value as text: a store may hand a value stored as a number back as one. */
const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v)).trim();

export const palabraCredentials: Provider<PalabraSettings, PalabraCredentials, never>['credentials'] = {
  keys: ['apiKey', 'clientId', 'clientSecret'],
  fields: (s) => (s.authMode === 'app' ? [CLIENT_ID, CLIENT_SECRET] : [API_KEY]),
  // `values` holds exactly the fields `fields(s)` shows, so its keys name the mode.
  read: (values): PalabraCredentials | CredentialsMissing => {
    if ('apiKey' in values) {
      const apiKey = text(values.apiKey);
      // No code: the runner words it `credentials_missing` ("Enter your API key in Settings before starting.").
      return apiKey ? { kind: 'apiKey', apiKey } : { missing: 'Enter the API key of your Palabra AI account.' };
    }
    const clientId = text(values.clientId);
    const clientSecret = text(values.clientSecret);
    return clientId && clientSecret ? { kind: 'app', clientId, clientSecret } : { missing: 'Enter the Client ID and the Client Secret of your Palabra AI app.' };
  },
  choice: {
    setting: 'authMode',
    options: [
      { value: 'platform', labelKey: 'providers.palabraai.authModePlatform' },
      { value: 'app', labelKey: 'providers.palabraai.authModeApp' },
    ],
  },
};

/**
 * Palabra's documented languages (ruling 8): the docs' own tables, read
 * from the `models-map` their language page loads (2026-09-29) — each row
 * its code, its native name, its English name, and the code its docs give
 * the other way round (`to_target` for a source, `to_source` for a target;
 * null where they give none). In English-name order. The targets the docs
 * hide (`en-au`, `en-ca`, and plain `zh`) are not offered.
 */
type Row = readonly [code: string, name: string, englishName: string, other: string | null];

const SOURCE_ROWS: readonly Row[] = [
  ['ar', 'العربية', 'Arabic', 'ar'],
  ['hy', 'Հայերեն', 'Armenian', 'hy'],
  ['eu', 'Euskara', 'Basque', null],
  ['be', 'Беларуская', 'Belarusian', 'be'],
  ['bn', 'বাংলা', 'Bengali', null],
  ['bg', 'Български', 'Bulgarian', 'bg'],
  ['yue', '粵語', 'Cantonese', null],
  ['ca', 'Català', 'Catalan', 'ca'],
  ['zh', '中文', 'Chinese', 'zh'],
  ['hr', 'Hrvatski', 'Croatian', 'hr'],
  ['cs', 'Čeština', 'Czech', 'cs'],
  ['da', 'Dansk', 'Danish', 'da'],
  ['nl', 'Nederlands', 'Dutch', 'nl'],
  ['en', 'English', 'English', 'en-us'],
  ['et', 'Eesti', 'Estonian', 'et'],
  ['fil', 'Filipino', 'Filipino', 'fil'],
  ['fi', 'Suomi', 'Finnish', 'fi'],
  ['fr', 'Français', 'French', 'fr'],
  ['gl', 'Galego', 'Galician', 'gl'],
  ['de', 'Deutsch', 'German', 'de'],
  ['el', 'Ελληνικά', 'Greek', 'el'],
  ['he', 'עברית', 'Hebrew', 'he'],
  ['hi', 'हिन्दी', 'Hindi', 'hi'],
  ['hu', 'Magyar', 'Hungarian', 'hu'],
  ['id', 'Bahasa Indonesia', 'Indonesian', 'id'],
  ['ga', 'Gaeilge', 'Irish', null],
  ['it', 'Italiano', 'Italian', 'it'],
  ['ja', '日本語', 'Japanese', 'ja'],
  ['kk', 'Қазақша', 'Kazakh', 'kk'],
  ['ko', '한국어', 'Korean', 'ko'],
  ['lv', 'Latviešu', 'Latvian', 'lv'],
  ['lt', 'Lietuvių', 'Lithuanian', 'lt'],
  ['mk', 'Македонски', 'Macedonian', 'mk'],
  ['ms', 'Bahasa Melayu', 'Malay', 'ms'],
  ['mt', 'Malti', 'Maltese', null],
  ['mr', 'मराठी', 'Marathi', null],
  ['mn', 'Монгол', 'Mongolian', null],
  ['no', 'Norsk', 'Norwegian', 'no'],
  ['fa', 'فارسی', 'Persian', null],
  ['pl', 'Polski', 'Polish', 'pl'],
  ['pt', 'Português', 'Portuguese', 'pt'],
  ['ro', 'Română', 'Romanian', 'ro'],
  ['ru', 'Русский', 'Russian', 'ru'],
  ['sr', 'Српски', 'Serbian', 'sr'],
  ['sk', 'Slovenčina', 'Slovak', 'sk'],
  ['sl', 'Slovenščina', 'Slovenian', 'sl'],
  ['es', 'Español', 'Spanish', 'es'],
  ['sw', 'Kiswahili', 'Swahili', 'sw'],
  ['sv', 'Svenska', 'Swedish', 'sv'],
  ['ta', 'தமிழ்', 'Tamil', 'ta'],
  ['th', 'ไทย', 'Thai', 'th'],
  ['tr', 'Türkçe', 'Turkish', 'tr'],
  ['uk', 'Українська', 'Ukrainian', 'uk'],
  ['ur', 'اردو', 'Urdu', 'ur'],
  ['ug', 'ئۇيغۇرچە', 'Uyghur', null],
  ['vi', 'Tiếng Việt', 'Vietnamese', 'vi'],
  ['cy', 'Cymraeg', 'Welsh', 'cy'],
];

const TARGET_ROWS: readonly Row[] = [
  ['ar', 'العربية الفصحى', 'Arabic', 'ar'],
  ['ar-sa', 'العربية (السعودية)', 'Arabic (Saudi Arabia)', 'ar'],
  ['ar-ae', 'العربية (الإمارات)', 'Arabic (UAE)', 'ar'],
  ['hy', 'Հայերեն', 'Armenian', 'hy'],
  ['az', 'Azərbaycan dili', 'Azerbaijani', null],
  ['be', 'Беларуская', 'Belarusian', 'be'],
  ['bs', 'Bosanski', 'Bosnian', null],
  ['bg', 'Български', 'Bulgarian', 'bg'],
  ['ca', 'Català', 'Catalan', 'ca'],
  ['zh-hans', '简体中文', 'Chinese (Simplified)', 'zh'],
  ['zh-hant', '繁體中文', 'Chinese (Traditional)', 'zh'],
  ['hr', 'Hrvatski', 'Croatian', 'hr'],
  ['cs', 'Čeština', 'Czech', 'cs'],
  ['da', 'Dansk', 'Danish', 'da'],
  ['nl', 'Nederlands', 'Dutch', 'nl'],
  ['en', 'English', 'English', 'en'],
  ['en-gb', 'English (UK)', 'English (UK)', 'en'],
  ['en-us', 'English (US)', 'English (US)', 'en'],
  ['et', 'Eesti', 'Estonian', 'et'],
  ['fil', 'Filipino', 'Filipino', null],
  ['fi', 'Suomi', 'Finnish', 'fi'],
  ['fr', 'Français', 'French', 'fr'],
  ['fr-ca', 'Français (Canada)', 'French (Canada)', 'fr'],
  ['gl', 'Galego', 'Galician', 'gl'],
  ['de', 'Deutsch', 'German', 'de'],
  ['el', 'Ελληνικά', 'Greek', 'el'],
  ['he', 'עברית', 'Hebrew', 'he'],
  ['hi', 'हिन्दी', 'Hindi', 'hi'],
  ['hu', 'Magyar', 'Hungarian', 'hu'],
  ['is', 'Íslenska', 'Icelandic', null],
  ['id', 'Bahasa Indonesia', 'Indonesian', 'id'],
  ['it', 'Italiano', 'Italian', 'it'],
  ['ja', '日本語', 'Japanese', 'ja'],
  ['kk', 'Қазақ тілі', 'Kazakh', null],
  ['ko', '한국어', 'Korean', 'ko'],
  ['lv', 'Latviešu', 'Latvian', 'lv'],
  ['lt', 'Lietuvių', 'Lithuanian', 'lt'],
  ['mk', 'Македонски', 'Macedonian', null],
  ['ms', 'Bahasa Melayu', 'Malay', 'ms'],
  ['no', 'Norsk', 'Norwegian', 'no'],
  ['pl', 'Polski', 'Polish', 'pl'],
  ['pt', 'Português', 'Portuguese', 'pt'],
  ['pt-br', 'Português (Brasil)', 'Portuguese (Brazil)', 'pt'],
  ['ro', 'Română', 'Romanian', 'ro'],
  ['ru', 'Русский', 'Russian', 'ru'],
  ['sr', 'Српски', 'Serbian', null],
  ['sk', 'Slovenčina', 'Slovak', 'sk'],
  ['sl', 'Slovenščina', 'Slovenian', 'sl'],
  ['es', 'Español', 'Spanish', 'es'],
  ['es-ar', 'Español (Argentina)', 'Spanish (Argentina)', 'es'],
  ['es-ch', 'Español (Chile)', 'Spanish (Chile)', 'es'],
  ['es-co', 'Español (Colombia)', 'Spanish (Colombia)', 'es'],
  ['es-la', 'Español (Latin America)', 'Spanish (Latin America)', 'es'],
  ['es-mx', 'Español (México)', 'Spanish (Mexico)', 'es'],
  ['sw', 'Kiswahili', 'Swahili', 'sw'],
  ['sv', 'Svenska', 'Swedish', 'sv'],
  ['ta', 'தமிழ்', 'Tamil', 'ta'],
  ['th', 'ไทย', 'Thai', 'th'],
  ['tr', 'Türkçe', 'Turkish', 'tr'],
  ['uk', 'Українська', 'Ukrainian', 'uk'],
  ['ur', 'اردو', 'Urdu', 'ur'],
  ['vi', 'Tiếng Việt', 'Vietnamese', 'vi'],
  ['cy', 'Cymraeg', 'Welsh', 'cy'],
];

/** The targets the docs hide, with their source code: `zh` is still one source's documented `to_target`. */
const HIDDEN_TARGETS: Readonly<Record<string, string>> = { zh: 'zh', 'en-au': 'en', 'en-ca': 'en' };

const option = ([value, name, englishName]: Row): LanguageOption => ({ value, name, englishName });
/** Auto-detect first, as every provider that detects offers it (ruling 8), then the documented sources. */
const SOURCES: readonly LanguageOption[] = [{ value: AUTO, name: 'Auto', englishName: 'Auto' }, ...SOURCE_ROWS.map(option)];
const TARGETS: readonly LanguageOption[] = TARGET_ROWS.map(option);
const TO_TARGET: ReadonlyMap<string, string | null> = new Map(SOURCE_ROWS.map(([code, , , other]) => [code, other]));
const TO_SOURCE: ReadonlyMap<string, string | null> = new Map(TARGET_ROWS.map(([code, , , other]) => [code, other]));

/**
 * A source's documented target, as offered: one the docs hide takes the
 * first offered target of its own source — `zh`'s documented `to_target`
 * is the hidden `zh`, so Chinese reverses to Simplified Chinese (choice 5).
 */
function offeredTarget(code: string | null | undefined): string | null {
  if (!code) return null;
  if (TO_SOURCE.has(code)) return code;
  const source = HIDDEN_TARGETS[code];
  return source === undefined ? null : (TARGET_ROWS.find(([, , , other]) => other === source)?.[0] ?? null);
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
