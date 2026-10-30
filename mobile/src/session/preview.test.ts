import { describe, expect, it, vi } from 'vitest';
import { createVoicePreview, newPreviewShared, PreviewHttpError, type PreviewDeps, type PreviewState } from './preview';

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
  // A cache of the test's own: the app's is shared by every controller for the app's life.
  return { preview: createVoicePreview(deps, newPreviewShared()), deps, states, played };
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
    expect(deps.wait).toHaveBeenCalledWith(1500, expect.any(AbortSignal));
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

describe('the clip cache lives as long as the app, not the screen', () => {
  it('does not charge again when the Listen screen is left and opened again', async () => {
    const shared = newPreviewShared();
    const first = setup();
    const again = setup();
    const a = createVoicePreview(first.deps, shared);
    await a.play('Grace', sample, 1);
    // Leaving the screen ends its controller; coming back makes a new one.
    a.stop();
    const b = createVoicePreview(again.deps, shared);
    await b.play('Grace', sample, 1);
    expect(first.deps.mintKey).toHaveBeenCalledTimes(1);
    expect(again.deps.mintKey).not.toHaveBeenCalled();
    expect(b.state()).toEqual({ status: 'playing', voice: 'Grace' });
  });
});

describe('the preview log', () => {
  it('says a miss before the request and a clip only once it arrived, so a failed request is not read as a charge', async () => {
    const lines: string[] = [];
    const { deps } = setup({ log: (l: string) => lines.push(l) });
    const preview = createVoicePreview(deps, newPreviewShared());
    await preview.play('Grace', sample, 1);
    await preview.play('Grace', sample, 1);
    expect(lines).toEqual(['preview Grace ja 1: not cached, requesting', 'preview Grace ja 1: received', 'preview Grace ja 1: from cache']);

    const failed: string[] = [];
    const refused = setup({ log: (l: string) => failed.push(l), mintKey: vi.fn(async () => { throw new PreviewHttpError(402); }) });
    await createVoicePreview(refused.deps, newPreviewShared()).play('Grace', sample, 1);
    expect(failed).toEqual(['preview Grace ja 1: not cached, requesting', 'preview Grace ja 1: failed (balance)']);
  });
});

describe('a key the backend may have minted is always settled (Codex review, PR #665)', () => {
  it('lets a key request in flight finish when the preview is stopped, then settles it without synthesizing', async () => {
    let answer!: (g: { apiKey: string; region: 'us' }) => void;
    const mintKey = vi.fn(() => new Promise<{ apiKey: string; region: 'us' }>((resolve) => { answer = resolve; }));
    const { preview, deps, played } = setup({ mintKey });
    const running = preview.play('Grace', sample, 1);
    await vi.waitFor(() => expect(mintKey).toHaveBeenCalled());
    preview.stop();
    answer({ apiKey: 'k', region: 'us' });
    await running;
    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(deps.done).toHaveBeenCalledTimes(1);
    expect(played).toHaveLength(0);
    expect(preview.state()).toEqual({ status: 'idle' });
  });

  it('settles after a key request whose outcome is unknown (no answer, a dropped connection)', async () => {
    const { preview, deps } = setup({ mintKey: vi.fn(async () => { throw new Error('preview session-key timeout'); }) });
    await preview.play('Grace', sample, 1);
    expect(deps.done).toHaveBeenCalledTimes(1);
  });

  it('does not settle after a refusal: no key was minted', async () => {
    const { preview, deps } = setup({ mintKey: vi.fn(async () => { throw new PreviewHttpError(402); }) });
    await preview.play('Grace', sample, 1);
    expect(deps.done).not.toHaveBeenCalled();
  });
});

describe('one preview at a time across screens (Adolf)', () => {
  it('a preview on a new Listen screen waits for a key request the last screen left in flight', async () => {
    const shared = newPreviewShared();
    const order: string[] = [];
    let answer!: (g: { apiKey: string; region: 'us' }) => void;
    const left = setup({
      mintKey: vi.fn(() => { order.push('mint left'); return new Promise<{ apiKey: string; region: 'us' }>((r) => { answer = r; }); }),
      done: vi.fn(async () => { order.push('done left'); }),
    });
    const back = setup({
      mintKey: vi.fn(async () => { order.push('mint back'); return { apiKey: 'k', region: 'us' as const }; }),
      done: vi.fn(async () => { order.push('done back'); }),
    });
    const a = createVoicePreview(left.deps, shared);
    const first = a.play('Grace', sample, 1);
    await vi.waitFor(() => expect(order).toEqual(['mint left']));
    a.stop(); // the screen is left with the key request still out
    const b = createVoicePreview(back.deps, shared);
    const second = b.play('Adrian', sample, 1);
    await Promise.resolve();
    expect(order).toEqual(['mint left']);
    answer({ apiKey: 'k', region: 'us' });
    await Promise.all([first, second]);
    expect(order).toEqual(['mint left', 'done left', 'mint back', 'done back']);
  });
});

describe('CodeRabbit review, PR #665', () => {
  it('a stop during the wait after "busy" ends the wait at once and asks for no key', async () => {
    const mintKey = vi.fn().mockRejectedValueOnce(new PreviewHttpError(409, 3000));
    const wait = vi.fn((_ms: number, signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())));
    const { preview, deps } = setup({ mintKey, wait });
    const running = preview.play('Grace', sample, 1);
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    preview.stop();
    await running;
    expect(mintKey).toHaveBeenCalledTimes(1);
    expect(deps.done).not.toHaveBeenCalled();
  });

  it('a preview-done that failed is tried again before the next key is asked for', async () => {
    const order: string[] = [];
    const done = vi.fn()
      .mockImplementationOnce(async () => { order.push('done (fails)'); throw new Error('network'); })
      .mockImplementation(async () => { order.push('done'); });
    const mintKey = vi.fn(async () => { order.push('mint'); return { apiKey: 'k', region: 'us' as const }; });
    const { preview } = setup({ done, mintKey });
    await preview.play('Grace', sample, 1);
    await preview.play('Adrian', sample, 1);
    expect(order).toEqual(['mint', 'done (fails)', 'done', 'mint', 'done']);
  });
});

describe('the cache is checked again after waiting (Adolf)', () => {
  it('a same preview queued behind one still settling plays its clip instead of asking again', async () => {
    const shared = newPreviewShared();
    let settled!: () => void;
    const left = setup({ done: vi.fn(() => new Promise<void>((r) => { settled = r; })) });
    const back = setup();
    const a = createVoicePreview(left.deps, shared);
    const first = a.play('Grace', sample, 1);
    await vi.waitFor(() => expect(left.deps.done).toHaveBeenCalled()); // the clip is in; done is out
    a.stop(); // the screen is left
    const b = createVoicePreview(back.deps, shared);
    const second = b.play('Grace', sample, 1);
    settled();
    await Promise.all([first, second]);
    expect(left.deps.mintKey).toHaveBeenCalledTimes(1);
    expect(back.deps.mintKey).not.toHaveBeenCalled();
    expect(back.deps.synthesize).not.toHaveBeenCalled();
    expect(b.state()).toEqual({ status: 'playing', voice: 'Grace' });
  });
});

describe('a stop while re-settling a failed preview-done (Adolf)', () => {
  it('asks for no new key once the settle comes back', async () => {
    let settleAgain!: () => void;
    const done = vi.fn()
      .mockImplementationOnce(async () => { throw new Error('network'); })
      .mockImplementationOnce(() => new Promise<void>((r) => { settleAgain = r; }));
    const { preview, deps } = setup({ done });
    await preview.play('Grace', sample, 1); // its done fails: unsettled
    const second = preview.play('Adrian', sample, 1);
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(2)); // re-settling
    preview.stop();
    settleAgain();
    await second;
    expect(deps.mintKey).toHaveBeenCalledTimes(1);
  });
});
