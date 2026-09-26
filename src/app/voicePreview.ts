/**
 * The page's voice-preview route (spec, "Playback — Routing": voice preview
 * is folded into the preview route, the real device): what a provider's
 * `Settings` plays a voice's sample through, on the selected output
 * device. The page's playback is built on the first play (`getAppAudio`,
 * shared with the session and the test tone).
 */
import { getAppAudio, type AppAudio } from '../lib/audio/appAudio';
import type { PreviewPort } from '../lib/provider/types';

let loaded: AppAudio | null = null;

export const appVoicePreview: PreviewPort = {
  async play(clip) {
    const app = await getAppAudio();
    loaded = app;
    await app.playback.preview(clip);
  },
  stop() {
    loaded?.playback.stopPreview();
  },
};
