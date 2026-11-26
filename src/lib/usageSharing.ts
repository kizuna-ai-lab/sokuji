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

/**
 * For a page that has no settings store but shares the browser's storage with the app (the extension popup): applies
 * the saved choice now and follows it when the app changes it. Nothing saved reads as sharing, the default.
 */
export function followUsageSharingSetting(
  area: { get(key: string, cb: (result: Record<string, unknown>) => void): void },
  onChanged: { addListener(listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void },
  areaName: string,
  key: string,
): void {
  area.get(key, (result) => {
    // A failed read gives no result: the client keeps its own persisted choice.
    if (!result) return;
    setUsageSharing(result[key] !== false);
  });
  onChanged.addListener((changes, changedArea) => {
    if (changedArea === areaName && key in changes) setUsageSharing(changes[key].newValue !== false);
  });
}
