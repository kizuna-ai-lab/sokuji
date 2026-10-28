import { describe, expect, it, vi } from 'vitest';
import { createVoicePreview, PreviewHttpError, type PreviewDeps, type PreviewState } from './preview';

const sample = { language: 'ja', text: 'こんにちは' };

function setup(over: Partial<PreviewDeps> = {}) {
  const states: PreviewState[] = [];
  const played: Array<{ pcm: Int16Array; end: () => void; stopped: boolean }> = [];
  const deps: PreviewDeps = {
    mintKey: vi.fn(async () => ({ apiKey: 'k', region: 'us' as const })),
    done: vi.fn(async () => {}),
    synthesize: vi.fn(async () => new Int16Array([1, 2, 3])),
    play: (pcm, onEnded) => {
      const p = { pcm, end: onEnded, stopped: false };
      played.push(p);
      return () => { p.stopped = true; };
    },
    wait: vi.fn(async () => {}),
    onChange: (s) => states.push(s),
    ...over,
  };
  return { preview: createVoicePreview(deps), deps, states, played };
}

describe('a voice preview', () => {
  it('asks for a key, synthesizes, always says it is done, then plays until the clip ends', async () => {
    const { preview, deps, states, played } = setup();
    await preview.play('Grace', sample, 1);
    expect(deps.synthesize).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'k', region: 'us', voice: 'Grace', language: 'ja', text: 'こんにちは', speed: 1 }));
    expect(deps.done).toHaveBeenCalledTimes(1);
    expect(states.map((s) => s.status)).toEqual(['requesting', 'playing']);
    played[0].end();
    expect(preview.state()).toEqual({ status: 'idle' });
  });

  it('plays the same voice, language, speed and text again from the cache, without a charge', async () => {
    const { preview, deps } = setup();
    await preview.play('Grace', sample, 1);
    await preview.play('Grace', sample, 1);
    expect(deps.mintKey).toHaveBeenCalledTimes(1);
    await preview.play('Grace', sample, 1.2);
    await preview.play('Grace', { language: 'en', text: 'Hello' }, 1);
    expect(deps.mintKey).toHaveBeenCalledTimes(3);
  });

  it('still says it is done when synthesis fails, so the account is not held', async () => {
    const { preview, deps } = setup({ synthesize: vi.fn(async () => { throw new PreviewHttpError(503); }) });
    await preview.play('Grace', sample, 1);
    expect(deps.done).toHaveBeenCalledTimes(1);
    expect(preview.state()).toEqual({ status: 'failed', voice: 'Grace', reason: 'capacity' });
  });

  it('waits once and retries when the account is briefly busy', async () => {
    const mintKey = vi.fn()
      .mockRejectedValueOnce(new PreviewHttpError(409, 1500))
      .mockResolvedValueOnce({ apiKey: 'k', region: 'us' });
    const { preview, deps } = setup({ mintKey });
    await preview.play('Grace', sample, 1);
    expect(deps.wait).toHaveBeenCalledWith(1500);
    expect(preview.state().status).toBe('playing');
  });

  it('names why it failed: no balance, a session running, too many, no answer', async () => {
    const reasons: Array<[unknown, string]> = [
      [new PreviewHttpError(402), 'balance'],
      [new PreviewHttpError(409, 3000), 'busy'],
      [new PreviewHttpError(429), 'rate'],
      [new PreviewHttpError(401), 'sign_in'],
      [new Error('preview timeout'), 'timeout'],
      [new Error('network'), 'failed'],
    ];
    for (const [err, reason] of reasons) {
      const { preview } = setup({ mintKey: vi.fn(async () => { throw err; }) });
      await preview.play('Grace', sample, 1);
      expect(preview.state(), String(reason)).toEqual({ status: 'failed', voice: 'Grace', reason });
    }
  });

  it('stops what is playing, and a new preview replaces the one before', async () => {
    const { preview, played } = setup();
    await preview.play('Grace', sample, 1);
    await preview.play('Adrian', sample, 1);
    expect(played[0].stopped).toBe(true);
    expect(preview.state()).toEqual({ status: 'playing', voice: 'Adrian' });
    preview.stop();
    expect(played[1].stopped).toBe(true);
    expect(preview.state()).toEqual({ status: 'idle' });
  });

  it('plays nothing it was stopped before: a stop while requesting cancels and still settles the key', async () => {
    let release!: () => void;
    const synthesize = vi.fn((o: { signal: AbortSignal }) => new Promise<Int16Array>((resolve, reject) => {
      o.signal.addEventListener('abort', () => reject(new Error('aborted')));
      release = () => resolve(new Int16Array([1]));
    }));
    const { preview, deps, played } = setup({ synthesize });
    const running = preview.play('Grace', sample, 1);
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalled());
    preview.stop();
    await running;
    void release;
    expect(played).toHaveLength(0);
    expect(deps.done).toHaveBeenCalledTimes(1);
    expect(preview.state()).toEqual({ status: 'idle' });
  });
});

describe('one preview at a time at the backend', () => {
  it('asks for the next key only after the previous preview has said it is done', async () => {
    const order: string[] = [];
    let release!: () => void;
    const synthesize = vi.fn((o: { signal: AbortSignal; voice: string }) => {
      order.push(`synth ${o.voice}`);
      if (o.voice === 'Grace') {
        return new Promise<Int16Array>((_, reject) => {
          o.signal.addEventListener('abort', () => { release = () => reject(new Error('aborted')); });
        });
      }
      return Promise.resolve(new Int16Array([1]));
    });
    const { preview } = setup({
      synthesize,
      mintKey: vi.fn(async () => { order.push('mint'); return { apiKey: 'k', region: 'us' as const }; }),
      done: vi.fn(async () => { order.push('done'); }),
    });
    const first = preview.play('Grace', sample, 1);
    await vi.waitFor(() => expect(order).toContain('synth Grace'));
    const second = preview.play('Adrian', sample, 1);
    await Promise.resolve();
    expect(order).toEqual(['mint', 'synth Grace']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['mint', 'synth Grace', 'done', 'mint', 'synth Adrian', 'done']);
  });
});

describe('when the phone cannot play the clip', () => {
  it('says the preview failed instead of staying on "playing"', async () => {
    const { preview } = setup({ play: () => { throw new Error('audio session'); } });
    await preview.play('Grace', sample, 1);
    expect(preview.state()).toEqual({ status: 'failed', voice: 'Grace', reason: 'failed' });
  });
});
