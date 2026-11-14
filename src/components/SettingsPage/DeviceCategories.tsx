// src/components/SettingsPage/DeviceCategories.tsx
//
// "Models and storage" and "Audio": today's sections, as they are (providers
// and stages design, rulings 14 and 16).
import { useEffect, useMemo } from 'react';
import { presentProviders } from '../../providers/registry';
import { useMode } from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from '../../providers/localInference/settings';
import StoragePage from '../Settings/engine/StoragePage';
import AudioDeviceSection from '../Settings/sections/AudioDeviceSection';
import SpeechOutputSection from '../Settings/sections/SpeechOutputSection';
import SystemAudioSection from '../Settings/sections/SystemAudioSection';
import type { CategoryBodyProps } from './SettingsPage';

/** Every downloaded model in one place: the local provider's storage page, the readings dictionary with it. */
export function ModelsCategory({ locked }: CategoryBodyProps) {
  const local = useMemo(() => presentProviders().find((p) => p.id === 'local_inference'), []);
  const entry = useProviderStore((s) => s.entries.local_inference);
  useEffect(() => {
    if (local && !entry) void useProviderStore.getState().load(local);
  }, [local, entry]);
  const settings = (entry?.settings as LocalInferenceSettings | undefined) ?? LOCAL_INFERENCE_DEFAULTS;
  const pair = entry?.pair ?? { source: 'en', target: 'ja' };
  return <StoragePage provider="wasm" isSessionActive={locked} settings={settings} pair={pair} />;
}

/** Microphone, speech, the other side's audio — today's hierarchy and locks. */
export function AudioCategory({ locked }: CategoryBodyProps) {
  const mode = useMode();
  const lockMic = locked && mode === 'participant';
  const lockParticipant = mode === 'speaker';
  return (
    <>
      <AudioDeviceSection isSessionActive={locked} isLocked={lockMic} />
      <SpeechOutputSection isSessionActive={locked} />
      <SystemAudioSection isSessionActive={locked} isLocked={lockParticipant} />
    </>
  );
}
