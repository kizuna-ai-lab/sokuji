// src/viewer/model.ts
/** The viewer page's state over the share stream (spec 2026-10-04 §4.4, §5.5). */
import type { ResetReason, ShareState, ViewerEntry, ViewerEvent } from '../lib/share/types';

export type Connection = 'connecting' | 'open' | 'reconnecting' | 'ended';

export interface ViewerModel {
  connection: Connection;
  state: ShareState | null;
  entries: ViewerEntry[];
  notice: ResetReason | null;
}

export const INITIAL_MODEL: ViewerModel = { connection: 'connecting', state: null, entries: [], notice: null };

export type ModelEvent = ViewerEvent | { type: 'open' } | { type: 'error' };

const byTime = (list: ViewerEntry[]) => list.slice().sort((a, b) => a.t - b.t);

export function reduce(model: ViewerModel, event: ModelEvent): ViewerModel {
  if (model.connection === 'ended') return model;
  switch (event.type) {
    case 'open':
      return { ...model, connection: 'open' };
    case 'error':
      return { ...model, connection: 'reconnecting' };
    case 'snapshot':
      return { connection: 'open', state: event.state, entries: byTime(event.entries), notice: null };
    case 'upsert': {
      const next = new Map(model.entries.map((e) => [e.id, e] as const));
      for (const e of event.entries) next.set(e.id, e);
      return { ...model, entries: byTime([...next.values()]), notice: event.entries.length > 0 ? null : model.notice };
    }
    case 'remove': {
      const gone = new Set(event.ids);
      return { ...model, entries: model.entries.filter((e) => !gone.has(e.id)) };
    }
    case 'clear':
      return { ...model, entries: [], notice: event.reason };
    case 'state':
      return { ...model, state: event.state };
    case 'ended':
      return { ...model, connection: 'ended' };
  }
}

export type ViewerStatus = 'waiting' | 'live' | 'paused' | 'reconnecting' | 'ended';

export function statusOf(model: ViewerModel): ViewerStatus {
  if (model.connection === 'ended') return 'ended';
  if (model.connection === 'reconnecting') return 'reconnecting';
  if (!model.state) return 'waiting';
  if (model.state.phase === 'live') return 'live';
  return model.entries.length > 0 ? 'paused' : 'waiting';
}

export function legsOf(entries: readonly ViewerEntry[]): { speaker: boolean; participant: boolean } {
  return { speaker: entries.some((e) => e.leg === 'speaker'), participant: entries.some((e) => e.leg === 'participant') };
}
