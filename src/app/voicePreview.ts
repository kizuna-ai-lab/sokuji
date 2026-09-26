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
/**
 * Bumped by every `stop()` and every `play()`. A play that finds it moved
 * once the page's playback is built plays nothing: a stop pressed while the
 * first play was still building it (nothing was loaded for `stop()` to
 * reach), or a newer play.
 */
let generation = 0;

export const appVoicePreview: PreviewPort = {
  async play(clip) {
    const mine = ++generation;
    const app = await getAppAudio();
    loaded = app;
    if (mine !== generation) return;
    await app.playback.preview(clip);
  },
  stop() {
    generation += 1;
    loaded?.playback.stopPreview();
  },
};
