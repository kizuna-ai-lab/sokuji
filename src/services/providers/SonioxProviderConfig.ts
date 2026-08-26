import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, CredentialCtx, ClientOptions, ParticipantSessionResult, BothModePlan, type CredentialField } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, SonioxSessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { SonioxClient } from '../clients/SonioxClient';
import { byokCredentials } from '../clients/ManagedSonioxSession';
import { SONIOX_VOICES, SONIOX_DEFAULT_VOICE } from '../../lib/soniox/ttsCatalog';
import { sonioxBothModePlan, SonioxBothModeScope } from './sonioxBothMode';
import { asSonioxRegion, DEFAULT_SONIOX_REGION, type SonioxRegion } from '../../lib/soniox/regions';
import { reportWarning } from '../../lib/diagnostics/report';

// Soniox Settings — single BYOK API key (extractCredentials inherited from base)
export interface SonioxSettings {
  /**
   * Which Soniox deployment to use. Soniox issues a SEPARATE key per regional
   * project, so this selects a whole credential, not just a route.
   */
  region: SonioxRegion;
  /** US/global project key. The suffix-less name pairs with the infix-less
   *  host, which is also what makes this backward compatible: a value stored
   *  before regions existed is still exactly what it was. */
  apiKey: string;
  apiKeyEu: string;
  apiKeyJp: string;
  sourceLanguage: string;     // 'auto' | ISO code
  targetLanguage: string;
  /** Both mode: use one shared two_way session (true) vs two separate sessions (false). */
  bothModeSharedSession: boolean;
  /** TTS voice for the US project. A cloned voice is a UUID INSIDE one
   *  project, so each region needs its own selection — sharing one field would
   *  send a UUID to a region where it does not exist. */
  voice: string;
  voiceEu: string;
  voiceJp: string;
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
  region: DEFAULT_SONIOX_REGION,
  apiKey: '',
  apiKeyEu: '',
  apiKeyJp: '',
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  bothModeSharedSession: true,
  voice: SONIOX_DEFAULT_VOICE,
  voiceEu: SONIOX_DEFAULT_VOICE,
  voiceJp: SONIOX_DEFAULT_VOICE,
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

export function clampNumber(value: unknown, min: number, max: number, dflt: number): number {
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
    // The user typed this vocabulary and it was silently cut to fit the
    // provider's context budget, which changes what gets recognised.
    reportWarning(
      'SonioxConfig',
      `Custom vocabulary exceeds the Soniox context limit — truncated ${dropped.textChars} background char(s), ` +
      `dropped ${dropped.translationTerms} translation(s) and ${dropped.terms} term(s) from the end`
    );
  }
  return { terms, translationTerms, text };
}

// The managed start floor lives in its own import-free module so the Start
// gate (and the subtitle window that shares it) can read it without pulling
// SonioxClient — and the i18n bootstrap behind it — into their bundles.
// Re-exported here so this file stays the one place to look for Soniox config.
export {
  SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR,
  SONIOX_MANAGED_MIN_SESSION_S,
  SONIOX_MANAGED_MIN_BALANCE_MICRO_USD,
  sonioxManagedMinBalanceMicroUsd,
} from './sonioxManagedMinBalance';

// Moved into sonioxBothMode.ts (its main consumer) so that this class can
// import sonioxBothModePlan for the planBothMode override without a cycle;
// re-exported here so existing importers keep working.
export { sonioxUsesSharedBothSession } from './sonioxBothMode';

/** The settings field holding a region's API key. The ONLY mapping from region
 *  to storage — every reader and writer goes through this, so adding a region
 *  is a change in one place. */
export function sonioxKeyField(region: SonioxRegion): 'apiKey' | 'apiKeyEu' | 'apiKeyJp' {
  return region === 'us' ? 'apiKey' : region === 'eu' ? 'apiKeyEu' : 'apiKeyJp';
}

/** The settings field holding a region's selected voice. Same rule, same reason. */
export function sonioxVoiceField(region: SonioxRegion): 'voice' | 'voiceEu' | 'voiceJp' {
  return region === 'us' ? 'voice' : region === 'eu' ? 'voiceEu' : 'voiceJp';
}

export class SonioxProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'soniox';
  readonly supportsWebRTC = false;
  // Default region is 'us' → sonioxKeyField('us') === 'apiKey', which matches
  // the base default already. Made explicit so a future default-region change
  // fails descriptorRegistry.test.ts's invariant loudly rather than silently.
  readonly credentialFields: readonly CredentialField[] = [
    { key: sonioxKeyField(DEFAULT_SONIOX_REGION), labelKey: 'setup.credentials.apiKey', secret: true },
  ];

  /** One key per region, and extractCredentials reads the ACTIVE region's slot
   *  — so the input the wizard renders has to write that same slot. Mapping the
   *  declared list (rather than returning a fresh one) keeps the managed twin,
   *  which declares no fields at all, declaring none here too. */
  credentialFieldsFor(settings: unknown): readonly CredentialField[] {
    const key = sonioxKeyField(asSonioxRegion((settings as SonioxSettings | null)?.region));
    return this.credentialFields.map((f) => ({ ...f, key }));
  }

  /**
   * Pick the ACTIVE region's key, and carry the region in `endpoint`.
   *
   * `endpoint` is the carrier, not an abuse of it: settingsStore already keys
   * its validation cache on it, so three regions become three cache entries
   * with no new mechanism — switching region re-validates for free, and two
   * regions holding the same key string never share a verdict.
   */
  async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    const settings = slice as SonioxSettings | null;
    const region = asSonioxRegion(settings?.region);
    const apiKey = settings?.[sonioxKeyField(region)] ?? '';
    if (!apiKey) return { ok: false, missing: 'API key is required for soniox' };
    return { ok: true, primary: apiKey, endpoint: region };
  }

  peekPrimaryCredential(slice: unknown): string {
    const settings = slice as SonioxSettings | null;
    return settings?.[sonioxKeyField(asSonioxRegion(settings?.region))] ?? '';
  }

  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    // A NEW construction shape for BYOK too, not a shape managed was moved
    // onto: one user key in both slots, and no client_reference_id — BYOK
    // traffic is not ours to bill.
    return new SonioxClient(byokCredentials(creds.primary, asSonioxRegion(creds.endpoint)));
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return SonioxClient.validateApiKeyAndFetchModels(creds.primary, asSonioxRegion(creds.endpoint));
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
      voice: settings[sonioxVoiceField(asSonioxRegion(settings.region))] || SONIOX_DEFAULT_VOICE,
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

  buildParticipantSessionConfig(
    slice: unknown,
    swappedInstructions: string,
    shell: { keepReplayAudio: boolean },
  ): ParticipantSessionResult {
    const result = super.buildParticipantSessionConfig(slice, swappedInstructions, shell);
    // Soniox carries direction in sourceLanguage/targetLanguage; reverse it so the
    // participant translates the other party's speech into the user's language.
    const sx = result.config as SonioxSessionConfig;
    [sx.sourceLanguage, sx.targetLanguage] = [sx.targetLanguage, sx.sourceLanguage];
    return result;
  }

  // The Kizuna-managed twin inherits this unchanged (class extension, not a
  // provider switch): descriptorRegistry.test.ts pins that it answers exactly
  // like BYOK Soniox — the 409 twin bug the old isSoniox dispatch existed for.
  planBothMode(slice: unknown, mode: string): BothModePlan {
    return sonioxBothModePlan({
      settings: slice as { bothModeSharedSession?: boolean; sourceLanguage?: string } | null | undefined,
      mode: mode as SonioxBothModeScope,
    });
  }

  // Soniox reverses sourceLanguage/targetLanguage directly for the
  // participant leg, whatever the model — an 'auto' source would reverse into
  // the literal 'auto' as the participant's translate target.
  reversesDirectionViaSourceLanguage(): boolean {
    return true;
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
  // catalog; zh/ja/en live-verified 2026-07-18 for the original twelve) — so
  // one voice serves both two_way directions. The roster itself now lives in
  // lib/soniox/ttsCatalog, because which voices exist is a property of the TTS
  // model and changes when the model does.
  private static readonly VOICES: VoiceOption[] = SONIOX_VOICES;

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
        hasVoiceSettings: false, // voice UI moved to SonioxVoiceSection (built-ins + BYOK clones); the generic dropdown cannot display cloned UUIDs
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
