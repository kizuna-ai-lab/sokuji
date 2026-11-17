import type { LegName } from '../../lib/conversation/types';
import { directionKey } from '../../lib/local-inference/selection/types';
import { selectedFromStores } from '../../lib/session/appShape';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Opens the TTS slot of the direction `leg` speaks under the pair as it is
 * now (#619): the slot target, then the settings page at the line-up's
 * provider options, whose engine opens that slot. A provider with no `Engine`
 * gets its options only, and any
 * slot target still pending is cleared: nothing there would consume it, and it
 * would open later under another provider. With Edge speaking, its voices
 * in the speech card instead: the engine's speech slot does not run.
 */
export function openTtsSlot(leg: LegName): void {
  const { setEngineSlotTarget, navigateToSettings } = useSettingsStore.getState();
  if (useLineUpStore.getState().lineUp?.speech === 'edge') {
    setEngineSlotTarget(null);
    navigateToSettings('edge-voices');
    return;
  }
  const selection = selectedFromStores();
  if (selection?.provider.Engine) {
    const { source, target } = selection.entry.pair;
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
