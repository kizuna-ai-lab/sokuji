import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, SonioxSessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { SonioxClient } from '../clients/SonioxClient';
import { Provider, isKizunaManagedProvider } from '../../types/Provider';

// Soniox Settings — single BYOK API key (extractCredentials inherited from base)
export interface SonioxSettings {
  apiKey: string;
  sourceLanguage: string;     // 'auto' | ISO code
  targetLanguage: string;
  /** Both mode: use one shared two_way session (true) vs two separate sessions (false). */
  bothModeSharedSession: boolean;
  voice: string;              // TTS voice, one of VOICES
  model: string;
  /** Custom vocabulary, one term per line (raw textarea text → context.terms). */
  vocabularyTerms: string;
  /** Preferred translations, one "source=target" per line (→ context.translation_terms). */
  vocabularyTranslations: string;
  /** Free-form session background (agenda/topic/notes) → wire context.text. */
  contextText: string;
  /** Soniox endpoint_sensitivity, -1.0..1.0; 0 = server default. */
  endpointSensitivity: number;
  /** Soniox endpoint_latency_adjustment_level, 0..3; 0 = server default. */
  endpointLatencyAdjustmentLevel: number;
  /** TTS speaking rate, 0.7..1.3; 1.0 = normal. */
  ttsSpeed: number;
}

export const defaultSonioxSettings: SonioxSettings = {
  apiKey: '',
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  bothModeSharedSession: true,
  voice: 'Maya',
  model: 'stt-rt-v5',
  vocabularyTerms: '',
  vocabularyTranslations: '',
  contextText: '',
  endpointSensitivity: 0,
  endpointLatencyAdjustmentLevel: 0,
  ttsSpeed: 1.0,
};

/** One term per line; trimmed, empties dropped, duplicates removed. */
export function parseVocabularyTerms(raw: string): string[] {
  const seen = new Set<string>();
  for (const line of raw.split('\n')) {
    const term = line.trim();
    if (term) seen.add(term);
  }
  return [...seen];
}

/** One "source=target" per line; split on the FIRST '=', both sides trimmed
 *  and required non-empty. Lines without '=' are ignored. */
export function parseVocabularyTranslations(raw: string): Array<{ source: string; target: string }> {
  const out: Array<{ source: string; target: string }> = [];
  for (const line of raw.split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const source = line.slice(0, eq).trim();
    const target = line.slice(eq + 1).trim();
    if (source && target) out.push({ source, target });
  }
  return out;
}

function clampNumber(value: unknown, min: number, max: number, dflt: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : dflt;
}

// Soniox rejects a session whose serialized context exceeds ~10,000 chars
// ("Context is too long (max length 10000)"). The textarea maxLength caps only
// the RAW text: 1,000 four-char "a=b" lines fit in one textarea but serialize
// to ~26 KB of {"source":…,"target":…} objects. Budget the WIRE-shaped
// serialization (with headroom for the JSON scaffolding Soniox counts) so a
// session always starts; entries are dropped from the tail — the user's
// earlier lines win — taking the expensive translation pairs first.
const SONIOX_CONTEXT_CHAR_BUDGET = 9000;

function fitContextToBudget(
  terms: string[],
  translationTerms: Array<{ source: string; target: string }>,
  text: string
): { terms: string[]; translationTerms: Array<{ source: string; target: string }>; text: string } {
  const serializedSize = (): number =>
    JSON.stringify({
      ...(terms.length ? { terms } : {}),
      ...(translationTerms.length ? { translation_terms: translationTerms } : {}),
      ...(text ? { text } : {}),
    }).length;
  const dropped = { terms: 0, translationTerms: 0, textChars: 0 };
  // Background text is the weakest context evidence: truncate it first.
  // Raw-length arithmetic misjudges the cut when characters JSON-escape to
  // 2-6 output units (newlines and quotes are certain in pasted agendas), so
  // binary-search the longest prefix whose actual serialization fits the
  // budget (~12 stringify probes at connect time, once per session).
  if (text && serializedSize() > SONIOX_CONTEXT_CHAR_BUDGET) {
    const full = text;
    const fits = (keep: number): boolean => {
      text = full.slice(0, keep);
      return serializedSize() <= SONIOX_CONTEXT_CHAR_BUDGET;
    };
    let lo = 0;
    let hi = full.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    // A cut landing mid-surrogate-pair would leave a lone high surrogate
    // (serializes as a 6-char escape and renders as U+FFFD downstream).
    text = full.slice(0, lo).replace(/[\uD800-\uDBFF]$/, '');
    dropped.textChars = full.length - text.length;
  }
  while (serializedSize() > SONIOX_CONTEXT_CHAR_BUDGET && translationTerms.length) {
    translationTerms = translationTerms.slice(0, -1);
    dropped.translationTerms++;
  }
  while (serializedSize() > SONIOX_CONTEXT_CHAR_BUDGET && terms.length) {
    terms = terms.slice(0, -1);
    dropped.terms++;
  }
  if (dropped.terms || dropped.translationTerms || dropped.textChars) {
    console.warn(
      `[SonioxProviderConfig] Custom vocabulary/background exceeds the Soniox context size limit — ` +
      `truncated ${dropped.textChars} background char(s), dropped ${dropped.translationTerms} translation(s) ` +
      `and ${dropped.terms} term(s) from the end`
    );
  }
  return { terms, translationTerms, text };
}

// The managed start floor lives in its own import-free module so the Start
// gate (and the subtitle window that shares it) can read it without pulling
// SonioxClient — and the i18n bootstrap behind it — into their bundles.
// Re-exported here so this file stays the one place to look for Soniox config.
export {
  SONIOX_MANAGED_MIN_BALANCE_MICRO_USD,
  sonioxManagedMinBalanceMicroUsd,
} from './sonioxManagedMinBalance';

/**
 * Does Both mode run on ONE shared Soniox session for this provider?
 *
 * FORCED ON for the Kizuna-managed twin, whatever the stored preference says.
 * The managed backend's session lease is account-scoped and single-session: two
 * clients means the second `connect()` is refused with 409, so You→Others works
 * while Others→You silently does not. The user cannot be offered a mode the
 * backend structurally cannot honour, so `ProviderSpecificSettings` disables
 * the control and this function is the single source of truth both it and
 * `MainPanel` read (a stored `false` — e.g. carried over from BYOK use — must
 * not resurrect the half-failed session).
 *
 * BYOK Soniox keeps the choice: two keys, two sessions, no lease involved.
 */
export function sonioxUsesSharedBothSession(
  provider: Provider,
  settings: { bothModeSharedSession?: boolean } | null | undefined
): boolean {
  if (isKizunaManagedProvider(provider)) return true;
  return settings?.bothModeSharedSession ?? true;
}

export class SonioxProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'soniox';
  readonly supportsWebRTC = false;

  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new SonioxClient(creds.primary);
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return SonioxClient.validateApiKeyAndFetchModels(creds.primary);
  }

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as SonioxSettings;
    const { terms, translationTerms, text } = fitContextToBudget(
      parseVocabularyTerms(settings.vocabularyTerms ?? ''),
      parseVocabularyTranslations(settings.vocabularyTranslations ?? ''),
      (settings.contextText ?? '').trim()
    );
    return {
      provider: 'soniox',
      model: settings.model || 'stt-rt-v5',
      voice: settings.voice || 'Maya',
      instructions: systemInstructions,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      // Direction is derived from You/Others/Both at connect time; default one_way.
      // MainPanel sets bidirectional:true only for the shared-Both single-session path.
      bidirectional: false,
      ...(terms.length || translationTerms.length || text
        ? {
            context: {
              ...(terms.length ? { terms } : {}),
              ...(translationTerms.length ? { translationTerms } : {}),
              ...(text ? { text } : {}),
            },
          }
        : {}),
      // Clamped here (single choke point); the wire components omit the keys
      // when these carry the server-default values.
      endpointSensitivity: clampNumber(settings.endpointSensitivity, -1, 1, 0),
      endpointLatencyAdjustmentLevel: Math.round(
        clampNumber(settings.endpointLatencyAdjustmentLevel, 0, 3, 0)
      ),
      ttsSpeed: clampNumber(settings.ttsSpeed, 0.7, 1.3, 1.0),
    } as SonioxSessionConfig;
  }

  // The 60 languages from Soniox's own STS demo app — translation is
  // any-to-any across this set, so source and target share one list
  // (the "Auto Detect" source option is injected by the generic UI).
  private static readonly LANGUAGES: LanguageOption[] = [
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

  // Every voice is multilingual — any voice speaks any language (official
  // catalog, 2026-07-31; zh/ja/en live-verified 2026-07-18 for the original
  // twelve) — so one voice serves both two_way directions.
  private static readonly VOICES: VoiceOption[] = [
    { name: 'Adrian', value: 'Adrian' },
    { name: 'Claire', value: 'Claire' },
    { name: 'Daniel', value: 'Daniel' },
    { name: 'Emma', value: 'Emma' },
    { name: 'Grace', value: 'Grace' },
    { name: 'Jack', value: 'Jack' },
    { name: 'Kenji', value: 'Kenji' },
    { name: 'Maya', value: 'Maya' },
    { name: 'Mina', value: 'Mina' },
    { name: 'Nina', value: 'Nina' },
    { name: 'Noah', value: 'Noah' },
    { name: 'Owen', value: 'Owen' },
    // Accented additions (official catalog, 2026-07-31):
    { name: 'Rafael', value: 'Rafael' },     // Spanish accent
    { name: 'Mateo', value: 'Mateo' },       // Spanish accent
    { name: 'Lucia', value: 'Lucia' },       // Spanish accent
    { name: 'Sofia', value: 'Sofia' },       // Spanish accent
    { name: 'Oliver', value: 'Oliver' },     // British accent
    { name: 'Arthur', value: 'Arthur' },     // British accent
    { name: 'Isla', value: 'Isla' },         // British accent
    { name: 'Victoria', value: 'Victoria' }, // British accent
    { name: 'Cooper', value: 'Cooper' },     // Australian accent
    { name: 'Mason', value: 'Mason' },       // Australian accent
    { name: 'Ruby', value: 'Ruby' },         // Australian accent
    { name: 'Elise', value: 'Elise' },       // Australian accent
    { name: 'Arjun', value: 'Arjun' },       // Indian accent
    { name: 'Rohan', value: 'Rohan' },       // Indian accent
    { name: 'Priya', value: 'Priya' },       // Indian accent
    { name: 'Meera', value: 'Meera' },       // Indian accent
  ];

  private static readonly MODELS: ModelOption[] = [
    { id: 'stt-rt-v5', type: 'realtime' }
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'soniox',
      displayName: 'Soniox',

      apiKeyLabel: 'API Key',
      apiKeyPlaceholder: 'Enter your Soniox API Key',

      languages: SonioxProviderConfig.LANGUAGES,
      voices: SonioxProviderConfig.VOICES,
      models: SonioxProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: false, // dedicated translation service — no prompt templates
        hasTurnDetection: false, // server-side endpoint detection, not user-configurable
        hasVoiceSettings: true, // TTS voice dropdown (28 multilingual voices)
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        textOnlyCapability: 'optional', // toggle: subtitles-only vs spoken translation

        turnDetection: {
          modes: [],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: false,
          hasSemanticEagerness: false,
        },

        temperatureRange: { min: 0.0, max: 1.0, step: 0.1 },
        maxTokensRange: { min: 1, max: 4096, step: 1 },
      },
    };
  }
}
