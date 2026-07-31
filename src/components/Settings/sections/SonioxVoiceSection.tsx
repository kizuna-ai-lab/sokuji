/**
 * Soniox voice picker + BYOK voice cloning, wrapping the shared
 * VoiceLibrarySection (dropdown presentation): 28 built-ins as the preset
 * group, cloned voices (fetched live from /v1/voices — Soniox is the sole
 * source of truth) as the custom group. Managed (Kizuna) sessions cannot
 * manage voices (temporary keys are locked out of the REST API), so the twin
 * renders built-ins only; Phase 2 swaps the data source to backend endpoints.
 *
 * Create flow: consent checkbox gates record/upload → WAV-encode (recordings)
 * → POST → poll until ready (seconds) → auto-select. `voice_failed` is
 * terminal: the entry renders a failed hint and can only be deleted.
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

export interface SonioxVoiceSectionProps {
  settings: { voice: string; apiKey: string };
  onUpdate: (patch: { voice: string }) => void;
  managed: boolean;
  isSessionActive: boolean;
}

const BUILTIN_VOICES = new SonioxProviderConfig().getConfig().voices;
const TTS_MODEL = 'tts-rt-v1';
const DEFAULT_VOICE = 'Maya';

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
  const [clones, setClones] = useState<SonioxVoice[]>([]);
  const [listState, setListState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [consent, setConsent] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const [captureError, setCaptureError] = useState<string | null>(null);
  // Managing voices (list/create/delete) needs the permanent project key;
  // temporary/managed keys are live-verified 401 on this REST surface. No
  // key yet → no client → the create/delete affordances stay hidden below,
  // same as the managed twin.
  const client = useMemo(
    () => (managed || !settings.apiKey ? null : new SonioxVoicesClient(settings.apiKey)),
    [managed, settings.apiKey]
  );
  // Refresh results landing after unmount (or after the key changed) must not
  // write state; the counter invalidates in-flight loads.
  const loadGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (!client) return;
    const generation = ++loadGeneration.current;
    setListState('loading');
    try {
      const voices = await client.list();
      if (generation !== loadGeneration.current) return;
      setClones(voices);
      setListState('idle');
    } catch {
      if (generation !== loadGeneration.current) return;
      setListState('error');
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    return () => { loadGeneration.current++; };
  }, [refresh]);

  const requireConsent = () => {
    if (!consent) {
      throw new Error(
        t('settings.sonioxVoiceConsentRequired', 'Confirm you have the right to use this voice first')
      );
    }
  };

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

  // Shared by onRecord/onImport: consent-gate, run the create call, map any
  // failure to a localized message (surfaced inline, mirroring
  // NativeVoiceSection's captureError convention) and rethrow so
  // VoiceLibrarySection's own try/catch also sees the failure (e.g. it keeps
  // a required transcript field populated — not used here, but keeps the
  // contract symmetric with the other adapter).
  const runCreate = async (create: () => Promise<SonioxVoice>) => {
    setCaptureError(null);
    try {
      requireConsent();
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

  const onImport = (file: File) =>
    runCreate(() => client!.create(voiceName.trim() || file.name.replace(/\.[^.]+$/, ''), file, file.name));

  const onDelete = async (id: string) => {
    await client!.delete(id);
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
    // "(deleted voice)" label before the list arrives.
    if (settings.voice && !known.has(settings.voice) && listState !== 'loading') {
      custom.push({
        id: settings.voice,
        label: t('settings.sonioxVoiceDeletedPlaceholder', '(deleted voice)'),
        group: 'custom',
        removable: false,
      });
    }
    return [...builtin, ...custom];
  }, [clones, managed, settings.voice, listState, t]);

  return (
    <div className="settings-section" id="soniox-voice-section">
      <h2>{t('settings.voiceSettings', 'Voice Settings')}</h2>
      {!managed && (
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
              {t('settings.retry', 'Retry')}
            </button>
          </div>
        </div>
      )}
      <VoiceLibrarySection
        voices={entries}
        selectedId={settings.voice}
        onSelect={(id) => onUpdate({ voice: id })}
        onImport={client ? onImport : undefined}
        onRecord={client ? onRecord : undefined}
        onDelete={onDelete}
        capability={{
          importModes: client ? ['record', 'upload'] : [],
          curation: false,
          presentation: 'dropdown',
          accept: 'audio/*',
          maxClipSeconds: 20,
          minClipSeconds: 3,
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
