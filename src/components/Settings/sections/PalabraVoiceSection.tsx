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
import { clearPreviewCache } from '../../../lib/tts/previewCache';
import { sameLanguage } from '../../../providers/palabraai/cloneLanguages';
import { PALABRA_DEFAULTS, PALABRA_VOICES } from '../../../providers/palabraai/settings';
import type { PalabraVoiceSource } from '../../../providers/palabraai/voiceSource';
import { PalabraVoicesError, type PalabraVoiceInfo } from '../../../providers/palabraai/voicesClient';

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
}

/** No delete: the second row lists defaults and built-ins only. */
const NO_DELETE = async () => {};

const base = (code: string) => code.trim().toLowerCase().replace(/_/g, '-').split('-')[0];

const PalabraVoiceSection: React.FC<PalabraVoiceSectionProps> = ({
  settings, onSelect, source, target, pairSource, participant, isSessionActive,
}) => {
  const { t, i18n } = useTranslation();
  const sourceRef = useRef(source);
  useEffect(() => { sourceRef.current = source; }, [source]);
  const [builtins, setBuiltins] = useState<PalabraVoiceInfo[]>([]);
  const [mine, setMine] = useState<PalabraVoiceInfo[]>([]);
  // 'loading' from the first paint while a source exists, so a stored id is
  // not judged against a list that has not arrived.
  const [listState, setListState] = useState<'idle' | 'loading' | 'error'>(source ? 'loading' : 'idle');
  const [quota, setQuota] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const loadGeneration = useRef(0);

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
    // Another account's voices must not stay listed while the new fetch runs.
    setMine([]);
    setQuota(null);
    void refresh();
    return () => { loadGeneration.current++; };
  }, [refresh]);

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

  const nameOf = useMemo(() => {
    const map = new Map<string, string>(PALABRA_VOICES.map((v) => [v.value, v.name]));
    for (const v of [...builtins, ...mine]) map.set(v.id, v.name);
    return map;
  }, [builtins, mine]);

  /** The defaults, then the built-ins: the row language's section first, then "Other languages". */
  const builtinEntries = useCallback((language: string): VoiceEntry[] => {
    const defaults: VoiceEntry[] = PALABRA_VOICES.map((v) => ({ id: v.value, label: v.name, group: 'builtin', removable: false, previewable: false }));
    const own = languageLabel(base(language), i18n.language);
    const other = t('settings.palabraVoiceOtherLanguages', 'Other languages');
    const entry = (v: PalabraVoiceInfo, section: string): VoiceEntry => ({
      id: v.id, label: v.name, group: 'builtin', removable: false, previewable: !!v.sample, section,
      meta: { language: v.language ?? undefined, facets: v.facets.gender ? { gender: v.facets.gender } : {} },
    });
    const first = builtins.filter((v) => sameLanguage(v.language, language)).map((v) => entry(v, own));
    const rest = builtins.filter((v) => !sameLanguage(v.language, language)).map((v) => entry(v, other));
    return [...defaults, ...first, ...rest];
  }, [builtins, i18n.language, t]);

  const customEntries = useMemo<VoiceEntry[]>(() => mine.map((v) => ({
    id: v.id,
    label: v.status === 'failed'
      ? `${v.name} — ${t('settings.palabraVoiceFailedBadge', 'failed')}`
      : v.status === 'processing'
        ? `${v.name} — ${t('settings.palabraVoiceProcessingBadge', 'processing…')}`
        : v.name,
    group: 'custom',
    removable: true,
    disabled: v.status !== 'ready',
    previewable: v.status === 'ready' && !!v.sample,
  })), [mine, t]);

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
    await source.delete(id);
    await refresh();
    if (settings.voiceId === id) onSelect({ voiceId: PALABRA_DEFAULTS.voiceId, voiceName: '' });
  };

  const listKnown = !!source && listState === 'idle';

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
        customQuota={listKnown && quota ? { used: quota.used, limit: quota.limit } : undefined}
        capability={{ importModes: [], facetFilter: true }}
        isSessionActive={isSessionActive}
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
