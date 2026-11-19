// src/lib/history/services.ts
//
// What a record says about the services it ran on, as its readers take it. A record written before records named
// the provider of each stage has no `stages`: it reads as its one provider on every stage.
import { allStagesBy } from '../lineup/catalog';
import type { StageIds } from '../lineup/types';
import type { HistoryServices } from './types';

/** The line-up id that served each stage of a record: its own `stages`, or its `provider` on every stage. */
export function recordStages(services: Pick<HistoryServices, 'provider' | 'stages'>): StageIds {
  return services.stages ?? allStagesBy(services.provider);
}
