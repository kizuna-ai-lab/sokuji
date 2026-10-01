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

  // The first play builds the page's playback. A stop pressed meanwhile (a
  // second click on the row, Settings closed) finds nothing loaded to stop:
  // the play itself must see it once the build resolves, as the test tone's
  // signal does for "a stop pressed during the first decode" (appAudio.ts).
  it('a stop pressed while the first play builds the playback plays nothing once it is built', async () => {
    vi.resetModules();
    let built: (app: { playback: typeof playback }) => void = () => {};
    getAppAudio.mockImplementationOnce(() => new Promise((resolve) => { built = resolve; }));
    const { appVoicePreview } = await import('./voicePreview');
    playback.preview.mockClear();
    const clip: PreviewClip = { audio: new Float32Array(4), sampleRate: 24000 };
    const playing = appVoicePreview.play(clip);
    appVoicePreview.stop();
    built({ playback });
    await playing;
    expect(playback.preview).not.toHaveBeenCalled();
  });

  it('a newer play while the playback is built supersedes the older one: only the newer clip plays', async () => {
    vi.resetModules();
    let built: (app: { playback: typeof playback }) => void = () => {};
    // `getAppAudio` hands every caller the same build until it resolves.
    const building = new Promise<{ playback: typeof playback }>((resolve) => { built = resolve; });
    getAppAudio.mockReturnValueOnce(building).mockReturnValueOnce(building);
    const { appVoicePreview } = await import('./voicePreview');
    playback.preview.mockClear();
    const older: PreviewClip = { audio: new Float32Array(4), sampleRate: 24000 };
    const newer: PreviewClip = { audio: new Float32Array(8), sampleRate: 24000 };
    const first = appVoicePreview.play(older);
    const second = appVoicePreview.play(newer);
    built({ playback });
    await Promise.all([first, second]);
    expect(playback.preview).toHaveBeenCalledTimes(1);
    expect(playback.preview).toHaveBeenCalledWith(newer);
  });
});
