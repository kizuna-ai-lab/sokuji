/**
 * An Edge voice's sample, for the line-up page's speech card: the language's
 * preview sentence (`previewSampleFor`) in that voice, synthesized over the
 * same connection a session uses and decoded for the page's preview route.
 * A failure is reported here, once; a preview the user stopped is no failure.
 */
import type { PreviewClip } from '../audio/playback';
import { describeCause, reportError } from '../diagnostics/report';
import { previewSampleFor } from '../tts/previewSample';
import { EdgeTtsConnection } from './EdgeTtsConnection';

export interface EdgePreviewDeps {
  /** The sentence in the voice, as one MP3. */
  synthesize(text: string, voice: string, signal?: AbortSignal): Promise<Uint8Array>;
  decode(bytes: Uint8Array): Promise<AudioBuffer>;
}

const live: EdgePreviewDeps = {
  synthesize: (text, voice, signal) => new Promise<Uint8Array>((resolve, reject) => {
    const connection = new EdgeTtsConnection();
    const chunks: Uint8Array[] = [];
    const end = () => connection.dispose();
    signal?.addEventListener('abort', () => { end(); reject(new Error('stopped')); }, { once: true });
    connection.generate(
      { text, voice },
      (chunk) => { chunks.push(new Uint8Array(chunk)); },
      () => {
        end();
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
        let at = 0;
        for (const c of chunks) { all.set(c, at); at += c.byteLength; }
        resolve(all);
      },
      (error) => { end(); reject(new Error(error)); },
    ).catch((error: unknown) => { end(); reject(error); });
  }),
  decode: async (bytes) => {
    const ctx = new AudioContext();
    try {
      return await ctx.decodeAudioData(bytes.slice().buffer);
    } finally {
      void ctx.close();
    }
  },
};

export async function previewEdgeVoice(voice: string, language: string, signal?: AbortSignal, deps: EdgePreviewDeps = live): Promise<PreviewClip | null> {
  try {
    const mp3 = await deps.synthesize(previewSampleFor(language).text, voice, signal);
    const buffer = await deps.decode(mp3);
    // The first channel: Edge's audio is mono.
    return { audio: buffer.getChannelData(0).slice(), sampleRate: buffer.sampleRate };
  } catch (error) {
    if (signal?.aborted) return null;
    reportError('EdgeTTS', `Could not play the sample of ${voice}: ${describeCause(error)}`, { cause: error });
    return null;
  }
}
