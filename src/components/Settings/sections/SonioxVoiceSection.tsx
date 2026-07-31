/**
 * Soniox voice picker + BYOK voice cloning, wrapping the shared
 * VoiceLibrarySection (dropdown presentation): 28 built-ins as the preset
 * group, cloned voices (fetched live from /v1/voices — Soniox is the sole
 * source of truth) as the custom group. Managed (Kizuna) sessions cannot
 * manage voices (temporary keys are locked out of the REST API), so the twin
 * renders built-ins only; Phase 2 swaps the data source to backend endpoints.
 *
 * Create flow: record/upload are always available once a client exists (the
 * shared voice-library look, no gating checkbox) → client-side validation
 * (upload only: ≤10 MB, decoded duration 3-20s, mirroring NativeVoiceSection's
 * `validateVoiceClip` pattern) → the validated/recorded clip is staged as
 * `pending` rather than uploaded immediately, which opens
 * `SonioxCloneConfirmModal` for playback + naming + the consent statement
 * (folded into the modal's accept button) → on confirm, WAV-encode
 * (recordings only) → POST → poll until ready (seconds) → auto-select. A
 * mapped create failure (e.g. `voice_name_conflict`) keeps the modal open so
 * the user can rename and retry without losing the clip. `voice_failed` is
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
import { RefreshCw } from 'lucide-react';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import SonioxCloneConfirmModal from './SonioxCloneConfirmModal';
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
  const [captureError, setCaptureError] = useState<string | null>(null);
  // A clip that's been picked/recorded and passed client-side validation,
  // staged for the confirm modal (playback + naming + consent) before it's
  // actually uploaded. Non-null ⇔ the modal is open.
  const [pending, setPending] = useState<{ blob: Blob; fileName?: string; suggestedName: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  // Bumped every time a NEW clip is staged (not on a confirm-error retry,
  // which reuses the same `pending`) and handed to the modal as `key` — a
  // fresh mount per capture means the name field's initial value is right
  // the first time, with no effect-driven resync race against the DOM
  // assertions in tests (or the user's eyes).
  const [pendingSeq, setPendingSeq] = useState(0);
  const stagePending = (next: { blob: Blob; fileName?: string; suggestedName: string }) => {
    setPending(next);
    setPendingSeq((s) => s + 1);
  };
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
  };

  const defaultName = () => t('settings.sonioxVoiceDefaultName', 'My Voice {{n}}', { n: clones.length + 1 });

  // Modal lifecycle: `pending` non-null opens SonioxCloneConfirmModal.
  // `closeModal` is also handed to the modal as its Cancel/backdrop/X
  // handler, guarded against `modalBusy` so a create() request in flight
  // can't be orphaned by a mid-request cancel.
  const closeModal = () => {
    if (modalBusy) return;
    setPending(null);
    setModalError(null);
  };

  // Confirm step: actually calls create(). On success, close the modal right
  // away — the list's "processing…" badge covers the waitUntilReady wait —
  // then run the existing finishCreate flow; a late (post-close) failure
  // there (e.g. voice_failed) surfaces in the existing captureError banner
  // rather than reopening the modal. On a create() failure (e.g.
  // voice_name_conflict), keep the modal open with the mapped message inline
  // so the user can rename and retry without losing the clip.
  const handleConfirm = async (name: string) => {
    if (!client || !pending || modalBusy) return;
    setModalBusy(true);
    setModalError(null);
    try {
      const created = await client.create(name.trim() || pending.suggestedName, pending.blob, pending.fileName);
      setPending(null);
      setModalBusy(false);
      try {
        await finishCreate(created);
      } catch (e) {
        setCaptureError(mapCreateError(e).message);
      }
    } catch (e) {
      setModalError(mapCreateError(e).message);
      setModalBusy(false);
    }
  };

  // No create call here — the encoded clip is staged as `pending` and the
  // confirm modal drives the actual upload via handleConfirm above.
  const onRecord = async (clip: Float32Array, sampleRate: number) => {
    setCaptureError(null);
    stagePending({ blob: encodeWavPcm16(clip, sampleRate), suggestedName: defaultName() });
  };

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
  // NativeVoiceSection uses. A validation failure surfaces inline via
  // captureError and rethrows (VoiceLibrarySection's contract) without
  // opening the modal. On success, no create() call is made here — the
  // validated file is staged as `pending` so the confirm modal can play it
  // back and take a name before it's uploaded.
  const onImport = async (file: File) => {
    setCaptureError(null);
    try {
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
      stagePending({ blob: file, fileName: file.name, suggestedName: stripped || defaultName() });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setCaptureError(err.message);
      throw err;
    }
  };

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
      <h2>
        <span>{t('settings.voiceSettings', 'Voice Settings')}</span>
        {client && (
          <button
            className="section-refresh-button"
            onClick={() => void refresh()}
            disabled={listState === 'loading'}
            title={t('settings.sonioxVoiceRefreshList', 'Refresh voice list')}
          >
            <RefreshCw size={14} className={listState === 'loading' ? 'spinning' : ''} />
          </button>
        )}
      </h2>
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
        onImport={client ? onImport : undefined}
        onRecord={client ? onRecord : undefined}
        onDelete={onDelete}
        capability={{
          importModes: client ? ['record', 'upload'] : [],
          curation: false,
          presentation: 'dropdown',
          accept: 'audio/*',
          maxClipSeconds: MAX_CLIP_SECONDS,
          minClipSeconds: MIN_CLIP_SECONDS,
          // The confirm modal stages exactly one clip; without this a
          // multi-file drop would silently keep only the last file.
          multipleImport: false,
        }}
        isSessionActive={isSessionActive}
      />
      {captureError && (
        <div className="voice-capture-error" role="alert">{captureError}</div>
      )}
      <SonioxCloneConfirmModal
        key={pendingSeq}
        isOpen={pending !== null}
        suggestedName={pending?.suggestedName ?? ''}
        audioBlob={pending?.blob ?? null}
        error={modalError}
        busy={modalBusy}
        onConfirm={(name) => void handleConfirm(name)}
        onClose={closeModal}
      />
    </div>
  );
};

export default SonioxVoiceSection;
