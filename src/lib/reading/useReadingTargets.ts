import { useMemo } from 'react';
import { planFromStores, usePlan, type PlanState } from '../plan/fromStores';
import { transcriptionProvider } from '../plan/read';
import { readingTargets } from './languages';
import type { ReadingLanguage } from './types';

/** The run's pair target in a plan: the transcription provider's, as the surfaces show it (the `sharedPair` rule in app/captionShare.ts); null until the plan is ready. */
function targetIn(found: PlanState): string | null {
  return found.state === 'ready' ? found.accounts[transcriptionProvider(found.plan).id].pair?.target ?? null : null;
}

/** The run's pair target, in the plan as the stores stand. */
export function currentReadingTarget(): string | null {
  return targetIn(planFromStores());
}

/** The reading languages the switch names and annotates (R3, R13). */
export function useReadingTargets(): ReadonlySet<ReadingLanguage> {
  const target = targetIn(usePlan());
  return useMemo(() => readingTargets(target), [target]);
}
