// Virtual-device gain repair on the macOS startup path.
//
// Reported as "SokujiVirtualAudio is visible in system devices but receives no
// audio": macOS stores the device's volume and restores it onto the driver, a
// macOS 15 -> 26 upgrade was measured leaving it at scalar 0.5, and the
// driver's logarithmic volume control turns that into -32 dB. Audio still
// flows, so no layer reports an error and the far end simply hears silence.
//
// These inject a fake `host` rather than vi.mock'ing audio-host.js, for the
// same reason as macos-audio-utils.appaudio.test.js: this module is CommonJS
// and reaches it through require().
import { describe, it, expect, vi } from 'vitest';
import {
  createVirtualAudioDevices,
  restoreVirtualDeviceGain,
  VIRTUAL_DEVICE_NAME,
} from './macos-audio-utils.js';

const repaired = {
  found: true,
  name: 'SokujiVirtualAudio',
  changed: true,
  unmuted: false,
  before: { output: 0.5, input: 0.5 },
  after: { output: 1, input: 1 },
};

const host = (result = repaired) => ({
  ensureUnityGain: vi.fn(async () => result),
});

describe('restoreVirtualDeviceGain', () => {
  it('asks the helper about the device the driver publishes', async () => {
    const h = host();
    await restoreVirtualDeviceGain({ host: h });
    expect(h.ensureUnityGain).toHaveBeenCalledWith(VIRTUAL_DEVICE_NAME);
  });

  it('survives a helper that cannot tell', async () => {
    await expect(restoreVirtualDeviceGain({ host: host(null) })).resolves.toBeUndefined();
  });

  it('survives a device that is installed but not registered', async () => {
    await expect(restoreVirtualDeviceGain({ host: host({ found: false }) })).resolves.toBeUndefined();
  });

  it('survives a helper that rejects', async () => {
    const h = { ensureUnityGain: vi.fn(async () => { throw new Error('EACCES'); }) };
    await expect(restoreVirtualDeviceGain({ host: h })).resolves.toBeUndefined();
  });
});

describe('createVirtualAudioDevices', () => {
  it('repairs the gain once the driver is known to be installed', async () => {
    const h = host();
    const ok = await createVirtualAudioDevices({ host: h, isInstalled: async () => true });
    expect(ok).toBe(true);
    expect(h.ensureUnityGain).toHaveBeenCalledTimes(1);
  });

  it('does not touch device gain when the driver is not installed', async () => {
    const h = host();
    const ok = await createVirtualAudioDevices({ host: h, isInstalled: async () => false });
    expect(ok).toBe(false);
    expect(h.ensureUnityGain).not.toHaveBeenCalled();
  });

  // The repair is a convenience on the startup path. If it could fail the call,
  // a Mac whose helper is missing would lose virtual-microphone support
  // entirely - a strictly worse outcome than the quiet device it fixes.
  it('still reports the device usable when the repair fails', async () => {
    const h = { ensureUnityGain: vi.fn(async () => { throw new Error('EACCES'); }) };
    expect(await createVirtualAudioDevices({ host: h, isInstalled: async () => true })).toBe(true);
  });
});
