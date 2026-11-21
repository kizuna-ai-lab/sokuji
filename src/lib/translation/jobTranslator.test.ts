import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import type { TranslationEvents, TranslationSession } from '../contract/translation';
import { checkTranslation, recordTranslation, type TranslationLog } from '../contract/translationConformance';
import { CLOSE_TIMEOUT_MS, CONTEXT_PAIRS, createJobTranslator, JOB_TIMEOUT_MS, type JobContext, type JobTranslatorOptions } from './jobTranslator';

/** Lets every settled promise run its reactions. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Asked { text: string; signal: AbortSignal; context: JobContext; answer(text: string): void; fail(error: unknown): void }

/**
 * A job translator over a `translate` the test answers by hand, recorded as the rule suite reads it.
 * `said()` lists the events as short words: `open 1 u1`, `text 1 …`, `close 1`, `degraded <code>`, `failed`.
 */
function translator(over: Partial<JobTranslatorOptions> = {}) {
  const asked: Asked[] = [];
  const clock = createVirtualClock(0);
  const log: TranslationLog = [{ kind: 'start' }];
  /** What a listener does once it has heard an event (it is recorded first): a test's fault. */
  const listener: { on?: (kind: string, payload: unknown) => void } = {};
  const heard = <K extends keyof TranslationEvents>(kind: K) => ((payload: Parameters<TranslationEvents[K]>[0]) => {
    log.push({ kind, payload } as TranslationLog[number]);
    listener.on?.(kind, payload);
  }) as TranslationEvents[K];
  const told: TranslationEvents = {
    translationOpened: heard('translationOpened'),
    translationText: heard('translationText'),
    translationClosed: heard('translationClosed'),
    failed: heard('failed'),
    degraded: heard('degraded'),
    loading: heard('loading'),
    frame: heard('frame'),
  };
  const run = new AbortController();
  const inner = createJobTranslator({
    translate: (text, signal, context) => new Promise<string>((resolve, reject) => { asked.push({ text, signal, context, answer: resolve, fail: reject }); }),
    events: told,
    clock,
    signal: run.signal,
    ...over,
  });
  const session: TranslationSession & { held: typeof inner.held } = {
    held: () => inner.held(),
    open: () => { log.push({ kind: 'open' }); return inner.open(); },
    source: (snapshot) => { log.push({ kind: 'source', snapshot }); inner.source(snapshot); },
    stop: () => {
      log.push({ kind: 'stop' });
      const stopping = inner.stop();
      const settled = () => { log.push({ kind: 'stopped' }); };
      stopping.then(settled, settled);
      return stopping;
    },
  };
  const said = () => log.flatMap((e): string[] => {
    switch (e.kind) {
      case 'translationOpened': return [`open ${e.payload.ref} ${e.payload.origin}`];
      case 'translationText': return [`text ${e.payload.ref} ${e.payload.text}`];
      case 'translationClosed': return [`close ${e.payload.ref}`];
      case 'degraded': return [`degraded ${e.payload.code}`];
      case 'failed': return ['failed'];
      default: return [];
    }
  });
  const closing = (origin: string, text: string) => session.source({ origin, text, stableLen: text.length, closed: true });
  return { session, asked, log, said, closing, clock, listener, run };
}

describe('the job translator: jobs', () => {
  it('sends a closed source as one job, and its answer is one segment: opened with the origin, said whole and stable, closed', async () => {
    const h = translator();
    h.closing('u1', 'Hello there.');
    expect(h.asked.map((a) => a.text)).toEqual(['Hello there.']);
    expect(h.said()).toEqual([]);
    h.asked[0].answer('こんにちは。');
    await flush();
    expect(h.log.slice(2)).toEqual([
      { kind: 'translationOpened', payload: { ref: 1, origin: 'u1' } },
      { kind: 'translationText', payload: { ref: 1, text: 'こんにちは。', stableLen: 6 } },
      { kind: 'translationClosed', payload: { ref: 1 } },
    ]);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('states the language of its answers when it is told one', async () => {
    const h = translator({ language: 'ja' });
    h.closing('u1', 'Hello.');
    h.asked[0].answer('やあ。');
    await flush();
    expect(h.log).toContainEqual({ kind: 'translationText', payload: { ref: 1, text: 'やあ。', stableLen: 3, language: 'ja' } });
  });

  it('sends the sentences of the stable start while the source is open and the rest at its close: several segments for one origin', async () => {
    const h = translator();
    h.session.source({ origin: 'u1', text: 'One. Tw', stableLen: 3, closed: false });
    expect(h.asked).toEqual([]);
    h.session.source({ origin: 'u1', text: 'One. Two', stableLen: 8, closed: false });
    expect(h.asked.map((a) => a.text)).toEqual(['One.']);
    h.asked[0].answer('いち。');
    await flush();
    h.closing('u1', 'One. Two.');
    expect(h.asked.map((a) => a.text)).toEqual(['One.', 'Two.']);
    h.asked[1].answer('に。');
    await flush();
    expect(h.said()).toEqual(['open 1 u1', 'text 1 いち。', 'close 1', 'open 2 u1', 'text 2 に。', 'close 2']);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('runs one job at a time, in the order the stretches came, across origins', async () => {
    const h = translator();
    h.closing('u1', 'First.');
    h.closing('u2', 'Second.');
    h.closing('u3', 'Third.');
    // Only the first is asked: the next waits for its answer.
    expect(h.asked.map((a) => a.text)).toEqual(['First.']);
    h.asked[0].answer('1');
    await flush();
    expect(h.asked.map((a) => a.text)).toEqual(['First.', 'Second.']);
    h.asked[1].answer('2');
    await flush();
    h.asked[2].answer('3');
    await flush();
    expect(h.said()).toEqual(['open 1 u1', 'text 1 1', 'close 1', 'open 2 u2', 'text 2 2', 'close 2', 'open 3 u3', 'text 3 3', 'close 3']);
  });

  it('keeps each origin its own cut while their snapshots interleave', async () => {
    const h = translator();
    h.session.source({ origin: 'a', text: 'One. Two', stableLen: 8, closed: false });
    h.session.source({ origin: 'b', text: 'Uno. Dos', stableLen: 8, closed: false });
    h.closing('a', 'One. Two.');
    h.closing('b', 'Uno. Dos.');
    for (let k = 0; k < 4; k++) {
      h.asked[k].answer(`t${k}`);
      await flush();
    }
    expect(h.asked.map((a) => a.text)).toEqual(['One.', 'Uno.', 'Two.', 'Dos.']);
    expect(h.said().filter((s) => s.startsWith('open'))).toEqual(['open 1 a', 'open 2 b', 'open 3 a', 'open 4 b']);
  });

  it('sends nothing for a source with no letter or digit, and nothing twice for an origin that closed', () => {
    const h = translator();
    h.closing('u1', ' … ');
    h.closing('u2', 'Once.');
    h.closing('u2', 'Once. Twice.');
    h.session.source({ origin: 'u2', text: 'Once. Twice. Thrice', stableLen: 19, closed: false });
    expect(h.asked.map((a) => a.text)).toEqual(['Once.']);
  });

  it('owes a source with no letter or digit nothing, by the rule suite as by the cutter', async () => {
    const h = translator();
    h.closing('u1', ' … ');
    await flush();
    expect(h.said()).toEqual([]);
    expect(checkTranslation(h.log)).toEqual([]);
  });
});

describe('the job translator: a job that fails', () => {
  it('says translation_failed with the cause, opens no segment, and runs the next job', async () => {
    const h = translator();
    h.closing('u1', 'First.');
    h.closing('u2', 'Second.');
    const cause = new Error('The service answered 500.');
    h.asked[0].fail(cause);
    await flush();
    expect(h.log.filter((e) => e.kind === 'degraded')).toEqual([{ kind: 'degraded', payload: { code: 'translation_failed', message: 'The service answered 500.', cause } }]);
    h.asked[1].answer('に。');
    await flush();
    expect(h.said()).toEqual(['degraded translation_failed', 'open 1 u2', 'text 1 に。', 'close 1']);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('words the failure as it is told to', async () => {
    const h = translator({ failureMessage: () => 'The translator is temporarily unavailable.' });
    h.closing('u1', 'First.');
    h.asked[0].fail(new Error('[x:network] ECONNRESET'));
    await flush();
    expect(h.log.find((e) => e.kind === 'degraded')).toMatchObject({ payload: { message: 'The translator is temporarily unavailable.' } });
  });

  it('treats a blank answer as a job that failed: the row keeps its source and the user is told', async () => {
    const h = translator();
    h.closing('u1', 'First.');
    h.asked[0].answer('  ');
    await flush();
    expect(h.said()).toEqual(['degraded translation_failed']);
    expect(h.log.find((e) => e.kind === 'degraded')).toMatchObject({ payload: { reason: 'translation_empty' } });
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a failure that is the end of the unit says failed, once, and nothing follows: what waits is dropped', async () => {
    const lost = new Error('The device was lost.');
    const h = translator({ fatal: (error) => error === lost });
    h.closing('u1', 'First.');
    h.closing('u2', 'Second.');
    h.asked[0].fail(lost);
    await flush();
    h.closing('u3', 'Third.');
    await flush();
    expect(h.log.filter((e) => e.kind === 'failed')).toEqual([{ kind: 'failed', payload: { message: 'The device was lost.', cause: lost } }]);
    expect(h.said()).toEqual(['failed']);
    expect(h.asked).toHaveLength(1);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a listener that throws costs that job only: its segment still closes, the Logs say so, and the next job runs', async () => {
    const h = translator();
    const events = h.log;
    let thrown = false;
    const push = events.push.bind(events);
    // The first translation's text is refused by whoever listens.
    events.push = (...entries) => {
      const [entry] = entries;
      if (!thrown && entry.kind === 'translationText') {
        thrown = true;
        throw new Error('listener');
      }
      return push(...entries);
    };
    h.closing('u1', 'First.');
    h.closing('u2', 'Second.');
    h.asked[0].answer('いち。');
    await flush();
    h.asked[1].answer('に。');
    await flush();
    expect(h.said()).toEqual(['open 1 u1', 'close 1', 'open 2 u2', 'text 2 に。', 'close 2']);
    expect(h.log.filter((e) => e.kind === 'frame')).toEqual([{ kind: 'frame', payload: { direction: 'in', type: 'translation.job_error', payload: { error: 'listener' } } }]);
  });
});

describe('the job translator: a listener that throws, or stops the session', () => {
  it('a listener that throws as a segment opens costs that job only: the segment is closed, and the next job runs', async () => {
    const h = translator();
    let thrown = false;
    // It has the ref, then throws.
    h.listener.on = (kind) => {
      if (thrown || kind !== 'translationOpened') return;
      thrown = true;
      throw new Error('listener');
    };
    h.closing('u1', 'First.');
    h.closing('u2', 'Second.');
    h.asked[0].answer('いち。');
    await flush();
    h.asked[1].answer('に。');
    await flush();
    expect(h.said()).toEqual(['open 1 u1', 'close 1', 'open 2 u2', 'text 2 に。', 'close 2']);
    expect(h.log.filter((e) => e.kind === 'frame').map((e) => (e.payload as { type: string }).type)).toEqual(['translation.job_error']);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a listener that stops the session as a segment opens hears no text and no close of it', async () => {
    const h = translator();
    h.listener.on = (kind) => { if (kind === 'translationOpened') void h.session.stop(); };
    h.closing('u1', 'First.');
    h.asked[0].answer('いち。');
    await flush();
    expect(h.said()).toEqual(['open 1 u1']);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a listener that stops the session at a segment\'s text hears no close of it', async () => {
    const h = translator();
    h.listener.on = (kind) => { if (kind === 'translationText') void h.session.stop(); };
    h.closing('u1', 'First.');
    h.asked[0].answer('いち。');
    await flush();
    expect(h.said()).toEqual(['open 1 u1', 'text 1 いち。']);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a listener that throws at the Logs\' word of a failed job does not hold the queue: the next job runs', async () => {
    const h = translator();
    h.listener.on = (kind) => { if (kind === 'frame' || (kind === 'translationText' && h.asked.length === 1)) throw new Error('listener'); };
    h.closing('u1', 'First.');
    h.closing('u2', 'Second.');
    h.asked[0].answer('いち。');
    await flush();
    expect(h.asked.map((a) => a.text)).toEqual(['First.', 'Second.']);
    h.asked[1].answer('に。');
    await flush();
    expect(h.said()).toEqual(['open 1 u1', 'text 1 いち。', 'close 1', 'open 2 u2', 'text 2 に。', 'close 2']);
  });

  it('a listener that throws at the Logs\' word of a close that failed does not keep failed from being said', async () => {
    const h = translator({ fatal: () => true, close: () => Promise.reject(new Error('worker stuck')) });
    h.listener.on = (kind) => { if (kind === 'frame') throw new Error('listener'); };
    h.closing('u1', 'First.');
    h.asked[0].fail(new Error('gone'));
    await flush();
    expect(h.said()).toEqual(['failed']);
  });
});

describe('the job translator: opening and stopping', () => {
  it('opens at once when it is given nothing to open, and with what it is given otherwise', async () => {
    await expect(translator().session.open()).resolves.toBeUndefined();
    const refused = new Error('no model');
    await expect(translator({ open: () => Promise.reject(refused) }).session.open()).rejects.toBe(refused);
  });

  it('an open is handed the run\'s signal, and rejects when the run is cancelled before it or while it loads', async () => {
    const before = translator({ open: () => Promise.resolve() });
    before.run.abort(new Error('cancelled'));
    await expect(before.session.open()).rejects.toThrow('cancelled');
    // With nothing to open, too.
    const bare = translator();
    bare.run.abort(new Error('cancelled'));
    await expect(bare.session.open()).rejects.toThrow('cancelled');

    let handed: AbortSignal | undefined;
    const during = translator({ open: (signal) => { handed = signal; return new Promise<void>(() => {}); } });
    const opening = during.session.open();
    expect(handed).toBe(during.run.signal);
    during.run.abort(new Error('cancelled'));
    await expect(opening).rejects.toThrow('cancelled');
  });

  it('a stop that a job\'s abort asks for joins the stop that aborted it: what it lets go is let go once', async () => {
    let closes = 0;
    let nested: Promise<void> | undefined;
    const sessions: TranslationSession[] = [];
    const h = translator({
      close: () => { closes += 1; },
      translate: (_text, signal) => new Promise<string>(() => { signal.addEventListener('abort', () => { nested = sessions[0].stop(); }); }),
    });
    sessions.push(h.session);
    h.closing('u1', 'First.');
    const stopping = h.session.stop();
    expect(closes).toBe(1);
    await Promise.all([stopping, nested]);
    expect(closes).toBe(1);
  });

  it('every stop settles as the first did, when what it lets go rejects', async () => {
    const stuck = new Error('worker stuck');
    const h = translator({ close: () => Promise.reject(stuck) });
    await expect(h.session.stop()).rejects.toBe(stuck);
    await expect(h.session.stop()).rejects.toBe(stuck);
  });

  it('a stop in the middle of a job aborts it, and nothing is said of its answer or of what waited', async () => {
    const h = translator();
    h.closing('u1', 'First.');
    h.closing('u2', 'Second.');
    const stopping = h.session.stop();
    expect(h.asked[0].signal.aborted).toBe(true);
    await stopping;
    h.asked[0].answer('いち。');
    await flush();
    expect(h.said()).toEqual([]);
    expect(h.asked).toHaveLength(1);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a job that rejects because it was stopped is not a failure', async () => {
    const h = translator();
    h.closing('u1', 'First.');
    await h.session.stop();
    h.asked[0].fail(new Error('aborted'));
    await flush();
    expect(h.said()).toEqual([]);
  });

  it('takes no source once stopped', async () => {
    const h = translator();
    await h.session.stop();
    h.closing('u1', 'First.');
    expect(h.asked).toEqual([]);
  });

  it('runs what it is given to close, once, on the stop or on the failure that ends it', async () => {
    let closes = 0;
    const h = translator({ close: () => { closes += 1; } });
    await h.session.stop();
    await h.session.stop();
    expect(closes).toBe(1);

    let ended = 0;
    const dying = translator({ close: () => { ended += 1; }, fatal: () => true });
    dying.closing('u1', 'First.');
    dying.asked[0].fail(new Error('gone'));
    await flush();
    await dying.session.stop();
    expect(ended).toBe(1);
  });
});

describe('the job translator: a job that does not come back', () => {
  it('gives a job twenty seconds by default', () => {
    expect(JOB_TIMEOUT_MS).toBe(20_000);
  });

  it('a job that never settles is aborted at its deadline, said as translation_failed with its own reason, and the next job runs', async () => {
    const h = translator();
    h.closing('u1', 'First.');
    h.closing('u2', 'Second.');
    h.clock.advance(JOB_TIMEOUT_MS - 1);
    await flush();
    expect(h.said()).toEqual([]);
    expect(h.asked[0].signal.aborted).toBe(false);
    h.clock.advance(1);
    await flush();
    expect(h.asked[0].signal.aborted).toBe(true);
    expect(h.log.filter((e) => e.kind === 'degraded')).toEqual([{ kind: 'degraded', payload: { code: 'translation_failed', message: 'The translation did not come back in time.', reason: 'translation_timeout' } }]);
    expect(h.asked.map((a) => a.text)).toEqual(['First.', 'Second.']);
    // The next job has a signal and a deadline of its own.
    expect(h.asked[1].signal.aborted).toBe(false);
    h.asked[1].answer('に。');
    await flush();
    expect(h.said()).toEqual(['degraded translation_failed', 'open 1 u2', 'text 1 に。', 'close 1']);
    expect(h.clock.pending()).toBe(0);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('an answer or a rejection that comes after the deadline is ignored: no segment, no second notice', async () => {
    const h = translator({ timeoutMs: 500 });
    h.closing('u1', 'First.');
    h.closing('u2', 'Second.');
    h.clock.advance(500);
    await flush();
    h.asked[0].answer('late');
    await flush();
    h.asked[1].answer('に。');
    await flush();
    expect(h.said()).toEqual(['degraded translation_failed', 'open 1 u2', 'text 1 に。', 'close 1']);

    const failing = translator({ timeoutMs: 500 });
    failing.closing('u1', 'First.');
    failing.clock.advance(500);
    await flush();
    failing.asked[0].fail(new Error('aborted'));
    await flush();
    expect(failing.said()).toEqual(['degraded translation_failed']);
  });

  it('a job answered in time leaves no deadline armed, and neither does a stop', async () => {
    const h = translator();
    h.closing('u1', 'First.');
    expect(h.clock.pending()).toBe(1);
    h.asked[0].answer('いち。');
    await flush();
    expect(h.clock.pending()).toBe(0);
    h.closing('u2', 'Second.');
    await h.session.stop();
    expect(h.clock.pending()).toBe(0);
    h.clock.advance(JOB_TIMEOUT_MS);
    await flush();
    expect(h.said()).toEqual(['open 1 u1', 'text 1 いち。', 'close 1']);
  });

  it('a translate that throws as it is called is a failed job', async () => {
    const h = translator({ translate: () => { throw new Error('no worker'); } });
    h.closing('u1', 'First.');
    await flush();
    expect(h.log.find((e) => e.kind === 'degraded')).toMatchObject({ payload: { message: 'no worker' } });
    expect(h.clock.pending()).toBe(0);
  });
});

describe('the job translator: what an ending forgets and says', () => {
  it('a close that fails on the fatal path is said in the Logs before failed, and failed is still said', async () => {
    for (const close of [() => { throw new Error('worker stuck'); }, () => Promise.reject(new Error('worker stuck'))]) {
      const h = translator({ fatal: () => true, close });
      h.closing('u1', 'First.');
      h.asked[0].fail(new Error('gone'));
      await flush();
      expect(h.log.slice(-2)).toEqual([
        { kind: 'frame', payload: { direction: 'in', type: 'translation.close_error', payload: { error: 'worker stuck' } } },
        { kind: 'failed', payload: { message: 'gone', cause: expect.any(Error) } },
      ]);
      expect(checkTranslation(h.log)).toEqual([]);
    }
  });

  it('waits five seconds, no longer, for what it lets go on the fatal path', () => {
    expect(CLOSE_TIMEOUT_MS).toBe(5_000);
  });

  it('a close that never settles on the fatal path is given up at its bound: failed is said, the Logs say why, and nothing is said late', async () => {
    let settle!: (error: unknown) => void;
    const h = translator({ fatal: () => true, close: () => new Promise<void>((_resolve, reject) => { settle = reject; }) });
    h.closing('u1', 'First.');
    h.asked[0].fail(new Error('gone'));
    await flush();
    h.clock.advance(CLOSE_TIMEOUT_MS - 1);
    await flush();
    expect(h.said()).toEqual([]);
    h.clock.advance(1);
    await flush();
    expect(h.log.slice(-2)).toEqual([
      { kind: 'frame', payload: { direction: 'in', type: 'translation.close_timeout', payload: { afterMs: CLOSE_TIMEOUT_MS } } },
      { kind: 'failed', payload: { message: 'gone', cause: expect.any(Error) } },
    ]);
    const said = h.log.length;
    // A stop afterwards does not wait for what was given up, and what it says late is unheard.
    await h.session.stop();
    settle(new Error('worker stuck'));
    await flush();
    expect(h.log.filter((e) => e.kind !== 'stop' && e.kind !== 'stopped')).toHaveLength(said);
    expect(h.clock.pending()).toBe(0);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a close that settles in time leaves no bound armed', async () => {
    const h = translator({ fatal: () => true, close: () => Promise.resolve() });
    h.closing('u1', 'First.');
    h.asked[0].fail(new Error('gone'));
    await flush();
    expect(h.said()).toEqual(['failed']);
    expect(h.clock.pending()).toBe(0);
  });

  it('a stop that lands while the fatal path lets go says nothing of the failure', async () => {
    let settle!: () => void;
    const h = translator({ fatal: () => true, close: () => new Promise<void>((resolve) => { settle = resolve; }) });
    h.closing('u1', 'First.');
    h.asked[0].fail(new Error('gone'));
    await flush();
    const stopping = h.session.stop();
    // The stop waits for the close itself: the bound was the failure's.
    expect(h.clock.pending()).toBe(0);
    settle();
    await stopping;
    await flush();
    expect(h.said()).toEqual([]);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('forgets the origins that closed when it ends, with the cuts in progress', async () => {
    const h = translator();
    h.closing('u1', 'First.');
    h.session.source({ origin: 'u2', text: 'One. Two', stableLen: 8, closed: false });
    expect(h.session.held()).toEqual({ cutters: 1, closed: 1 });
    await h.session.stop();
    expect(h.session.held()).toEqual({ cutters: 0, closed: 0 });
  });
});

describe('the job translator: what a job is told of the session before it', () => {
  const pairs = (a: Asked) => a.context.previous.map((p) => `${p.source}=${p.translation}`);

  it('hands each job the last three pairs the session translated, oldest first, across origins', async () => {
    expect(CONTEXT_PAIRS).toBe(3);
    const h = translator();
    for (const [k, origin] of ['u1', 'u2', 'u3', 'u4', 'u5'].entries()) {
      h.closing(origin, `S${k + 1}.`);
      h.asked[k].answer(`T${k + 1}`);
      await flush();
    }
    expect(h.asked.map(pairs)).toEqual([
      [],
      ['S1.=T1'],
      ['S1.=T1', 'S2.=T2'],
      ['S1.=T1', 'S2.=T2', 'S3.=T3'],
      ['S2.=T2', 'S3.=T3', 'S4.=T4'],
    ]);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('counts the stretches of one origin as pairs of their own', async () => {
    const h = translator();
    h.session.source({ origin: 'u1', text: 'One. Two', stableLen: 8, closed: false });
    h.asked[0].answer('いち。');
    await flush();
    h.closing('u1', 'One. Two.');
    expect(pairs(h.asked[1])).toEqual(['One.=いち。']);
  });

  it('a job that failed, came back blank or past its deadline adds nothing', async () => {
    const h = translator({ timeoutMs: 500 });
    h.closing('u1', 'One.');
    h.asked[0].answer('いち。');
    await flush();
    h.closing('u2', 'Fails.');
    h.asked[1].fail(new Error('The service answered 500.'));
    await flush();
    h.closing('u3', 'Blank.');
    h.asked[2].answer('   ');
    await flush();
    h.closing('u4', 'Late.');
    h.clock.advance(500);
    await flush();
    h.asked[3].answer('too late');
    await flush();
    h.closing('u5', 'Two.');
    expect(h.asked.map(pairs)).toEqual([[], ['One.=いち。'], ['One.=いち。'], ['One.=いち。'], ['One.=いち。']]);
    h.asked[4].answer('に。');
    await flush();
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it("each job's context is its own: a translate that changes it changes nothing for the next", async () => {
    const h = translator();
    h.closing('u1', 'One.');
    h.asked[0].answer('いち。');
    await flush();
    h.closing('u2', 'Two.');
    h.asked[1].context.previous.length = 0;
    h.asked[1].answer('に。');
    await flush();
    h.closing('u3', 'Three.');
    expect(pairs(h.asked[2])).toEqual(['One.=いち。', 'Two.=に。']);
  });

  it('a pair counts once the answer is had, even when a listener throws as it is said', async () => {
    const h = translator();
    h.listener.on = (kind) => { if (kind === 'translationText') throw new Error('listener'); };
    h.closing('u1', 'One.');
    h.asked[0].answer('いち。');
    await flush();
    h.closing('u2', 'Two.');
    expect(pairs(h.asked[1])).toEqual(['One.=いち。']);
  });
});

describe('the job translator: a failure that ends the unit, with its code', () => {
  it('says the code fatal names on failed, with the message and the cause, and nothing follows', async () => {
    const refused = new Error('Incorrect API key provided.');
    const h = translator({ fatal: (error) => (error === refused ? { code: 'auth' } : false) });
    h.closing('u1', 'First.');
    h.closing('u2', 'Second.');
    h.asked[0].fail(refused);
    await flush();
    h.closing('u3', 'Third.');
    await flush();
    expect(h.log.filter((e) => e.kind === 'failed')).toEqual([{ kind: 'failed', payload: { message: 'Incorrect API key provided.', code: 'auth', cause: refused } }]);
    expect(h.asked).toHaveLength(1);
    expect(checkTranslation(h.log)).toEqual([]);
  });

  it('a fatal that answers true says failed with no code, as before', async () => {
    const h = translator({ fatal: () => true });
    h.closing('u1', 'First.');
    h.asked[0].fail(new Error('gone'));
    await flush();
    const failed = h.log.find((e) => e.kind === 'failed');
    expect(failed && 'payload' in failed && 'code' in failed.payload).toBe(false);
  });

  it('a fatal that answers false leaves the failure one job\'s', async () => {
    const h = translator({ fatal: () => false });
    h.closing('u1', 'First.');
    h.asked[0].fail(new Error('The service answered 429.'));
    await flush();
    expect(h.said()).toEqual(['degraded translation_failed']);
  });

  it('holds to the rule suite as a unit: one job lands with the context, the next ends the unit with its code', async () => {
    const seen: JobContext[] = [];
    const refused = Object.assign(new Error('The model does not exist.'), { code: 'model_missing' });
    const run = new AbortController();
    const { session, log } = recordTranslation((request, events) => createJobTranslator({
      events,
      clock: request.clock,
      signal: request.signal,
      language: request.context.direction.target,
      fatal: (error) => (error === refused ? { code: refused.code } : false),
      translate: async (text, _signal, context) => {
        seen.push(context);
        if (text.startsWith('Second')) throw refused;
        return `[ja] ${text}`;
      },
    }), {
      leg: 'speaker',
      context: { direction: { source: 'en', target: 'ja' } } as never,
      config: {},
      credentials: {},
      clock: createVirtualClock(0),
      signal: run.signal,
    });
    await session.open();
    session.source({ origin: 'u1', text: 'First.', stableLen: 6, closed: true });
    await flush();
    session.source({ origin: 'u2', text: 'Second.', stableLen: 7, closed: true });
    await flush();
    session.source({ origin: 'u3', text: 'Third.', stableLen: 6, closed: true });
    await flush();
    expect(seen.map((c) => c.previous)).toEqual([[], [{ source: 'First.', translation: '[ja] First.' }]]);
    expect(log.filter((e) => e.kind === 'failed')).toEqual([{ kind: 'failed', payload: { message: 'The model does not exist.', code: 'model_missing', cause: refused } }]);
    expect(checkTranslation(log)).toEqual([]);
  });
});
