/**
 * Palabra AI's `S`, credentials and languages (survey §2.3–2.6). `S` is the
 * old slice (`PalabraAIProviderConfig.ts:8-24`) without what leaves it — the
 * three credentials (same keys), the pair (`providerStore`, same keys) and
 * the two fields nothing read (`subscriberCount`, `publisherCanSubscribe`).
 * Stored under `settings.palabraai.*` as before; nothing is converted on the
 * way in (ruling 2). Nothing here imports `src/services`.
 */
import type { CredentialField, CredentialsMissing, Provider } from '../../lib/provider/types';

export { palabraLanguages, palabraOffers } from './languages';

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
