// src/components/TitleBar/useVerificationRefresh.ts
//
// The user finishes verifying in a BROWSER and switches back to Sokuji.
// Nothing else notices: the old polling ran only during the 60-second resend
// cooldown, and it lived in a component that is now mounted only while the
// popover is open. AccountButton is always mounted, so the listener lives here.
import { useEffect, useRef } from 'react';

const THROTTLE_MS = 10_000;

export function useVerificationRefresh(
  isSignedIn: boolean,
  emailVerified: boolean,
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
    if (!isSignedIn || emailVerified) return;

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
  }, [isSignedIn, emailVerified]);
}
