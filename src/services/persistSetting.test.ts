import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const setSetting = vi.fn();
vi.mock('./ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ setSetting }) },
}));

import { persistSetting } from './persistSetting';
import { settleReports } from '../lib/diagnostics/report';
import { resetReportThrottle } from '../lib/diagnostics/report';
import useLogStore from '../stores/logStore';

const panel = () => useLogStore.getState().allLogs.map((l) => `${l.type}:${l.message}`);

describe('persistSetting', () => {
  beforeEach(() => {
    setSetting.mockReset();
    setSetting.mockResolvedValue({ success: true });
    useLogStore.getState().clearLogs();
    resetReportThrottle();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useLogStore.getState().clearLogs();
  });

  it('writes through to the settings service', async () => {
    await persistSetting('settings.common.textOnly', true);
    expect(setSetting).toHaveBeenCalledWith('settings.common.textOnly', true);
  });

  it('reports success as true and files nothing', async () => {
    await expect(persistSetting('settings.common.textOnly', true)).resolves.toBe(true);
    await settleReports();
    expect(panel()).toEqual([]);
  });

  // The failure the service actually reports today. No call site read
  // `result.success`, so a quota error or chrome.runtime.lastError was dropped
  // at all 31 of them — the user's change silently did not persist.
  it('reports a failed result and files one warning', async () => {
    setSetting.mockResolvedValue({ success: false, error: 'QUOTA_BYTES quota exceeded' });

    await expect(persistSetting('settings.common.textOnly', true)).resolves.toBe(false);
    await settleReports();

    expect(panel()).toEqual([
      'warning:[Settings] Could not save settings.common.textOnly: QUOTA_BYTES quota exceeded',
    ]);
  });

  // The other channel: a rejection is still possible from a mocked or future
  // implementation, and used to be possible from the real one. The seam owns
  // both so the call sites can own neither.
  it('absorbs a rejection and files one warning', async () => {
    setSetting.mockRejectedValue(new Error('Extension context invalidated.'));

    await expect(persistSetting('settings.common.textOnly', true)).resolves.toBe(false);
    await settleReports();

    expect(panel()).toEqual([
      'warning:[Settings] Could not save settings.common.textOnly: Extension context invalidated.',
    ]);
  });

  it('never rejects, so a fire-and-forget call cannot become an unhandled rejection', async () => {
    setSetting.mockRejectedValue(new Error('boom'));
    await expect(persistSetting('k', 1)).resolves.toBe(false);
  });

  // A settings backend that is down fails for every key at once. One line per
  // key is the useful signal; one line per key per retry is a flood.
  it('files one warning per key, not one per attempt', async () => {
    setSetting.mockResolvedValue({ success: false, error: 'down' });

    await persistSetting('settings.audio.mode', 'a');
    await persistSetting('settings.audio.mode', 'b');
    await persistSetting('settings.audio.mode', 'c');
    await settleReports();

    expect(panel()).toHaveLength(1);
  });

  it('keeps distinct keys apart', async () => {
    setSetting.mockResolvedValue({ success: false, error: 'down' });

    await persistSetting('settings.audio.mode', 'a');
    await persistSetting('settings.audio.volume', 1);
    await settleReports();

    expect(panel()).toHaveLength(2);
  });

  // Tests across the codebase stub the settings service with bare `vi.fn()`,
  // which resolves undefined. Treating that as a failure would fill unrelated
  // suites with warnings about a service that is not under test.
  it('treats an undefined result from a stubbed service as success', async () => {
    setSetting.mockResolvedValue(undefined);

    await expect(persistSetting('k', 1)).resolves.toBe(true);
    await settleReports();
    expect(panel()).toEqual([]);
  });

  // The one-off writes that blank legacy keys during migration: a failure there
  // is not something the user did, and there is nothing to retry.
  it('stays silent for migration writes', async () => {
    setSetting.mockResolvedValue({ success: false, error: 'down' });

    await expect(persistSetting('settings.legacy.isInputDeviceOn', null, { silent: true }))
      .resolves.toBe(false);
    await settleReports();

    expect(panel()).toEqual([]);
  });
});
