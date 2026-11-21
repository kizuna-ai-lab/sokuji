/**
 * What a run reads, loaded before the first start (roadmap 1e-1): the turn
 * mode, the routing switches, the punctuation pack's phase, the line-up, and
 * the entry of every provider it names (or, until one is stored, of the
 * provider that runs meanwhile). The turn mode is migrated once, its one
 * write, a key the old path never reads (plan 1e-3b-1 ruling 9); the line-up
 * is worked out once when none is stored. A launch that changes nothing
 * writes nothing.
 */
import { useWordList } from '../lib/words/list';
import { describeCause, reportWarning } from '../lib/diagnostics/report';
import { optionFor } from '../lib/lineup/catalog';
import { RUN_STAGES } from '../lib/lineup/types';
import type { AnyProvider } from '../lib/provider/types';
import { legacyTurnModeKey, migrateTurnMode } from '../lib/session/storedSettings';
import { presentProviders } from '../providers/registry';
import type { ISettingsService } from '../services/interfaces/ISettingsService';
import { ServiceFactory } from '../services/ServiceFactory';
import { useProviderStore } from '../stores/providerStore';
import { useLineUpStore } from '../stores/lineUpStore';
import { useRoutingStore } from '../stores/routingStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useTurnModeStore } from '../stores/turnModeStore';

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
 * The entry of every provider the line-up names is loaded, and that of the provider that runs while no line-up is
 * stored: each provider of the plan has its settings at hand for the plan, the start and the settings that show
 * them. A provider already loaded, or not offered here, is left alone; one being
 * loaded by an earlier call is waited for, not loaded again.
 */
export async function loadLineUpProviders(offered: readonly AnyProvider[]): Promise<void> {
  const { lineUp, unstoredProvider } = useLineUpStore.getState();
  // The provider that runs while no line-up is stored is not always one the line-up shown names.
  const hosts = new Set<string | undefined>([...(lineUp ? RUN_STAGES.map((stage) => optionFor(lineUp, stage)?.host) : []), unstoredProvider ?? undefined]);
  const { entries } = useProviderStore.getState();
  await Promise.all(offered.filter((p) => hosts.has(p.id) && !entries[p.id]).map(loadOnce));
}

/** Stops the watch of the line-up a previous `loadSessionStores` started. */
let stopWatchingLineUp: (() => void) | null = null;

/** Keeps `loadLineUpProviders` true as the line-up changes: a choice may name a provider that was never opened. */
function watchLineUpProviders(offered: readonly AnyProvider[]): void {
  stopWatchingLineUp?.();
  stopWatchingLineUp = useLineUpStore.subscribe((now, before) => {
    if (now.lineUp === before.lineUp && now.unstoredProvider === before.unstoredProvider) return;
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
    // The line-up says what runs; when none is stored it is worked out from the stored provider (the one
    // migration). Then the entry of every provider it names, without which there is no plan to start.
    ['line-up', async () => {
      await useLineUpStore.getState().load();
      await loadLineUpProviders(offered);
    }],
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
  // Every provider the line-up names after each later choice.
  watchLineUpProviders(offered);
}
