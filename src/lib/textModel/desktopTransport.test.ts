import { describe, it, expect } from 'vitest';
import { TextModelTransportError } from './client';
import { desktopTextModelTransport, platformTextModelTransport, TEXT_MODEL_CANCEL_CHANNEL, TEXT_MODEL_REQUEST_CHANNEL } from './desktopTransport';

/** The bridge's `invoke`, answering the request channel with `answer` and recording every call. */
function bridge(answer: (data: Record<string, unknown>) => Promise<unknown>) {
  const calls: Array<{ channel: string; data: Record<string, unknown> }> = [];
  const invoke = (channel: string, data?: unknown) => {
    calls.push({ channel, data: data as Record<string, unknown> });
    return channel === TEXT_MODEL_REQUEST_CHANNEL ? answer(data as Record<string, unknown>) : Promise.resolve(true);
  };
  return { invoke, calls };
}

const init = (over: Partial<{ signal: AbortSignal; body: string; method: 'GET' | 'POST' }> = {}) => ({
  method: 'POST' as const,
  headers: { 'Content-Type': 'application/json' },
  body: '{"model":"m"}',
  signal: new AbortController().signal,
  ...over,
});

describe("the desktop app's transport for a compatible service", () => {
  it('names the channels the main process handles', () => {
    expect(TEXT_MODEL_REQUEST_CHANNEL).toBe('text-model:request');
    expect(TEXT_MODEL_CANCEL_CHANNEL).toBe('text-model:cancel');
  });

  it('hands the main process the base, the endpoint, the method, the headers and the body, and reads its answer', async () => {
    const b = bridge(async () => ({ status: 200, body: '{"choices":[]}' }));
    const answer = await desktopTextModelTransport(b.invoke)('http://localhost:11434/v1/chat/completions', init());
    expect(answer.status).toBe(200);
    await expect(answer.text()).resolves.toBe('{"choices":[]}');
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]).toEqual({
      channel: 'text-model:request',
      data: { id: expect.any(String), baseUrl: 'http://localhost:11434/v1', path: '/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"model":"m"}' },
    });
  });

  it('asks for the list without a body', async () => {
    const b = bridge(async () => ({ status: 404, body: '' }));
    const answer = await desktopTextModelTransport(b.invoke)('https://api.example.com/v1/models', { method: 'GET', headers: {}, signal: new AbortController().signal });
    expect(answer.status).toBe(404);
    expect(b.calls[0].data).toEqual({ id: expect.any(String), baseUrl: 'https://api.example.com/v1', path: '/models', method: 'GET', headers: {} });
  });

  it("says the main process's failures with the client's codes", async () => {
    const cases: Array<[unknown, string]> = [
      [{ error: 'network', message: 'Could not reach the service (ECONNREFUSED).' }, 'network'],
      [{ error: 'timeout', message: 'The service did not answer within 60 seconds.' }, 'timeout'],
      [{ error: 'too_large', message: 'The answer was larger than 2 MB.' }, 'server'],
      [{ error: 'refused', message: 'The address must start with https://.' }, 'refused'],
      [{ nonsense: true }, 'server'],
      [undefined, 'server'],
    ];
    for (const [answer, code] of cases) {
      const b = bridge(async () => answer);
      const error = await desktopTextModelTransport(b.invoke)('https://api.example.com/v1/models', init({ method: 'GET', body: undefined })).catch((e: unknown) => e);
      expect(error, JSON.stringify(answer)).toBeInstanceOf(TextModelTransportError);
      expect((error as TextModelTransportError).code, JSON.stringify(answer)).toBe(code);
    }
  });

  it('a bridge that refuses the call is refused', async () => {
    const b = bridge(() => Promise.reject(new Error('Blocked unauthorized invoke for channel: text-model:request')));
    const error = await desktopTextModelTransport(b.invoke)('https://api.example.com/v1/models', init()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'refused' });
  });

  it('sends nothing for an address that is not one of the two endpoints', async () => {
    const b = bridge(async () => ({ status: 200, body: '' }));
    const error = await desktopTextModelTransport(b.invoke)('https://api.example.com/v1/embeddings', init()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'refused' });
    expect(b.calls).toEqual([]);
  });

  it("a caller's abort rejects with its reason, and the main process is told to let the request go", async () => {
    const before = new AbortController();
    const stopped = new Error('stopped');
    before.abort(stopped);
    const idle = bridge(async () => ({ status: 200, body: '' }));
    await expect(desktopTextModelTransport(idle.invoke)('https://api.example.com/v1/models', init({ signal: before.signal }))).rejects.toBe(stopped);
    expect(idle.calls).toEqual([]);

    const during = new AbortController();
    const hanging = bridge(() => new Promise(() => {}));
    const asking = desktopTextModelTransport(hanging.invoke)('https://api.example.com/v1/chat/completions', init({ signal: during.signal }));
    during.abort(stopped);
    await expect(asking).rejects.toBe(stopped);
    expect(hanging.calls.map((c) => c.channel)).toEqual(['text-model:request', 'text-model:cancel']);
    expect(hanging.calls[1].data).toEqual({ id: hanging.calls[0].data.id });
  });

  it('gives each request an id of its own', async () => {
    const b = bridge(async () => ({ status: 200, body: '' }));
    const transport = desktopTextModelTransport(b.invoke);
    await transport('https://api.example.com/v1/models', init());
    await transport('https://api.example.com/v1/models', init());
    expect(b.calls[0].data.id).not.toBe(b.calls[1].data.id);
  });

  it('is none outside the desktop app', () => {
    expect(platformTextModelTransport()).toBeNull();
  });
});
