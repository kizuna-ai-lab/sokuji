/**
 * Opens a page of the website, signed in: one function for every button that leads there (the account popover's
 * Top up, Manage account and Feedback, and the panel's Top up), so each one signs the browser in the same way.
 */
import { authClient } from '../auth-client';
import { getApiUrl, getBackendUrl, isElectron } from '../../utils/environment';
import { reportWarning } from '../diagnostics/report';

/** The website's billing page, where a top-up is paid (`/dashboard/wallet` redirects to it). */
export const BILLING_PATH = '/dashboard/billing';
/** The billing page on the organization's wallet: for its owner (the site ignores `subject` for anyone else). */
export const BILLING_ORG_PATH = `${BILLING_PATH}?subject=organization`;

export interface OpenSitePageDeps {
  /** Whether the app holds a session: only then is a one-time token worth asking for. */
  signedIn: boolean;
  /**
   * The token endpoint answered 401: the session is gone, so nothing is opened (it would only show a login form in a
   * browser) and the caller shows the sign-in instead.
   */
  onSessionExpired(): void;
}

/**
 * Opens `targetPath` of the website in the system browser (desktop) or a new tab (extension). Signed in, it goes
 * through the one-time-token wrapper (`/api/ott/verify`), which signs the browser in and redirects to the page;
 * any other failure to get a token opens the plain page, where the site asks for a sign-in itself.
 */
export async function openSitePage(targetPath: string, deps: OpenSitePageDeps): Promise<'opened' | 'session-expired'> {
  let url = `${getBackendUrl()}${targetPath}`;

  if (deps.signedIn) {
    try {
      const { data, error } = await authClient.oneTimeToken.generate();

      // A 401 here is not a token problem, it is the session being gone. The likeliest way to get one: the user
      // opened the dashboard from the app and signed out over there, dropping the cookie the app shares with it.
      // Nothing pushes that back to the app, so without this every button that leads to the site would silently
      // open a login page instead of the thing that was asked for.
      if ((error as { status?: number } | null)?.status === 401) {
        deps.onSessionExpired();
        return 'session-expired';
      }

      if (data?.token && !error) {
        // The GET wrapper calls Better Auth's POST verify; its after hook sets the signed cookie, which the wrapper
        // forwards with the redirect.
        url = `${getApiUrl()}/ott/verify?token=${encodeURIComponent(data.token)}&redirect=${encodeURIComponent(targetPath)}`;
      }
      // Any other failure — the token endpoint down, a network blip — is not evidence about the session: the plain URL.
    } catch (e) {
      reportWarning('Account', 'Could not get a one-time sign-in token; opening the page without it.', { cause: e });
    }
  }

  const bridge = (window as { electron?: { invoke?: (channel: string, ...args: unknown[]) => Promise<unknown> } }).electron;
  if (isElectron() && bridge?.invoke) {
    // Not awaited, and caught: a rejected invoke (main process gone, handler throwing) would otherwise surface as an
    // unhandled rejection with nothing in the UI to show for it. The main process answers its own failure to open
    // the browser (`{ success: false, error }`, electron/main.js) rather than throwing it: reported the same way.
    void bridge.invoke('open-external', url).then(
      (result: unknown) => {
        const answer = result as { success?: boolean; error?: string } | undefined;
        if (answer?.success === false) reportWarning('Account', 'Could not open the website page.', { cause: answer.error });
      },
      (e: unknown) => {
        reportWarning('Account', 'Could not open the website page.', { cause: e });
      },
    );
  } else {
    window.open(url, '_blank');
  }
  return 'opened';
}
