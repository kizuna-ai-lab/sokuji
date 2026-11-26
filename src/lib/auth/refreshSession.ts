import { authClient } from '../auth-client';

/**
 * Re-checks the session for every `useSession` in the page, from outside a hook: Better Auth's session refresh
 * listens to `$sessionSignal` and fetches the session again, so a session the server has forgotten stops showing as
 * signed in (the account button, `currentAuth()`).
 */
export function refreshSession(): void {
  authClient.$store.notify('$sessionSignal');
}
