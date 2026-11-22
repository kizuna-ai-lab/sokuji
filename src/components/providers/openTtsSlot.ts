import type { LegName } from '../../lib/conversation/types';
import { directionKey } from '../../lib/local-inference/selection/types';
import { planFromStores } from '../../lib/plan/fromStores';
import { transcriptionAccount, transcriptionProvider, unitFor } from '../../lib/plan/read';
import { edgeProvider } from '../../providers/edge/provider';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Whether Edge speaks: the plan's speech unit when the plan is ready; when it is not (another stage lacks a key),
 * the stored line-up's word for speech.
 */
function edgeSpeaks(found: ReturnType<typeof planFromStores>): boolean {
  if (found.state === 'ready') return unitFor(found.plan, 'speech').provider.id === edgeProvider.id;
  return useLineUpStore.getState().lineUp?.speech === edgeProvider.id;
}

/**
 * Opens the TTS slot of the direction `leg` speaks under the pair as it is
 * now (#619): the slot target, then the settings page at the line-up's
 * provider options, whose engine opens that slot. The engine is the one of
 * the provider whose unit speaks; the pair is the run's. A provider with no
 * `Engine` gets its options only, and any
 * slot target still pending is cleared: nothing there would consume it, and it
 * would open later under another provider. With Edge speaking (the plan's
 * speech unit is Edge's), its voices in the speech card instead: Edge has no
 * engine. With a local voice reading another provider's text, the local
 * voices in the speech card: the options shown are the transcription
 * provider's, and no engine there would open the slot.
 */
export function openTtsSlot(leg: LegName): void {
  const { setEngineSlotTarget, navigateToSettings } = useSettingsStore.getState();
  const found = planFromStores();
  const speaker = found.state === 'ready' ? unitFor(found.plan, 'speech').provider : undefined;
  if (edgeSpeaks(found)) {
    setEngineSlotTarget(null);
    navigateToSettings('edge-voices');
    return;
  }
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
 * Opens the voices in the line-up's speech card (B-20: out of the old model library): Edge's when the plan's speech
 * unit is Edge's, this device's own otherwise. Any slot target still pending is cleared: nothing there would consume it.
 */
export function openLocalVoices(): void {
  const { setEngineSlotTarget, navigateToSettings } = useSettingsStore.getState();
  setEngineSlotTarget(null);
  navigateToSettings(edgeSpeaks(planFromStores()) ? 'edge-voices' : 'local-voices');
}
