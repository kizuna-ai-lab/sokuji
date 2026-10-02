import { useMemo } from 'react';
import { TranslationPromptControl, TtsSpeedControl } from '../../components/Settings/sections/LocalSettingsControls';
import { hasNativeTts, supportsCustomPrompt } from '../../lib/local-inference/native/nativeCatalog';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import type { SettingsProps } from '../../lib/provider/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { modeOfLegs } from './engineLegs';
import type { LocalNativeSettings as S } from './settings';

/**
 * Local Native's `Settings`: TTS speed, shown only where the target language
 * has a native voice, and the translation prompt, offered unless the
 * translation model of the direction that runs owns its own prompt (#526). Its models are its
 * `Engine`; its VAD knobs are its `TurnDetection`.
 */
export function LocalNativeSettingsView({ settings, update, disabled = false, pair, legs = [] }: SettingsProps<S>) {
  const source = pair?.source ?? 'ja';
  const target = pair?.target ?? 'en';
  const mode = modeOfLegs(legs);
  const catalog = useNativeModelStore((s) => s.catalog);
  const statuses = useNativeModelStore((s) => s.statuses);
  // Local Native runs one side at a time (#578 ruling 4): the prompt matters to the direction that runs.
  const running = useMemo(
    () => (mode === 'participant'
      ? useNativeModelStore.getState().resolve(target, source, settings.selections)
      : useNativeModelStore.getState().resolve(source, target, settings.selections)),
    [mode, source, target, settings.selections, catalog, statuses],
  );
  const promptSupported = supportsCustomPrompt(running.translation?.modelId ?? '');
  return (
    <>
      {hasNativeTts(target, catalog) && (
        <TtsSpeedControl value={settings.ttsSpeed} onChange={(ttsSpeed) => update({ ttsSpeed })} disabled={disabled} />
      )}
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
