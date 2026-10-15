import { useMemo } from 'react';
import { useProviderStore } from '../../stores/providerStore';
import { readingTargets } from './languages';
import type { ReadingLanguage } from './types';

/** The selected provider's pair target, as the surfaces show it (the `sharedPair` rule in app/captionShare.ts). */
export function currentReadingTarget(): string | null {
  const providers = useProviderStore.getState();
  const id = providers.selected;
  return id ? providers.entries[id]?.pair?.target ?? null : null;
}

/** The reading languages the switch names and annotates (R3, R13). */
export function useReadingTargets(): ReadonlySet<ReadingLanguage> {
  const target = useProviderStore((s) => (s.selected ? s.entries[s.selected]?.pair?.target ?? null : null));
  return useMemo(() => readingTargets(target), [target]);
}
