import { describe, it, expect } from 'vitest';
import { createVirtualClock } from './clock';
import { AdapterStartError, SAMPLE_RATE, type Adapter, type AdapterEvents, type AdapterSession } from './adapter';

/** A no-op adapter: proves the interface can be implemented as written. */
const nullAdapter: Adapter<{ name: string }, { key: string }> = {
  async start(request, events): Promise<AdapterSession> {
    events.segmentOpened({ ref: 1, side: 'source' });
    events.segmentText({ ref: 1, text: request.config.name });
    events.segmentClosed({ ref: 1 });
    return {
      appendAudio() {},
      appendText() {},
      beginTurn() {},
      endTurn() {},
      cancelTurn() {},
      async stop() {},
      info: { transport: 'none' },
    };
  },
};

describe('contract', () => {
  it('fixes the sample rate at 24 kHz', () => {
    expect(SAMPLE_RATE).toBe(24000);
  });

  it('can be implemented by a minimal adapter', async () => {
    const seen: string[] = [];
    const events: AdapterEvents = {
      segmentOpened: () => seen.push('opened'),
      segmentText: (e) => seen.push(`text:${e.text}`),
      segmentClosed: () => seen.push('closed'),
      audio: () => seen.push('audio'),
      closed: () => seen.push('closed-session'),
      reconnecting: () => {},
      reconnected: () => {},
      failed: () => {},
      degraded: () => {},
      loading: () => {},
      busy: () => {},
      frame: () => {},
    };
    const session = await nullAdapter.start(
      { context: { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' }, config: { name: 'hi' }, credentials: { key: '' }, clock: createVirtualClock(), signal: new AbortController().signal },
      events,
    );
    expect(seen).toEqual(['opened', 'text:hi', 'closed']);
    expect(session.info.transport).toBe('none');
  });

  it('keeps the error a start failed on as the cause of its AdapterStartError', () => {
    const original = new Error('OrtRun failed: OUT_OF_DEVICE_MEMORY');
    const error = new AdapterStartError('GPU out of memory', 'gpu_out_of_memory', undefined, { cause: original });
    expect(error.cause).toBe(original);
    expect(error.message).toBe('GPU out of memory');
    expect(new AdapterStartError('no cause', 'code').cause).toBeUndefined();
  });
});
