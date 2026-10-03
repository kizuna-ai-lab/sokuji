// A virtual-audio driver that is installed but that Core Audio never loaded, and its repair.
//
// The pkg's postinstall runs twice per install, and before the fix the second
// run could leave coreaudiod scanning the HAL directory while the driver was
// missing (see macos-driver-install.consistency.test.js): the driver is on disk,
// yet no device exists until something restarts Core Audio. In-app updates never
// run the postinstall, so a Mac left that way stays that way. The app therefore
// notices the device is missing and offers to restart Core Audio, through
// macOS's own administrator prompt.
//
// These inject fakes rather than vi.mock'ing child_process and audio-host.js,
// for the same reason as macos-audio-utils.unitygain.test.js: this module is
// CommonJS and reaches them through require().
import { describe, it, expect, vi } from 'vitest';
import {
  createVirtualAudioDevices,
  repairVirtualDevice,
  virtualDeviceProblem,
  DRIVER_PATH,
  VIRTUAL_DEVICE_NAME,
} from './macos-audio-utils.js';

/** A helper whose ensureUnityGain answers with each result in turn, then keeps the last. */
const host = (...results) => {
  const ensureUnityGain = vi.fn();
  for (const r of results) ensureUnityGain.mockResolvedValueOnce(r);
  ensureUnityGain.mockResolvedValue(results[results.length - 1]);
  return { ensureUnityGain };
};
const registered = { found: true, name: VIRTUAL_DEVICE_NAME, changed: false, unmuted: false };
const noSleep = async () => {};
const succeeded = () => vi.fn(async () => ({ stdout: '', stderr: '' }));
const failedWith = (stderr) => vi.fn(async () => { throw Object.assign(new Error('Command failed'), { stderr }); });

describe('createVirtualAudioDevices with a driver macOS did not load', () => {
  it('fails, and says why, when the driver is installed but Core Audio has no such device', async () => {
    const ok = await createVirtualAudioDevices({ host: host({ found: false }), isInstalled: async () => true });
    expect(ok).toBe(false);
    expect(virtualDeviceProblem()).toBe('not-loaded');
  });

  // A Core Audio that cannot answer the helper in time is one the device is not
  // usable on, and the Core Audio restart the repair runs is what cures it.
  it('treats a helper that timed out as a driver that is not loaded', async () => {
    const ok = await createVirtualAudioDevices({ host: host({ found: false, timedOut: true }), isInstalled: async () => true });
    expect(ok).toBe(false);
    expect(virtualDeviceProblem()).toBe('not-loaded');
  });

  it('succeeds and clears the problem once the device is registered', async () => {
    await createVirtualAudioDevices({ host: host({ found: false }), isInstalled: async () => true });
    const ok = await createVirtualAudioDevices({ host: host(registered), isInstalled: async () => true });
    expect(ok).toBe(true);
    expect(virtualDeviceProblem()).toBe(null);
  });

  it('reports a missing driver as not installed, not as not loaded', async () => {
    const h = host(registered);
    const ok = await createVirtualAudioDevices({ host: h, isInstalled: async () => false });
    expect(ok).toBe(false);
    expect(virtualDeviceProblem()).toBe('not-installed');
    expect(h.ensureUnityGain).not.toHaveBeenCalled();
  });

  // Only a helper that answered "no such device" proves the driver is not loaded.
  // One that is missing or failed proves nothing, and must not cost the user the device.
  it('keeps the device usable when the helper cannot tell', async () => {
    expect(await createVirtualAudioDevices({ host: host(null), isInstalled: async () => true })).toBe(true);
    expect(virtualDeviceProblem()).toBe(null);
  });
});

describe('repairVirtualDevice', () => {
  it('restarts Core Audio as administrator, and leaves the installed driver as it is', async () => {
    const execFile = succeeded();
    await repairVirtualDevice({ prompt: 'Repair', execFile, host: host(registered), sleep: noSleep });
    expect(execFile).toHaveBeenCalledTimes(1);
    const [command, args] = execFile.mock.calls[0];
    expect(command).toBe('/usr/bin/osascript');
    expect(args[0]).toBe('-e');
    expect(args[1]).toMatch(/^do shell script "\/usr\/bin\/killall coreaudiod" with administrator privileges with prompt ".*"$/);
    expect(args[1]).not.toContain(DRIVER_PATH);
  });

  it('shows the given prompt in the dialog, escaped for AppleScript', async () => {
    const execFile = succeeded();
    await repairVirtualDevice({ prompt: 'Say "yes" \\ now', execFile, host: host(registered), sleep: noSleep });
    expect(execFile.mock.calls[0][1][1]).toMatch(/with prompt "Say \\"yes\\" \\\\ now"$/);
  });

  it('reports a cancelled password dialog as cancelled, without waiting for the device', async () => {
    const h = host(registered);
    const result = await repairVirtualDevice({
      prompt: 'Repair', execFile: failedWith('0:47: execution error: User canceled. (-128)'), host: h, sleep: noSleep,
    });
    expect(result).toEqual({ ok: false, cancelled: true });
    expect(h.ensureUnityGain).not.toHaveBeenCalled();
  });

  it('reports a command that failed', async () => {
    const result = await repairVirtualDevice({
      prompt: 'Repair', execFile: failedWith('codesign: internal error'), host: host(registered), sleep: noSleep,
    });
    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(false);
    expect(result.error).toContain('codesign: internal error');
  });

  it('waits until Core Audio registers the device again', async () => {
    await createVirtualAudioDevices({ host: host({ found: false }), isInstalled: async () => true });
    const h = host({ found: false }, { found: false }, registered);
    const result = await repairVirtualDevice({ prompt: 'Repair', execFile: succeeded(), host: h, sleep: noSleep });
    expect(result).toEqual({ ok: true });
    expect(h.ensureUnityGain).toHaveBeenCalledTimes(3);
    expect(h.ensureUnityGain).toHaveBeenCalledWith(VIRTUAL_DEVICE_NAME);
    expect(virtualDeviceProblem()).toBe(null);
  });

  it('gives up when the device does not come back', async () => {
    const clock = fakeClock();
    const h = host({ found: false });
    const result = await repairVirtualDevice({
      prompt: 'Repair', execFile: succeeded(), host: h, sleep: clock.sleep, now: clock.now, deadlineMs: 2000,
    });
    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(false);
    expect(h.ensureUnityGain).toHaveBeenCalledTimes(4);
  });

  // A Core Audio still wedged after the restart makes every probe wait out the
  // helper's 5 s timeout. Counting probes instead of time kept the Repair button
  // disabled for nearly two minutes before the failure guidance showed.
  it('gives up within its deadline when every probe times out', async () => {
    const clock = fakeClock();
    const ensureUnityGain = vi.fn(async () => {
      clock.advance(5000);
      return { found: false, timedOut: true };
    });
    const result = await repairVirtualDevice({
      prompt: 'Repair', execFile: succeeded(), host: { ensureUnityGain }, sleep: clock.sleep, now: clock.now,
    });
    expect(result.ok).toBe(false);
    expect(clock.now()).toBeLessThanOrEqual(15000 + 5000 + 500);
  });
});

/** A clock that moves only when the code under test sleeps or a fake probe takes time. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
    sleep: async (ms) => { t += ms; },
  };
}
