import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useModelStore, useModelStatuses } from '../../stores/modelStore';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { VadControl } from '../../components/Settings/sections/LocalSettingsControls';
import type { LanguagePair, SettingsProps } from '../../lib/provider/types';
import type { LocalInferenceSettings as S } from './settings';

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
 * formatted the way `VadControl` shows it — existing keys only.
 */
export function LocalInferenceTurnDetectionSummary({ settings, pair }: SettingsProps<S>) {
  const { t } = useTranslation();
  const { showVad } = useVadKnobs(settings, pair);
  if (!showVad) return null;
  return <>{`${t('settings.vadSettings', 'VAD Settings')} · ${t('settings.vadMinSilenceDuration', 'Min Silence Duration')}: ${settings.vadMinSilenceDuration.toFixed(2)}s`}</>;
}

/** The VAD knobs, moved here unchanged from LocalInference's own `Settings`. */
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
    />
  );
}
