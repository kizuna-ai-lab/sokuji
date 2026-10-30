import type { SessionSummary } from '../history/store';

type Formats = {
  when: (ms: number) => string;
  /** The pair by name, e.g. "Auto Detect → Japanese". */
  pair: (source: string, target: string) => string;
  minutes: (n: number) => string;
};

/**
 * What a history row says. A session without a title is named by when it
 * started, and then its second line does not repeat that date.
 */
export function sessionLines(s: Pick<SessionSummary, 'title' | 'startedAt' | 'endedAt' | 'source' | 'target'>, f: Formats): { name: string; meta: string } {
  const date = f.when(s.startedAt);
  const titled = !!s.title?.trim();
  const parts = [titled ? date : null, f.pair(s.source, s.target), s.endedAt === null ? null : f.minutes(Math.max(0, Math.round((s.endedAt - s.startedAt) / 60000)))];
  return { name: titled ? s.title!.trim() : date, meta: parts.filter((p): p is string => p !== null).join(' · ') };
}
