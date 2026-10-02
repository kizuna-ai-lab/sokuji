/**
 * A preset voice's audition from a sample the vendor publishes (OpenAI's
 * voice previews), or from bytes a provider synthesized (Gemini): decoded
 * to mono samples for the voice library's preview route. The voice library
 * swallows a rejected preview, so a failure is reported here, once; a
 * preview the user stopped is no failure.
 */
import { describeCause, reportError } from '../diagnostics/report';

export interface PreviewAudio { audio: Float32Array; sampleRate: number }

export interface ClipDeps {
  fetch: typeof fetch;
  decode(bytes: ArrayBuffer): Promise<PreviewAudio>;
}

/**
 * Any container the browser decodes (WAV, FLAC, MP3), first channel only:
 * the vendors' samples are mono. An offline context, so nothing opens the
 * audio device; it resamples to its own rate, which it reports.
 */
export async function decodeClip(bytes: ArrayBuffer): Promise<PreviewAudio> {
  const buffer = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes);
  return { audio: buffer.getChannelData(0).slice(), sampleRate: buffer.sampleRate };
}

export const liveClipDeps: ClipDeps = {
  fetch: (input, init) => fetch(input, init),
  decode: decodeClip,
};

export interface Clip {
  url: string;
  /** The voice's name, for the report. */
  name: string;
  /** The report's source: the provider's preview. */
  scope: string;
}

export async function previewClip(clip: Clip, signal?: AbortSignal, deps: ClipDeps = liveClipDeps): Promise<PreviewAudio | null> {
  try {
    const response = await deps.fetch(clip.url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await deps.decode(await response.arrayBuffer());
  } catch (error) {
    if (signal?.aborted) return null;
    reportError(clip.scope, `Could not play the sample of ${clip.name}: ${describeCause(error)}`, { cause: error });
    return null;
  }
}
