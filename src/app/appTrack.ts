/**
 * The page's analytics `track`, for code that runs outside React (the notes runner, the file jobs). The page hands
 * it over with the session's other bridges (`useAppSessionBridges`); until then, and in builds with no analytics
 * key, events are dropped.
 */
import type { AnalyticsPort } from '../lib/session/ports';

let current: AnalyticsPort['track'] = () => {};

export function setAppTrack(track: AnalyticsPort['track']): void {
  current = track;
}

export const appTrack: AnalyticsPort['track'] = (event, properties) => current(event, properties);
