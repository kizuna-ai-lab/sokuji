/**
 * What a run reads, loaded before the first start (roadmap 1e-1): the turn
 * mode, the routing switches, the punctuation pack's phase, and the selected
 * provider's entry — or the first offered, which a run would start. Reads
 * only: nothing is written and nothing is selected; the stored selection and
 * the turn-mode migration are plan 1e-3b's.
 */
import { describeCause, reportWarning } from '../lib/diagnostics/report';
import { presentProviders } from '../providers/registry';
import { useProviderStore } from '../stores/providerStore';
import { useRoutingStore } from '../stores/routingStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useTurnModeStore } from '../stores/turnModeStore';

export async function loadSessionStores(): Promise<void> {
  const { selected } = useProviderStore.getState();
  const offered = presentProviders();
  const provider = offered.find((p) => p.id === selected) ?? offered[0];
  const loads: Array<[string, () => Promise<void>]> = [
    ['turn mode', () => useTurnModeStore.getState().load()],
    ['routing switches', () => useRoutingStore.getState().load()],
    ['punctuation pack', () => useSegmentationStore.getState().refresh()],
  ];
  if (provider) loads.push([`${provider.id} settings`, () => useProviderStore.getState().load(provider)]);
  await Promise.all(loads.map(async ([what, load]) => {
    try {
      await load();
    } catch (error) {
      reportWarning('AppSession', `Loading the ${what} failed: ${describeCause(error)}`, { cause: error, dedupeKey: `load:${what}` });
    }
  }));
}
