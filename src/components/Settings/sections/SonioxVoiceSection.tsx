/**
 * Soniox voice picker + BYOK voice cloning, wrapping the shared
 * VoiceLibrarySection (dropdown presentation): 28 built-ins as the preset
 * group, cloned voices (fetched live from /v1/voices — Soniox is the sole
 * source of truth) as the custom group. Managed (Kizuna) sessions cannot
 * manage voices (temporary keys are locked out of the REST API), so the twin
 * renders built-ins only; Phase 2 swaps the data source to backend endpoints.
 *
 * Create flow: consent checkbox gates record/upload (unchecked → the
 * affordances don't render at all, see `capability.importModes` below) →
 * client-side validation (upload only: ≤10 MB, decoded duration 3-20s,
 * mirroring NativeVoiceSection's `validateVoiceClip` pattern) → WAV-encode
 * (recordings) → POST → poll until ready (seconds) → auto-select.
 * `voice_failed` is terminal: the entry renders a failed hint and can only be
 * deleted.
 *
 * Cloning affordances also require an API key: managing voices needs the
 * permanent project key, so the record/upload controls stay hidden until
 * `settings.apiKey` is non-empty (mirrors the `managed` gate — both leave
 * `client` null, see below) rather than reaching a null-client crash if a
 * BYOK user opens this section before pasting their key.
 */
import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import {
  SonioxVoicesClient,
  SonioxVoicesError,
  encodeWavPcm16,
  type SonioxVoice,
} from '../../../services/clients/SonioxVoicesClient';
import { SonioxProviderConfig } from '../../../services/providers/SonioxProviderConfig';
import {
  validateVoiceClip,
  downmixToMono,
  type ClipValidationError,
} from '../../../lib/local-inference/native/nativeVoiceStores';

export interface SonioxVoiceSectionProps {
  settings: { voice: string; apiKey: string };
  onUpdate: (patch: { voice: string }) => void;
  managed: boolean;
  isSessionActive: boolean;
}

const BUILTIN_VOICES = new SonioxProviderConfig().getConfig().voices;
const TTS_MODEL = 'tts-rt-v1';
const DEFAULT_VOICE = 'Maya';
// Reference-clip bounds Soniox enforces server-side; validated client-side on
// upload too (mirrors NativeVoiceSection / validateVoiceClip's defaults).
const MIN_CLIP_SECONDS = 3;
const MAX_CLIP_SECONDS = 20;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function isReady(v: SonioxVoice): boolean {
  return v.models?.some((m) => m.model === TTS_MODEL && m.status === 'ready') ?? false;
}
function isFailed(v: SonioxVoice): boolean {
  return v.models?.some((m) => m.model === TTS_MODEL && m.status === 'failed') ?? false;
}

const SonioxVoiceSection: React.FC<SonioxVoiceSectionProps> = ({
  settings,
  onUpdate,
  managed,
  isSessionActive,
}) => {
  const { t } = useTranslation();
  // Managing voices (list/create/delete) needs the permanent project key;
  // temporary/managed keys are live-verified 401 on this REST surface. No
  // key yet → no client → the create/delete affordances stay hidden below,
  // same as the managed twin.
  const client = useMemo(
    () => (managed || !settings.apiKey ? null : new SonioxVoicesClient(settings.apiKey)),
    [managed, settings.apiKey]
  );
  // Latest-value ref so an in-flight `refresh()` can tell, at resolution
  // time, whether the client it was issued against is still current — an
  // explicit guard alongside the generation counter below rather than
  // relying solely on effect-cleanup ordering when `client` changes mid-fetch.
  const clientRef = useRef(client);
  useEffect(() => { clientRef.current = client; }, [client]);
  const [clones, setClones] = useState<SonioxVoice[]>([]);
  // Start 'loading' whenever a client exists so the first paint never shows
  // the "(deleted voice)" placeholder for a settings.voice that simply
  // hasn't been checked against the fetched list yet.
  const [listState, setListState] = useState<'idle' | 'loading' | 'error'>(client ? 'loading' : 'idle');
  const [consent, setConsent] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const [captureError, setCaptureError] = useState<string | null>(null);
  // Refresh results landing after unmount (or after the key changed) must not
  // write state; the counter invalidates in-flight loads.
  const loadGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (!client) return;
    const requestClient = client;
    const generation = ++loadGeneration.current;
    setListState('loading');
    try {
      const voices = await requestClient.list();
      if (generation !== loadGeneration.current || clientRef.current !== requestClient) return;
      setClones(voices);
      setListState('idle');
    } catch {
      if (generation !== loadGeneration.current || clientRef.current !== requestClient) return;
      setListState('error');
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    return () => { loadGeneration.current++; };
  }, [refresh]);

  const mapCreateError = (e: unknown): Error => {
    if (e instanceof SonioxVoicesError) {
      if (e.errorType === 'voice_name_conflict') {
        return new Error(t('settings.sonioxVoiceNameConflict', 'A voice with this name already exists'));
      }
      if (e.errorType === 'limit_exceeded' || e.status === 429) {
        return new Error(
          t('settings.sonioxVoiceQuotaError', 'Soniox organization voice limit reached — delete a voice and retry')
        );
      }
      if (e.errorType === 'voice_failed') {
        return new Error(t('settings.sonioxVoiceFailed', 'Processing failed — delete this voice and try a clearer clip'));
      }
    }
    return e instanceof Error ? e : new Error(String(e));
  };

  const finishCreate = async (created: SonioxVoice) => {
    try {
      await client!.waitUntilReady(created.id);
    } finally {
      // Refresh regardless of outcome: a `voice_failed` rejection still needs
      // the now-failed entry to show up (with its failed hint) so it can be
      // deleted.
      await refresh();
    }
    onUpdate({ voice: created.id });
    setVoiceName('');
  };

  const nextName = () =>
    voiceName.trim() ||
    t('settings.sonioxVoiceDefaultName', 'My Voice {{n}}', { n: clones.length + 1 });

  // Consent is enforced structurally, not by throwing here: `onImport` /
  // `onRecord` are only ever handed to VoiceLibrarySection (below) when
  // `client && consent`, and its own capability.importModes stays `[]`
  // without consent too, so the record/upload affordances never render in
  // the first place — there's no path left that reaches `runCreate` unconsented.
  //
  // Shared by onRecord/onImport: run the create call, map any failure to a
  // localized message (surfaced inline, mirroring NativeVoiceSection's
  // captureError convention) and rethrow so VoiceLibrarySection's own
  // try/catch also sees the failure (e.g. it keeps a required transcript
  // field populated — not used here, but keeps the contract symmetric with
  // the other adapter).
  const runCreate = async (create: () => Promise<SonioxVoice>) => {
    setCaptureError(null);
    try {
      const created = await create();
      await finishCreate(created);
    } catch (e) {
      const mapped = mapCreateError(e);
      setCaptureError(mapped.message);
      throw mapped;
    }
  };

  const onRecord = (clip: Float32Array, sampleRate: number) =>
    runCreate(() => client!.create(nextName(), encodeWavPcm16(clip, sampleRate)));

  // Maps a validateVoiceClip verdict to the same voiceLibrary.* copy
  // NativeVoiceSection uses, substituting this section's own bounds.
  const mapClipError = (reason: ClipValidationError): string => {
    switch (reason) {
      case 'too_short':
        return t('voiceLibrary.clipTooShort', 'Recording is too short — speak for at least {seconds} seconds.')
          .replace('{seconds}', String(MIN_CLIP_SECONDS));
      case 'too_long':
        return t('voiceLibrary.clipTooLong', 'Recording is too long — keep it under {seconds} seconds.')
          .replace('{seconds}', String(MAX_CLIP_SECONDS));
      case 'silent':
      default:
        return t('voiceLibrary.clipSilent', 'No voice detected — check your microphone and try again.');
    }
  };

  // Client-side upload validation (spec: "client-side decode validates
  // 3-20s / ≤10MB via the validateVoiceClip pattern"): reject an oversize
  // file outright (cheap, no decode needed), then decode the file to measure
  // its REAL duration — a file's extension/MIME claims nothing about actual
  // length — and run it through the same validateVoiceClip bounds
  // NativeVoiceSection uses. Catches a doomed upload before spending a
  // create() call (and a slot in the org's 20-voice quota) on a clip Soniox
  // would reject anyway.
  const onImport = (file: File) =>
    runCreate(async () => {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          t('voiceLibrary.importError', 'Import failed: {error}').replace(
            '{error}',
            `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB, max ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB)`
          )
        );
      }
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext();
      let buffer: AudioBuffer;
      try {
        buffer = await ctx.decodeAudioData(arrayBuffer);
      } catch {
        throw new Error(
          t('voiceLibrary.decodeFailed', 'Could not read that audio file — try a WAV, MP3, or other common format.')
        );
      } finally {
        void ctx.close();
      }
      const reason = validateVoiceClip(downmixToMono(buffer), buffer.sampleRate, MAX_CLIP_SECONDS, MIN_CLIP_SECONDS);
      if (reason) throw new Error(mapClipError(reason));
      const stripped = file.name.replace(/\.[^.]+$/, '');
      return client!.create(voiceName.trim() || stripped || nextName(), file, file.name);
    });

  const onDelete = async (id: string) => {
    if (!client) return;
    await client.delete(id);
    await refresh();
    // Deliberate in-app deletion of the selected voice falls back to the
    // default built-in; an EXTERNAL deletion (e.g. from another client) only
    // ever shows the placeholder below — the stored setting is never rewritten
    // behind the user's back.
    if (settings.voice === id) onUpdate({ voice: DEFAULT_VOICE });
  };

  const entries = useMemo<VoiceEntry[]>(() => {
    const builtin: VoiceEntry[] = BUILTIN_VOICES.map((v) => ({
      id: v.value,
      label: v.name,
      group: 'builtin',
      removable: false,
    }));
    const custom: VoiceEntry[] = managed
      ? []
      : clones.map((v) => ({
          id: v.id,
          label: isFailed(v)
            ? `${v.name} — ${t('settings.sonioxVoiceFailedBadge', 'failed')}`
            : isReady(v)
              ? v.name
              : `${v.name} — ${t('settings.sonioxVoiceProcessingBadge', 'processing…')}`,
          group: 'custom',
          removable: true,
        }));
    const known = new Set([...builtin, ...custom].map((e) => e.id));
    // Only synthesize the placeholder once we're not mid-fetch: a settings
    // value pointing at a real (not-yet-loaded) clone must not flash the
    // "(deleted voice)" label before the list arrives. Without a client
    // (no API key yet) there's no fetch to settle at all, so the entry makes
    // no claim about deletion — it shows the raw id rather than asserting
    // something we have no evidence for.
    if (settings.voice && !known.has(settings.voice) && listState !== 'loading') {
      custom.push({
        id: settings.voice,
        label: client
          ? t('settings.sonioxVoiceDeletedPlaceholder', '(deleted voice)')
          : settings.voice,
        group: 'custom',
        removable: false,
      });
    }
    return [...builtin, ...custom];
  }, [clones, managed, settings.voice, listState, client, t]);

  return (
    <div className="settings-section" id="soniox-voice-section">
      <h2>{t('settings.voiceSettings', 'Voice Settings')}</h2>
      {client && (
        <div className="setting-item">
          <label className="unlimited-checkbox">
            <input
              id="soniox-voice-consent"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>{t('settings.sonioxVoiceConsent', 'I confirm I have the right to use this voice')}</span>
          </label>
          <input
            id="soniox-voice-name"
            type="text"
            className="text-input"
            placeholder={t('settings.sonioxVoiceNamePlaceholder', 'Name for a new cloned voice (optional)')}
            value={voiceName}
            maxLength={128}
            onChange={(e) => setVoiceName(e.target.value)}
          />
        </div>
      )}
      {listState === 'error' && (
        <div className="setting-item">
          <div className="setting-description">
            {t('settings.sonioxVoiceListError', 'Could not load cloned voices — check the API key.')}{' '}
            <button className="option-button" onClick={() => void refresh()}>
              {t('common.retry', 'Retry')}
            </button>
          </div>
        </div>
      )}
      <VoiceLibrarySection
        voices={entries}
        selectedId={settings.voice}
        onSelect={(id) => onUpdate({ voice: id })}
        onImport={client && consent ? onImport : undefined}
        onRecord={client && consent ? onRecord : undefined}
        onDelete={onDelete}
        capability={{
          importModes: client && consent ? ['record', 'upload'] : [],
          curation: false,
          presentation: 'dropdown',
          accept: 'audio/*',
          maxClipSeconds: MAX_CLIP_SECONDS,
          minClipSeconds: MIN_CLIP_SECONDS,
        }}
        isSessionActive={isSessionActive}
      />
      {captureError && (
        <div className="voice-capture-error" role="alert">{captureError}</div>
      )}
    </div>
  );
};

export default SonioxVoiceSection;
