/**
 * What a run reads, loaded before the first start (roadmap 1e-1): the turn
 * mode, the routing switches, the punctuation pack's phase, and the selected
 * provider's entry — or the first offered, which a run would start. The
 * stored selection is applied in memory, and the turn mode migrated once —
 * its one write, a key the old path never reads (plan 1e-3b-1 ruling 9).
 */
import { describeCause, reportWarning } from '../lib/diagnostics/report';
import type { AnyProvider } from '../lib/provider/types';
import { legacyTurnModeKey, migrateTurnMode, selectionFromStored } from '../lib/session/storedSettings';
import { presentProviders } from '../providers/registry';
import type { ISettingsService } from '../services/interfaces/ISettingsService';
import { ServiceFactory } from '../services/ServiceFactory';
import { useProviderStore } from '../stores/providerStore';
import { useRoutingStore } from '../stores/routingStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useTurnModeStore } from '../stores/turnModeStore';

/** The stored provider, selected in memory — a load never writes, and a value this build does not offer stays stored for Stage 2 (1e-3 ruling 2). A selection the page already made wins. Its entry loads with it. */
export async function loadSelectedProvider(service: Pick<ISettingsService, 'getSetting'>, offered: readonly AnyProvider[]): Promise<void> {
  const { selected } = useProviderStore.getState();
  const id = selected !== null && offered.some((p) => p.id === selected)
    ? selected
    : selectionFromStored(await service.getSetting('settings.common.provider', ''), offered.map((p) => p.id))?.id;
  const provider = offered.find((p) => p.id === id);
  if (!provider) return;
  if (useProviderStore.getState().selected !== provider.id) useProviderStore.getState().select(provider.id, 'load');
  await useProviderStore.getState().load(provider);
}

/** The global turn mode, migrated once from the stored provider's slice (1e-3 ruling 3); written only by that migration. */
export async function loadTurnMode(service: Pick<ISettingsService, 'getSetting'>): Promise<void> {
  const [common, storedProvider] = await Promise.all([
    service.getSetting('settings.common.turnMode', ''),
    service.getSetting('settings.common.provider', ''),
  ]);
  const key = legacyTurnModeKey(storedProvider);
  const legacy = key ? await service.getSetting(key, '') : undefined;
  const { turnMode, write } = migrateTurnMode(common, legacy);
  if (write) useTurnModeStore.getState().setTurnMode(turnMode);
  else useTurnModeStore.setState({ turnMode });
}

export async function loadSessionStores(): Promise<void> {
  const service = ServiceFactory.getSettingsService();
  const offered = presentProviders();
  const loads: Array<[string, () => Promise<void>]> = [
    ['turn mode', () => loadTurnMode(service)],
    ['routing switches', () => useRoutingStore.getState().load()],
    ['punctuation pack', () => useSegmentationStore.getState().refresh()],
    ['selected provider', () => loadSelectedProvider(service, offered)],
  ];
  await Promise.all(loads.map(async ([what, load]) => {
    try {
      await load();
    } catch (error) {
      reportWarning('AppSession', `Loading the ${what} failed: ${describeCause(error)}`, { cause: error, dedupeKey: `load:${what}` });
    }
  }));
}
