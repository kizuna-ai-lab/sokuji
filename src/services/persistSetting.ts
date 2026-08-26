/**
 * The one way a store writes a setting.
 *
 * Before this seam, 31 call sites across `audioStore`, `settingsStore`,
 * `subtitleStore` and `conversationDisplayStore` each did their own version of
 *
 *     service.setSetting(key, value).catch(e => console.error('...', e))
 *
 * which got the responsibility exactly backwards: none of them read
 * `result.success`, so the failure `setSetting` actually reports — a quota
 * error, `chrome.runtime.lastError` — was dropped at every one of them, while
 * the `.catch` they did write guarded a rejection that only the extension build
 * could produce (and only because of the un-awaited promise fixed in
 * `SettingsService.setSetting`).
 *
 * So the seam owns both channels and the call sites own neither. A failed write
 * means the user's change is live in memory but gone on restart, which is worth
 * one line in the panel — and exactly one, per key: a settings backend that is
 * down fails for every key at once, and one line per attempt would bury the
 * session's real events.
 */
import { ServiceFactory } from './ServiceFactory';
import { reportWarning, describeCause } from '../lib/diagnostics/report';

export interface PersistOptions {
  /**
   * Suppress the panel entry.
   *
   * For writes the user did not ask for and cannot retry — the one-off blanking
   * of legacy keys during migration. The console line still fires.
   */
  silent?: boolean;
}

/**
 * Write one setting. Never rejects, so a fire-and-forget call cannot become an
 * unhandled rejection.
 *
 * @returns whether the value reached storage.
 */
export async function persistSetting<T>(
  key: string,
  value: T,
  options?: PersistOptions,
): Promise<boolean> {
  let detail: string | undefined;

  try {
    const result = await ServiceFactory.getSettingsService().setSetting(key, value);
    // A stubbed service (`vi.fn()` with no return) resolves undefined. Treating
    // that as a failure would fill unrelated suites with warnings about a
    // service that is not under test.
    if (result === undefined || result.success) return true;
    detail = result.error || 'unknown error';
  } catch (error) {
    detail = describeCause(error);
  }

  if (!options?.silent) {
    reportWarning('Settings', `Could not save ${key}: ${detail}`, { dedupeKey: `persist:${key}` });
  }
  return false;
}
