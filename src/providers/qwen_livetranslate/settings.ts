/**
 * Qwen LiveTranslate's `S`, voices, languages and credentials (spec
 * 2026-10-13, §3 and §4). New with this provider: no slice an older build
 * stored, so no `legacyKeys` and no `migrate`. A stored voice the list does
 * not have falls to the default where it is read, never rewritten.
 */
import { identityWire } from '../../lib/language/wire';
import { AUTO } from '../../lib/provider/languages';
import type { CredentialsMissing, LanguageContext, LanguageOption, Provider } from '../../lib/provider/types';
import { distinctVoice } from '../../lib/provider/voices';

/** The one model (D1): the check finds the storefront, nothing chooses a model. */
export const QWEN_MODEL = 'qwen3.8-livetranslate-flash-realtime';

/** The speaker's own voice, cloned in real time on every turn (D5): a choice beside the presets, sent as `enable_voice_clone`, frequency `always`. */
export const SPEAKER_CLONE = 'clone';
/** The first speaker's voice, cloned once at the start and kept (frequency `once`): one presenter stays one voice. */
export const SPEAKER_CLONE_ONCE = 'clone-once';

/** The pause that ends a turn, in ms: the server's own default (2500), within a range the server does not enforce itself (it accepts 100 and 10 000 alike; probe 2026-10-13). */
export const QWEN_PAUSE = { min: 500, max: 6000, step: 100, default: 2500 } as const;

export interface QwenVoice {
  /** The vendor's name, sent verbatim: spaces and diacritics included. */
  value: string;
  name: string;
  /** Only where the official list says so. */
  gender?: 'female' | 'male';
  /** The official list's line, in its own English. */
  description: string;
}

const voice = (name: string, description: string, gender?: 'female' | 'male'): QwenVoice =>
  (gender ? { value: name, name, gender, description } : { value: name, name, description });

/** The 47 presets in the vendor's order (the official omni voice list, 2026-10-13). Every one speaks every spoken target; `Cherry` is not among them (refused, probe 2026-10-13). */
export const QWEN_VOICES: readonly QwenVoice[] = [
  voice("Tina", "Sweet and warm — like a cup of milk tea — and unmistakably capable when it's time to solve problems."),
  voice("Cindy", "Soft, sweet young woman with a Taiwanese accent.", "female"),
  voice("Liora Mira", "Gentle and warm, with the everyday charm of a quiet evening."),
  voice("Sunnybobi", "Easygoing, slightly shy girl-next-door.", "female"),
  voice("Raymond", "Bright voice; the laid-back homebody type."),
  voice("Ethan", "Standard Mandarin with a hint of Northern Chinese accent; sunny, warm, and energetic."),
  voice("Theo Calm", "Calm and reassuring; speaks with quiet understanding."),
  voice("Serena", "Gentle young woman.", "female"),
  voice("Harvey", "Low, mellow voice with a hint of coffee-and-old-books warmth."),
  voice("Maia", "Where intellect meets gentleness."),
  voice("Evan", "Young, warm male voice with a youthful, playful tone.", "male"),
  voice("Qiao", "Cute on the surface, with plenty of personality underneath."),
  voice("Momo", "Playful and sweet; designed to lift the mood."),
  voice("Wil", "Young man with a Hong Kong/Taiwan-influenced accent — Shenzhen-raised.", "male"),
  voice("Angel", "Sweet voice with a slight Taiwanese accent."),
  voice("Li Cassian", "Subtle and observant; says little, conveys much."),
  voice("Mia", "Gentle and reflective; well-suited for lifestyle and wellness content."),
  voice("Joyner", "Comedic, expressive, and down-to-earth."),
  voice("Gold", "West Coast rapper style."),
  voice("Katerina", "Mature, expressive female voice with rhythmic depth.", "female"),
  voice("Ryan", "Dynamic and dramatic; high energy with strong emotional range."),
  voice("Jennifer", "Premium, cinematic American English female voice.", "female"),
  voice("Aiden", "American English male voice with a friendly, casual feel.", "male"),
  voice("Mione", "Mature, intellectual British English female voice.", "female"),
  voice("Sohee", "Warm, expressive Korean female voice.", "female"),
  voice("Lenn", "Rational with a subtle edge — a German voice that pairs business attire with post-punk taste."),
  voice("Ono Anna", "Playful and mischievous, like a childhood friend."),
  voice("Sonrisa", "Warm, outgoing Latin American female voice.", "female"),
  voice("Bodega", "Warm, friendly Spanish male voice.", "male"),
  voice("Emilien", "Romantic French male voice.", "male"),
  voice("Andre", "Magnetic, natural, and steady male voice.", "male"),
  voice("Radio Gol", "Sports commentator style — expressive Brazilian Portuguese."),
  voice("Alek", "Cool yet warm — classic Russian timbre."),
  voice("Rizky", "Young Indonesian male voice with character.", "male"),
  voice("Roya", "Active, free-spirited female voice.", "female"),
  voice("Arda", "Balanced and clean, with a warm undertone."),
  voice("Hana", "Mature Vietnamese female voice with a dog-loving older-sister feel.", "female"),
  voice("Dolce", "Relaxed, easygoing Italian male voice.", "male"),
  voice("Jakub", "Magnetic, artistic Polish male voice.", "male"),
  voice("Griet", "Mature, artistic Dutch female voice.", "female"),
  voice("Eliška", "Czech voice with crafted, warm articulation — every word carries Central European care."),
  voice("Marina", "Female voice raised in a multicultural urban environment.", "female"),
  voice("Siiri", "Reserved and gentle, paced like ripples on a quiet lake."),
  voice("Ingrid", "Norwegian countryside female voice.", "female"),
  voice("Sigga", "Intellectual Icelandic female voice.", "female"),
  voice("Bea", "Sweet Filipino female voice with a coffee-shop charm.", "female"),
  voice("Chloe", "Malaysian female voice with a professional, white-collar feel.", "female"),
];

export interface QwenSettings {
  /** My leg's voice: one of `QWEN_VOICES`, `SPEAKER_CLONE` or `SPEAKER_CLONE_ONCE`. */
  voice: string;
  /** The voice that reads the other person's words to me: the same choices. */
  participantVoice: string;
  /** Preferred translations, one `source=target` per line (→ `translation.corpus.phrases`), both legs. */
  hotwords: string;
  /** The pause that ends a turn under automatic turns, in ms (`QWEN_PAUSE`). */
  pauseMs: number;
}

export const QWEN_DEFAULT_VOICE = 'Tina';
/** A male preset beside Tina, so the two people never sound alike by default. */
export const QWEN_PARTICIPANT_DEFAULT_VOICE = 'Ethan';
export const QWEN_DEFAULTS: QwenSettings = { voice: QWEN_DEFAULT_VOICE, participantVoice: QWEN_PARTICIPANT_DEFAULT_VOICE, hotwords: '', pauseMs: QWEN_PAUSE.default };

/** Either clone: each leg clones its own speaker, so neither is ever "my" voice to keep off the other leg. */
const cloned = (v: string) => v === SPEAKER_CLONE || v === SPEAKER_CLONE_ONCE;

/** A choice the list offers: the list is the only check, since the server refuses an unknown voice only at the first speech (probe 2026-10-13). */
const listed = (v: string) => cloned(v) || QWEN_VOICES.some((o) => o.value === v);

/** My voice for a run: the choice while the list has it, else Tina. */
export function qwenSpeakerVoice(s: Pick<QwenSettings, 'voice'>): string {
  return listed(s.voice) ? s.voice : QWEN_DEFAULT_VOICE;
}

/** The other party's voice for a run: never my preset (`distinctVoice`). The clones are exempt: each leg clones its own speaker. */
export function qwenParticipantVoice(s: Pick<QwenSettings, 'voice' | 'participantVoice'>): string {
  const chosen = listed(s.participantVoice) ? s.participantVoice : QWEN_PARTICIPANT_DEFAULT_VOICE;
  if (cloned(chosen)) return chosen;
  return distinctVoice(chosen, qwenSpeakerVoice(s), { participant: QWEN_PARTICIPANT_DEFAULT_VOICE, speaker: QWEN_DEFAULT_VOICE });
}

/** The 29 targets Qwen speaks, in the official list's order. */
const SPOKEN = ['zh', 'en', 'ar', 'de', 'fr', 'es', 'pt', 'id', 'it', 'ko', 'ru', 'th', 'vi', 'ja', 'tr', 'hi', 'ms', 'nl', 'ur', 'nb', 'sv', 'da', 'he', 'fi', 'pl', 'is', 'cs', 'fil', 'fa'];
/** The 31 it only writes: a speaking session refuses them ("Target language 'uk' only supports text output"). */
const TEXT_ONLY = ['yue', 'el', 'af', 'ast', 'be', 'bg', 'bn', 'bs', 'ca', 'ceb', 'et', 'gl', 'gu', 'hr', 'hu', 'jv', 'kk', 'kn', 'ky', 'lv', 'mk', 'ml', 'mr', 'pa', 'ro', 'sk', 'sl', 'sw', 'tg', 'az', 'uk'];

export const QWEN_SPOKEN: readonly LanguageOption[] = SPOKEN.map((value) => ({ value }));
/** All 60, spoken first. Each is Qwen's own code and already a canonical app code, so the wire is the identity. */
export const QWEN_LANGUAGES: readonly LanguageOption[] = [...SPOKEN, ...TEXT_ONLY].map((value) => ({ value }));

/**
 * The model detects the source itself, so the sources are `AUTO` and the
 * 60: a concrete one exists so the participant leg can reverse the pair
 * (D20 refuses `AUTO` there). A speaking run is offered the 29 targets it
 * can speak, as Doubao AST 2.0 does; the text offer is all 60.
 */
export const qwenLanguages: Provider<QwenSettings, never, never>['languages'] = {
  sources: () => [{ value: AUTO }, ...QWEN_LANGUAGES],
  targets: (_source, _s, context?: LanguageContext) => (context?.speech === true ? QWEN_SPOKEN : QWEN_LANGUAGES),
  wire: identityWire(),
};

export interface QwenCredentials {
  apiKey: string;
}

export const qwenCredentials: Provider<QwenSettings, QwenCredentials, never>['credentials'] = {
  keys: ['apiKey'],
  fields: () => [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }],
  read: (values): QwenCredentials | CredentialsMissing => {
    // Trimmed: the key rides in a header, where a pasted trailing newline or space is no valid token.
    const apiKey = (values.apiKey ?? '').trim();
    // No code: the runner words it `credentials_missing`.
    return apiKey ? { apiKey } : { missing: 'Enter your Qwen API key.' };
  },
};
