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

  // Seconds here, as stored; each descriptor converts to the milliseconds its
  // client's timers take.
  it('carries the pause pair, including on the fallback path', () => {
    const opts = buildClientOptions({
      transport: 'websocket', segmentation: runtime, sourcePause: 0.8, translationPause: 2.5,
    });
    expect(opts.sourcePause).toBe(0.8);
    expect(opts.translationPause).toBe(2.5);
    const fallback = buildClientOptions({
      transport: 'websocket', segmentation: runtime, sourcePause: 0.8, translationPause: 2.5, legOptions: undefined,
    });
    expect(fallback.sourcePause).toBe(0.8);
    expect(fallback.translationPause).toBe(2.5);
  });

  /**
   * A2, recorded as the accepted behaviour rather than an aspiration: the
   * mode resolving to Off does not take the pause pair away.
   *
   * Off switches the punctuation STAGE off — a null runtime is exactly what
   * MainPanel hands a client then — and nothing here is gated on the mode.
   * The client's own silence timers keep running, because they are the only
   * thing that closes an item when speech stops; slice 4 removed the caps
   * that actually competed with By sentences (the clause and span caps). So
   * on the three providers that offer both, Off and By pause are the same
   * behaviour and differ only in whether the sliders are reachable.
   */
  it('carries the pause pair with no segmentation runtime — the shape Off produces', () => {
    const opts = buildClientOptions({
      transport: 'websocket', segmentation: null, sourcePause: 0.8, translationPause: 2.5,
    });
    expect(opts.segmentation).toBeNull();
    expect(opts.sourcePause).toBe(0.8);
    expect(opts.translationPause).toBe(2.5);
  });

  it('lets a legOptions field that collides with a builder-set field win — the managed Soniox bundle depends on this', () => {
    const opts = buildClientOptions({
      transport: 'websocket',
      segmentation: runtime,
      legOptions: { transport: 'webrtc' },
    });
    expect(opts.transport).toBe('webrtc');
  });
});
