/**
 * What a run reads, loaded before the first start (roadmap 1e-1): the turn
 * mode, the routing switches, the punctuation pack's phase, and the selected
 * provider's entry — or the first offered, which a run would start. The
 * stored selection is applied in memory, and the turn mode migrated once —
 * its one write, a key the old path never reads (plan 1e-3b-1 ruling 9).
 */
import { useWordList } from '../lib/words/list';
import { describeCause, reportWarning } from '../lib/diagnostics/report';
import { optionFor } from '../lib/lineup/catalog';
import { RUN_STAGES } from '../lib/lineup/types';
import type { AnyProvider } from '../lib/provider/types';
import { legacyTurnModeKey, migrateTurnMode, selectionFromStored } from '../lib/session/storedSettings';
import { presentProviders } from '../providers/registry';
import type { ISettingsService } from '../services/interfaces/ISettingsService';
import { ServiceFactory } from '../services/ServiceFactory';
import { useProviderStore } from '../stores/providerStore';
import { useLineUpStore } from '../stores/lineUpStore';
import { useRoutingStore } from '../stores/routingStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useTurnModeStore } from '../stores/turnModeStore';

/** The stored provider, selected in memory — a load never writes, and a value this build does not offer stays stored for Stage 2 (1e-3 ruling 2). A selection the page already made wins. Its entry loads with it. */
export async function loadSelectedProvider(service: Pick<ISettingsService, 'getSetting'>, offered: readonly AnyProvider[]): Promise<void> {
  const { selected } = useProviderStore.getState();
  const id = selected !== null && offered.some((p) => p.id === selected)
    ? selected
    : selectionFromStored(
      await service.getSetting('settings.common.provider', ''),
      offered.map((p) => p.id),
      offered.find((p) => p.kind === 'managed')?.id ?? null,
    )?.id;
  const provider = offered.find((p) => p.id === id);
  if (!provider) return;
  if (useProviderStore.getState().selected !== provider.id) useProviderStore.getState().select(provider.id, 'load');
  await useProviderStore.getState().load(provider);
}

/**
 * The loads `loadLineUpProviders` has started and not seen settle, by provider id. An entry appears only when its
 * load ends, so a call made meanwhile still sees it missing: it waits for the load under way instead of starting
 * another, whose values would replace settings written since the first one landed.
 */
const lineUpLoads = new Map<string, Promise<void>>();

function loadOnce(p: AnyProvider): Promise<void> {
  const under = lineUpLoads.get(p.id);
  if (under) return under;
  const started = useProviderStore.getState().load(p).finally(() => {
    if (lineUpLoads.get(p.id) === started) lineUpLoads.delete(p.id);
  });
  lineUpLoads.set(p.id, started);
  return started;
}

/**
 * The entry of every provider the line-up names is loaded: a provider that serves a stage of the plan without being
 * the selected one (the local provider reading another provider's text) has its settings at hand for the plan, the
 * start and the settings that show them. A provider already loaded, or not offered here, is left alone; one being
 * loaded by an earlier call is waited for, not loaded again.
 */
export async function loadLineUpProviders(offered: readonly AnyProvider[]): Promise<void> {
  const { lineUp } = useLineUpStore.getState();
  if (!lineUp) return;
  const hosts = new Set(RUN_STAGES.map((stage) => optionFor(lineUp, stage)?.host));
  const { entries } = useProviderStore.getState();
  await Promise.all(offered.filter((p) => hosts.has(p.id) && !entries[p.id]).map(loadOnce));
}

/** Stops the watch of the line-up a previous `loadSessionStores` started. */
let stopWatchingLineUp: (() => void) | null = null;

/** Keeps `loadLineUpProviders` true as the line-up changes: a choice may name a provider that was never opened. */
function watchLineUpProviders(offered: readonly AnyProvider[]): void {
  stopWatchingLineUp?.();
  stopWatchingLineUp = useLineUpStore.subscribe((now, before) => {
    if (now.lineUp === before.lineUp) return;
    loadLineUpProviders(offered).catch((error: unknown) =>
      reportWarning('AppSession', `Loading the line-up's providers failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'load:line-up-providers' }));
  });
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
  try {
    await useWordList.getState().load();
  } catch (error) {
    reportWarning('AppSession', `Loading the word list failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'load:words' });
  }
  // The line-up after the selected provider: when none is stored it is worked out from that provider (the one migration).
  try {
    await useLineUpStore.getState().load();
  } catch (error) {
    reportWarning('AppSession', `Loading the line-up failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'load:line-up' });
  }
  // Every provider the line-up names, now and after each later choice.
  try {
    await loadLineUpProviders(offered);
  } catch (error) {
    reportWarning('AppSession', `Loading the line-up's providers failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'load:line-up-providers' });
  }
  watchLineUpProviders(offered);
}
