import { describe, it, expect, vi } from 'vitest';
import { silentSource } from './silent';

describe('silentSource', () => {
  it('never delivers audio, never ends on its own, and stops at once', async () => {
    const source = silentSource();
    const pcm = vi.fn();
    const ended = vi.fn();
    const off = source.onPcm(pcm);
    source.onEnded(ended);
    source.onDegraded(vi.fn());
    await source.stop();
    off();
    expect(pcm).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
  });
});
