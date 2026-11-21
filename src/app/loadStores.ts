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
import { PUSH_KEY, useTurnModeStore } from '../stores/turnModeStore';
import { storedPushKey } from '../lib/turn/pushKey';

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
  const named = lineUp ? RUN_STAGES.map((stage) => optionFor(lineUp, stage)?.host) : [];
  const hosts = new Set<string>([...named, unstoredProvider].filter((id): id is string => typeof id === 'string'));
  const { entries } = useProviderStore.getState();
  await Promise.all(offered.filter((p) => hosts.has(p.id) && !entries[p.id]).map(loadOnce));
}

/** Stops the watch of the line-up a previous `loadSessionStores` started. */
let stopWatchingLineUp: (() => void) | null = null;

/**
 * Keeps `loadLineUpProviders` true as the line-up changes: a choice may name a provider that was never opened.
 * Installed before a launch's first load of them, so no change falls between the two.
 */
function watchLineUpProviders(offered: readonly AnyProvider[]): void {
  stopWatchingLineUp?.();
  stopWatchingLineUp = useLineUpStore.subscribe((now, before) => {
    if (now.lineUp === before.lineUp && now.unstoredProvider === before.unstoredProvider) return;
    void loadLineUpProvidersReported(offered);
  });
}

/** `loadLineUpProviders`, a failure reported under its own name; never rejects. */
async function loadLineUpProvidersReported(offered: readonly AnyProvider[]): Promise<void> {
  try {
    await loadLineUpProviders(offered);
  } catch (error) {
    reportWarning('AppSession', `Loading the line-up's providers failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'load:line-up-providers' });
  }
}

/**
 * The global turn mode, migrated once from the stored provider's slice (1e-3 ruling 3); written only by that migration.
 * The push key comes with it.
 */
export async function loadTurnMode(service: Pick<ISettingsService, 'getSetting'>): Promise<void> {
  const [common, storedProvider, pushKey] = await Promise.all([
    service.getSetting('settings.common.turnMode', ''),
    service.getSetting('settings.common.provider', ''),
    service.getSetting<unknown>(PUSH_KEY, ''),
  ]);
  // The key that holds a turn: read, never written here; one a hold cannot take reads as Space.
  useTurnModeStore.setState({ pushKey: storedPushKey(pushKey) });
  const key = legacyTurnModeKey(storedProvider);
  const legacy = key ? await service.getSetting(key, '') : undefined;
  const { turnMode, write } = migrateTurnMode(common, legacy);
  if (write) useTurnModeStore.getState().setTurnMode(turnMode);
  else useTurnModeStore.setState({ turnMode });
}

export async function loadSessionStores(): Promise<void> {
  const service = ServiceFactory.getSettingsService();
  const offered = presentProviders();
  // Heard from before the first load on: a line-up that changes while the loads below are awaited (the line-up
  // store's own load landing, a choice on the settings page) still gets every provider it names loaded. A load
  // under way is shared with the launch's own below, so no provider is loaded twice.
  watchLineUpProviders(offered);
  const loads: Array<[string, () => Promise<void>]> = [
    ['turn mode', () => loadTurnMode(service)],
    ['routing switches', () => useRoutingStore.getState().load()],
    ['punctuation pack', () => useSegmentationStore.getState().refresh()],
    // The line-up says what runs; when none is stored it is worked out from the stored provider (the one
    // migration). Then the entry of every provider it names, without which there is no plan to start: also after
    // a load that failed, which may have named them already (in this launch or an earlier one) and then changes
    // nothing for the watch to hear. The load's own failure is still reported below, once.
    ['line-up', async () => {
      try {
        await useLineUpStore.getState().load();
      } finally {
        await loadLineUpProvidersReported(offered);
      }
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
}
