import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import { useModelStore, useModelStatuses } from '../../stores/modelStore';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { VadControl } from '../../components/Settings/sections/LocalSettingsControls';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { LanguagePair, SettingsProps } from '../../lib/provider/types';
import type { LocalInferenceSettings as S } from './settings';

// Matches `LocalSettingsControls.tsx`'s own inline help icon — this is the
// same tooltip trigger, moved from VadControl's now-hidden heading onto
// `LocalInferenceTurnDetectionHelp` below.
const helpIcon = (
  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
);

/**
 * Which VAD knobs the speaker direction's resolved ASR takes — the one rule
 * both halves of LocalInference's `TurnDetection` follow (today's, from
 * `ProviderSpecificSettings.tsx`). `showVad` is false only for a streaming
 * ASR that reports no worker type: endpoint detection replaces VAD there.
 * `vadIsWebWorker` adds the two vad-web knobs; the sherpa-onnx engine has
 * its own hysteresis and cuts at a fixed length.
 */
function useVadKnobs(settings: S, pair: LanguagePair | undefined): { showVad: boolean; vadIsWebWorker: boolean } {
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
  return {
    showVad: !(entry?.type === 'asr-stream' && !entry?.asrWorkerType),
    vadIsWebWorker: !!entry?.asrWorkerType && entry.asrWorkerType !== 'sherpa-onnx',
  };
}

/**
 * One line: `VadControl`'s own heading and min-silence label, with the value
 * formatted the way `VadControl` shows it — existing keys only. Text only:
 * `LocalInferenceTurnDetectionHelp` carries the heading's old tooltip, so the
 * Speech section can place it as a sibling of the disclosure button instead
 * of nesting it inside — a click on the trigger must not also toggle the
 * disclosure.
 */
export function LocalInferenceTurnDetectionSummary({ settings, pair }: SettingsProps<S>) {
  const { t } = useTranslation();
  const { showVad } = useVadKnobs(settings, pair);
  if (!showVad) return null;
  return <>{`${t('settings.vadSettings', 'VAD Settings')} · ${t('settings.vadMinSilenceDuration', 'Min Silence Duration')}: ${settings.vadMinSilenceDuration.toFixed(2)}s`}</>;
}

/**
 * The heading's own help tooltip, moved here from `VadControl`'s now-hidden
 * heading — same content, same `Tooltip`. Follows `Summary`'s own
 * nothing-to-tune rule so the row never shows a help icon over an empty
 * summary.
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
 * The VAD knobs, moved here unchanged from LocalInference's own `Settings`
 * — except the heading, which the Speech section's disclosure row already
 * shows via `LocalInferenceTurnDetectionSummary` (`hideHeading`, so the two
 * don't repeat the same words right on top of each other).
 */
export function LocalInferenceTurnDetectionControls({ settings, update, disabled = false, pair }: SettingsProps<S>) {
  const { showVad, vadIsWebWorker } = useVadKnobs(settings, pair);
  if (!showVad) return null;
  return (
    <VadControl
      values={{
        vadThreshold: settings.vadThreshold,
        vadMinSilenceDuration: settings.vadMinSilenceDuration,
        vadMinSpeechDuration: settings.vadMinSpeechDuration,
        // vad-web workers only — the sherpa-onnx engine has its own
        // hysteresis and cuts at a fixed length.
        ...(vadIsWebWorker
          ? { vadMaxSpeechDuration: settings.vadMaxSpeechDuration, vadNegativeThreshold: settings.vadNegativeThreshold }
          : {}),
      }}
      onChange={(patch) => update(patch)}
      disabled={disabled}
      hideHeading
    />
  );
}
