/**
 * The test tone (spec routing: a fixed route to the real device). Today
 * MainPanel decodes it and sends it through the whole pipeline, the virtual
 * microphone included; here it is one preview clip.
 */
import type { PreviewClip } from './playback';

/** The bundled asset; the extension serves it from its own origin. */
export function testToneUrl(): string {
  const runtime = (globalThis as unknown as { chrome?: { runtime?: { getURL?(path: string): string } } }).chrome?.runtime;
  return runtime?.getURL ? runtime.getURL('assets/test-tone.mp3') : '/assets/test-tone.mp3';
}

/** Decodes the tone to one channel at its own rate, 10% under full scale as today. */
export async function loadTestTone(
  context: BaseAudioContext,
  fetchImpl: typeof fetch = fetch,
  url: string = testToneUrl(),
): Promise<PreviewClip> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`The test tone did not load: HTTP ${response.status}`);
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  const audio = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < buffer.length; i++) audio[i] += channel[i] / buffer.numberOfChannels;
  }
  for (let i = 0; i < audio.length; i++) audio[i] *= 0.9;
  return { audio, sampleRate: buffer.sampleRate };
}
