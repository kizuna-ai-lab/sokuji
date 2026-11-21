import type { LegName } from '../../lib/conversation/types';
import { directionKey } from '../../lib/local-inference/selection/types';
import { planFromStores } from '../../lib/plan/fromStores';
import { transcriptionAccount, transcriptionProvider, unitFor } from '../../lib/plan/read';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Opens the TTS slot of the direction `leg` speaks under the pair as it is
 * now (#619): the slot target, then the settings page at the line-up's
 * provider options, whose engine opens that slot. The engine is the one of
 * the provider whose unit speaks; the pair is the run's. A provider with no
 * `Engine` gets its options only, and any
 * slot target still pending is cleared: nothing there would consume it, and it
 * would open later under another provider. With Edge speaking, its voices
 * in the speech card instead: the engine's speech slot does not run. With a
 * local voice reading another provider's text, the local voices in the
 * speech card: the options shown are the transcription provider's, and no
 * engine there would open the slot.
 */
export function openTtsSlot(leg: LegName): void {
  const { setEngineSlotTarget, navigateToSettings } = useSettingsStore.getState();
  if (useLineUpStore.getState().lineUp?.speech === 'edge') {
    setEngineSlotTarget(null);
    navigateToSettings('edge-voices');
    return;
  }
  const found = planFromStores();
  const speaker = found.state === 'ready' ? unitFor(found.plan, 'speech').provider : undefined;
  if (found.state === 'ready' && speaker && speaker.id !== transcriptionProvider(found.plan).id) {
    setEngineSlotTarget(null);
    navigateToSettings(speaker.id === localInferenceProvider.id ? 'local-voices' : 'provider-options');
    return;
  }
  if (found.state === 'ready' && speaker?.Engine) {
    const { source, target } = transcriptionAccount(found).pair;
    setEngineSlotTarget({ dir: leg === 'speaker' ? directionKey(source, target) : directionKey(target, source), stage: 'tts' });
  } else {
    setEngineSlotTarget(null);
  }
  navigateToSettings('provider-options');
}

/**
 * Opens the local engine's voices, in the line-up's speech card (B-20: out of the old model library): Edge's when
 * Edge speaks, this device's own otherwise. Any slot target still pending is cleared: nothing there would consume it.
 */
export function openLocalVoices(): void {
  const { setEngineSlotTarget, navigateToSettings } = useSettingsStore.getState();
  setEngineSlotTarget(null);
  navigateToSettings(useLineUpStore.getState().lineUp?.speech === 'edge' ? 'edge-voices' : 'local-voices');
}
