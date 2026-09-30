/**
 * F14, the header seam (Stage 2 OpenAI Live, ruling 7; choice 1): the rule
 * before the socket, cleared at the socket's first open, error or close; one
 * upgrade at a time per rule key; the bound; an abort anywhere; the web's
 * refusal; each platform's registrar; and fixed words that carry no header
 * value. Over `FakeSocket`s on a virtual clock.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from './clock';
import {
  createHeaderSocket, electronRegistrar, extensionRegistrar, HEADER_SOCKET_CAP_MS, HeaderSocketError, platformRegistrar, ruleFor,
  type HeaderRegistrar, type HeaderRule,
} from './headerSocket';
import { flush } from './testing/drive';
import { FakeSocket, fakeSockets } from './testing/fakeSocket';

afterEach(() => {
  vi.unstubAllGlobals();
});

const URL_LIVE = 'wss://api.openai.com/v1/live/sessions';
const HEADERS = { set: { Authorization: 'Bearer sk-proj-seamKey0123456789' }, remove: ['Origin'] };

/** A registrar that records what it was asked, answering each registration when the test says. */
function registrar() {
  const calls: string[] = [];
  const pending: Array<{ rule: HeaderRule; answer(error?: Error): void }> = [];
  const r: HeaderRegistrar = {
    set: (rule) => new Promise<void>((resolve, reject) => {
      calls.push(`set ${rule.host}${rule.path}`);
      pending.push({ rule, answer: (error) => (error ? reject(error) : resolve()) });
    }),
    clear: (rule) => { calls.push(`clear ${rule.host}${rule.path}`); },
  };
  return { r, calls, answer: (error?: Error) => pending.shift()?.answer(error) };
}

function seam() {
  const sockets = fakeSockets();
  const reg = registrar();
  const clock = createVirtualClock(0);
  const open = createHeaderSocket(() => reg.r, (url) => sockets.create(url));
  const controller = new AbortController();
  return { sockets, reg, clock, open, controller, start: (url = URL_LIVE, signal = controller.signal) => open(url, HEADERS, { signal, clock }) };
}

describe('the header seam (F14)', () => {
  it("keys a rule by the URL's host and its path to the last slash, the endpoint's own", () => {
    expect(ruleFor(URL_LIVE, HEADERS)).toEqual({ host: 'api.openai.com', path: '/v1/live/', set: HEADERS.set, remove: ['Origin'] });
    expect(ruleFor('wss://speech.example.test:8443/ws', { set: { 'User-Agent': 'x' } })).toEqual({ host: 'speech.example.test:8443', path: '/', set: { 'User-Agent': 'x' }, remove: [] });
  });

  it('installs the rule before it makes the socket, resolves with the socket once open, and clears the rule then', async () => {
    const h = seam();
    let socket: WebSocket | null = null;
    void h.start().then((s) => { socket = s; });
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/']);
    expect(h.sockets.all).toEqual([]);
    h.reg.answer();
    await flush();
    expect(h.sockets.last().url).toBe(URL_LIVE);
    expect(socket).toBeNull();
    h.sockets.last().open();
    await flush();
    expect(socket).toBe(h.sockets.last());
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/', 'clear api.openai.com/v1/live/']);
    expect(h.clock.pending()).toBe(0);
  });

  it('a socket that errors or closes before it opens is refused as never opened; its rule is cleared', async () => {
    for (const end of [(s: FakeSocket) => s.drop(), (s: FakeSocket) => s.serverClose(1011)]) {
      const h = seam();
      const opening = h.start();
      await flush();
      h.reg.answer();
      await flush();
      end(h.sockets.last());
      await expect(opening).rejects.toMatchObject({ name: 'HeaderSocketError', reason: 'never_opened', message: 'The socket closed before it opened.' });
      await flush();
      expect(h.reg.calls.slice(-1)).toEqual(['clear api.openai.com/v1/live/']);
      expect(h.clock.pending()).toBe(0);
    }
  });

  it('a registration the platform refuses opens nothing, and its rule is cleared too, before the next leg at the key registers, in fixed words that keep its cause', async () => {
    const h = seam();
    const first = h.start();
    const second = h.start();
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/']);
    const cause = new Error('ws-headers-set: Invalid arguments');
    h.reg.answer(cause);
    const error = await first.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HeaderSocketError);
    expect(error).toMatchObject({ reason: 'register', message: "The app could not set the socket's upgrade headers.", cause });
    expect(h.sockets.all).toEqual([]);
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/', 'clear api.openai.com/v1/live/', 'set api.openai.com/v1/live/']);
    // The gate was let go, not stranded on the refused leg: the next leg registers and upgrades.
    h.reg.answer();
    await flush();
    h.sockets.last().open();
    await expect(second).resolves.toBe(h.sockets.last());
  });

  it('an abort before the call registers nothing; during the registration it rejects at once and sends the clear at once — the channel is ordered, so it lands after the set — no socket made', async () => {
    const before = seam();
    before.controller.abort(new Error('stopped'));
    await expect(before.start()).rejects.toThrow('stopped');
    await flush();
    expect(before.reg.calls).toEqual([]);

    const during = seam();
    const opening = during.start();
    await flush();
    during.controller.abort(new Error('stopped'));
    await expect(opening).rejects.toThrow('stopped');
    await flush();
    expect(during.reg.calls).toEqual(['set api.openai.com/v1/live/', 'clear api.openai.com/v1/live/']);
    during.reg.answer();
    await flush();
    expect(during.reg.calls).toEqual(['set api.openai.com/v1/live/', 'clear api.openai.com/v1/live/']);
    expect(during.sockets.all).toEqual([]);
    expect(during.clock.pending()).toBe(0);
  });

  it(`a registration that never answers holds the gate no longer than the leg's ${HEADER_SOCKET_CAP_MS / 1000} s: its clear is sent, and the next leg at the key registers and upgrades`, async () => {
    const h = seam();
    const first = h.start();
    const second = h.start();
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/']);
    h.clock.advance(HEADER_SOCKET_CAP_MS);
    await expect(first).rejects.toMatchObject({ reason: 'timeout' });
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/', 'clear api.openai.com/v1/live/', 'set api.openai.com/v1/live/']);
    expect(h.sockets.all).toEqual([]);
    // The first answer, however late, opens nothing; the second's leg upgrades.
    h.reg.answer();
    h.reg.answer();
    await flush();
    expect(h.sockets.all).toHaveLength(1);
    h.sockets.last().open();
    await expect(second).resolves.toBe(h.sockets.last());
  });

  it('an abort while the socket connects closes it and clears the rule', async () => {
    const h = seam();
    const opening = h.start();
    await flush();
    h.reg.answer();
    await flush();
    h.controller.abort(new Error('stopped'));
    await expect(opening).rejects.toThrow('stopped');
    await flush();
    expect(h.sockets.last().readyState).toBe(FakeSocket.CLOSED);
    expect(h.reg.calls.slice(-1)).toEqual(['clear api.openai.com/v1/live/']);
  });

  it(`registration and upgrade are bounded at ${HEADER_SOCKET_CAP_MS / 1000} s from the gate, on the caller's clock`, async () => {
    const h = seam();
    const opening = h.start();
    await flush();
    h.clock.advance(HEADER_SOCKET_CAP_MS - 1);
    h.reg.answer();
    await flush();
    h.clock.advance(1);
    await expect(opening).rejects.toMatchObject({ reason: 'timeout', message: `The socket did not open within ${HEADER_SOCKET_CAP_MS / 1000} s.` });
    await flush();
    expect(h.sockets.last().readyState).toBe(FakeSocket.CLOSED);
    expect(h.reg.calls.slice(-1)).toEqual(['clear api.openai.com/v1/live/']);
    expect(h.clock.pending()).toBe(0);
  });

  it('upgrades one leg at a time per rule key — the second registers once the first has opened and its rule is cleared — and a different key does not wait', async () => {
    const h = seam();
    const first = h.start();
    const second = h.start();
    const other = h.start('wss://api.openai.com/v1/realtime?model=x');
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/', 'set api.openai.com/v1/']);
    h.reg.answer();
    h.reg.answer();
    await flush();
    h.sockets.all[0].open();
    await first;
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/', 'set api.openai.com/v1/', 'clear api.openai.com/v1/live/', 'set api.openai.com/v1/live/']);
    h.reg.answer();
    await flush();
    h.sockets.all[1].open();
    h.sockets.all[2].open();
    await expect(Promise.all([second, other])).resolves.toHaveLength(2);
  });

  it('a leg that gives up while it waits at the gate never registers, and the queue moves on', async () => {
    const h = seam();
    const first = h.start();
    const waiting = new AbortController();
    const second = h.start(URL_LIVE, waiting.signal);
    const third = h.start();
    await flush();
    waiting.abort(new Error('stopped'));
    await expect(second).rejects.toThrow('stopped');
    h.reg.answer();
    await flush();
    h.sockets.last().open();
    await first;
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/', 'clear api.openai.com/v1/live/', 'set api.openai.com/v1/live/']);
    h.reg.answer();
    await flush();
    h.sockets.last().open();
    await expect(third).resolves.toBe(h.sockets.last());
  });

  it("the web has no platform to install a rule: it refuses in fixed words", async () => {
    const clock = createVirtualClock(0);
    const open = createHeaderSocket(() => null, () => { throw new Error('no socket may be made'); });
    await expect(open(URL_LIVE, HEADERS, { signal: new AbortController().signal, clock })).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it("a browser that refuses the socket is rethrown in fixed words, the key never quoted", async () => {
    class RefusingWebSocket {
      constructor(url: string) {
        throw new DOMException(`Failed to construct 'WebSocket': The URL '${url}' is invalid. ${HEADERS.set.Authorization}`, 'SyntaxError');
      }
    }
    vi.stubGlobal('WebSocket', RefusingWebSocket);
    const reg = registrar();
    const clock = createVirtualClock(0);
    const opening = createHeaderSocket(() => reg.r)(URL_LIVE, HEADERS, { signal: new AbortController().signal, clock });
    await flush();
    reg.answer();
    const error = (await opening.catch((e: unknown) => e)) as Error;
    expect(error).toMatchObject({ name: 'SyntaxError', message: 'The browser would not open the socket (SyntaxError).' });
    expect(`${error.message} ${String(error)}`).not.toContain('sk-proj');
  });
});

describe("the header seam's registrars", () => {
  it("Electron's: ws-headers-set with the path, then ws-headers-clear; a refusal in the main process's words", async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true });
    const r = electronRegistrar({ invoke });
    const rule = ruleFor(URL_LIVE, HEADERS);
    await r.set(rule);
    r.clear(rule);
    expect(invoke.mock.calls).toEqual([
      ['ws-headers-set', { host: 'api.openai.com', path: '/v1/live/', headers: HEADERS.set, removeHeaders: ['Origin'] }],
      ['ws-headers-clear', { host: 'api.openai.com', path: '/v1/live/' }],
    ]);
    invoke.mockResolvedValueOnce({ success: false, error: 'Invalid arguments: host and headers required' });
    await expect(r.set(rule)).rejects.toThrow('ws-headers-set: Invalid arguments: host and headers required');
    // A clear that fails is nobody's business: its rejection is swallowed.
    invoke.mockRejectedValueOnce(new Error('gone'));
    r.clear(rule);
    await flush();
  });

  it("the extension's: WS_HEADERS_SET and WS_HEADERS_CLEAR to the background; no answer, or a refusal, rejects", async () => {
    const sent: unknown[] = [];
    let reply: unknown = { success: true };
    const runtime: { sendMessage(m: unknown, cb?: (r: unknown) => void): void; lastError?: { message?: string } } = {
      sendMessage: (m, cb) => { sent.push(m); cb?.(reply); },
    };
    const r = extensionRegistrar(runtime);
    const rule = ruleFor(URL_LIVE, HEADERS);
    await r.set(rule);
    r.clear(rule);
    expect(sent).toEqual([
      { type: 'WS_HEADERS_SET', host: 'api.openai.com', path: '/v1/live/', set: HEADERS.set, remove: ['Origin'] },
      { type: 'WS_HEADERS_CLEAR', host: 'api.openai.com', path: '/v1/live/' },
    ]);
    reply = { success: false, error: 'Sender is not an extension page' };
    await expect(r.set(rule)).rejects.toThrow('WS_HEADERS_SET: Sender is not an extension page');
    runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
    reply = undefined;
    await expect(r.set(rule)).rejects.toThrow('WS_HEADERS_SET: Could not establish connection. Receiving end does not exist.');
  });

  it("the platform picks its own: Electron's invoke, the extension's runtime, none on the web", async () => {
    expect(platformRegistrar()).toBeNull();
    const invoke = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('electronAPI', {});
    vi.stubGlobal('electron', { invoke });
    await platformRegistrar()?.set(ruleFor(URL_LIVE, HEADERS));
    expect(invoke).toHaveBeenCalledWith('ws-headers-set', expect.objectContaining({ path: '/v1/live/' }));
    vi.unstubAllGlobals();
    const sendMessage = vi.fn((_m: unknown, cb?: (r: unknown) => void) => cb?.({ success: true }));
    vi.stubGlobal('chrome', { runtime: { id: 'abcdefghijklmnop', sendMessage } });
    await platformRegistrar()?.set(ruleFor(URL_LIVE, HEADERS));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'WS_HEADERS_SET' }), expect.any(Function));
  });
});
