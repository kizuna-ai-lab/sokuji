/**
 * Whether Sokuji reports which pages and features are used ("Share usage data", General settings).
 *
 * The analytics client is built after the UI is up and the setting is read about the same time, so the two meet
 * here: whichever arrives second settles the client. Opting the client out stops everything it sends (events,
 * autocapture, error reports); the client keeps the choice itself across restarts, and the setting re-applies it at
 * each start.
 */
interface OptClient {
  /** The client's own persisted choice (posthog-js-lite). */
  readonly optedOut?: boolean;
  optIn(): void;
  optOut(): void;
}

let on = true;
/** Whether the setting has been read: until then the client's own persisted choice stands, untouched. */
let known = false;
let client: OptClient | null = null;

function apply(): void {
  if (!client || !known) return;
  // Only a change is applied: opting in sends an `$opt_in` event, which must not go out at every start.
  if (on) { if (client.optedOut === true) client.optIn(); }
  else if (client.optedOut !== true) client.optOut();
}

export function usageSharingOn(): boolean {
  return on;
}

export function setUsageSharing(next: boolean): void {
  on = next;
  known = true;
  apply();
}

/** The analytics client, once there is one (`null`: a build with no analytics key). */
export function attachUsageSharingClient(next: OptClient | null): void {
  client = next;
  apply();
}
