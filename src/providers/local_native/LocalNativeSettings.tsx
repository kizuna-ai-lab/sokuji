import { useMemo } from 'react';
import { TranslationPromptControl, TtsSpeedControl } from '../../components/Settings/sections/LocalSettingsControls';
import { hasNativeTts, supportsCustomPrompt } from '../../lib/local-inference/native/nativeCatalog';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import type { SettingsProps } from '../../lib/provider/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import type { LocalNativeSettings as S } from './settings';

/**
 * Local Native's `Settings`: TTS speed, shown only where the target language
 * has a native voice, and the translation prompt, offered unless every
 * resolved translation model owns its own prompt (#526). Its models are its
 * `Engine`; its VAD knobs are its `TurnDetection`.
 */
export function LocalNativeSettingsView({ settings, update, disabled = false, pair }: SettingsProps<S>) {
  const source = pair?.source ?? 'ja';
  const target = pair?.target ?? 'en';
  const catalog = useNativeModelStore((s) => s.catalog);
  const statuses = useNativeModelStore((s) => s.statuses);
  const speaker = useMemo(() => useNativeModelStore.getState().resolve(source, target, settings.selections), [source, target, settings.selections, catalog, statuses]);
  const participant = useMemo(() => useNativeModelStore.getState().resolve(target, source, settings.selections), [source, target, settings.selections, catalog, statuses]);
  const promptSupported = supportsCustomPrompt(speaker.translation?.modelId ?? '') || supportsCustomPrompt(participant.translation?.modelId ?? '');
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
