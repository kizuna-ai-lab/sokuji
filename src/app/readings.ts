import { readingTargets } from '../lib/reading/languages';
import { setJapaneseWanted } from '../lib/reading/ja/runtime';
import { currentReadingTarget } from '../lib/reading/useReadingTargets';
import { useConversationDisplayStore } from '../stores/conversationDisplayStore';
import { useProviderStore } from '../stores/providerStore';
import { useSubtitleStore } from '../stores/subtitleStore';

/**
 * Keeps the Japanese runtime (dictionary and worker) running exactly while a
 * surface's readings switch is on and the target includes Japanese (spec §3).
 * Started once by Home; the extension overlay never starts it.
 */
export function bindReadings(): () => void {
  const sync = () => {
    const on = useConversationDisplayStore.getState().showReadings || useSubtitleStore.getState().showReadings;
    setJapaneseWanted(on && readingTargets(currentReadingTarget()).has('ja'));
  };
  sync();
  const unsubscribes = [
    useConversationDisplayStore.subscribe(sync),
    useSubtitleStore.subscribe(sync),
    useProviderStore.subscribe(sync),
  ];
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    setJapaneseWanted(false);
  };
}
