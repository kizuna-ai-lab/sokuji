import type { ClientOptions } from '../../services/providers/ProviderDescriptor';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

/**
 * Build the options one client is created with.
 *
 * Extracted as a pure function because this repo has no React rendering
 * harness for MainPanel — the same constraint that produced
 * sessionModelTelemetry.ts — so this is the only way the shipped decision is
 * the tested one.
 *
 * `segmentation` is set here rather than by the callers that pass legOptions,
 * because two paths bypass those callers: the WebRTC-to-WebSocket fallback
 * calls createAIClient(false) with nothing, and a participant on a secondary
 * port never reaches createAIClient at all.
 */
export function buildClientOptions(input: {
  transport: ClientOptions['transport'];
  webrtcOptions?: ClientOptions['webrtcOptions'];
  segmentation?: SegmentationRuntime | null;
  sentencesPerChunk?: number;
  legOptions?: Partial<ClientOptions>;
}): ClientOptions {
  return {
    transport: input.transport,
    webrtcOptions: input.webrtcOptions,
    segmentation: input.segmentation,
    sentencesPerChunk: input.sentencesPerChunk,
    ...input.legOptions,
  };
}
