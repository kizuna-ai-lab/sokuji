import { useMemo } from 'react';
import { useModelStore, useModelStatuses } from '../../stores/modelStore';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import { TtsSpeedControl, TranslationPromptControl } from '../../components/Settings/sections/LocalSettingsControls';
import type { SettingsProps } from '../../lib/provider/types';
import type { LocalInferenceSettings as S } from './settings';

/** 'qwen'/'qwen35' translation workers accept a custom prompt; opus-mt and everything else don't. */
function isQwenFamily(workerType: string): boolean {
  return workerType === 'qwen' || workerType === 'qwen35';
}

/**
 * Mirrors today's `resolveTranslationWorkerTypeForModelId` (`settingsStore.ts`)
 * without importing the store — `src/providers/**` imports no store but its
 * own (`modelStore`, `turnModeStore`).
 */
function translationWorkerType(modelId: string | null | undefined): string {
  if (!modelId) return 'opus-mt';
  const entry = getManifestEntry(modelId);
  if (!entry) return 'opus-mt';
  return entry.translationWorkerType || (entry.multilingual ? 'qwen' : 'opus-mt');
}

/**
 * LocalInference's `Settings` (ruling 9): TTS speed and the translation
 * prompt, both from `LocalSettingsControls.tsx`. Its own model management
 * lives in `Engine`; the turn-mode control is no longer a provider setting
 * (the global turn mode; plan 1e-3 places it), and the VAD knobs are its
 * `TurnDetection`, drawn in the Speech section while that mode is Auto
 * (`LocalInferenceTurnDetection.tsx`).
 *
 * Exported as `LocalInferenceSettingsView` (mirrors `FakeSettingsView`):
 * `LocalInferenceSettings` already names the settings type this component
 * edits (`./settings`), and TypeScript refuses a type and a value import
 * under the same local name in one file.
 */
export function LocalInferenceSettingsView({ settings, update, disabled = false, pair }: SettingsProps<S>) {
  // `localInferenceLanguages.initial()` gives the same fallback; ProviderPanel
  // always supplies `pair` in the app, so this only matters standalone (tests).
  const source = pair?.source ?? 'ja';
  const target = pair?.target ?? 'en';

  // Forces a recompute when a model finishes downloading elsewhere (mirrors
  // today's `ProviderSpecificSettings.tsx` speakerResolved memo).
  const modelStatuses = useModelStatuses();

  const speakerResolved = useMemo(
    () => useModelStore.getState().resolve(source, target, settings.selections),
    [source, target, settings.selections, modelStatuses],
  );
  // The participant direction is a peer of the speaker's, not its reversal:
  // its own worker type decides whether a custom prompt is supported too
  // (today's rule — `ProviderSpecificSettings.tsx`'s `localPromptSupported`).
  const participantResolved = useMemo(
    () => useModelStore.getState().resolve(target, source, settings.selections),
    [source, target, settings.selections, modelStatuses],
  );

  const promptSupported = isQwenFamily(translationWorkerType(speakerResolved.translation?.modelId))
    || isQwenFamily(translationWorkerType(participantResolved.translation?.modelId));

  return (
    <>
      <TtsSpeedControl
        value={settings.ttsSpeed}
        onChange={(ttsSpeed) => update({ ttsSpeed })}
        disabled={disabled}
      />

      <TranslationPromptControl
        useTemplateMode={settings.useTemplateMode}
        systemPrompt={settings.systemPrompt}
        participantSystemPrompt={settings.participantSystemPrompt}
        preview={buildDefaultLocalPrompt(source, target)}
        supported={promptSupported}
        disabled={disabled}
        onChange={(patch) => update(patch)}
      />
    </>
  );
}
