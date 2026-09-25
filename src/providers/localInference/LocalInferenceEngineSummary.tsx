import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, AlertTriangle } from 'lucide-react';
import type { EngineSummaryProps } from '../../lib/provider/types';
import { getManifestEntry, estimateModelMemoryByDevice } from '../../lib/local-inference/modelManifest';
import { shortenModelName } from '../../lib/local-inference/modelName';
import { useModelStore } from '../../stores/modelStore';
import { directionKey, emptyDirection, type DirectionResult, type Selections, type ResolutionNote } from '../../lib/local-inference/selection/types';
import { modeOfLegs } from './LocalInferenceEngine';
import type { LocalInferenceSettings } from './settings';

/** `ProviderPicker` always supplies `pair`; this only matters standalone. */
const FALLBACK_PAIR = { source: 'ja', target: 'en' };

/**
 * LocalInference's summary under the provider picker (1e-3 ruling 10): a
 * chip per stage of each direction the legs run, the memory the resolved
 * models take, and the fallbacks in use — today's `ProviderSection` chips
 * and `LanguageSection` notes, read from `settings` and the pair instead of
 * the old slice.
 */
export function LocalInferenceEngineSummary({
  settings, update, disabled = false, pair = FALLBACK_PAIR, legs, openSlot,
}: EngineSummaryProps<LocalInferenceSettings>) {
  const { t } = useTranslation();
  const mode = modeOfLegs(legs);
  const isParticipantChannelInScope = legs.includes('participant');

  const deviceFeatures = useModelStore((s) => s.deviceFeatures);
  const modelStatuses = useModelStore((s) => s.modelStatuses);

  const speakerResolved: DirectionResult = useMemo(
    () => useModelStore.getState().resolve(pair.source, pair.target, settings.selections),
    [pair.source, pair.target, settings.selections, modelStatuses],
  );
  // The participant direction (target→source) is a peer of the speaker
  // direction, not a reversal of it: resolve it directly via the same
  // resolve() the session-config builder uses, against its own selections
  // entry — never derived from the speaker's chosen models.
  const participantResolved: DirectionResult = useMemo(
    () => useModelStore.getState().resolve(pair.target, pair.source, settings.selections),
    [pair.source, pair.target, settings.selections, modelStatuses],
  );

  const memoryEstimate = useMemo(() => {
    // Skip cloud TTS models (e.g. Edge TTS) — they don't consume local memory.
    const ttsId = speakerResolved.tts?.modelId;
    const ttsEntry = ttsId ? getManifestEntry(ttsId) : undefined;
    const effectiveTtsId = ttsEntry?.isCloudModel ? undefined : ttsId;

    const mainIds = [speakerResolved.asr?.modelId, speakerResolved.translation?.modelId, effectiveTtsId];
    const participantIds = isParticipantChannelInScope
      ? [participantResolved.asr?.modelId, participantResolved.translation?.modelId]
      : [];
    return estimateModelMemoryByDevice([...mainIds, ...participantIds], deviceFeatures);
  }, [deviceFeatures, isParticipantChannelInScope, participantResolved, speakerResolved]);

  // ── Chip groups: mode-aware ──────────────────────────────────────────
  //
  // - 'speaker'     → 3 chips (ASR/MT/TTS) for src→tgt.
  // - 'participant' → 2 chips (ASR/MT — no TTS) for the REVERSE tgt→src.
  // - 'both'        → both groups, each under a small-caps label so which
  //   group is whose is never ambiguous.
  const renderChipGroups = (
    renderChips: (resolved: DirectionResult | null, src: string, tgt: string, includeTts: boolean) => React.ReactNode,
    speaker: DirectionResult | null,
    participant: DirectionResult | null,
    src: string,
    tgt: string,
  ): React.ReactNode => {
    if (mode === 'participant') {
      return <div className="model-inline">{renderChips(participant, tgt, src, false)}</div>;
    }
    if (mode === 'both') {
      return (
        <>
          <div className="model-inline-group">
            <span className="model-inline-group__label">{t('modePicker.modeYou', 'Me')}</span>
            <div className="model-inline">{renderChips(speaker, src, tgt, true)}</div>
          </div>
          <div className="model-inline-group">
            <span className="model-inline-group__label">{t('modePicker.modeParticipants', 'Other')}</span>
            <div className="model-inline">{renderChips(participant, tgt, src, false)}</div>
          </div>
        </>
      );
    }
    // 'speaker' (default)
    return <div className="model-inline">{renderChips(speaker, src, tgt, true)}</div>;
  };

  // Reads the static WASM manifest directly, same as today's LOCAL_INFERENCE
  // chip row.
  const renderInferenceChips = (resolved: DirectionResult | null, src: string, tgt: string, includeTts: boolean): React.ReactNode => {
    const dir = directionKey(src, tgt);
    // resolve() only returns a stage when it's a usable (ready + hardware-ok,
    // or always-ready cloud) candidate, so its presence already means
    // "ready" — no separate modelStatuses check needed.
    const asrId = resolved?.asr?.modelId;
    const trId = resolved?.translation?.modelId;
    const wasmShort = (id: string): string => {
      const entry = getManifestEntry(id);
      return entry ? shortenModelName(entry.name, entry.shortName) : id;
    };
    return (
      <>
        <button type="button" className="model-chip" onClick={() => openSlot({ dir, stage: 'asr' })}>
          <span className="model-chip-label">{t('providers.local_inference.modelAsr', 'ASR')}</span>
          <span className={`model-chip-value ${asrId ? 'model-ok' : 'model-warn'}`}>
            {asrId ? wasmShort(asrId) : t('common.none', 'None')}
          </span>
        </button>
        <button type="button" className="model-chip" onClick={() => openSlot({ dir, stage: 'translation' })}>
          <span className="model-chip-label">{t('providers.local_inference.modelTranslation', 'MT')}</span>
          <span className={`model-chip-value ${trId ? 'model-ok' : 'model-warn'}`}>
            {trId ? wasmShort(trId) : t('common.none', 'None')}
          </span>
        </button>
        {includeTts && (() => {
          const id = resolved?.tts?.modelId;
          return (
            <button type="button" className="model-chip" onClick={() => openSlot({ dir, stage: 'tts' })}>
              <span className="model-chip-label">{t('providers.local_inference.modelTts', 'TTS')}</span>
              <span className={`model-chip-value ${id ? 'model-ok' : 'model-warn'}`}>
                {id ? wasmShort(id) : t('common.none', 'None')}
              </span>
            </button>
          );
        })()}
      </>
    );
  };

  // S0: the fallbacks in use — automatic substitutions made while picking
  // models for this pair — right where the summary already sits. Scoped to
  // the directions the legs actually show: a note about a hidden leg would
  // deep-link to a slot that is not rendered. no-candidate notes are the
  // BLOCKING condition and belong to readiness's own words (ruling 5), not
  // this summary.
  const fallbackNotes = useMemo(
    () => [...speakerResolved.notes, ...(isParticipantChannelInScope ? participantResolved.notes : [])]
      .filter((n: ResolutionNote) => n.reason !== 'no-candidate'),
    [speakerResolved, participantResolved, isParticipantChannelInScope],
  );

  // Name the picks that failed (deduped: the same deleted model noted in two
  // directions is one name) — a summary that will not say WHICH models it
  // means cannot be acted on.
  const noteName = (id: string): string => {
    const entry = getManifestEntry(id);
    return entry ? shortenModelName(entry.name, entry.shortName) : id;
  };
  const staleIds: string[] = [];
  for (const n of fallbackNotes) {
    if (n.from && !staleIds.includes(n.from)) staleIds.push(n.from);
  }
  const staleNames = staleIds.map(noteName);

  // "Switch to Auto": accept the current fallbacks by writing an EXPLICIT
  // auto ('') into every noted slot — a user-initiated write, so it does not
  // violate the never-write-back-auto rule. No revalidation call here:
  // readiness resets on the settings write and the root re-checks.
  const switchNotesToAuto = () => {
    const next: Selections = { ...settings.selections };
    for (const n of fallbackNotes) {
      next[n.direction] = { ...(next[n.direction] ?? emptyDirection()), [n.stage]: { modelId: '' } };
    }
    update({ selections: next });
  };

  return (
    // data-tour sits on the wrapper, matching today's engine-chips anchor.
    <div className="local-inference-info" data-tour="engine-chips">
      <div className="model-info">
        {renderChipGroups(renderInferenceChips, speakerResolved, participantResolved, pair.source, pair.target)}
        {memoryEstimate && (memoryEstimate.vramMb > 0 || memoryEstimate.ramMb > 0) && (
          <div className="memory-estimate">
            <Cpu size={11} />
            {memoryEstimate.vramMb > 0 && (
              <span>VRAM ~{memoryEstimate.vramMb >= 1024 ? `${(memoryEstimate.vramMb / 1024).toFixed(1)} GB` : `${memoryEstimate.vramMb} MB`}</span>
            )}
            {memoryEstimate.ramMb > 0 && (
              <span>RAM ~{memoryEstimate.ramMb >= 1024 ? `${(memoryEstimate.ramMb / 1024).toFixed(1)} GB` : `${memoryEstimate.ramMb} MB`}</span>
            )}
          </div>
        )}
      </div>
      {fallbackNotes.length > 0 && (
        <div className="language-resolution-notes" data-testid="language-resolution-notes">
          <div className="language-warning">
            <AlertTriangle size={12} />
            <span>
              {staleNames.length === 0
                ? t('settings.resolutionNotesSummary', '{{count}} of your selected models are unavailable — automatic fallbacks are in use.', { count: fallbackNotes.length })
                : staleNames.length > 2
                  ? t('settings.resolutionNotesNamedMore', '{{names}} and {{count}} more unavailable — automatic fallbacks are in use.', { names: staleNames.slice(0, 2).join(', '), count: staleNames.length - 2 })
                  : t('settings.resolutionNotesNamed', '{{names}} unavailable — automatic fallbacks are in use.', { names: staleNames.join(', ') })}
              {' '}
              <button
                type="button"
                className="language-model-warning__link"
                data-testid="resolution-notes-review"
                onClick={() => openSlot({ dir: fallbackNotes[0].direction, stage: fallbackNotes[0].stage })}
              >
                {t('settings.resolutionNotesReview', 'Review')}
              </button>
              {' · '}
              <button
                type="button"
                className="language-model-warning__link"
                data-testid="resolution-notes-use-auto"
                onClick={switchNotesToAuto}
                disabled={disabled}
              >
                {t('settings.resolutionNotesUseAuto', 'Switch to Auto')}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
