/**
 * Soniox's `S`, languages and credentials (survey §2.2–2.5). `S` is the old
 * slice (`SonioxProviderConfig.ts:13-71`) without what leaves it: the pair
 * (`providerStore` persists `sourceLanguage` / `targetLanguage` under the
 * same keys), the three region keys (credentials now, same keys), and
 * `model` (only ever `stt-rt-v5`: a constant in `config.ts`; its stored value
 * stays in storage, unread). Stored under `settings.soniox.*` as before.
 */
import { AUTO } from '../../lib/provider/languages';
import type { CredentialsMissing, LanguageOption, Provider } from '../../lib/provider/types';
import { asSonioxRegion, DEFAULT_SONIOX_REGION, type SonioxRegion } from '../../lib/soniox/regions';
import { SONIOX_DEFAULT_VOICE } from '../../lib/soniox/ttsCatalog';

export interface SonioxSettings {
  /** Which deployment: each region is a separate Soniox project with its own key. */
  region: SonioxRegion;
  /** The TTS voice per region: a cloned voice is a UUID inside one project. */
  voice: string;
  voiceEu: string;
  voiceJp: string;
  /** Both mode on one shared two_way session (true) or two sessions (false). */
  bothModeSharedSession: boolean;
  /** Custom vocabulary, one term per line (→ context.terms). */
  vocabularyTerms: string;
  /** Preferred translations, one "source=target" per line (→ context.translation_terms). */
  vocabularyTranslations: string;
  /** Free-form session background (→ context.text). */
  contextText: string;
  /** endpoint_sensitivity, -1..1; 0 = the server default. */
  endpointSensitivity: number;
  /** endpoint_latency_adjustment_level, 0..3; 0 = the server default. */
  endpointLatencyAdjustmentLevel: number;
  /** max_endpoint_delay_ms, 500..3000; 2000 = the server default. */
  endpointMaxDelayMs: number;
  /** TTS speaking rate, 0.7..1.3. */
  ttsSpeed: number;
}

export const SONIOX_DEFAULTS: SonioxSettings = {
  region: DEFAULT_SONIOX_REGION,
  voice: SONIOX_DEFAULT_VOICE,
  voiceEu: SONIOX_DEFAULT_VOICE,
  voiceJp: SONIOX_DEFAULT_VOICE,
  bothModeSharedSession: true,
  vocabularyTerms: '',
  vocabularyTranslations: '',
  contextText: '',
  endpointSensitivity: 0,
  endpointLatencyAdjustmentLevel: 0,
  endpointMaxDelayMs: 2000,
  ttsSpeed: 1.0,
};

type StringField = 'voice' | 'voiceEu' | 'voiceJp' | 'vocabularyTerms' | 'vocabularyTranslations' | 'contextText';
type NumberField = 'endpointSensitivity' | 'endpointLatencyAdjustmentLevel' | 'endpointMaxDelayMs' | 'ttsSpeed';

/** What was stored, made valid field by field; clamping stays in `build`, as the old descriptor did. Nothing is written back. */
export function migrateSonioxSettings(stored: Readonly<Record<string, unknown>>): SonioxSettings {
  const str = (k: StringField) => (typeof stored[k] === 'string' ? (stored[k] as string) : SONIOX_DEFAULTS[k]);
  const num = (k: NumberField) => {
    const v = stored[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : SONIOX_DEFAULTS[k];
  };
  return {
    region: asSonioxRegion(stored.region),
    voice: str('voice'),
    voiceEu: str('voiceEu'),
    voiceJp: str('voiceJp'),
    bothModeSharedSession: typeof stored.bothModeSharedSession === 'boolean' ? stored.bothModeSharedSession : SONIOX_DEFAULTS.bothModeSharedSession,
    vocabularyTerms: str('vocabularyTerms'),
    vocabularyTranslations: str('vocabularyTranslations'),
    contextText: str('contextText'),
    endpointSensitivity: num('endpointSensitivity'),
    endpointLatencyAdjustmentLevel: num('endpointLatencyAdjustmentLevel'),
    endpointMaxDelayMs: num('endpointMaxDelayMs'),
    ttsSpeed: num('ttsSpeed'),
  };
}

export type SonioxKeyField = 'apiKey' | 'apiKeyEu' | 'apiKeyJp';
export const SONIOX_KEY_FIELDS: readonly SonioxKeyField[] = ['apiKey', 'apiKeyEu', 'apiKeyJp'];
const REGION_OF_KEY: Readonly<Record<SonioxKeyField, SonioxRegion>> = { apiKey: 'us', apiKeyEu: 'eu', apiKeyJp: 'jp' };

/** The field holding a region's key: the only mapping from region to storage (the old descriptor's rule). */
export function sonioxKeyField(region: SonioxRegion): SonioxKeyField {
  return region === 'us' ? 'apiKey' : region === 'eu' ? 'apiKeyEu' : 'apiKeyJp';
}

/** The field holding a region's voice: a cloned voice is a UUID inside one region's project. */
export function sonioxVoiceField(region: SonioxRegion): 'voice' | 'voiceEu' | 'voiceJp' {
  return region === 'us' ? 'voice' : region === 'eu' ? 'voiceEu' : 'voiceJp';
}

/** What Kizuna Soniox's lease will hand the adapter (Plan B's seam; survey §2.12). An own key has none. */
export interface SonioxLeasePort {
  /** Soniox accepted the key: the first frame on each STT socket (the managed `session-started`). */
  streamAccepted(): void;
  /** Whether a 403 now is the granted duration ending rather than an error. */
  atGrantEnd(now: number): boolean;
  /** The granted duration ended: the lease ends the run with its own words (`segment_ended`). */
  cutoff(): void;
}

/** One leg's credentials. An own key serves both sockets and sends no client reference (ruling 7). */
export interface SonioxCredentials {
  region: SonioxRegion;
  /** The STT socket's key. */
  stt: string;
  /** The TTS socket's key; absent, the leg runs text-only (a managed lease that issued none). */
  tts?: string;
  /** Managed only: inert on the wire — Soniox bills by the reference bound to the key (survey §3.7.1). */
  clientReferenceId?: string;
  /** Managed only: the lease the adapter reports to. Present, a 503 is not resumed. */
  lease?: SonioxLeasePort;
}

export const sonioxCredentials: Provider<SonioxSettings, SonioxCredentials, never>['credentials'] = {
  keys: SONIOX_KEY_FIELDS,
  fields: (s) => [{ key: sonioxKeyField(asSonioxRegion(s.region)), labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'providers.soniox.apiKeyPlaceholder' }],
  // `values` holds exactly the one field `fields(s)` shows, so its key names the region (spec: "read sees the values of exactly the fields").
  read: (values): SonioxCredentials | CredentialsMissing => {
    const field = SONIOX_KEY_FIELDS.find((k) => k in values) ?? 'apiKey';
    const region = REGION_OF_KEY[field];
    const key = values[field] ?? '';
    if (!key) return { missing: `Enter your Soniox API key for the ${region.toUpperCase()} region.` };
    return { region, stt: key, tts: key };
  },
};

/** The 60 languages of Soniox's own STS demo: translation is any-to-any across them. */
export const SONIOX_LANGUAGES: readonly LanguageOption[] = [
  { name: 'Afrikaans', value: 'af', englishName: 'Afrikaans' },
  { name: 'Shqip', value: 'sq', englishName: 'Albanian' },
  { name: 'العربية', value: 'ar', englishName: 'Arabic' },
  { name: 'Azərbaycan', value: 'az', englishName: 'Azerbaijani' },
  { name: 'Euskara', value: 'eu', englishName: 'Basque' },
  { name: 'Беларуская', value: 'be', englishName: 'Belarusian' },
  { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
  { name: 'Bosanski', value: 'bs', englishName: 'Bosnian' },
  { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
  { name: 'Català', value: 'ca', englishName: 'Catalan' },
  { name: '中文', value: 'zh', englishName: 'Chinese' },
  { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
  { name: 'Čeština', value: 'cs', englishName: 'Czech' },
  { name: 'Dansk', value: 'da', englishName: 'Danish' },
  { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
  { name: 'English', value: 'en', englishName: 'English' },
  { name: 'Eesti', value: 'et', englishName: 'Estonian' },
  { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
  { name: 'Français', value: 'fr', englishName: 'French' },
  { name: 'Galego', value: 'gl', englishName: 'Galician' },
  { name: 'Deutsch', value: 'de', englishName: 'German' },
  { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
  { name: 'ગુજરાતી', value: 'gu', englishName: 'Gujarati' },
  { name: 'עברית', value: 'he', englishName: 'Hebrew' },
  { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
  { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
  { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
  { name: 'Italiano', value: 'it', englishName: 'Italian' },
  { name: '日本語', value: 'ja', englishName: 'Japanese' },
  { name: 'ಕನ್ನಡ', value: 'kn', englishName: 'Kannada' },
  { name: 'Қазақ', value: 'kk', englishName: 'Kazakh' },
  { name: '한국어', value: 'ko', englishName: 'Korean' },
  { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
  { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
  { name: 'Македонски', value: 'mk', englishName: 'Macedonian' },
  { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
  { name: 'മലയാളം', value: 'ml', englishName: 'Malayalam' },
  { name: 'मराठी', value: 'mr', englishName: 'Marathi' },
  { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
  { name: 'فارسی', value: 'fa', englishName: 'Persian' },
  { name: 'Polski', value: 'pl', englishName: 'Polish' },
  { name: 'Português', value: 'pt', englishName: 'Portuguese' },
  { name: 'ਪੰਜਾਬੀ', value: 'pa', englishName: 'Punjabi' },
  { name: 'Română', value: 'ro', englishName: 'Romanian' },
  { name: 'Русский', value: 'ru', englishName: 'Russian' },
  { name: 'Српски', value: 'sr', englishName: 'Serbian' },
  { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
  { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
  { name: 'Español', value: 'es', englishName: 'Spanish' },
  { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
  { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
  { name: 'Tagalog', value: 'tl', englishName: 'Tagalog' },
  { name: 'தமிழ்', value: 'ta', englishName: 'Tamil' },
  { name: 'తెలుగు', value: 'te', englishName: 'Telugu' },
  { name: 'ไทย', value: 'th', englishName: 'Thai' },
  { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
  { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
  { name: 'اردو', value: 'ur', englishName: 'Urdu' },
  { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  { name: 'Cymraeg', value: 'cy', englishName: 'Welsh' },
];

export const sonioxLanguages: Provider<SonioxSettings, never, never>['languages'] = {
  sources: () => [{ value: AUTO, name: 'Auto', englishName: 'Auto' }, ...SONIOX_LANGUAGES],
  // Every language, the source's own included, as the old resolveTargetLanguages returned (survey §2.5).
  targets: () => SONIOX_LANGUAGES,
  initial: () => ({ source: AUTO, target: 'en' }),
};
