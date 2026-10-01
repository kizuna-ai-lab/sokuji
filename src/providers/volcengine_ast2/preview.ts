/**
 * A Doubao voice's sample, for the settings view's audition (#577 catalog
 * §4): Volcengine's own clip for the target's persona, fetched from its CDN
 * and decoded. The voice library swallows a rejected preview, so a failure is
 * reported here, once; a preview the user stopped is no failure.
 */
import { describeCause, reportError } from '../../lib/diagnostics/report';
import { voicesFor } from './catalog';

export interface PreviewDeps {
  fetch: typeof fetch;
  decode(bytes: ArrayBuffer): Promise<AudioBuffer>;
}

const live: PreviewDeps = {
  fetch: (input, init) => fetch(input, init),
  decode: async (bytes) => {
    const ctx = new AudioContext();
    try {
      return await ctx.decodeAudioData(bytes);
    } finally {
      void ctx.close();
    }
  },
};

export async function previewVoice(id: string, target: string, signal?: AbortSignal, deps: PreviewDeps = live): Promise<{ audio: Float32Array; sampleRate: number } | null> {
  const voice = voicesFor(target).find((v) => v.id === id);
  if (!voice) return null;
  try {
    const response = await deps.fetch(voice.previewUrl, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await deps.decode(await response.arrayBuffer());
    // The first channel: Volcengine's samples are mono.
    return { audio: buffer.getChannelData(0).slice(), sampleRate: buffer.sampleRate };
  } catch (error) {
    if (signal?.aborted) return null;
    reportError('Ast2Preview', `Could not play the sample of ${voice.name}: ${describeCause(error)}`, { cause: error });
    return null;
  }
}
