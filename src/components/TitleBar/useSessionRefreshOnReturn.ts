// src/components/TitleBar/useSessionRefreshOnReturn.ts
//
// Whatever happened to the session while the user was away, the app finds out
// when they come back.
//
// Two things change the session from outside this window, and neither notifies
// it. The user finishes verifying their e-mail in a browser. And the user signs
// out in the dashboard tab that Top up / Manage account opened for them, which
// drops the session cookie this app is still holding — after which every
// authenticated request 401s while the UI happily goes on showing an avatar and
// a balance.
//
// The only signal either one gives is that focus comes back. So refetch then,
// and let the session hook decide what is true.
//
// This listener has to outlive the popover, so it lives here with the
// always-mounted AccountButton rather than in UserAccountInfo.
import { useEffect, useRef } from 'react';

const THROTTLE_MS = 10_000;

export function useSessionRefreshOnReturn(
  isSignedIn: boolean,
  refetch: () => void,
): void {
  const lastRef = useRef(0);

  // better-auth's refetch is not guaranteed to be referentially stable, and
  // AccountButton's caller hands us a fresh function on some renders. Listing
  // it in the deps would tear the listeners down and re-add them each time;
  // holding the latest one in a ref keeps the subscription alive instead.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!isSignedIn) return;

    const maybeRefetch = () => {
      const now = Date.now();
      if (now - lastRef.current < THROTTLE_MS) return;
      lastRef.current = now;
      refetchRef.current();
    };
    const onVisible = () => { if (!document.hidden) maybeRefetch(); };

    window.addEventListener('focus', maybeRefetch);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', maybeRefetch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isSignedIn]);
}
