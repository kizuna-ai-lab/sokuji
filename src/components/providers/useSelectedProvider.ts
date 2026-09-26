/**
 * The provider the panel shows, and one `update` per provider shared by every
 * piece that renders it — `ProviderPicker`, `ProviderLanguages`,
 * `ProviderOwnSettings` and `ProviderEngine` each call this hook on their own,
 * so a `Settings`/`Engine` held in another piece's effect deps still sees one
 * identity across the panel's re-renders (today's `ProviderPanel.tsx:38-42`
 * comment; the identity is cached by provider object, not by `useCallback`,
 * because `useCallback` cannot share a closure across separate components).
 *
 * Never selects on its own (1e-3b-1 final review, Minor 9 / plan
 * 1e-3b-2's controller pre-flight P3): the default and the stored selection
 * belong to `loadSelectedProvider` (`src/app/loadStores.ts`), which runs
 * before any of these pieces mount. This hook only loads the shown entry.
 */
import { useEffect } from 'react';
import type { AnyProvider } from '../../lib/provider/types';
import type { ProviderEntry, Readiness } from '../../stores/providerStore';
import { UNKNOWN, useProviderStore } from '../../stores/providerStore';

export interface SelectedProvider {
  provider: AnyProvider;
  entry: ProviderEntry | undefined;
  readiness: Readiness;
  update(patch: Readonly<Record<string, unknown>>): void;
}

/** One `update` closure per provider object, however many pieces render it. */
const updateCache = new WeakMap<AnyProvider, (patch: Readonly<Record<string, unknown>>) => void>();
function updateFor(provider: AnyProvider): (patch: Readonly<Record<string, unknown>>) => void {
  let update = updateCache.get(provider);
  if (!update) {
    update = (patch) => useProviderStore.getState().updateSettings(provider, patch);
    updateCache.set(provider, update);
  }
  return update;
}

/** The provider a piece shows (`providers.find(...) ?? providers[0]`), its loaded entry and readiness, loading the entry when missing. Null when `providers` is empty. */
export function useSelectedProvider(providers: readonly AnyProvider[]): SelectedProvider | null {
  const selected = useProviderStore((st) => st.selected);
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const entry = useProviderStore((st) => (provider ? st.entries[provider.id] : undefined));
  const readiness = useProviderStore((st) => (provider ? st.readiness[provider.id] : undefined)) ?? UNKNOWN;

  useEffect(() => {
    if (provider && !entry) void useProviderStore.getState().load(provider);
  }, [provider, entry]);

  if (!provider) return null;
  return { provider, entry, readiness, update: updateFor(provider) };
}
