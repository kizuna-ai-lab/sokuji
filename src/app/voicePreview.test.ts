import { describe, it, expect, vi } from 'vitest';
import type { PreviewClip } from '../lib/audio/playback';

// The page's playback, as session.test.ts mocks it: no Web Audio in jsdom.
// Module-level so a test can see what the route handed it.
const { playback, getAppAudio } = vi.hoisted(() => {
  const playback = { preview: vi.fn(async () => {}), stopPreview: vi.fn() };
  return { playback, getAppAudio: vi.fn(async () => ({ playback })) };
});
vi.mock('../lib/audio/appAudio', () => ({ getAppAudio }));

describe('appVoicePreview', () => {
  it("plays a clip through the page's playback, the preview route", async () => {
    const { appVoicePreview } = await import('./voicePreview');
    const clip: PreviewClip = { audio: new Float32Array(4), sampleRate: 24000 };
    await appVoicePreview.play(clip);
    expect(playback.preview).toHaveBeenCalledWith(clip);
  });

  it('stop stops the page\'s preview once the playback has loaded, and does nothing before', async () => {
    vi.resetModules();
    const { appVoicePreview } = await import('./voicePreview');
    appVoicePreview.stop();
    expect(playback.stopPreview).not.toHaveBeenCalled();

    const clip: PreviewClip = { audio: new Float32Array(4), sampleRate: 24000 };
    await appVoicePreview.play(clip);
    appVoicePreview.stop();
    expect(playback.stopPreview).toHaveBeenCalledTimes(1);
  });
});
