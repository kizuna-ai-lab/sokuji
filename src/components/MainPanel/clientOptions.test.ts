import { describe, it, expect } from 'vitest';
import { buildClientOptions } from './clientOptions';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

const runtime: SegmentationRuntime = { enabled: true, async punctuate() { return null; } };

describe('buildClientOptions', () => {
  it('carries the segmentation runtime on every path', () => {
    expect(buildClientOptions({ transport: 'websocket', segmentation: runtime }).segmentation).toBe(runtime);
  });

  it('carries it even when there are no leg options — the WebRTC fallback path', () => {
    const opts = buildClientOptions({ transport: 'websocket', segmentation: runtime, legOptions: undefined });
    expect(opts.segmentation).toBe(runtime);
    expect(opts.transport).toBe('websocket');
  });

  it('keeps the managed Soniox bundle that leg options carry', () => {
    const sonioxManaged = { role: 'spk_stt' } as never;
    const opts = buildClientOptions({ transport: 'websocket', segmentation: runtime, legOptions: { sonioxManaged } });
    expect(opts.sonioxManaged).toBe(sonioxManaged);
    expect(opts.segmentation).toBe(runtime);
  });

  it('lets leg options override nothing they do not set', () => {
    const webrtcOptions = { inputDeviceId: 'mic-1' };
    const opts = buildClientOptions({ transport: 'webrtc', webrtcOptions, segmentation: runtime, legOptions: {} });
    expect(opts.webrtcOptions).toBe(webrtcOptions);
    expect(opts.segmentation).toBe(runtime);
  });

  it('carries the sentences-per-bubble setting, including on the fallback path', () => {
    expect(buildClientOptions({ transport: 'websocket', segmentation: runtime, sentencesPerChunk: 5 }).sentencesPerChunk).toBe(5);
    expect(buildClientOptions({ transport: 'websocket', segmentation: runtime, sentencesPerChunk: 1, legOptions: undefined }).sentencesPerChunk).toBe(1);
  });
});
