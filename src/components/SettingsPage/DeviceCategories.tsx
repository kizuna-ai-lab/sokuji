// src/components/SettingsPage/DeviceCategories.tsx
//
// "Models and storage" and "Audio": today's sections, as they are (providers
// and stages design, rulings 14 and 16).
import { useEffect, useMemo } from 'react';
import { presentProviders } from '../../providers/registry';
import { useMode } from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useModelStore } from '../../stores/modelStore';
import { describeCause, reportWarning } from '../../lib/diagnostics/report';
import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from '../../providers/localInference/settings';
import { ModelsPage } from './ModelsPage';
import AudioDeviceSection from '../Settings/sections/AudioDeviceSection';
import SpeechOutputSection from '../Settings/sections/SpeechOutputSection';
import SystemAudioSection from '../Settings/sections/SystemAudioSection';
import type { CategoryBodyProps } from './SettingsPage';
import { AudioModeSwitch } from './AudioModeSwitch';

/** Every downloaded model in one place: the local provider's storage page, the readings dictionary with it. */
export function ModelsCategory({ locked }: CategoryBodyProps) {
  const local = useMemo(() => presentProviders().find((p) => p.id === 'local_inference'), []);
  const entry = useProviderStore((s) => s.entries.local_inference);
  useEffect(() => {
    if (local && !entry) void useProviderStore.getState().load(local);
  }, [local, entry]);
  // What is on disk is known only after a scan, which otherwise runs only while the local provider is selected.
  useEffect(() => {
    if (useModelStore.getState().initialized) return;
    useModelStore.getState().initialize().catch((error: unknown) =>
      reportWarning('ModelsCategory', `Scanning the downloaded models failed: ${describeCause(error)}`, { cause: error }));
  }, []);
  const settings = (entry?.settings as LocalInferenceSettings | undefined) ?? LOCAL_INFERENCE_DEFAULTS;
  const pair = entry?.pair ?? { source: 'en', target: 'ja' };
  return <ModelsPage locked={locked} settings={settings} pair={pair} />;
}

/** The mode, then microphone, speech, the other side's audio — today's hierarchy and locks. The mode switch is here so
 *  the drawing and the devices of each mode can be seen without the session's picker (owner, 2026-11-15). */
export function AudioCategory({ locked }: CategoryBodyProps) {
  const mode = useMode();
  const lockMic = locked && mode === 'participant';
  const lockParticipant = mode === 'speaker';
  return (
    <>
      <AudioModeSwitch locked={locked} />
      <AudioDeviceSection isSessionActive={locked} isLocked={lockMic} />
      <SpeechOutputSection isSessionActive={locked} />
      <SystemAudioSection isSessionActive={locked} isLocked={lockParticipant} />
    </>
  );
}
