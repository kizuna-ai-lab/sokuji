// Per-application capture behaviour of the Linux platform module (issue #335).
//
// These inject a fake `host` rather than vi.mock'ing pipewire-app-audio.js:
// pulseaudio-utils.js is CommonJS and reaches it through require(), which
// vi.mock does not reliably intercept.
import { describe, it, expect, vi } from 'vitest';
import {
  listSystemAudioSources,
  connectSystemAudioSource,
  disconnectSystemAudioSource,
} from './pulseaudio-utils.js';

const host = () => ({
  listAppSources: vi.fn(async () => [{ deviceId: 'app:205', label: 'Chromium' }]),
  connectAppSource: vi.fn(async () => ({ success: true, monitorLabel: 'Sokuji App Capture' })),
  disconnectAppSource: vi.fn(async () => ({ success: true })),
});

const SYSTEM = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };

describe('listSystemAudioSources (Linux)', () => {
  it('keeps whole-system capture first, then the per-application entries', async () => {
    const sources = await listSystemAudioSources({ host: host() });
    expect(sources[0]).toEqual(SYSTEM);
    expect(sources.map((s) => s.deviceId)).toContain('app:205');
  });

  it('still offers whole-system capture without PipeWire', async () => {
    const h = host();
    h.listAppSources.mockResolvedValue([]);
    expect(await listSystemAudioSources({ host: h })).toEqual([SYSTEM]);
  });
});

describe('connectSystemAudioSource (Linux)', () => {
  it('delegates app: ids to the PipeWire tap and forwards monitorLabel', async () => {
    const h = host();
    const r = await connectSystemAudioSource('app:205', { host: h });
    expect(h.connectAppSource).toHaveBeenCalledWith('app:205');
    expect(r).toEqual({ success: true, monitorLabel: 'Sokuji App Capture' });
  });

  it('leaves whole-system capture as a no-op with no monitorLabel', async () => {
    const h = host();
    const r = await connectSystemAudioSource('desktop-audio-loopback', { host: h });
    expect(h.connectAppSource).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.monitorLabel).toBeUndefined();
  });

  it('tears down a previous tap when switching back to whole-system', async () => {
    const h = host();
    await connectSystemAudioSource('desktop-audio-loopback', { host: h });
    // A surviving tap keeps feeding the old application into the capture sink.
    expect(h.disconnectAppSource).toHaveBeenCalled();
  });
});

describe('disconnectSystemAudioSource (Linux)', () => {
  it('always releases the capture sink', async () => {
    const h = host();
    expect(await disconnectSystemAudioSource({ host: h })).toEqual({ success: true });
    expect(h.disconnectAppSource).toHaveBeenCalled();
  });
});
