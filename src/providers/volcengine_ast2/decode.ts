/**
 * A spoken sentence's Ogg Opus as the contract's audio (24 kHz mono Int16).
 * An `OfflineAudioContext` decodes it — it resamples to its own rate — so no
 * output device is opened for it (the old client opened an `AudioContext`,
 * survey §1.18.11). The adapter's default decoder; tests inject their own.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';

export async function decodeOggOpus(ogg: Uint8Array): Promise<Int16Array> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  // `decodeAudioData` takes, and detaches, an ArrayBuffer: exactly this clip's bytes, copied.
  const decoded = await context.decodeAudioData(new Uint8Array(ogg).buffer);
  const float = decoded.getChannelData(0);
  const pcm = new Int16Array(float.length);
  for (let i = 0; i < float.length; i++) {
    const s = Math.max(-1, Math.min(1, float[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}
