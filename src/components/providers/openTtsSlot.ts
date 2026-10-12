import type { LegName } from '../../lib/conversation/types';
import { directionKey } from '../../lib/local-inference/selection/types';
import { selectedFromStores } from '../../lib/session/appShape';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Opens the TTS slot of the direction `leg` speaks under the pair as it is
 * now (#619), by the model chips' path: the slot target, then Settings on the
 * Provider tab. A provider with no `Engine` gets the Provider tab only: nothing
 * there would consume a slot target, and a stale one would open later under
 * another provider.
 */
export function openTtsSlot(leg: LegName): void {
  const { setEngineSlotTarget, navigateToSettings } = useSettingsStore.getState();
  const selection = selectedFromStores();
  if (selection?.provider.Engine) {
    const { source, target } = selection.entry.pair;
    setEngineSlotTarget({ dir: leg === 'speaker' ? directionKey(source, target) : directionKey(target, source), stage: 'tts' });
  }
  navigateToSettings('provider');
}
