/**
 * Palabra AI's voice picker (voice library spec §4), over the shared
 * VoiceLibrarySection, a sibling of SonioxVoiceSection with its structure:
 * the two default aliases, Palabra's built-ins (the row's language first,
 * then the rest), and the account's own voices, fetched through the injected
 * `source`. A null `source` (the mode's credentials not saved yet) shows the
 * two defaults only.
 *
 * Differences from Soniox, each the spec's:
 *  - a stored id the list does not hold reads "(deleted voice)" only after a
 *    SUCCESSFUL fetch; after a failed one it shows the name stored with it,
 *    since the built-ins are fetched too and offline is not deletion;
 *  - previews play the voice's own sample from Palabra's CDN: free, and the
 *    defaults have none;
 *  - the facet filter offers gender only (owner, 2026-11-03).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import { languageLabel } from '../../../lib/language/label';
import { downmixToMono, validateVoiceClip, type ClipValidationError } from '../../../lib/local-inference/native/nativeVoiceStores';
import { clearPreviewCache } from '../../../lib/tts/previewCache';
import {
  baseLanguage, cleanVoiceName, cloneLanguageDisplayCode, cloneLanguageFor, PALABRA_CLONE_LANGUAGES, PALABRA_VOICE_NAME, sameLanguage,
} from '../../../providers/palabraai/cloneLanguages';
import { PALABRA_DEFAULTS, PALABRA_VOICES } from '../../../providers/palabraai/settings';
import { realSleep, waitUntilSettled, type PalabraVoiceSource, type Sleep } from '../../../providers/palabraai/voiceSource';
import { PalabraVoicesError, type PalabraVoiceInfo } from '../../../providers/palabraai/voicesClient';
import { encodeWavPcm16 } from '../../../providers/soniox/voicesClient';

export interface PalabraVoiceSectionProps {
  settings: { voiceId: string; voiceName: string; participantVoiceId: string; participantVoiceName: string };
  onSelect(patch: { voiceId: string; voiceName: string } | { participantVoiceId: string; participantVoiceName: string }): void;
  source: PalabraVoiceSource | null;
  /** The pair's target: what my voice speaks, the first row's language. */
  target: string;
  /** The pair's source: what I speak — the second row's language, and the recording's by default. */
  pairSource: string;
  /** Present while the other party is spoken too; `effective` is what a run speaks (`palabraParticipantVoice`). */
  participant?: { effective: string };
  isSessionActive: boolean;
  /** The poll's wait; tests inject one that records and resolves at will. */
  sleep?: Sleep;
}

/** Palabra's sample bounds (spec §4): 30-90 s of audio, an upload of at most 10 MB. */
export const PALABRA_MIN_CLIP_SECONDS = 30;
export const PALABRA_MAX_CLIP_SECONDS = 90;
export const PALABRA_MAX_UPLOAD_BYTES = 10_000_000;
/** A clip above this rate is brought down to it, so 90 s of 16-bit mono WAV stays under 10 MB. */
const MAX_UPLOAD_RATE = 48_000;

/** Linear resampling down to `MAX_UPLOAD_RATE`; a clip at or below it is returned as is. */
function capRate(clip: Float32Array, sampleRate: number): { clip: Float32Array; sampleRate: number } {
  if (sampleRate <= MAX_UPLOAD_RATE) return { clip, sampleRate };
  const ratio = sampleRate / MAX_UPLOAD_RATE;
  const out = new Float32Array(Math.floor(clip.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = clip[j] * (1 - f) + (clip[Math.min(j + 1, clip.length - 1)] ?? 0) * f;
  }
  return { clip: out, sampleRate: MAX_UPLOAD_RATE };
}

/** A staged clip, waiting in the review step: the WAV to upload, and how it was made. */
interface Pending { wav: Blob; denoise: boolean; suggestedName: string }

/** No delete: the second row lists defaults and built-ins only. */
const NO_DELETE = async () => {};


const PalabraVoiceSection: React.FC<PalabraVoiceSectionProps> = ({
  settings, onSelect, source, target, pairSource, participant, isSessionActive, sleep = realSleep,
}) => {
  const { t, i18n } = useTranslation();
  // A test's `useTranslation` stub may carry no `i18n`; the app's always does.
  const uiLanguage = i18n?.language;
  const sourceRef = useRef(source);
  useEffect(() => { sourceRef.current = source; }, [source]);
  // A source remembers its last list for the app session (owner, 2026-11-03):
  // a visit shows it at once and asks Palabra nothing.
  const remembered = source?.cached() ?? null;
  const [builtins, setBuiltins] = useState<PalabraVoiceInfo[]>(remembered?.builtin ?? []);
  const [mine, setMine] = useState<PalabraVoiceInfo[]>(remembered?.mine ?? []);
  // 'loading' from the first paint while a source has nothing remembered, so
  // a stored id is not judged against a list that has not arrived.
  const [listState, setListState] = useState<'idle' | 'loading' | 'error'>(source && !remembered ? 'loading' : 'idle');
  const [quota, setQuota] = useState<{ used: number; limit: number; remaining: number } | null>(remembered?.limits ?? null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  // The latest of what an auto-select must still find unchanged, read when a
  // poll settles, minutes after it began (spec §4 "Waiting for ready").
  const selectedVoiceRef = useRef(settings.voiceId);
  selectedVoiceRef.current = settings.voiceId;
  const sessionActiveRef = useRef(isSessionActive);
  sessionActiveRef.current = isSessionActive;
  // One controller per mount: unmounting stops every poll it started.
  const mountAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    mountAbort.current = controller;
    return () => controller.abort();
  }, []);
  /** Voices this mount is already polling, so a refresh does not start a second poll. */
  const polling = useRef(new Set<string>());
  /** Voices this mount saw settle (or vanish, or deleted): a stale list row must not restart their poll. */
  const settledIds = useRef(new Set<string>());
  /** Each running poll's own controller, so deleting a voice stops its poll quietly. */
  const pollAborts = useRef(new Map<string, AbortController>());

  const refresh = useCallback(async () => {
    if (!source) return;
    const requestSource = source;
    const generation = ++loadGeneration.current;
    setListState('loading');
    // The quota rides alongside: its failure only hides the count.
    void requestSource.limits().then(
      (q) => { if (generation === loadGeneration.current && sourceRef.current === requestSource) setQuota(q); },
      () => { if (generation === loadGeneration.current && sourceRef.current === requestSource) setQuota(null); },
    );
    try {
      const listed = await requestSource.list();
      if (generation !== loadGeneration.current || sourceRef.current !== requestSource) return;
      setBuiltins(listed.builtin);
      setMine(listed.mine);
      setListState('idle');
      setCaptureError(null);
    } catch {
      if (generation !== loadGeneration.current || sourceRef.current !== requestSource) return;
      setListState('error');
    }
  }, [source]);

  useEffect(() => {
    const snap = source?.cached() ?? null;
    if (snap) {
      // Remembered: shown as is, no request. Refresh, a create or a delete asks again.
      setBuiltins(snap.builtin);
      setMine(snap.mine);
      setQuota(snap.limits);
      setListState('idle');
    } else {
      // Another account's voices must not stay listed while the new fetch runs.
      setMine([]);
      setQuota(null);
      void refresh();
    }
    return () => { loadGeneration.current++; };
  }, [refresh, source]);

  // Cached samples are per voice id, which is global; a source swap still
  // clears the namespace, as Soniox does, so nothing outlives an account.
  const previousSourceRef = useRef(source);
  useEffect(() => {
    const leaving = previousSourceRef.current;
    previousSourceRef.current = source;
    if (leaving && leaving !== source) clearPreviewCache(leaving.cacheNamespace);
  }, [source]);

  const sampleOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of [...builtins, ...mine]) if (v.sample) map.set(v.id, v.sample);
    return map;
  }, [builtins, mine]);

  const handlePreview = useCallback(async (id: string, signal?: AbortSignal) => {
    const requestSource = source;
    const sample = sampleOf.get(id);
    if (!requestSource || !sample) return null;
    setCaptureError(null);
    try {
      const result = await requestSource.preview({ id, sample, signal });
      return sourceRef.current === requestSource ? result : null;
    } catch (e) {
      if (e instanceof PalabraVoicesError && e.errorType === 'aborted') return null;
      setCaptureError(t('settings.palabraVoicePreviewFailed', 'Could not play this voice sample. Check your connection and try again.'));
      return null;
    }
  }, [source, sampleOf, t]);

  /**
   * Every voices failure in the user's words (spec §2's types). `during`
   * says what failed: a poll's `timeout` is a voice still processing and its
   * `not_found` a voice Palabra dropped; a request's are neither.
   */
  const mapError = useCallback((e: unknown, during: 'poll' | 'request' = 'request'): Error => {
    if (e instanceof PalabraVoicesError && during === 'request' && e.errorType === 'timeout') {
      return new Error(t('settings.palabraVoiceNoAnswer', 'Palabra did not answer in time. Try again.'));
    }
    if (e instanceof PalabraVoicesError) {
      switch (e.errorType) {
        case 'limit_reached': return new Error(t('settings.palabraVoiceLimitReached', 'Your Palabra account has reached its voice limit — delete a voice and try again.'));
        case 'bad_audio': return new Error(t('settings.palabraVoiceBadAudio', 'Palabra could not use this recording. Try a clearer one of at least 30 seconds, with one speaker.'));
        case 'invalid_request': return new Error(t('settings.palabraVoiceInvalidRequest', 'Palabra refused this voice. Check the name and try again.'));
        case 'auth': return new Error(t('settings.palabraVoiceAuthError', 'Palabra did not accept these credentials.'));
        case 'rate_limit': return new Error(t('settings.palabraVoiceRateLimited', 'Palabra is limiting requests. Try again in a moment.'));
        case 'upload_failed': return new Error(t('settings.palabraVoiceUploadFailed', 'The recording could not be uploaded to Palabra. Try again.'));
        case 'not_found': return new Error(t('settings.palabraVoiceProcessingFailed', 'Palabra could not process this recording. Try another one.'));
        case 'network': return new Error(t('auth.networkError', 'Network error. Please check your connection'));
        case 'timeout': return new Error(t('settings.palabraVoiceStillProcessing', 'Palabra is still processing this voice. Use Refresh to check again later.'));
        default: break;
      }
    }
    return e instanceof Error ? e : new Error(String(e));
  }, [t]);

  /**
   * Poll one voice until it settles, then refresh. Only `autoSelect` — the
   * mount that created it — may then select it, and only if the source, the
   * selection and the idle session all still hold.
   */
  const follow = useCallback(async (id: string, pollSource: PalabraVoiceSource, autoSelect: { selectionAtCreate: string } | null) => {
    const mountSignal = mountAbort.current?.signal;
    if (!mountSignal || polling.current.has(id) || settledIds.current.has(id)) return;
    // This poll's own controller: unmounting aborts it, and so does deleting the voice.
    const own = new AbortController();
    const onMountAbort = () => own.abort();
    mountSignal.addEventListener('abort', onMountAbort, { once: true });
    pollAborts.current.set(id, own);
    const signal = own.signal;
    polling.current.add(id);
    try {
      const settled = await waitUntilSettled(pollSource, id, { sleep, signal });
      settledIds.current.add(id);
      if (signal.aborted || sourceRef.current !== pollSource) return;
      await refresh();
      // The credentials may have changed during that refresh: nothing more for this account's poll.
      if (signal.aborted || sourceRef.current !== pollSource) return;
      if (settled.status === 'failed') {
        setCaptureError(t('settings.palabraVoiceProcessingFailed', 'Palabra could not process this recording. Try another one.'));
        return;
      }
      if (autoSelect && selectedVoiceRef.current === autoSelect.selectionAtCreate && !sessionActiveRef.current) {
        onSelect({ voiceId: settled.id, voiceName: settled.name });
      }
    } catch (e) {
      if (signal.aborted || (e instanceof PalabraVoicesError && e.errorType === 'aborted')) return;
      if (sourceRef.current !== pollSource) return;
      if (e instanceof PalabraVoicesError && (e.errorType === 'not_found' || e.errorType === 'timeout')) settledIds.current.add(id);
      if (e instanceof PalabraVoicesError && e.errorType === 'not_found') await refresh();
      setCaptureError(mapError(e, 'poll').message);
    } finally {
      polling.current.delete(id);
      pollAborts.current.delete(id);
      mountSignal.removeEventListener('abort', onMountAbort);
    }
  }, [mapError, onSelect, refresh, sleep, t]);

  // A mount that finds voices still processing (created on an earlier visit,
  // or elsewhere) follows them too, without selecting any.
  useEffect(() => {
    if (!source || listState !== 'idle') return;
    for (const v of mine) if (v.status === 'processing' && !settledIds.current.has(v.id)) void follow(v.id, source, null);
  }, [follow, listState, mine, source]);

  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingSeq, setPendingSeq] = useState(0);
  const [pendingLanguage, setPendingLanguage] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);

  const defaultName = () => cleanVoiceName(t('settings.palabraVoiceDefaultName', 'My Voice {{n}}', { n: mine.length + 1 }));
  const stage = (next: Pending) => {
    setPending(next);
    setPendingSeq((n) => n + 1);
    setModalError(null);
    setPendingLanguage(cloneLanguageFor(pairSource) ?? cloneLanguageFor(uiLanguage) ?? '');
  };

  const clipError = (reason: ClipValidationError): Error => {
    switch (reason) {
      case 'too_short':
        return new Error(t('voiceLibrary.clipTooShort', 'Recording is too short — speak for at least {seconds} seconds.').replace('{seconds}', String(PALABRA_MIN_CLIP_SECONDS)));
      case 'too_long':
        return new Error(t('voiceLibrary.clipTooLong', 'Recording is too long — keep it under {seconds} seconds.').replace('{seconds}', String(PALABRA_MAX_CLIP_SECONDS)));
      default:
        return new Error(t('voiceLibrary.clipSilent', 'No voice detected — check your microphone and try again.'));
    }
  };

  /** Validate a mono clip and make the WAV Palabra will receive (spec §4 "Bounds", "Always upload WAV"). */
  const toWav = (clip: Float32Array, sampleRate: number): Blob => {
    const reason = validateVoiceClip(clip, sampleRate, PALABRA_MAX_CLIP_SECONDS, PALABRA_MIN_CLIP_SECONDS);
    if (reason) throw clipError(reason);
    const capped = capRate(clip, sampleRate);
    const wav = encodeWavPcm16(capped.clip, capped.sampleRate);
    if (wav.size > PALABRA_MAX_UPLOAD_BYTES) throw clipError('too_long');
    return wav;
  };

  // Recordings are validated too: the shared recorder only counts down to the maximum.
  const onRecord = async (clip: Float32Array, sampleRate: number) => {
    setCaptureError(null);
    // The shared recorder stops on a timer, so a clip run to the countdown can
    // be a few ms past the ceiling: keep its first 90 s rather than lose it.
    const ceiling = Math.floor(PALABRA_MAX_CLIP_SECONDS * sampleRate);
    const kept = clip.length > ceiling ? clip.subarray(0, ceiling) : clip;
    stage({ wav: toWav(kept, sampleRate), denoise: true, suggestedName: defaultName() });
  };

  const onImport = async (file: File) => {
    setCaptureError(null);
    if (file.size > PALABRA_MAX_UPLOAD_BYTES) {
      throw new Error(t('settings.palabraVoiceFileTooLarge', 'This file is too large (max {{mb}} MB).', { mb: PALABRA_MAX_UPLOAD_BYTES / 1_000_000 }));
    }
    const ctx = new AudioContext();
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error(t('voiceLibrary.decodeFailed', 'Could not read that audio file — try a WAV, MP3, or other common format.'));
    } finally {
      void ctx.close();
    }
    const wav = toWav(downmixToMono(buffer), buffer.sampleRate);
    const fromFile = cleanVoiceName(file.name.replace(/\.[^.]+$/, ''));
    stage({ wav, denoise: false, suggestedName: fromFile.length >= 3 ? fromFile : defaultName() });
  };

  const closeModal = () => {
    if (modalBusy) return;
    setPending(null);
    setModalError(null);
  };

  const handleConfirm = async (typed: string) => {
    if (!source || !pending || modalBusy) return;
    const name = typed.trim() || pending.suggestedName;
    if (!PALABRA_VOICE_NAME.test(name)) {
      setModalError(t('settings.palabraVoiceNameInvalid', 'Use 3–64 letters, numbers, spaces, or - . _ ( ).'));
      return;
    }
    if (!pendingLanguage) return;
    const createSource = source;
    const selectionAtCreate = settings.voiceId;
    setModalBusy(true);
    setModalError(null);
    try {
      const created = await createSource.create({ name, wav: pending.wav, langCode: pendingLanguage, denoise: pending.denoise });
      await refresh();
      setPending(null);
      setModalBusy(false);
      void follow(created.id, createSource, { selectionAtCreate });
    } catch (e) {
      setModalError(mapError(e).message);
      setModalBusy(false);
    }
  };

  const languageOptions = useMemo(
    () => PALABRA_CLONE_LANGUAGES.map((code) => ({ value: code, label: languageLabel(cloneLanguageDisplayCode(code), uiLanguage) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [uiLanguage],
  );

  const nameOf = useMemo(() => {
    const map = new Map<string, string>(PALABRA_VOICES.map((v) => [v.value, v.name]));
    for (const v of [...builtins, ...mine]) map.set(v.id, v.name);
    return map;
  }, [builtins, mine]);

  /** The defaults, then the built-ins: the row language's section first, then "Other languages". */
  const builtinEntries = useCallback((language: string): VoiceEntry[] => {
    const defaults: VoiceEntry[] = PALABRA_VOICES.map((v) => ({ id: v.value, label: v.name, group: 'builtin', removable: false, previewable: false }));
    const own = languageLabel(baseLanguage(language), uiLanguage);
    const other = t('settings.palabraVoiceOtherLanguages', 'Other languages');
    const entry = (v: PalabraVoiceInfo, section: string): VoiceEntry => ({
      id: v.id, label: v.name, group: 'builtin', removable: false, previewable: !!v.sample, section,
      meta: { language: v.language ?? undefined, facets: v.facets.gender ? { gender: v.facets.gender } : {} },
    });
    const first = builtins.filter((v) => sameLanguage(v.language, language)).map((v) => entry(v, own));
    const rest = builtins.filter((v) => !sameLanguage(v.language, language)).map((v) => entry(v, other));
    return [...defaults, ...first, ...rest];
  }, [builtins, uiLanguage, t]);

  /** An account voice's label: its name, with the state Soniox badges too. */
  const voiceLabel = useCallback((v: PalabraVoiceInfo): string => {
    if (v.status === 'failed') return `${v.name} — ${t('settings.palabraVoiceFailedBadge', 'failed')}`;
    if (v.status === 'processing') return `${v.name} — ${t('settings.palabraVoiceProcessingBadge', 'processing…')}`;
    return v.name;
  }, [t]);

  const customEntries = useMemo<VoiceEntry[]>(() => mine.map((v) => ({
    id: v.id,
    label: voiceLabel(v),
    group: 'custom',
    removable: true,
    disabled: v.status !== 'ready',
    previewable: v.status === 'ready' && !!v.sample,
  })), [mine, voiceLabel]);

  /** A stored id the list does not hold: "(deleted voice)" only once a fetch has succeeded; else its stored name, else the id. */
  const placeholder = useCallback((id: string, storedName: string, known: Set<string>): VoiceEntry | null => {
    if (!id || known.has(id) || listState === 'loading') return null;
    const deleted = !!source && listState === 'idle';
    return {
      id,
      label: deleted ? t('settings.palabraVoiceDeletedPlaceholder', '(deleted voice)') : storedName || id,
      group: 'custom',
      removable: false,
      disabled: true,
    };
  }, [listState, source, t]);

  const firstRow = useMemo<VoiceEntry[]>(() => {
    const entries = [...builtinEntries(target), ...customEntries];
    const extra = placeholder(settings.voiceId, settings.voiceName, new Set(entries.map((e) => e.id)));
    return extra ? [...entries, extra] : entries;
  }, [builtinEntries, customEntries, placeholder, settings.voiceId, settings.voiceName, target]);

  const secondRow = useMemo<VoiceEntry[]>(() => {
    const entries = builtinEntries(pairSource);
    const extra = placeholder(settings.participantVoiceId, settings.participantVoiceName, new Set(entries.map((e) => e.id)));
    return extra ? [...entries, extra] : entries;
  }, [builtinEntries, pairSource, placeholder, settings.participantVoiceId, settings.participantVoiceName]);

  const onDelete = async (id: string) => {
    if (!source) return;
    // A running session speaks in the voice it started with; deleting it would cut that off.
    if (isSessionActive && settings.voiceId === id) {
      throw new Error(t('settings.palabraVoiceDeleteInUse', 'This voice is being used by the active session — end the session before deleting it'));
    }
    // Its poll, if one runs, must not report the 404 its deletion causes.
    settledIds.current.add(id);
    pollAborts.current.get(id)?.abort();
    try {
      await source.delete(id);
    } catch (e) {
      // Already gone (deleted elsewhere, or dropped by Palabra): the delete is done.
      if (!(e instanceof PalabraVoicesError && e.errorType === 'not_found')) {
        // Still there: refresh so its poll resumes and its state stays true.
        settledIds.current.delete(id);
        void refresh();
        throw new Error(mapError(e).message);
      }
    }
    await refresh();
    if (selectedVoiceRef.current === id) onSelect({ voiceId: PALABRA_DEFAULTS.voiceId, voiceName: '' });
  };

  const listKnown = !!source && listState === 'idle';
  const slotsLeft = !quota || quota.remaining > 0;
  const canCreate = !!source && slotsLeft;

  return (
    // `#voice-settings-section` is Settings' `voice-settings` target, the Speech rows' voice links.
    <div className="settings-section" id="voice-settings-section">
      <h2>{t('settings.voiceSettings', 'Voice Settings')}</h2>
      {listState === 'error' && (
        <div className="setting-item">
          <div className="setting-description">
            {t('settings.palabraVoiceListError', 'Could not load the Palabra voices — check your connection and credentials.')}{' '}
            <button className="inline-action-button" onClick={() => void refresh()}>
              {t('common.retry', 'Retry')}
            </button>
          </div>
        </div>
      )}
      <VoiceLibrarySection
        label={participant ? t('settings.voiceTheyHear', 'Voice the other side hears') : undefined}
        voices={firstRow}
        selectedId={settings.voiceId}
        onSelect={(id) => onSelect({ voiceId: id, voiceName: nameOf.get(id) ?? '' })}
        onDelete={onDelete}
        onPreview={source ? handlePreview : undefined}
        onRefresh={source ? () => void refresh() : undefined}
        refreshing={listState === 'loading'}
        onImport={canCreate ? onImport : undefined}
        onRecord={canCreate ? onRecord : undefined}
        customQuota={listKnown && quota ? { used: quota.used, limit: quota.limit } : undefined}
        manageNote={source && !slotsLeft
          ? t('settings.palabraVoiceNoSlotsLeft', 'Your Palabra account has no voice slots left — delete a voice to add another.')
          : undefined}
        capability={{
          importModes: canCreate ? ['record', 'upload'] : [],
          facetFilter: true,
          accept: 'audio/*',
          maxClipSeconds: PALABRA_MAX_CLIP_SECONDS,
          minClipSeconds: PALABRA_MIN_CLIP_SECONDS,
          // The review step stages exactly one clip.
          multipleImport: false,
        }}
        isSessionActive={isSessionActive}
        createReview={pending === null ? null : {
          seq: pendingSeq,
          audioBlob: pending.wav,
          error: modalError,
          busy: modalBusy,
          showName: true,
          language: {
            label: t('settings.palabraVoiceLanguageLabel', 'Language of the recording'),
            options: languageOptions,
            value: pendingLanguage,
            onChange: setPendingLanguage,
          },
          onConfirm: (name: string) => void handleConfirm(name),
          onClose: closeModal,
        }}
      />
      {participant && (
        <VoiceLibrarySection
          label={t('settings.voiceIHear', 'Voice I hear')}
          voices={secondRow}
          selectedId={settings.participantVoiceId}
          onSelect={(id) => onSelect({ participantVoiceId: id, participantVoiceName: nameOf.get(id) ?? '' })}
          onDelete={NO_DELETE}
          onPreview={source ? handlePreview : undefined}
          capability={{ importModes: [], facetFilter: true }}
          isSessionActive={isSessionActive}
          note={participant.effective !== settings.participantVoiceId
            ? t('settings.voiceIHearSame', 'Same as the voice the other side hears, so {{voice}} reads instead.', { voice: nameOf.get(participant.effective) ?? participant.effective })
            : undefined}
        />
      )}
      {captureError && (
        <div className="voice-capture-error" role="alert">{captureError}</div>
      )}
    </div>
  );
};

export default PalabraVoiceSection;
