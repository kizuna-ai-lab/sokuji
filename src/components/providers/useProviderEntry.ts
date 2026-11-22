/**
 * One provider as a piece shows it: its loaded entry, readiness and models,
 * and one `update` per provider shared by every piece that renders it:
 * `ProviderPicker`, `ProviderLanguages`, `ProviderOwnSettings` and
 * `ProviderEngine` each call this hook on their own, so a `Settings`/`Engine`
 * held in another piece's effect deps still sees one identity across the
 * panel's re-renders (the identity is cached by provider object, not by
 * `useCallback`, because `useCallback` cannot share a closure across separate
 * components).
 *
 * Which provider a piece shows is the piece's own question: the unit of the
 * plan that owns its answer, the provider a stage card names, or the provider
 * the line-up names for a stage (`useStageProvider`). This hook only
 * loads the entry of the provider it is given.
 */
import { useEffect } from 'react';
import type { RunStage } from '../../lib/lineup/types';
import type { AnyProvider, SettingsProps } from '../../lib/provider/types';
import type { LanguagePair, ModelOption } from '../../lib/run/types';
import type { ProviderEntry, Readiness } from '../../stores/providerStore';
import { useStageProviderId } from '../../stores/lineUpStore';
import { NO_MODELS, UNKNOWN, useProviderStore } from '../../stores/providerStore';

export interface ShownProvider {
  provider: AnyProvider;
  entry: ProviderEntry | undefined;
  readiness: Readiness;
  models: readonly ModelOption[];
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

/** `provider` with its loaded entry and readiness, loading the entry when it is missing. Null without a provider. */
export function useProviderEntry(provider: AnyProvider | undefined): ShownProvider | null {
  const entry = useProviderStore((st) => (provider ? st.entries[provider.id] : undefined));
  const readiness = useProviderStore((st) => (provider ? st.readiness[provider.id] : undefined)) ?? UNKNOWN;
  const models = useProviderStore((st) => (provider ? st.models[provider.id] : undefined)) ?? NO_MODELS;

  useEffect(() => {
    if (provider && !entry) void useProviderStore.getState().load(provider);
  }, [provider, entry]);

  if (!provider) return null;
  return { provider, entry, readiness, models, update: updateFor(provider) };
}

/**
 * The provider the line-up names for `stage`, looked up in `providers` (the offered list): the provider of the
 * plan's unit for that stage, known before its entry has loaded, so that a piece showing it can load the entry.
 * Undefined before the line-up store has loaded, or when that provider is not offered here.
 */
export function useStageProvider(providers: readonly AnyProvider[], stage: RunStage): AnyProvider | undefined {
  const id = useStageProviderId(stage);
  return id === null ? undefined : providers.find((p) => p.id === id);
}

/**
 * The pair a session would run: the pair of the provider the line-up names for transcription, which is the
 * session's direction. A provider that serves another stage (a voice reading another provider's text) shows its
 * options for this pair, not for the one its own languages would give. Undefined until that provider's entry has
 * loaded.
 */
export function useRunPair(): LanguagePair | undefined {
  const id = useStageProviderId('transcription');
  return useProviderStore((st) => (id === null ? undefined : st.entries[id]?.pair));
}

/**
 * The props a provider's own component gets (D18): its settings and `update`, the lock, the pair, and the models its
 * readiness found (F2). `account` is `ProviderOwnSettings`' own. `pair`: the run's, where the caller knows it; by
 * default the provider's own.
 */
export function ownProps(selection: ShownProvider, entry: ProviderEntry, disabled: boolean | undefined, pair: LanguagePair = entry.pair): SettingsProps<unknown> {
  return { settings: entry.settings, update: selection.update, disabled, pair, models: selection.models };
}
