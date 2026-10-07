import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import { useModelStore, useModelStatuses } from '../../stores/modelStore';
import { SMART_TURN_TOTAL_BYTES, useSmartTurnPhase, useSmartTurnStore } from '../../stores/smartTurnStore';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { supportsSmartTurn, effectiveCheckAfter, type VadEndOfTurn } from '../../lib/turn/smartTurn';
import { EndOfTurnControl, VadControl } from '../../components/Settings/sections/LocalSettingsControls';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { LanguagePair, SettingsProps } from '../../lib/provider/types';
import type { LocalInferenceSettings as S } from './settings';

// Matches `LocalSettingsControls.tsx`'s own inline help icon — the same
// tooltip trigger VadControl's heading carries, repeated on the Speech
// section's row by `LocalInferenceTurnDetectionHelp` below.
const helpIcon = (
  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
);

/**
 * Which VAD knobs the speaker direction's resolved ASR takes — the one rule
 * both halves of LocalInference's `TurnDetection` follow (today's, from
 * `ProviderSpecificSettings.tsx`). `showVad` is false only for a streaming
 * ASR that reports no worker type: endpoint detection replaces VAD there.
 * `vadIsWebWorker` adds the three vad-web knobs; the sherpa-onnx engine has
 * its own hysteresis and cuts at a fixed length. `smart` is what a session
 * will run: a stored Smart whose model is not on disk reads as Normal.
 */
function useVadKnobs(settings: S, pair: LanguagePair | undefined) {
  // `localInferenceLanguages.initial()` gives the same fallback; the Speech
  // section always supplies `pair` in the app, so this only matters standalone.
  const source = pair?.source ?? 'ja';
  const target = pair?.target ?? 'en';
  // Forces a recompute when a model finishes downloading elsewhere (as
  // `LocalInferenceSettingsView` does for its prompt rule).
  const modelStatuses = useModelStatuses();
  const asrModelId = useMemo(
    () => useModelStore.getState().resolve(source, target, settings.selections).asr?.modelId,
    [source, target, settings.selections, modelStatuses],
  );
  const entry = getManifestEntry(asrModelId ?? '');
  // Config decides Smart per leg, so either direction's ASR can run it.
  const reverseAsrModelId = useMemo(
    () => useModelStore.getState().resolve(target, source, settings.selections).asr?.modelId,
    [source, target, settings.selections, modelStatuses],
  );
  const phase = useSmartTurnPhase();
  const smartTurnOffered = supportsSmartTurn(entry) || supportsSmartTurn(getManifestEntry(reverseAsrModelId ?? ''));
  useEffect(() => {
    if (smartTurnOffered && phase === 'unknown') void useSmartTurnStore.getState().refresh();
  }, [smartTurnOffered, phase]);
  return {
    showVad: !(entry?.type === 'asr-stream' && !entry?.asrWorkerType),
    vadIsWebWorker: !!entry?.asrWorkerType && entry.asrWorkerType !== 'sherpa-onnx',
    smartTurnOffered,
    smart: smartTurnOffered && settings.vadEndOfTurn === 'smart' && (phase === 'ready' || phase === 'unknown'),
  };
}

/**
 * One line: `VadControl`'s own heading and min-silence label, with the value
 * formatted the way `VadControl` shows it — existing keys only. Text only:
 * `LocalInferenceTurnDetectionHelp` carries the heading's tooltip, so the
 * Speech section can place it as a sibling of its link button instead of
 * nesting it inside — a click on the trigger must not also navigate.
 */
export function LocalInferenceTurnDetectionSummary({ settings, pair }: SettingsProps<S>) {
  const { t } = useTranslation();
  const { showVad, smart } = useVadKnobs(settings, pair);
  if (!showVad) return null;
  const heading = t('settings.vadSettings', 'VAD Settings');
  const seconds = `${settings.vadMinSilenceDuration.toFixed(2)}s`;
  if (smart && effectiveCheckAfter(settings.smartTurnCheckAfter, settings.vadMinSilenceDuration) !== null) {
    return <>{`${heading} · ${t('settings.smartTurn', 'Smart')} · ${t('settings.smartTurnMaxWait', 'Max Wait')} ${seconds}`}</>;
  }
  return <>{`${heading} · ${t('settings.vadMinSilenceDuration', 'Min Silence Duration')}: ${seconds}`}</>;
}

/**
 * `VadControl`'s heading tooltip, for the Speech section's row — same
 * content, same `Tooltip`. Follows `Summary`'s own nothing-to-tune rule so
 * the row never shows a help icon over an empty summary.
 */
export function LocalInferenceTurnDetectionHelp({ settings, pair }: SettingsProps<S>) {
  const { t } = useTranslation();
  const { showVad } = useVadKnobs(settings, pair);
  if (!showVad) return null;
  return (
    <Tooltip content={t('settings.vadSettingsTooltip', 'Voice Activity Detection parameters. Controls how speech segments are detected and split. Changes take effect on next session start.')} position="top">
      {helpIcon}
    </Tooltip>
  );
}

/**
 * The VAD knobs, heading included: the Provider tab draws them as their own
 * block, where the Speech section's summary links. Normal / Smart sits on top
 * for an ASR that runs Smart Turn's gate.
 */
export function LocalInferenceTurnDetectionControls({ settings, update, disabled = false, pair }: SettingsProps<S>) {
  const { showVad, vadIsWebWorker, smartTurnOffered, smart } = useVadKnobs(settings, pair);
  const phase = useSmartTurnPhase();
  const downloadedBytes = useSmartTurnStore((s) => s.downloadedBytes);
  const error = useSmartTurnStore((s) => s.error);
  if (!showVad) return null;

  // The setting turns Smart only once the model is on disk.
  const enableSmart = async () => {
    await useSmartTurnStore.getState().download();
    if (useSmartTurnStore.getState().phase === 'ready') update({ vadEndOfTurn: 'smart' });
  };
  const choose = (next: VadEndOfTurn) => {
    if (next === 'smart') {
      if (!smart) void enableSmart();
    } else {
      if (phase === 'error') useSmartTurnStore.getState().dismiss();
      if (settings.vadEndOfTurn !== 'normal') update({ vadEndOfTurn: 'normal' });
    }
  };

  return (
    <VadControl
      values={{
        vadThreshold: settings.vadThreshold,
        vadMinSilenceDuration: settings.vadMinSilenceDuration,
        vadMinSpeechDuration: settings.vadMinSpeechDuration,
        // vad-web workers only — the sherpa-onnx engine has its own
        // hysteresis and cuts at a fixed length.
        ...(vadIsWebWorker
          ? {
              vadMaxSpeechDuration: settings.vadMaxSpeechDuration,
              vadNegativeThreshold: settings.vadNegativeThreshold,
              vadPreSpeechPadDuration: settings.vadPreSpeechPadDuration,
            }
          : {}),
        ...(smart
          ? { smartTurnCheckAfter: settings.smartTurnCheckAfter, smartTurnThreshold: settings.smartTurnThreshold }
          : {}),
      }}
      onChange={(patch) => update(patch)}
      disabled={disabled}
      endOfTurn={smartTurnOffered ? (
        <EndOfTurnControl
          value={smart ? 'smart' : 'normal'}
          onChange={choose}
          disabled={disabled}
          download={phase === 'downloading' ? { done: downloadedBytes, total: SMART_TURN_TOTAL_BYTES } : undefined}
          error={phase === 'error' ? error : null}
          onRetry={() => { void enableSmart(); }}
        />
      ) : undefined}
    />
  );
}
