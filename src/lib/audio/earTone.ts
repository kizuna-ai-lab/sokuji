/**
 * The ear preview's chime: two short notes, synthesized here so no asset is
 * fetched or decoded (the bundled test tone is a development clip).
 */
import { SAMPLE_RATE } from '../contract/adapter';
import type { PreviewClip } from './playback';

const NOTES: ReadonlyArray<{ hz: number; seconds: number }> = [{ hz: 660, seconds: 0.12 }, { hz: 880, seconds: 0.18 }];
const GAP_SECONDS = 0.05;
const RAMP_SECONDS = 0.008;
const LEVEL = 0.25;

export function earTone(sampleRate: number = SAMPLE_RATE): PreviewClip {
  const gap = Math.round(GAP_SECONDS * sampleRate);
  const ramp = Math.round(RAMP_SECONDS * sampleRate);
  const lengths = NOTES.map((n) => Math.round(n.seconds * sampleRate));
  const audio = new Float32Array(lengths.reduce((a, b) => a + b, 0) + gap * (NOTES.length - 1));
  let at = 0;
  NOTES.forEach((note, i) => {
    const length = lengths[i];
    for (let k = 0; k < length; k++) {
      // Linear ramps in and out keep the notes from clicking.
      const env = Math.min(1, (k + 1) / ramp, (length - k) / ramp);
      audio[at + k] = LEVEL * env * Math.sin((2 * Math.PI * note.hz * k) / sampleRate);
    }
    at += length + gap;
  });
  return { audio, sampleRate };
}
