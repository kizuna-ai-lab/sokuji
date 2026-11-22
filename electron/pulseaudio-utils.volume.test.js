// The Linux virtual devices' volume. The sound server restores the virtual microphone's last volume by name, so once
// something had lowered it (a meeting app's automatic microphone level, a settings slider), every launch came up that
// low and the meeting app heard the translation quieter than it was played into the virtual speaker.
//
// A fake `run` is injected rather than vi.mock'ing child_process: pulseaudio-utils.js is CommonJS and reaches it
// through require(), which vi.mock does not reliably intercept.
import { describe, it, expect, vi } from 'vitest';
import { setVirtualDevicesToFullVolume } from './pulseaudio-utils.js';

describe('setVirtualDevicesToFullVolume (Linux)', () => {
  it('sets the virtual speaker and the virtual microphone to 100%', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }));
    await setVirtualDevicesToFullVolume({ run });
    expect(run.mock.calls.map((c) => c[0])).toEqual([
      'pactl set-sink-volume sokuji_virtual_output 100%',
      'pactl set-source-volume sokuji_virtual_mic 100%',
    ]);
  });

  it('is not fatal when a volume cannot be set: the devices still work, only quieter', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = vi.fn(async (cmd) => {
      if (cmd.includes('set-sink-volume')) throw new Error('no such entity');
      return { stdout: '', stderr: '' };
    });
    await expect(setVirtualDevicesToFullVolume({ run })).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
