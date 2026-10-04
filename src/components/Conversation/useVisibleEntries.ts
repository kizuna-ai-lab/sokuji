import { useEffect, useMemo, useState } from 'react';
import type { Entry } from '../../lib/projection/types';
import { nextNoticeExpiry, visibleEntries } from '../../lib/view/filter';

/**
 * The entries a surface shows now: a transient notice drops out when its time
 * is up (`TRANSIENT_NOTICE_MS`, #481), with one re-render at the moment the
 * next one hides — nothing else may change then. Notices are stamped by the
 * session's real clock, `Date.now()`. The conversation, and its export, keep
 * every notice; only the surfaces leave the expired ones out.
 */
export function useVisibleEntries(entries: readonly Entry[]): readonly Entry[] {
  const [now, setNow] = useState(() => Date.now());
  const hidesAt = nextNoticeExpiry(entries, now);
  useEffect(() => {
    if (hidesAt === null) return;
    // Already past (a notice older than the surface): at once.
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, hidesAt - Date.now()));
    return () => clearTimeout(timer);
  }, [hidesAt]);
  return useMemo(() => visibleEntries(entries, now), [entries, now]);
}
