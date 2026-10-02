/**
 * Doubao AST 2.0's `S`, credentials and languages (survey §2.2–2.5). `S` is
 * the old slice (`VolcengineAST2ProviderConfig.ts:8-31`) without what
 * leaves it — the two credentials (same keys), the pair (`providerStore`,
 * same keys) and `turnDetectionMode` (the global turn mode, migrated once by
 * `storedSettings.ts`) — plus the credential mode (ruling 1). Stored under
 * `settings.volcengineAST2.*` as before. Nothing here imports `src/services`.
 */
import { pairCode } from '../../lib/language/code';
import { wireTable } from '../../lib/language/wire';
import type { CredentialField, CredentialsMissing, LanguageContext, LanguageOption, Provider } from '../../lib/provider/types';
import { isFixedTarget, speaks, type FixedTarget } from './catalog';

/** Which credentials a run sends (ruling 1): the legacy console's App ID and Access Token, or the new console's API key. */
export type Ast2AuthMode = 'app' | 'apiKey';

export interface Ast2Settings {
  /** Picked in the credential form (F4); an old profile reads the legacy mode, whose App ID and Access Token it already holds. */
  authMode: Ast2AuthMode;
  /** The console's hot-word library (`corpus.boosting_table_id`); '' for none. */
  hotWordTableId: string;
  /** The console's regex replacement library (`corpus.regex_correct_table_id`). */
  replacementTableId: string;
  /** The console's glossary library (`corpus.glossary_table_id`). */
  glossaryTableId: string;
  /** The voice chosen per target language (#577 catalog §2.4): `'clone'` or a catalog voice id. Absent: the effective voice's fallbacks (`voice.ts`). */
  voices: Ast2Voices;
}

export type Ast2Voices = Partial<Record<FixedTarget, string>>;

export const AST2_DEFAULTS: Ast2Settings = {
  authMode: 'app',
  hotWordTableId: '',
  replacementTableId: '',
  glossaryTableId: '',
  voices: {},
};

const AUTH_MODES: readonly unknown[] = ['app', 'apiKey'];

/**
 * The stored choices that still hold: a fixed target's slot naming `'clone'`
 * or a catalog voice that speaks it. A voice a refresh removed, or anything
 * that is not a plain object, is dropped; nothing is written back.
 */
function readVoices(stored: unknown): Ast2Voices {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const voices: Ast2Voices = {};
  for (const [target, id] of Object.entries(stored)) {
    if (isFixedTarget(target) && typeof id === 'string' && (id === 'clone' || speaks(id, target))) voices[target] = id;
  }
  return voices;
}

/** What was stored, made valid field by field; nothing is written back. */
export function migrateAst2Settings(stored: Readonly<Record<string, unknown>>): Ast2Settings {
  const str = (k: 'hotWordTableId' | 'replacementTableId' | 'glossaryTableId') => (typeof stored[k] === 'string' ? (stored[k] as string) : AST2_DEFAULTS[k]);
  return {
    authMode: AUTH_MODES.includes(stored.authMode) ? (stored.authMode as Ast2AuthMode) : AST2_DEFAULTS.authMode,
    hotWordTableId: str('hotWordTableId'),
    replacementTableId: str('replacementTableId'),
    glossaryTableId: str('glossaryTableId'),
    voices: readVoices(stored.voices),
  };
}

/** One leg's credentials: the kind decides the socket's query (`wire.ts` `ast2Url`). */
export type Ast2Credentials =
  | { kind: 'app'; appKey: string; accessKey: string }
  | { kind: 'apiKey'; apiKey: string };

const APP_ID: CredentialField = { key: 'appId', labelKey: 'setup.credentials.appId', secret: false, placeholderKey: 'providers.volcengine_ast2.appIdPlaceholder' };
const ACCESS_TOKEN: CredentialField = { key: 'accessToken', labelKey: 'setup.credentials.accessToken', secret: true, placeholderKey: 'providers.volcengine_ast2.accessTokenPlaceholder' };
const API_KEY: CredentialField = { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' };

/** A stored value as text: chrome storage hands an App ID stored as a number back as one (`descriptorRegistry.test.ts:179`). */
const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v)).trim();

export const ast2Credentials: Provider<Ast2Settings, Ast2Credentials, never>['credentials'] = {
  keys: ['appId', 'accessToken', 'apiKey'],
  fields: (s) => (s.authMode === 'apiKey' ? [API_KEY] : [APP_ID, ACCESS_TOKEN]),
  // `values` holds exactly the fields `fields(s)` shows, so its keys name the mode.
  read: (values): Ast2Credentials | CredentialsMissing => {
    if ('apiKey' in values) {
      const apiKey = text(values.apiKey);
      // No code: the runner words it `credentials_missing` ("Enter your API key in Settings before starting.").
      return apiKey ? { kind: 'apiKey', apiKey } : { missing: 'Enter the API key of your Doubao AST 2.0 app.' };
    }
    const appKey = text(values.appId);
    const accessKey = text(values.accessToken);
    return appKey && accessKey ? { kind: 'app', appKey, accessKey } : { missing: 'Enter the App ID and the Access Token of your Doubao AST 2.0 app.' };
  },
  choice: {
    setting: 'authMode',
    options: [
      { value: 'app', labelKey: 'providers.volcengine_ast2.authModeApp' },
      { value: 'apiKey', labelKey: 'setup.credentials.apiKey' },
    ],
  },
};

const code = (value: string): LanguageOption => ({ value });

/**
 * The eight languages Doubao speaks (S2S), in the old list's order
 * (`VolcengineAST2ProviderConfig.ts:112-121`).
 */
const SPOKEN: readonly LanguageOption[] = [
  code('zh'),
  code('en'),
  code('ja'),
  code('id'),
  code('es'),
  code('pt'),
  code('de'),
  code('fr'),
];

/**
 * The twelve more it transcribes and translates into text (S2T), in the
 * documentation's order.
 */
const TEXT_ONLY: readonly LanguageOption[] = [
  code('ko'),
  code('tr'),
  code('ms'),
  code('nl'),
  code('ro'),
  code('pl'),
  code('cs'),
  code('ar'),
  code('th'),
  code('vi'),
  code('ru'),
  code('it'),
];

/**
 * Two dialects, text only and as a source only ("方言，仅支持作为源语种").
 * App codes `yue` and `wuu` (Wu, Shanghainese's language); Doubao's own
 * `yue-CN` and `sh-CN` are the wire's.
 */
const DIALECTS: readonly LanguageOption[] = [code('yue'), code('wuu')];

/** Chinese↔English in one session, both sides or neither: the app code `zh+en`, Doubao's `zhen/zhen`. */
export const ZH_EN = pairCode('zh', 'en');
const BIDIRECTIONAL = code(ZH_EN);

const TEXT_SOURCES: readonly LanguageOption[] = [...SPOKEN, ...TEXT_ONLY, ...DIALECTS, BIDIRECTIONAL];
const ZH_OR_EN = new Set(['zh', 'en']);
const ONLY_ZH_EN: readonly LanguageOption[] = [BIDIRECTIONAL];
/** English first, so leaving `zh+en` on the source lands on English, as the old rule R3 did. */
const TO_EN_OR_ZH: readonly LanguageOption[] = [SPOKEN[1], SPOKEN[0]];
/** The targets a speaking leg reaches from Chinese or English: the nine some catalog voice speaks (catalog spec §1.1 rule 3). */
const SPOKEN_TARGETS: readonly LanguageOption[] = [...SPOKEN, code('ko')];

/** The eight languages the cloning model speaks ("声音复刻模式": lang_8), for `voice.ts`'s `clonable`. */
export const CLONING_LANGUAGES: ReadonlySet<string> = new Set(SPOKEN.map((o) => o.value));

/**
 * The targets of a source (ruling 3; #577 catalog §2.1). `zh+en` pairs only
 * with itself. Every other pair has Chinese or English on one side — S2T's
 * rule ("源语种或目标语种必须是中英") and, measured, the speaking one's
 * (ja→ko: "unsupported source or target language"). Speaking reaches the
 * nine languages a catalog voice speaks; cloning's eight are among them, so
 * the offer does not depend on the voice (R7). A dialect is never a target.
 */
function targetsOf(source: string, speech: boolean): readonly LanguageOption[] {
  if (source === ZH_EN) return ONLY_ZH_EN;
  if (!ZH_OR_EN.has(source)) return TO_EN_OR_ZH;
  return (speech ? SPOKEN_TARGETS : [...SPOKEN, ...TEXT_ONLY]).filter((o) => o.value !== source);
}

/**
 * Doubao's languages (ruling 3; #577 catalog §2.1): the twenty, the two
 * dialects and zh+en as sources in every context — a fixed voice takes them
 * all ("指定音色模式: 源语种 lang_20、方言") — and the targets `targetsOf` gives.
 * Without a context, the widest offer, text only's.
 */
export const ast2Languages: Provider<Ast2Settings, never, never>['languages'] = {
  sources: () => TEXT_SOURCES,
  targets: (source, _s, context?: LanguageContext) => targetsOf(source, context?.speech === true),
  initial: () => ({ source: 'zh', target: 'en' }),
  wire: wireTable([
    ...[...SPOKEN, ...TEXT_ONLY].map((o) => [o.value] as const),
    ['yue', 'yue-CN'],
    ['wuu', 'sh-CN'],
    [ZH_EN, 'zhen'],
  ]),
};

/** Whether Doubao runs this direction in this mode and voice: `build`'s guard, over the same two functions. */
export function ast2Offers(direction: { source: string; target: string }, s: Ast2Settings, context: LanguageContext): boolean {
  return ast2Languages.sources(s, context).some((o) => o.value === direction.source)
    && ast2Languages.targets(direction.source, s, context).some((o) => o.value === direction.target);
}
