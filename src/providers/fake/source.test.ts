import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { createFakeSource } from './source';

describe('createFakeSource', () => {
  it('delivers a chunk every chunkMs: silence until voiced, a tone after', () => {
    const clock = createVirtualClock();
    const source = createFakeSource(clock, { chunkMs: 100 });
    const chunks: Int16Array[] = [];
    source.onPcm((pcm) => chunks.push(pcm));
    clock.advance(200);
    source.setVoiced(true);
    clock.advance(100);
    expect(chunks.map((c) => c.length)).toEqual([2400, 2400, 2400]);
    expect(chunks[0].every((v) => v === 0)).toBe(true);
    expect(chunks[2].some((v) => v !== 0)).toBe(true);
  });

  it('stops delivering once stopped', async () => {
    const clock = createVirtualClock();
    const source = createFakeSource(clock);
    let n = 0;
    source.onPcm(() => { n++; });
    await source.stop();
    clock.advance(1000);
    expect(n).toBe(0);
    expect(source.stopped).toBe(true);
  });

  it('reports an end once, and a degradation, to their listeners', () => {
    const clock = createVirtualClock();
    const source = createFakeSource(clock);
    const ends: string[] = [];
    const warnings: string[] = [];
    source.onEnded((r) => ends.push(r));
    source.onDegraded(({ message }) => warnings.push(message));
    source.degrade('fell back to system audio');
    source.end('unplugged');
    source.end('again');
    expect(ends).toEqual(['unplugged']);
    expect(warnings).toEqual(['fell back to system audio']);
    expect(source.stopped).toBe(true);
  });

  it('forgets a listener that unsubscribed', () => {
    const clock = createVirtualClock();
    const source = createFakeSource(clock);
    let n = 0;
    const off = source.onPcm(() => { n++; });
    clock.advance(100);
    off();
    clock.advance(300);
    expect(n).toBe(1);
  });
});

describe('createFakeSource — degradation', () => {
  it('hands its listeners a code and a message', () => {
    const source = createFakeSource(createVirtualClock(0));
    const heard: Array<{ code: string; message: string }> = [];
    source.onDegraded((notice) => { heard.push(notice); });
    source.degrade('fell back');
    source.degrade('no audio yet', 'silent_no_permission');
    expect(heard).toEqual([
      { code: 'source_degraded', message: 'fell back' },
      { code: 'silent_no_permission', message: 'no audio yet' },
    ]);
  });
});
