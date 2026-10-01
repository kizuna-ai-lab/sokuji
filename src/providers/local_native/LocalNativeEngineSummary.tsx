import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Cpu } from 'lucide-react';
import { EngineStatusLine } from '../../components/Settings/sections/EngineStatusLine';
import {
  actualNativeMemoryByDevice, estimateNativeMemoryByDevice, formatMemMb,
  nativeAsrCards, nativeAsrIncompatibleCards, nativeTranslationCards, nativeTtsModels,
} from '../../lib/local-inference/native/nativeCatalog';
import { shortenModelName } from '../../lib/local-inference/modelName';
import { directionKey, emptyDirection, type DirectionResult, type ResolutionNote, type Selections } from '../../lib/local-inference/selection/types';
import type { EngineSummaryProps } from '../../lib/provider/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { FALLBACK_PAIR, modeOfLegs } from './engineLegs';
import type { LocalNativeSettings } from './settings';

/**
 * Local Native's summary under the provider picker: the engine's status
 * line, a chip per stage of each direction the legs run, the memory the
 * resolved models take (estimated, or in use once a run reported its plan),
 * and the fallbacks in use — the old `ProviderSection` and `LanguageSection`
 * blocks, read from `settings` and the pair.
 */
export function LocalNativeEngineSummary({
  settings, update, disabled = false, pair = FALLBACK_PAIR, legs, openSlot,
}: EngineSummaryProps<LocalNativeSettings>) {
  const { t } = useTranslation();
  const mode = modeOfLegs(legs);
  const sidecarStatus = useNativeModelStore((s) => s.sidecarStatus);
  const catalog = useNativeModelStore((s) => s.catalog);
  const statuses = useNativeModelStore((s) => s.statuses);
  const sizes = useNativeModelStore((s) => s.sizes);
  const asrResolved = useNativeModelStore((s) => s.asrResolved);
  const translationResolved = useNativeModelStore((s) => s.translationResolved);
  const resolutionNotes = useNativeModelStore((s) => s.lastResolutionNotes);

  const speaker: DirectionResult = useMemo(
    () => useNativeModelStore.getState().resolve(pair.source, pair.target, settings.selections),
    [pair.source, pair.target, settings.selections, catalog, statuses],
  );
  const participant: DirectionResult = useMemo(
    () => useNativeModelStore.getState().resolve(pair.target, pair.source, settings.selections),
    [pair.source, pair.target, settings.selections, catalog, statuses],
  );

  // Local Native runs one side at a time (#578 ruling 4): the memory is that of the
  // direction that runs, and a participant run has no voice, as its chips show none.
  const running = mode === 'participant' ? participant : speaker;
  const estimate = useMemo(() => estimateNativeMemoryByDevice([
    { id: running.asr?.modelId, device: settings.asrDevice },
    { id: running.translation?.modelId, device: settings.translationDevice },
    { id: mode === 'participant' ? undefined : running.tts?.modelId, device: settings.ttsDevice },
  ], sizes, catalog), [running, mode, settings.asrDevice, settings.translationDevice, settings.ttsDevice, sizes, catalog]);

  // What is really in use once a run reported its plan — only while it is about the current picks.
  const actual = useMemo(() => {
    const asrMatch = !!asrResolved && asrResolved.model === running.asr?.modelId;
    const trMatch = !!translationResolved && translationResolved.model === running.translation?.modelId;
    if (!asrMatch || !trMatch) return null;
    const mem = actualNativeMemoryByDevice(asrResolved, translationResolved);
    const degraded = [asrResolved, translationResolved].some((r) => r?.device === 'cpu' && r?.fallbackReason);
    return { ...mem, degraded };
  }, [asrResolved, translationResolved, running]);

  const renderChips = (resolved: DirectionResult, src: string, tgt: string, includeTts: boolean): React.ReactNode => {
    const dir = directionKey(src, tgt);
    const asrId = resolved.asr?.modelId;
    const asrCard = asrId ? [...nativeAsrCards(src, catalog), ...nativeAsrIncompatibleCards(src, catalog)].find((c) => c.selectId === asrId) : undefined;
    const trId = resolved.translation?.modelId;
    const trCard = trId ? nativeTranslationCards(src, tgt, catalog).find((c) => c.selectId === trId) : undefined;
    const ttsId = resolved.tts?.modelId;
    const ttsModel = ttsId ? nativeTtsModels(tgt, catalog).find((m) => m.id === ttsId) : undefined;
    const chip = (stage: 'asr' | 'translation' | 'tts', labelKey: string, labelDefault: string, id: string | undefined, name: string | undefined) => (
      <button type="button" className="model-chip" onClick={() => openSlot({ dir, stage })}>
        <span className="model-chip-label">{t(labelKey, labelDefault)}</span>
        <span className={`model-chip-value ${id ? 'model-ok' : 'model-warn'}`}>
          {id ? shortenModelName(name ?? id) : t('common.none', 'None')}
        </span>
      </button>
    );
    return (
      <>
        {chip('asr', 'providers.local_inference.modelAsr', 'ASR', asrId, asrCard?.name)}
        {chip('translation', 'providers.local_inference.modelTranslation', 'MT', trId, trCard?.name)}
        {includeTts && chip('tts', 'providers.local_inference.modelTts', 'TTS', ttsId, ttsModel?.name)}
      </>
    );
  };

  const chipGroups = (): React.ReactNode => {
    if (mode === 'participant') return <div className="model-inline">{renderChips(participant, pair.target, pair.source, false)}</div>;
    if (mode === 'both') {
      return (
        <>
          <div className="model-inline-group">
            <span className="model-inline-group__label">{t('modePicker.modeYou', 'Me')}</span>
            <div className="model-inline">{renderChips(speaker, pair.source, pair.target, true)}</div>
          </div>
          <div className="model-inline-group">
            <span className="model-inline-group__label">{t('modePicker.modeParticipants', 'Other')}</span>
            <div className="model-inline">{renderChips(participant, pair.target, pair.source, false)}</div>
          </div>
        </>
      );
    }
    return <div className="model-inline">{renderChips(speaker, pair.source, pair.target, true)}</div>;
  };

  // The fallbacks in use: what readiness found once the engine's catalog and the downloads were
  // read, so they are worded only then (resolving here before that would call every explicit pick
  // unavailable). Only the directions the legs show: a note for a hidden direction would deep-link
  // to a slot that is not rendered. no-candidate notes are readiness's to word.
  const notes = useMemo(() => {
    if (sidecarStatus !== 'ready') return [];
    const shown = new Set(mode === 'both'
      ? [directionKey(pair.source, pair.target), directionKey(pair.target, pair.source)]
      : [mode === 'participant' ? directionKey(pair.target, pair.source) : directionKey(pair.source, pair.target)]);
    return resolutionNotes.filter((n: ResolutionNote) => n.reason !== 'no-candidate' && shown.has(n.direction));
  }, [sidecarStatus, resolutionNotes, mode, pair.source, pair.target]);
  const staleNames: string[] = [];
  for (const n of notes) {
    if (!n.from) continue;
    const name = shortenModelName(catalog[n.from]?.name ?? n.from);
    if (!staleNames.includes(name)) staleNames.push(name);
  }
  const switchNotesToAuto = () => {
    const next: Selections = { ...settings.selections };
    for (const n of notes) next[n.direction] = { ...(next[n.direction] ?? emptyDirection()), [n.stage]: { modelId: '' } };
    update({ selections: next });
  };

  return (
    <>
      <EngineStatusLine />
      {/* data-tour on the wrapper: the tour's models step can run while the sidecar still starts. */}
      <div className="local-inference-info" data-tour="engine-chips">
        {sidecarStatus === 'starting' || sidecarStatus === 'idle' ? (
          <div className="model-info local-native-status is-loading">{t('settings.localNativeStarting', 'Starting the local engine')}</div>
        ) : sidecarStatus === 'unavailable' ? (
          <div className="model-info local-native-status is-error">{t('settings.localNativeUnavailable', 'Native engine unavailable — retry in settings')}</div>
        ) : (
          <div className="model-info">
            {chipGroups()}
            {actual ? (
              <div className="memory-estimate">
                <Cpu size={11} />
                <span className="memory-estimate__label">{t('engineUi.inUse', 'In use')}</span>
                {actual.vramMb > 0 && <span>VRAM {formatMemMb(actual.vramMb)}</span>}
                {actual.ramMb > 0 && <span>RAM {formatMemMb(actual.ramMb)}</span>}
                {actual.degraded && <span className="memory-estimate__warn">{t('engineUi.translationOnCpu', 'Translation on CPU — not enough VRAM')}</span>}
              </div>
            ) : (estimate.vramMb > 0 || estimate.ramMb > 0) && (
              <div className="memory-estimate">
                <Cpu size={11} />
                <span className="memory-estimate__label">{t('engineUi.estimated', 'Estimated')}</span>
                {estimate.vramMb > 0 && <span>VRAM ~{formatMemMb(estimate.vramMb)}</span>}
                {estimate.ramMb > 0 && <span>RAM ~{formatMemMb(estimate.ramMb)}</span>}
              </div>
            )}
          </div>
        )}
        {notes.length > 0 && (
          <div className="language-resolution-notes" data-testid="language-resolution-notes">
            <div className="language-warning">
              <AlertTriangle size={12} />
              <span>
                {staleNames.length === 0
                  ? t('settings.resolutionNotesSummary', '{{count}} of your selected models are unavailable — automatic fallbacks are in use.', { count: notes.length })
                  : staleNames.length > 2
                    ? t('settings.resolutionNotesNamedMore', '{{names}} and {{count}} more unavailable — automatic fallbacks are in use.', { names: staleNames.slice(0, 2).join(', '), count: staleNames.length - 2 })
                    : t('settings.resolutionNotesNamed', '{{names}} unavailable — automatic fallbacks are in use.', { names: staleNames.join(', ') })}
                {' '}
                <button type="button" className="language-model-warning__link" data-testid="resolution-notes-review"
                  onClick={() => openSlot({ dir: notes[0].direction, stage: notes[0].stage })}>
                  {t('settings.resolutionNotesReview', 'Review')}
                </button>
                {' · '}
                <button type="button" className="language-model-warning__link" data-testid="resolution-notes-use-auto"
                  onClick={switchNotesToAuto} disabled={disabled}>
                  {t('settings.resolutionNotesUseAuto', 'Switch to Auto')}
                </button>
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
